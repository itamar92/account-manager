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
export const EXPENSE_FIELDS = [
  'campaign', 'refreshments', 'design', 'other', 'expense_amount',
  'akom', 'hall_fee', 'sound_company', 'bracelets', 'lightman', 'soundman', 'singer',
] as const;

/**
 * The components that carry their own paid flag; the rest are settled when they are entered.
 * Exported because the show page settles them one at a time and all at once, and both have to
 * mean the same set of lines.
 */
export const PAID_EXPENSE_FIELDS = [
  'akom', 'hall_fee', 'sound_company', 'bracelets', 'lightman', 'soundman', 'singer',
] as const;

const PAID_FLAGGED = new Set<string>(PAID_EXPENSE_FIELDS);

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
export const SEED_MEMBERS = [
  { key: 'amir', name: 'אמיר' },
  { key: 'itamar', name: 'איתמר' },
  { key: 'yuval', name: 'יובל' },
  { key: 'guy', name: 'גיא' },
] as const;

/**
 * A member is identified by a string that is generated once and never changes, so renaming
 * somebody does not orphan the shows they played. It used to be a union of the four column
 * names on band_events, which is exactly what made the band uncountable-by-design.
 */
export type MemberKey = string;

/**
 * What each member's row starts as, the first time the table is filled.
 *
 * The two managers are אמיר and איתמר, which is not an arbitrary label: the producer fee is
 * split between exactly those two, and that is what makes the band's default 30/30/20/20 the
 * shape it is. איתמר is the עוסק מורשה the band invoices through — everyone else is an עוסק
 * פטור, so their invoices are a deductible cost with no מע"מ inside to reclaim.
 */
const MEMBER_DEFAULTS: Record<string, {
  email: string; is_manager: number; business_type: BusinessType;
}> = {
  amir: { email: 'amir@moonlight.band', is_manager: 1, business_type: 'patur' },
  itamar: { email: 'itamar92@gmail.com', is_manager: 1, business_type: 'morshe' },
  yuval: { email: 'yuval@moonlight.band', is_manager: 0, business_type: 'patur' },
  guy: { email: 'guy@moonlight.band', is_manager: 0, business_type: 'patur' },
};

/**
 * What kind of business a member runs, which is the whole reason this is recorded: it decides
 * what their share costs the band once they invoice for it.
 */
export type BusinessType = 'patur' | 'morshe' | 'none';

export const BUSINESS_TYPES: Array<{ value: BusinessType; label: string }> = [
  { value: 'morshe', label: 'עוסק מורשה' },
  { value: 'patur', label: 'עוסק פטור' },
  { value: 'none', label: 'לא רשום' },
];

/** Creates any member row that does not exist yet, leaving the ones that do exactly as they are. */
export function seedBandMembers() {
  const insert = db.prepare(
    `INSERT INTO band_members (id, member_key, name, email, is_manager, business_type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(member_key) DO NOTHING`
  );
  db.transaction(() => {
    SEED_MEMBERS.forEach((m, i) => {
      const d = MEMBER_DEFAULTS[m.key];
      insert.run(uuid(), m.key, m.name, d.email, d.is_manager, d.business_type, i);
    });
  })();
}

/** The band as it is recorded, in display order. */
export function listBandMembers(): any[] {
  return db.prepare(
    'SELECT * FROM band_members ORDER BY sort_order, name'
  ).all() as any[];
}

/** A member's row by key, or undefined. */
export function bandMemberByKey(key: string): any {
  return db.prepare('SELECT * FROM band_members WHERE member_key = ?').get(key);
}

/** Only the members currently in the band — the ones a new show's profit is divided between. */
export function activeBandMembers(): any[] {
  return listBandMembers().filter((m) => m.active);
}

/** The band's own float — an expense it paid is one everybody shares. */
export const FUND_PAYER = 'קופה';

/**
 * Which member a `paid_by` names, or null when it names the fund or nobody recognisable.
 * Reads the roster rather than a constant, so a member added today can front an expense today.
 * Inactive members still resolve: they are gone from the band, not from its history.
 */
export function memberByName(name: unknown): MemberKey | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  return (listBandMembers().find((m) => m.name === trimmed)?.member_key as MemberKey) ?? null;
}

export interface Division {
  /** Amount per member key. Every active member appears, even at zero. */
  shares: Record<MemberKey, number>;
  commission_amount: number;
}

/**
 * The producer fee a show takes off the top by default, as a percentage of its profit, when
 * nothing else is said. 20% nets 30/30/20/20 — the split the band settled on.
 */
