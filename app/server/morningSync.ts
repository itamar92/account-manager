import { db, uuid, getVatPercent, getMorningSyncDays, setSetting, getSetting } from './db.js';
import {
  REVENUE_DOC_TYPES, CREDIT_DOC_TYPES, isRevenueDoc, DOC_TYPE,
  ISSUABLE_DOC_TYPES, issuableDocTypeOptions,
} from './docTypes.js';
import { computeDueDate } from './invoiceService.js';
import { getBusinessDetails, type BusinessDetails } from './business.js';
import {
  createDocument, documentUrl, isMorningConfigured, MorningError, searchAllDocuments, type MorningDocument,
} from './morningClient.js';
import { expensesStatus } from './morningExpenses.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Green Invoice status codes → our invoice lifecycle. */
function mapStatus(doc: MorningDocument): 'issued' | 'paid' | 'cancelled' {
  if (doc.status === 1) return 'paid';
  if (doc.status === 3 || doc.status === -1) return 'cancelled';
  return 'issued';
}

/** Fills a client's missing email from a Morning document — never overwrites one already set. */
function fillClientEmail(clientId: string, client: MorningDocument['client']) {
  const email = (client?.emails?.[0] || '').trim();
  if (!email) return;
  db.prepare("UPDATE clients SET email = ? WHERE id = ? AND (email IS NULL OR email = '')").run(email, clientId);
}

function resolveClient(client: MorningDocument['client']): string {
  const clean = (client?.name || 'לקוח ללא שם').trim();
  const existing = db.prepare('SELECT id FROM clients WHERE name = ?').get(clean) as { id: string } | undefined;
  const id = existing?.id ?? uuid();
  if (!existing) db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, clean);
  fillClientEmail(id, client);
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
        const existing = db.prepare('SELECT id, client_id FROM invoices WHERE external_id = ?').get(doc.id) as
          | { id: string; client_id: string }
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
          // The client may have been renamed locally, so it is found by the invoice rather
          // than by name — a rename must not spawn a duplicate client here.
          fillClientEmail(existing.client_id, doc.client);
          continue;
        }

        const invoiceId = uuid();
        const clientId = resolveClient(doc.client);
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

/** The fields the issue dialog fills in, mirroring Morning's own document form. */
export interface PushInvoiceOptions {
  docType?: number;
  date?: string;
  dueDate?: string;
  /** "שם המסמך" */
  description?: string;
  /** "הערות" printed on the document */
  remarks?: string;
  clientEmail?: string;
  sendEmail?: boolean;
}

type InvoiceRow = {
  id: string;
  number: string;
  doc_type: number;
  date: string;
  due_date: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: string;
  external_id: string | null;
  notes: string | null;
  client_id: string;
  client_name: string;
  client_email: string | null;
  client_tax_id: string | null;
  client_phone: string | null;
  payment_terms_days: number;
};

