/**
 * Paying a supplier, and chasing the document that should come back for it.
 *
 * The band pays אבי once for four gigs. Before this module that transfer left four unrelated
 * `${role}_paid = 1` flags on four shows: no date, no amount, and nothing to ask «did his
 * invoice arrive?» about. A payment is now a row of its own with the lines it settled hanging
 * off it, and the flags are kept in step as its consequence — so `expenseOutstanding`,
 * `supplierDebts` and every screen that reads them carry on unchanged.
 *
 * The chase matters for money rather than tidiness: a payment with no document behind it is
 * not deductible, and the מע"מ inside it cannot be reclaimed. That is why the queue reports
 * shekels rather than a count of chores.
 */
import { db, uuid, getSetting, setSetting } from './db.js';
import { expenseRowForEvent, recomputeEvent } from './moonlight.js';
import { ASSIGNMENT_ROLES, type AssignmentRole, isAssignmentRole } from './assignments.js';

const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * How close two figures have to be to count as the same money. Agorot rounding on a converted
 * or split document is real; a shekel of difference is not something either side meant.
 */
const TOLERANCE = 0.5;

/**
 * How far from a payment a document may be dated and still be about it. The window is lopsided
 * on purpose: a supplier who invoices first and is paid weeks later is the normal case, and
 * one who is paid on the night and gets round to the paperwork next quarter is the other.
 */
const WINDOW_BEFORE_DAYS = 120;
const WINDOW_AFTER_DAYS = 120;

/** How a payment leaves the queue without a document having been found for it. */
export type PaymentResolution = 'verified' | 'not_required';

export const PAYMENT_RESOLUTIONS: PaymentResolution[] = ['verified', 'not_required'];

/**
 * Where a payment stands on documentation. Only `waiting` is a loose end; the other three are
 * finished, by three different routes.
 */
export type PaymentDocStatus = 'waiting' | 'documented' | 'verified' | 'not_required';

