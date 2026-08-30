/**
 * Who the band pays: a supplier it hires, or one of its own members.
 *
 * These were two unrelated things in the database and one thing in life. A transfer to אבי for
 * four gigs and a transfer to אמיר for his share of the same four are the same act — money
 * leaving the band for somebody who, if they are an עוסק, owes it a document back. Until that
 * document arrives the payment is not a deductible expense and the מע"מ inside it cannot be
 * reclaimed, and that is true of a member's share exactly as it is of a supplier's fee.
 *
 * So they share one queue, and this module is the seam: a payee is a kind and an id, and
 * everything downstream — payments, aliases, the invoice queue — speaks that instead of
 * speaking about suppliers and quietly leaving half the band's money out.
 */
import { db } from './db.js';

export type PayeeKind = 'supplier' | 'member';

export interface Payee {
  kind: PayeeKind;
  /** A supplier's id, or a member's member_key. Unique only within the kind — see payeeKey. */
  id: string;
  name: string;
  /** Whether a document is expected back at all. */
  expects_invoice: boolean;
  tax_id: string | null;
  morning_supplier_id: string | null;
  /** Suppliers: the cost line they are hired for, and what the band calls it. */
  role?: string;
  role_name?: string;
  /** Members: what kind of business they run, which is what decides the line above. */
  business_type?: string;
  /** Whether they are still someone the band would pay today. */
  active: boolean;
}

/**
 * One string that identifies a payee across both kinds.
 *
 * A supplier id and a member key can never collide in practice, but a map keyed on the bare id
 * would say they cannot in principle — and the day one did, a document would be filed against
 * the wrong person's money with nothing to notice it.
 */
export const payeeKey = (kind: PayeeKind, id: string): string =>
  `${kind === 'member' ? 'm' : 's'}:${id}`;

export const keyOf = (payee: Payee): string => payeeKey(payee.kind, payee.id);

/** The reference columns a row stores a payee in. */
export const payeeColumns = (payee: { kind: PayeeKind; id: string }) => ({
  supplier_id: payee.kind === 'supplier' ? payee.id : null,
  member_key: payee.kind === 'member' ? payee.id : null,
});

/** Reads a payee back off any row carrying the two columns. */
export const payeeRef = (row: any): { kind: PayeeKind; id: string } | null => {
  if (row?.supplier_id) return { kind: 'supplier', id: String(row.supplier_id) };
  if (row?.member_key) return { kind: 'member', id: String(row.member_key) };
  return null;
};

const supplierPayee = (row: any, roles?: Map<string, string>): Payee => ({
  kind: 'supplier',
  id: row.id,
  name: row.name,
  expects_invoice: !!row.expects_invoice,
  tax_id: row.tax_id ?? null,
  morning_supplier_id: row.morning_supplier_id ?? null,
  role: row.role,
  // Carried with the payee rather than looked up on the screen: a dropdown that labels a
  // supplier by their role should say what the band calls that role, not its column name.
  role_name: (roles || roleNameMap()).get(row.role) || row.role,
  active: true,
});

const roleNameMap = (): Map<string, string> =>
  new Map((db.prepare('SELECT key, name FROM band_supplier_roles').all() as any[])
    .map((r) => [r.key, r.name]));

/**
 * A member's share is expected to come back as a document only if they have a business to
 * issue one from. Somebody registered as nothing hands back nothing that can be deducted, and
 * a payment waiting for a document that cannot legally exist is a queue item nobody can ever
 * clear — the one thing that makes a list stop being opened.
 */
const memberPayee = (row: any): Payee => ({
  kind: 'member',
  id: row.member_key,
  name: row.name,
  expects_invoice: row.business_type !== 'none',
  tax_id: row.tax_id ?? null,
  morning_supplier_id: row.morning_supplier_id ?? null,
  business_type: row.business_type,
  active: !!row.active,
});

export function listPayees(): Payee[] {
  const roles = roleNameMap();
  const suppliers = (db.prepare('SELECT * FROM band_suppliers ORDER BY role, name').all() as any[])
    .map((row) => supplierPayee(row, roles));
  const members = (db.prepare('SELECT * FROM band_members ORDER BY sort_order, name').all() as any[])
    .map(memberPayee);
  return [...suppliers, ...members];
}

/** Every payee by key, for the loops that label many rows without asking the database each time. */
export const payeesByKey = (payees?: Payee[]): Map<string, Payee> =>
  new Map((payees || listPayees()).map((payee) => [keyOf(payee), payee]));
