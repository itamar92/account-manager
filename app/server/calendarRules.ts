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
  skip_declined: number;
  enabled: number;
  sort_order: number;
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
       client_name, skip_declined, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name?.trim() || 'כלל חדש',
    input.target === 'personal' ? 'personal' : 'band',
    input.calendar_id?.trim() || 'primary',
    input.keywords ?? '',
    input.organizers ?? '',
    input.ignore_words ?? '',
    input.client_name?.trim() || null,
    input.skip_declined ? 1 : 0,
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
       ignore_words = ?, client_name = ?, skip_declined = ?, enabled = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    String(merged.name).trim() || 'כלל חדש',
    merged.target === 'personal' ? 'personal' : 'band',
    String(merged.calendar_id).trim() || 'primary',
    merged.keywords ?? '',
    merged.organizers ?? '',
    merged.ignore_words ?? '',
    merged.client_name ? String(merged.client_name).trim() : null,
    merged.skip_declined ? 1 : 0,
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
  | { matched: true; reason: 'keyword' | 'organizer'; term: string }
  | { matched: false; reason: 'ignored' | 'declined' | 'no-match' | 'cancelled'; term?: string };

/** Everything a rule searches for text: the title and the description. */
function haystack(event: CalendarEvent): string {
  return `${event.summary || ''}\n${event.description || ''}`.toLowerCase();
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
 * An event is included when a keyword matches **or** the organiser is listed — the second
 * path exists because events you were invited to rather than created often don't carry the
 * keyword at all. Ignore words are checked first and override both, which is what makes a
 * single organiser usable when they send both gigs and rehearsals.
 */
export function evaluate(rule: CalendarRule, event: CalendarEvent): MatchVerdict {
  if (event.status === 'cancelled') return { matched: false, reason: 'cancelled' };

  const text = haystack(event);

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
 * Strips the term that matched off the front of a title so the stored name reads naturally:
 * "הופעה קולדפליי זאפה חיפה" becomes "קולדפליי זאפה חיפה". Only a leading occurrence is
 * removed — "בכורה הופעה MADONNA" keeps its shape.
 */
export function cleanTitle(event: CalendarEvent, verdict: MatchVerdict): string {
  const summary = (event.summary || '').trim();
  if (!summary) return 'אירוע';
  if (verdict.matched && verdict.reason === 'keyword') {
    const stripped = summary.replace(new RegExp(`^\\s*${escapeRegExp(verdict.term)}\\s*`, 'i'), '').trim();
    return stripped || summary;
  }
  return summary;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
