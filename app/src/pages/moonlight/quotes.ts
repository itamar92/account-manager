import React from 'react';
import { get } from '../../api';

/**
 * What the quote screens share: the shapes the server sends, the status words, and the
 * settings every quote screen reads. The arithmetic is not here — it is imported straight from
 * server/quoteMath.ts, so the preview adds up exactly the way the saved quote will.
 */
export { computeTotals } from '../../../server/quoteMath';

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
  subtotal: number;
  net_amount: number;
  vat_amount: number;
  total: number;
  show_id: string | null;
  signed_at: string | null;
  signer_name: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  first_line_name?: string | null;
  first_line_price?: number | null;
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
}

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

/** 'YYYY-MM-DD' the way a quote writes it. */
export const quoteDate = (date: string | null | undefined) =>
  date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';

/** Everything the quote screens read besides the quotes: the settings and the fixed lists. */
export function useQuoteSettings(onError?: (message: string) => void) {
  const [data, setData] = React.useState<{
    settings: QuoteSettings;
    event_types: string[];
    vat_percent: number;
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
