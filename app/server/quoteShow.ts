import { db } from './db.js';
import { ensureExpenseRow, getEvent, recomputeEvent } from './moonlight.js';
import { QuoteError } from './quotes.js';
import { isOptionTitle } from './quoteOption.js';

/**
 * A signed quote and the show it is for — see docs/QUOTES-DESIGN.md, «Signing and the show».
 *
 * Shows come from the calendar and from nowhere else; nothing here creates one. A quote reaches
 * its show through its own «אופציה» event (server/quoteCalendar.ts), which the calendar sync turns
 * into a show like any other, or through a show already on the date.
 *
 * Shows are the owner's to write everywhere else in the app. The one write here is the system's,
 * on the client's signature, and a narrow one: the quote's price goes into a show that has no
 * amount yet. A figure somebody typed is never overwritten; a disagreement is a follow-up.
 */

/** Below this, a difference between the quote and the show is rounding, not a disagreement. */
const AMOUNT_TOLERANCE = 1;

export { OPTION_PREFIX, isOptionTitle, withoutOption } from './quoteOption.js';

export type ShowLinkStatus = 'linked' | 'choose' | 'no_show' | 'error';

function quoteRow(id: string): any {
  const row = db.prepare('SELECT * FROM band_quotes WHERE id = ?').get(id) as any;
  if (!row) throw new QuoteError(404, 'ההצעה לא נמצאה');
  return row;
}

/**
 * A show another live quote already stands behind — linked to it, or made from its event — is
 * that client's, not this one's. On a busy date the other show is somebody else's option.
 */
const claimedByAnother = (show: any, quoteId: string) =>
  !!db.prepare(
    `SELECT 1 FROM band_quotes WHERE id != ? AND is_template = 0 AND status != 'cancelled'
       AND (show_id = ? OR (calendar_event_id IS NOT NULL AND calendar_event_id = ?))`
  ).get(quoteId, show.id, show.calendar_event_id ?? '');

/**
 * Writes the quote's price into a show, and the show's profit and shares after it — the same
 * two steps as saving a show by hand, expense row first, since recomputeEvent leaves a show
 * without one alone.
 */
function writeAmounts(showId: string, quote: any) {
  db.prepare('UPDATE band_events SET amount_pre_vat = ?, amount_with_vat = ? WHERE id = ?')
    .run(quote.net_amount, quote.total, showId);
  ensureExpenseRow(getEvent(showId));
  recomputeEvent(showId);
}

/** The quote's amounts, into a show that has none yet. A show with a figure keeps it. */
function fillAmounts(show: any, quote: any) {
  if (Number(show.amount_pre_vat) || Number(show.amount_with_vat)) return;
  writeAmounts(show.id, quote);
}

function setLink(quoteId: string, showId: string | null, status: ShowLinkStatus | null) {
  db.prepare('UPDATE band_quotes SET show_id = ?, show_link_status = ?, show_amount_ok = 0 WHERE id = ?')
    .run(showId, status, quoteId);
}

/** The show the quote's own calendar event became, once the sync has made it. */
const showOfEvent = (quote: any) =>
  quote.calendar_event_id
    ? db.prepare('SELECT * FROM band_events WHERE calendar_event_id = ?').get(quote.calendar_event_id) as any
    : null;

/**
 * What a signature does to the books.
 *
 * 1. The quote's show — linked by hand, or made from its own calendar event — gets the quote's
 *    price if it has none.
 * 2. Otherwise the shows on the event's date that no other quote stands behind: one is the show;
 *    several, and the band is asked which; none, and the quote waits for its show to come from
 *    the calendar.
 */
