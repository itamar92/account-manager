import React from 'react';
import { get } from '../../api';
import type { PeriodFilter } from '../../ui';

/** The band's own float — an expense it paid is one everybody shares. */
export const FUND_PAYER = 'קופה';

/** Who a general expense can have been paid by: any member, or the band's own float. */
export const payerNames = (members: BandMember[]) =>
  [...members.map((m) => m.name), FUND_PAYER];

/** The producer fee a new show starts with — matches the server's default. 20% is 30/30/20/20. */
export const DEFAULT_COMMISSION_PERCENT = 20;

/**
 * What a producer-fee percentage works out to per member, for showing beside the input.
 * Mirrors computeDivision on the server: the fee shared by the managers, the rest shared by
 * everybody. For four members and two managers, 20% still reads 30/30/20/20.
 */
export function divisionSplitLabel(percent: unknown, members: BandMember[]): string {
  const active = members.filter((m) => m.active);
  if (active.length === 0) return '—';
  const managers = active.filter((m) => m.is_manager).length;
  const rate = managers > 0 ? Math.min(100, Math.max(0, Number(percent) || 0)) / 100 : 0;
  const even = ((1 - rate) / active.length) * 100;
  const round = (n: number) => Math.round(n * 10) / 10;
  return active
    .map((m) => round(even + (m.is_manager && managers > 0 ? (rate / managers) * 100 : 0)))
    .join('/');
}

/** Mirrors eventLabel on the server, for labelling shows in dropdowns before a save. */
export function eventLabel(event: { venue: string; date: string }): string {
  const [y, m, d] = String(event.date || '').split('-');
  return y && m && d ? `${event.venue} - ${d}/${m}/${y}` : event.venue;
}

/**
 * Where a show's money has got to, in the order it moves through. Mirrors PAYMENT_STATUSES
 * on the server.
 *
 * The last two are one payment at two places: the venue pays into the private account, and
 * what belongs to the band moves on from there into the band's own — a separate transfer,
 * days or weeks later, and the one this app exists to work out.
 */
export const PAYMENT_STATUSES = [
  { value: 'waiting_report', label: 'ממתין לדוח' },
  { value: 'invoice_sent', label: 'חשבונית נשלחה' },
  { value: 'received', label: 'התקבל' },
  { value: 'fund_transferred', label: 'הכסף הועבר לקופת הלהקה' },
];

export const FUND_TRANSFERRED = 'fund_transferred';

/** Whether the venue's money has arrived, at whichever of the two stations the show sits. */
export const moneyReceived = (status: unknown): boolean =>
  status === 'received' || status === FUND_TRANSFERRED;

export const PAYMENT_STATUS_STYLES: Record<string, string> = {
  waiting_report: 'text-warn',
  invoice_sent: 'text-accent',
  received: 'text-pos',
  fund_transferred: 'text-moon',
};

export const paymentStatusLabel = (value: string) =>
  PAYMENT_STATUSES.find((s) => s.value === value)?.label || value;

/**
 * The kinds of supplier the band hires — read from the server, because the band decides them.
 *
 * A role is a cost line of a show wearing a name, so the set of possible roles is fixed by
 * what a show can cost, but which of them the band actually hires for, and what it calls each,
 * is data. `active` is the ones being used; everything else is a line the band has not put a
 * name to yet.
 */
export interface SupplierRole {
  key: string;
  name: string;
  required: number;
  active: number;
  sort_order: number;
  /** How much the role already carries — what the roles screen shows before switching it off. */
  suppliers?: number;
  assignments?: number;
}

/**
 * The names to fall back on before the roles have been fetched, and for a key the server no
 * longer knows. They are the labels the app shipped with, so a screen rendered a moment early
 * reads correctly rather than showing «sound_company».
 */
const DEFAULT_ROLE_NAMES: Record<string, string> = {
  lightman: 'תאורן', soundman: 'סאונדמן', singer: 'זמר/ת', sound_company: 'חברת הגברה',
  bracelets: 'צמידים', akom: 'אקו"ם', hall_fee: 'שכירות אולם', campaign: 'קמפיין',
  refreshments: 'כיבוד', design: 'עיצוב', other: 'אחר', expense_amount: 'הוצאה נוספת',
};

/**
 * The last roles any screen fetched, kept module-wide so `roleName` stays a plain function.
 *
 * Dozens of call sites label a role inside a table cell or a dropdown; threading a hook
 * through all of them to look up a name would be a large change for a string. The cache is
 * refreshed by `useSupplierRoles`, which every screen that shows roles mounts.
 */
let roleCache: SupplierRole[] = [];

export const roleName = (key: string): string =>
  roleCache.find((r) => r.key === key)?.name || DEFAULT_ROLE_NAMES[key] || key;

/** The roles as the band has defined them; `active` is what a staffing dropdown should offer. */
export function useSupplierRoles(): {
  roles: SupplierRole[];
  active: SupplierRole[];
  reload: () => void;
} {
  const [roles, setRoles] = React.useState<SupplierRole[]>(roleCache);
  const load = React.useCallback(() => {
    get('/moonlight/supplier-roles')
      .then((d) => { roleCache = d.roles || []; setRoles(roleCache); })
      .catch(() => {});
  }, []);
  React.useEffect(load, [load]);
  return { roles, active: roles.filter((r) => r.active), reload: load };
}

