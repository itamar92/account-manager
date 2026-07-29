import { db, uuid, getVatPercent, getMorningSyncDays, setSetting, getSetting } from './db.js';
import { REVENUE_DOC_TYPES, CREDIT_DOC_TYPES, isRevenueDoc, DOC_TYPE } from './docTypes.js';
import {
  createDocument, documentUrl, isMorningConfigured, MorningError, searchAllDocuments, type MorningDocument,
} from './morningClient.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Green Invoice status codes → our invoice lifecycle. */
function mapStatus(doc: MorningDocument): 'issued' | 'paid' | 'cancelled' {
  if (doc.status === 1) return 'paid';
  if (doc.status === 3 || doc.status === -1) return 'cancelled';
  return 'issued';
}

function resolveClientByName(name: string): string {
  const clean = (name || 'לקוח ללא שם').trim();
  const existing = db.prepare('SELECT id FROM clients WHERE name = ?').get(clean) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = uuid();
  db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, clean);
  return id;
}

/**
 * Splits a Morning document total into pre-VAT and VAT.
 * Morning returns `vat` on most documents; when it doesn't, we back it out of the total
 * using the configured rate rather than reporting the whole amount as pre-VAT.
 */
function splitVat(doc: MorningDocument): { subtotal: number; vat: number; total: number } {
  const total = Number(doc.amount) || 0;
  if (typeof doc.vat === 'number') {
    const vat = round2(doc.vat);
    return { subtotal: round2(total - vat), vat, total: round2(total) };
  }
  const rate = getVatPercent();
  const subtotal = round2(total / (1 + rate / 100));
  return { subtotal, vat: round2(total - subtotal), total: round2(total) };
}

export interface PullResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  from: string;
  to: string;
}

/**
 * Pulls documents from Morning into the local database, upserting on the Morning
 * document id (`invoices.external_id`).
 *
 * Locally-edited financial data is never clobbered: an existing invoice only has its
 * status, dates and totals refreshed. Works are created for revenue documents that
 * don't have any yet, so every invoice line traces back to a work row.
 */
export function pullFromMorning(options: { days?: number } = {}): Promise<PullResult> {
  const days = options.days ?? getMorningSyncDays();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  return searchAllDocuments({
    fromDate: from,
    toDate: to,
    types: [...REVENUE_DOC_TYPES, ...CREDIT_DOC_TYPES, DOC_TYPE.PROFORMA],
  }).then((docs) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const tx = db.transaction(() => {
      for (const doc of docs) {
        if (!doc.id) {
          skipped++;
          continue;
        }
        const existing = db.prepare('SELECT id FROM invoices WHERE external_id = ?').get(doc.id) as
          | { id: string }
          | undefined;

        const { subtotal, vat, total } = splitVat(doc);
        const status = mapStatus(doc);
        const date = (doc.documentDate || '').slice(0, 10) || to;

        if (existing) {
          db.prepare(
            `UPDATE invoices SET number = ?, doc_type = ?, date = ?, due_date = ?,
               subtotal = ?, vat_amount = ?, total = ?, status = ?,
               paid_date = CASE WHEN ? = 'paid' THEN COALESCE(paid_date, ?) ELSE NULL END
             WHERE id = ?`
          ).run(
            String(doc.number ?? ''), doc.type, date, doc.dueDate ?? null,
            subtotal, vat, total, status, status, date, existing.id
          );
          updated++;
          syncWorkStatuses(existing.id, status);
          continue;
        }

        const invoiceId = uuid();
        const clientId = resolveClientByName(doc.client?.name || '');
        db.prepare(
          `INSERT INTO invoices (id, number, doc_type, client_id, date, due_date, subtotal, vat_amount, total,
             status, paid_date, external_id, source, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'morning', ?)`
        ).run(
          invoiceId, String(doc.number ?? ''), doc.type, clientId, date, doc.dueDate ?? null,
          subtotal, vat, total, status, status === 'paid' ? date : null, doc.id, doc.remarks ?? null
        );

        // Proformas mirror a sale a tax document already records, and a cancelled document
        // never earned anything — neither should produce work rows.
        if (isRevenueDoc(doc.type) && status !== 'cancelled')
          createWorksForDocument(invoiceId, clientId, doc, date, status);
        created++;
      }
      setSetting('morning_last_sync', new Date().toISOString());
    });

    tx();
    return { fetched: docs.length, created, updated, skipped, from, to };
  });
}

