/**
 * Expenses (הוצאות) pulled from Morning — the documents suppliers issued to the business,
 * the mirror image of the invoices `morningSync` pulls.
 *
 * They are read-only here: Morning is where an expense is filed and classified, and this
 * app is where the year's spending and its reclaimable VAT can be seen next to the income.
 */
import { db, uuid, getMorningSyncDays, getSetting, setSetting } from './db.js';
import { DOC_TYPE_LABELS } from './docTypes.js';
import {
  expenseClassifications, isMorningConfigured, searchAllExpenses, type MorningExpense,
} from './morningClient.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Morning's expense status codes, as far as they are known. */
const STATUS_OPEN = 10;
const STATUS_REPORTED = 20;

/** What a row's status column can say. `unknown` is "Morning did not tell us". */
export type ExpenseStatus = 'open' | 'reported' | 'unknown';

/** Reads a flag that may arrive as a boolean, as 0/1, or as the string "true"/"1". */
function flag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : null;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no') return false;
  }
  return null;
}

/**
 * Whether the expense has been reported to the accountant (דווח) — or whether the payload
 * simply does not say.
 *
 * The third answer is the point of this function. Morning states the fact in more than one
 * spelling, and an earlier version of this mapper read two of them and called everything
 * else `open`: an account whose expenses were every one of them filed in Morning showed up
 * here as entirely טרם דווח, with nothing to distinguish "Morning says open" from "this
 * mapper found no field it recognises". `null` keeps the two apart, so a spelling nobody
 * has seen yet surfaces as לא ידוע — visible, countable, and diagnosable from `raw` —
 * instead of quietly inverting every row's status.
 *
 * Read, in order of how directly each states the fact:
 * 1. a flag — `reported` / `isReported`, in any of the shapes `flag` accepts;
 * 2. a report the expense belongs to, filled in — an id or a date is the reporting itself;
 * 3. the numeric `status`, where 10 and 20 are the codes believed to mean open and
 *    reported. Any *other* number is left undetermined rather than read as open: it is
 *    evidence the enum is not the one assumed here, and guessing at it is the mistake
 *    this function exists to stop repeating;
 * 4. last, an empty report field — a `reportId` that is present but null says the expense
 *    is in no report, which is weaker than anything above it and so is read only once the
 *    payload has offered nothing else.
 */
function readReported(exp: MorningExpense): boolean | null {
  for (const value of [exp.reported, exp.isReported]) {
    const known = flag(value);
    if (known !== null) return known;
  }

  const marks = [exp.reportId, exp.vatReportId, exp.reportedAt, exp.reportDate];
  if (marks.some((mark) => mark != null && mark !== '' && mark !== 0)) return true;

  const status = Number(exp.status);
  if (status === STATUS_REPORTED) return true;
  if (status === STATUS_OPEN) return false;

  if (marks.some((mark) => mark === null || mark === '')) return false;
  return null;
}

function mapStatus(exp: MorningExpense): ExpenseStatus {
  const reported = readReported(exp);
  return reported === null ? 'unknown' : reported ? 'reported' : 'open';
}

/**
 * The document type — 300/305/320/400, the same codes an issued document uses.
 *
 * Morning calls it `documentType` on an expense, not `type` as it does on a document; `type`
 * is still read as a fallback so a payload using the older spelling keeps its label.
 */