export interface TabProps {
  isOwner: boolean;
  onError: (message: string) => void;
  reload: () => void;
}

/** The tabs that show a table share the shell's period filter and its selects. */
export interface PeriodTabProps extends TabProps {
  period: PeriodFilter;
}

/**
 * What kind of business a member runs. It is recorded because it decides what their share
 * costs: an עוסק מורשה hands back a חשבונית מס whose מע"מ can be reclaimed, an עוסק פטור hands
 * back one that is deductible but carries none, and someone registered as nothing hands back
 * nothing that can be deducted at all.
 */
export type BusinessType = 'patur' | 'morshe' | 'none';

export const BUSINESS_TYPES: Array<{ value: BusinessType; label: string; short: string }> = [
  { value: 'morshe', label: 'עוסק מורשה', short: 'מורשה' },
  { value: 'patur', label: 'עוסק פטור', short: 'פטור' },
  { value: 'none', label: 'לא רשום', short: 'לא רשום' },
];

export const businessTypeLabel = (value: string) =>
  BUSINESS_TYPES.find((t) => t.value === value)?.label || value;

export interface BandMember {
  id: string;
  member_key: string;
  name: string;
  email: string | null;
  role: string | null;
  is_manager: number;
  business_type: BusinessType;
  active: number;
  sort_order: number;
  /** What the member's own invoices are identified by, where they issue any. */
  tax_id?: string | null;
  morning_supplier_id?: string | null;
  /** What the band has paid them that no document answers for yet. */
  missing_docs?: number;
  missing_doc_payments?: number;
  missing_docs_days?: number;
}

/**
 * The band as it is recorded, for the screens that need to know more about a member than their
 * name. Falls back to the four built-in names, so a screen still renders if the fetch fails.
 */
export function useBandMembers(): { members: BandMember[]; reload: () => void } {
  const [members, setMembers] = React.useState<BandMember[]>([]);
  const load = React.useCallback(() => {
    get('/moonlight/members').then((d) => setMembers(d.members || [])).catch(() => {});
  }, []);
  React.useEffect(load, [load]);
  return { members, reload: load };
}

/**
 * The cost columns of an expense row, mirroring EXPENSE_FIELDS on the server. `vat_summary`
 * is left out there and here alike: it restates the VAT inside the lines rather than adding
 * a cost of its own.
 */
export const EXPENSE_FIELDS = [
  'campaign', 'refreshments', 'design', 'other', 'expense_amount',
  'akom', 'hall_fee', 'sound_company', 'bracelets', 'lightman', 'soundman', 'singer',
] as const;

/** What one expense row adds up to, for reading a row the server has not totalled for us. */
export const expenseRowTotal = (row: any) =>
  Math.round(EXPENSE_FIELDS.reduce((sum, f) => sum + (Number(row?.[f]) || 0), 0) * 100) / 100;

/**
 * The parameter a link into a show carries the list it came from in.
 *
 * A show is opened from four different places, each of which has a state worth coming back to —
 * the year the list was filtered to, the search that was typed, the tab you were on. Rather
 * than have the show page guess, the link that opened it says where it came from, and the
 * breadcrumb takes you back to exactly that address.
 */
export const RETURN_PARAM = 'back';

/** A link to one show that remembers the list it was opened from. */
export function showHref(id: string, from?: { pathname: string; search: string }): string {
  const back = from ? `${from.pathname}${from.search}` : '';
  return back
    ? `/moonlight/shows/${id}?${RETURN_PARAM}=${encodeURIComponent(back)}`
    : `/moonlight/shows/${id}`;
}

/** The Moonlight pages a show can be opened from, longest path first so `/moonlight` is last. */
const RETURN_LABELS: Array<[string, string]> = [
  ['/moonlight/shows', 'הופעות'],
  ['/moonlight/summary', 'סקירה כספית'],
  ['/moonlight/supplierPayments', 'תשלומים לספקים'],
  ['/moonlight/supplierNames', 'שמות בחשבוניות'],
  ['/moonlight/suppliers', 'ספקים וחברים'],
  ['/moonlight/generalExpenses', 'הוצאות כלליות'],
  ['/moonlight/campaignAi', 'יועץ קמפיינים'],
  ['/moonlight/ads', 'קמפיינים'],
  ['/moonlight', 'סקירה כספית'],
];

/**
 * Where the breadcrumb out of a show goes, and what it is called.
 *
 * Anything that is not a Moonlight address is not somewhere this breadcrumb will send you: a
 * value out of the URL is only ever as trustworthy as whoever typed it, and the shows list is
 * the right answer for every case it is wrong about anyway.
 */
export function showReturn(raw: string | null): { to: string; label: string } {
  const to = raw && /^\/moonlight(\/[\w./-]*)?(\?[^\s]*)?$/.test(raw) ? raw : '/moonlight/shows';
  const path = to.split('?')[0];
  const match = RETURN_LABELS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return { to, label: match ? match[1] : 'הופעות' };
}
