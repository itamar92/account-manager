import { db, uuid, getVatPercent, getMorningSyncDays, setSetting, getSetting } from './db.js';
import {
  REVENUE_DOC_TYPES, CREDIT_DOC_TYPES, isRevenueDoc, DOC_TYPE,
  ISSUABLE_DOC_TYPES, issuableDocTypeOptions,
} from './docTypes.js';
import { computeDueDate, createInvoice } from './invoiceService.js';
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
        // Morning's own "still owed" figure, kept as it comes. A document it has closed against
        // a receipt reports 0 here whatever its status says, which is what the collection
        // figures are counted from.
        const openAmount = typeof doc.amountOpened === 'number' ? round2(doc.amountOpened) : null;
        const date = (doc.documentDate || '').slice(0, 10) || to;

        if (existing) {
          db.prepare(
            `UPDATE invoices SET number = ?, doc_type = ?, date = ?, due_date = ?,
               subtotal = ?, vat_amount = ?, total = ?, status = ?, open_amount = ?,
               paid_date = CASE WHEN ? = 'paid' THEN COALESCE(paid_date, ?) ELSE NULL END
             WHERE id = ?`
          ).run(
            String(doc.number ?? ''), doc.type, date, doc.dueDate ?? null,
            subtotal, vat, total, status, openAmount, status, date, existing.id
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
             status, open_amount, paid_date, external_id, source, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'morning', ?)`
        ).run(
          invoiceId, String(doc.number ?? ''), doc.type, clientId, date, doc.dueDate ?? null,
          subtotal, vat, total, status, openAmount, status === 'paid' ? date : null,
          doc.id, doc.remarks ?? null
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

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  tax_id: string | null;
  phone: string | null;
  payment_terms_days: number;
};

function loadClientForIssue(clientId: string): ClientRow {
  const client = db
    .prepare('SELECT id, name, email, tax_id, phone, payment_terms_days FROM clients WHERE id = ?')
    .get(clientId) as ClientRow | undefined;
  if (!client) throw new MorningError('לקוח לא נמצא', 404);
  return client;
}

/**
 * The works a document is about to be issued for, before any invoice exists to hold them.
 *
 * Every one of them is checked here rather than after Morning has been called: a document
 * Morning has issued cannot be taken back, so a work that is already on another invoice has
 * to stop the issue while stopping it still costs nothing.
 */
function loadWorksForIssue(clientId: string, workIds: string[]): WorkRow[] {
  const ids = [...new Set((workIds ?? []).filter(Boolean))];
  if (!ids.length) throw new MorningError('לא נבחרו עבודות למסמך', 400);

  const rows = db
    .prepare(
      `SELECT id, date, description, amount, vat_amount, total, client_id, status
       FROM works WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY date`
    )
    .all(...ids) as Array<WorkRow & { client_id: string; status: string }>;

  if (rows.length !== ids.length) throw new MorningError('חלק מהעבודות שנבחרו לא נמצאו', 404);
  for (const work of rows) {
    if (work.client_id !== clientId)
      throw new MorningError(`«${work.description}» שייכת ללקוח אחר`, 400);
    if (work.status !== 'unpaid')
      throw new MorningError(`«${work.description}» כבר משויכת לחשבונית`, 409);
  }
  return rows.map(({ id, date, description, amount, vat_amount, total }) => ({
    id, date, description, amount, vat_amount, total,
  }));
}

/** 'YYYY-MM-DD' as it is written on an Israeli document. */
function heDate(iso?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/**
 * One line as Morning will store it.
 *
 * A Morning document line has a description and a price and nothing else — there is no date
 * column to put a work's date in. A month of gigs listed as bare descriptions loses the one
 * thing that tells two identical ones apart, so the date is folded into the text itself:
 * «הופעה בהאנגר (14/03/2026)».
 */
export function morningLineDescription(work: { description: string; date?: string | null }): string {
  const text = (work.description || '').trim();
  const date = heDate(work.date);
  if (!date) return text;
  if (!text) return date;
  // A description that already ends with its own date is left alone rather than given it twice.
  return text.endsWith(`(${date})`) ? text : `${text} (${date})`;
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
  /** `null` while the works have no invoice yet — the document is what will create one. */
  invoiceId: string | null;
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
 * The dialog's contents, from whichever side the document is being issued: an invoice that
 * already exists here, or a set of works that has no invoice yet. Both end up at the same
 * `createDocument` call, so both are described by the same draft.
 *
 * The totals are summed from the works rather than read off an invoice row — the two agree
 * by construction, and summing is the one form that also works before there is a row.
 */
function assembleDraft(base: {
  invoiceId: string | null;
  number: string;
  client: { id: string; name: string; email: string | null; taxId: string | null; phone: string | null };
  termsDays: number;
  docType: number;
  date: string;
  dueDate: string | null;
  remarks: string;
  works: WorkRow[];
}): MorningDraft {
  const { works } = base;
  const sum = (pick: (w: WorkRow) => number) => round2(works.reduce((total, w) => total + (Number(pick(w)) || 0), 0));

  return {
    invoiceId: base.invoiceId,
    number: base.number,
    configured: isMorningConfigured(),
    business: getBusinessDetails(),
    docType: ISSUABLE_DOC_TYPES.includes(base.docType) ? base.docType : DOC_TYPE.TAX_INVOICE,
    docTypes: issuableDocTypeOptions(),
    date: base.date,
    dueDate: base.dueDate || computeDueDate(base.date, base.termsDays),
    paymentTermsDays: base.termsDays,
    description: defaultDocumentName(works),
    remarks: base.remarks,
    client: {
      id: base.client.id,
      name: base.client.name,
      email: base.client.email || '',
      taxId: base.client.taxId || '',
      phone: base.client.phone || '',
    },
    lines: works.map((w) => ({
      id: w.id,
      date: w.date,
      description: w.description,
      amount: w.amount,
      vatAmount: w.vat_amount,
      total: w.total,
    })),
    subtotal: sum((w) => w.amount),
    vatAmount: sum((w) => w.vat_amount),
    total: sum((w) => w.total),
    vatPercent: getVatPercent(),
  };
}

/**
 * Everything the issue dialog needs to open pre-filled — the same values `pushInvoiceToMorning`
 * would use on its own, so confirming the dialog untouched issues exactly what the plain
 * push would have.
 */
export function buildMorningDraft(invoiceId: string): MorningDraft {
  const invoice = loadInvoiceForPush(invoiceId);
  return assembleDraft({
    invoiceId,
    number: invoice.number,
    client: {
      id: invoice.client_id,
      name: invoice.client_name,
      email: invoice.client_email,
      taxId: invoice.client_tax_id,
      phone: invoice.client_phone,
    },
    termsDays: invoice.payment_terms_days ?? 30,
    docType: invoice.doc_type,
    date: invoice.date,
    dueDate: invoice.due_date,
    remarks: invoice.notes || '',
    works: loadWorksForPush(invoiceId),
  });
}

/**
 * The same dialog, for works that have not been invoiced at all.
 *
 * There is no local invoice behind this one and no `AM-*` number to show: the document is
 * what will create the invoice, so the fields are defaulted from the client and today's date
 * instead of read off a row.
 */
export function buildPendingMorningDraft(input: { clientId: string; workIds: string[] }): MorningDraft {
  const client = loadClientForIssue(input.clientId);
  const today = new Date().toISOString().slice(0, 10);
  return assembleDraft({
    invoiceId: null,
    number: '',
    client: { id: client.id, name: client.name, email: client.email, taxId: client.tax_id, phone: client.phone },
    termsDays: client.payment_terms_days ?? 30,
    docType: DOC_TYPE.TAX_INVOICE,
    date: today,
    dueDate: null,
    remarks: '',
    works: loadWorksForIssue(input.clientId, input.workIds),
  });
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
  const fields = resolveDocumentFields(
    {
      docType: invoice.doc_type,
      date: invoice.date,
      dueDate: invoice.due_date,
      termsDays: invoice.payment_terms_days ?? 30,
      clientEmail: invoice.client_email,
    },
    options
  );

  const doc = await issueDocument({
    client: { name: invoice.client_name, taxId: invoice.client_tax_id },
    works,
    fields,
  });

  db.prepare(
    `UPDATE invoices SET external_id = ?, number = ?, doc_type = ?, date = ?, due_date = ?,
       notes = ?, source = ? WHERE id = ?`
  ).run(
    doc.id, String(doc.number ?? invoice.number), doc.type ?? fields.docType, fields.date, fields.dueDate,
    fields.remarks || invoice.notes, 'morning', invoiceId
  );

  rememberClientEmail(invoice.client_id, invoice.client_email, fields.email);

  return {
    invoiceId,
    documentId: doc.id,
    documentNumber: String(doc.number ?? ''),
    url: documentUrl(doc),
  };
}

/**
 * Issues a document for works that have no invoice yet, and creates the local invoice from
 * what Morning returned.
 *
 * This is the way round an invoice is meant to be made here. Creating the local row first
 * left an `AM-*` invoice behind every time an issue was abandoned or refused, and those rows
 * are indistinguishable in a list from documents that really exist. So nothing is written
 * until Morning has issued the document, and what is written then carries Morning's own
 * number rather than a provisional one.
 */
export async function issueWorksToMorning(
  input: { clientId: string; workIds: string[] } & PushInvoiceOptions
): Promise<{ result: PushResult; invoice: any }> {
  const client = loadClientForIssue(input.clientId);
  const works = loadWorksForIssue(input.clientId, input.workIds);
  const today = new Date().toISOString().slice(0, 10);
  const fields = resolveDocumentFields(
    {
      docType: DOC_TYPE.TAX_INVOICE,
      date: today,
      dueDate: null,
      termsDays: client.payment_terms_days ?? 30,
      clientEmail: client.email,
    },
    input
  );

  const doc = await issueDocument({
    client: { name: client.name, taxId: client.tax_id },
    works,
    fields,
  });

  // Past this point the document exists and cannot be withdrawn. A local write that fails
  // now is reported as exactly that — with the number to look the document up by — rather
  // than as a failure to issue, which would invite issuing it a second time.
  let invoice: any;
  try {
    invoice = createInvoice({
      clientId: client.id,
      workIds: works.map((w) => w.id),
      date: fields.date,
      dueDate: fields.dueDate,
      docType: doc.type ?? fields.docType,
      externalId: doc.id,
      number: doc.number != null ? String(doc.number) : undefined,
      notes: fields.remarks || undefined,
      source: 'morning',
    });
  } catch (err: any) {
    throw new MorningError(
      `המסמך הונפק ב-Morning (מספר ${doc.number ?? doc.id}) אבל לא נשמר כאן: ${err.message}. ` +
        'סנכרון מ-Morning ימשוך אותו.',
      500
    );
  }

  rememberClientEmail(client.id, client.email, fields.email);

  return {
    result: {
      invoiceId: invoice.id,
      documentId: doc.id,
      documentNumber: String(doc.number ?? ''),
      url: documentUrl(doc),
    },
    invoice,
  };
}

/** The document's own fields, validated before anything is sent to Morning. */
function resolveDocumentFields(
  base: { docType: number; date: string; dueDate: string | null; termsDays: number; clientEmail: string | null },
  options: PushInvoiceOptions
) {
  const docType = options.docType ?? base.docType ?? DOC_TYPE.TAX_INVOICE;
  if (!ISSUABLE_DOC_TYPES.includes(docType))
    throw new MorningError(`סוג מסמך ${docType} לא ניתן להנפקה מכאן`, 400);

  const date = options.date || base.date;
  const dueDate = options.dueDate || base.dueDate || computeDueDate(date, base.termsDays);
  if (dueDate < date) throw new MorningError('תאריך התשלום מוקדם מתאריך המסמך', 400);

  const email = (options.clientEmail ?? base.clientEmail ?? '').trim();
  if (email && !EMAIL_RE.test(email)) throw new MorningError('כתובת המייל של הלקוח לא תקינה', 400);
  if (options.sendEmail && !email)
    throw new MorningError('אי אפשר לשלוח את המסמך במייל בלי כתובת מייל ללקוח', 400);

  return {
    docType,
    date,
    dueDate,
    email,
    remarks: (options.remarks || '').trim(),
    description: (options.description || '').trim(),
    sendEmail: Boolean(options.sendEmail),
  };
}

type DocumentFields = ReturnType<typeof resolveDocumentFields>;

/** The one call that actually issues — both paths reach Morning through here. */
async function issueDocument(input: {
  client: { name: string; taxId: string | null };
  works: WorkRow[];
  fields: DocumentFields;
}): Promise<MorningDocument> {
  const { client, works, fields } = input;
  const doc = await createDocument({
    type: fields.docType,
    clientName: client.name,
    clientEmails: fields.email ? [fields.email] : [],
    clientTaxId: client.taxId || undefined,
    date: fields.date,
    dueDate: fields.dueDate,
    description: fields.description || undefined,
    remarks: fields.remarks || undefined,
    sendEmail: fields.sendEmail,
    lines: works.map((w) => ({ description: morningLineDescription(w), price: w.amount })),
  });
  if (!doc?.id) throw new MorningError('Morning לא החזיר מזהה מסמך');
  return doc;
}

/**
 * Fills a gap, never overwrites: an address typed into the dialog is what makes the client's
 * email auto-fill next time round.
 */
function rememberClientEmail(clientId: string, existing: string | null, email: string) {
  if (email && !existing) db.prepare('UPDATE clients SET email = ? WHERE id = ?').run(email, clientId);
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
