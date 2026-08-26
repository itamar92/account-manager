/**
 * תיאומים לצורכי מס — the bridge between the profit the books show and the profit the return
 * is filed on.
 *
 * They are never the same number, for two unrelated reasons.
 *
 * The first is that some expenses are only partly recognised. A car costs the business what it
 * costs, and the P&L is right to show it in full, but the return lets about 45% of it through;
 * כיבודים are allowed at 80%. Morning already applies a deduction percentage to expenses it
 * has classified, and the books here already honour it — so that part of the adjustment is
 * *already reflected* in the profit and stating it again would be counting it twice. What is
 * left is the expenses Morning said nothing about, where this app's own recognition rates have
 * an opinion the profit has not yet heard.
 *
 * The second is timing, and it is `fixedAssets`' business: equipment the books expensed in
 * full comes back out and returns as depreciation.
 *
 * Both are stated as lines rather than folded silently into a number, because the whole value
 * of the reconciliation is being able to point at the difference and recognise it.
 */
import { db } from './db.js';
import { rateFor, recognitionRates } from './overview.js';
import { depreciationSchedule, type DepreciationSchedule } from './fixedAssets.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CategoryAdjustment {
  category: string;
  /** The expenses' full amount before VAT. */
  amount: number;
  /** What Morning already held back, and which the profit therefore already reflects. */
  disallowed_in_books: number;
  /** What this app's rates would further hold back on expenses Morning left unmarked. */
  further_disallowed: number;
  rate: number;
}

export interface AdjustmentsBreakdown {
  /** Per category, worst first — only categories with something to say. */
  categories: CategoryAdjustment[];
  /** Already inside the profit; shown for recognition, never added to it. */
  total_in_books: number;
  /** The real adjustment: what the app's own rates would add back on top. */
  total_further: number;
}

/**
 * What is disallowed across the year's expenses, split by whether the profit already knows.
 *
 * The two sums are deliberately kept apart. `disallowed_in_books` is derived from Morning's own
 * `deductible_amount`, which `monthlyPnl` already subtracts, so it is history. `further` is
 * computed only over rows where Morning stated no deductible amount at all — exactly the rows
 * whose full cost is still sitting in the profit.
 */
export function adjustmentsFor(year: number): AdjustmentsBreakdown {
  const rates = recognitionRates();
  const rows = db.prepare(
    `SELECT COALESCE(NULLIF(category, ''), 'ללא סיווג') AS category,
            COALESCE(SUM(amount), 0) AS amount,
            COALESCE(SUM(amount - COALESCE(deductible_amount, amount)), 0) AS disallowed,
            COALESCE(SUM(CASE WHEN deductible_amount IS NULL THEN amount ELSE 0 END), 0) AS unmarked
     FROM expenses
     WHERE date >= ? AND date <= ?
     GROUP BY 1`
  ).all(`${year}-01-01`, `${year}-12-31`) as any[];

  const categories: CategoryAdjustment[] = [];
  for (const row of rows) {
    const rate = rateFor(row.category, rates);
    const further = round2(row.unmarked * (1 - rate));
    const inBooks = round2(row.disallowed);
    if (inBooks <= 0 && further <= 0) continue;
    categories.push({
      category: row.category,
      amount: round2(row.amount),
      disallowed_in_books: inBooks,
      further_disallowed: further,
      rate,
    });
  }
  categories.sort((a, b) =>
    (b.disallowed_in_books + b.further_disallowed) - (a.disallowed_in_books + a.further_disallowed));

  return {
    categories,
    total_in_books: round2(categories.reduce((s, c) => s + c.disallowed_in_books, 0)),
    total_further: round2(categories.reduce((s, c) => s + c.further_disallowed, 0)),
  };
}

export interface ReconciliationLine {
  key: string;
  label: string;
  amount: number;
  origin: 'computed' | 'estimated';
  note?: string;
}

export interface Reconciliation {
  /** What the books say, before any of this. */
  book_profit: number;
  lines: ReconciliationLine[];
  /** רווח מותאם — what the return is filed on. */
  adjusted_profit: number;
  adjustments: AdjustmentsBreakdown;
  depreciation: DepreciationSchedule;
  /** Whether the app's own recognition rates were applied on top of Morning's. */
  applied_rates: boolean;
}

/**
 * Book profit → רווח מותאם, one visible step at a time.
 *
 * Equipment goes out and comes back as depreciation; part-recognised expenses are added back.
 * The order is the accountant's: the timing difference first, then the disallowances.
 */
export function reconcile(year: number, bookProfit: number, applyRates: boolean): Reconciliation {
  const depreciation = depreciationSchedule(year);
  const adjustments = adjustmentsFor(year);
  const lines: ReconciliationLine[] = [];

  if (depreciation.additions_in_books > 0) {
    lines.push({
      key: 'additions',
      label: 'רכישות רכוש קבוע שנזקפו כהוצאה',
      amount: depreciation.additions_in_books,
      origin: 'computed',
      note: 'הספרים ניכו אותן במלואן; הדוח מהוון אותן ומפחית לאורך חיי הנכס',
    });
  }
  if (depreciation.total_claimed > 0) {
    lines.push({
      key: 'depreciation',
      label: 'פחת לשנת המס',
      amount: -depreciation.total_claimed,
      origin: 'computed',
      note: `לפי לוח הפחת — ${depreciation.rows.length} נכסים, יתרה להפחתה ${Math.round(depreciation.total_book_value).toLocaleString('he-IL')} ₪`,
    });
  }
  if (applyRates && adjustments.total_further > 0) {
    lines.push({
      key: 'disallowed',
      label: 'הוצאות שאינן מוכרות במלואן',
      amount: adjustments.total_further,
      origin: 'estimated',
      note: 'לפי אחוזי ההכרה שבהגדרות, על הוצאות ש-Morning לא סימן להן שיעור הכרה',
    });
  }

  return {
    book_profit: round2(bookProfit),
    lines,
    adjusted_profit: round2(bookProfit + lines.reduce((s, l) => s + l.amount, 0)),
    adjustments,
    depreciation,
    applied_rates: applyRates,
  };
}