export const DEFAULT_COMMISSION_PERCENT = 20;

/** A show's fee percentage, clamped to something a percentage can be. */
export function normalizeCommissionPercent(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_COMMISSION_PERCENT;
  return Math.min(100, Math.max(0, round2(percent)));
}

/**
 * Splits a show's profit between the members who were in the band.
 *
 * With the producer fee on, `percent` of the profit is the fee and is shared equally by the
 * managers; the rest is shared equally by everybody. The percentage is the *whole* fee, so for
 * a band of four with two managers 20% nets 30/30/20/20 and 40% nets 35/35/15/15 — it is per
 * show, because what the fee is worth is a decision about that show. With the fee off it is an
 * equal share each.
 *
 * That reads as the same rule the band already had, because it is: the old code hard-coded
 * "half the fee each to איתמר and אמיר, the rest in quarters", which is this rule with two
 * managers out of four members written out longhand.
 *
 * The rounding remainder lands on the first manager — the first member if the band has named
 * none — so the shares always add up to the profit exactly. Without it the summary drifts by
 * agorot per show. It used to land on איתמר, so a recomputed show can move a single agora
 * between the two managers; nothing that was already stored is touched.
 */
export function computeDivision(
  profit: number,
  hasProducerFee: boolean,
  percent: number = DEFAULT_COMMISSION_PERCENT,
  members: any[] = activeBandMembers()
): Division {
  const total = round2(Number(profit) || 0);
  const rate = normalizeCommissionPercent(percent) / 100;
  const keys: MemberKey[] = members.map((m) => m.member_key);
  if (keys.length === 0) return { shares: {}, commission_amount: 0 };

  const managers = members.filter((m) => m.is_manager).map((m) => m.member_key);
  // A fee with nobody to pay it to is not a fee: it would vanish from the division entirely,
  // so it is folded back into the equal share instead.
  const feeEarners = managers.length > 0 ? managers : [];
  const feeOn = hasProducerFee && rate > 0 && feeEarners.length > 0;

  const fee = feeOn ? round2(total * rate) : 0;
  const perManager = feeOn ? round2(fee / feeEarners.length) : 0;
  const even = round2((total - fee) / keys.length);

  const shares: Record<MemberKey, number> = {};
  for (const key of keys) {
    shares[key] = round2(even + (feeEarners.includes(key) ? perManager : 0));
  }

  // Whatever the rounding lost or gained, given to one member so the total is exact.
  const absorber = feeEarners[0] ?? keys[0];
  const drift = round2(total - keys.reduce((sum, key) => sum + shares[key], 0));
  shares[absorber] = round2(shares[absorber] + drift);

  return { shares, commission_amount: fee };
}

/** What each member took from one show, as a plain object. Absent members read as zero. */
export function eventShares(eventId: string): Record<MemberKey, number> {
  const rows = db
    .prepare('SELECT member_key, amount FROM band_event_shares WHERE event_id = ?')
    .all(eventId) as Array<{ member_key: string; amount: number }>;
  return Object.fromEntries(rows.map((r) => [r.member_key, round2(Number(r.amount) || 0)]));
}

/** Replaces a show's division outright, so a member removed from it does not linger at zero. */
export const setEventShares = db.transaction((eventId: string, shares: Record<string, unknown>) => {
  db.prepare('DELETE FROM band_event_shares WHERE event_id = ?').run(eventId);
  const insert = db.prepare(
    'INSERT INTO band_event_shares (event_id, member_key, amount) VALUES (?, ?, ?)'
  );
  for (const [key, value] of Object.entries(shares)) {
    insert.run(eventId, key, round2(Number(value) || 0));
  }
});

/** What the sum of a show's shares comes to — the figure a manual division is checked against. */
export function eventSharesTotal(eventId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM band_event_shares WHERE event_id = ?')
    .get(eventId) as { total: number };
  return round2(Number(row.total) || 0);
}

/**
 * A show with its division attached, which is the shape every API response uses. The division
 * is its own table now, so an event row on its own no longer says who got what.
 */
