import { db, uuid, getSetting, setSetting, getDefaultCommissionPercent } from './db.js';
import { ensureCategoryColumns, expenseFields, settlingFields } from './expenseCategories.js';
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
 * The cost components of one show: every column the band's cost lines define, active or not.
 * `vat_summary` is deliberately absent: it restates the VAT inside the lines above rather than
 * adding a cost of its own.
 */
export const EXPENSE_FIELDS = (): string[] => expenseFields();

/**
 * The cost lines that are settled separately after the show, rather than the moment they are
 * typed. Exported because the show page settles them one at a time and all at once, and both
 * have to mean the same set of lines.
 *
 * A line settles either because the band says so (the category's «settles» flag) or because
 * the band hires somebody for it — a קמפיין line with a designer staffed on it is money owed to
 * a person, and a קמפיין line without one is a card payment that was over when it was made.
 */
export const PAID_EXPENSE_FIELDS = (): string[] => {
  const staffed = db
    .prepare('SELECT key FROM band_supplier_roles WHERE active = 1')
    .all() as Array<{ key: string }>;
  return [...new Set([...settlingFields(), ...staffed.map((r) => r.key)])];
};

export function expenseTotal(row: any): number {
  if (!row) return 0;
  return round2(EXPENSE_FIELDS().reduce((sum, f) => sum + (Number(row[f]) || 0), 0));
}

export function expensePaidTotal(row: any): number {
  if (!row) return 0;
  const settles = new Set(PAID_EXPENSE_FIELDS());
  return round2(
    EXPENSE_FIELDS().reduce(
      (sum, f) => (settles.has(f) && !row[`${f}_paid`] ? sum : sum + (Number(row[f]) || 0)),
      0
    )
  );
}

/**
 * How far along a show's payment is. The order is the order it moves through.
 *
 * «התקבל» and «הכסף הועבר לקופה» are two different facts about the same money, which is why
 * the second is its own station rather than a flag: the venue pays into the private account,
 * and what belongs to the band moves on from there in a separate transfer, days or weeks
 * later. Everything that used to ask whether a show had been paid means «has the money
 * arrived», so it asks `moneyReceived` rather than comparing to 'received' — a show that has
 * moved on to the fund has certainly been paid.
 */
