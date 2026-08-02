/**
 * Green Invoice (Morning) document type codes.
 *
 * Only some document types recognise revenue. A single sale typically produces two
 * documents — a חשבון עסקה (300) when the work is agreed, then a חשבונית מס (320) when it
 * is billed — so summing every document double-counts the sale. The revenue set here
 * mirrors `scripts/build_havila.py`, which counts 305 + 320 only.
 */
export const DOC_TYPE = {
  PROFORMA: 300, // חשבון עסקה — not a tax document, never revenue
  INVOICE_RECEIPT: 305, // חשבונית מס קבלה
  TAX_INVOICE: 320, // חשבונית מס
  CREDIT_INVOICE: 330, // חשבונית מס זיכוי — offsets revenue
  RECEIPT: 400, // קבלה — money against a document that already recognised the revenue
} as const;

/** Document types whose amounts count as revenue. */
export const REVENUE_DOC_TYPES: number[] = [DOC_TYPE.INVOICE_RECEIPT, DOC_TYPE.TAX_INVOICE];

/** Document types that reduce revenue (stored with negative amounts). */
export const CREDIT_DOC_TYPES: number[] = [DOC_TYPE.CREDIT_INVOICE];

/** SQL fragment for use inside `WHERE doc_type IN (...)`. Values are hardcoded ints. */
export const REVENUE_DOC_TYPES_SQL = REVENUE_DOC_TYPES.join(',');

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
  [DOC_TYPE.INVOICE_RECEIPT]: 'חשבונית מס קבלה',
  [DOC_TYPE.TAX_INVOICE]: 'חשבונית מס',
  [DOC_TYPE.CREDIT_INVOICE]: 'חשבונית זיכוי',
  [DOC_TYPE.RECEIPT]: 'קבלה',
};

export const isRevenueDoc = (docType: number) => REVENUE_DOC_TYPES.includes(docType);

/** The document-type picker, in the order Morning itself lists them. */
export const issuableDocTypeOptions = () =>
  ISSUABLE_DOC_TYPES.map((value) => ({ value, label: DOC_TYPE_LABELS[value] }));
