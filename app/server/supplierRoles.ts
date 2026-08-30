/**
 * The kinds of supplier the band hires — decided by the band, not by this file.
 *
 * A role is a cost line of a show wearing a name. Staffing somebody on it says who that line
 * pays, and everything downstream follows from that one fact: what they are owed, the transfer
 * that settles it, and the invoice the books are waiting for.
 *
 * The four roles this app shipped with were a literal in the source, which is why the band
 * could record what צמידים cost but never who supplied them: no supplier, no payment, no
 * invoice chased. The list is data now. What it is not is free-form — a role must name a cost
 * line that exists, because the money it pays has to come from somewhere a show can carry.
 */
import { db } from './db.js';

export type AssignmentRole = string;

export interface SupplierRole {
  key: string;
  name: string;
  required: number;
  active: number;
  sort_order: number;
}

export const allRoles = (): SupplierRole[] =>
  db.prepare('SELECT * FROM band_supplier_roles ORDER BY sort_order, key').all() as SupplierRole[];

/**
 * The roles a show is staffed from: the ones the band has switched on.
 *
 * Everything that walks a show's roles reads this, so turning a role off stops it being asked
 * about everywhere at once — while the shows already staffed on it keep their assignments,
 * their payments and their documents, because those are things that happened.
 */
export const activeRoles = (): SupplierRole[] => allRoles().filter((r) => r.active);

export const roleKeys = (): string[] => activeRoles().map((r) => r.key);

/** A show missing one of these is understaffed. */
export const requiredRoleKeys = (): string[] =>
  activeRoles().filter((r) => r.required).map((r) => r.key);

/**
 * Whether this is a role at all — active or not.
 *
 * Deliberately not restricted to the active ones: a payment recorded for סאונדמן before the
 * band retired that role is still a payment for סאונדמן, and refusing to read it back would
 * make deactivating a role destroy history rather than tidy a screen.
 */
export function isAssignmentRole(value: unknown): value is AssignmentRole {
  if (typeof value !== 'string' || !value) return false;
  return !!db.prepare('SELECT 1 FROM band_supplier_roles WHERE key = ?').get(value);
}

/** What to call a role on screen; the key itself for one that has been deleted from under us. */
export function roleName(key: string): string {
  const row = db.prepare('SELECT name FROM band_supplier_roles WHERE key = ?').get(key) as any;
  return row?.name || key;
}

/** Every role's name in one pass, for a list that labels many rows. */
export const roleNames = (): Map<string, string> =>
  new Map(allRoles().map((role) => [role.key, role.name]));

/**
 * Turns a role on or off, renames it, or changes whether a show is nagged for it.
 *
 * The key is never editable. It is the expense column the role's money lives in, and every
 * assignment, payment line and paid flag already recorded points at it — a role renamed from
 * «צמידים» to «מזכרות» is the same line of the same shows, which is exactly what a rename
 * should mean.
 */
export function updateRole(key: string, patch: { name?: unknown; required?: unknown; active?: unknown }): SupplierRole {
  const existing = db.prepare('SELECT * FROM band_supplier_roles WHERE key = ?').get(key) as SupplierRole | undefined;
  if (!existing) throw Object.assign(new Error('role not found'), { status: 404 });

  const name = patch.name === undefined ? existing.name : String(patch.name).trim();
  if (!name) throw Object.assign(new Error('שם הסוג חובה'), { status: 400 });

  const clash = db
    .prepare('SELECT key FROM band_supplier_roles WHERE name = ? AND key != ?')
    .get(name, key) as any;
  if (clash) throw Object.assign(new Error(`כבר קיים סוג ספק בשם «${name}»`), { status: 409 });

  const required = patch.required === undefined ? existing.required : (patch.required ? 1 : 0);
  const active = patch.active === undefined ? existing.active : (patch.active ? 1 : 0);
  db.prepare('UPDATE band_supplier_roles SET name = ?, required = ?, active = ? WHERE key = ?')
    // A role nobody is staffed on cannot be missing from a show: switching it off has to take
    // the nag with it, or every show would ask for somebody the band no longer hires.
    .run(name, active ? required : 0, active, key);
  return db.prepare('SELECT * FROM band_supplier_roles WHERE key = ?').get(key) as SupplierRole;
}

/** How many suppliers and shows a role carries — what a screen shows before switching it off. */
export function roleUsage(key: string): { suppliers: number; assignments: number } {
  const suppliers = db.prepare('SELECT COUNT(*) AS n FROM band_suppliers WHERE role = ?').get(key) as { n: number };
  const assignments = db
    .prepare('SELECT COUNT(*) AS n FROM band_event_assignments WHERE role = ? AND supplier_id IS NOT NULL')
    .get(key) as { n: number };
  return { suppliers: suppliers.n, assignments: assignments.n };
}
