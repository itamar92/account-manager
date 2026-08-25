/**
 * The tax reports (דוחות): what each מע"מ period owes, and what the year looks like for
 * מס הכנסה.
 *
 * Nothing here is entered by hand. Both reports are computed, every time they are opened,
 * from the two tables the rest of the app already fills — the documents `morningSync` pulls
 * on the income side, and the supplier documents `morningExpenses` pulls on the outgoing one
 * — so a report can never drift away from the lists it was built from. The only thing stored
 * is the decision that a period has been filed and paid, which no other table knows.
 *
 * Everything is on an accrual basis (מצטבר), which is what an Israeli מע"מ filing reports:
 * a document belongs to the period it was issued in, whether or not the money has arrived.
 */
import { db, getSetting, uuid } from './db.js';
import { ACCOUNTING_DOC_TYPES_SQL } from './docTypes.js';
import { expensesSummary } from './morningExpenses.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// monthly profit & loss — the series behind both the dashboard chart and the reports
// ---------------------------------------------------------------------------

export interface PnlRow {
  /** 'YYYY-MM'. */
  month: string;
  /** Revenue before VAT, and the VAT charged on top of it. */
  income: number;
  incomeVat: number;
  incomeTotal: number;
  /** The same revenue split by whether the money has come in — for the income breakdown. */
  paid: number;
  open: number;
  /** Expenses before VAT, and the input VAT that may be reclaimed against it. */
  expenses: number;
  expensesVat: number;
  expensesTotal: number;
  /** Profit before VAT — the meaningful one, since neither VAT figure is the business's. */
  profit: number;
  /** Profit on the cash the business actually handled, VAT included on both sides. */
  profitTotal: number;
}

/** Every month from `from` to `to` inclusive, so a quiet month is a zero rather than a gap. */
function monthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  let year = parseInt(from.slice(0, 4), 10);
  let month = parseInt(from.slice(5, 7), 10);
  const end = to.slice(0, 7);
  // Bounded so a malformed range can never spin: 50 years is far past anything real.
  for (let guard = 0; guard < 600; guard++) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (key > end) break;
    months.push(key);
    if (++month > 12) { month = 1; year++; }
  }
  return months;
}

const emptyRow = (month: string): PnlRow => ({
  month,
  income: 0, incomeVat: 0, incomeTotal: 0, paid: 0, open: 0,
  expenses: 0, expensesVat: 0, expensesTotal: 0, profit: 0, profitTotal: 0,
});

/**
 * Which date decides the month an expense falls in.
 *
 * `document` is the date on the supplier's document — when the expense was incurred, which is
 * the year a P&L and an income-tax return belong to.
 *
 * `reporting` is `reportingDate`: the מע"מ period Morning files the expense under, which it
 * lets you set apart from the document date. A מע"מ filing has to agree with Morning about
 * which period reports which expense, or the input VAT claimed for a period is not the input
 * VAT Morning reported for it — so that report, and only that report, counts on this basis.
 * An expense with no reporting date falls back to its document date.
 */
export type ExpenseBasis = 'document' | 'reporting';

/** The column an expense's month and range are read from, per basis. */
const expenseDateSql = (basis: ExpenseBasis) =>
  basis === 'reporting' ? "COALESCE(NULLIF(reporting_date, ''), date)" : 'date';

/**
 * Income and expenses month by month over the range.
 *
 * Cancelled and draft documents are left out — a cancelled invoice was never revenue, and a
 * draft is not a document yet. Credit invoices are in, and offset, per ACCOUNTING_DOC_TYPES.
 *
 * `basis` moves the expense side between the two dates above; income is unaffected, since an
 * issued document is reported in the period it was issued in and Morning offers no second
 * date for it.
 */
