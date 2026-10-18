/**
 * פיקסל ומעקב מכירות — whether the band's campaigns can know who bought a ticket.
 *
 * Tickets are sold on the club's site, not the band's, so Meta only learns of a purchase if the
 * club's ticketing system carries the band's pixel. Without it every campaign optimises for clicks
 * and the books are the only count of tickets, weeks late. With it, a campaign can optimise for
 * purchases and show the last-week push to the people who opened the ticket page and did not buy.
 *
 * Three things are kept apart here:
 *  - **the pixel itself**, read from Meta (`fetchPixels`, `fetchPixelStats`) and kept as a
 *    snapshot so the advisor's context can carry it without a network call;
 *  - **what each club said** (`venue_pixel`): asked, installed, declined, and who to ask;
 *  - **whether it actually fires on the club's site**, which is not anyone's word — it is the
 *    pixel's own per-site counts, matched against the host of the show's ticket page.
 *
 * And the request to the club: an email, composed here and sent from the owner's own mailbox, like
 * every other message to somebody outside the band (see `mailer.ts`).
 */
import { db, getBandName, getSetting, setSetting } from './db.js';
import { AgentError } from './agentClient.js';
import { fetchPixelStats, fetchPixels, isMetaConfigured, type MetaPixel } from './metaClient.js';
import { eventLabel } from './band.js';
import { addDays, israelDate } from './campaignTasks.js';

export const PIXEL_STATUSES = ['none', 'requested', 'installed', 'declined'] as const;
export type PixelStatus = (typeof PIXEL_STATUSES)[number];

/** The window the pixel's counts are read over — long enough for a show's whole run-up. */
export const STATS_DAYS = 28;
/** A pixel with this many purchases a week has enough signal to optimise a campaign for them. */
export const PURCHASES_PER_WEEK_TO_OPTIMISE = 30;
/** More pixels than this on one band account is a mistake to clean up, not a list to read. */
const MAX_PIXELS = 3;

const SNAPSHOT_KEY = 'meta_pixel_snapshot';

export interface PixelReading extends MetaPixel {
  /** Events received in the window, by name — PageView, ViewContent, InitiateCheckout, Purchase… */
  events: Record<string, number>;
  /** Events received in the window, by the site they fired on. */
  hosts: Record<string, number>;
  stats_error?: string;
}

export interface PixelSnapshot {
  read_at: string;
  days: number;
  pixels: PixelReading[];
}

