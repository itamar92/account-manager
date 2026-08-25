/**
 * The סקירה panel: what came in and what went out over a chosen period, read the way the tax
 * return reads it.
 *
 * Two things separate this from the plain P&L in `reports.ts`. The first is the period: a
 * dashboard is looked at for "this year so far" or "last month" as often as for a whole year,
 * and every figure on the panel — the totals, the change against the period before it, the
 * chart, the client split — has to answer for the same window. The second is recognition:
 * an expense is rarely deductible in full. Fuel and car upkeep are 45%, the household bills a
 * home office sits behind are 15%, phone and internet 80% — so the הוצאות a tax return will
 * accept is not the sum of the invoices, and the VAT reclaimable against them is scaled the
 * same way. `basis: 'full'` turns that off and shows the money as it actually left the bank.
 */
import { db, getSetting, setSetting } from './db.js';
import { ACCOUNTING_DOC_TYPES_SQL } from './docTypes.js';
import { monthlyPnl } from './reports.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// recognition rates — what share of an expense category the tax return accepts
// ---------------------------------------------------------------------------

/**
 * The defaults are the ratios `expense-inventory-2026.md` already books this business by:
 * 45% on the car, 15% on the household bills behind the home office, 80% on communications.
 * Anything not listed is deductible in full.
 *
 * They are defaults, not a rule — `expense_recognition_rates` in settings overrides any of
 * them by category name, for the year an accountant says otherwise.
 */
export const DEFAULT_RECOGNITION_RATES: Record<string, number> = {
  'דלק': 0.45,
  'תחזוקה רכב': 0.45,
  'אחזקת רכב': 0.45,
  'רכב': 0.45,
  'ארנונה': 0.15,
  'חשבון חשמל': 0.15,
  'חשמל': 0.15,
  'מים': 0.15,
  'חשבון גז': 0.15,
  'ועד בית': 0.15,
  'אינטרנט': 0.8,
  'טלפון': 0.8,
  'סלולר': 0.8,
  'תקשורת': 0.8,
};

const RATES_KEY = 'expense_recognition_rates';

/** A rate is a share of one; anything outside 0–1 is not one and is ignored. */
const validRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function recognitionRates(): Record<string, number> {
  const raw = getSetting(RATES_KEY, '');
  if (!raw) return { ...DEFAULT_RECOGNITION_RATES };
  try {
    const stored = JSON.parse(raw);
    const overrides = Object.fromEntries(
      Object.entries(stored ?? {}).filter(([, v]) => validRate(v))
    ) as Record<string, number>;
    return { ...DEFAULT_RECOGNITION_RATES, ...overrides };
  } catch {
    return { ...DEFAULT_RECOGNITION_RATES };
  }
}

export function setRecognitionRates(input: Record<string, unknown>): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const [category, value] of Object.entries(input ?? {})) {
    const rate = typeof value === 'string' ? Number(value) : value;
    if (!category.trim()) continue;
    if (!validRate(rate)) throw Object.assign(new Error(`אחוז הכרה לא תקין עבור "${category}"`), { status: 400 });
    clean[category.trim()] = rate;
  }
  setSetting(RATES_KEY, JSON.stringify(clean));
  return recognitionRates();
}

/** Morning's category names carry stray spacing and dashes; match on a flattened form. */
const normalize = (category: string) => category.replace(/[־–—-]/g, ' ').replace(/\s+/g, ' ').trim();

export function rateFor(category: string | null | undefined, rates = recognitionRates()): number {
  const name = normalize(String(category ?? ''));
  if (!name) return 1;
  if (rates[name] != null) return rates[name];
  const hit = Object.keys(rates).find((key) => {
    const k = normalize(key);
    return k && (name === k || name.includes(k));
  });
  return hit != null ? rates[hit] : 1;
}

// ---------------------------------------------------------------------------
// periods
// ---------------------------------------------------------------------------

export type ExpenseBasis = 'recognized' | 'full';

export const isExpenseBasis = (value: unknown): value is ExpenseBasis =>
  value === 'recognized' || value === 'full';

export type PeriodKey =
  | 'current_year' | 'prev_year' | 'current_quarter' | 'current_month' | 'prev_month' | 'last_12m';

export const PERIOD_KEYS: PeriodKey[] = [
  'current_year', 'prev_year', 'current_quarter', 'current_month', 'prev_month', 'last_12m',
];