/** Keeps an invoice's works in step with a status change that came from Morning. */
function syncWorkStatuses(invoiceId: string, status: 'issued' | 'paid' | 'cancelled') {
  if (status === 'cancelled') {
    db.prepare("UPDATE works SET status = 'unpaid', invoice_id = NULL WHERE invoice_id = ?").run(invoiceId);
  } else {
    db.prepare('UPDATE works SET status = ? WHERE invoice_id = ?').run(
      status === 'paid' ? 'paid' : 'invoiced',
      invoiceId
    );
  }
}

/** Turns a Morning document's income lines into work rows bound to the invoice. */
function createWorksForDocument(
  invoiceId: string,
  clientId: string,
  doc: MorningDocument,
  date: string,
  status: 'issued' | 'paid'
) {
  const rate = getVatPercent();
  const workStatus = status === 'paid' ? 'paid' : 'invoiced';
  const lines = (doc.income ?? []).filter((l) => l && (l.price != null || l.amount != null));

  // Documents without line detail still get one work row so the invoice is never empty.
  const rows = lines.length
    ? lines.map((l) => ({
        description: l.description || `מסמך #${doc.number ?? ''}`,
        amount: round2((Number(l.price ?? l.amount) || 0) * (l.quantity ?? 1)),
      }))
    : [{ description: `מסמך #${doc.number ?? ''}`, amount: round2((Number(doc.amount) || 0) / (1 + rate / 100)) }];

  const insert = db.prepare(
    `INSERT INTO works (id, client_id, date, description, amount, vat_amount, total, status, invoice_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'morning')`
  );
  for (const row of rows) {
    const vat = round2((row.amount * rate) / 100);
    insert.run(
      uuid(), clientId, date, row.description, row.amount, vat, round2(row.amount + vat),
      workStatus, invoiceId
    );
  }
}

export interface PushResult {
  invoiceId: string;
  documentId: string;
  documentNumber: string;
  url: string | null;
}

/**
 * Issues a local invoice as a real document in Morning and adopts the number Morning
 * assigns, replacing the provisional `AM-*` number.
 */
export async function pushInvoiceToMorning(invoiceId: string, docType?: number): Promise<PushResult> {
  const invoice = db
    .prepare(
      `SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
    )
    .get(invoiceId) as any;
  if (!invoice) throw new MorningError('invoice not found', 404);
  if (invoice.external_id)
    throw new MorningError(`החשבונית כבר קיימת ב-Morning (${invoice.external_id})`, 409);
  if (invoice.status === 'cancelled') throw new MorningError('אי אפשר לשלוח חשבונית מבוטלת', 400);

  const works = db.prepare('SELECT description, amount FROM works WHERE invoice_id = ? ORDER BY date').all(
    invoiceId
  ) as Array<{ description: string; amount: number }>;
  if (!works.length) throw new MorningError('לחשבונית אין שורות לשליחה', 400);

  const doc = await createDocument({
    type: docType ?? invoice.doc_type ?? DOC_TYPE.TAX_INVOICE,
    clientName: invoice.client_name,
    date: invoice.date,
    lines: works.map((w) => ({ description: w.description, price: w.amount })),
  });
  if (!doc?.id) throw new MorningError('Morning לא החזיר מזהה מסמך');

  db.prepare('UPDATE invoices SET external_id = ?, number = ?, doc_type = ?, source = ? WHERE id = ?').run(
    doc.id, String(doc.number ?? invoice.number), doc.type ?? invoice.doc_type, 'morning', invoiceId
  );

  return {
    invoiceId,
    documentId: doc.id,
    documentNumber: String(doc.number ?? ''),
    url: documentUrl(doc),
  };
}

export function morningStatus() {
  return {
    configured: isMorningConfigured(),
    last_sync: getSetting('morning_last_sync', '') || null,
    sync_days: getMorningSyncDays(),
    synced_invoices: (
      db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE source = 'morning'").get() as { n: number }
    ).n,
  };
}
