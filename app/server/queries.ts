/**
 * The list reads that more than one surface needs.
 *
 * These queries were written inline in their routes, which was fine while the browser was the
 * only caller. The MCP server (`mcpTools.ts`) is a second reader of the same data, and two
 * copies of "what counts as an open invoice" is exactly the kind of drift that makes an AI
 * assistant quietly disagree with the screen. One implementation, two callers.
 *
 * Read-only by construction — nothing here writes.
 */

import { db } from './db.js';
import { DOC_TYPE_LABELS, RECEIVABLE_DOC_TYPES_SQL, REVENUE_DOC_TYPES_SQL, isRevenueDoc } from './docTypes.js';

/**
 * What a document still has outstanding, as SQL.
 *
 * Morning's `amountOpened` answers it whenever it is known: a tax invoice is settled by a
 * receipt raised against it, and Morning closes it without anything on the invoice itself
 * saying so — reading the status alone reports money as owed that has been in the bank for
 * weeks, or (for a business that bills on חשבון עסקה) reports nothing owed at all. An invoice
 * raised here has never been to Morning, so there the whole total stands while it is open.
 */
/** Today's date in Israel, where the work happens — a UTC date turns over three hours late. */
export function workToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * A work that is waiting to be billed, as SQL: unbilled *and* its date has arrived.
 *
 * The calendar draws jobs in weeks ahead; a gig next month is not something to charge yet,
 * and counting it made every "to bill" figure and reminder cry wolf. Until its date it is
 * «upcoming» — still unbilled in the table, but nothing anybody has to act on.
 * Binds one parameter: today (see `workToday`).
 */
export const chargeableWorkSql = (alias = '') => {
  const col = alias ? `${alias}.` : '';
  return `(${col}status = 'unpaid' AND ${col}date <= ?)`;
};

export const outstandingSql = (alias = '') => {
  const col = alias ? `${alias}.` : '';
  return `(CASE WHEN ${col}status = 'cancelled' THEN 0
                WHEN ${col}open_amount IS NOT NULL THEN ${col}open_amount
                WHEN ${col}status = 'issued' THEN ${col}total
                ELSE 0 END)`;
};

export interface ListRange {
  from?: string;
  to?: string;
}

/**
 * Clients with what each one owes: uninvoiced work, and invoices issued but not yet paid.
 *
 * The open-invoice total is what those documents still have outstanding, over the receivable
 * types — the tax documents plus the חשבון עסקה that precedes one, because an open proforma is
 * money owed as much as an unpaid invoice is. The revenue figure beside it still counts tax
 * documents only: a sale carries both, and summing every document would double it.
 */
export function listClients() {
  // The two figures the client cards lead with — what this client has been worth this year,
  // and when they were last worked for — come from the same query as the balances, so a card
  // can be read without a second request per client.
  const year = new Date().getFullYear();
  return db
    .prepare(
      `SELECT c.*,
         (SELECT COALESCE(SUM(total),0) FROM works w WHERE w.client_id = c.id AND w.status = 'unpaid' AND w.date <= @today) AS unpaid_total,
         (SELECT COUNT(*) FROM works w WHERE w.client_id = c.id AND w.status = 'unpaid' AND w.date <= @today) AS unpaid_count,
         (SELECT COUNT(*) FROM works w WHERE w.client_id = c.id AND w.status = 'unpaid' AND w.date > @today) AS upcoming_count,
         (SELECT COALESCE(SUM(${outstandingSql('i')}),0) FROM invoices i WHERE i.client_id = c.id
            AND i.doc_type IN (${RECEIVABLE_DOC_TYPES_SQL})) AS open_invoices_total,
         (SELECT COALESCE(SUM(subtotal),0) FROM invoices i WHERE i.client_id = c.id
            AND i.status != 'cancelled' AND i.date >= @from AND i.date <= @to
            AND i.doc_type IN (${REVENUE_DOC_TYPES_SQL})) AS revenue_ytd,
         (SELECT MAX(date) FROM works w WHERE w.client_id = c.id) AS last_work_date
       FROM clients c ORDER BY c.name`
    )
    .all({ from: `${year}-01-01`, to: `${year}-12-31`, today: workToday() });
}

/** Works, newest first, narrowed by any combination of status, client and date range. */
export function listWorks(
  filters: ListRange & { status?: string; client_id?: string } = {}
) {
  const today = workToday();
  // `upcoming` is derived, never stored: an unbilled job whose date is still ahead. It turns
  // into a plain «לא חויב» on its own the day it happens.
  let sql = `SELECT w.*, c.name AS client_name, i.number AS invoice_number,
               CASE WHEN w.status = 'unpaid' AND w.date > ? THEN 1 ELSE 0 END AS upcoming
             FROM works w JOIN clients c ON c.id = w.client_id
             LEFT JOIN invoices i ON i.id = w.invoice_id WHERE 1=1`;
  const params: any[] = [today];
  // «לא חויב» means "needs billing now", so it leaves out what has not happened yet.
  if (filters.status === 'unpaid') { sql += ` AND ${chargeableWorkSql('w')}`; params.push(today); }
  else if (filters.status === 'upcoming') { sql += " AND w.status = 'unpaid' AND w.date > ?"; params.push(today); }
  else if (filters.status) { sql += ' AND w.status = ?'; params.push(filters.status); }
  if (filters.client_id) { sql += ' AND w.client_id = ?'; params.push(filters.client_id); }
  if (filters.from) { sql += ' AND w.date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND w.date <= ?'; params.push(filters.to); }
  sql += ' ORDER BY w.date DESC';
  return db.prepare(sql).all(...params);
}

/**
 * Invoices, newest first, each carrying its document type spelled out and whether it counts as
 * revenue — the two facts every caller has to know before adding a column of totals up.
 */
export function listInvoices(filters: ListRange & { status?: string } = {}) {
  let sql = `SELECT i.*, c.name AS client_name,
               (SELECT COUNT(*) FROM works w WHERE w.invoice_id = i.id) AS works_count
             FROM invoices i JOIN clients c ON c.id = i.client_id`;
  const params: any[] = [];
  const where: string[] = [];
  if (filters.status) { where.push('i.status = ?'); params.push(filters.status); }
  if (filters.from) { where.push('i.date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('i.date <= ?'); params.push(filters.to); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY i.date DESC, i.created_at DESC';

  return (db.prepare(sql).all(...params) as any[]).map((inv) => ({
    ...inv,
    doc_type_label: DOC_TYPE_LABELS[inv.doc_type] ?? null,
    is_revenue: isRevenueDoc(inv.doc_type),
  }));
}