/** Reads the account's pixels and what they received, and keeps the result for the advisor. */
export async function refreshPixelSnapshot(): Promise<PixelSnapshot> {
  const since = new Date(Date.now() - STATS_DAYS * 86_400_000);
  const pixels = (await fetchPixels()).slice(0, MAX_PIXELS);
  const readings: PixelReading[] = [];
  for (const pixel of pixels) {
    try {
      const [events, hosts] = await Promise.all([
        fetchPixelStats(pixel.id, 'event', since),
        fetchPixelStats(pixel.id, 'host', since),
      ]);
      readings.push({ ...pixel, events, hosts });
    } catch (err: any) {
      // A pixel whose counts cannot be read is still a pixel that exists, which is half the answer.
      readings.push({ ...pixel, events: {}, hosts: {}, stats_error: String(err?.message || err).slice(0, 200) });
    }
  }
  const snapshot: PixelSnapshot = { read_at: new Date().toISOString(), days: STATS_DAYS, pixels: readings };
  setSetting(SNAPSHOT_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export function pixelSnapshot(): PixelSnapshot | null {
  try {
    const raw = getSetting(SNAPSHOT_KEY, '');
    return raw ? (JSON.parse(raw) as PixelSnapshot) : null;
  } catch {
    return null;
  }
}

/** The pixel the clubs are asked to install: the one that fired most recently, else the first. */
export function mainPixel(snapshot = pixelSnapshot()): PixelReading | null {
  const usable = (snapshot?.pixels ?? []).filter((p) => !p.is_unavailable);
  if (!usable.length) return null;
  return [...usable].sort((a, b) => String(b.last_fired_time ?? '').localeCompare(String(a.last_fired_time ?? '')))[0];
}

/** A site's host without `www.`, which is how the pixel's per-site counts name it. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * How many events the pixel received on a site — the ticket page's host, or any sub-domain of it
 * (`tickets.club.co.il` for `club.co.il`), or the other way round when the ticketing system sits on
 * the club's sub-domain.
 */
export function firingOn(pixel: PixelReading | null, host: string | null): number {
  if (!pixel || !host) return 0;
  let total = 0;
  for (const [site, count] of Object.entries(pixel.hosts ?? {})) {
    const h = site.toLowerCase().replace(/^www\./, '');
    if (h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`)) total += count;
  }
  return total;
}

// ---------------------------------------------------------------- per club

export interface VenuePixel {
  venue: string;
  status: PixelStatus;
  contact_email: string | null;
  platform: string | null;
  note: string | null;
  requested_at: string | null;
  venue_site: string | null;
  shows: Array<{ event_id: string; label: string; date: string; ticket_url: string | null }>;
  /** The sites the pixel would have to fire on: each show's ticket page and the club's own site. */
  hosts: string[];
  /** Events the pixel received on those sites in the window. Null when the pixel was never read. */
  events_on_site: number | null;
  /** The pixel fires on the club's ticket site — the only status that is not somebody's word. */
  verified: boolean;
}

function venueRow(venue: string) {
  return db.prepare('SELECT * FROM venue_pixel WHERE venue = ?').get(venue) as
    | { venue: string; status: PixelStatus; contact_email: string | null; platform: string | null; note: string | null; requested_at: string | null }
    | undefined;
}

/**
 * Every club with a show coming up (or a pixel status already recorded), with what it said and
 * whether the pixel fires on its site. Upcoming means from yesterday on, so the night after a show
 * still shows where it stood.
 */
export function venuePixels(snapshot = pixelSnapshot()): VenuePixel[] {
  const pixel = mainPixel(snapshot);
  const shows = db
    .prepare(
      `SELECT id, venue, date, ticket_url FROM band_events
       WHERE date >= ? OR venue IN (SELECT venue FROM venue_pixel WHERE status != 'none')
       ORDER BY date`
    )
    .all(addDays(israelDate(), -1)) as Array<{ id: string; venue: string; date: string; ticket_url: string | null }>;

  const byVenue = new Map<string, typeof shows>();
  for (const show of shows) {
    if (!show.venue?.trim()) continue;
    byVenue.set(show.venue, [...(byVenue.get(show.venue) ?? []), show]);
  }
  const today = israelDate();
  return [...byVenue].map(([venue, list]) => {
    const row = venueRow(venue);
    const site = (db.prepare('SELECT url FROM venue_websites WHERE venue = ?').get(venue) as { url: string } | undefined)?.url ?? null;
    // Past shows only matter for a club whose status is recorded; their pages may still say so.
    const upcoming = list.filter((s) => s.date >= addDays(today, -1));
    const relevant = upcoming.length ? upcoming : list.slice(-1);
    const hosts = [...new Set([...relevant.map((s) => hostOf(s.ticket_url)), hostOf(site)].filter((h): h is string => !!h))];
    const events = snapshot ? hosts.reduce((sum, h) => sum + firingOn(pixel, h), 0) : null;
    return {
      venue,
      status: row?.status ?? 'none',
      contact_email: row?.contact_email ?? null,
      platform: row?.platform ?? null,
      note: row?.note ?? null,
      requested_at: row?.requested_at ?? null,
      venue_site: site,
      shows: relevant.map((s) => ({ event_id: s.id, label: eventLabel(s.venue, s.date), date: s.date, ticket_url: s.ticket_url })),
      hosts,
      events_on_site: events,
      verified: (events ?? 0) > 0,
    };
  });
}

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** What the owner recorded about a club. A field left out is left alone; an empty one clears it. */
export function setVenuePixel(
  venue: string,
  patch: { status?: unknown; contact_email?: unknown; platform?: unknown; note?: unknown }
): VenuePixel | undefined {
  const name = String(venue ?? '').trim();
  if (!name) throw new AgentError('חסר שם המקום', 400);
  const current = venueRow(name);
  const next = {
    status: current?.status ?? 'none',
    contact_email: current?.contact_email ?? null,
    platform: current?.platform ?? null,
    note: current?.note ?? null,
    requested_at: current?.requested_at ?? null,
  };
  if (patch.status !== undefined) {
    if (!PIXEL_STATUSES.includes(patch.status as PixelStatus)) throw new AgentError('מצב פיקסל לא מוכר', 400);
    next.status = patch.status as PixelStatus;
    if (next.status === 'requested' && current?.status !== 'requested') next.requested_at = new Date().toISOString();
  }
  if (patch.contact_email !== undefined) {
    const email = String(patch.contact_email ?? '').trim();
    if (email && (email.length > 200 || !EMAIL.test(email))) throw new AgentError(`«${email}» אינה כתובת מייל תקינה`, 400);
    next.contact_email = email || null;
  }
  const short = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;
  if (patch.platform !== undefined) next.platform = short(patch.platform, 100);
  if (patch.note !== undefined) next.note = short(patch.note, 1000);

  db.prepare(
    `INSERT INTO venue_pixel (venue, status, contact_email, platform, note, requested_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(venue) DO UPDATE SET status = excluded.status, contact_email = excluded.contact_email,
       platform = excluded.platform, note = excluded.note, requested_at = excluded.requested_at,
       updated_at = datetime('now')`
  ).run(name, next.status, next.contact_email, next.platform, next.note, next.requested_at);
  return venuePixels().find((v) => v.venue === name);
}

/** The panel's whole read: the pixel as last seen, and every club. Reads Meta afresh if asked. */
export async function pixelOverview(options: { refresh?: boolean } = {}) {
  let snapshot = pixelSnapshot();
  let error: string | null = null;
  if (options.refresh && isMetaConfigured()) {
    try {
      snapshot = await refreshPixelSnapshot();
    } catch (err: any) {
      error = String(err?.message || err);
    }
  }
  return {
    meta_configured: isMetaConfigured(),
    snapshot,
    pixel: mainPixel(snapshot),
    venues: venuePixels(snapshot),
    error,
  };
}

// ---------------------------------------------------------------- for the advisor

/**
 * What the advisor is told about tracking: the pixel and its counts, and for every club with a
 * show coming up, whether the pixel fires on its ticket site. Read from the snapshot — the context
 * is built without network calls, and `read_at` says how old it is.
 */
export function trackingContext() {
  const snapshot = pixelSnapshot();
  const pixel = mainPixel(snapshot);
  return {
    read_at: snapshot?.read_at ?? null,
    days: snapshot?.days ?? STATS_DAYS,
    pixel: pixel
      ? { id: pixel.id, name: pixel.name, last_fired_time: pixel.last_fired_time, events: pixel.events, sites: pixel.hosts }
      : null,
    other_pixels: (snapshot?.pixels ?? []).filter((p) => p.id !== pixel?.id).map((p) => ({ id: p.id, name: p.name })),
    venues: venuePixels(snapshot).map((v) => ({
      venue: v.venue,
      club_status: v.status,
      platform: v.platform,
      fires_on_ticket_site: snapshot ? v.verified : null,
      events_on_site: v.events_on_site,
      event_ids: v.shows.map((s) => s.event_id),
    })),
  };
}

// ---------------------------------------------------------------- the request to the club

const ddmm = (date: string) => {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
};

/**
 * The email asking a club to put the band's pixel on its ticket pages, ready to open in the owner's
 * mail app and edit there. Written for the person at the club who runs ticketing, not for a
 * developer: what to paste where, the four events if they set it up by hand, what the club gets out
 * of it, and what the band does *not* get — the club's customers stay the club's.
 */
export function pixelEmail(venue: string): { to: string | null; subject: string; body: string; pixel_id: string | null; warnings: string[] } {
  const club = venuePixels().find((v) => v.venue === venue);
  if (!club) throw new AgentError('אין הופעה קרובה במקום הזה', 404);
  const band = getBandName();
  const pixel = mainPixel();
  const warnings: string[] = [];
  if (!pixel) warnings.push('אין עדיין פיקסל בחשבון המודעות. צרו אותו קודם, או הדביקו את המספר במקום המסומן.');
  if (!club.contact_email) warnings.push('אין כתובת מייל של המועדון. הוסיפו אותה בשורה של המקום, או כתבו אותה בחלון המייל.');

  const shows = club.shows.filter((s) => s.date >= israelDate());
  const dates = (shows.length ? shows : club.shows).map((s) => ddmm(s.date));
  const pages = [...new Set(club.shows.map((s) => s.ticket_url).filter((u): u is string => !!u))];

  // Written the way a band member would write it: plain, short, no headings or bullets, and only
  // ordinary hyphens. The technical part is one paragraph a ticketing person can act on.
  const body = [
    'היי,',
    '',
    `כאן ${band}. אנחנו מופיעים אצלכם ב-${dates.join(' וב-')} ומריצים לזה פרסום בפייסבוק ובאינסטגרם.`,
    '',
    'רצינו לבקש משהו קטן: אפשר להוסיף את הפיקסל שלנו של פייסבוק לעמוד של ההופעה ולתהליך הרכישה?',
    `המספר של הפיקסל (Pixel ID): ${pixel?.id ?? '[מספר הפיקסל]'}`,
    ...(pages.length ? [`העמוד של ההופעה: ${pages.join(' , ')}`] : []),
    '',
    club.platform
      ? `אם אתם עובדים עם ${club.platform}, אמור להיות בהגדרות האירוע שדה של "Facebook Pixel" או "Meta Pixel", ומספיק להדביק שם את המספר.`
      : 'בדרך כלל במערכת הכרטיסים יש בהגדרות האירוע שדה של "Facebook Pixel" או "Meta Pixel", ומספיק להדביק שם את המספר.',
    'אם אצלכם זה עובר דרך Google Tag Manager או קוד באתר, חוץ מהקוד הבסיסי בכל העמודים (PageView) הכי חשוב לנו: צפייה בעמוד ההופעה (ViewContent), התחלת רכישה (InitiateCheckout), ורכישה (Purchase) בעמוד האישור עם הסכום והמטבע.',
    '',
    'ככה הפרסום שלנו יגיע יותר לאנשים שבאמת קונים כרטיסים, ונוכל להזכיר את ההופעה למי שנכנס לעמוד ולא סיים לקנות. בסוף זה יותר כרטיסים שנמכרים אצלכם.',
    'ורק שיהיה ברור, אנחנו לא מקבלים שום פרטים של הלקוחות שלכם. בפייסבוק רואים רק מספרים כלליים, כמה נכנסו וכמה קנו.',
    '',
    'אם יותר נוח לכם לחבר אותנו לפיקסל שלכם דרך ה-Business Manager, גם זה מעולה.',
    'תעדכנו אותנו כשזה בפנים ונבדוק שזה עובד. ואם יש שאלות, אפשר גם להרים טלפון.',
    '',
    'תודה!',
    band,
  ].join('\n');

  return {
    to: club.contact_email,
    subject: `${band} - פיקסל של פייסבוק בעמוד הכרטיסים של ההופעה`,
    body,
    pixel_id: pixel?.id ?? null,
    warnings,
  };
}
