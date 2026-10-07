import { db, uuid } from './db.js';
import { ensureExpenseRow, expenseRowForEvent, recomputeEvent } from './band.js';
import { aliasTextBySupplier } from './supplierNames.js';
import { isAssignmentRole, requiredRoleKeys, roleKeys, type AssignmentRole } from './supplierRoles.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export { isAssignmentRole, type AssignmentRole };

/**
 * The staffed roles of a show, as the band has defined them. The keys are exactly the
 * expense-row columns that pay them, which is what lets a supplier's open debt be read
 * straight off the shows they are assigned to — per show, not one global "soundman" figure.
 *
 * A function rather than the constant it used to be: the band decides which lines it hires
 * for, so the answer is whatever the roles table says at the moment of asking.
 */
export const ASSIGNMENT_ROLES = (): string[] => roleKeys();

/** A show without one of these is understaffed. */
export const REQUIRED_ROLES = (): string[] => requiredRoleKeys();

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

/**
 * The suppliers, each carrying the invoice names it answers to.
 *
 * `aliases` is read from band_supplier_aliases rather than off the frozen column of the same
 * name, so the one line the supplier dialog edits and the mapping screen's list are the same
 * fact said two ways instead of two facts that can drift apart.
 */
export function listSuppliers(): any[] {
  const aliases = aliasTextBySupplier();
  return (db.prepare('SELECT * FROM band_suppliers ORDER BY role, name').all() as any[])
    .map((supplier) => ({ ...supplier, aliases: aliases.get(supplier.id) || '' }));
}