export function monthlyPnl(from: string, to: string, basis: ExpenseBasis = 'document'): PnlRow[] {
  const rows = new Map(monthsInRange(from, to).map((m) => [m, emptyRow(m)]));

  const income = db.prepare(
    `SELECT substr(date, 1, 7) AS month,
            COALESCE(SUM(subtotal),0) AS income,
            COALESCE(SUM(vat_amount),0) AS income_vat,
            COALESCE(SUM(total),0) AS income_total,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END),0) AS paid,
            COALESCE(SUM(CASE WHEN status = 'issued' THEN total ELSE 0 END),0) AS open
     FROM invoices
     WHERE status IN ('paid','issued') AND doc_type IN (${ACCOUNTING_DOC_TYPES_SQL})
       AND date >= ? AND date <= ?
     GROUP BY month`
  ).all(from, to) as any[];

  // Both reports built from this are about what the books may claim, not about what left the
  // bank: the מע"מ filing reclaims deductible input VAT, and the P&L deducts the recognised
  // part of an expense. So the two figures that feed them are the deductible ones, falling
  // back to the full amounts where Morning states no deduction. `expenses_total` stays the
  // whole sum including VAT — that one is the cash figure, and the dashboard's כולל מע"מ view
  // is the one place the money actually paid out belongs.
  // The range is filtered on the same date the month is grouped by, so an expense reported in
  // a period its document date falls outside of is counted in the period that reports it —
  // counting it in one and selecting it by the other would drop it from both.
  const expenseDate = expenseDateSql(basis);
  const expenses = db.prepare(
    `SELECT substr(${expenseDate}, 1, 7) AS month,
            COALESCE(SUM(COALESCE(deductible_amount, amount)),0) AS expenses,
            COALESCE(SUM(COALESCE(deductible_vat, vat_amount)),0) AS expenses_vat,
            COALESCE(SUM(total),0) AS expenses_total
     FROM expenses WHERE ${expenseDate} >= ? AND ${expenseDate} <= ?
     GROUP BY month`
  ).all(from, to) as any[];

  for (const r of income) {
    const row = rows.get(r.month);
    if (!row) continue;
    row.income = round2(r.income);
    row.incomeVat = round2(r.income_vat);
    row.incomeTotal = round2(r.income_total);
    row.paid = round2(r.paid);
    row.open = round2(r.open);
  }
  for (const r of expenses) {
    const row = rows.get(r.month);
    if (!row) continue;
    row.expenses = round2(r.expenses);
    row.expensesVat = round2(r.expenses_vat);
    row.expensesTotal = round2(r.expenses_total);
  }
  for (const row of rows.values()) {
    row.profit = round2(row.income - row.expenses);
    row.profitTotal = round2(row.incomeTotal - row.expensesTotal);
  }

  return [...rows.values()];
}

export interface PnlTotals {
  income: number;
  incomeVat: number;
  incomeTotal: number;
  paid: number;
  open: number;
  expenses: number;
  expensesVat: number;
  expensesTotal: number;
  profit: number;
  profitTotal: number;
  /** מע"מ עסקאות פחות מע"מ תשומות — what the period owes, or is owed when negative. */
  vatDue: number;
}

export function pnlTotals(rows: PnlRow[]): PnlTotals {
  const sum = (key: keyof PnlRow) => round2(rows.reduce((acc, r) => acc + (r[key] as number), 0));
  const incomeVat = sum('incomeVat');
  const expensesVat = sum('expensesVat');
  return {
    income: sum('income'),
    incomeVat,
    incomeTotal: sum('incomeTotal'),
    paid: sum('paid'),
    open: sum('open'),
    expenses: sum('expenses'),
    expensesVat,
    expensesTotal: sum('expensesTotal'),
    profit: sum('profit'),
    profitTotal: sum('profitTotal'),
    vatDue: round2(incomeVat - expensesVat),
  };
}

// ---------------------------------------------------------------------------
// מע"מ periods
// ---------------------------------------------------------------------------

/** 'bimonthly' is the default: it is what a business under the reporting threshold files. */
export type VatFrequency = 'bimonthly' | 'monthly';

export function getVatFrequency(): VatFrequency {
  return getSetting('vat_report_frequency', 'bimonthly') === 'monthly' ? 'monthly' : 'bimonthly';
}

const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * When a period's filing is due: the 15th of the month after it ends, moved to Sunday when
 * that falls on a Saturday. Only Shabbat is handled — the Tax Authority also pushes past
 * חגים, and those move every year, so a holiday deadline is one to check against the real
 * calendar rather than one this app should claim to know.
 */
function dueDate(year: number, monthAfterPeriod: number): string {
  let y = year;
  let m = monthAfterPeriod;
  if (m > 12) { m -= 12; y++; }
  const date = new Date(Date.UTC(y, m - 1, 15));
  if (date.getUTCDay() === 6) date.setUTCDate(16);
  return date.toISOString().slice(0, 10);
}