export const isPeriodKey = (value: unknown): value is PeriodKey =>
  PERIOD_KEYS.includes(value as PeriodKey);

export interface Period {
  key: PeriodKey;
  label: string;
  from: string;
  to: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** The same day in another month, pulled back to that month's last day when it has no 31st. */
const onDay = (year: number, month: number, day: number) => utc(year, month, Math.min(day, lastDayOf(year, month)));

/**
 * The window a period key names.
 *
 * A period still running ends today rather than at its calendar end: "this year" on the 25th of
 * August is eight months of trading, and drawing it to December would put four empty months on
 * the chart and make every comparison look like a collapse.
 */
export function resolvePeriod(key: PeriodKey, today = new Date()): Period {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const now = iso(utc(year, month, day));

  switch (key) {
    case 'prev_year':
      return { key, label: `שנה קודמת (${year - 1})`, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case 'current_quarter': {
      const start = Math.floor((month - 1) / 3) * 3 + 1;
      return { key, label: 'רבעון נוכחי', from: iso(utc(year, start, 1)), to: now };
    }
    case 'current_month':
      return { key, label: 'חודש נוכחי', from: iso(utc(year, month, 1)), to: now };
    case 'prev_month': {
      const prev = month === 1 ? utc(year - 1, 12, 1) : utc(year, month - 1, 1);
      const py = prev.getUTCFullYear();
      const pm = prev.getUTCMonth() + 1;
      return { key, label: 'חודש קודם', from: iso(prev), to: iso(utc(py, pm, lastDayOf(py, pm))) };
    }
    case 'last_12m': {
      const start = new Date(Date.UTC(year, month - 12, 1));
      return { key, label: '12 החודשים האחרונים', from: iso(start), to: now };
    }
    case 'current_year':
    default:
      return { key: 'current_year', label: `שנה נוכחית (${year})`, from: `${year}-01-01`, to: now };
  }
}

/** How far back the comparable period sits, in months, for each key. */
const SHIFT_MONTHS: Record<PeriodKey, number> = {
  current_year: 12, prev_year: 12, current_quarter: 3, current_month: 1, prev_month: 1, last_12m: 12,
};

const shiftMonths = (date: string, months: number) => {
  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(5, 7), 10);
  const day = parseInt(date.slice(8, 10), 10);
  const moved = new Date(Date.UTC(year, month - 1 - months, 1));
  return iso(onDay(moved.getUTCFullYear(), moved.getUTCMonth() + 1, day));
};

/**
 * The window the change percentages compare against: the same period one unit earlier, so
 * "this year to 25 August" is measured against last year to 25 August rather than against a
 * full twelve months it was never going to match.
 */
export function previousPeriod(period: Period): { from: string; to: string } {
  const months = SHIFT_MONTHS[period.key];
  return { from: shiftMonths(period.from, months), to: shiftMonths(period.to, months) };
}

// ---------------------------------------------------------------------------
// the panel's figures
// ---------------------------------------------------------------------------

export interface OverviewMonth {
  /** 'YYYY-MM'. */
  month: string;
  income: number;
  incomeVat: number;
  expenses: number;
  expensesVat: number;
}

export interface OverviewTotals {
  income: number;
  incomeVat: number;
  incomeTotal: number;
  expenses: number;
  expensesVat: number;
  expensesTotal: number;
  profit: number;
  /** מע"מ עסקאות פחות מע"מ תשומות over the period — negative means a refund is due. */
  vatDue: number;
}

export interface ClientShare {
  name: string;
  total: number;
  /** Share of the period's receipts, 0–1. */
  share: number;
}

export interface Overview {
  period: Period;
  previous: { from: string; to: string };
  basis: ExpenseBasis;
  monthly: OverviewMonth[];
  totals: OverviewTotals;
  previousTotals: OverviewTotals;
  /** Change against the previous period, as a share of it. `null` when it had nothing to compare to. */
  change: { income: number | null; incomeTotal: number | null; expenses: number | null };
  clients: ClientShare[];
  receipts: number;
}

/** Expenses per month over the range, each category weighted by what the basis recognises. */
function expensesByMonth(from: string, to: string, basis: ExpenseBasis) {
  const rates = recognitionRates();
  const rows = db.prepare(
    `SELECT substr(date, 1, 7) AS month, COALESCE(category, '') AS category,
            COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(vat_amount),0) AS vat
     FROM expenses WHERE date >= ? AND date <= ?
     GROUP BY month, category`
  ).all(from, to) as Array<{ month: string; category: string; amount: number; vat: number }>;

  const byMonth = new Map<string, { expenses: number; expensesVat: number }>();
  for (const row of rows) {
    const rate = basis === 'full' ? 1 : rateFor(row.category, rates);
    const acc = byMonth.get(row.month) ?? { expenses: 0, expensesVat: 0 };
    acc.expenses += row.amount * rate;
    acc.expensesVat += row.vat * rate;
    byMonth.set(row.month, acc);
  }
  return byMonth;
}

/** The monthly series behind the chart: income and its VAT, expenses and the VAT recognised on them. */
function series(from: string, to: string, basis: ExpenseBasis): OverviewMonth[] {
  const expenses = expensesByMonth(from, to, basis);
  return monthlyPnl(from, to).map((row) => {
    const exp = expenses.get(row.month);
    return {
      month: row.month,
      income: row.income,
      incomeVat: row.incomeVat,
      expenses: round2(exp?.expenses ?? 0),
      expensesVat: round2(exp?.expensesVat ?? 0),
    };
  });
}

function totalsOf(rows: OverviewMonth[]): OverviewTotals {
  const sum = (key: keyof OverviewMonth) => round2(rows.reduce((acc, r) => acc + (r[key] as number), 0));
  const income = sum('income');
  const incomeVat = sum('incomeVat');
  const expenses = sum('expenses');
  const expensesVat = sum('expensesVat');
  return {
    income,
    incomeVat,
    incomeTotal: round2(income + incomeVat),
    expenses,
    expensesVat,
    expensesTotal: round2(expenses + expensesVat),
    profit: round2(income - expenses),
    vatDue: round2(incomeVat - expensesVat),
  };
}

/** `null` rather than an infinite jump when the period before this one had nothing in it. */
const change = (now: number, before: number): number | null =>
  before === 0 ? null : round2((now - before) / Math.abs(before) * 100) / 100;

/** How many named clients the donut names before the rest are folded into one slice. */
const TOP_CLIENTS = 10;

/**
 * Receipts by client over the period — money that has actually come in, not what was billed,
 * so a large invoice still sitting open does not colour a slice it has not paid for yet.
 */
function clientShares(from: string, to: string): { clients: ClientShare[]; receipts: number } {
  const rows = db.prepare(
    `SELECT c.name AS name, COALESCE(SUM(i.total),0) AS total
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.status = 'paid' AND i.doc_type IN (${ACCOUNTING_DOC_TYPES_SQL})
       AND i.date >= ? AND i.date <= ?
     GROUP BY c.id HAVING total > 0 ORDER BY total DESC`
  ).all(from, to) as Array<{ name: string; total: number }>;

  const receipts = round2(rows.reduce((acc, r) => acc + r.total, 0));
  if (receipts === 0) return { clients: [], receipts: 0 };

  const named = rows.slice(0, TOP_CLIENTS);
  const rest = rows.slice(TOP_CLIENTS).reduce((acc, r) => acc + r.total, 0);
  const slices = named.map((r) => ({ name: r.name, total: round2(r.total) }));
  if (rest > 0) slices.push({ name: 'לקוחות נוספים', total: round2(rest) });

  return {
    receipts,
    clients: slices.map((s) => ({ ...s, share: round2(s.total / receipts * 100) / 100 })),
  };
}

export function overview(periodKey: PeriodKey, basis: ExpenseBasis, today = new Date()): Overview {
  const period = resolvePeriod(periodKey, today);
  const previous = previousPeriod(period);

  const monthly = series(period.from, period.to, basis);
  const totals = totalsOf(monthly);
  const previousTotals = totalsOf(series(previous.from, previous.to, basis));
  const { clients, receipts } = clientShares(period.from, period.to);

  return {
    period,
    previous,
    basis,
    monthly,
    totals,
    previousTotals,
    change: {
      income: change(totals.income, previousTotals.income),
      incomeTotal: change(totals.incomeTotal, previousTotals.incomeTotal),
      expenses: change(totals.expenses, previousTotals.expenses),
    },
    clients,
    receipts,
  };
}
