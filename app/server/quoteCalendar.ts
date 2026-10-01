import { db } from './db.js';
import {
  CalendarError, getEventById, insertEvent, isCalendarConfigured, patchEvent,
  type CalendarAttendee, type CalendarEvent,
} from './calendarClient.js';
import { listRules, type CalendarRule } from './calendarRules.js';
import { syncOneBandEvent } from './calendarSync.js';
import { QuoteError, getQuote } from './quotes.js';
import { OPTION_PREFIX, isOptionTitle, withoutOption } from './quoteShow.js';

/**
 * A quote's own calendar event: the date held as «אופציה» while the client decides, and the
 * same event renamed once they sign. See docs/QUOTES-DESIGN.md, «The calendar event».
 *
 * This is how a quote's show comes into being, and the only way: the event goes on the band
 * rule's calendar, and the sync makes the show out of it exactly as it would out of an event
 * typed into Google by hand. The invitation goes to whoever is ticked — the members by default,
 * and any supplier chosen — from Google itself, so it lands in their calendars.
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
 * The title a new event starts with, as the band writes them: «אופציה - הופעה קולדפליי אירוע
 * חברה קיסריה». What the event is, or for whom when that is all there is, and where. A quote
 * already signed is no option, so its event starts without the prefix.
 */
export function defaultTitle(quote: { status?: string; event_type?: string | null; client_name?: string | null; event_location?: string | null }) {
  const what = [quote.event_type || quote.client_name, quote.event_location].filter(Boolean).join(' ');
  const title = `הופעה קולדפליי${what ? ` ${what}` : ''}`;
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

function needsReady(quote: any): CalendarRule {
  if (!isCalendarConfigured()) throw new QuoteError(503, 'היומן לא מחובר לאפליקציה');
  const rule = bandRule();
  if (!rule) throw new QuoteError(400, 'אין כלל יומן פעיל להופעות הלהקה — הוסיפו אחד בהגדרות → יומן');
  if (quote.status === 'cancelled') throw new QuoteError(409, 'ההצעה בוטלה');
  if (!quote.event_date) throw new QuoteError(400, 'חסר תאריך אירוע בהצעה');
  return rule;
}

/** Writes Google's answer onto the quote, then lets the sync make — or update — the show from it. */
function afterWrite(quoteId: string, rule: CalendarRule, calendarId: string, event: CalendarEvent) {
  db.prepare(
    `UPDATE band_quotes SET calendar_id = ?, calendar_event_id = ?, calendar_event_title = ?,
       calendar_event_link = ? WHERE id = ?`
  ).run(calendarId, event.id, event.summary ?? null, event.htmlLink ?? null, quoteId);
  const { matched } = syncOneBandEvent(rule, event);
  return { ...getQuote(quoteId), calendar_matched: matched };
}

/** The quote's event, created on the band's calendar, with the invitations sent. */
export async function createQuoteEvent(quoteId: string, input: unknown) {
  const quote = quoteRow(quoteId);
  const rule = needsReady(quote);
  if (quote.calendar_event_id) {
    // An event deleted in Google can be replaced; one still there is updated instead.
    try {
      const existing = await getEventById(quote.calendar_id, quote.calendar_event_id);
      if (existing.status !== 'cancelled') throw new QuoteError(409, 'כבר יש להצעה אירוע ביומן — עדכנו אותו');
    } catch (err) {
      if (!(err instanceof CalendarError && err.status === 404)) throw err;
    }
  }
  const form = cleanForm(input);
  const event = await insertEvent(rule.calendar_id, {
    summary: form.title,
    description: `נוצר מהצעת מחיר ${quote.quote_number}${quote.client_name ? ` — ${quote.client_name}` : ''}`,
    location: form.location || null,
    date: quote.event_date,
    startTime: form.start_time,
    endTime: form.end_time,
    attendees: form.attendees,
  });
  return afterWrite(quote.id, rule, rule.calendar_id, event);
}

/**
 * The event rewritten from the dialog — on signing, to take «אופציה» off its title. A guest who
 * was already on it keeps their answer; a new guest gets the invitation. The date always follows
 * the quote's.
 */
export async function updateQuoteEvent(quoteId: string, input: unknown) {
  const quote = quoteRow(quoteId);
  const rule = needsReady(quote);
  if (!quote.calendar_event_id) throw new QuoteError(400, 'אין להצעה אירוע ביומן');
  const form = cleanForm(input);
  const current = await getEventById(quote.calendar_id, quote.calendar_event_id);
  const known = new Map((current.attendees ?? []).filter((a) => a.email).map((a) => [a.email!.toLowerCase(), a]));
  const attendees: Array<string | CalendarAttendee> = form.attendees.map((email) => known.get(email) ?? email);
  const event = await patchEvent(quote.calendar_id, quote.calendar_event_id, {
    summary: form.title,
    location: form.location || null,
    date: quote.event_date,
    startTime: form.start_time,
    endTime: form.end_time,
    attendees,
  });
  return afterWrite(quote.id, rule, quote.calendar_id, event);
}
