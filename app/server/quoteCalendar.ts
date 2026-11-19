import { db, getBandName } from './db.js';
import {
  CalendarError, eventDate, eventTemplateUrl, getEventById, isCalendarConfigured, listEvents,
  type CalendarEvent,
} from './calendarClient.js';
import { listRules, type CalendarRule } from './calendarRules.js';
import { syncOneBandEvent } from './calendarSync.js';
import { QuoteError, getQuote } from './quotes.js';
import { OPTION_PREFIX, isOptionTitle, withoutOption } from './quoteShow.js';
import { claimQuoteEvents, quoteMark } from './quoteEventMark.js';

/**
 * A quote's own calendar event: the date held as «אופציה» while the client decides, and the
 * same event renamed once they sign. See docs/QUOTES-DESIGN.md, «The calendar event».
 *
 * This is how a quote's show comes into being, and the only way: the event goes on the band
 * rule's calendar, and the sync makes the show out of it exactly as it would out of an event
 * typed into Google by hand.
 *
 * The app never writes to Google. It opens Google Calendar's «new event» page filled in from the
 * dialog — title, date, time, place, guests, and the quote's mark in the description — and the
 * event is saved there, where Google offers to email the guests. «בדיקה ביומן» (or the next
 * sync) finds the event by its mark and ties it to the quote. So the Google token stays
 * read-only, and no app verification is needed for a write scope.
 */

/** The rule that turns calendar events into shows. Its calendar is where the quote's event goes. */
export function bandRule(): CalendarRule | null {
  return listRules().find((r) => r.enabled && r.target === 'band') ?? null;
}

export const calendarReady = () => isCalendarConfigured() && !!bandRule();

function quoteRow(id: string): any {
  const row = db.prepare('SELECT * FROM band_quotes WHERE id = ?').get(id) as any;
  if (!row) throw new QuoteError(404, 'ההצעה לא נמצאה');
  if (row.is_template) throw new QuoteError(400, 'לתבנית אין אירוע ביומן');
  return row;
}

/**
 * The title a new event starts with: «אופציה - הופעה <הלהקה> אירוע חברה קיסריה». The show
 * keyword the calendar rule looks for, the band's name, what the event is (or for whom when
 * that is all there is), and where. A quote already signed is no option, so its event starts
 * without the prefix.
 */
export function defaultTitle(quote: { status?: string; event_type?: string | null; client_name?: string | null; event_location?: string | null }) {
  const what = [quote.event_type || quote.client_name, quote.event_location].filter(Boolean).join(' ');
  const title = `הופעה ${getBandName()}${what ? ` ${what}` : ''}`;
  return quote.status === 'signed' ? title : `${OPTION_PREFIX} - ${title}`;
}

/** HH:MM of a timed event, in the time it was written in; null for an all-day one. */
const timeOf = (when?: { dateTime?: string }) => when?.dateTime?.slice(11, 16) ?? null;

/** Who can be invited: the members, ticked by default, and the suppliers, by role. */
function people() {
  const members = db.prepare(
    `SELECT member_key AS key, name, email FROM band_members
     WHERE active = 1 AND email IS NOT NULL AND email != '' ORDER BY sort_order, name`
  ).all() as Array<{ key: string; name: string; email: string }>;
  const suppliers = db.prepare(
    `SELECT s.id, s.name, s.email, s.role, COALESCE(r.name, s.role) AS role_name
     FROM band_suppliers s LEFT JOIN band_supplier_roles r ON r.key = s.role
     WHERE s.email IS NOT NULL AND s.email != '' ORDER BY COALESCE(r.sort_order, 99), s.name`
  ).all() as Array<{ id: string; name: string; email: string; role: string; role_name: string }>;
  return { members, suppliers };
}

export interface CalendarForm {
  title: string;
  location: string;
  start_time: string | null;
  end_time: string | null;
  attendees: string[];
}

/**
 * Everything the dialog opens with. For a quote with no event, a fresh form: the default title,
 * the quote's place, and every member. For one with an event, the event as Google has it now —
 * whatever was changed there since — with «אופציה» already taken off the title once the client
 * has signed, which is the edit the dialog is then opened for.
 */