function docType(exp: MorningExpense): number | null {
  const raw = exp.documentType ?? exp.type;
  const value = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function supplierName(exp: MorningExpense): string {
  return (exp.supplier?.name || exp.supplierName || '').trim() || 'ספק לא מזוהה';
}

/**
 * What the expense cost, in shekels: before VAT, the VAT itself, and the total paid.
 *
 * Morning reports the document total in `amount` with VAT included, as it does for issued
 * documents; accounts that also send `amountTotal` put the total there and the pre-VAT
 * figure in `amount`. Taking the total from `amountTotal` when it is present and from
 * `amount` otherwise reads both correctly.
 *
 * A missing VAT figure is never back-computed the way revenue's is: suppliers who are
 * עוסק פטור, and expenses billed abroad, carry no input VAT at all, and inventing some
 * would overstate what may be reclaimed.
 *
 * The figure before VAT is taken from `amountExcludeVat` when Morning states it, and worked
 * out by subtraction only when it does not.
 *
 * `deductibleAmount` and `deductibleVat` come back alongside them: what the deduction
 * percentage on the expense's classification leaves of each. They are the figures a filing
 * is entitled to — the full VAT on a phone bill deducted at 80% is not reclaimable, and
 * summing `vat` there claims back more than is owed. They are kept separately rather than
 * replacing the full amounts, because both are true and each answers its own question: what
 * the expense cost, and what of it the books may recognise.
 *
 * A figure Morning does not state is stored as null, not as the full amount, so the two
 * cases stay apart in the data; every sum falls back to the full figure. Zero is a real
 * answer — an expense with nothing deductible about it — and is kept as one.
 */
interface ExpenseMoney {
  subtotal: number;
  vat: number;
  total: number;
  deductibleSubtotal: number | null;
  deductibleVat: number | null;
}

function money(exp: MorningExpense): ExpenseMoney {
  const rate = Number(exp.currencyRate) > 0 ? Number(exp.currencyRate) : 1;
  const vat = round2((Number(exp.vat) || 0) * rate);
  const amount = (Number(exp.amount) || 0) * rate;
  const stated = Number(exp.amountTotal);
  const total = round2(Number.isFinite(stated) && stated > 0 ? stated * rate : amount);
  const excludingVat = Number(exp.amountExcludeVat);
  const subtotal = Number.isFinite(excludingVat) && excludingVat > 0
    ? round2(excludingVat * rate)
    : round2(total - vat);

  const deductible = (value: unknown): number | null => {
    const figure = Number(value);
    return Number.isFinite(figure) && figure >= 0 ? round2(figure * rate) : null;
  };

  return {
    subtotal,
    vat,
    total,
    deductibleSubtotal: deductible(exp.deductibleAmount),
    deductibleVat: deductible(exp.deductibleVat),
  };
}

/**
 * The סיווג to file the row under — what Morning's UI calls the expense type.
 *
 * It arrives as an `accountingClassification` **object** whose name is in `title`, so the
 * value has to be read out of it rather than stringified: `String(object)` is what put
 * "[object Object]" in this column. A payload that sends a bare id instead is looked up in
 * the account's classifications map, and only a value that names itself is stored — an
 * unresolvable id is left null, so the row shows up under ללא סיווג where it can be found
 * and fixed, rather than under a number that means nothing.
 */
function category(exp: MorningExpense, classifications: Map<string, string>): string | null {
  const raw = exp.category ?? exp.accountingClassification;
  if (raw == null || raw === '') return null;

  if (typeof raw === 'object') {
    const named = (raw.title ?? raw.name ?? '').trim();
    if (named) return named;
    // Named nowhere on the object itself — fall back to whichever key the map knows it by.
    for (const key of [raw.id, raw.key, raw.code]) {
      const found = key != null && key !== '' ? classifications.get(String(key)) : undefined;
      if (found) return found;
    }
    return null;
  }

  return classifications.get(String(raw)) ?? null;
}

export interface ExpensePullResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  /** How many of the fetched expenses Morning states are already filed (דווח). */
  reported: number;
  /** How many carried no reported/status field this mapper recognises — status לא ידוע. */
  unknown: number;
  from: string;
  to: string;
}

/**
 * Pulls expenses from Morning into the local table, upserting on the Morning expense id.
 *
 * Nothing here is edited locally, so an existing row is refreshed in full — a category or
 * amount corrected in Morning is meant to reach this list on the next sync.
 */