export const PAYMENT_STATUSES = [
  'waiting_report', 'invoice_sent', 'received', 'fund_transferred',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The last station: the band's share has left the private account for the band's own. */
export const FUND_TRANSFERRED: PaymentStatus = 'fund_transferred';

/** Whether the venue's money has actually arrived, at whichever of the two stations it sits. */
export const moneyReceived = (status: unknown): boolean =>
  status === 'received' || status === FUND_TRANSFERRED;

export function normalizePaymentStatus(value: unknown): PaymentStatus | undefined {
  return PAYMENT_STATUSES.includes(value as PaymentStatus) ? (value as PaymentStatus) : undefined;
}

/**
 * Moves the recorded balance of the band's account by what a transfer put into it.
 *
 * Only the balance somebody has actually entered is touched. With none entered there is
 * nothing to move — the fund reads as computed until it is checked against the bank, and
 * inventing a balance here would turn "nobody has said" into a figure nobody stands behind.
 */
export function adjustBandFundActual(delta: number): void {
  const raw = getSetting('band_fund_actual', '');
  if (raw === '' || round2(delta) === 0) return;
  setSetting('band_fund_actual', String(round2((Number(raw) || 0) + delta)));
}

/**
 * Keeps the recorded balance in step with the shows whose money has reached the account.
 *
 * Marking a show «הכסף הועבר לקופה» is the moment the transfer happened, so the balance moves
 * by the same amount; stepping back out returns exactly what this show put in, which is what
 * makes the button safe to press by mistake. A show the migration marked put nothing in — its
 * transfer predates the step and the balance already reflects it — so it takes nothing out.
 *
 * Returns what the show should record as transferred, for the caller to store.
 */
export function settleFundTransfer(
  event: any,
  nextStatus: PaymentStatus,
  requested: unknown
): number | null {
  const was = event.payment_status === FUND_TRANSFERRED;
  const now = nextStatus === FUND_TRANSFERRED;
  const stored = event.fund_transfer_amount == null
    ? null : round2(Number(event.fund_transfer_amount) || 0);
  const asked = requested === undefined || requested === null || requested === ''
    ? null : round2(Number(requested) || 0);

  if (!now) {
    if (!was) return stored;
    if (stored !== null) adjustBandFundActual(-stored);
    return null;
  }
  // Nothing said and nothing stored: the show's income without מע"מ is what the band's books
  // already count as arriving in the fund, so it is the figure to fall back on.
  if (!was) {
    const amount = asked ?? stored ?? round2(Number(event.amount_pre_vat) || 0);
    adjustBandFundActual(amount);
    return amount;
  }
  // Already transferred: only a correction to the amount moves anything, and only by the
  // difference — the rest of it is in the balance already.
  if (asked === null || asked === stored) return stored;
  adjustBandFundActual(round2(asked - (stored ?? 0)));
  return asked;
}

/** What is still owed to the suppliers of one show. */
export function expenseOutstanding(row: any): number {
  return round2(expenseTotal(row) - expensePaidTotal(row));
}

/**
 * A member is identified by a string that is generated once and never changes, so renaming
 * somebody does not orphan the shows they played.
 */
export type MemberKey = string;

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

/**
 * Gives an empty roster its first member: the owner.
 *
 * A band usually has one person whose books these are — the one the band invoices through, and
 * the one a producer fee goes to — so that is the only member the app assumes. Everybody else
 * is added in the band's ספקים וחברים screen. A roster that already has anybody in it is left
 * exactly as it is.
 */
export function seedBandMembers() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM band_members').get() as { n: number }).n;
  if (count > 0) return;
  const owner = db
    .prepare("SELECT name, email FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1")
    .get() as { name: string; email: string } | undefined;
  if (!owner) return;
  const businessType: BusinessType = getSetting('business_type', '') === 'osek_patur' ? 'patur' : 'morshe';
  const id = uuid();
  db.prepare(
    `INSERT INTO band_members (id, member_key, name, email, is_manager, business_type, sort_order)
     VALUES (?, ?, ?, ?, 1, ?, 0)`
  ).run(id, `m_${id.slice(0, 8)}`, owner.name, owner.email, businessType);
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

/**
 * Which member is the person whose books these are — the עוסק the band invoices through.
 *
 * Matched by email against the owner's login rather than named by a constant, so it is the same
 * definition of "you" the transfer calculator uses for «החלק שלך». One rule, in one place: if
 * the app thinks a row is yours there, it is yours here too.
 *
 * Returns null when no member carries the owner's email, which is a real possibility once the
 * roster is editable — callers are expected to have a fallback rather than assume a match.
 */
export function ownerMemberKey(members: any[] = activeBandMembers()): MemberKey | null {
  const owner = db
    .prepare("SELECT email FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1")
    .get() as { email?: string } | undefined;
  const email = String(owner?.email ?? '').trim().toLowerCase();
  if (!email) return null;
  const match = members.find((m) => String(m.email ?? '').trim().toLowerCase() === email);
  return (match?.member_key as MemberKey) ?? null;
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
 * nothing else is said. A setting (Settings → כללי), 20% out of the box.
 */
export const DEFAULT_COMMISSION_PERCENT = (): number => getDefaultCommissionPercent();

/** A show's fee percentage, clamped to something a percentage can be. */
export function normalizeCommissionPercent(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_COMMISSION_PERCENT();
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
 * A band with one owner-manager and no partners is the plain case of the same rule: the fee is
 * the owner's cut, and the rest is shared equally by everybody including the owner.
 *
 * The rounding remainder lands on the member whose books these are — the owner — so the shares
 * always add up to the profit exactly. Without it the summary drifts by agorot per show, and it
 * belongs to the owner because theirs is the account the whole division has to reconcile
 * against. If no member carries the owner's email it falls to the first manager, and then to
 * the first member, so there is always somebody holding the odd agora.
 */
export function computeDivision(
  profit: number,
  hasProducerFee: boolean,
  percent: number = DEFAULT_COMMISSION_PERCENT(),
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

  // Each part is rounded once, from the profit — not by rounding the fee and then dividing it,
  // which would round twice and shift an agora. This is the arithmetic the four columns did,
  // so a show recomputed after the migration comes out to the same figures it had before.
  const feeRate = feeOn ? rate : 0;
  const perManager = feeOn ? round2((total * feeRate) / feeEarners.length) : 0;
  const even = round2((total * (1 - feeRate)) / keys.length);

  const shares: Record<MemberKey, number> = {};
  for (const key of keys) {
    shares[key] = round2(even + (feeEarners.includes(key) ? perManager : 0));
  }

  // Whatever the rounding lost or gained, given to one member so the total is exact.
  const absorber = ownerMemberKey(members) ?? feeEarners[0] ?? keys[0];
  const drift = round2(total - keys.reduce((sum, key) => sum + shares[key], 0));
  shares[absorber] = round2(shares[absorber] + drift);

  return { shares, commission_amount: round2(total * feeRate) };
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
    // The division goes with the show. Without this the share rows outlive the event they
    // belonged to and go on being counted in every per-member total.
    db.prepare('DELETE FROM band_event_shares WHERE event_id = ?').run(id);
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
export function backfillBand() {
  // Every cost line the band defined has its columns, whatever happened mid-create.
  ensureCategoryColumns();
  // Not guarded by a flag: it only ever fills an empty roster with the owner, so it costs
  // nothing on a database that already has members.
  seedBandMembers();
  pruneOrphanShares();

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

  backfillFundTransfers();

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
 * The date the band's own account caught up with its books: everything before it had already
 * been transferred by the time the step existed.
 */
const FUND_TRANSFER_BACKFILL_BEFORE = '2026-07-01';

/**
 * Marks the shows whose money had already reached the band's account before there was a step
 * to say so.
 *
 * Runs once. The balance is deliberately left alone and no amount is recorded against these
 * shows: the transfers are history, and whatever was last entered as the account's balance
 * already includes them — adding them again would double every שקל the band has ever earned.
 * Recording nothing is also what makes un-marking one of them safe, since a show that put
 * nothing into the balance takes nothing back out.
 */
export function backfillFundTransfers(): number {
  if (getSetting('moonlight_fund_transfer_v1', '') === 'done') return 0;
  const result = db
    .prepare(
      `UPDATE band_events SET payment_status = ?
       WHERE date < ? AND payment_status != ?`
    )
    .run(FUND_TRANSFERRED, FUND_TRANSFER_BACKFILL_BEFORE, FUND_TRANSFERRED);
  setSetting('moonlight_fund_transfer_v1', 'done');
  return result.changes;
}

/**
 * Drops share rows whose show no longer exists.
 *
 * An early build of the shares table deleted a show without its division, leaving rows that
 * belonged to nothing and still counted towards every per-member total. The cascade now takes
 * them, so this only ever finds something once — but it is cheap, and a stray row here is
 * silently wrong money rather than a visible error.
 */
export function pruneOrphanShares(): number {
  const result = db.prepare(
    'DELETE FROM band_event_shares WHERE event_id NOT IN (SELECT id FROM band_events)'
  ).run();
  return result.changes;
}