export function linkSignedQuote(quoteId: string): ShowLinkStatus {
  return db.transaction((): ShowLinkStatus => {
    const quote = quoteRow(quoteId);
    if (quote.status !== 'signed') throw new QuoteError(409, 'רק הצעה חתומה משויכת כך להופעה');

    const own = (quote.show_id ? getEvent(quote.show_id) : null) ?? showOfEvent(quote);
    if (own) {
      fillAmounts(own, quote);
      setLink(quote.id, own.id, 'linked');
      return 'linked';
    }

    const free = (db.prepare('SELECT * FROM band_events WHERE date = ? ORDER BY created_at').all(quote.event_date) as any[])
      .filter((show) => !claimedByAnother(show, quote.id));
    if (free.length === 1) {
      fillAmounts(free[0], quote);
      setLink(quote.id, free[0].id, 'linked');
      return 'linked';
    }
    const status: ShowLinkStatus = free.length ? 'choose' : 'no_show';
    setLink(quote.id, null, status);
    return status;
  })();
}

/**
 * Runs once the signature is committed, and never fails it: a client who signed has signed,
 * whatever the bookkeeping makes of it. Anything that goes wrong here is logged and left on the
 * quote as a follow-up, which a person finishes from the editor.
 */
export function afterSigning(quoteId: string) {
  try {
    linkSignedQuote(quoteId);
  } catch (err) {
    console.error('[quotes] a signed quote could not be linked to a show', quoteId, err);
    try { db.prepare("UPDATE band_quotes SET show_link_status = 'error' WHERE id = ?").run(quoteId); } catch { /* logged above */ }
  }
}

/**
 * Points each quote with no show at the show its calendar event became. Run after every sync,
 * full or of one event: the show is the sync's to make, and this only follows it. A quote the
 * band already pointed at a show by hand keeps that. A signed quote takes the steps its
 * signature would have, so a show that arrives after the signature still gets the price.
 */
export function linkQuotesByCalendar() {
  const rows = db.prepare(
    `SELECT q.id, q.status, e.id AS event_id FROM band_quotes q
     JOIN band_events e ON e.calendar_event_id = q.calendar_event_id
     WHERE q.is_template = 0 AND q.status != 'cancelled' AND q.calendar_event_id IS NOT NULL
       AND q.show_id IS NULL`
  ).all() as Array<{ id: string; status: string; event_id: string }>;
  for (const row of rows) {
    if (row.status === 'signed') afterSigning(row.id);
    else db.prepare('UPDATE band_quotes SET show_id = ? WHERE id = ?').run(row.event_id, row.id);
  }
}

// ---------- the band's side ----------

export interface ShowCandidate {
  id: string;
  venue: string;
  date: string;
  location: string | null;
  amount_pre_vat: number;
  amount_with_vat: number;
  /** The quote already behind this show, if any. */
  taken_by: string | null;
}

/** The shows on a date, for the editor's «יש הופעה בתאריך הזה — לשייך?». */
export function showsOnDate(date: string, quoteId?: string): ShowCandidate[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return db.prepare(
    `SELECT e.id, e.venue, e.date, e.location, e.amount_pre_vat, e.amount_with_vat,
       (SELECT COALESCE(q.quote_number, q.client_name) FROM band_quotes q
        WHERE q.id != ? AND q.is_template = 0 AND q.status != 'cancelled'
          AND (q.show_id = e.id OR (q.calendar_event_id IS NOT NULL AND q.calendar_event_id = e.calendar_event_id))
        LIMIT 1) AS taken_by
     FROM band_events e WHERE e.date = ? ORDER BY e.created_at`
  ).all(quoteId ?? '', date) as ShowCandidate[];
}

/**
 * The band says which show a quote is for. Before signing it is only a pointer, so the signature
 * lands on the right show; nothing is written to the show. On a signed quote it is the step
 * signing could not take on its own, so the price follows exactly as it would have. A signed
 * quote can move to another show but is never left with none.
 */