export async function pullExpensesFromMorning(options: { days?: number } = {}): Promise<ExpensePullResult> {
  const days = options.days ?? getMorningSyncDays();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const expenses = await searchAllExpenses({ fromDate: from, toDate: to });
  // Category names are decoration on top of the money; an account without classifications
  // (or a plan that does not expose them) still gets its expenses.
  const classifications = await expenseClassifications().catch(() => new Map<string, string>());

  let created = 0;
  let updated = 0;
  let skipped = 0;
  // Counted and reported back so the דווח/טרם דווח mapping is checkable from the UI. The
  // two counts answer different questions: `reported` is what Morning says is filed, while
  // `unknown` is how often it said nothing this mapper could read — a sync that comes back
  // with everything unknown is a field-name problem, and `raw` then has the answer.
  let reported = 0;
  let unknown = 0;

  const tx = db.transaction(() => {
    for (const exp of expenses) {
      const date = (exp.documentDate || exp.date || '').slice(0, 10);
      if (!exp.id || !date) {
        skipped++;
        continue;
      }

      const { subtotal, vat, total, deductibleSubtotal, deductibleVat } = money(exp);
      const values = {
        number: String(exp.number ?? ''),
        doc_type: docType(exp),
        date,
        payment_date: exp.paymentDate ? String(exp.paymentDate).slice(0, 10) : null,
        // The מע"מ period Morning files the expense under, which it lets you set apart from
        // the document's own date — an August invoice can be reported in July's period. Stored
        // because it is the only field in the payload that is unambiguously about reporting.
        reporting_date: exp.reportingDate ? String(exp.reportingDate).slice(0, 10) : null,
        supplier_name: supplierName(exp),
        supplier_tax_id: exp.supplier?.taxId ?? null,
        external_supplier_id: exp.supplier?.id ?? null,
        category: category(exp, classifications),
        description: (exp.description || '').trim() || null,
        amount: subtotal,
        vat_amount: vat,
        total,
        deductible_amount: deductibleSubtotal,
        deductible_vat: deductibleVat,
        currency: exp.currency || 'ILS',
        status: mapStatus(exp),
        notes: (exp.remarks || '').trim() || null,
        raw: JSON.stringify(exp),
      };
      if (values.status === 'reported') reported++;
      else if (values.status === 'unknown') unknown++;

      const existing = db.prepare('SELECT id FROM expenses WHERE external_id = ?').get(exp.id) as
        | { id: string }
        | undefined;

      if (existing) {
        db.prepare(
          `UPDATE expenses SET number = ?, doc_type = ?, date = ?, payment_date = ?, reporting_date = ?,
             supplier_name = ?, supplier_tax_id = ?, external_supplier_id = ?, category = ?,
             description = ?, amount = ?, vat_amount = ?, total = ?, deductible_amount = ?,
             deductible_vat = ?, currency = ?, status = ?, notes = ?, raw = ?
           WHERE id = ?`
        ).run(
          values.number, values.doc_type, values.date, values.payment_date, values.reporting_date,
          values.supplier_name, values.supplier_tax_id, values.external_supplier_id, values.category,
          values.description, values.amount, values.vat_amount, values.total, values.deductible_amount,
          values.deductible_vat, values.currency, values.status, values.notes, values.raw, existing.id
        );
        updated++;
        continue;
      }

      db.prepare(
        `INSERT INTO expenses (id, external_id, number, doc_type, date, payment_date, reporting_date,
           supplier_name, supplier_tax_id, external_supplier_id, category, description, amount,
           vat_amount, total, deductible_amount, deductible_vat, currency, status, source, notes, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'morning', ?, ?)`
      ).run(
        uuid(), exp.id, values.number, values.doc_type, values.date, values.payment_date,
        values.reporting_date, values.supplier_name, values.supplier_tax_id,
        values.external_supplier_id, values.category, values.description, values.amount,
        values.vat_amount, values.total, values.deductible_amount, values.deductible_vat,
        values.currency, values.status, values.notes, values.raw
      );
      created++;
    }
    setSetting('morning_expenses_last_sync', new Date().toISOString());
  });

  tx();
  return { fetched: expenses.length, created, updated, skipped, reported, unknown, from, to };
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  status?: string;
  category?: string;
}

/** The value the category filter uses for rows Morning has not classified. */
export const UNCATEGORIZED = '__none__';

/** The filters as a WHERE clause shared by the list and its totals, so the two always agree. */
function where(filters: ExpenseFilters): { sql: string; params: any[] } {
  const parts: string[] = [];
  const params: any[] = [];
  if (filters.from) { parts.push('date >= ?'); params.push(filters.from); }
  if (filters.to) { parts.push('date <= ?'); params.push(filters.to); }
  if (filters.status) { parts.push('status = ?'); params.push(filters.status); }
  // 'ללא סיווג' is a filter in its own right — the rows most in need of attention.
  if (filters.category === UNCATEGORIZED) parts.push("(category IS NULL OR category = '')");
  else if (filters.category) { parts.push('category = ?'); params.push(filters.category); }
  return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
}

