import { db, uuid } from './db.js';
import type { CalendarEvent } from './calendarClient.js';

export interface CalendarRule {
  id: string;
  name: string;
  target: 'band' | 'personal';
  calendar_id: string;
  keywords: string;
  organizers: string;
  ignore_words: string;
  client_name: string | null;
  /** Personal target: price per event, before VAT. 0 leaves the work unpriced. */
  fixed_amount: number;
  skip_declined: number;
  match_description: number;
  enabled: number;
  sort_order: number;
}

/** A price is optional, so anything unparseable (or negative) means "no fixed price". */
function normalizeAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100) / 100;
}

/** Splits a comma/newline separated field into trimmed, non-empty terms. */
export function parseTerms(raw: string | null | undefined): string[] {
  return (raw || '')
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function listRules(): CalendarRule[] {
  return db.prepare('SELECT * FROM calendar_rules ORDER BY sort_order, created_at').all() as CalendarRule[];
}

export function getRule(id: string): CalendarRule | undefined {
  return db.prepare('SELECT * FROM calendar_rules WHERE id = ?').get(id) as CalendarRule | undefined;
}

export type RuleInput = Partial<Omit<CalendarRule, 'id'>>;

export function createRule(input: RuleInput): CalendarRule {
  const id = uuid();
  db.prepare(
    `INSERT INTO calendar_rules (id, name, target, calendar_id, keywords, organizers, ignore_words,
       client_name, fixed_amount, skip_declined, match_description, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name?.trim() || 'כלל חדש',
    input.target === 'personal' ? 'personal' : 'band',
    input.calendar_id?.trim() || 'primary',
    input.keywords ?? '',
    input.organizers ?? '',
    input.ignore_words ?? '',
    input.client_name?.trim() || null,
    normalizeAmount(input.fixed_amount),
    input.skip_declined ? 1 : 0,
    input.match_description ? 1 : 0,
    input.enabled ? 1 : 0,
    input.sort_order ?? 0
  );
  return getRule(id)!;
}

export function updateRule(id: string, input: RuleInput): CalendarRule {
  const existing = getRule(id);
  if (!existing) throw Object.assign(new Error('rule not found'), { status: 404 });
  const merged = { ...existing, ...input };
  db.prepare(
    `UPDATE calendar_rules SET name = ?, target = ?, calendar_id = ?, keywords = ?, organizers = ?,
       ignore_words = ?, client_name = ?, fixed_amount = ?, skip_declined = ?, match_description = ?,
       enabled = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    String(merged.name).trim() || 'כלל חדש',
    merged.target === 'personal' ? 'personal' : 'band',
    String(merged.calendar_id).trim() || 'primary',
    merged.keywords ?? '',
    merged.organizers ?? '',
    merged.ignore_words ?? '',
    merged.client_name ? String(merged.client_name).trim() : null,
    normalizeAmount(merged.fixed_amount),
    merged.skip_declined ? 1 : 0,
    merged.match_description ? 1 : 0,
    merged.enabled ? 1 : 0,
    merged.sort_order ?? 0,
    id
  );
  return getRule(id)!;
}

export function deleteRule(id: string) {
  db.prepare('DELETE FROM calendar_rules WHERE id = ?').run(id);
}

export type MatchVerdict =
  | { matched: true; reason: 'keyword' | 'organizer' | 'manual'; term: string }
  | { matched: false; reason: 'ignored' | 'declined' | 'no-match' | 'cancelled' | 'manual'; term?: string };

// ---------- manual per-event overrides ----------

export interface EventOverride {
  event_id: string;
  action: 'exclude' | 'include';
  rule_id: string | null;
  summary: string | null;
  event_date: string | null;
  note: string | null;
  created_at: string;
}

export function listOverrides(): EventOverride[] {
  return db
    .prepare('SELECT * FROM calendar_event_overrides ORDER BY event_date, created_at')
    .all() as EventOverride[];
}

/** Overrides keyed by event id, for the sync and preview loops. */
export function overrideMap(): Map<string, EventOverride> {
  return new Map(listOverrides().map((o) => [o.event_id, o]));
}

export function setOverride(input: {
  event_id: string;
  action: 'exclude' | 'include';
  rule_id?: string | null;
  summary?: string | null;
  event_date?: string | null;
  note?: string | null;
}): EventOverride {
  if (!input.event_id) throw Object.assign(new Error('event_id is required'), { status: 400 });
  if (input.action !== 'exclude' && input.action !== 'include')
    throw Object.assign(new Error('action must be exclude or include'), { status: 400 });
  if (input.action === 'include' && !input.rule_id)
    throw Object.assign(new Error('include צריך לציין כלל'), { status: 400 });

  db.prepare(
    `INSERT INTO calendar_event_overrides (event_id, action, rule_id, summary, event_date, note)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       action = excluded.action, rule_id = excluded.rule_id,
       summary = COALESCE(excluded.summary, calendar_event_overrides.summary),
       event_date = COALESCE(excluded.event_date, calendar_event_overrides.event_date),
       note = excluded.note`
  ).run(
    input.event_id,
    input.action,
    input.action === 'include' ? input.rule_id ?? null : null,
    input.summary ?? null,
    input.event_date ?? null,
    input.note ?? null
  );
  return db
    .prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ?')
    .get(input.event_id) as EventOverride;
}

export function deleteOverride(eventId: string) {
  db.prepare('DELETE FROM calendar_event_overrides WHERE event_id = ?').run(eventId);
}

/**
 * The text a rule searches.
 *
 * Titles only unless the rule opts in, because descriptions carry running orders like
 * "20:30 הופעה" that contain the keyword while saying nothing about whose show it is.
 */
function haystack(rule: CalendarRule, event: CalendarEvent): string {
  const text = rule.match_description
    ? `${event.summary || ''}\n${event.description || ''}`
    : event.summary || '';
  return text.toLowerCase();
}

function organizerEmails(event: CalendarEvent): string[] {
  const emails = [event.organizer?.email, event.creator?.email];
  for (const a of event.attendees ?? []) if (a.organizer && a.email) emails.push(a.email);
  return emails.filter(Boolean).map((e) => e!.toLowerCase());
}

/** True when the invitee themselves turned this event down. */
function selfDeclined(event: CalendarEvent): boolean {
  return (event.attendees ?? []).some((a) => a.self && a.responseStatus === 'declined');
}

/**
 * Decides whether one event is drawn by one rule, and says why.
 *
 * A manual override on the event wins over everything — rules are patterns and will always
 * be wrong at the edges, so a correction must survive the next sync.
 *
 * Otherwise an event is included when a keyword matches **or** the organiser is listed. The
 * second path exists because events you were invited to rather than created often don't
 * carry the keyword at all. Ignore words are checked before both, which is what makes a
 * single organiser usable when they send both gigs and rehearsals.
 */
export function evaluate(
  rule: CalendarRule,
  event: CalendarEvent,
  overrides?: Map<string, EventOverride>
): MatchVerdict {
  if (event.status === 'cancelled') return { matched: false, reason: 'cancelled' };

  const override = overrides?.get(event.id);
  if (override) {
    if (override.action === 'exclude') return { matched: false, reason: 'manual', term: 'הוסר ידנית' };
    if (override.rule_id === rule.id) return { matched: true, reason: 'manual', term: 'נוסף ידנית' };
    // An include pinned to another rule must not leak into this one.
    return { matched: false, reason: 'manual', term: 'שויך לכלל אחר' };
  }

  const text = haystack(rule, event);

  const ignoreWords = parseTerms(rule.ignore_words);
  for (const word of ignoreWords) {
    if (text.includes(word.toLowerCase())) return { matched: false, reason: 'ignored', term: word };
  }

  if (rule.skip_declined && selfDeclined(event)) return { matched: false, reason: 'declined' };

  const keywords = parseTerms(rule.keywords);
  for (const word of keywords) {
    if (text.includes(word.toLowerCase())) return { matched: true, reason: 'keyword', term: word };
  }

  const organizers = parseTerms(rule.organizers).map((o) => o.toLowerCase());
  if (organizers.length) {
    const emails = organizerEmails(event);
    for (const organizer of organizers) {
      if (emails.includes(organizer)) return { matched: true, reason: 'organizer', term: organizer };
    }
  }

  return { matched: false, reason: 'no-match' };
}

/**
 * Words that say "this entry is a show" without saying which show it is. They are noise in
 * the venue column wherever they stand, so they come out of every synced title regardless of
 * what any rule says — which is why they are here and not in a rule's keywords.
 */
export const SHOW_NOISE_WORDS = [
  'הופעה', 'הופעות', 'מופע', 'מופעים', 'גיג', 'גיגים',
  'show', 'shows', 'gig', 'gigs',
] as const;

/** Punctuation used to glue title parts together, left dangling when a word between them goes. */
const SEPARATORS = '\\-–—:|,';
/** What counts as part of a word, so "גיג" comes out of a title but "גיגית" survives. */
const WORD_CHAR = '\\p{L}\\p{N}';

/**
 * Removes every standalone occurrence of one word, together with the separator it leaves
 * behind: "הלהקה - הופעה - זאפה" loses "הופעה -" rather than keeping a stray dash.
 */
function removeWord(title: string, word: string): string {
  const pattern = `(?<![${WORD_CHAR}])${escapeRegExp(word)}(?![${WORD_CHAR}])\\s*[${SEPARATORS}]*`;
  return title.replace(new RegExp(pattern, 'giu'), ' ');
}

/** Squeezes the whitespace and drops separators left hanging at either end. */
function tidy(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`^[\\s${SEPARATORS}]+`), '')
    .replace(new RegExp(`[\\s${SEPARATORS}]+$`), '')
    .trim();
}

