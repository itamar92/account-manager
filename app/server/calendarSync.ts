import { db, uuid, getVatPercent, setSetting, getSetting } from './db.js';
import { eventDate, eventStartTime, isCalendarConfigured, listEvents, type CalendarEvent } from './calendarClient.js';
import {
  cleanTitle, evaluate, listRules, overrideMap, type CalendarRule, type EventOverride, type MatchVerdict,
} from './calendarRules.js';
import {
  ensureExpenseRow, eventSharesTotal, expenseRowForEvent, expenseTotal, getEvent, syncExpenseLabel,
} from './band.js';
import { setEventAttendees } from './assignments.js';
import { linkQuotesByCalendar } from './quoteShow.js';
import { claimQuoteEvents, markedQuoteId } from './quoteEventMark.js';
import { looksPrivate, refreshPrivate } from './showPrivacy.js';

/** Who a synced show's money is received by, by default: the person whose books these are. */
function ownerName(): string | null {
  const owner = db
    .prepare("SELECT name FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1")
    .get() as { name: string } | undefined;
  return owner?.name ?? null;
}

export interface RuleSyncResult {
  ruleId: string;
  ruleName: string;
  target: 'band' | 'personal';
  fetched: number;
  matched: number;
  created: number;
  updated: number;
  linked: number;
  removed: number;
  skipped: number;
  error?: string;
}

export interface CalendarSyncResult {
  rules: RuleSyncResult[];
  created: number;
  updated: number;
  linked: number;
  removed: number;
  matched: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function windowBounds(monthsBack: number, monthsAhead: number) {
  const now = new Date();
  return {
    timeMin: new Date(now.getFullYear(), now.getMonth() - monthsBack, 1).toISOString(),
    timeMax: new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1).toISOString(),
  };
}

/**
 * Fetches each distinct calendar once, even when several rules read the same one —
 * two rules over `primary` should not cost two round trips.
 */
async function fetchCalendars(
  rules: CalendarRule[],
  monthsBack: number,
  monthsAhead: number
): Promise<Map<string, CalendarEvent[] | Error>> {
  const { timeMin, timeMax } = windowBounds(monthsBack, monthsAhead);
  const byCalendar = new Map<string, CalendarEvent[] | Error>();
  for (const calendarId of new Set(rules.map((r) => r.calendar_id))) {
    try {
      byCalendar.set(calendarId, await listEvents({ calendarId, timeMin, timeMax }));
    } catch (err) {
      byCalendar.set(calendarId, err as Error);
    }
  }
  return byCalendar;
}

/**
 * True when nobody has entered money against this band event yet. Its expense row is created
 * empty alongside the show, so an untouched one is not evidence of bookkeeping — but anything
 * typed into it is.
 */
function bandEventIsEmpty(row: any): boolean {
  const fields = ['tickets', 'amount_pre_vat', 'amount_with_vat', 'expenses', 'expenses_paid', 'profit',
    'commission_amount'];
  return fields.every((f) => !Number(row[f]))
    && !eventSharesTotal(row.id)
    && !expenseTotal(expenseRowForEvent(row.id));
}

/**
 * Same date + same name means the same event. Names are compared loosely because what
 * someone types by hand and what the calendar holds differ in spacing and case.
 */
const normalizeName = (value: string | null | undefined): string =>
  (value || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A row for this event that was entered by hand, so the sync adopts it rather than adding
 * a second one. A matching name wins; failing that any hand-entered show on the same date
 * is taken, which is how a show typed in before the calendar was connected gets linked.
 */
function findOrphanBandEvent(date: string, title: string): any | undefined {
  const rows = db
    .prepare('SELECT * FROM band_events WHERE date = ? AND calendar_event_id IS NULL ORDER BY created_at')
    .all(date) as any[];
  return rows.find((r) => normalizeName(r.venue) === normalizeName(title)) ?? rows[0];
}

/**
 * The same-work check for personal rules. Unlike shows, a client can genuinely have two
 * works on one date, so only an identical name counts — there is no date-only fallback.
 */
function findOrphanWork(clientId: string, date: string, title: string): any | undefined {
  const rows = db
    .prepare('SELECT * FROM works WHERE client_id = ? AND date = ? AND calendar_event_id IS NULL ORDER BY created_at')
    .all(clientId, date) as any[];
  return rows.find((r) => normalizeName(r.description) === normalizeName(title));
}

function resolveClient(name: string): string {
  const clean = name.trim();
  const existing = db.prepare('SELECT id FROM clients WHERE name = ?').get(clean) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = uuid();
  db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, clean);
  return id;
}

