/**
 * Google Calendar read client.
 *
 * Uses an OAuth2 refresh token so the server can read the calendar unattended:
 * `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Read-only —
 * the app never writes to the calendar.
 */

// Overridable so the sync can be pointed at a stub during testing, the same way
// GREEN_INVOICE_BASE_URL points the Morning client at the sandbox.
const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const CALENDAR_API = process.env.GOOGLE_CALENDAR_API_URL || 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
  id: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string };
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

/** Cheap connectivity probe — refreshes the token without reading any events. */
export async function ping(): Promise<boolean> {
  await getAccessToken();
  return true;
}
