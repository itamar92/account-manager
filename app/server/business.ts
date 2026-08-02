import { getSetting, setSetting } from './db.js';

/**
 * The business's own details — what a document's letterhead says about who issued it.
 *
 * Morning holds the authoritative copy and renders the real document from it; this is
 * kept locally so the issue preview can show the letterhead instead of an empty space
 * where it will be. Nothing here is sent to Morning.
 */
export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  osek_morshe: 'עוסק מורשה',
  osek_patur: 'עוסק פטור',
  company: 'חברה בע"מ',
};

const FIELDS = ['name', 'type', 'taxId', 'address', 'city', 'phone', 'email', 'website', 'logoUrl'] as const;
type Field = (typeof FIELDS)[number];

/** `taxId` → `business_tax_id`, `logoUrl` → `business_logo_url`. */
const settingKey = (field: Field) => `business_${field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;

export type BusinessInput = Partial<Record<Field, string>>;

export interface BusinessDetails extends Record<Field, string> {
  typeLabel: string;
  /** A letterhead needs at least a name to be worth drawing. */
  configured: boolean;
}

export function getBusinessDetails(): BusinessDetails {
  const values = Object.fromEntries(FIELDS.map((f) => [f, getSetting(settingKey(f), '')])) as Record<Field, string>;
  return {
    ...values,
    typeLabel: BUSINESS_TYPE_LABELS[values.type] || '',
    configured: Boolean(values.name.trim()),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function setBusinessDetails(input: BusinessInput): BusinessDetails {
  const type = input.type?.trim();
  if (type && !BUSINESS_TYPE_LABELS[type])
    throw Object.assign(new Error('סוג עסק לא מוכר'), { status: 400 });

  const email = input.email?.trim();
  if (email && !EMAIL_RE.test(email))
    throw Object.assign(new Error('כתובת המייל של העסק לא תקינה'), { status: 400 });

  // The logo is rendered as an <img> in the preview — keep it to sources that are a picture.
  const logoUrl = input.logoUrl?.trim();
  if (logoUrl && !/^(https?:\/\/|data:image\/)/i.test(logoUrl))
    throw Object.assign(new Error('קישור הלוגו חייב להתחיל ב-https:// או להיות data:image'), { status: 400 });

  for (const field of FIELDS) {
    const value = input[field];
    if (value != null) setSetting(settingKey(field), String(value).trim());
  }
  return getBusinessDetails();
}
