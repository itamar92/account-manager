import { db } from './db.js';

/**
 * Private shows — a wedding, a company evening, a birthday: booked and paid for by one client,
 * not sold to the public. They sell no tickets, run no campaign and report nothing to אקו"ם, so
 * nothing in the app should ask for those on them.
 *
 * Whether a show is private is worked out, until somebody says otherwise:
 *  - a quote stands behind it (linked to it, or the show was made from the quote's own calendar
 *    event) — a quote is how a private booking is sold; or
 *  - its calendar event says «פרטי» / «פרטית» in the title or the description.
 * Setting it by hand (`private_locked`) is a decision the detection never undoes.
 */

/** Hebrew letters, for telling a whole word from part of one. */
const HEB = '\\u0590-\\u05FF';

/**
 * «פרטי», «פרטית», «פרטיים», «פרטיות», with the prefixes Hebrew glues on («הפרטי», «לאירוע פרטי»
 * is two words anyway) — but not «פרטים» (details), which a description says all the time.
 */
const PRIVATE_WORD = new RegExp(
  `(^|[^${HEB}])[ובהלמשכ]{0,2}פרטי(ת|ים|ות)?(?![${HEB}])|\\bprivate\\b`, 'i'
);

export const looksPrivate = (...texts: Array<string | null | undefined>) =>
  texts.some((t) => !!t && PRIVATE_WORD.test(t));

/**
 * The supplier roles and cost lines a private show does without: no אקו"ם report, no wristbands
 * at a door nobody sells tickets at, no campaign. They are neither required nor nagged about.
 */
export const PRIVATE_SKIPPED_LINES = ['akom', 'bracelets', 'campaign'] as const;

export const skippedOnPrivate = (key: string) => (PRIVATE_SKIPPED_LINES as readonly string[]).includes(key);

/** Whether a live quote stands behind the show. */
function hasQuote(show: { id: string; calendar_event_id?: string | null }) {
  return !!db.prepare(
    `SELECT 1 FROM band_quotes WHERE is_template = 0 AND status != 'cancelled'
       AND (show_id = ? OR (calendar_event_id IS NOT NULL AND calendar_event_id = ?)) LIMIT 1`
  ).get(show.id, show.calendar_event_id ?? '');
}

/** What the detection says about a show, ignoring any decision made by hand. */
export function detectedPrivate(show: any): boolean {
  return !!show.calendar_private || looksPrivate(show.venue) || hasQuote(show);
}

/** Re-runs the detection on one show, unless its privacy was set by hand. */
export function refreshPrivate(showId: string | null | undefined) {
  if (!showId) return;
  const show = db.prepare('SELECT * FROM band_events WHERE id = ?').get(showId) as any;
  if (!show || show.private_locked) return;
  const next = detectedPrivate(show) ? 1 : 0;
  if (next !== (show.is_private ? 1 : 0)) {
    db.prepare('UPDATE band_events SET is_private = ? WHERE id = ?').run(next, show.id);
  }
}

/** The detection on every show not set by hand — on boot, and after a full calendar sync. */
export function refreshAllPrivate() {
  const ids = db.prepare('SELECT id FROM band_events WHERE private_locked = 0').all() as Array<{ id: string }>;
  db.transaction(() => ids.forEach(({ id }) => refreshPrivate(id)))();
}

/**
 * The owner says it: private (true), not private (false), or back to the detection (null).
 */
export function setPrivate(showId: string, value: boolean | null) {
  if (value === null) {
    db.prepare('UPDATE band_events SET private_locked = 0 WHERE id = ?').run(showId);
    refreshPrivate(showId);
    return;
  }
  db.prepare('UPDATE band_events SET is_private = ?, private_locked = 1 WHERE id = ?').run(value ? 1 : 0, showId);
}

/** SQL for "this show is not private", for the queries that only make sense on public ones. */
export const PUBLIC_SHOW_SQL = (alias = 'e') => `COALESCE(${alias}.is_private, 0) = 0`;
