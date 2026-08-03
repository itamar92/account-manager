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

/** Morning's expense status codes. */
const STATUS_REPORTED = 20;

/**
 * Whether the expense has been reported to the accountant and locked in Morning.
 *
 * Two things are read, because Morning states the same fact two ways: the numeric `status`
 * (10 open / 20 reported) and a `reported` boolean — the spelling its own search filter uses.
 * The status is compared after coercion rather than with `===`, since a payload that sends
 * `"20"` as a string would otherwise silently report every expense as still open.
 */
function mapStatus(exp: MorningExpense): 'open' | 'reported' {
  if (typeof exp.reported === 'boolean') return exp.reported ? 'reported' : 'open';
  return Number(exp.status) === STATUS_REPORTED ? 'reported' : 'open';
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
 */
function money(exp: MorningExpense): { subtotal: number; vat: number; total: number } {
  const rate = Number(exp.currencyRate) > 0 ? Number(exp.currencyRate) : 1;
  const vat = round2((Number(exp.vat) || 0) * rate);
  const amount = (Number(exp.amount) || 0) * rate;
  const stated = Number(exp.amountTotal);
  const total = round2(Number.isFinite(stated) && stated > 0 ? stated * rate : amount);
  return { subtotal: round2(total - vat), vat, total };
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
  /** How many of the fetched expenses Morning reports as already filed (status 20). */
  reported: number;
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
  // Counted and reported back so the דווח/טרם דווח mapping is checkable from the UI: if
  // Morning shows expenses as filed and this comes back 0, the status is arriving in some
  // field this mapper does not read — and the `raw` column then has the answer.
  let reported = 0;

  const tx = db.transaction(() => {
    for (const exp of expenses) {
      const date = (exp.documentDate || exp.date || '').slice(0, 10);
      if (!exp.id || !date) {
        skipped++;
        continue;
      }

      const { subtotal, vat, total } = money(exp);
      const values = {
        number: String(exp.number ?? ''),
        doc_type: docType(exp),
        date,
        payment_date: exp.paymentDate ? String(exp.paymentDate).slice(0, 10) : null,
        supplier_name: supplierName(exp),
        supplier_tax_id: exp.supplier?.taxId ?? null,
        external_supplier_id: exp.supplier?.id ?? null,
        category: category(exp, classifications),
        description: (exp.description || '').trim() || null,
        amount: subtotal,
        vat_amount: vat,
        total,
        currency: exp.currency || 'ILS',
        status: mapStatus(exp),
        notes: (exp.remarks || '').trim() || null,
        raw: JSON.stringify(exp),
      };
      if (values.status === 'reported') reported++;

      const existing = db.prepare('SELECT id FROM expenses WHERE external_id = ?').get(exp.id) as
        | { id: string }
        | undefined;

      if (existing) {
        db.prepare(
          `UPDATE expenses SET number = ?, doc_type = ?, date = ?, payment_date = ?, supplier_name = ?,
             supplier_tax_id = ?, external_supplier_id = ?, category = ?, description = ?,
             amount = ?, vat_amount = ?, total = ?, currency = ?, status = ?, notes = ?, raw = ?
           WHERE id = ?`
        ).run(
          values.number, values.doc_type, values.date, values.payment_date, values.supplier_name,
          values.supplier_tax_id, values.external_supplier_id, values.category, values.description,
          values.amount, values.vat_amount, values.total, values.currency, values.status, values.notes,
          values.raw, existing.id
        );
        updated++;
        continue;
      }

      db.prepare(
        `INSERT INTO expenses (id, external_id, number, doc_type, date, payment_date, supplier_name,
           supplier_tax_id, external_supplier_id, category, description, amount, vat_amount, total,
           currency, status, source, notes, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'morning', ?, ?)`
      ).run(
        uuid(), exp.id, values.number, values.doc_type, values.date, values.payment_date,
        values.supplier_name, values.supplier_tax_id, values.external_supplier_id, values.category,
        values.description, values.amount, values.vat_amount, values.total, values.currency,
        values.status, values.notes, values.raw
      );
      created++;
    }
    setSetting('morning_expenses_last_sync', new Date().toISOString());
  });

  tx();
  return { fetched: expenses.length, created, updated, skipped, reported, from, to };
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
 * The totals above the list: what was spent in the range, and how much of it is input VAT
 * (מע"מ תשומות) — the figure a מע"מ filing is built from — split by category.
 */
export function expensesSummary(filters: ExpenseFilters = {}) {
  const clause = where(filters);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS subtotal,
              COALESCE(SUM(vat_amount),0) AS vat, COALESCE(SUM(total),0) AS total
       FROM expenses${clause.sql}`
    )
    .get(...clause.params) as any;

  const byCategory = db
    .prepare(
      `SELECT COALESCE(NULLIF(category, ''), 'ללא סיווג') AS category, COUNT(*) AS count,
              COALESCE(SUM(amount),0) AS subtotal, COALESCE(SUM(vat_amount),0) AS vat,
              COALESCE(SUM(total),0) AS total
       FROM expenses${clause.sql}
       GROUP BY 1 ORDER BY total DESC`
    )
    .all(...clause.params) as any[];

  return {
    count: totals.count as number,
    subtotal: round2(totals.subtotal),
    vat: round2(totals.vat),
    total: round2(totals.total),
    byCategory: byCategory.map((row) => ({
      ...row,
      subtotal: round2(row.subtotal),
      vat: round2(row.vat),
      total: round2(row.total),
    })),
  };
}

/** Every category present in the table, for the filter — not only those in the current range. */
export function expenseCategories(): string[] {
  return (
    db.prepare("SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL AND category != '' ORDER BY category")
      .all() as Array<{ category: string }>
  ).map((row) => row.category);
}

export function expensesStatus() {
  return {
    configured: isMorningConfigured(),
    last_sync: getSetting('morning_expenses_last_sync', '') || null,
    synced: (
      db.prepare("SELECT COUNT(*) AS n FROM expenses WHERE source = 'morning'").get() as { n: number }
    ).n,
  };
}
