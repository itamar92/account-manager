/**
 * Google Calendar client.
 *
 * Uses an OAuth2 refresh token so the server can reach the calendar unattended:
 * `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
 *
 * It only reads: the sync draws shows and works out of what is already there, so the token needs
 * no more than `calendar.readonly`. Even a price quote's «אופציה» event is not written from here:
 * the app hands over a filled-in Google Calendar link (eventTemplateUrl), the event is saved in
 * Google, and the sync finds it by the quote's mark in its description (server/quoteCalendar.ts).
 */

// Overridable so the sync can be pointed at a stub during testing, the same way
// GREEN_INVOICE_BASE_URL points the Morning client at the sandbox.
const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const CALENDAR_API = process.env.GOOGLE_CALENDAR_API_URL || 'https://www.googleapis.com/calendar/v3';

export interface CalendarAttendee {
  email?: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  responseStatus?: string; // 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

export interface CalendarEvent {
  id: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string; self?: boolean };
  attendees?: CalendarAttendee[];
  htmlLink?: string;
  recurringEventId?: string;
}

export class CalendarError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function isCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN
  );
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  if (!isCalendarConfigured())
    throw new CalendarError(
      'Google Calendar לא מוגדר — חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN',
      503
    );

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new CalendarError(`Google token refresh failed (${res.status}): ${await res.text()}`);

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new CalendarError('Google token refresh returned no access_token');
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

export function resetTokenCache() {
  cachedToken = null;
}

export interface ListEventsOptions {
  calendarId: string;
  timeMin?: string; // RFC3339
  timeMax?: string;
  query?: string; // free-text filter applied by Google
}

/** Lists events, expanding recurrences into individual instances and following paging. */
export async function listEvents(opts: ListEventsOptions): Promise<CalendarEvent[]> {
  const token = await getAccessToken();
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      ...(opts.timeMin ? { timeMin: opts.timeMin } : {}),
      ...(opts.timeMax ? { timeMax: opts.timeMax } : {}),
      ...(opts.query ? { q: opts.query } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(opts.calendarId)}/events?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      resetTokenCache();
      throw new CalendarError('Google rejected the access token (401)');
    }
    if (!res.ok) throw new CalendarError(`Google Calendar list failed (${res.status}): ${await res.text()}`);

    const body = (await res.json()) as { items?: CalendarEvent[]; nextPageToken?: string };
    events.push(...(body.items ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return events;
}

/**
 * Local calendar date of an event as YYYY-MM-DD.
 * `dateTime` carries its own UTC offset, so slicing keeps the date the user sees.
 */
export function eventDate(event: CalendarEvent): string | null {
  const raw = event.start?.dateTime || event.start?.date;
  return raw ? raw.slice(0, 10) : null;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

/** Every calendar the account can read — used to populate the rule's calendar picker. */
export async function listCalendars(): Promise<CalendarSummary[]> {
  const token = await getAccessToken();
  const calendars: CalendarSummary[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      minAccessRole: 'reader',
      maxResults: '250',
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`${CALENDAR_API}/users/me/calendarList?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      resetTokenCache();
      throw new CalendarError('Google rejected the access token (401)');
    }
    if (!res.ok) throw new CalendarError(`Google calendarList failed (${res.status}): ${await res.text()}`);

    const body = (await res.json()) as { items?: CalendarSummary[]; nextPageToken?: string };
    calendars.push(...(body.items ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  // Primary first, then alphabetical — the primary calendar is the common choice.
  return calendars.sort((a, b) =>
    Number(Boolean(b.primary)) - Number(Boolean(a.primary)) ||
    (a.summary || '').localeCompare(b.summary || '')
  );
}

// ---------- a quote's event: a link, not a write ----------

/** What a quote's event is made of. */
export interface EventInput {
  summary: string;
  description?: string;
  location?: string | null;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, Israel time. Without a start the event is all-day. */
  startTime?: string | null;
  endTime?: string | null;
  attendees: string[];
}

const TIME_ZONE = 'Asia/Jerusalem';

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Two hours on from a start time, which is about a show: the end Google insists on when none was given. */
const twoHoursAfter = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + 120;
  const day = total >= 24 * 60 ? nextDay(date) : date;
  const t = total % (24 * 60);
  return { date: day, time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` };
};

const compact = (date: string, time?: string) =>
  date.replace(/-/g, '') + (time ? `T${time.replace(':', '')}00` : '');

/**
 * Google Calendar's own «new event» page, filled in: title, date and time, place, description
 * and guests. Nothing is written by the app — the person saves it in Google, and Google asks
 * there whether to email the guests. So the app's Google token only ever needs to read.
 *
 * `calendarId`, when it is an account's own address, opens the page in that account
 * (authuser), which is the calendar the sync reads.
 */
export function eventTemplateUrl(input: EventInput, calendarId?: string | null): string {
  let dates: string;
  if (input.startTime) {
    const end = input.endTime
      ? { date: input.endTime > input.startTime ? input.date : nextDay(input.date), time: input.endTime }
      : twoHoursAfter(input.date, input.startTime);
    dates = `${compact(input.date, input.startTime)}/${compact(end.date, end.time)}`;
  } else {
    dates = `${compact(input.date)}/${compact(nextDay(input.date))}`;
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', text: input.summary, dates, ctz: TIME_ZONE });
  if (input.description) params.set('details', input.description);
  if (input.location) params.set('location', input.location);
  if (input.attendees.length) params.set('add', input.attendees.join(','));
  if (calendarId && /^[^@\s]+@[^@\s]+$/.test(calendarId) && !/calendar\.google\.com$/i.test(calendarId)) {
    params.set('authuser', calendarId);
  }
  return `https://calendar.google.com/calendar/render?${params}`;
}

export async function getEventById(calendarId: string, eventId: string): Promise<CalendarEvent> {
  const token = await getAccessToken();
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    if (res.status === 401) resetTokenCache();
    if (res.status === 404 || res.status === 410) throw new CalendarError('האירוע לא נמצא ביומן — אולי נמחק', 404);
    throw new CalendarError(`Google Calendar get failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as CalendarEvent;
}

/** Cheap connectivity probe — refreshes the token without reading any events. */
export async function ping(): Promise<boolean> {
  await getAccessToken();
  return true;
}