export async function calendarDraft(quoteId: string) {
  const quote = quoteRow(quoteId);
  const rule = bandRule();
  const configured = isCalendarConfigured();
  const base = {
    configured,
    calendar_id: rule?.calendar_id ?? null,
    rule: rule && { name: rule.name, keywords: rule.keywords, ignore_words: rule.ignore_words },
    date: quote.event_date as string | null,
    signed: quote.status === 'signed',
    ...people(),
  };
  const fresh: CalendarForm = {
    title: defaultTitle(quote),
    location: quote.event_location || '',
    start_time: null,
    end_time: null,
    attendees: base.members.map((m) => m.email),
  };

  if (!quote.calendar_event_id || !configured) return { ...base, event: null, form: fresh };

  let event: CalendarEvent;
  try {
    event = await getEventById(quote.calendar_id, quote.calendar_event_id);
  } catch (err) {
    // Deleted in Google: the quote can have a new one.
    if (err instanceof CalendarError && err.status === 404) return { ...base, event: null, gone: true, form: fresh };
    throw err;
  }
  if (event.status === 'cancelled') return { ...base, event: null, gone: true, form: fresh };
  const title = event.summary || '';
  return {
    ...base,
    event: { id: event.id, title, link: event.htmlLink ?? null, is_option: isOptionTitle(title) },
    form: {
      title: base.signed && isOptionTitle(title) ? withoutOption(title) : title,
      location: event.location || '',
      start_time: timeOf(event.start),
      end_time: timeOf(event.end),
      attendees: (event.attendees ?? []).map((a) => a.email!).filter(Boolean),
    } satisfies CalendarForm,
  };
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanForm(input: any): CalendarForm {
  const title = String(input?.title ?? '').trim();
  if (!title) throw new QuoteError(400, 'חסרה כותרת לאירוע');
  if (title.length > 200) throw new QuoteError(400, 'הכותרת ארוכה מדי');
  const location = String(input?.location ?? '').trim();
  if (location.length > 300) throw new QuoteError(400, 'המיקום ארוך מדי');
  const time = (value: unknown, label: string) => {
    const s = String(value ?? '').trim();
    if (!s) return null;
    if (!TIME.test(s)) throw new QuoteError(400, `${label} אינה שעה תקינה`);
    return s;
  };
  const start_time = time(input?.start_time, 'שעת ההתחלה');
  const end_time = start_time ? time(input?.end_time, 'שעת הסיום') : null;
  const raw = Array.isArray(input?.attendees) ? input.attendees : [];
  const attendees = [...new Set(raw.map((e: unknown) => String(e ?? '').trim().toLowerCase()).filter(Boolean))] as string[];
  const bad = attendees.find((e) => !EMAIL.test(e));
  if (bad) throw new QuoteError(400, `כתובת לא תקינה: ${bad}`);
  if (attendees.length > 60) throw new QuoteError(400, 'יותר מדי מוזמנים');
  return { title, location, start_time, end_time, attendees };
}

function needsDate(quote: any) {
  if (quote.status === 'cancelled') throw new QuoteError(409, 'ההצעה בוטלה');
  if (!quote.event_date) throw new QuoteError(400, 'חסר תאריך אירוע בהצעה');
}

function needsReady(quote: any): CalendarRule {
  if (!isCalendarConfigured()) throw new QuoteError(503, 'היומן לא מחובר לאפליקציה');
  const rule = bandRule();
  if (!rule) throw new QuoteError(400, 'אין כלל יומן פעיל להופעות הלהקה — הוסיפו אחד בהגדרות → יומן');
  needsDate(quote);
  return rule;
}

/** The description the event is saved with: what it came from, and the mark that finds it again. */
export function eventDescription(quote: { id: string; quote_number?: string | null; client_name?: string | null }) {
  const from = `נוצר מהצעת מחיר${quote.quote_number ? ` ${quote.quote_number}` : ''}${quote.client_name ? ` — ${quote.client_name}` : ''}`;
  return `${from}\n\n${quoteMark(quote.id)}`;
}

/**
 * The Google Calendar «new event» page, filled in from the dialog. Nothing is saved anywhere
 * until the event is saved in Google; then «בדיקה ביומן» ties it to the quote.
 */
export function quoteEventLink(quoteId: string, input: unknown) {
  const quote = quoteRow(quoteId);
  needsDate(quote);
  const form = cleanForm(input);
  const url = eventTemplateUrl({
    summary: form.title,
    description: eventDescription(quote),
    location: form.location || null,
    date: quote.event_date,
    startTime: form.start_time,
    endTime: form.end_time,
    attendees: form.attendees,
  }, bandRule()?.calendar_id);
  return { url };
}

/** A day either side of the quote's date: an event that runs past midnight still starts on it. */
function aroundDate(date: string) {
  const at = (days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  };
  return { timeMin: at(-1), timeMax: at(2) };
}

/**
 * «בדיקה ביומן»: reads the band's calendar for the quote's event — the one it is tied to, or
 * else the one carrying its mark on its date — ties it to the quote, and lets the sync make or
 * update the show from it. Afterwards `calendar_found` says whether there was one.
 */
export async function refreshQuoteEvent(quoteId: string) {
  const quote = quoteRow(quoteId);
  const rule = needsReady(quote);

  let event: CalendarEvent | null = null;
  if (quote.calendar_event_id) {
    try {
      const current = await getEventById(quote.calendar_id || rule.calendar_id, quote.calendar_event_id);
      if (current.status !== 'cancelled') event = current;
    } catch (err) {
      if (!(err instanceof CalendarError && err.status === 404)) throw err;
    }
  }
  if (event) {
    claimQuoteEvents(quote.calendar_id || rule.calendar_id, [event]);
  } else {
    const events = await listEvents({ calendarId: rule.calendar_id, ...aroundDate(quote.event_date) });
    const mine = events.filter((e) => e.status !== 'cancelled' && eventDate(e) === quote.event_date);
    // The event the quote pointed at is gone: let the marked one take its place.
    if (quote.calendar_event_id) {
      db.prepare('UPDATE band_quotes SET calendar_event_id = NULL, calendar_event_title = NULL, calendar_event_link = NULL WHERE id = ?')
        .run(quote.id);
    }
    claimQuoteEvents(rule.calendar_id, mine);
    const now = quoteRow(quoteId);
    event = mine.find((e) => e.id === now.calendar_event_id) ?? null;
  }

  const matched = event ? syncOneBandEvent(rule, event).matched : false;
  return { ...getQuote(quoteId), calendar_found: !!event, calendar_matched: matched };
}
