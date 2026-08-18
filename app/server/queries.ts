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
         (SELECT COALESCE(SUM(total),0) FROM works w WHERE w.client_id = c.id AND w.status = 'unpaid') AS unpaid_total,
         (SELECT COUNT(*) FROM works w WHERE w.client_id = c.id AND w.status = 'unpaid') AS unpaid_count,
         (SELECT COALESCE(SUM(${outstandingSql('i')}),0) FROM invoices i WHERE i.client_id = c.id
            AND i.doc_type IN (${RECEIVABLE_DOC_TYPES_SQL})) AS open_invoices_total,
         (SELECT COALESCE(SUM(subtotal),0) FROM invoices i WHERE i.client_id = c.id
            AND i.status != 'cancelled' AND i.date >= @from AND i.date <= @to
            AND i.doc_type IN (${REVENUE_DOC_TYPES_SQL})) AS revenue_ytd,
         (SELECT MAX(date) FROM works w WHERE w.client_id = c.id) AS last_work_date
       FROM clients c ORDER BY c.name`
    )
    .all({ from: `${year}-01-01`, to: `${year}-12-31` });
}

/** Works, newest first, narrowed by any combination of status, client and date range. */
export function listWorks(
  filters: ListRange & { status?: string; client_id?: string } = {}
) {
  let sql = `SELECT w.*, c.name AS client_name, i.number AS invoice_number
             FROM works w JOIN clients c ON c.id = w.client_id
             LEFT JOIN invoices i ON i.id = w.invoice_id WHERE 1=1`;
  const params: any[] = [];
  if (filters.status) { sql += ' AND w.status = ?'; params.push(filters.status); }
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