export function listExpenses(filters: ExpenseFilters = {}) {
  const clause = where(filters);
  const rows = db
    .prepare(`SELECT * FROM expenses${clause.sql} ORDER BY date DESC, created_at DESC`)
    .all(...clause.params) as any[];
  // `raw` stays on the server: it is there to diagnose a mapping problem, not to be shipped
  // to the browser with every row of the table.
  return rows.map(({ raw, ...row }) => ({
    ...row,
    doc_type_label: row.doc_type != null ? DOC_TYPE_LABELS[row.doc_type] ?? null : null,
  }));
}

/**
 * What each of the two VAT figures is summed from.
 *
 * `vat_amount` is the VAT on the documents; `deductible_vat` is what of it may be reclaimed
 * once the classification's deduction percentage is applied. A filing is entitled to the
 * second. They differ only where an expense is partly deductible — a phone bill, a car — and
 * where Morning states nothing the sum falls back to the full figure, which is what this app
 * counted before it read the field at all.
 */
const DEDUCTIBLE_VAT_SQL = 'COALESCE(SUM(COALESCE(deductible_vat, vat_amount)),0)';
const DEDUCTIBLE_AMOUNT_SQL = 'COALESCE(SUM(COALESCE(deductible_amount, amount)),0)';

/**
 * The totals above the list: what was spent in the range, and how much of it a filing may
 * actually claim back, split by category.
 *
 * Both figures are returned, spent and deductible, because a page that showed only one of
 * them would be answering a question nobody asked: the difference between them is money
 * that was really paid out and really cannot be reclaimed, and it is worth seeing.
 */
export function expensesSummary(filters: ExpenseFilters = {}) {
  const clause = where(filters);
  const figures = `COUNT(*) AS count, COALESCE(SUM(amount),0) AS subtotal,
              COALESCE(SUM(vat_amount),0) AS vat, COALESCE(SUM(total),0) AS total,
              ${DEDUCTIBLE_AMOUNT_SQL} AS deductible, ${DEDUCTIBLE_VAT_SQL} AS deductible_vat`;

  const totals = db
    .prepare(`SELECT ${figures} FROM expenses${clause.sql}`)
    .get(...clause.params) as any;

  const byCategory = db
    .prepare(
      `SELECT COALESCE(NULLIF(category, ''), 'ללא סיווג') AS category, ${figures}
       FROM expenses${clause.sql}
       GROUP BY 1 ORDER BY total DESC`
    )
    .all(...clause.params) as any[];

  const rounded = (row: any) => ({
    ...row,
    subtotal: round2(row.subtotal),
    vat: round2(row.vat),
    total: round2(row.total),
    deductible: round2(row.deductible),
    deductible_vat: round2(row.deductible_vat),
  });

  return {
    ...rounded(totals),
    count: totals.count as number,
    byCategory: byCategory.map(rounded),
  };
}

/** Every category present in the table, for the filter — not only those in the current range. */
export function expenseCategories(): string[] {
  return (
    db.prepare("SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL AND category != '' ORDER BY category")
      .all() as Array<{ category: string }>
  ).map((row) => row.category);
}

/** Names that say outright that a key carries the reported/open fact. */
const STATUS_LIKE = /report|status|closed|lock|period|approv/i;

/**
 * How many distinct values a key may take and still be reporting a code rather than a
 * quantity. A document number or an amount is different in every payload; an enum is not.
 */
const ENUM_MAX_VALUES = 12;

/** Payloads below which "few distinct values" means nothing, so every scalar key is shown. */
const ENUM_MIN_PAYLOADS = 8;

export interface ExpenseStatusAudit {
  counts: Record<ExpenseStatus | string, number>;
  /** Rows whose Morning payload was kept — the only ones this audit can say anything about. */
  withRaw: number;
  /** Every top-level key Morning's expense payloads carry, and how many carry it. */
  keys: Array<{ key: string; count: number }>;
  /**
   * The keys that carry a code: named after a status, or taking too few distinct values
   * across the payloads to be anything else. Listed with the values they hold and how often.
   */
  codeKeys: Array<{ key: string; values: Array<{ value: string; count: number }> }>;
  /** A Morning id to fetch in full, in case the search payload is lighter than the record. */
  sampleId: string | null;
  /**
   * One payload as Morning sent it. The key list above finds a field that names itself; this
   * is for when the fact is carried by one that does not. It is the only part of the audit
   * holding a supplier name and an amount.
   */
  sample: unknown;
}