type WorkRow = { id: string; date: string; description: string; amount: number; vat_amount: number; total: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadInvoiceForPush(invoiceId: string): InvoiceRow {
  const invoice = db
    .prepare(
      `SELECT i.*, c.name AS client_name, c.email AS client_email, c.tax_id AS client_tax_id,
              c.phone AS client_phone, c.payment_terms_days
       FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
    )
    .get(invoiceId) as InvoiceRow | undefined;
  if (!invoice) throw new MorningError('invoice not found', 404);
  if (invoice.external_id)
    throw new MorningError(`החשבונית כבר קיימת ב-Morning (${invoice.external_id})`, 409);
  if (invoice.status === 'cancelled') throw new MorningError('אי אפשר לשלוח חשבונית מבוטלת', 400);
  return invoice;
}

function loadWorksForPush(invoiceId: string): WorkRow[] {
  const works = db
    .prepare('SELECT id, date, description, amount, vat_amount, total FROM works WHERE invoice_id = ? ORDER BY date')
    .all(invoiceId) as WorkRow[];
  if (!works.length) throw new MorningError('לחשבונית אין שורות לשליחה', 400);
  return works;
}

/**
 * A sensible "שם המסמך" to start from: one line speaks for itself, several are summarised
 * by the period they cover — which is how a month of gigs reads on a real invoice.
 */
function defaultDocumentName(works: WorkRow[]): string {
  if (works.length === 1) return works[0].description;
  const months = [...new Set(works.map((w) => (w.date || '').slice(0, 7)).filter(Boolean))].sort();
  const label = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
  if (!months.length) return `${works.length} עבודות`;
  return months.length === 1
    ? `עבודות ${label(months[0])}`
    : `עבודות ${label(months[0])}–${label(months[months.length - 1])}`;
}

export interface MorningDraft {
  invoiceId: string;
  number: string;
  configured: boolean;
  business: BusinessDetails;
  docType: number;
  docTypes: Array<{ value: number; label: string }>;
  date: string;
  dueDate: string;
  paymentTermsDays: number;
  description: string;
  remarks: string;
  client: { id: string; name: string; email: string; taxId: string; phone: string };
  lines: Array<{ id: string; date: string; description: string; amount: number; vatAmount: number; total: number }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  vatPercent: number;
}

/**
 * Everything the issue dialog needs to open pre-filled — the same values `pushInvoiceToMorning`
 * would use on its own, so confirming the dialog untouched issues exactly what the plain
 * push would have.
 */
export function buildMorningDraft(invoiceId: string): MorningDraft {
  const invoice = loadInvoiceForPush(invoiceId);
  const works = loadWorksForPush(invoiceId);
  const termsDays = invoice.payment_terms_days ?? 30;

  return {
    invoiceId,
    number: invoice.number,
    configured: isMorningConfigured(),
    business: getBusinessDetails(),
    docType: ISSUABLE_DOC_TYPES.includes(invoice.doc_type) ? invoice.doc_type : DOC_TYPE.TAX_INVOICE,
    docTypes: issuableDocTypeOptions(),
    date: invoice.date,
    dueDate: invoice.due_date || computeDueDate(invoice.date, termsDays),
    paymentTermsDays: termsDays,
    description: defaultDocumentName(works),
    remarks: invoice.notes || '',
    client: {
      id: invoice.client_id,
      name: invoice.client_name,
      email: invoice.client_email || '',
      taxId: invoice.client_tax_id || '',
      phone: invoice.client_phone || '',
    },
    lines: works.map((w) => ({
      id: w.id,
      date: w.date,
      description: w.description,
      amount: w.amount,
      vatAmount: w.vat_amount,
      total: w.total,
    })),
    subtotal: invoice.subtotal,
    vatAmount: invoice.vat_amount,
    total: invoice.total,
    vatPercent: getVatPercent(),
  };
}

/**
 * Issues a local invoice as a real document in Morning and adopts the number Morning
 * assigns, replacing the provisional `AM-*` number.
 *
 * Whatever the dialog changed — document type, dates, subject, remarks — is written back
 * to the local invoice as well, so the two copies of the document agree.
 */
export async function pushInvoiceToMorning(
  invoiceId: string,
  options: PushInvoiceOptions = {}
): Promise<PushResult> {
  const invoice = loadInvoiceForPush(invoiceId);
  const works = loadWorksForPush(invoiceId);

  const docType = options.docType ?? invoice.doc_type ?? DOC_TYPE.TAX_INVOICE;
  if (!ISSUABLE_DOC_TYPES.includes(docType))
    throw new MorningError(`סוג מסמך ${docType} לא ניתן להנפקה מכאן`, 400);

  const date = options.date || invoice.date;
  const dueDate = options.dueDate || invoice.due_date || computeDueDate(date, invoice.payment_terms_days ?? 30);
  if (dueDate < date) throw new MorningError('תאריך התשלום מוקדם מתאריך המסמך', 400);

  const email = (options.clientEmail ?? invoice.client_email ?? '').trim();
  if (email && !EMAIL_RE.test(email)) throw new MorningError('כתובת המייל של הלקוח לא תקינה', 400);
  if (options.sendEmail && !email)
    throw new MorningError('אי אפשר לשלוח את המסמך במייל בלי כתובת מייל ללקוח', 400);

  const doc = await createDocument({
    type: docType,
    clientName: invoice.client_name,
    clientEmails: email ? [email] : [],
    clientTaxId: invoice.client_tax_id || undefined,
    date,
    dueDate,
    description: (options.description || '').trim() || undefined,
    remarks: (options.remarks || '').trim() || undefined,
    sendEmail: Boolean(options.sendEmail),
    lines: works.map((w) => ({ description: w.description, price: w.amount })),
  });
  if (!doc?.id) throw new MorningError('Morning לא החזיר מזהה מסמך');

  const remarks = (options.remarks || '').trim();
  db.prepare(
    `UPDATE invoices SET external_id = ?, number = ?, doc_type = ?, date = ?, due_date = ?,
       notes = ?, source = ? WHERE id = ?`
  ).run(
    doc.id, String(doc.number ?? invoice.number), doc.type ?? docType, date, dueDate,
    remarks || invoice.notes, 'morning', invoiceId
  );

  // Fills a gap, never overwrites: an address typed into the dialog is what makes the
  // client's email auto-fill next time round.
  if (email && !invoice.client_email)
    db.prepare('UPDATE clients SET email = ? WHERE id = ?').run(email, invoice.client_id);

  return {
    invoiceId,
    documentId: doc.id,
    documentNumber: String(doc.number ?? ''),
    url: documentUrl(doc),
  };
}

export function morningStatus() {
  const expenses = expensesStatus();
  return {
    configured: isMorningConfigured(),
    last_sync: getSetting('morning_last_sync', '') || null,
    sync_days: getMorningSyncDays(),
    synced_invoices: (
      db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE source = 'morning'").get() as { n: number }
    ).n,
    synced_expenses: expenses.synced,
    expenses_last_sync: expenses.last_sync,
  };
}