export interface VatPeriod {
  /** '2026-P2' (bi-monthly) or '2026-03' (monthly) — the key a filing is recorded under. */
  key: string;
  label: string;
  from: string;
  to: string;
  due_date: string;
  months: string[];
}

export function vatPeriods(year: number, frequency: VatFrequency = getVatFrequency()): VatPeriod[] {
  const periods: VatPeriod[] = [];
  const step = frequency === 'monthly' ? 1 : 2;
  for (let start = 1; start <= 12; start += step) {
    const end = start + step - 1;
    periods.push({
      key: frequency === 'monthly'
        ? `${year}-${String(start).padStart(2, '0')}`
        : `${year}-P${Math.ceil(start / 2)}`,
      label: frequency === 'monthly'
        ? `${HEB_MONTHS[start - 1]} ${year}`
        : `${HEB_MONTHS[start - 1]}–${HEB_MONTHS[end - 1]} ${year}`,
      from: `${year}-${String(start).padStart(2, '0')}-01`,
      to: `${year}-${String(end).padStart(2, '0')}-${lastDay(year, end)}`,
      due_date: dueDate(year, end + 1),
      months: Array.from({ length: step }, (_, i) => `${year}-${String(start + i).padStart(2, '0')}`),
    });
  }
  return periods;
}

export interface TaxFiling {
  kind: 'vat' | 'income_tax';
  period_key: string;
  filed_at: string | null;
  paid_at: string | null;
  amount: number | null;
  reference: string | null;
  notes: string | null;
}

export function listFilings(kind: TaxFiling['kind'], year: number): Map<string, TaxFiling> {
  const rows = db
    .prepare('SELECT * FROM tax_filings WHERE kind = ? AND period_key LIKE ?')
    .all(kind, `${year}%`) as TaxFiling[];
  return new Map(rows.map((r) => [r.period_key, r]));
}

/**
 * Records what has been done with a period. Only the fields the caller sends are touched, so
 * ticking "paid" does not wipe the reference typed when it was filed.
 */
export function saveFiling(
  kind: TaxFiling['kind'],
  periodKey: string,
  input: Partial<Record<'filed' | 'paid', boolean>> & Partial<Pick<TaxFiling, 'amount' | 'reference' | 'notes'>>
): TaxFiling {
  const existing = db
    .prepare('SELECT * FROM tax_filings WHERE kind = ? AND period_key = ?')
    .get(kind, periodKey) as TaxFiling | undefined;
  const today = new Date().toISOString().slice(0, 10);

  // The tick is the fact being recorded; the date is when it was ticked. Re-ticking something
  // already on keeps the original date rather than moving it to today.
  const stamp = (flag: boolean | undefined, current: string | null | undefined) =>
    flag === undefined ? current ?? null : flag ? current ?? today : null;

  const next: TaxFiling = {
    kind,
    period_key: periodKey,
    filed_at: stamp(input.filed, existing?.filed_at),
    paid_at: stamp(input.paid, existing?.paid_at),
    amount: input.amount !== undefined ? Number(input.amount) || 0 : existing?.amount ?? null,
    reference: input.reference !== undefined ? String(input.reference).trim() || null : existing?.reference ?? null,
    notes: input.notes !== undefined ? String(input.notes).trim() || null : existing?.notes ?? null,
  };

  db.prepare(
    `INSERT INTO tax_filings (id, kind, period_key, filed_at, paid_at, amount, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, period_key) DO UPDATE SET
       filed_at = excluded.filed_at, paid_at = excluded.paid_at, amount = excluded.amount,
       reference = excluded.reference, notes = excluded.notes`
  ).run(uuid(), kind, periodKey, next.filed_at, next.paid_at, next.amount, next.reference, next.notes);

  return next;
}

/** Where a period stands, given what has been ticked and what today is. */
function periodStatus(period: VatPeriod, filing: TaxFiling | undefined, today: string) {
  if (filing?.paid_at) return 'paid';
  if (filing?.filed_at) return 'filed';
  if (today <= period.to) return 'open';       // still collecting documents
  if (today <= period.due_date) return 'due';  // closed, deadline ahead
  return 'overdue';
}

