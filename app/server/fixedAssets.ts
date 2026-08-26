/**
 * רכוש קבוע ופחת — the schedule behind טופס 1342.
 *
 * The books and the return disagree about equipment, and they are both right. A Mac mini
 * bought in February is one expense document, and Morning reports it as one expense in
 * February, which is correct for מע"מ: the input VAT on it is reclaimed in that period, in
 * full. The income-tax return does something else entirely — it capitalises the purchase and
 * writes it off over its useful life, 33% a year here, pro-rated in the year it was bought.
 *
 * So the same ₪9,742 is a deduction of ₪9,742 in one report and ₪2,741 in the other, and the
 * difference is not an error in either: it is timing. This module keeps the tax side of it,
 * and the annual report states the gap as a reconciliation line rather than quietly picking
 * one of the two.
 *
 * Depreciation is computed forward from an opening balance rather than from first principles,
 * because a real schedule rarely matches a clean formula — an asset can sit unclaimed for a
 * year, or be entered mid-life when a business changes accountants. Seed the opening figure
 * from the last 1342 and every year after it follows exactly.
 */
import { db, uuid } from './db.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface FixedAsset {
  id: string;
  name: string;
  /** קבוצה on the 1342 — מיחשוב, ריהוט וציוד, and so on. Free text; it only groups. */
  asset_group: string;
  purchase_date: string;
  cost: number;
  /** The annual rate as a share of one: 0.33 for מיחשוב, 0.15 for a phone, 0.07 for a transmitter. */
  rate: number;
  /** פחת שנצבר as it stood at the end of `opening_year`. Everything after is computed. */
  opening_accumulated: number;
  opening_year: number | null;
  /**
   * Whether the purchase went through the books as an expense in full. It decides whether the
   * reconciliation has to add it back — an asset bought before this app existed, or paid for
   * privately, never reached the P&L and must not be.
   */
  deducted_in_books: boolean;
  /** Sold, scrapped or otherwise gone. Depreciation stops on the day. */
  disposed_date: string | null;
  /** The Morning expense this asset came from, where it is known. */
  expense_id: string | null;
  notes: string;
}

/**
 * Depreciation in a part year is counted on a 30/360 basis — twelve thirty-day months — which
 * is the convention the שומה is drawn on. It is not a rounding choice: it is what turns a 33%
 * asset bought on 24 February into the 28.1% actually claimed for it, where counting real days
 * gives 28.12% and a schedule that disagrees with the accountant's by a shekel a line.
 */
const DAYS_IN_YEAR = 360;

/** Position of a date within a 30/360 year: 1 January is day 1, 31 December is day 360. */
function dayIndex(date: Date): number {
  return (date.getUTCMonth()) * 30 + Math.min(date.getUTCDate(), 30);
}

