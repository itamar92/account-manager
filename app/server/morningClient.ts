/**
 * Green Invoice (Morning) REST client.
 *
 * Credentials come from the environment — `GREEN_INVOICE_ID` / `GREEN_INVOICE_SECRET`,
 * the same pair `scripts/build_havila.py` uses. Set `GREEN_INVOICE_BASE_URL` to the
 * sandbox host to try the write path without issuing real documents.
 */

const BASE_URL = process.env.GREEN_INVOICE_BASE_URL || 'https://api.greeninvoice.co.il/api/v1';

export interface MorningDocument {
  id: string;
  number: string;
  type: number;
  documentDate: string; // YYYY-MM-DD
  dueDate?: string | null;
  status: number; // 0 = open, 1 = closed/paid, anything else treated as cancelled
  amount: number; // total, including VAT
  vat?: number;
  currency?: string;
  client?: { id?: string; name?: string };
  income?: Array<{ description?: string; quantity?: number; price?: number; amount?: number }>;
  url?: { origin?: string } | string;
  remarks?: string;
}

export class MorningError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function isMorningConfigured(): boolean {
  return Boolean(process.env.GREEN_INVOICE_ID && process.env.GREEN_INVOICE_SECRET);
}

// Tokens are valid for a while; cache until shortly before expiry to avoid re-auth per call.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  if (!isMorningConfigured())
    throw new MorningError('Morning לא מוגדר — חסרים GREEN_INVOICE_ID / GREEN_INVOICE_SECRET', 503);

  const res = await fetch(`${BASE_URL}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: process.env.GREEN_INVOICE_ID, secret: process.env.GREEN_INVOICE_SECRET }),
  });
  if (!res.ok) throw new MorningError(`Morning auth failed (${res.status}): ${await res.text()}`, 502);

  const body = (await res.json()) as { token?: string; expires?: number };
  if (!body.token) throw new MorningError('Morning auth returned no token');
  // `expires` is a unix timestamp in seconds; fall back to 50 minutes if absent.
  const expiresAt = body.expires ? body.expires * 1000 : Date.now() + 50 * 60_000;
  cachedToken = { token: body.token, expiresAt };
  return body.token;
}

/** Drops the cached token — used by tests and after an auth-related failure. */
export function resetTokenCache() {
  cachedToken = null;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401) {
    // Token may have been revoked early — clear it so the next call re-authenticates.
    resetTokenCache();
    throw new MorningError('Morning rejected the credentials (401)', 502);
  }
  if (!res.ok) throw new MorningError(`Morning ${method} ${path} failed (${res.status}): ${await res.text()}`, 502);
  return (await res.json()) as T;
}

export interface SearchDocumentsOptions {
  fromDate?: string;
  toDate?: string;
  types?: number[];
  page?: number;
  pageSize?: number;
}

/** One page of documents. Prefer `searchAllDocuments` unless you need manual paging. */
export async function searchDocuments(opts: SearchDocumentsOptions = {}) {
  return request<{ items?: MorningDocument[]; total?: number; pages?: number }>('POST', '/documents/search', {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 100,
    ...(opts.fromDate ? { fromDate: opts.fromDate } : {}),
    ...(opts.toDate ? { toDate: opts.toDate } : {}),
    ...(opts.types?.length ? { type: opts.types } : {}),
    sort: 'documentDate',
    sortOrder: 'desc',
  });
}

/** Walks every page of the document search, with a hard page cap as a runaway guard. */
export async function searchAllDocuments(opts: SearchDocumentsOptions = {}): Promise<MorningDocument[]> {
  const pageSize = opts.pageSize ?? 100;
  const all: MorningDocument[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await searchDocuments({ ...opts, page, pageSize });
    const items = res.items ?? [];
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}

export async function getDocument(id: string): Promise<MorningDocument> {
  return request<MorningDocument>('GET', `/documents/${encodeURIComponent(id)}`);
}

export interface CreateDocumentInput {
  type: number;
  clientName: string;
  clientId?: string;
  clientEmails?: string[];
  clientTaxId?: string;
  lines: Array<{ description: string; price: number; quantity?: number }>;
  date?: string;
  dueDate?: string;
  /** "שם המסמך" — the subject line printed at the head of the document. */
  description?: string;
  currency?: string;
  /** "הערות" — free text printed at the foot of the document. */
  remarks?: string;
  /** Green Invoice emails the document to the client when true. Off by default. */
  sendEmail?: boolean;
}

export async function createDocument(input: CreateDocumentInput): Promise<MorningDocument> {
  const currency = input.currency || 'ILS';
  const emails = (input.clientEmails ?? []).filter(Boolean);
  return request<MorningDocument>('POST', '/documents', {
    type: input.type,
    lang: 'he',
    client: {
      ...(input.clientId ? { id: input.clientId } : {}),
      name: input.clientName,
      add: !input.clientId, // let Morning create the client when we have no id for it
      ...(emails.length ? { emails } : {}),
      ...(input.clientTaxId ? { taxId: input.clientTaxId } : {}),
    },
    currency,
    date: input.date,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.description ? { description: input.description } : {}),
    income: input.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity ?? 1,
      price: l.price,
      currency,
    })),
    ...(input.remarks ? { remarks: input.remarks } : {}),
    // Only ever emailed on an explicit request, and only when there is an address to use.
    sendEmail: Boolean(input.sendEmail && emails.length),
  });
}

export async function listClients() {
  return request<{ items?: Array<{ id: string; name: string }> }>('POST', '/clients/search', {
    page: 1,
    pageSize: 100,
  });
}

/** Cheap connectivity probe — authenticates without touching document data. */
export async function ping(): Promise<boolean> {
  await getToken();
  return true;
}

export function documentUrl(doc: MorningDocument): string | null {
  if (typeof doc.url === 'string') return doc.url;
  if (doc.url?.origin) return doc.url.origin;
  return doc.id ? `https://app.greeninvoice.co.il/documents/${doc.id}` : null;
}