export interface VatReport {
  year: number;
  frequency: VatFrequency;
  periods: Array<VatPeriod & {
    income: number;
    output_vat: number;
    expenses: number;
    input_vat: number;
    vat_due: number;
    status: string;
    filing: TaxFiling | null;
    /** Expense documents in the period Morning still has as unreported. */
    open_expenses: number;
  }>;
  totals: PnlTotals;
  /**
   * Expenses in the year Morning reports in a month other than the one they are dated in.
   * Nothing to fix — it is a choice made on the expense in Morning — but it explains why a
   * period's תשומות here need not match the same period on the הוצאות page, which lists by
   * document date.
   */
  shifted_expenses: number;
}

export function vatReport(year: number): VatReport {
  const frequency = getVatFrequency();
  // The one report that counts an expense in the period Morning reports it in, rather than the
  // period it is dated in. See `ExpenseBasis`.
  const rows = monthlyPnl(`${year}-01-01`, `${year}-12-31`, 'reporting');
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const filings = listFilings('vat', year);
  const today = new Date().toISOString().slice(0, 10);

  // One query for the whole year rather than one per period — the count is a nudge about
  // documents still open in Morning, not a figure the filing is built from.
  // Grouped by the reporting date too, so the nudge lands on the period whose figures the
  // documents in question are part of.
  const openByMonth = new Map(
    (db.prepare(
      `SELECT substr(COALESCE(NULLIF(reporting_date, ''), date), 1, 7) AS month, COUNT(*) AS n
       FROM expenses
       WHERE status = 'open' AND COALESCE(NULLIF(reporting_date, ''), date) >= ?
         AND COALESCE(NULLIF(reporting_date, ''), date) <= ? GROUP BY month`
    ).all(`${year}-01-01`, `${year}-12-31`) as any[]).map((r) => [r.month, r.n as number])
  );

  const shifted = (db.prepare(
    `SELECT COUNT(*) AS n FROM expenses
     WHERE reporting_date IS NOT NULL AND reporting_date != ''
       AND substr(reporting_date, 1, 7) != substr(date, 1, 7)
       AND COALESCE(NULLIF(reporting_date, ''), date) >= ?
       AND COALESCE(NULLIF(reporting_date, ''), date) <= ?`
  ).get(`${year}-01-01`, `${year}-12-31`) as { n: number }).n;

  const periods = vatPeriods(year, frequency).map((period) => {
    const totals = pnlTotals(period.months.map((m) => byMonth.get(m) ?? emptyRow(m)));
    const filing = filings.get(period.key);
    return {
      ...period,
      income: totals.income,
      output_vat: totals.incomeVat,
      expenses: totals.expenses,
      input_vat: totals.expensesVat,
      vat_due: totals.vatDue,
      status: periodStatus(period, filing, today),
      filing: filing ?? null,
      open_expenses: period.months.reduce((n, m) => n + (openByMonth.get(m) ?? 0), 0),
    };
  });

  return { year, frequency, periods, totals: pnlTotals(rows), shifted_expenses: shifted };
}

// ---------------------------------------------------------------------------
// מס הכנסה
// ---------------------------------------------------------------------------

/**
 * The rates the annual estimate is built from.
 *
 * These are set by the Tax Authority and the ביטוח לאומי institute and adjusted every January,
 * so they are pinned to the year they were published for and reported alongside the estimate:
 * a table left behind by a new tax year is then visible in the report rather than silently
 * wrong. Update `year` together with the numbers.
 */
export const TAX_RATES = {
  year: 2025,
  /** Annual taxable income bands and the marginal rate on each; the last one is open-ended. */
  brackets: [
    { upTo: 84_120, rate: 0.10 },
    { upTo: 120_720, rate: 0.14 },
    { upTo: 193_800, rate: 0.20 },
    { upTo: 269_280, rate: 0.31 },
    { upTo: 560_280, rate: 0.35 },
    { upTo: 721_560, rate: 0.47 },
    // Above the last threshold the 3% מס יסף rides on top of the 47% marginal rate.
    { upTo: Infinity, rate: 0.50 },
  ],
  /** One נקודת זיכוי for a full year. */
  creditPointValue: 2_904,
  /** ביטוח לאומי + מס בריאות for an עצמאי: the low band, the band above it, and the ceiling. */
  nationalInsurance: {
    reducedRate: 0.0597,
    reducedCeiling: 90_264,
    fullRate: 0.1783,
    ceiling: 608_340,
  },
  /** The share of ביטוח לאומי paid that is deductible against taxable income. */
  niDeductibleShare: 0.52,
} as const;