/**
 * The name a synced event is stored under.
 *
 * Two things come off. The show words above go wherever they appear, always. Then the rule's
 * own keywords are stripped off the front, so with the keyword "הלהקה" the calendar entry
 * "הופעה הלהקה גריי תל אביב" is stored as "גריי תל אביב".
 *
 * Every keyword the rule searches for is stripped, not just the one that happened to match,
 * because the word naming the act is noise in the venue column too. Keywords only go from the
 * front: "בכורה הלהקה" keeps its shape, since a keyword in the middle of a name is usually
 * part of it. A title made entirely of these words is left alone rather than stored blank.
 */
export function cleanTitle(event: CalendarEvent, verdict: MatchVerdict, rule?: CalendarRule): string {
  const summary = (event.summary || '').trim();
  if (!summary) return 'אירוע';
  if (!verdict.matched) return summary;

  let title = summary;
  for (const word of SHOW_NOISE_WORDS) title = removeWord(title, word);
  title = tidy(title);

  const terms = parseTerms(rule?.keywords);
  // An organizer match has no term of its own, but its title may still carry the prefix.
  if (!terms.length && verdict.reason === 'keyword') terms.push(verdict.term);

  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const term of terms) {
      const next = title.replace(new RegExp(`^\\s*${escapeRegExp(term)}\\s*[${SEPARATORS}]*\\s*`, 'iu'), '');
      if (next !== title) {
        title = next;
        stripped = true;
      }
    }
  }
  return tidy(title) || summary;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