/** The guest emails the calendar sync stored on a show; [] for shows entered by hand. */
export function attendeeEmails(event: any): string[] {
  try {
    const parsed = JSON.parse(event?.attendees || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeEmail).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function assignmentsForEvent(eventId: string): any[] {
  return db.prepare('SELECT * FROM band_event_assignments WHERE event_id = ?').all(eventId) as any[];
}

function supplierById(id: string | null | undefined): any {
  return id ? db.prepare('SELECT * FROM band_suppliers WHERE id = ?').get(id) : undefined;
}

const defaultAmount = (supplier: any): number => round2(Number(supplier?.default_amount) || 0);

/**
 * Carries a supplier's standing fee onto the show they were just staffed on.
 *
 * Staffing somebody and what they cost are one decision, so the fee should not have to be
 * typed a second time. What it must never do is overwrite a figure somebody meant: the line
 * is only written when it is empty, or when it still holds exactly the fee the *previous*
 * supplier's rate put there — a pre-fill nobody has corrected. A fee that was typed by hand,
 * or one already marked paid, is left alone, and swapping suppliers on it changes only the
 * name. Removing the supplier takes an untouched pre-fill back off the line with them, so
 * "לא נדרש" does not leave a cost behind for a role nobody is filling.
 */
function applyDefaultAmount(
  eventId: string,
  role: AssignmentRole,
  nextSupplierId: string | null,
  previousSupplierId: string | null
) {
  const next = defaultAmount(supplierById(nextSupplierId));
  const previous = defaultAmount(supplierById(previousSupplierId));
  if (!next && !previous) return;

  const event = db.prepare('SELECT * FROM band_events WHERE id = ?').get(eventId) as any;
  const expense = ensureExpenseRow(event);
  if (!expense || expense[`${role}_paid`]) return;

  const current = round2(Number(expense[role]) || 0);
  if (current !== 0 && current !== previous) return;
  if (current === next) return;

  db.prepare(`UPDATE band_event_expenses SET ${role} = ? WHERE id = ?`).run(next, expense.id);
  recomputeEvent(eventId);
}

/**
 * Matches a show's guest list against the supplier table: a guest whose email belongs to a
 * supplier is that show's person for the supplier's role. A choice made by hand is never
 * overwritten — the calendar proposes, the owner disposes.
 */
export function autoAssignEvent(eventId: string): number {
  const event = db.prepare('SELECT * FROM band_events WHERE id = ?').get(eventId) as any;
  if (!event) return 0;
  const emails = attendeeEmails(event);
  if (!emails.length) return 0;

  const invited = listSuppliers().filter((s) => s.email && emails.includes(normalizeEmail(s.email)));
  let assigned = 0;
  for (const role of ASSIGNMENT_ROLES()) {
    const match = invited.find((s) => s.role === role);
    if (!match) continue;
    const existing = db
      .prepare('SELECT * FROM band_event_assignments WHERE event_id = ? AND role = ?')
      .get(eventId, role) as any;
    if (existing) {
      if (existing.source === 'manual' || existing.supplier_id === match.id) continue;
      db.prepare('UPDATE band_event_assignments SET supplier_id = ?, not_needed = 0 WHERE id = ?')
        .run(match.id, existing.id);
    } else {
      db.prepare(
        "INSERT INTO band_event_assignments (id, event_id, role, supplier_id, source) VALUES (?, ?, ?, ?, 'calendar')"
      ).run(uuid(), eventId, role, match.id);
    }
    // A match from the calendar staffs the role as surely as a click does, so the fee follows.
    applyDefaultAmount(eventId, role, match.id, existing?.supplier_id ?? null);
    assigned++;
  }
  return assigned;
}

/** Re-runs the matching everywhere — how a supplier added today reaches shows synced last month. */
export const autoAssignAll = db.transaction((): number => {
  const events = db
    .prepare("SELECT id FROM band_events WHERE attendees IS NOT NULL AND attendees != '' AND attendees != '[]'")
    .all() as Array<{ id: string }>;
  return events.reduce((sum, e) => sum + autoAssignEvent(e.id), 0);
});

/** Stores a show's guest list and immediately matches it. Called by the calendar sync. */
export function setEventAttendees(eventId: string, emails: string[]) {
  db.prepare('UPDATE band_events SET attendees = ? WHERE id = ?')
    .run(JSON.stringify(emails.map(normalizeEmail).filter(Boolean)), eventId);
  autoAssignEvent(eventId);
}

/**
 * A staffing decision made by hand: a supplier, "not needed", or — with neither — back to
 * unassigned, which also lets the next sync propose again. One transaction, because the
 * decision may carry the supplier's standing fee onto the show's cost line with it.
 */
export const setAssignment = db.transaction((
  eventId: string,
  role: AssignmentRole,
  supplierId: string | null,
  notNeeded: boolean
): any => {
  if (!db.prepare('SELECT id FROM band_events WHERE id = ?').get(eventId))
    throw Object.assign(new Error('event not found'), { status: 404 });
  if (supplierId && !db.prepare('SELECT id FROM band_suppliers WHERE id = ?').get(supplierId))
    throw Object.assign(new Error('supplier not found'), { status: 400 });

  const existing = db
    .prepare('SELECT * FROM band_event_assignments WHERE event_id = ? AND role = ?')
    .get(eventId, role) as any;

  const previousSupplierId = existing?.supplier_id ?? null;

  if (!supplierId && !notNeeded) {
    if (existing) db.prepare('DELETE FROM band_event_assignments WHERE id = ?').run(existing.id);
    applyDefaultAmount(eventId, role, null, previousSupplierId);
    return null;
  }
  if (existing) {
    db.prepare("UPDATE band_event_assignments SET supplier_id = ?, not_needed = ?, source = 'manual' WHERE id = ?")
      .run(supplierId, notNeeded ? 1 : 0, existing.id);
    applyDefaultAmount(eventId, role, supplierId, previousSupplierId);
    return db.prepare('SELECT * FROM band_event_assignments WHERE id = ?').get(existing.id);
  }
  const id = uuid();
  db.prepare(
    "INSERT INTO band_event_assignments (id, event_id, role, supplier_id, not_needed, source) VALUES (?, ?, ?, ?, ?, 'manual')"
  ).run(id, eventId, role, supplierId, notNeeded ? 1 : 0);
  applyDefaultAmount(eventId, role, supplierId, null);
  return db.prepare('SELECT * FROM band_event_assignments WHERE id = ?').get(id);
});

/** A supplier leaves with their assignments — a row pointing at nobody helps no show. */
export const deleteSupplier = db.transaction((id: string) => {
  db.prepare('DELETE FROM band_event_assignments WHERE supplier_id = ?').run(id);
  const result = db.prepare('DELETE FROM band_suppliers WHERE id = ?').run(id);
  if (!result.changes) throw Object.assign(new Error('supplier not found'), { status: 404 });
});

/** One unpaid line of a supplier's ledger: the show, the role on it, and what it pays. */
export type SupplierDebtShow = {
  event_id: string;
  venue: string;
  date: string;
  role: AssignmentRole;
  amount: number;
};

/**
 * What a supplier is owed, and what they are merely booked for.
 *
 * `owed` is the debt: shows that have already happened and whose fee has not been paid. A fee
 * typed onto a show next month is `upcoming` instead — the work has not been done, so nothing
 * is owed for it yet, and counting it as debt made the band look like it was behind on money
 * nobody had earned. The two are kept apart rather than the future simply being dropped,
 * because "what will this supplier cost me" is a real question; it is just not a debt.
 */
export type SupplierDebt = {
  owed: number;
  shows: SupplierDebtShow[];
  upcoming: number;
  upcoming_shows: SupplierDebtShow[];
};

export function supplierDebts(): Map<string, SupplierDebt> {
  const rows = db
    .prepare(
      `SELECT a.supplier_id, a.role, e.id AS event_id, e.venue, e.date
       FROM band_event_assignments a JOIN band_events e ON e.id = a.event_id
       WHERE a.supplier_id IS NOT NULL ORDER BY e.date`
    )
    .all() as any[];

  // The same "has it happened yet" line the band's follow-up lists are drawn on: a show
  // dated today counts as played, since it is settled on the night.
  const today = new Date().toISOString().slice(0, 10);

  const debts = new Map<string, SupplierDebt>();
  for (const row of rows) {
    const expense = expenseRowForEvent(row.event_id);
    const amount = round2(Number(expense?.[row.role]) || 0);
    if (!amount || expense?.[`${row.role}_paid`]) continue;
    const entry = debts.get(row.supplier_id)
      || { owed: 0, shows: [], upcoming: 0, upcoming_shows: [] };
    const show: SupplierDebtShow = {
      event_id: row.event_id, venue: row.venue, date: row.date, role: row.role, amount,
    };
    if (row.date <= today) {
      entry.owed = round2(entry.owed + amount);
      entry.shows.push(show);
    } else {
      entry.upcoming = round2(entry.upcoming + amount);
      entry.upcoming_shows.push(show);
    }
    debts.set(row.supplier_id, entry);
  }
  return debts;
}

/** The required roles nobody has decided about yet — the "you forgot someone" signal. */
export function missingRoles(eventId: string): AssignmentRole[] {
  const covered = new Set(assignmentsForEvent(eventId).map((a) => a.role));
  return REQUIRED_ROLES().filter((role) => !covered.has(role));
}