/**
 * A band rule writes into band_events; only the descriptive columns are ever touched.
 *
 * A show whose name was typed by hand keeps it: `venue_locked` is the record of that decision,
 * and re-syncing must not undo it. The date and the place still follow the calendar, which is
 * where they are actually maintained.
 */
function applyBandEvent(event: CalendarEvent, date: string, title: string, tally: RuleSyncResult) {
  const location = event.location ?? null;
  // The guest list is what the staffing tab matches supplier emails against. A guest who
  // declined is not coming, so they do not count as staffed.
  const guests = (event.attendees ?? [])
    .filter((a) => a.email && a.responseStatus !== 'declined')
    .map((a) => a.email!);
  // «פרטי» on the event, or the mark of the quote it was saved from: a private booking.
  const calendarPrivate = looksPrivate(event.summary, event.description) || !!markedQuoteId(event) ? 1 : 0;
  const existing = db.prepare('SELECT * FROM band_events WHERE calendar_event_id = ?').get(event.id) as any;

  // When it starts and what its description says, for the show boards (server/showBoard.ts).
  const startTime = eventStartTime(event);
  const description = event.description?.trim() || null;
  const summary = event.summary?.trim() || null;

  if (existing) {
    db.prepare(
      `UPDATE band_events SET venue = ?, date = ?, location = ?, calendar_private = ?, start_time = ?,
         calendar_description = ?, calendar_summary = ? WHERE id = ?`
    ).run(existing.venue_locked ? existing.venue : title, date, location, calendarPrivate, startTime, description, summary, existing.id);
    refreshPrivate(existing.id);
    const updated = getEvent(existing.id);
    ensureExpenseRow(updated);
    syncExpenseLabel(updated);
    setEventAttendees(existing.id, guests);
    tally.updated++;
    return;
  }

  // Adopt a hand-entered row for the same date and name instead of creating a second one.
  const orphan = findOrphanBandEvent(date, title);
  if (orphan) {
    // Adopted by date rather than by name: the name on the row was typed by someone, so it
    // stays and is locked, exactly as a rename after the fact would be.
    const keepName = !!orphan.venue_locked || normalizeName(orphan.venue) !== normalizeName(title);
    db.prepare(
      `UPDATE band_events SET calendar_event_id = ?, venue = ?, location = ?, venue_locked = ?, calendar_private = ?,
         start_time = ?, calendar_description = ?, calendar_summary = ? WHERE id = ?`
    ).run(event.id, keepName ? orphan.venue : title, location, keepName ? 1 : 0, calendarPrivate, startTime, description, summary, orphan.id);
    refreshPrivate(orphan.id);
    const linked = getEvent(orphan.id);
    ensureExpenseRow(linked);
    syncExpenseLabel(linked);
    setEventAttendees(orphan.id, guests);
    tally.linked++;
    return;
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO band_events (id, venue, date, calendar_event_id, location, receiver, calendar_private,
       start_time, calendar_description, calendar_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, date, event.id, location, ownerName(), calendarPrivate, startTime, description, summary);
  refreshPrivate(id);
  ensureExpenseRow(getEvent(id));
  setEventAttendees(id, guests);
  tally.created++;
}

/**
 * A personal rule writes into `works` — the app's billable unit — as an unpaid work priced
 * at the rule's fixed amount, or at 0 when the rule has none, waiting for you to fill the
 * price in and invoice it.
 *
 * A work that has already been invoiced is never rewritten, and an amount you entered is
 * never overwritten: only the description, date and location follow the calendar. The one
 * exception is a still-unpriced work, which picks up a fixed amount added to the rule after
 * it was drawn.
 *
 * A description edited by hand is kept as well — see `applyBandEvent` for the same rule on
 * the band side.
 */
function applyPersonalWork(
  event: CalendarEvent,
  date: string,
  title: string,
  rule: CalendarRule,
  tally: RuleSyncResult
) {
  if (!rule.client_name?.trim()) {
    tally.skipped++;
    return;
  }
  const location = event.location ?? null;
  const fixedAmount = round2(Number(rule.fixed_amount) || 0);
  const priceOf = (amount: number) => {
    const vat = round2((amount * getVatPercent()) / 100);
    return { amount, vat, total: round2(amount + vat) };
  };
  const existing = db.prepare('SELECT * FROM works WHERE calendar_event_id = ?').get(event.id) as any;
  // What the public show board needs, kept up to date even on a work that is already billed: none
  // of it is bookkeeping. See server/showBoard.ts.
  const boardFields = (workId: string) => db.prepare(
    'UPDATE works SET start_time = ?, calendar_rule_id = ?, calendar_private = ?, calendar_summary = ? WHERE id = ?'
  ).run(
    eventStartTime(event), rule.id, looksPrivate(event.summary, event.description) ? 1 : 0,
    event.summary?.trim() || null, workId
  );

  if (existing) {
    boardFields(existing.id);
    // Locked once billed — changing a line on an issued invoice is not the sync's call.
    if (existing.status !== 'unpaid') {
      tally.skipped++;
      return;
    }
    const price = priceOf(fixedAmount && !Number(existing.amount) ? fixedAmount : round2(Number(existing.amount)));
    db.prepare(
      'UPDATE works SET date = ?, description = ?, location = ?, amount = ?, vat_amount = ?, total = ? WHERE id = ?'
    ).run(
      date, existing.description_locked ? existing.description : title, location,
      price.amount, price.vat, price.total, existing.id
    );
    tally.updated++;
    return;
  }

  const clientId = resolveClient(rule.client_name);

  // A work with this client, date and name is this event, typed in by hand before the sync
  // reached it. Link it instead of adding a duplicate line to the table.
  const orphan = findOrphanWork(clientId, date, title);
  if (orphan) {
    boardFields(orphan.id);
    // An already-billed row is linked and nothing more, which is enough to stop the event
    // being drawn again as a second, unbilled copy of work you have already invoiced.
    if (orphan.status !== 'unpaid') {
      db.prepare('UPDATE works SET calendar_event_id = ? WHERE id = ?').run(event.id, orphan.id);
    } else {
      const price = priceOf(fixedAmount && !Number(orphan.amount) ? fixedAmount : round2(Number(orphan.amount)));
      db.prepare(
        `UPDATE works SET calendar_event_id = ?, location = ?, amount = ?, vat_amount = ?, total = ?
         WHERE id = ?`
      ).run(event.id, location ?? orphan.location, price.amount, price.vat, price.total, orphan.id);
    }
    tally.linked++;
    return;
  }

  const price = priceOf(fixedAmount);
  const workId = uuid();
  db.prepare(
    `INSERT INTO works (id, client_id, date, description, amount, vat_amount, total, status,
       calendar_event_id, location, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, 'calendar')`
  ).run(workId, clientId, date, title, price.amount, price.vat, price.total, event.id, location);
  boardFields(workId);
  tally.created++;
}

/**
 * True when the number on this work is the sync's own doing — an unpriced calendar row, or
 * one carrying exactly the fixed price of a personal rule for that client — rather than a
 * figure someone typed. Only such a row may be cleaned up when its event disappears; an
 * amount you entered by hand is bookkeeping and stays.
 */
export function isSyncPriced(work: any): boolean {
  const amount = round2(Number(work.amount) || 0);
  if (!amount) return true;
  if (work.source !== 'calendar') return false;
  const rules = db
    .prepare(
      `SELECT r.fixed_amount FROM calendar_rules r JOIN clients c ON c.name = r.client_name
       WHERE r.target = 'personal' AND c.id = ?`
    )
    .all(work.client_id) as Array<{ fixed_amount: number }>;
  return rules.some((r) => round2(Number(r.fixed_amount) || 0) === amount);
}

/** Removes a row for a cancelled event, but only while it holds no money of your own. */
function applyCancellation(event: CalendarEvent, rule: CalendarRule, tally: RuleSyncResult) {
  if (rule.target === 'band') {
    const existing = db.prepare('SELECT * FROM band_events WHERE calendar_event_id = ?').get(event.id) as any;
    if (existing && bandEventIsEmpty(existing)) {
      db.prepare('DELETE FROM band_event_expenses WHERE event_id = ?').run(existing.id);
      db.prepare('DELETE FROM band_events WHERE id = ?').run(existing.id);
      tally.removed++;
    }
    return;
  }
  const work = db.prepare('SELECT * FROM works WHERE calendar_event_id = ?').get(event.id) as any;
  if (work && work.status === 'unpaid' && isSyncPriced(work)) {
    db.prepare('DELETE FROM works WHERE id = ?').run(work.id);
    tally.removed++;
  }
}

/**
 * Whether a rule that did not draw an event because of a manual override should remove the
 * row its target holds for that event.
 *
 * An «exclude» removes it: that is the point of excluding. An event pinned to another rule is
 * different. Rules of the same kind share one row per event (works and band_events are both
 * keyed by the calendar event), so that row is the pinned rule's, and deleting it here would undo
 * the pin on every sync — which is how a show added by hand to the shows rule kept vanishing
 * whenever a second rule over the same calendar ran after it. Only a pin to a rule of the
 * other kind leaves this kind's row stale, so only then does it go.
 */
export function missDropsRow(
  rule: CalendarRule,
  override: EventOverride | undefined,
  targetOf: (ruleId: string) => CalendarRule['target'] | undefined
): boolean {
  if (!override) return false;
  if (override.action === 'exclude') return true;
  if (!override.rule_id || override.rule_id === rule.id) return false;
  const pinnedTarget = targetOf(override.rule_id);
  return !!pinnedTarget && pinnedTarget !== rule.target;
}

/**
 * Runs every enabled rule and writes the events each one draws to its target.
 *
 * Rules are independent: one calendar failing does not stop the others, and its error is
 * reported on that rule's line rather than failing the whole sync.
 */
export async function pullShowsFromCalendar(
  options: { monthsBack?: number; monthsAhead?: number; ruleId?: string } = {}
): Promise<CalendarSyncResult> {
  const monthsBack = options.monthsBack ?? 12;
  const monthsAhead = options.monthsAhead ?? 24;

  const rules = listRules().filter(
    (r) => r.enabled && (!options.ruleId || r.id === options.ruleId)
  );
  const byCalendar = await fetchCalendars(rules, monthsBack, monthsAhead);
  const overrides = overrideMap();
  // Every rule, not only the ones running now: a pin may point at a rule outside this run.
  const targets = new Map(listRules().map((r) => [r.id, r.target]));
  const targetOf = (id: string) => targets.get(id);
  const results: RuleSyncResult[] = [];

  for (const rule of rules) {
    const tally: RuleSyncResult = {
      ruleId: rule.id, ruleName: rule.name, target: rule.target,
      fetched: 0, matched: 0, created: 0, updated: 0, linked: 0, removed: 0, skipped: 0,
    };
    const events = byCalendar.get(rule.calendar_id);
    if (events instanceof Error) {
      tally.error = events.message;
      results.push(tally);
      continue;
    }
    tally.fetched = events?.length ?? 0;

    const tx = db.transaction(() => {
      for (const event of events ?? []) {
        if (!event.id) continue;
        const date = eventDate(event);
        if (!date) continue;

        // A cancelled event still has to be evaluated, so a rule only cleans up its own rows.
        if (event.status === 'cancelled') {
          const wouldMatch = evaluate(
            { ...rule, skip_declined: 0 }, { ...event, status: 'confirmed' }, overrides
          );
          if (wouldMatch.matched) applyCancellation(event, rule, tally);
          continue;
        }

        const verdict = evaluate(rule, event, overrides);
        if (!verdict.matched) {
          // An event excluded after it was already drawn should lose its row, so the
          // correction takes effect without hunting the row down by hand.
          if (verdict.reason === 'manual' && missDropsRow(rule, overrides.get(event.id), targetOf)) {
            applyCancellation(event, rule, tally);
          }
          continue;
        }
        tally.matched++;

        const title = cleanTitle(event, verdict, rule);
        if (rule.target === 'band') applyBandEvent(event, date, title, tally);
        else applyPersonalWork(event, date, title, rule, tally);
      }
      // A quote's «אופציה» saved in Google from the quote's link is tied back to the quote here.
      if (rule.target === 'band') claimQuoteEvents(rule.calendar_id, events ?? []);
    });
    tx();
    results.push(tally);
  }

  // A quote whose «אופציה» event has just become a show is pointed at it.
  linkQuotesByCalendar();
  setSetting('calendar_last_sync', new Date().toISOString());

  return {
    rules: results,
    matched: results.reduce((s, r) => s + r.matched, 0),
    created: results.reduce((s, r) => s + r.created, 0),
    updated: results.reduce((s, r) => s + r.updated, 0),
    linked: results.reduce((s, r) => s + r.linked, 0),
    removed: results.reduce((s, r) => s + r.removed, 0),
  };
}

/**
 * One event through the same steps a full sync takes it through — the rule decides whether it is
 * a show, the title is cleaned the same way, and the show is created or updated by
 * applyBandEvent. It is how a quote's own event becomes a show the moment it is created, rather
 * than at the next sync, without the show being made any other way than from the calendar.
 *
 * Only the band rule's half is run: a personal rule writes the owner's private works, which a
 * quote has no business touching.
 */
export function syncOneBandEvent(rule: CalendarRule, event: CalendarEvent): { matched: boolean } {
  const date = eventDate(event);
  if (!event.id || !date || rule.target !== 'band') return { matched: false };
  const verdict = evaluate(rule, event, overrideMap());
  if (!verdict.matched) return { matched: false };
  const tally: RuleSyncResult = {
    ruleId: rule.id, ruleName: rule.name, target: rule.target,
    fetched: 1, matched: 1, created: 0, updated: 0, linked: 0, removed: 0, skipped: 0,
  };
  db.transaction(() => applyBandEvent(event, date, cleanTitle(event, verdict, rule), tally))();
  linkQuotesByCalendar();
  return { matched: true };
}

export interface PreviewRow {
  eventId: string;
  date: string;
  summary: string;
  title: string;
  location: string | null;
  organizer: string | null;
  matched: boolean;
  reason: string;
  term?: string;
}

/**
 * Dry run: shows what a rule would draw, and why each event was let in or left out,
 * without writing anything. This is how you tune keywords and ignore words safely.
 */
export async function previewRule(
  rule: CalendarRule,
  options: { monthsBack?: number; monthsAhead?: number; includeMisses?: boolean } = {}
): Promise<{ fetched: number; matched: number; rows: PreviewRow[] }> {
  const { timeMin, timeMax } = windowBounds(options.monthsBack ?? 3, options.monthsAhead ?? 12);
  const events = await listEvents({ calendarId: rule.calendar_id, timeMin, timeMax });
  const overrides = overrideMap();

  const rows: PreviewRow[] = [];
  let matched = 0;
  for (const event of events) {
    const date = eventDate(event);
    if (!date) continue;
    const verdict: MatchVerdict = evaluate(rule, event, overrides);
    if (verdict.matched) matched++;
    else if (!options.includeMisses) continue;

    rows.push({
      eventId: event.id,
      date,
      summary: event.summary || '',
      title: cleanTitle(event, verdict, rule),
      location: event.location ?? null,
      organizer: event.organizer?.email ?? event.creator?.email ?? null,
      matched: verdict.matched,
      reason: verdict.reason,
      term: verdict.term,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { fetched: events.length, matched, rows };
}

export function calendarStatus() {
  const rules = listRules();
  return {
    configured: isCalendarConfigured(),
    last_sync: getSetting('calendar_last_sync', '') || null,
    rules_total: rules.length,
    rules_enabled: rules.filter((r) => r.enabled).length,
    synced_events: (
      db.prepare('SELECT COUNT(*) AS n FROM band_events WHERE calendar_event_id IS NOT NULL').get() as {
        n: number;
      }
    ).n,
    synced_works: (
      db.prepare('SELECT COUNT(*) AS n FROM works WHERE calendar_event_id IS NOT NULL').get() as {
        n: number;
      }
    ).n,
  };
}
