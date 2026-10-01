/**
 * Google Calendar client.
 *
 * Uses an OAuth2 refresh token so the server can reach the calendar unattended:
 * `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
 *
 * Mostly it reads: the sync draws shows and works out of what is already there. The one write
 * is a price quote's «אופציה» event (server/quoteCalendar.ts), created and later renamed on the
 * band's calendar — and that needs the token to carry the `calendar.events` scope as well as
 * read access. A token issued read-only is answered with a message saying exactly that.
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

// ---------- writing: a quote's event ----------

/** What a quote's event is made of, before it is Google's shape. */
export interface EventInput {
  summary: string;
  description?: string;
  location?: string | null;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, Israel time. Without a start the event is all-day. */
  startTime?: string | null;
  endTime?: string | null;
  /** An email, or a guest as Google returned it so their answer (accepted, declined) survives. */
  attendees: Array<string | CalendarAttendee>;
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

export function toGoogleEvent(input: EventInput): Record<string, unknown> {
  const when = input.startTime
    ? (() => {
        const end = input.endTime
          ? { date: input.endTime > input.startTime ? input.date : nextDay(input.date), time: input.endTime }
          : twoHoursAfter(input.date, input.startTime);
        return {
          start: { dateTime: `${input.date}T${input.startTime}:00`, timeZone: TIME_ZONE },
          end: { dateTime: `${end.date}T${end.time}:00`, timeZone: TIME_ZONE },
        };
      })()
    : { start: { date: input.date }, end: { date: nextDay(input.date) } };
  return {
    summary: input.summary,
    // Left out when not given, so an update does not wipe a description written in Google.
    ...(input.description !== undefined ? { description: input.description } : {}),
    location: input.location ?? '',
    ...when,
    attendees: input.attendees.map((a) => (typeof a === 'string' ? { email: a } : a)),
  };
}

/** A failed write, said in the words of what to do about it. */
async function writeError(res: Response, action: string): Promise<CalendarError> {
  const text = await res.text();
  if (res.status === 401) resetTokenCache();
  if (res.status === 403 && /insufficient|scope|PERMISSION/i.test(text)) {
    return new CalendarError(
      'לחשבון Google שמחובר לאפליקציה יש הרשאת קריאה בלבד ליומן. כדי ליצור ולעדכן אירועים צריך לחבר אותו מחדש עם הרשאת calendar.events — ההוראות ב־deploy/README.md.',
      403
    );
  }
  if (res.status === 404 || res.status === 410) return new CalendarError('האירוע לא נמצא ביומן — אולי נמחק', 404);
  return new CalendarError(`Google Calendar ${action} failed (${res.status}): ${text}`);
}

/**
 * Creates the event and has Google email the invitation to every guest (sendUpdates=all):
 * the band and the suppliers chosen hear about the date from their own calendars.
 */
export async function insertEvent(calendarId: string, input: EventInput): Promise<CalendarEvent> {
  const token = await getAccessToken();
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toGoogleEvent(input)),
    }
  );
  if (!res.ok) throw await writeError(res, 'insert');
  return (await res.json()) as CalendarEvent;
}

export async function getEventById(calendarId: string, eventId: string): Promise<CalendarEvent> {
  const token = await getAccessToken();
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw await writeError(res, 'get');
  return (await res.json()) as CalendarEvent;
}

/** Rewrites the event as given, and tells the guests — a new guest gets the invitation then. */
export async function patchEvent(calendarId: string, eventId: string, input: EventInput): Promise<CalendarEvent> {
  const token = await getAccessToken();
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toGoogleEvent(input)),
    }
  );
  if (!res.ok) throw await writeError(res, 'update');
  return (await res.json()) as CalendarEvent;
}

/** Cheap connectivity probe — refreshes the token without reading any events. */
export async function ping(): Promise<boolean> {
  await getAccessToken();
  return true;
}
