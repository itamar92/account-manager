import { db, uuid } from './db.js';
import { expenseRowForEvent } from './moonlight.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The staffed roles of a show. The keys are exactly the expense-row columns that pay them,
 * which is what lets a supplier's open debt be read straight off the shows they are
 * assigned to — per show, not one global "soundman" figure.
 */
export const ASSIGNMENT_ROLES = ['lightman', 'soundman', 'singer', 'sound_company'] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

/** A show without one of these is understaffed; a sound company is only sometimes needed. */
export const REQUIRED_ROLES: AssignmentRole[] = ['lightman', 'soundman', 'singer'];

export function isAssignmentRole(value: unknown): value is AssignmentRole {
  return ASSIGNMENT_ROLES.includes(value as AssignmentRole);
}

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

export function listSuppliers(): any[] {
  return db.prepare('SELECT * FROM band_suppliers ORDER BY role, name').all() as any[];
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
  for (const role of ASSIGNMENT_ROLES) {
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
 * unassigned, which also lets the next sync propose again.
 */
export function setAssignment(
  eventId: string,
  role: AssignmentRole,
  supplierId: string | null,
  notNeeded: boolean
): any {
  if (!db.prepare('SELECT id FROM band_events WHERE id = ?').get(eventId))
    throw Object.assign(new Error('event not found'), { status: 404 });
  if (supplierId && !db.prepare('SELECT id FROM band_suppliers WHERE id = ?').get(supplierId))
    throw Object.assign(new Error('supplier not found'), { status: 400 });

  const existing = db
    .prepare('SELECT * FROM band_event_assignments WHERE event_id = ? AND role = ?')
    .get(eventId, role) as any;

  if (!supplierId && !notNeeded) {
    if (existing) db.prepare('DELETE FROM band_event_assignments WHERE id = ?').run(existing.id);
    return null;
  }
  if (existing) {
    db.prepare("UPDATE band_event_assignments SET supplier_id = ?, not_needed = ?, source = 'manual' WHERE id = ?")
      .run(supplierId, notNeeded ? 1 : 0, existing.id);
    return db.prepare('SELECT * FROM band_event_assignments WHERE id = ?').get(existing.id);
  }
  const id = uuid();
  db.prepare(
    "INSERT INTO band_event_assignments (id, event_id, role, supplier_id, not_needed, source) VALUES (?, ?, ?, ?, ?, 'manual')"
  ).run(id, eventId, role, supplierId, notNeeded ? 1 : 0);
  return db.prepare('SELECT * FROM band_event_assignments WHERE id = ?').get(id);
}

/** A supplier leaves with their assignments — a row pointing at nobody helps no show. */
export const deleteSupplier = db.transaction((id: string) => {
  db.prepare('DELETE FROM band_event_assignments WHERE supplier_id = ?').run(id);
  const result = db.prepare('DELETE FROM band_suppliers WHERE id = ?').run(id);
  if (!result.changes) throw Object.assign(new Error('supplier not found'), { status: 404 });
});

/**
 * What each supplier is still owed, show by show: the assignment says who worked, the show's
 * expense row says what that role costs and whether it was paid.
 */
export function supplierDebts(): Map<string, { owed: number; shows: Array<{ event_id: string; venue: string; date: string; role: AssignmentRole; amount: number }> }> {
  const rows = db
    .prepare(
      `SELECT a.supplier_id, a.role, e.id AS event_id, e.venue, e.date
       FROM band_event_assignments a JOIN band_events e ON e.id = a.event_id
       WHERE a.supplier_id IS NOT NULL ORDER BY e.date`
    )
    .all() as any[];

  const debts = new Map<string, { owed: number; shows: any[] }>();
  for (const row of rows) {
    const expense = expenseRowForEvent(row.event_id);
    const amount = round2(Number(expense?.[row.role]) || 0);
    if (!amount || expense?.[`${row.role}_paid`]) continue;
    const entry = debts.get(row.supplier_id) || { owed: 0, shows: [] };
    entry.owed = round2(entry.owed + amount);
    entry.shows.push({ event_id: row.event_id, venue: row.venue, date: row.date, role: row.role, amount });
    debts.set(row.supplier_id, entry);
  }
  return debts;
}

/** The required roles nobody has decided about yet — the "you forgot someone" signal. */
export function missingRoles(eventId: string): AssignmentRole[] {
  const covered = new Set(assignmentsForEvent(eventId).map((a) => a.role));
  return REQUIRED_ROLES.filter((role) => !covered.has(role));
}
