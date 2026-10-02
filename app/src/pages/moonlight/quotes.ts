import React from 'react';
import { get } from '../../api';

/**
 * What the quote screens share: the shapes the server sends, the status words, and the
 * settings every quote screen reads. The arithmetic is not here — it is imported straight from
 * server/quoteMath.ts, so the preview adds up exactly the way the saved quote will.
 */
export { DEPOSIT_PLACEHOLDER, computeTotals, depositAmount } from '../../../server/quoteMath';

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'cancelled' | 'expired';

export interface QuoteItem {
  id?: string;
  name: string;
  description: string | null;
  quantity: number | string;
  unit_price: number | string;
  total?: number;
  package_id?: string | null;
}

export interface Quote {
  id: string;
  is_template: number;
  template_name: string | null;
  is_default?: boolean;
  quote_number: string | null;
  status: Exclude<QuoteStatus, 'expired'>;
  display_status: QuoteStatus;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  client_tax_id: string | null;
  event_type: string | null;
  event_date: string | null;
  event_location: string | null;
  guest_count: number | null;
  show_duration: string | null;
  title: string;
  intro: string | null;
  terms: string | null;
  valid_until: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  internal_note: string | null;
  prices_include_vat: number;
  vat_percent: number;
  discount: number;
  /** Of the price; the terms say it through `{deposit}`. */
  deposit_percent: number | null;
  subtotal: number;
  net_amount: number;
  vat_amount: number;
  total: number;
  show_id: string | null;
  show_link_status: 'linked' | 'choose' | 'no_show' | 'error' | null;
  show_amount_ok: number;
  signed_seen_at: string | null;
  calendar_id: string | null;
  calendar_event_id: string | null;
  calendar_event_title: string | null;
  calendar_event_link: string | null;
  public_token: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  signed_at: string | null;
  signer_name: string | null;
  signature_png?: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  first_line_name?: string | null;
  first_line_price?: number | null;
}

/** A template the system comes with, which «תבניות» can add a fresh copy of. */
export interface BuiltinTemplate {
  key: string;
  template_name: string;
}

export interface QuotePackage {
  id: string;
  name: string;
  description: string | null;
  unit_price: number;
  active: number;
  sort_order: number;
}

export interface QuoteSettings {
  brand_name: string;
  contact_name: string;
  contact_phone: string;
  validity_days: number;
  prices_include_vat: boolean;
  default_template_id: string | null;
  color_primary: string;
  color_accent: string;
  logo_position: LogoPosition;
  signature_name: string;
  message_template: string;
  email_subject: string;
  logo_url: string | null;
  signature_url: string | null;
}

/** The show a quote is linked to, as the editor shows it. */
export interface QuoteShow {
  id: string;
  venue: string;
  date: string;
  location: string | null;
  amount_pre_vat: number;
  amount_with_vat: number;
}

/** A show on the quote's date it could be linked to — see server/quoteShow.ts. */
export interface ShowCandidate extends QuoteShow {
  /** The other quote already behind this show, if any. */
  taken_by: string | null;
}

/** What the calendar dialog opens with — server/quoteCalendar.ts, calendarDraft. */
export interface CalendarDraft {
  configured: boolean;
  rule: { name: string; keywords: string; ignore_words: string } | null;
  date: string | null;
  signed: boolean;
  members: Array<{ key: string; name: string; email: string }>;
  suppliers: Array<{ id: string; name: string; email: string; role: string; role_name: string }>;
  event: { id: string; title: string; link: string | null; is_option: boolean } | null;
  gone?: boolean;
  form: { title: string; location: string; start_time: string | null; end_time: string | null; attendees: string[] };
}

export { isOptionTitle, withoutOption } from '../../../server/quoteOption';

/** The link a sent quote lives at, and what it goes out with — built by server/quoteLink.ts. */
export interface ShareDetails {
  url: string;
  message: string;
  subject: string;
  phone: string | null;
  email: string | null;
  card: EmailCard;
}

/** What the email is dressed in and sums up, written as the client reads it (server/quoteLink.ts). */
export interface EmailCard {
  brand_name: string;
  logo_url: string | null;
  logo_position: LogoPosition;
  color_primary: string;
  color_accent: string;
  title: string;
  quote_number: string;
  event_date: string;
  event_location: string;
  total: number;
  vat_percent: number;
  valid_until: string;
  contact_name: string;
  contact_phone: string;
}