/** How many נקודות זיכוי to credit — 2.25 is a resident male's default; a woman's is 2.75. */
export function getCreditPoints(): number {
  const value = parseFloat(getSetting('tax_credit_points', '2.25'));
  return Number.isFinite(value) && value >= 0 ? value : 2.25;
}

function bracketTax(taxable: number): number {
  let tax = 0;
  let previous = 0;
  for (const band of TAX_RATES.brackets) {
    if (taxable <= previous) break;
    tax += (Math.min(taxable, band.upTo) - previous) * band.rate;
    previous = band.upTo;
  }
  return round2(tax);
}

function nationalInsurance(profit: number): number {
  const { reducedRate, reducedCeiling, fullRate, ceiling } = TAX_RATES.nationalInsurance;
  if (profit <= 0) return 0;
  const reduced = Math.min(profit, reducedCeiling) * reducedRate;
  const full = Math.max(0, Math.min(profit, ceiling) - reducedCeiling) * fullRate;
  return round2(reduced + full);
}

export interface TaxEstimate {
  rates_year: number;
  credit_points: number;
  profit: number;
  national_insurance: number;
  /** The part of ביטוח לאומי that comes off the income the tax is figured on, and its share. */
  ni_deduction: number;
  ni_deductible_share: number;
  taxable_income: number;
  tax_before_credits: number;
  credits: number;
  income_tax: number;
  total_liability: number;
  net_profit: number;
  effective_rate: number;
}

/**
 * What the year's profit is likely to cost in מס הכנסה and ביטוח לאומי.
 *
 * The order is the real one: ביטוח לאומי is charged on the profit, 52% of it then comes off
 * the income the tax brackets are applied to, and נקודות זיכוי come off the tax itself. It is
 * still an estimate — it knows nothing about a spouse's income, another employer, a pension
 * deduction or any personal relief — and the UI says so.
 */
export function taxEstimate(profit: number, creditPoints = getCreditPoints()): TaxEstimate {
  const base = Math.max(0, round2(profit));
  const ni = nationalInsurance(base);
  const niDeduction = round2(ni * TAX_RATES.niDeductibleShare);
  const taxable = Math.max(0, round2(base - niDeduction));
  const gross = bracketTax(taxable);
  const credits = round2(creditPoints * TAX_RATES.creditPointValue);
  const incomeTax = Math.max(0, round2(gross - credits));
  const total = round2(incomeTax + ni);
  return {
    rates_year: TAX_RATES.year,
    credit_points: creditPoints,
    profit: base,
    national_insurance: ni,
    ni_deduction: niDeduction,
    ni_deductible_share: TAX_RATES.niDeductibleShare,
    taxable_income: taxable,
    tax_before_credits: gross,
    credits,
    income_tax: incomeTax,
    total_liability: total,
    net_profit: round2(base - total),
    effective_rate: base > 0 ? Math.round((total / base) * 1000) / 10 : 0,
  };
}

export interface IncomeTaxReport {
  year: number;
  months: PnlRow[];
  totals: PnlTotals;
  byCategory: Array<{ category: string; count: number; subtotal: number; vat: number; total: number }>;
  estimate: TaxEstimate;
  /** The same estimate scaled to a full year, for a year still in progress. */
  projection: (TaxEstimate & { months_elapsed: number }) | null;
  filing: TaxFiling | null;
}

export function incomeTaxReport(year: number): IncomeTaxReport {
  const months = monthlyPnl(`${year}-01-01`, `${year}-12-31`);
  const totals = pnlTotals(months);
  const summary = expensesSummary({ from: `${year}-01-01`, to: `${year}-12-31` });

  // A year still running is projected from the months that have actually closed: a report
  // read in March otherwise reads as if the year earned two months' worth and stopped.
  const now = new Date();
  const elapsed = now.getFullYear() > year ? 12
    : now.getFullYear() < year ? 0
    : now.getMonth() + 1;
  const projection = elapsed > 0 && elapsed < 12
    ? { ...taxEstimate(round2((totals.profit / elapsed) * 12)), months_elapsed: elapsed }
    : null;

  return {
    year,
    months,
    totals,
    byCategory: summary.byCategory,
    estimate: taxEstimate(totals.profit),
    projection,
    filing: listFilings('income_tax', year).get(String(year)) ?? null,
  };
}
