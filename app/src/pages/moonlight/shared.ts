import type { PeriodFilter } from '../../ui';

/** The band, in the order the tables and the summary show them. */
export const MEMBERS = [
  { key: 'amir', name: 'אמיר' },
  { key: 'itamar', name: 'איתמר' },
  { key: 'yuval', name: 'יובל' },
  { key: 'guy', name: 'גיא' },
] as const;

/** Who a general expense can have been paid by: any member, or the band's own float. */
export const PAYERS = [...MEMBERS.map((m) => m.name), 'קופה'];

/** The producer fee a new show starts with — matches the server's default. 20% is 30/30/20/20. */
export const DEFAULT_COMMISSION_PERCENT = 20;

/**
 * What a producer-fee percentage works out to per member, for showing beside the input.
 * Mirrors computeDivision on the server: half the fee to each of אמיר and איתמר, and the rest
 * split four ways.
 */
export function divisionSplitLabel(percent: unknown): string {
  const rate = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
  const even = ((1 - rate) / 4) * 100;
  const lead = (rate / 2) * 100 + even;
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(lead)}/${round(lead)}/${round(even)}/${round(even)}`;
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
  waiting_report: 'text-amber-400',
  invoice_sent: 'text-sky-400',
  received: 'text-emerald-400',
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
