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
  amountOpened?: number; // of that total, what is still owed
  vat?: number;
  currency?: string;
  client?: { id?: string; name?: string; emails?: string[] };
  income?: Array<{ description?: string; quantity?: number; price?: number; amount?: number }>;
  url?: { origin?: string } | string;
  remarks?: string;
}

export class MorningError extends Error {
  status: number;
  /** Morning's own `errorCode`, when the failure came back as one of its error bodies. */
  code?: number;
  constructor(message: string, status = 502, code?: number) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Morning's refusal, said in words.
 *
 * A rejected call comes back as `{"errorCode": 3010, "errorMessage": "..."}`. Reporting that
 * as a bare 502 is what turned "the document is missing its payment details" into an
 * unreadable gateway error on screen, so the message is unwrapped and a request Morning
 * found invalid is reported as 422 — the caller's problem, not the gateway's.
 */
function morningFailure(method: string, path: string, status: number, body: string): MorningError {
  let code: number | undefined;
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.errorMessage ?? parsed?.message ?? parsed?.error;
    if (typeof parsed?.errorCode === 'number') code = parsed.errorCode;
    if (message) detail = String(message);
  } catch {
    // Not JSON — an HTML error page or an empty body. The raw text is all there is to say.
  }
  // 4xx is Morning telling us the request is wrong; only 5xx is Morning itself being broken.
  const outward = status >= 400 && status < 500 ? 422 : 502;
  const suffix = code != null ? ` (שגיאה ${code})` : '';
  return new MorningError(
    `Morning דחה את הבקשה${suffix}: ${detail || `${method} ${path} החזיר ${status}`}`,
    outward,
    code
  );
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
  if (!res.ok) throw morningFailure(method, path, res.status, await res.text());
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

/**
 * The סיווג an expense is filed under — what Morning's own UI calls the expense type, and
 * what its API returns as an `accountingClassification`.
 *
 * It comes back as an **object**, and the human-readable name is in `title`. Reading it as
 * a scalar is what put "[object Object]" in the category column. Older or partial payloads
 * have also sent a bare id, so both are accepted and the scalar is looked up in the
 * classifications map.
 */
export interface MorningClassification {
  id?: number | string;
  key?: string;
  code?: number | string;
  title?: string;
  name?: string;
}

/**
 * An expense (הוצאה) — a document received from a supplier, as Morning returns it.
 *
 * Its shape is looser than a document's: the date arrives as `documentDate` or `date`, the
 * supplier as an object or as a bare name. Every alternative is optional here so the mapper
 * can read whichever the account actually sends.
 *
 * Two fields differ from an issued document's and are easy to get wrong:
 * - the document type is `documentType`, not `type` (it carries the same 300/305/320/400
 *   codes as issued documents, not a status-style enum);
 * - whether the expense has been reported (דווח) is **not** confirmed to live in any one
 *   field. A live account sends `status: 10` on every expense and no `reported` flag at
 *   all, so 10/20 is either an enum this app has the wrong labels for or a state that has
 *   nothing to do with reporting — the payload also carries `paymentAmountLocal: 0` and no
 *   `paymentDate` alongside it, which would fit an unpaid/paid pair just as well. Every
 *   spelling below is therefore optional and read only when present, and `mapStatus`
 *   asserts nothing from a payload carrying none of them rather than calling the expense
 *   open. `bin/expense-status-probe.ts` prints what an account actually sends.
 *
 * `reportingDate` is the one field here that is unambiguously about reporting: the first of
 * the month of the מע"מ period the expense is filed under, which Morning lets you set apart
 * from the document's own date. It says which period will report the expense, not that any
 * period has.
 */
export interface MorningExpense {
  id: string;
  number?: string;
  documentType?: number | string;
  /** Legacy/alternate spelling of `documentType`; read only as a fallback. */
  type?: number | string;
  documentDate?: string; // YYYY-MM-DD
  date?: string;
  paymentDate?: string | null;
  /** First of the month of the מע"מ period the expense is filed under. */
  reportingDate?: string | null;
  /** Believed to be 10 = open, 20 = reported. Sent as a number, but tolerated as a string. */
  status?: number | string;
  /** The same fact as a flag: true = reported. Also accepted as 0/1 or "true"/"false". */
  reported?: boolean | number | string;
  isReported?: boolean | number | string;
  /** A report the expense was filed in. An id or a date present at all means reported. */
  reportId?: string | number | null;
  vatReportId?: string | number | null;
  reportedAt?: string | null;
  reportDate?: string | null;
  amount?: number;
  vat?: number;
  amountTotal?: number;
  /** The total before VAT, stated rather than left to be worked out from `amount` - `vat`. */
  amountExcludeVat?: number;
  /**
   * What of the expense may actually be set against the business's books, after the
   * classification's deduction percentage. Not read yet — see the note in `money`.
   */
  deductibleAmount?: number;
  deductibleVat?: number;
  currency?: string;
  currencyRate?: number;
  supplier?: { id?: string; name?: string; taxId?: string };
  supplierName?: string;
  accountingClassification?: MorningClassification | number | string;
  category?: MorningClassification | string;
  description?: string;
  remarks?: string;
}

export interface SearchExpensesOptions {
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** One page of expenses. Prefer `searchAllExpenses` unless you need manual paging. */
export async function searchExpenses(opts: SearchExpensesOptions = {}) {
  return request<{ items?: MorningExpense[]; total?: number; pages?: number }>('POST', '/expenses/search', {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 100,
    ...(opts.fromDate ? { fromDate: opts.fromDate } : {}),
    ...(opts.toDate ? { toDate: opts.toDate } : {}),
  });
}

/**
 * One expense in full.
 *
 * Morning's search returns a lighter row than the record it lists, so a field missing from
 * a search result — the reported flag among them — is worth looking for here before
 * concluding the account does not send it at all.
 */
export async function getExpense(id: string): Promise<MorningExpense> {
  return request<MorningExpense>('GET', `/expenses/${encodeURIComponent(id)}`);
}

/** Walks every page of the expense search, with the same runaway guard as documents. */
export async function searchAllExpenses(opts: SearchExpensesOptions = {}): Promise<MorningExpense[]> {
  const pageSize = opts.pageSize ?? 100;
  const all: MorningExpense[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await searchExpenses({ ...opts, page, pageSize });
    const items = res.items ?? [];
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}

/**
 * id → name for the expense classifications (סיווג הוצאה) the account defines, so a synced
 * expense can show the category it was filed under rather than a bare id.
 *
 * Morning has returned this map as a list and as a plain object at different times; both
 * are read here, and an unrecognisable body simply yields no names.
 */
export async function expenseClassifications(): Promise<Map<string, string>> {
  const body = await request<any>('GET', '/accounting/classifications/map');
  const map = new Map<string, string>();
  const add = (id: unknown, name: unknown) => {
    if (id == null || id === '' || !name) return;
    map.set(String(id), String(name));
  };

  // A classification names itself with `title`; `name`/`label` are read too, since this map
  // has changed shape before and the cost of accepting all three is nothing.
  const nameOf = (value: any) => value?.title ?? value?.name ?? value?.label;

  const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : null;
  if (items) {
    for (const item of items) {
      const name = nameOf(item);
      // Indexed under every key an expense might refer to it by, so the lookup works
      // whichever of them the expense carries.
      for (const key of [item?.id, item?.key, item?.value, item?.code]) add(key, name);
    }
  } else if (body && typeof body === 'object') {
    for (const [id, value] of Object.entries(body)) {
      add(id, typeof value === 'string' ? value : nameOf(value));
    }
  }
  return map;
}

/** One row of `payment` — how the money on a receipt-bearing document came in. */
export interface DocumentPayment {
  /** Morning's payment-type code; see `PAYMENT_TYPE` in `docTypes.ts`. */
  type: number;
  date: string; // YYYY-MM-DD, never in the future
  price: number; // including VAT — what was actually received
  currency?: string;
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
  /**
   * Required by Morning for the receipt-bearing types (320/400/405) and refused as
   * meaningless on the others — `requiresPayment` in `docTypes.ts` decides which.
   */
  payment?: DocumentPayment[];
  /**
   * Whether the prices below are before VAT (0), include it (1), or are exempt (2).
   * Defaults to 0, which is what this app sends: works carry their pre-VAT amount.
   */
  vatType?: number;
}

export async function createDocument(input: CreateDocumentInput): Promise<MorningDocument> {
  const currency = input.currency || 'ILS';
  const emails = (input.clientEmails ?? []).filter(Boolean);
  const payment = input.payment ?? [];
  return request<MorningDocument>('POST', '/documents', {
    type: input.type,
    lang: 'he',
    // Stated rather than left to the account's default: an account set to "prices include
    // VAT" would otherwise read every pre-VAT figure sent here as a VAT-inclusive one and
    // bill the client ~15% short.
    vatType: input.vatType ?? 0,
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
      vatType: input.vatType ?? 0,
    })),
    // Only ever sent for the types that demand it — see `DocumentPayment`.
    ...(payment.length
      ? {
          payment: payment.map((p) => ({
            type: p.type,
            date: p.date,
            price: p.price,
            currency: p.currency || currency,
          })),
        }
      : {}),
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
