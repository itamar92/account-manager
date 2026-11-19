import { db } from './db.js';
import type { CalendarEvent } from './calendarClient.js';

/**
 * How a quote finds its own event without having written it.
 *
 * The app does not create the «אופציה» event: it opens Google Calendar's «new event» page
 * filled in (server/quoteCalendar.ts), and the event is saved there. Its description carries
 * the quote's mark, and whatever reads the calendar afterwards — the full sync, or the quote's
 * own «בדיקה ביומן» — ties the event back to the quote by it.
 */

const MARK = /am-quote:([0-9a-f-]{8,64})/i;

export const quoteMark = (quoteId: string) => `am-quote:${quoteId}`;

export const markedQuoteId = (event: Pick<CalendarEvent, 'description'>): string | null =>
  event.description?.match(MARK)?.[1]?.toLowerCase() ?? null;

/**
 * Points each quote at the event that carries its mark. A quote already pointed at an event
 * keeps it while that event is still there among `events`; one whose event was deleted takes
 * the new one. Returns the quotes that were pointed somewhere.
 */
export function claimQuoteEvents(calendarId: string, events: CalendarEvent[]): string[] {
  const live = new Set(events.filter((e) => e.id && e.status !== 'cancelled').map((e) => e.id));
  const claimed: string[] = [];
  const find = db.prepare(
    `SELECT id, calendar_event_id FROM band_quotes
     WHERE lower(id) = ? AND is_template = 0 AND status != 'cancelled'`
  );
  const write = db.prepare(
    `UPDATE band_quotes SET calendar_id = ?, calendar_event_id = ?, calendar_event_title = ?,
       calendar_event_link = ? WHERE id = ?`
  );
  for (const event of events) {
    if (!event.id || event.status === 'cancelled') continue;
    const quoteId = markedQuoteId(event);
    if (!quoteId) continue;
    const quote = find.get(quoteId) as { id: string; calendar_event_id: string | null } | undefined;
    if (!quote) continue;
    const current = quote.calendar_event_id;
    // A second event saved from the same link does not take over from the first.
    if (current && current !== event.id && live.has(current)) continue;
    write.run(calendarId, event.id, event.summary ?? null, event.htmlLink ?? null, quote.id);
    claimed.push(quote.id);
  }
  return claimed;
}