/** The client's signature, as the document shows it once there is one. */
export interface ClientSignature {
  name: string;
  signedAt: string;
  png: string;
}

export type LogoPosition = 'right' | 'center' | 'left';

/** What a quote is dressed in — the same for every quote, set once in the settings. */
export interface QuoteBranding {
  brandName: string;
  logoUrl: string | null;
  logoPosition: LogoPosition;
  primary: string;
  accent: string;
  signatureUrl: string | null;
  signatureName: string;
}

/** Mirrors DEFAULT_COLORS on the server, for the moment before the settings arrive. */
export const DEFAULT_COLORS = { primary: '#241d3d', accent: '#6b45d6' };

export const brandingOf = (settings?: QuoteSettings | null): QuoteBranding => ({
  brandName: settings?.brand_name || 'Moonlight',
  logoUrl: settings?.logo_url ?? null,
  logoPosition: settings?.logo_position ?? 'center',
  primary: settings?.color_primary || DEFAULT_COLORS.primary,
  accent: settings?.color_accent || DEFAULT_COLORS.accent,
  signatureUrl: settings?.signature_url ?? null,
  signatureName: settings?.signature_name ?? '',
});

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  viewed: 'נצפתה',
  signed: 'נחתמה',
  cancelled: 'בוטלה',
  expired: 'פג תוקף',
};

export const STATUS_STYLES: Record<QuoteStatus, string> = {
  draft: 'bg-soft text-muted',
  sent: 'bg-accent-soft text-accent-ink',
  viewed: 'bg-moon-soft text-moon',
  signed: 'bg-pos-soft text-pos',
  cancelled: 'bg-soft text-faint line-through',
  expired: 'bg-warn-soft text-warn-ink',
};

/** What a template's placeholders read as when it is previewed, so its layout can be judged. */
const SAMPLE = { client_name: 'שם הלקוח', event_date: 'תאריך האירוע' };
const fillSample = (value: string | null) =>
  value?.replaceAll('{client_name}', SAMPLE.client_name).replaceAll('{event_date}', SAMPLE.event_date) ?? null;

/**
 * A quote as it should be previewed. A template has no client yet, so it is shown with a
 * sample one standing in for the quotes that will be made from it.
 */
export const previewOf = <Q extends Pick<Quote, 'is_template' | 'client_name' | 'title' | 'intro'>>(quote: Q): Q =>
  quote.is_template
    ? { ...quote, client_name: SAMPLE.client_name, title: fillSample(quote.title) ?? '', intro: fillSample(quote.intro) }
    : quote;

/** 'YYYY-MM-DD' the way a quote writes it. */
export const quoteDate = (date: string | null | undefined) =>
  date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';

/** A moment the database kept in UTC, as the time it was in Israel: «01/10/2026 22:45». */
export const israelDateTime = (utc: string | null | undefined) => {
  if (!utc) return '';
  const moment = new Date(utc.includes('T') ? utc : `${utc.replace(' ', 'T')}Z`);
  if (Number.isNaN(moment.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(moment).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
};

/**
 * The day a quote was made, as a date on the quote. The database keeps the moment in UTC, so a
 * quote made at 01:00 in Israel is still dated that day rather than the one before.
 */
export const issuedOn = (createdAt: string | null | undefined) => {
  if (!createdAt) return '';
  const moment = new Date(createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(moment.getTime())) return '';
  return quoteDate(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(moment));
};

/** Everything the quote screens read besides the quotes: the settings and the fixed lists. */
export function useQuoteSettings(onError?: (message: string) => void) {
  const [data, setData] = React.useState<{
    settings: QuoteSettings;
    event_types: string[];
    vat_percent: number;
    calendar_ready: boolean;
  } | null>(null);
  const load = React.useCallback(() => {
    get('/moonlight/quotes/settings').then(setData).catch((e) => onError?.(e.message));
  }, []);
  React.useEffect(load, [load]);
  return { data, reload: load };
}

export function usePackages(onError?: (message: string) => void) {
  const [packages, setPackages] = React.useState<QuotePackage[]>([]);
  const load = React.useCallback(() => {
    get('/moonlight/quotes/packages').then((d) => setPackages(d.packages)).catch((e) => onError?.(e.message));
  }, []);
  React.useEffect(load, [load]);
  return { packages, reload: load };
}