export function withShares(event: any): any {
  return event ? { ...event, shares: eventShares(event.id) } : event;
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
  if (!expenseRow) return withShares(event);

  const expenses = expenseTotal(expenseRow);
  const expensesPaid = expensePaidTotal(expenseRow);
  const profit = round2((Number(event.amount_pre_vat) || 0) - expenses);

  db.prepare('UPDATE band_event_expenses SET total_paid = ? WHERE id = ?').run(expensesPaid, expenseRow.id);

  if (event.division_mode === 'manual') {
    db.prepare('UPDATE band_events SET expenses = ?, expenses_paid = ?, profit = ? WHERE id = ?')
      .run(expenses, expensesPaid, profit, eventId);
  } else {
    const d = computeDivision(profit, !!event.has_commission, event.commission_percent);
    db.prepare(
      'UPDATE band_events SET expenses = ?, expenses_paid = ?, profit = ?, commission_amount = ? WHERE id = ?'
    ).run(expenses, expensesPaid, profit, d.commission_amount, eventId);
    setEventShares(eventId, d.shares);
  }
  return withShares(getEvent(eventId));
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
    // Its Meta campaign mappings go with it. Deleted here as plain rows rather than through
    // metaSync, which imports this module — and the campaigns themselves are untouched: the
    // spend was real, it just no longer has a show to belong to, and the next sync will list
    // them as unmapped for re-attribution.
    db.prepare('DELETE FROM meta_campaign_events WHERE event_id = ?').run(id);
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
  // Not guarded by a flag: it only ever inserts a member row that is missing, so it costs
  // nothing on a database that already has them and fills one that predates the table.
  seedBandMembers();
  backfillEventShares();

  const firstRun = getSetting('moonlight_backfill_v1', '') !== 'done';
  const commissionDone = getSetting('moonlight_commission_percent_v1', '') === 'done';
  const campaignLocksDone = getSetting('moonlight_campaign_lock_v1', '') === 'done';

  // Every קמפיין figure that predates the Meta integration was typed by a person, so it is
  // marked as such once: the sync claims a row only where nobody has said what the ad spend
  // was, and would otherwise rewrite settled shows the first time one is mapped to a campaign.
  // The same reasoning as the division_mode backfill below — existing numbers are history, not
  // a blank to be filled. Unticking the lock in the UI is how a row is handed to the sync.
  if (!campaignLocksDone) {
    db.prepare('UPDATE band_event_expenses SET campaign_locked = 1 WHERE campaign > 0').run();
    setSetting('moonlight_campaign_lock_v1', 'done');
  }

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

    // The producer fee used to be a fixed 40% of the profit for every show that had one; it is
    // now per show, defaulting to the 20% that nets 30/30/20/20. A show whose profit has
    // already been handed out was divided under the old figure, so it keeps it: the boot
    // recompute below would otherwise silently re-divide money that has already changed hands,
    // and the percentage on the row would no longer explain the shares beside it. Everything
    // still open takes the new default, which is the point of changing it.
    if (!commissionDone) {
      db.prepare(
        'UPDATE band_events SET commission_percent = 40 WHERE paid_to_musicians = 1 AND has_commission = 1'
      ).run();
    }

    for (const event of events) ensureExpenseRow(event, true);
  })();

  // Outside the transaction above: each recompute opens its own.
  for (const event of db.prepare('SELECT * FROM band_events').all() as any[]) recomputeEvent(event.id);

  if (firstRun) setSetting('moonlight_backfill_v1', 'done');
  if (!commissionDone) setSetting('moonlight_commission_percent_v1', 'done');
}


/**
 * Moves every show's division out of the four columns it used to live in and into rows.
 *
 * Run once, and only for shows that have no rows yet, so it can neither run twice nor tread on
 * a division entered since. The amounts are copied across exactly rather than recomputed:
 * a settled show's division is history, and a show taken over by hand would be silently
 * rewritten by a recompute. What was stored is what is kept.
 *
 * The columns it reads are left on band_events afterwards. See the note in db.ts — they are
 * frozen rather than dropped, so there is a way back if a division ever looks wrong.
 */
export function backfillEventShares() {
  if (getSetting('moonlight_shares_v1', '') === 'done') return;
  const legacyKeys = SEED_MEMBERS.map((m) => m.key);
  db.transaction(() => {
    const events = db.prepare('SELECT * FROM band_events').all() as any[];
    const has = db.prepare('SELECT COUNT(*) AS n FROM band_event_shares WHERE event_id = ?');
    for (const event of events) {
      if ((has.get(event.id) as { n: number }).n > 0) continue;
      const shares = Object.fromEntries(
        legacyKeys.map((key) => [key, round2(Number(event[key]) || 0)])
      );
      setEventShares(event.id, shares);
    }
    setSetting('moonlight_shares_v1', 'done');
  })();
}
