import { db, uuid, getVatPercent } from './db.js';
import { DOC_TYPE } from './docTypes.js';

export interface LineItemInput {
  description: string;
  amount: number; // pre-VAT
  date?: string;
}

export interface CreateInvoiceInput {
  clientId?: string;
  clientName?: string; // resolve-or-create by name (for external API callers)
  workIds?: string[]; // existing unpaid works to bind to this invoice
  lineItems?: LineItemInput[]; // ad-hoc items — created as works and bound
  date?: string;
  dueDate?: string;
  docType?: number;
  externalId?: string;
  /** The document number to carry. Left out, a provisional `AM-*` one is handed out. */
  number?: string;
  notes?: string;
  source?: string;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function resolveClient(input: { clientId?: string; clientName?: string }): { id: string } {
  if (input.clientId) {
    const row = db.prepare('SELECT id FROM clients WHERE id = ?').get(input.clientId) as { id: string } | undefined;
    if (!row) throw Object.assign(new Error('client not found'), { status: 404 });
    return row;
  }
  if (input.clientName) {
    const existing = db.prepare('SELECT id FROM clients WHERE name = ?').get(input.clientName.trim()) as
      | { id: string }
      | undefined;
    if (existing) return existing;
    const id = uuid();
    db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, input.clientName.trim());
    return { id };
  }
  throw Object.assign(new Error('clientId or clientName is required'), { status: 400 });
}

/**
 * "שוטף + N" — the terms Israeli invoices are almost always written on: the clock starts
 * at the end of the month the document was issued in, and the agreed number of days runs
 * from there. A client's own `payment_terms_days` supplies N, defaulting to 30.
 */
export function computeDueDate(date: string, termsDays = 30): string {
  const base = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return date;
  // Day 0 of the next month is the last day of this one.
  const endOfMonth = Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0);
  return new Date(endOfMonth + Math.max(0, termsDays) * 86400_000).toISOString().slice(0, 10);
}

/**
 * Provisional number for an invoice that exists only in this app.
 *
 * Morning assigns the real, sequential document number when the invoice is pushed to it
 * (see `pushInvoiceToMorning`). Numbering locally from `MAX(number)+1` would hand out
 * numbers Morning is going to issue itself, so local numbers carry a prefix and can never
 * collide with a real one.
 */
export const LOCAL_NUMBER_PREFIX = 'AM-';

export function nextInvoiceNumber(): string {
  const row = db
    .prepare(
      `SELECT MAX(CAST(substr(number, ${LOCAL_NUMBER_PREFIX.length + 1}) AS INTEGER)) AS maxNum
       FROM invoices WHERE number LIKE '${LOCAL_NUMBER_PREFIX}%'`
    )
    .get() as { maxNum: number | null };
  return `${LOCAL_NUMBER_PREFIX}${(row.maxNum ?? 0) + 1}`;
}

/**
 * Creates an invoice and atomically binds unpaid works to it (status -> 'invoiced').
 * Ad-hoc line items are stored as works too, so every invoice line is a work row.
 */