const parseDate = (value: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The share of a full year's depreciation an asset earns in one tax year.
 *
 * A whole year for an asset held throughout; a part year in the year it was bought and in the
 * year it left.
 */
function yearFraction(asset: FixedAsset, year: number): number {
  const bought = parseDate(asset.purchase_date);
  if (!bought) return 0;
  const boughtYear = bought.getUTCFullYear();
  if (year < boughtYear) return 0;

  const disposed = parseDate(asset.disposed_date);
  const disposedYear = disposed ? disposed.getUTCFullYear() : null;
  if (disposedYear !== null && year > disposedYear) return 0;

  // Day 1 is 1 January unless the asset was bought during the year; the last day is 31
  // December unless it left during it. Both ends count — an asset bought on the 24th was
  // held on the 24th.
  const from = year === boughtYear ? dayIndex(bought) : 1;
  const to = disposedYear !== null && year === disposedYear ? dayIndex(disposed!) : DAYS_IN_YEAR;
  if (to < from) return 0;
  return Math.min(1, (to - from + 1) / DAYS_IN_YEAR);
}

export interface AssetYear {
  asset: FixedAsset;
  /** פחת שנצבר at the start of the tax year. */
  accumulated_start: number;
  /** פחת נתבע השנה. */
  claimed: number;
  /** סה"כ פחת at the end of the year. */
  accumulated_end: number;
  /** עלות מופחתת — what is still to be written off. */
  book_value: number;
  /** The effective rate claimed this year, which is below the statutory one in a part year. */
  effective_rate: number;
  /**
   * Why this year's claim is below a full year's, where it is. They are different facts and
   * reading one as the other is misleading: 'partial' is the year the asset arrived or left,
   * 'final' is an asset with less book value left than a year's depreciation would take.
   */
  short_year: 'partial' | 'final' | null;
}

/**
 * One asset's schedule for a tax year, rolled forward from its opening balance.
 *
 * Depreciation never takes an asset below zero, which is what stops a fully written-off item
 * from going on generating deductions for ever.
 */
export function assetYear(asset: FixedAsset, year: number): AssetYear {
  const bought = parseDate(asset.purchase_date);
  const boughtYear = bought ? bought.getUTCFullYear() : year;
  // Roll forward from the year after the stated opening balance, or from the purchase where
  // no opening balance was ever stated.
  const from = asset.opening_year !== null ? asset.opening_year + 1 : boughtYear;

  let accumulated = asset.opening_year !== null ? asset.opening_accumulated : 0;
  let claimed = 0;
  for (let y = from; y <= year; y++) {
    const remaining = Math.max(0, asset.cost - accumulated);
    claimed = Math.min(round2(asset.cost * asset.rate * yearFraction(asset, y)), remaining);
    if (y < year) accumulated = round2(accumulated + claimed);
  }
  // A year at or before the opening balance has nothing of its own to claim.
  if (year < from) claimed = 0;

  const accumulatedEnd = round2(accumulated + claimed);
  const fraction = yearFraction(asset, year);
  const uncapped = round2(asset.cost * asset.rate * fraction);
  // Running out takes precedence over a part year: an asset can be in its last year and its
  // first at once, and "there was nothing left to claim" is the more useful of the two.
  const shortYear = claimed > 0 && claimed < uncapped ? 'final' : fraction > 0 && fraction < 1 ? 'partial' : null;

  return {
    asset,
    accumulated_start: round2(accumulated),
    claimed: round2(claimed),
    accumulated_end: accumulatedEnd,
    book_value: round2(asset.cost - accumulatedEnd),
    effective_rate: asset.cost > 0 ? Math.round((claimed / asset.cost) * 1000) / 10 : 0,
    short_year: shortYear,
  };
}

export interface DepreciationSchedule {
  year: number;
  rows: AssetYear[];
  /** פחת נתבע for the year — the figure that comes off the profit. */
  total_claimed: number;
  /** What was bought during the year, and how much of it the books already expensed in full. */
  additions: number;
  additions_in_books: number;
  total_cost: number;
  total_book_value: number;
}

export function listAssets(): FixedAsset[] {
  return (db.prepare('SELECT * FROM fixed_assets ORDER BY asset_group, purchase_date').all() as any[])
    .map((row) => ({
      ...row,
      cost: round2(row.cost),
      rate: row.rate,
      opening_accumulated: round2(row.opening_accumulated),
      deducted_in_books: !!row.deducted_in_books,
      notes: row.notes ?? '',
    }));
}

export function depreciationSchedule(year: number, assets = listAssets()): DepreciationSchedule {
  // An asset bought after the year in question has nothing to say about it yet.
  const rows = assets
    .filter((a) => {
      const bought = parseDate(a.purchase_date);
      return bought ? bought.getUTCFullYear() <= year : false;
    })
    .map((a) => assetYear(a, year));

  const boughtThisYear = assets.filter((a) => a.purchase_date.slice(0, 4) === String(year));

  return {
    year,
    rows,
    total_claimed: round2(rows.reduce((s, r) => s + r.claimed, 0)),
    additions: round2(boughtThisYear.reduce((s, a) => s + a.cost, 0)),
    // Only what the P&L actually deducted needs adding back to it.
    additions_in_books: round2(
      boughtThisYear.filter((a) => a.deducted_in_books).reduce((s, a) => s + a.cost, 0)
    ),
    total_cost: round2(rows.reduce((s, r) => s + r.asset.cost, 0)),
    total_book_value: round2(rows.reduce((s, r) => s + r.book_value, 0)),
  };
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? round2(n) : fallback;
};

const isoDate = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

function validate(input: any): Omit<FixedAsset, 'id'> {
  const name = String(input?.name ?? '').trim();
  if (!name) throw Object.assign(new Error('שם הנכס חסר'), { status: 400 });

  const purchaseDate = isoDate(input?.purchase_date);
  if (!purchaseDate) throw Object.assign(new Error('תאריך רכישה לא תקין'), { status: 400 });

  const cost = num(input?.cost);
  if (cost <= 0) throw Object.assign(new Error('עלות הנכס חייבת להיות חיובית'), { status: 400 });

  // Accepts either a share (0.33) or a percentage (33) — both are how a rate gets typed.
  const rawRate = num(input?.rate);
  const rate = rawRate > 1 ? rawRate / 100 : rawRate;
  if (!(rate > 0 && rate <= 1)) throw Object.assign(new Error('שיעור הפחת חייב להיות בין 0 ל-100%'), { status: 400 });

  const openingYear = input?.opening_year === null || input?.opening_year === undefined || input?.opening_year === ''
    ? null
    : parseInt(String(input.opening_year), 10);
  if (openingYear !== null && (!Number.isFinite(openingYear) || openingYear < 1900 || openingYear > 2200))
    throw Object.assign(new Error('שנת יתרת הפתיחה לא תקינה'), { status: 400 });

  const opening = Math.max(0, num(input?.opening_accumulated));
  if (opening > cost)
    throw Object.assign(new Error('הפחת שנצבר לא יכול לעלות על עלות הנכס'), { status: 400 });

  const disposed = isoDate(input?.disposed_date);
  if (disposed && disposed < purchaseDate)
    throw Object.assign(new Error('תאריך הגריעה מוקדם מתאריך הרכישה'), { status: 400 });

  return {
    name,
    asset_group: String(input?.asset_group ?? '').trim(),
    purchase_date: purchaseDate,
    cost,
    rate,
    opening_accumulated: opening,
    opening_year: openingYear,
    deducted_in_books: input?.deducted_in_books === undefined ? true : !!input.deducted_in_books,
    disposed_date: disposed,
    expense_id: input?.expense_id ? String(input.expense_id) : null,
    notes: String(input?.notes ?? '').trim(),
  };
}

const COLUMNS = [
  'name', 'asset_group', 'purchase_date', 'cost', 'rate', 'opening_accumulated', 'opening_year',
  'deducted_in_books', 'disposed_date', 'expense_id', 'notes',
] as const;

const values = (a: Omit<FixedAsset, 'id'>) =>
  COLUMNS.map((c) => (c === 'deducted_in_books' ? (a.deducted_in_books ? 1 : 0) : (a as any)[c]));

export function createAsset(input: any): FixedAsset {
  const asset = validate(input);
  const id = uuid();
  db.prepare(
    `INSERT INTO fixed_assets (id, ${COLUMNS.join(', ')})
     VALUES (?, ${COLUMNS.map(() => '?').join(', ')})`
  ).run(id, ...values(asset));
  return { id, ...asset };
}

export function updateAsset(id: string, input: any): FixedAsset {
  const existing = db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id) as any;
  if (!existing) throw Object.assign(new Error('הנכס לא נמצא'), { status: 404 });
  // Merged over what is stored, so a partial edit does not blank the rest of the row.
  const asset = validate({ ...existing, deducted_in_books: !!existing.deducted_in_books, ...input });
  db.prepare(
    `UPDATE fixed_assets SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
  ).run(...values(asset), id);
  return { id, ...asset };
}

export function deleteAsset(id: string) {
  db.prepare('DELETE FROM fixed_assets WHERE id = ?').run(id);
}