/**
 * What the stored payloads actually say about a status, read back out of `expenses.raw`.
 *
 * This exists because the field carrying דווח/טרם דווח has been guessed at twice, and a
 * guess is not checkable: it either works or it silently marks the whole list open. The
 * audit answers it from the account's own data instead.
 *
 * It looks for enums rather than for names, because the names have already proved
 * unreliable — the same payloads put values outside the issued-document enum in the key
 * this app reads as `documentType`, so an expense evidently does not use the field names or
 * the codes an issued document does. A key holding one of a handful of values across
 * hundreds of expenses is carrying a code whatever it is called, and comparing those values
 * against what Morning itself shows for the same expense is what identifies the right one.
 */
export function expenseStatusAudit(limit = 500): ExpenseStatusAudit {
  const counts: Record<string, number> = {};
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS n FROM expenses GROUP BY status')
    .all() as Array<{ status: string; n: number }>) {
    counts[row.status] = row.n;
  }

  const rows = db
    .prepare("SELECT external_id, raw FROM expenses WHERE raw IS NOT NULL AND raw != '' ORDER BY date DESC LIMIT ?")
    .all(limit) as Array<{ external_id: string | null; raw: string }>;

  const keyCounts = new Map<string, number>();
  const values = new Map<string, Map<string, number>>();
  /** Keys seen holding an object or an array — a shape, not a code. */
  const nested = new Set<string>();
  const parsed: any[] = [];

  for (const row of rows) {
    let payload: any;
    // A payload that will not parse is not worth failing the audit over — it is one row's
    // worth of evidence out of hundreds.
    try { payload = JSON.parse(row.raw); } catch { continue; }
    if (!payload || typeof payload !== 'object') continue;
    parsed.push(payload);

    for (const [key, value] of Object.entries(payload)) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      if (value !== null && typeof value === 'object') nested.add(key);

      const shown = value === null ? 'null'
        : typeof value === 'object' ? JSON.stringify(value).slice(0, 120)
        : String(value);
      const seen = values.get(key) ?? new Map<string, number>();
      // The map is capped: a key with hundreds of distinct values has already disqualified
      // itself as an enum, and there is nothing to learn from collecting the rest.
      if (seen.has(shown) || seen.size <= ENUM_MAX_VALUES * 4) {
        seen.set(shown, (seen.get(shown) ?? 0) + 1);
      }
      values.set(key, seen);
    }
  }

  const byCountDesc = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  const enough = parsed.length >= ENUM_MIN_PAYLOADS;

  const codeKeys = [...values]
    .filter(([key, seen]) =>
      STATUS_LIKE.test(key) || (!nested.has(key) && (!enough || seen.size <= ENUM_MAX_VALUES)))
    .map(([key, seen]) => ({
      key,
      values: [...seen].map(([value, count]) => ({ value, count })).sort(byCountDesc),
    }));

  return {
    counts,
    withRaw: rows.length,
    keys: [...keyCounts].map(([key, count]) => ({ key, count })).sort(byCountDesc),
    codeKeys,
    sampleId: rows.find((row) => row.external_id)?.external_id ?? null,
    sample: parsed[0] ?? null,
  };
}

export function expensesStatus() {
  return {
    configured: isMorningConfigured(),
    last_sync: getSetting('morning_expenses_last_sync', '') || null,
    synced: (
      db.prepare("SELECT COUNT(*) AS n FROM expenses WHERE source = 'morning'").get() as { n: number }
    ).n,
    // Rows whose payload said nothing this app could read about דווח/טרם דווח. Surfaced on
    // the page itself, not only in a sync's notice: the mapping problem outlives the sync
    // that produced it, and this is the number that says the list is not to be trusted on
    // status until it is fixed.
    unknown: (
      db.prepare("SELECT COUNT(*) AS n FROM expenses WHERE status = 'unknown'").get() as { n: number }
    ).n,
  };
}
