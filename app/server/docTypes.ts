/**
 * Green Invoice (Morning) document type codes.
 *
 * The codes are Morning's own and are not negotiable: 305 is חשבונית מס and 320 is
 * חשבונית מס קבלה. They were swapped here until this app's first document was issued —
 * see `PAYMENT_DOC_TYPES` for what that cost.
 *
 * Only some document types recognise revenue. A single sale typically produces two
 * documents — a חשבון עסקה (300) when the work is agreed, then a חשבונית מס (305) when it
 * is billed — so summing every document double-counts the sale. The revenue set here
 * mirrors `scripts/build_havila.py`, which counts 305 + 320 only.
 */
export const DOC_TYPE = {
  PROFORMA: 300, // חשבון עסקה — not a tax document, never revenue
  TAX_INVOICE: 305, // חשבונית מס
  INVOICE_RECEIPT: 320, // חשבונית מס קבלה — an invoice that also receipts the money
  CREDIT_INVOICE: 330, // חשבונית מס זיכוי — offsets revenue
  RECEIPT: 400, // קבלה — money against a document that already recognised the revenue
  DONATION_RECEIPT: 405, // קבלה על תרומה — never issued here, listed for `requiresPayment`
} as const;

/**
 * Document types that record money as received, and which Morning therefore refuses to issue
 * without a `payment` array saying how it came in.
 *
 * This is the rule that made every issue from this app fail: 320 was mislabelled as a plain
 * חשבונית מס and sent as the default with no payment, and Morning rejected all of them.
 */
export const PAYMENT_DOC_TYPES: number[] = [
  DOC_TYPE.INVOICE_RECEIPT,
  DOC_TYPE.RECEIPT,
  DOC_TYPE.DONATION_RECEIPT,
];

export const requiresPayment = (docType: number) => PAYMENT_DOC_TYPES.includes(docType);

/**
 * How the money on a receipt-bearing document came in — Morning's `payment[].type`.
 * Only the means this business is actually paid by are offered.
 */
export const PAYMENT_TYPE = {
  CASH: 1,
  CHECK: 2,
  CREDIT_CARD: 3,
  BANK_TRANSFER: 4,
  PAYMENT_APP: 10,
  OTHER: 11,
} as const;

export const PAYMENT_TYPE_LABELS: Record<number, string> = {
  [PAYMENT_TYPE.BANK_TRANSFER]: 'העברה בנקאית',
  [PAYMENT_TYPE.CASH]: 'מזומן',
  [PAYMENT_TYPE.CHECK]: "צ'ק",
  [PAYMENT_TYPE.CREDIT_CARD]: 'כרטיס אשראי',
  [PAYMENT_TYPE.PAYMENT_APP]: 'אפליקציית תשלום (ביט/פייבוקס)',
  [PAYMENT_TYPE.OTHER]: 'אחר',
};

export const PAYMENT_TYPES: number[] = Object.values(PAYMENT_TYPE);

export const paymentTypeOptions = () =>
  PAYMENT_TYPES.map((value) => ({ value, label: PAYMENT_TYPE_LABELS[value] }));

/** Document types whose amounts count as revenue. */
export const REVENUE_DOC_TYPES: number[] = [DOC_TYPE.TAX_INVOICE, DOC_TYPE.INVOICE_RECEIPT];

/**
 * What "still owed" is counted from: the revenue documents, plus the חשבון עסקה that precedes
 * one. A proforma is not revenue — it is excluded everywhere income is summed — but an open one
 * is money a client has been billed for and has not paid, which is the whole question the
 * collection figures ask. Morning closes a proforma when its tax document is issued, so the two
 * are never open at once and nothing is counted twice.
 */
export const RECEIVABLE_DOC_TYPES: number[] = [...REVENUE_DOC_TYPES, DOC_TYPE.PROFORMA];

export const RECEIVABLE_DOC_TYPES_SQL = RECEIVABLE_DOC_TYPES.join(',');

/** Document types that reduce revenue (stored with negative amounts). */
export const CREDIT_DOC_TYPES: number[] = [DOC_TYPE.CREDIT_INVOICE];

/** SQL fragment for use inside `WHERE doc_type IN (...)`. Values are hardcoded ints. */
export const REVENUE_DOC_TYPES_SQL = REVENUE_DOC_TYPES.join(',');

/**
 * What a מע"מ filing or a profit figure is built from: the revenue documents plus the credit
 * invoices that undo them. The dashboard cards count revenue only — a credit is not a sale —
 * but a period's turnover has to be net of what was credited back, and a credit arrives from
 * Morning with negative amounts, so summing the set gives that netting for free.
 */
export const ACCOUNTING_DOC_TYPES: number[] = [...REVENUE_DOC_TYPES, ...CREDIT_DOC_TYPES];

export const ACCOUNTING_DOC_TYPES_SQL = ACCOUNTING_DOC_TYPES.join(',');

/**
 * Document types this app is allowed to issue from an invoice.
 *
 * Credit invoices (330) and standalone receipts (400) are deliberately absent — both
 * answer to a document that already exists, so they are not something a set of works
 * gets turned into.
 */
export const ISSUABLE_DOC_TYPES: number[] = [
  DOC_TYPE.PROFORMA,
  DOC_TYPE.TAX_INVOICE,
  DOC_TYPE.INVOICE_RECEIPT,
];

export const DOC_TYPE_LABELS: Record<number, string> = {
  [DOC_TYPE.PROFORMA]: 'חשבון עסקה',
  [DOC_TYPE.TAX_INVOICE]: 'חשבונית מס',
  [DOC_TYPE.INVOICE_RECEIPT]: 'חשבונית מס קבלה',
  [DOC_TYPE.CREDIT_INVOICE]: 'חשבונית זיכוי',
  [DOC_TYPE.RECEIPT]: 'קבלה',
  [DOC_TYPE.DONATION_RECEIPT]: 'קבלה על תרומה',
};

export const isRevenueDoc = (docType: number) => REVENUE_DOC_TYPES.includes(docType);

/** The document-type picker, in the order Morning itself lists them. */
export const issuableDocTypeOptions = () =>
  ISSUABLE_DOC_TYPES.map((value) => ({ value, label: DOC_TYPE_LABELS[value] }));
