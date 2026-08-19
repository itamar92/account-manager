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

/** Where a show's money has got to, in the order it moves through. */
export const PAYMENT_STATUSES = [
  { value: 'waiting_report', label: 'ממתין לדוח' },
  { value: 'invoice_sent', label: 'חשבונית נשלחה' },
  { value: 'received', label: 'התקבל' },
];

export const PAYMENT_STATUS_STYLES: Record<string, string> = {
  waiting_report: 'text-warn',
  invoice_sent: 'text-accent',
  received: 'text-pos',
};

export const paymentStatusLabel = (value: string) =>
  PAYMENT_STATUSES.find((s) => s.value === value)?.label || value;

/**
 * The staffed roles of a show, in display order. The keys are the expense-row columns that
 * pay each role — the same names the server uses — so an assignment and its cost line up.
 * A sound company is only sometimes needed, so only its absence is not flagged.
 */
export const ASSIGNMENT_ROLES = [
  { key: 'lightman', name: 'תאורן', required: true },
  { key: 'soundman', name: 'סאונדמן', required: true },
  { key: 'singer', name: 'זמר/ת', required: true },
  { key: 'sound_company', name: 'חברת הגברה', required: false },
] as const;

export const roleName = (key: string) =>
  ASSIGNMENT_ROLES.find((r) => r.key === key)?.name || key;

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