export function createInvoice(input: CreateInvoiceInput) {
  const vatPercent = getVatPercent();

  const tx = db.transaction(() => {
    const client = resolveClient(input);
    const invoiceId = uuid();
    const date = input.date || new Date().toISOString().slice(0, 10);

    const workIds = [...(input.workIds ?? [])];

    for (const workId of workIds) {
      const work = db.prepare('SELECT id, client_id, status FROM works WHERE id = ?').get(workId) as
        | { id: string; client_id: string; status: string }
        | undefined;
      if (!work) throw Object.assign(new Error(`work ${workId} not found`), { status: 404 });
      if (work.client_id !== client.id)
        throw Object.assign(new Error(`work ${workId} belongs to a different client`), { status: 400 });
      if (work.status !== 'unpaid')
        throw Object.assign(new Error(`work ${workId} is already ${work.status}`), { status: 409 });
    }

    for (const item of input.lineItems ?? []) {
      const workId = uuid();
      const amount = round2(Number(item.amount) || 0);
      const vat = round2((amount * vatPercent) / 100);
      db.prepare(
        `INSERT INTO works (id, client_id, date, description, amount, vat_amount, total, status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`
      ).run(workId, client.id, item.date || date, item.description, amount, vat, round2(amount + vat), input.source || 'api');
      workIds.push(workId);
    }

    if (workIds.length === 0)
      throw Object.assign(new Error('invoice needs at least one work or line item'), { status: 400 });

    const sums = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS subtotal, COALESCE(SUM(vat_amount),0) AS vat, COALESCE(SUM(total),0) AS total
         FROM works WHERE id IN (${workIds.map(() => '?').join(',')})`
      )
      .get(...workIds) as { subtotal: number; vat: number; total: number };

    const number = input.number?.trim() || nextInvoiceNumber();
    db.prepare(
      `INSERT INTO invoices (id, number, doc_type, client_id, date, due_date, subtotal, vat_amount, total, status, external_id, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`
    ).run(
      invoiceId,
      number,
      input.docType ?? DOC_TYPE.TAX_INVOICE,
      client.id,
      date,
      input.dueDate ?? null,
      round2(sums.subtotal),
      round2(sums.vat),
      round2(sums.total),
      input.externalId ?? null,
      input.source || 'app',
      input.notes ?? null
    );

    db.prepare(
      `UPDATE works SET status = 'invoiced', invoice_id = ? WHERE id IN (${workIds.map(() => '?').join(',')})`
    ).run(invoiceId, ...workIds);

    return getInvoice(invoiceId);
  });

  return tx();
}

/** Marking an invoice paid cascades to all works bound to it. */
export function setInvoiceStatus(invoiceId: string, status: 'issued' | 'paid' | 'cancelled', paidDate?: string) {
  const tx = db.transaction(() => {
    const invoice = db.prepare('SELECT id, status FROM invoices WHERE id = ?').get(invoiceId) as
      | { id: string; status: string }
      | undefined;
    if (!invoice) throw Object.assign(new Error('invoice not found'), { status: 404 });

    if (status === 'paid') {
      db.prepare("UPDATE invoices SET status = 'paid', paid_date = ? WHERE id = ?").run(
        paidDate || new Date().toISOString().slice(0, 10),
        invoiceId
      );
      db.prepare("UPDATE works SET status = 'paid' WHERE invoice_id = ?").run(invoiceId);
    } else if (status === 'cancelled') {
      db.prepare("UPDATE invoices SET status = 'cancelled', paid_date = NULL WHERE id = ?").run(invoiceId);
      // Release works back to the unpaid pool so they can be re-invoiced.
      db.prepare("UPDATE works SET status = 'unpaid', invoice_id = NULL WHERE invoice_id = ?").run(invoiceId);
    } else {
      db.prepare("UPDATE invoices SET status = 'issued', paid_date = NULL WHERE id = ?").run(invoiceId);
      db.prepare("UPDATE works SET status = 'invoiced' WHERE invoice_id = ?").run(invoiceId);
    }
    return getInvoice(invoiceId);
  });
  return tx();
}

/**
 * Removes an invoice that only ever existed here.
 *
 * A document issued to Morning has a real, sequential number in the state's books — it can be
 * credited, never deleted — so deletion is refused the moment `external_id` is set. What is
 * left are the provisional `AM-*` rows: a selection that turned out wrong, or an issue that
 * was abandoned half-way. Their works go back to the unpaid pool so they can be billed again,
 * which is the whole point of getting rid of the invoice.
 */
export function deleteInvoice(invoiceId: string) {
  const tx = db.transaction(() => {
    const invoice = db.prepare('SELECT id, number, external_id FROM invoices WHERE id = ?').get(invoiceId) as
      | { id: string; number: string; external_id: string | null }
      | undefined;
    if (!invoice) throw Object.assign(new Error('invoice not found'), { status: 404 });
    if (invoice.external_id)
      throw Object.assign(
        new Error(`חשבונית ${invoice.number} הונפקה ב-Morning — אפשר רק להוציא לה זיכוי, לא למחוק אותה`),
        { status: 409 }
      );

    const released = db
      .prepare("UPDATE works SET status = 'unpaid', invoice_id = NULL WHERE invoice_id = ?")
      .run(invoiceId).changes;
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
    return { deleted: invoiceId, number: invoice.number, released };
  });
  return tx();
}

export function getInvoice(id: string) {
  const invoice = db
    .prepare(
      `SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
    )
    .get(id);
  if (!invoice) return null;
  const works = db.prepare('SELECT * FROM works WHERE invoice_id = ? ORDER BY date').all(id);
  return { ...(invoice as object), works };
}