export function linkQuoteToShow(quoteId: string, target: string | null) {
  const quote = quoteRow(quoteId);
  if (quote.is_template) throw new QuoteError(400, 'תבנית לא משייכים להופעה');
  if (quote.status === 'cancelled') throw new QuoteError(409, 'ההצעה בוטלה');
  const signed = quote.status === 'signed';

  db.transaction(() => {
    if (!target) {
      if (signed) throw new QuoteError(409, 'הצעה חתומה צריכה הופעה — בחרו הופעה אחרת במקום לבטל את השיוך');
      setLink(quote.id, null, null);
      return;
    }
    const show = getEvent(target);
    if (!show) throw new QuoteError(404, 'ההופעה לא נמצאה');
    if (claimedByAnother(show, quote.id)) throw new QuoteError(409, 'ההופעה הזו כבר משויכת להצעה אחרת');
    if (signed) fillAmounts(show, quote);
    setLink(quote.id, show.id, signed ? 'linked' : null);
  })();
}

/**
 * A signed quote and its show disagree on the price. Either the show takes the quote's figure —
 * a write to the show, so the router keeps it to the owner — or the show's figure stands, which
 * is a decision about the quote and anybody in the band can make it.
 */
export function settleShowAmount(quoteId: string, use: 'quote' | 'show') {
  const quote = quoteRow(quoteId);
  if (quote.status !== 'signed' || !quote.show_id) throw new QuoteError(400, 'אין כאן סכום להשוות');
  db.transaction(() => {
    if (use === 'quote') writeAmounts(quote.show_id, quote);
    db.prepare('UPDATE band_quotes SET show_amount_ok = 1 WHERE id = ?').run(quote.id);
  })();
}

/** The band has seen the signature; it stops being news. */
export function markSignedSeen(quoteId: string) {
  db.prepare("UPDATE band_quotes SET signed_seen_at = datetime('now') WHERE id = ? AND status = 'signed' AND signed_seen_at IS NULL")
    .run(quoteId);
}

/** Whether a signed quote and its show disagree on the price before VAT. */
export const amountsDisagree = (quoteNet: number, showPre: number) =>
  Math.abs((Number(quoteNet) || 0) - (Number(showPre) || 0)) > AMOUNT_TOLERANCE;

/**
 * What a signature can leave for a person: news that it happened, a quote with no show, a show
 * whose price is not the one the client signed, and a calendar event still marked «אופציה».
 * Worked out from the rows each time rather than stored, so a fix made anywhere clears it.
 */
export function quoteFollowUps() {
  const signed = db.prepare(
    `SELECT q.id, q.quote_number, q.client_name, q.event_date, q.net_amount, q.total, q.signed_at,
       q.signer_name, q.signed_seen_at, q.show_id, q.show_link_status, q.show_amount_ok,
       q.calendar_event_id, q.calendar_event_title,
       e.venue AS show_venue, e.amount_pre_vat AS show_amount_pre_vat
     FROM band_quotes q LEFT JOIN band_events e ON e.id = q.show_id
     WHERE q.is_template = 0 AND q.status = 'signed'
     ORDER BY q.signed_at DESC`
  ).all() as any[];
  const brief = (q: any) => ({
    id: q.id, quote_number: q.quote_number, client_name: q.client_name, event_date: q.event_date,
    total: q.total, net_amount: q.net_amount, signed_at: q.signed_at, signer_name: q.signer_name,
    show_id: q.show_id, show_venue: q.show_venue, show_link_status: q.show_link_status,
    has_calendar_event: !!q.calendar_event_id,
  });
  return {
    newlySigned: signed.filter((q) => !q.signed_seen_at).map(brief),
    needsShow: signed.filter((q) => !q.show_id).map(brief),
    amountMismatch: signed
      .filter((q) => q.show_id && !q.show_amount_ok && amountsDisagree(q.net_amount, q.show_amount_pre_vat))
      .map((q) => ({ ...brief(q), show_amount_pre_vat: q.show_amount_pre_vat })),
    stillOption: signed
      .filter((q) => q.calendar_event_id && isOptionTitle(q.calendar_event_title))
      .map((q) => ({ ...brief(q), calendar_event_title: q.calendar_event_title })),
  };
}
