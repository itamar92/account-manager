import { db, uuid, getSetting, setSetting } from './db.js';
import { setOverride } from './calendarRules.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The label an expense row carries, and the only place the format is decided:
 * "גריי תל אביב - 12/08/2026". It is derived from the show, never typed, so the two
 * tables can never drift apart.
 */
export function eventLabel(venue: string, date: string): string {
  const [y, m, d] = String(date || '').split('-');
  return y && m && d ? `${venue} - ${d}/${m}/${y}` : venue;
}

/** The reverse, for adopting rows written before the link column existed. */
export function parseEventLabel(label: string): { venue: string; date: string } | null {
  // Anchored on the date, so a venue containing " - " still parses.
  const m = /^(.*) - (\d{2})\/(\d{2})\/(\d{4})$/.exec(String(label || '').trim());
  return m ? { venue: m[1].trim(), date: `${m[4]}-${m[3]}-${m[2]}` } : null;
}

const normalizeName = (value: string | null | undefined): string =>
  (value || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The cost components of one show. `vat_summary` is deliberately absent: it restates the VAT
 * inside the lines above rather than adding a cost of its own.
 */
const EXPENSE_FIELDS = [
  'campaign', 'refreshments', 'design', 'other', 'expense_amount',
  'akom', 'hall_fee', 'sound_company', 'bracelets', 'lightman', 'soundman', 'singer',
] as const;

/** The components that carry their own paid flag; the rest are settled when they are entered. */
const PAID_FLAGGED = new Set([
  'akom', 'hall_fee', 'sound_company', 'bracelets', 'lightman', 'soundman', 'singer',
]);

export function expenseTotal(row: any): number {
  if (!row) return 0;
  return round2(EXPENSE_FIELDS.reduce((sum, f) => sum + (Number(row[f]) || 0), 0));
}

export function expensePaidTotal(row: any): number {
  if (!row) return 0;
  return round2(
    EXPENSE_FIELDS.reduce(
      (sum, f) => (PAID_FLAGGED.has(f) && !row[`${f}_paid`] ? sum : sum + (Number(row[f]) || 0)),
      0
    )
  );
}

/** How far along a show's payment is. The order is the order it moves through. */
export const PAYMENT_STATUSES = ['waiting_report', 'invoice_sent', 'received'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function normalizePaymentStatus(value: unknown): PaymentStatus | undefined {
  return PAYMENT_STATUSES.includes(value as PaymentStatus) ? (value as PaymentStatus) : undefined;
}

/** What is still owed to the suppliers of one show. */
export function expenseOutstanding(row: any): number {
  return round2(expenseTotal(row) - expensePaidTotal(row));
}

/**
 * The band, and the names the tables record them under.
 *
 * `paid_by` on a general expense holds one of these names or the fund's, which is how a cost
 * a member covered out of their own pocket is told from one the band's own float paid for —
 * the two are settled in opposite directions when the money is divided up.
 */
export const BAND_MEMBERS = [
  { key: 'amir', name: 'אמיר' },
  { key: 'itamar', name: 'איתמר' },
  { key: 'yuval', name: 'יובל' },
  { key: 'guy', name: 'גיא' },
] as const;

export type MemberKey = (typeof BAND_MEMBERS)[number]['key'];

/** The band's own float — an expense it paid is one everybody shares. */
export const FUND_PAYER = 'קופה';

/** Which member a `paid_by` names, or null when it names the fund or nobody recognisable. */
export function memberByName(name: unknown): MemberKey | null {
  const trimmed = String(name ?? '').trim();
  return BAND_MEMBERS.find((m) => m.name === trimmed)?.key ?? null;
}

export interface Division { amir: number; itamar: number; yuval: number; guy: number; commission_amount: number }

/**
 * Splits a show's profit four ways.
 *
 * With the producer fee on, the first 40% is the fee — 20% to איתמר and 20% to אמיר — and the
 * remaining 60% is shared equally by all four, which nets 35/35/15/15. With it off it is a
 * plain quarter each. The rounding remainder lands on איתמר so the four shares always add up
 * to the profit exactly; without that the summary drifts by agorot per show.
 */
export function computeDivision(profit: number, hasProducerFee: boolean): Division {
  const total = round2(Number(profit) || 0);
  if (hasProducerFee) {
    const fee = round2(total * 0.2);
    const even = round2((total * 0.6) / 4);
    const amir = round2(fee + even);
    const yuval = even;
    const guy = even;
    return {
      amir,
      itamar: round2(total - amir - yuval - guy),
      yuval,
      guy,
      commission_amount: round2(total * 0.4),
    };
  }
  const even = round2(total / 4);
  return {
    amir: even,
    itamar: round2(total - even * 3),
    yuval: even,
    guy: even,
    commission_amount: 0,
  };
}

export function getEvent(id: string): any {
  return db.prepare('SELECT * FROM band_events WHERE id = ?').get(id);
}

export function expenseRowForEvent(eventId: string): any {
  return db.prepare('SELECT * FROM band_event_expenses WHERE event_id = ?').get(eventId);
}

/**
 * Every show owns exactly one expense row, created empty so there is always somewhere to type.
 *
 * `carryLegacyExpenses` is for the migration only: a show that already carried a lump-sum
 * `expenses` figure but has no row to explain it would otherwise be recomputed down to zero,
 * so the lump sum moves into the row as a single "other expense" line to be broken up later.
 */
export function ensureExpenseRow(event: any, carryLegacyExpenses = false): any {
  if (!event) return undefined;
  const existing = expenseRowForEvent(event.id);
  if (existing) return existing;
  const id = uuid();
  const legacy = carryLegacyExpenses ? round2(Number(event.expenses) || 0) : 0;
  db.prepare('INSERT INTO band_event_expenses (id, event, event_id, expense_amount) VALUES (?, ?, ?, ?)')
    .run(id, eventLabel(event.venue, event.date), event.id, legacy);
  return db.prepare('SELECT * FROM band_event_expenses WHERE id = ?').get(id);
}

/** Keeps the expense label following the show after a rename or a date change. */
export function syncExpenseLabel(event: any) {
  if (!event) return;
  db.prepare('UPDATE band_event_expenses SET event = ? WHERE event_id = ?')
    .run(eventLabel(event.venue, event.date), event.id);
}

/**
 * The one place a show's derived numbers are written: expenses come from its expense row,
 * profit is income minus those expenses, and the member shares follow the profit unless
 * someone has taken the division over by hand.
 *
 * A show with no expense row is left untouched — its stored `expenses` is bookkeeping from
 * before the two tables were linked, and zeroing it would destroy history.
 */
export const recomputeEvent = db.transaction((eventId: string) => {
  const event = getEvent(eventId);
  if (!event) return undefined;
  const expenseRow = expenseRowForEvent(eventId);
  if (!expenseRow) return event;

  const expenses = expenseTotal(expenseRow);
  const expensesPaid = expensePaidTotal(expenseRow);
  const profit = round2((Number(event.amount_pre_vat) || 0) - expenses);

  db.prepare('UPDATE band_event_expenses SET total_paid = ? WHERE id = ?').run(expensesPaid, expenseRow.id);

  if (event.division_mode === 'manual') {
    db.prepare('UPDATE band_events SET expenses = ?, expenses_paid = ?, profit = ? WHERE id = ?')
      .run(expenses, expensesPaid, profit, eventId);
  } else {
    const d = computeDivision(profit, !!event.has_commission);
    db.prepare(
      `UPDATE band_events SET expenses = ?, expenses_paid = ?, profit = ?,
         amir = ?, itamar = ?, yuval = ?, guy = ?, commission_amount = ?
       WHERE id = ?`
    ).run(expenses, expensesPaid, profit, d.amir, d.itamar, d.yuval, d.guy, d.commission_amount, eventId);
  }
  return getEvent(eventId);
});

/**
 * Points an existing expense row at a different show, or at none.
 *
 * Rows written before the two tables were linked name their show in prose, and the migration
 * only adopts the ones it can match beyond doubt — this is how the rest get attached by hand.
 * The costs already typed into the row are what moves; the label is rewritten from the show it
 * lands on, since the show owns the name.
 *
 * The show it leaves is given a fresh empty row rather than keeping the numbers that walked
 * away, so both shows' totals are right afterwards.
 */
export const reassignExpenseRow = db.transaction((expenseId: string, eventId: string | null) => {
  const row = db.prepare('SELECT * FROM band_event_expenses WHERE id = ?').get(expenseId) as any;
  if (!row) throw Object.assign(new Error('expense row not found'), { status: 404 });

  const target = eventId ? getEvent(eventId) : undefined;
  if (eventId && !target) throw Object.assign(new Error('event not found'), { status: 400 });
  if (target && target.id === row.event_id) return row;

  // One row per show. The empty row every show is created with carries nothing, so it gives
  // way; a row with costs already typed into it does not, since that would hide real numbers.
  if (target) {
    const occupant = expenseRowForEvent(target.id);
    if (occupant && occupant.id !== expenseId) {
      if (expenseTotal(occupant) > 0) {
        throw Object.assign(
          new Error(`ל«${eventLabel(target.venue, target.date)}» כבר יש שורת הוצאות עם סכומים — רוקנו אותה קודם`),
          { status: 409 }
        );
      }
      db.prepare('DELETE FROM band_event_expenses WHERE id = ?').run(occupant.id);
    }
  }

  const previousId: string | null = row.event_id;
  db.prepare('UPDATE band_event_expenses SET event_id = ?, event = ? WHERE id = ?')
    .run(target?.id ?? null, target ? eventLabel(target.venue, target.date) : row.event, expenseId);

  if (previousId && previousId !== target?.id) {
    ensureExpenseRow(getEvent(previousId));
    recomputeEvent(previousId);
  }
  if (target) recomputeEvent(target.id);
  return db.prepare('SELECT * FROM band_event_expenses WHERE id = ?').get(expenseId);
});

/**
 * Removes an expense row.
 *
 * What that means depends on what the row is. A row belonging to a show cannot simply vanish —
 * every show owns exactly one, and the income tab has nowhere to write its costs without it —
 * so its numbers are cleared and an empty row takes its place, which is what "delete" means for
 * a line you only want emptied. A row belonging to no show is a leftover from before the two
 * tables were linked, and that one goes for good.
 */
export const deleteExpenseRow = db.transaction(
  (id: string): { deleted: number; cleared: number } => {
    const row = db.prepare('SELECT * FROM band_event_expenses WHERE id = ?').get(id) as any;
    if (!row) throw Object.assign(new Error('expense row not found'), { status: 404 });

    db.prepare('DELETE FROM band_event_expenses WHERE id = ?').run(id);
    if (!row.event_id) return { deleted: 1, cleared: 0 };

    ensureExpenseRow(getEvent(row.event_id));
    recomputeEvent(row.event_id);
    return { deleted: 0, cleared: 1 };
  }
);

/**
 * Removes a show together with the expense row it owns. A show drawn from the calendar is
 * also pinned as "not a show" by default, otherwise the next sync simply brings it back.
 */
export const deleteEventCascade = db.transaction(
  (id: string, excludeFromCalendar: boolean): { deleted: number; excluded: number } => {
    const event = getEvent(id);
    if (!event) return { deleted: 0, excluded: 0 };
    let excluded = 0;
    if (excludeFromCalendar && event.calendar_event_id) {
      setOverride({
        event_id: event.calendar_event_id,
        action: 'exclude',
        summary: event.venue,
        event_date: event.date,
      });
      excluded = 1;
    }
    db.prepare('DELETE FROM band_event_expenses WHERE event_id = ?').run(id);
    db.prepare('DELETE FROM band_events WHERE id = ?').run(id);
    return { deleted: 1, excluded };
  }
);

/**
 * Brings a database written before shows and expense rows were linked up to date.
 *
 * The parts that must happen once — deciding which existing divisions count as hand-made —
 * are behind a flag, because a second run would read the numbers it wrote itself. Creating
 * missing expense rows is idempotent and runs on every boot, which is what picks up shows
 * added by a calendar sync in an older version.
 */
export function backfillMoonlight() {
  const firstRun = getSetting('moonlight_backfill_v1', '') !== 'done';

  db.transaction(() => {
    // Adopt the free-text labels as real links, where they are unambiguous.
    const unlinked = db
      .prepare('SELECT * FROM band_event_expenses WHERE event_id IS NULL')
      .all() as any[];
    for (const row of unlinked) {
      const parsed = parseEventLabel(row.event);
      if (!parsed) continue;
      const sameDate = db.prepare('SELECT * FROM band_events WHERE date = ?').all(parsed.date) as any[];
      const matches = sameDate.filter((e) => normalizeName(e.venue) === normalizeName(parsed.venue));
      // Zero matches means the row describes a show that was never entered; more than one
      // means the label cannot say which. Both are left unlinked for a human to look at.
      if (matches.length !== 1) continue;
      if (expenseRowForEvent(matches[0].id)) continue;
      db.prepare('UPDATE band_event_expenses SET event_id = ?, event = ? WHERE id = ?')
        .run(matches[0].id, eventLabel(matches[0].venue, matches[0].date), row.id);
    }

    const events = db.prepare('SELECT * FROM band_events').all() as any[];

    if (firstRun) {
      // Shares that are already filled in were split by an older, different rule. Recomputing
      // them would silently rewrite settled history, so they are marked as hand-made.
      const markManual = db.prepare("UPDATE band_events SET division_mode = 'manual' WHERE id = ?");
      for (const e of events) {
        if (Number(e.amir) || Number(e.itamar) || Number(e.yuval) || Number(e.guy)) markManual.run(e.id);
      }
      db.prepare(
        `UPDATE band_general_expenses SET paid = 1
         WHERE amir_returned = 'כן' OR itamar_returned = 'כן' OR yuval_returned = 'כן' OR fund_returned = 'כן'`
      ).run();

      // The general-expense "שיוך להופעה" was free text too.
      const generalRows = db
        .prepare("SELECT * FROM band_general_expenses WHERE event_id IS NULL AND event IS NOT NULL AND event != 'כללי'")
        .all() as any[];
      for (const row of generalRows) {
        const parsed = parseEventLabel(row.event);
        const candidates = parsed
          ? (db.prepare('SELECT * FROM band_events WHERE date = ?').all(parsed.date) as any[])
              .filter((e) => normalizeName(e.venue) === normalizeName(parsed.venue))
          : (db.prepare('SELECT * FROM band_events').all() as any[])
              .filter((e) => normalizeName(e.venue) === normalizeName(row.event));
        if (candidates.length !== 1) continue;
        db.prepare('UPDATE band_general_expenses SET event_id = ?, event = ? WHERE id = ?')
          .run(candidates[0].id, eventLabel(candidates[0].venue, candidates[0].date), row.id);
      }
    }

    for (const event of events) ensureExpenseRow(event, true);
  })();

  // Outside the transaction above: each recompute opens its own.
  for (const event of db.prepare('SELECT * FROM band_events').all() as any[]) recomputeEvent(event.id);

  if (firstRun) setSetting('moonlight_backfill_v1', 'done');
}