export interface OpenLine {
  event_id: string;
  venue: string;
  date: string;
  role: AssignmentRole;
  amount: number;
  /** A fee on a show that has not happened yet is not a debt — see supplierDebts. */
  upcoming: boolean;
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

const shiftDate = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

// ============================== open lines and payments ==============================

/**
 * The cost lines a supplier has not been paid for yet — what the pay dialog offers to settle.
 *
 * Upcoming shows are returned alongside the ones already played rather than filtered out: the
 * band does occasionally settle a booking in advance, and the caller is better placed to
 * decide than a query is. They are flagged, not hidden.
 */
export function openLines(supplierId: string): OpenLine[] {
  const rows = db
    .prepare(
      `SELECT a.role, e.id AS event_id, e.venue, e.date
         FROM band_event_assignments a
         JOIN band_events e ON e.id = a.event_id
        WHERE a.supplier_id = ?
        ORDER BY e.date`
    )
    .all(supplierId) as any[];

  const now = today();
  const lines: OpenLine[] = [];
  for (const row of rows) {
    if (!isAssignmentRole(row.role)) continue;
    const expense = expenseRowForEvent(row.event_id);
    const amount = round2(Number(expense?.[row.role]) || 0);
    if (!amount || expense?.[`${row.role}_paid`]) continue;
    lines.push({
      event_id: row.event_id, venue: row.venue, date: row.date,
      role: row.role, amount, upcoming: row.date > now,
    });
  }
  return lines;
}

/** The lines one payment settled, for showing what a transfer was actually for. */
export function paymentLines(paymentId: string): OpenLine[] {
  return db
    .prepare(
      `SELECT l.event_id, l.role, l.amount, e.venue, e.date
         FROM supplier_payment_lines l
         JOIN band_events e ON e.id = l.event_id
        WHERE l.payment_id = ?
        ORDER BY e.date`
    )
    .all(paymentId)
    .map((row: any) => ({
      event_id: row.event_id, venue: row.venue, date: row.date,
      role: row.role as AssignmentRole, amount: round2(Number(row.amount) || 0),
      upcoming: row.date > today(),
    }));
}

const supplierById = (id: string): any =>
  db.prepare('SELECT * FROM band_suppliers WHERE id = ?').get(id);

/** Turns the `${role}_paid` flags of one show into whatever the payment rows now say. */
function applyPaidFlags(eventId: string, roles: AssignmentRole[], paid: boolean) {
  if (!roles.length) return;
  const expense = expenseRowForEvent(eventId);
  if (!expense) return;
  db.prepare(
    `UPDATE band_event_expenses SET ${roles.map((r) => `${r}_paid = ?`).join(', ')} WHERE id = ?`
  ).run(...roles.map(() => (paid ? 1 : 0)), expense.id);
  recomputeEvent(eventId);
}

export interface RecordPaymentInput {
  supplier_id: string;
  date?: string;
  method?: string | null;
  notes?: string | null;
  lines: Array<{ event_id: string; role: string }>;
  source?: 'manual' | 'line' | 'backfill';
  resolution?: PaymentResolution | null;
  expects_invoice?: boolean;
}

/**
 * Records one transfer against the lines it settles.
 *
 * The amount is never taken from the caller: it is the exact sum of the lines picked, because
 * that is what the band actually pays — the fees differ from show to show and the transfer is
 * their total. A figure typed independently could only ever disagree with the lines it claims
 * to cover, and then no reader would know which of the two was the payment.
 */
export const recordPayment = db.transaction((input: RecordPaymentInput): any => {
  const supplier = supplierById(input.supplier_id);
  if (!supplier) throw Object.assign(new Error('supplier not found'), { status: 404 });

  const requested = Array.isArray(input.lines) ? input.lines : [];
  if (!requested.length) throw Object.assign(new Error('לא נבחרו שורות לתשלום'), { status: 400 });

  const assigned = db.prepare(
    'SELECT 1 FROM band_event_assignments WHERE event_id = ? AND role = ? AND supplier_id = ?'
  );
  const taken = db.prepare(
    'SELECT payment_id FROM supplier_payment_lines WHERE event_id = ? AND role = ?'
  );

  const lines: Array<{ event_id: string; role: AssignmentRole; amount: number }> = [];
  const seen = new Set<string>();
  for (const line of requested) {
    const role = String(line?.role || '');
    const eventId = String(line?.event_id || '');
    if (!isAssignmentRole(role)) throw Object.assign(new Error('תפקיד לא חוקי'), { status: 400 });
    const key = `${eventId}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!assigned.get(eventId, role, supplier.id)) {
      throw Object.assign(new Error('הספק אינו משובץ בתפקיד הזה בהופעה'), { status: 400 });
    }
    if (taken.get(eventId, role)) {
      throw Object.assign(new Error('אחת השורות כבר שולמה בתשלום אחר'), { status: 409 });
    }
    const expense = expenseRowForEvent(eventId);
    const amount = round2(Number(expense?.[role]) || 0);
    if (!amount) throw Object.assign(new Error('אין סכום בשורה שנבחרה'), { status: 400 });
    lines.push({ event_id: eventId, role, amount });
  }

  const id = uuid();
  const amount = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  db.prepare(
    `INSERT INTO supplier_payments
       (id, supplier_id, date, amount, method, notes, expects_invoice, resolution, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, supplier.id, input.date || today(), amount, input.method || null, input.notes || null,
    (input.expects_invoice ?? !!supplier.expects_invoice) ? 1 : 0,
    input.resolution ?? null, input.source || 'manual'
  );

  const insertLine = db.prepare(
    'INSERT INTO supplier_payment_lines (payment_id, event_id, role, amount) VALUES (?, ?, ?, ?)'
  );
  const byEvent = new Map<string, AssignmentRole[]>();
  for (const line of lines) {
    insertLine.run(id, line.event_id, line.role, line.amount);
    byEvent.set(line.event_id, [...(byEvent.get(line.event_id) || []), line.role]);
  }
  for (const [eventId, roles] of byEvent) applyPaidFlags(eventId, roles, true);

  return getPayment(id);
});

/**
 * Undoes a payment: the lines it settled go back to being owed.
 *
 * Deleting is the only correction offered, rather than editing the lines in place. A transfer
 * that covered the wrong shows was a different transfer, and re-recording it takes one dialog;
 * an edit path would have to keep flags, line rows and any linked documents consistent through
 * every partial change, for a case that happens rarely and is trivially redone.
 */
export const deletePayment = db.transaction((id: string) => {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id) as any;
  if (!payment) throw Object.assign(new Error('payment not found'), { status: 404 });

  const byEvent = new Map<string, AssignmentRole[]>();
  for (const line of paymentLines(id)) {
    byEvent.set(line.event_id, [...(byEvent.get(line.event_id) || []), line.role]);
  }
  db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(id);
  for (const [eventId, roles] of byEvent) applyPaidFlags(eventId, roles, false);
});

/**
 * Keeps the payment rows honest when a `${role}_paid` flag is flipped somewhere else.
 *
 * Ticking a cost line on the show page, and «שולם לכל הספקים» on the show's evening, both
 * still write the flags directly — they are the fastest way to settle a show and there is no
 * reason to make them slower. This runs after them: a line that has just become paid and
 * belongs to a supplier gets a payment of its own, and one that has been un-ticked gives its
 * payment back. Without it the queue would quietly miss every payment made the quick way,
 * which is the failure this whole feature exists to prevent.
 *
 * A line with no supplier staffed on it (א.ק.ו.ם, the hall, the bracelets) produces no
 * payment: there is nobody to chase a document from, and inventing a payee would put a row in
 * the queue that can never close.
 */
export const syncLinePayments = db.transaction((eventId: string): void => {
  const expense = expenseRowForEvent(eventId);
  if (!expense) return;
  const event = db.prepare('SELECT * FROM band_events WHERE id = ?').get(eventId) as any;
  if (!event) return;

  const assignments = db
    .prepare('SELECT role, supplier_id FROM band_event_assignments WHERE event_id = ?')
    .all(eventId) as any[];
  const supplierFor = new Map<string, string>(
    assignments.filter((a) => a.supplier_id).map((a) => [a.role, a.supplier_id])
  );

  for (const role of ASSIGNMENT_ROLES) {
    const amount = round2(Number(expense[role]) || 0);
    const paid = !!expense[`${role}_paid`];
    const existing = db
      .prepare(
        `SELECT l.payment_id, l.amount, p.source, p.resolution
           FROM supplier_payment_lines l JOIN supplier_payments p ON p.id = l.payment_id
          WHERE l.event_id = ? AND l.role = ?`
      )
      .get(eventId, role) as any;

    if (paid && amount > 0 && !existing) {
      const supplierId = supplierFor.get(role);
      if (!supplierId) continue;
      recordPayment({
        supplier_id: supplierId,
        // The flag was flipped now, so now is when the money moved. A show settled on the
        // night is ticked on the night; one ticked later is dated when somebody said so,
        // which is the best evidence there is.
        date: today(),
        lines: [{ event_id: eventId, role }],
        source: 'line',
      });
      continue;
    }

    if (!existing) continue;

    if (!paid || amount === 0) {
      // The line is owed again (or was zeroed): drop it, and the payment with it once it
      // covers nothing. Emptying rather than keeping a ₪0 row, so the queue never shows a
      // transfer that did not happen.
      db.prepare('DELETE FROM supplier_payment_lines WHERE payment_id = ? AND event_id = ? AND role = ?')
        .run(existing.payment_id, eventId, role);
      refreshPaymentAmount(existing.payment_id);
      continue;
    }

    // The fee was corrected after it was marked paid. A correction made before any document
    // has been linked is simply a better figure for the same transfer, so it is adopted; once
    // a document answers for the payment the recorded amount is what was matched against, and
    // rewriting it under the match would make the coverage arithmetic lie.
    if (round2(Number(existing.amount) || 0) !== amount && !hasDocs(existing.payment_id)) {
      db.prepare(
        'UPDATE supplier_payment_lines SET amount = ? WHERE payment_id = ? AND event_id = ? AND role = ?'
      ).run(amount, existing.payment_id, eventId, role);
      refreshPaymentAmount(existing.payment_id);
    }
  }
});

const hasDocs = (paymentId: string): boolean =>
  !!db.prepare('SELECT 1 FROM supplier_payment_docs WHERE payment_id = ?').get(paymentId);

/** Re-totals a payment from its lines, and deletes it once it has none left. */
function refreshPaymentAmount(paymentId: string) {
  const row = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM supplier_payment_lines WHERE payment_id = ?')
    .get(paymentId) as { n: number; total: number };
  if (!row.n) {
    db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(paymentId);
    return;
  }
  db.prepare('UPDATE supplier_payments SET amount = ? WHERE id = ?').run(round2(row.total), paymentId);
}

// ============================== documents ==============================

/**
 * Reduces a name to what two spellings of the same business have in common.
 *
 * Quotes, geresh, the legal suffix and the punctuation around it are all noise here: «א. כהן
 * הפקות בע"מ» and «א כהן הפקות» are one supplier. This is deliberately only ever used as a
 * *weak* signal — it proposes a match for a person to confirm, and never links one by itself.
 */
export function normalizeName(value: unknown): string {
  return String(value || '')
    .replace(/["'״׳`.,\-–—()]/g, ' ')
    .replace(/\bבע\s*מ\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const supplierAliases = (supplier: any): string[] =>
  String(supplier.aliases || '')
    .split(/[\n,]/)
    .map(normalizeName)
    .filter(Boolean);

/** How firmly a document was tied to a supplier, which is what decides whether to ask first. */
type MatchStrength = 'id' | 'name' | null;

/**
 * Which supplier issued this expense, and on what evidence.
 *
 * The Morning supplier id and the tax id are identities: no two businesses share either, so a
 * document carrying one belongs to that supplier and nothing else needs checking. A name is a
 * resemblance — the same person can appear as three spellings and two different people can
 * share one — so it is reported as the weaker answer rather than treated as the same fact.
 */
export function resolveSupplier(
  expense: any,
  suppliers: any[]
): { supplier: any; strength: MatchStrength } | null {
  const morningId = String(expense.external_supplier_id || '').trim();
  if (morningId) {
    const match = suppliers.find((s) => String(s.morning_supplier_id || '').trim() === morningId);
    if (match) return { supplier: match, strength: 'id' };
  }
  const taxId = String(expense.supplier_tax_id || '').replace(/\D/g, '');
  if (taxId) {
    const match = suppliers.find((s) => String(s.tax_id || '').replace(/\D/g, '') === taxId);
    if (match) return { supplier: match, strength: 'id' };
  }
  const name = normalizeName(expense.supplier_name);
  if (name) {
    const match = suppliers.find(
      (s) => normalizeName(s.name) === name || supplierAliases(s).includes(name)
    );
    if (match) return { supplier: match, strength: 'name' };
  }
  return null;
}

const documentedTotal = (paymentId: string): number => {
  const row = db
    .prepare('SELECT COALESCE(SUM(allocated_amount), 0) AS total FROM supplier_payment_docs WHERE payment_id = ?')
    .get(paymentId) as { total: number };
  return round2(row.total);
};

/** What is left of a payment for a document to answer for. */
const remainingOf = (payment: any): number =>
  round2(Math.max(0, round2(Number(payment.amount) || 0) - documentedTotal(payment.id)));

export function paymentStatus(payment: any, documented: number): PaymentDocStatus {
  if (payment.resolution === 'verified') return 'verified';
  if (payment.resolution === 'not_required') return 'not_required';
  if (!payment.expects_invoice) return 'not_required';
  const amount = round2(Number(payment.amount) || 0);
  return documented + TOLERANCE >= amount ? 'documented' : 'waiting';
}

/** The Morning expenses no payment claims yet — the pool every match is drawn from. */
function unlinkedExpenses(): any[] {
  return db
    .prepare(
      `SELECT * FROM expenses
        WHERE id NOT IN (SELECT expense_id FROM supplier_payment_docs)
        ORDER BY date DESC`
    )
    .all() as any[];
}

/** Attaches one document to one payment, covering as much of it as is still open. */
export const linkDocument = db.transaction((
  paymentId: string,
  expenseId: string,
  matchedBy: 'auto' | 'user' = 'user'
): void => {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(paymentId) as any;
  if (!payment) throw Object.assign(new Error('payment not found'), { status: 404 });
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!expense) throw Object.assign(new Error('expense not found'), { status: 404 });

  // What this document covers of *this* payment, which is not the same as what it is worth:
  // a payment already answered for allocates nothing more, so a second document attached to
  // it by mistake cannot inflate the coverage past what was actually paid.
  const total = round2(Number(expense.total) || 0);
  const allocated = Math.min(total, remainingOf(payment));
  db.prepare(
    `INSERT INTO supplier_payment_docs (payment_id, expense_id, allocated_amount, matched_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(payment_id, expense_id) DO UPDATE SET allocated_amount = excluded.allocated_amount`
  ).run(paymentId, expenseId, round2(allocated), matchedBy);
});

export function unlinkDocument(paymentId: string, expenseId: string) {
  db.prepare('DELETE FROM supplier_payment_docs WHERE payment_id = ? AND expense_id = ?')
    .run(paymentId, expenseId);
}

/** The documents already answering for a payment, for showing under it. */
export function paymentDocs(paymentId: string): any[] {
  return db
    .prepare(
      `SELECT e.id, e.number, e.date, e.supplier_name, e.total, e.vat_amount, e.doc_type,
              d.allocated_amount, d.matched_by
         FROM supplier_payment_docs d JOIN expenses e ON e.id = d.expense_id
        WHERE d.payment_id = ?
        ORDER BY e.date`
    )
    .all(paymentId) as any[];
}

/**
 * The documents that could plausibly answer for a payment, closest figure first.
 *
 * Computed on demand rather than stored. A suggestion is a reading of two tables that both
 * keep changing — the next Morning pull adds documents, and linking one elsewhere removes a
 * candidate — so a stored suggestion is a stale one, and there is nothing here worth the cost
 * of keeping it fresh.
 */
export function suggestionsFor(payment: any, suppliers?: any[], pool?: any[]): any[] {
  const all = suppliers || (db.prepare('SELECT * FROM band_suppliers').all() as any[]);
  const candidates = pool || unlinkedExpenses();
  const remaining = remainingOf(payment);
  const from = shiftDate(payment.date, -WINDOW_BEFORE_DAYS);
  const to = shiftDate(payment.date, WINDOW_AFTER_DAYS);

  return candidates
    .filter((expense) => {
      const date = String(expense.date || '');
      if (date < from || date > to) return false;
      const resolved = resolveSupplier(expense, all);
      return resolved?.supplier.id === payment.supplier_id;
    })
    .map((expense) => ({
      id: expense.id,
      number: expense.number,
      date: expense.date,
      supplier_name: expense.supplier_name,
      total: round2(Number(expense.total) || 0),
      vat_amount: round2(Number(expense.vat_amount) || 0),
      doc_type: expense.doc_type,
      exact: Math.abs(round2(Number(expense.total) || 0) - remaining) <= TOLERANCE,
    }))
    .sort((a, b) => Math.abs(a.total - remaining) - Math.abs(b.total - remaining))
    .slice(0, 8);
}

/**
 * Links every document that can be tied to a payment beyond doubt, and leaves the rest alone.
 *
 * Beyond doubt means two things at once: the supplier was resolved by an identity rather than
 * by a name, and the document's gross total is what the payment still has open. Gross is the
 * side that matches — a show's cost lines are entered including מע"מ (`vat_summary` restates
 * what is inside them rather than adding to it), so `expenses.total` is the comparable figure
 * and `expenses.amount` would be short by the VAT on every מורשה supplier.
 *
 * Everything softer than that is returned as a suggestion for a person to confirm. A wrong
 * link is worse than an unmatched row: it closes a queue item that should still be open and
 * puts a document against money it has nothing to do with.
 */
export function runMatch(): { linked: number } {
  const suppliers = db.prepare('SELECT * FROM band_suppliers').all() as any[];
  if (!suppliers.length) return { linked: 0 };

  const open = db
    .prepare(
      `SELECT * FROM supplier_payments
        WHERE resolution IS NULL AND expects_invoice = 1
        ORDER BY date`
    )
    .all() as any[];

  let linked = 0;
  for (const payment of open) {
    const remaining = remainingOf(payment);
    if (remaining <= TOLERANCE) continue;
    const from = shiftDate(payment.date, -WINDOW_BEFORE_DAYS);
    const to = shiftDate(payment.date, WINDOW_AFTER_DAYS);

    // Re-read inside the loop: a document linked to an earlier payment is no longer a
    // candidate for this one, and one expense must never answer for two transfers.
    const match = unlinkedExpenses().find((expense) => {
      const date = String(expense.date || '');
      if (date < from || date > to) return false;
      const resolved = resolveSupplier(expense, suppliers);
      if (resolved?.strength !== 'id' || resolved.supplier.id !== payment.supplier_id) return false;
      return Math.abs(round2(Number(expense.total) || 0) - remaining) <= TOLERANCE;
    });
    if (!match) continue;
    linkDocument(payment.id, match.id, 'auto');
    linked++;
  }
  return { linked };
}

// ============================== reading it back ==============================

export function getPayment(id: string): any {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id) as any;
  if (!payment) return null;
  const documented = documentedTotal(id);
  return {
    ...payment,
    expects_invoice: !!payment.expects_invoice,
    supplier_name: supplierById(payment.supplier_id)?.name ?? '?',
    amount: round2(Number(payment.amount) || 0),
    documented,
    missing: round2(Math.max(0, round2(Number(payment.amount) || 0) - documented)),
    doc_status: paymentStatus(payment, documented),
    lines: paymentLines(id),
    docs: paymentDocs(id),
  };
}

/**
 * Every payment, with what answers for it — the working list.
 *
 * The suggestions are attached here rather than fetched per row: they come from one pass over
 * the unlinked expenses, and a screen that shows twenty waiting payments would otherwise make
 * twenty passes over the same table.
 */
export function listPayments(): any[] {
  const suppliers = db.prepare('SELECT * FROM band_suppliers').all() as any[];
  const pool = unlinkedExpenses();
  const rows = db.prepare('SELECT * FROM supplier_payments ORDER BY date DESC').all() as any[];
  const now = today();

  return rows.map((payment) => {
    const full = getPayment(payment.id);
    const waiting = full.doc_status === 'waiting';
    return {
      ...full,
      age_days: Math.max(0, daysBetween(payment.date, now)),
      suggestions: waiting ? suggestionsFor(payment, suppliers, pool) : [],
    };
  });
}

/**
 * What is still owed to the books, aged.
 *
 * The headline is money, not a count: an undocumented payment is not a deductible expense and
 * the מע"מ inside it cannot be reclaimed, so `vat_at_risk` is the figure that actually decides
 * whether this list is worth an afternoon. It is estimated at the business rate rather than
 * read off a document, for the obvious reason that the document is the thing that is missing —
 * and only for suppliers registered as מורשה, since an עוסק פטור charges none to reclaim.
 */
export function invoiceQueue(vatPercent: number): {
  rows: any[]; total: number; vat_at_risk: number; oldest_days: number;
} {
  const rows = listPayments().filter((p) => p.doc_status === 'waiting');

  // An upper bound, and labelled as one on the screen. Whether a given supplier charges מע"מ
  // at all depends on whether they are an עוסק מורשה, which is a fact about them this table
  // does not record — so the estimate assumes they all do. Erring high is the right direction
  // for a figure whose only job is to say whether chasing these documents is worth an
  // afternoon; erring low would quietly argue for ignoring them.
  const rate = vatPercent / 100;
  const vat = rows.reduce((sum, row) => sum + (row.missing * rate) / (1 + rate), 0);

  return {
    rows,
    total: round2(rows.reduce((sum, row) => sum + row.missing, 0)),
    vat_at_risk: round2(vat),
    oldest_days: rows.reduce((max, row) => Math.max(max, row.age_days), 0),
  };
}

/** Per supplier: how much they have been paid that no document answers for yet. */
export function supplierInvoiceGaps(): Map<string, { missing: number; payments: number; oldest_days: number }> {
  const gaps = new Map<string, { missing: number; payments: number; oldest_days: number }>();
  for (const row of listPayments()) {
    if (row.doc_status !== 'waiting') continue;
    const entry = gaps.get(row.supplier_id) || { missing: 0, payments: 0, oldest_days: 0 };
    entry.missing = round2(entry.missing + row.missing);
    entry.payments += 1;
    entry.oldest_days = Math.max(entry.oldest_days, row.age_days);
    gaps.set(row.supplier_id, entry);
  }
  return gaps;
}

/** Closes a payment without a document, or reopens one that was closed by mistake. */
export function setResolution(id: string, resolution: PaymentResolution | null): any {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id) as any;
  if (!payment) throw Object.assign(new Error('payment not found'), { status: 404 });
  db.prepare('UPDATE supplier_payments SET resolution = ? WHERE id = ?').run(resolution, id);
  return getPayment(id);
}

/**
 * Drops payments whose lines have all gone with the shows they belonged to.
 *
 * Deleting a show takes its cost lines with it through the cascade, which can empty a payment
 * without emptying the payment row — leaving a transfer in the queue that covers nothing and
 * can never be documented. Re-totalling rather than only deleting matters too: a payment that
 * settled four shows and lost one of them is still a real transfer, and what is left of it is
 * what it now stands for.
 */
export function pruneOrphanPayments(): number {
  const rows = db
    .prepare(
      `SELECT p.id, p.amount, COUNT(l.payment_id) AS lines,
              COALESCE(SUM(l.amount), 0) AS total
         FROM supplier_payments p
         LEFT JOIN supplier_payment_lines l ON l.payment_id = p.id
        GROUP BY p.id`
    )
    .all() as any[];

  // A link whose document is gone — an expense removed in Morning and dropped by a rebuild of
  // the table — covers nothing, and leaving it would keep a payment looking answered for.
  const dropped = db.prepare(
    'DELETE FROM supplier_payment_docs WHERE expense_id NOT IN (SELECT id FROM expenses)'
  ).run();

  let changed = dropped.changes;
  for (const row of rows) {
    if (!row.lines) {
      db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(row.id);
      changed++;
    } else if (round2(Number(row.total)) !== round2(Number(row.amount))) {
      db.prepare('UPDATE supplier_payments SET amount = ? WHERE id = ?').run(round2(row.total), row.id);
      changed++;
    }
  }
  return changed;
}

// ============================== the migration ==============================

/**
 * The last date whose supplier payments are taken as already settled and documented.
 *
 * Everything up to and including the June 2026 shows was paid and its paperwork dealt with
 * before this table existed, so those payments enter the ledger closed. A backfilled row that
 * claimed to be waiting would be a red line nobody could ever clear — it would be asking for
 * an invoice that arrived a year ago, filed somewhere this app has never looked.
 */
export const VERIFIED_THROUGH = '2026-06-30';

/**
 * Gives every already-paid cost line a payment row, so the ledger starts complete.
 *
 * Each becomes a payment of its own, dated to its show. Grouping them into the transfers they
 * were really part of is not possible from the flags — that information was exactly what the
 * old shape threw away — and a guessed grouping would be a worse record than an honest
 * per-line one.
 */
export function backfillSupplierPayments(): number {
  if (getSetting('moonlight_supplier_payments_v1', '') === 'done') return 0;

  const created = db.transaction((): number => {
    const rows = db
      .prepare(
        `SELECT a.event_id, a.role, a.supplier_id, e.date
           FROM band_event_assignments a
           JOIN band_events e ON e.id = a.event_id
          WHERE a.supplier_id IS NOT NULL
          ORDER BY e.date`
      )
      .all() as any[];

    let n = 0;
    for (const row of rows) {
      if (!isAssignmentRole(row.role)) continue;
      const expense = expenseRowForEvent(row.event_id);
      const amount = round2(Number(expense?.[row.role]) || 0);
      if (!amount || !expense?.[`${row.role}_paid`]) continue;
      if (db.prepare('SELECT 1 FROM supplier_payment_lines WHERE event_id = ? AND role = ?')
        .get(row.event_id, row.role)) continue;

      const id = uuid();
      db.prepare(
        `INSERT INTO supplier_payments
           (id, supplier_id, date, amount, expects_invoice, resolution, source, notes)
         VALUES (?, ?, ?, ?, 1, ?, 'backfill', ?)`
      ).run(
        id, row.supplier_id, row.date, amount,
        row.date <= VERIFIED_THROUGH ? 'verified' : null,
        row.date <= VERIFIED_THROUGH ? 'הועבר מהסימון «שולם» — חשבונית טופלה לפני המעקב' : null
      );
      db.prepare(
        'INSERT INTO supplier_payment_lines (payment_id, event_id, role, amount) VALUES (?, ?, ?, ?)'
      ).run(id, row.event_id, row.role, amount);
      n++;
    }
    setSetting('moonlight_supplier_payments_v1', 'done');
    return n;
  })();

  return created;
}
