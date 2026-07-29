import { db, uuid, getCalendarId, getShowKeyword, setSetting, getSetting } from './db.js';
import { eventDate, isCalendarConfigured, listEvents, type CalendarEvent } from './calendarClient.js';

export interface CalendarSyncResult {
  fetched: number;
  matched: number;
  created: number;
  updated: number;
  linked: number;
  removed: number;
  calendarId: string;
  keyword: string;
}

/**
 * Strips the trigger word from an event title so the stored venue reads naturally —
 * "הופעה קולדפליי זאפה הרצליה" becomes "קולדפליי זאפה הרצליה".
 */
function venueFromEvent(event: CalendarEvent, keyword: string): string {
  const summary = (event.summary || '').trim();
  const stripped = summary.replace(new RegExp(`^\\s*${keyword}\\s*`), '').trim();
  return stripped || summary || 'הופעה';
}

function isShow(event: CalendarEvent, keyword: string): boolean {
  if (!keyword) return true;
  const haystack = `${event.summary || ''} ${event.description || ''}`;
  return haystack.includes(keyword);
}

/** True when nobody has entered money against this event yet. */
function hasNoFinancials(row: any): boolean {
  const fields = ['tickets', 'amount_pre_vat', 'amount_with_vat', 'expenses', 'expenses_paid', 'profit',
    'commission_amount', 'amir', 'itamar', 'yuval', 'guy'];
  return fields.every((f) => !Number(row[f]));
}

/**
 * Pulls shows from Google Calendar into `band_events`.
 *
 * Upserts on the calendar event id, so re-running is safe and an event moved in the
 * calendar moves here too. Only the descriptive columns (venue, date, location) are
 * written — every financial column stays exactly as entered in the app. Events already
 * entered by hand are adopted by date rather than duplicated.
 */
export async function pullShowsFromCalendar(
  options: { monthsBack?: number; monthsAhead?: number } = {}
): Promise<CalendarSyncResult> {
  const calendarId = getCalendarId();
  const keyword = getShowKeyword();
  const monthsBack = options.monthsBack ?? 12;
  const monthsAhead = options.monthsAhead ?? 24;

  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1).toISOString();

  const events = await listEvents({ calendarId, timeMin, timeMax });
  const shows = events.filter((e) => isShow(e, keyword));

  let created = 0;
  let updated = 0;
  let linked = 0;
  let removed = 0;

  const tx = db.transaction(() => {
    for (const event of shows) {
      const date = eventDate(event);
      if (!date || !event.id) continue;

      const venue = venueFromEvent(event, keyword);
      const location = event.location ?? null;
      const existing = db
        .prepare('SELECT * FROM band_events WHERE calendar_event_id = ?')
        .get(event.id) as any;

      if (event.status === 'cancelled') {
        // Drop a cancelled show only while it is still financially empty; otherwise the
        // numbers someone entered would vanish with it.
        if (existing && hasNoFinancials(existing)) {
          db.prepare('DELETE FROM band_events WHERE id = ?').run(existing.id);
          removed++;
        }
        continue;
      }

      if (existing) {
        db.prepare('UPDATE band_events SET venue = ?, date = ?, location = ? WHERE id = ?')
          .run(venue, date, location, existing.id);
        updated++;
        continue;
      }

      // Adopt a hand-entered row for the same date instead of creating a second one.
      const orphan = db
        .prepare('SELECT * FROM band_events WHERE date = ? AND calendar_event_id IS NULL LIMIT 1')
        .get(date) as any;
      if (orphan) {
        db.prepare('UPDATE band_events SET calendar_event_id = ?, venue = ?, location = ? WHERE id = ?')
          .run(event.id, venue, location, orphan.id);
        linked++;
        continue;
      }

      db.prepare(
        `INSERT INTO band_events (id, venue, date, calendar_event_id, location, receiver)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uuid(), venue, date, event.id, location, 'איתמר');
      created++;
    }
    setSetting('calendar_last_sync', new Date().toISOString());
  });

  tx();

  return {
    fetched: events.length,
    matched: shows.length,
    created,
    updated,
    linked,
    removed,
    calendarId,
    keyword,
  };
}

export function calendarStatus() {
  return {
    configured: isCalendarConfigured(),
    calendar_id: getCalendarId(),
    keyword: getShowKeyword(),
    last_sync: getSetting('calendar_last_sync', '') || null,
    synced_events: (
      db.prepare('SELECT COUNT(*) AS n FROM band_events WHERE calendar_event_id IS NOT NULL').get() as {
        n: number;
      }
    ).n,
  };
}
