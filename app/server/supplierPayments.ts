/**
 * Paying somebody, and chasing the document that should come back for it.
 *
 * The band pays אבי once for four gigs. Before this module that transfer left four unrelated
 * `${role}_paid = 1` flags on four shows: no date, no amount, and nothing to ask «did his
 * invoice arrive?» about. A payment is now a row of its own with the lines it settled hanging
 * off it, and the flags are kept in step as its consequence — so `expenseOutstanding`,
 * `supplierDebts` and every screen that reads them carry on unchanged.
 *
 * "Somebody" is a supplier or a member of the band, because the question is the same for both.
 * A member who is an עוסק invoices the band for their share of a show; until that invoice
 * arrives the share is money paid out with nothing filed against it, exactly like a fee paid
 * to a תאורן. The band's own members are usually its largest outgoing, so a queue that left
 * them out was answering «what is undocumented?» with a fraction of the answer.
 *
 * The chase matters for money rather than tidiness: a payment with no document behind it is
 * not deductible, and the מע"מ inside it cannot be reclaimed. That is why the queue reports
 * shekels rather than a count of chores.
 */
import { db, uuid, getSetting, setSetting } from './db.js';
import { expenseRowForEvent, recomputeEvent } from './band.js';
import { allRoles, isAssignmentRole, roleName, roleNames } from './supplierRoles.js';
import {
  keyOf, listPayees, payeeColumns, payeeKey, payeeRef, payeesByKey,
  type Payee, type PayeeKind,
} from './payees.js';
import {
  SIMILAR_ENOUGH, aliasMap, aliasNamesByPayee, nameSimilarity, normalizeName,
} from './supplierNames.js';

type AssignmentRole = string;

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

/**
 * One thing a payment can settle: a cost line of a show, or one member's share of it.
 *
 * Exactly one of `role` and `member_key` is set, the same way the payment itself names exactly
 * one payee. `label` is what to call it on screen — the role's name as the band has defined
 * it, or the fact that this is somebody's share — computed here so no screen has to know how
 * to tell the two apart.
 */
export interface OpenLine {
  event_id: string;
  venue: string;
  date: string;
  role: AssignmentRole | null;
  member_key: string | null;
  label: string;
  amount: number;
  /** A fee on a show that has not happened yet is not a debt — see supplierDebts. */
  upcoming: boolean;
}

/** What a member's share of one show is called wherever a cost line would name its role. */
const SHARE_LABEL = 'חלוקת רווח';

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

const shiftDate = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

// ============================== open lines and payments ==============================

/**
 * What this payee has not been paid for yet — what the pay dialog offers to settle.
 *
 * For a supplier: the cost lines of the shows they are staffed on. For a member: their share
 * of each show, which the band pays them the same way and which nothing but this has ever
 * tracked per member — «שולם לנגנים» was one flag for the whole band on one show.
 *
 * Upcoming shows are returned alongside the ones already played rather than filtered out: the
 * band does occasionally settle a booking in advance, and the caller is better placed to
 * decide than a query is. They are flagged, not hidden.
 */
export function openLines(payee: { kind: PayeeKind; id: string }): OpenLine[] {
  const now = today();
  const lines: OpenLine[] = [];

  if (payee.kind === 'member') {
    const rows = db
      .prepare(
        `SELECT s.event_id, s.amount, e.venue, e.date
           FROM band_event_shares s
           JOIN band_events e ON e.id = s.event_id
          WHERE s.member_key = ?
            AND NOT EXISTS (
              SELECT 1 FROM supplier_payment_lines l
               WHERE l.event_id = s.event_id AND l.member_key = s.member_key
            )
          ORDER BY e.date`
      )
      .all(payee.id) as any[];
    for (const row of rows) {
      const amount = round2(Number(row.amount) || 0);
      if (!amount) continue;
      lines.push({
        event_id: row.event_id, venue: row.venue, date: row.date,
        role: null, member_key: payee.id, label: SHARE_LABEL,
        amount, upcoming: row.date > now,
      });
    }
    return lines;
  }

  const rows = db
    .prepare(
      `SELECT a.role, e.id AS event_id, e.venue, e.date
         FROM band_event_assignments a
         JOIN band_events e ON e.id = a.event_id
        WHERE a.supplier_id = ?
        ORDER BY e.date`
    )
    .all(payee.id) as any[];

  for (const row of rows) {
    if (!isAssignmentRole(row.role)) continue;
    const expense = expenseRowForEvent(row.event_id);
    const amount = round2(Number(expense?.[row.role]) || 0);
    if (!amount || expense?.[`${row.role}_paid`]) continue;
    lines.push({
      event_id: row.event_id, venue: row.venue, date: row.date,
      role: row.role, member_key: null, label: roleName(row.role),
      amount, upcoming: row.date > now,
    });
  }
  return lines;
}

/** The lines one payment settled, for showing what a transfer was actually for. */
export function paymentLines(paymentId: string): OpenLine[] {
  const names = roleNames();
  return db
    .prepare(
      `SELECT l.event_id, l.role, l.member_key, l.amount, e.venue, e.date
         FROM supplier_payment_lines l
         JOIN band_events e ON e.id = l.event_id
        WHERE l.payment_id = ?
        ORDER BY e.date`
    )
    .all(paymentId)
    .map((row: any) => ({
      event_id: row.event_id, venue: row.venue, date: row.date,
      role: row.role ?? null, member_key: row.member_key ?? null,
      label: row.role ? (names.get(row.role) || row.role) : SHARE_LABEL,
      amount: round2(Number(row.amount) || 0),
      upcoming: row.date > today(),
    }));
}

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

/**
 * Keeps «שולם לנגנים» saying what the member payments now say.
 *
 * The flag is one bit for a whole show, which is all it ever was: it cannot record that one
 * member has been paid and another has not. The payment lines can, so they are the truth and the flag is
 * their summary — on when every share of the show is covered, off while any is outstanding.
 * Keeping it in step matters because the show page, the follow-up lists and the summary all
 * still read it.
 */
function syncMembersPaidFlag(eventId: string) {
  const shares = db
    .prepare('SELECT member_key, amount FROM band_event_shares WHERE event_id = ?')
    .all(eventId) as any[];
  const owed = shares.filter((s) => round2(Number(s.amount) || 0) > 0);
  const covered = new Set(
    (db.prepare(
      'SELECT member_key FROM supplier_payment_lines WHERE event_id = ? AND member_key IS NOT NULL'
    ).all(eventId) as any[]).map((r) => r.member_key)
  );
  const allPaid = owed.length > 0 && owed.every((s) => covered.has(s.member_key));
  const event = db.prepare('SELECT paid_to_musicians FROM band_events WHERE id = ?').get(eventId) as any;
  if (!event || !!event.paid_to_musicians === allPaid) return;
  db.prepare('UPDATE band_events SET paid_to_musicians = ? WHERE id = ?').run(allPaid ? 1 : 0, eventId);
  recomputeEvent(eventId);
}

export interface RecordPaymentInput {
  payee: { kind: PayeeKind; id: string };
  date?: string;
  method?: string | null;
  notes?: string | null;
  /**
   * What the transfer settles. A supplier's line names the role; a member's line names only
   * the show, because the share it settles is theirs by definition — the payment already says
   * who was paid, and asking the caller to repeat it would let the two disagree.
   */
  lines: Array<{ event_id: string; role?: string | null }>;
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
  const payee = listPayees().find((p) => p.kind === input.payee?.kind && p.id === input.payee?.id);
  if (!payee) throw Object.assign(new Error('payee not found'), { status: 404 });

  const requested = Array.isArray(input.lines) ? input.lines : [];
  if (!requested.length) throw Object.assign(new Error('לא נבחרו שורות לתשלום'), { status: 400 });

  const assigned = db.prepare(
    'SELECT 1 FROM band_event_assignments WHERE event_id = ? AND role = ? AND supplier_id = ?'
  );
  const roleTaken = db.prepare(
    'SELECT payment_id FROM supplier_payment_lines WHERE event_id = ? AND role = ?'
  );
  const memberTaken = db.prepare(
    'SELECT payment_id FROM supplier_payment_lines WHERE event_id = ? AND member_key = ?'
  );
  const shareOf = db.prepare(
    'SELECT amount FROM band_event_shares WHERE event_id = ? AND member_key = ?'
  );

  const lines: Array<{ event_id: string; role: string | null; member_key: string | null; amount: number }> = [];
  const seen = new Set<string>();
  for (const line of requested) {
    const eventId = String(line?.event_id || '');
    if (!eventId) throw Object.assign(new Error('שורה ללא הופעה'), { status: 400 });

    if (payee.kind === 'member') {
      if (seen.has(eventId)) continue;
      seen.add(eventId);
      if (memberTaken.get(eventId, payee.id)) {
        throw Object.assign(new Error('אחת השורות כבר שולמה בתשלום אחר'), { status: 409 });
      }
      const amount = round2(Number((shareOf.get(eventId, payee.id) as any)?.amount) || 0);
      if (!amount) throw Object.assign(new Error('אין סכום בשורה שנבחרה'), { status: 400 });
      lines.push({ event_id: eventId, role: null, member_key: payee.id, amount });
      continue;
    }

    const role = String(line?.role || '');
    if (!isAssignmentRole(role)) throw Object.assign(new Error('תפקיד לא חוקי'), { status: 400 });
    const key = `${eventId}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!assigned.get(eventId, role, payee.id)) {
      throw Object.assign(new Error('הספק אינו משובץ בתפקיד הזה בהופעה'), { status: 400 });
    }
    if (roleTaken.get(eventId, role)) {
      throw Object.assign(new Error('אחת השורות כבר שולמה בתשלום אחר'), { status: 409 });
    }
    const expense = expenseRowForEvent(eventId);
    const amount = round2(Number(expense?.[role]) || 0);
    if (!amount) throw Object.assign(new Error('אין סכום בשורה שנבחרה'), { status: 400 });
    lines.push({ event_id: eventId, role, member_key: null, amount });
  }

  const id = uuid();
  const amount = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const columns = payeeColumns(payee);
  db.prepare(
    `INSERT INTO supplier_payments
       (id, supplier_id, member_key, date, amount, method, notes, expects_invoice, resolution, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, columns.supplier_id, columns.member_key,
    input.date || today(), amount, input.method || null, input.notes || null,
    (input.expects_invoice ?? payee.expects_invoice) ? 1 : 0,
    input.resolution ?? null, input.source || 'manual'
  );

  const insertLine = db.prepare(
    `INSERT INTO supplier_payment_lines (id, payment_id, event_id, role, member_key, amount)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const rolesByEvent = new Map<string, AssignmentRole[]>();
  const memberEvents = new Set<string>();
  for (const line of lines) {
    insertLine.run(uuid(), id, line.event_id, line.role, line.member_key, line.amount);
    if (line.role) {
      rolesByEvent.set(line.event_id, [...(rolesByEvent.get(line.event_id) || []), line.role]);
    } else {
      memberEvents.add(line.event_id);
    }
  }
  for (const [eventId, roles] of rolesByEvent) applyPaidFlags(eventId, roles, true);
  for (const eventId of memberEvents) syncMembersPaidFlag(eventId);

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

  const rolesByEvent = new Map<string, AssignmentRole[]>();
  const memberEvents = new Set<string>();
  for (const line of paymentLines(id)) {
    if (line.role) {
      rolesByEvent.set(line.event_id, [...(rolesByEvent.get(line.event_id) || []), line.role]);
    } else {
      memberEvents.add(line.event_id);
    }
  }
  db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(id);
  for (const [eventId, roles] of rolesByEvent) applyPaidFlags(eventId, roles, false);
  for (const eventId of memberEvents) syncMembersPaidFlag(eventId);
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
 * A line with nobody staffed on it produces no payment: there is nobody to chase a document
 * from, and inventing a payee would put a row in the queue that can never close. Which lines
 * can have somebody on them is now the band's decision — see supplierRoles — so אק״ום, the
 * hall and the bracelets are only unstaffed until the band says who supplies them.
 *
 * The members' shares are kept in step the same way, off «שולם לנגנים»: the flag says the
 * band settled with everybody that night, and this turns that into one payment per member so
 * each of them can be asked for their invoice separately.
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

  // Every role, not only the active ones: a line staffed under a role the band has since
  // retired is still money that was paid, and skipping it would freeze its payment out of step
  // with the flag on the show.
  for (const role of allRoles().map((r) => r.key)) {
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
        payee: { kind: 'supplier', id: supplierId },
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

  syncSharePayments(eventId, event);
});

/**
 * The same for the members' shares, driven by «שולם לנגנים».
 *
 * A member with no share on the show gets nothing, and neither does one whose share is zero:
 * a ₪0 payment is not a transfer, and it would sit in the queue asking for an invoice for
 * nothing. A member registered as לא רשום does get a payment — the money did move — but it is
 * recorded as expecting no document, because none can be issued.
 */
function syncSharePayments(eventId: string, event: any) {
  const paid = !!event.paid_to_musicians;
  const shares = db
    .prepare(
      `SELECT s.member_key, s.amount, m.business_type
         FROM band_event_shares s
         LEFT JOIN band_members m ON m.member_key = s.member_key
        WHERE s.event_id = ?`
    )
    .all(eventId) as any[];

  for (const share of shares) {
    const amount = round2(Number(share.amount) || 0);
    const existing = db
      .prepare(
        `SELECT l.payment_id, l.amount
           FROM supplier_payment_lines l
          WHERE l.event_id = ? AND l.member_key = ?`
      )
      .get(eventId, share.member_key) as any;

    if (paid && amount > 0 && !existing) {
      recordPayment({
        payee: { kind: 'member', id: share.member_key },
        date: today(),
        lines: [{ event_id: eventId }],
        source: 'line',
      });
      continue;
    }
    if (!existing) continue;

    if (!paid || amount === 0) {
      db.prepare('DELETE FROM supplier_payment_lines WHERE payment_id = ? AND event_id = ? AND member_key = ?')
        .run(existing.payment_id, eventId, share.member_key);
      refreshPaymentAmount(existing.payment_id);
      continue;
    }

    // The division was recomputed after the band was marked paid. Same rule as a corrected
    // fee: adopt the better figure while nothing has been matched against the old one.
    if (round2(Number(existing.amount) || 0) !== amount && !hasDocs(existing.payment_id)) {
      db.prepare(
        'UPDATE supplier_payment_lines SET amount = ? WHERE payment_id = ? AND event_id = ? AND member_key = ?'
      ).run(amount, existing.payment_id, eventId, share.member_key);
      refreshPaymentAmount(existing.payment_id);
    }
  }
}

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
 * How firmly a document was tied to a supplier, which is what decides whether to ask first.
 *
 * 'id' and 'alias' are both certainties, from two different sources: an identity nobody can
 * share, or a person having said that this is the name that supplier invoices under. 'name'
 * is the app noticing that two strings look alike, which is a reason to ask and never a
 * reason to link.
 */
type MatchStrength = 'id' | 'alias' | 'name' | null;

/** Evidence good enough to link a document without anybody being asked. */
const isCertain = (strength: MatchStrength): boolean => strength === 'id' || strength === 'alias';

/**
 * Who issued this expense, and on what evidence.
 *
 * The Morning supplier id and the tax id are identities: no two businesses share either, so a
 * document carrying one belongs to that payee and nothing else needs checking. A recorded
 * invoice name (see supplierNames) is the same kind of fact by a different route — somebody
 * who knows said so once, and saying it again for every document that name arrives on is
 * exactly the work this app is meant to save. A bare resemblance between the two names is
 * reported as the weaker answer rather than treated as either.
 *
 * Members are in the same pool as suppliers, because a member's invoice reaches Morning the
 * same way a supplier's does and nothing on it says which of the two the issuer is.
 */
export function resolvePayee(
  expense: any,
  payees: Payee[],
  aliases: Map<string, string> = aliasMap()
): { payee: Payee; strength: MatchStrength } | null {
  const morningId = String(expense.external_supplier_id || '').trim();
  if (morningId) {
    const match = payees.find((p) => String(p.morning_supplier_id || '').trim() === morningId);
    if (match) return { payee: match, strength: 'id' };
  }
  const taxId = String(expense.supplier_tax_id || '').replace(/\D/g, '');
  if (taxId) {
    const match = payees.find((p) => String(p.tax_id || '').replace(/\D/g, '') === taxId);
    if (match) return { payee: match, strength: 'id' };
  }
  const name = normalizeName(expense.supplier_name);
  if (name) {
    const key = aliases.get(name);
    if (key) {
      const match = payees.find((p) => keyOf(p) === key);
      if (match) return { payee: match, strength: 'alias' };
    }
    const match = payees.find((p) => normalizeName(p.name) === name);
    if (match) return { payee: match, strength: 'name' };
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

/**
 * The Morning expenses that still have value left to answer with — the pool every match is
 * drawn from.
 *
 * "Still have value" rather than "unclaimed": an invoice covering an advance and a balance is
 * one of the four shapes this link table exists for, and a pool that dropped a document the
 * moment it answered for anything made that shape unreachable — the second payment could
 * never be closed except by hand, against a document the screen refused to offer.
 *
 * `exceptPaymentId` leaves out what one payment already claims, so a document being attached
 * to the payment it is already on is measured against what it would be worth without that
 * link, instead of against nothing.
 */
function availableExpenses(exceptPaymentId = ''): any[] {
  return db
    .prepare(
      `SELECT e.*, ROUND(e.total - COALESCE(d.used, 0), 2) AS available
         FROM expenses e
         LEFT JOIN (
              SELECT expense_id, SUM(allocated_amount) AS used
                FROM supplier_payment_docs
               WHERE payment_id != ?
               GROUP BY expense_id
         ) d ON d.expense_id = e.id
        WHERE e.total - COALESCE(d.used, 0) > ?
        ORDER BY e.date DESC`
    )
    .all(exceptPaymentId, TOLERANCE) as any[];
}

/** What one document has left to give, ignoring what `exceptPaymentId` already claims of it. */
function availableOf(expense: any, exceptPaymentId = ''): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(allocated_amount), 0) AS used
         FROM supplier_payment_docs WHERE expense_id = ? AND payment_id != ?`
    )
    .get(expense.id, exceptPaymentId) as { used: number };
  return round2(round2(Number(expense.total) || 0) - round2(row.used));
}

/**
 * Attaches one document to one payment, covering as much of it as is still open.
 *
 * Both sides are bounded, and for the same reason: a payment cannot be documented past what
 * was actually paid, and a document cannot answer for more money than it is worth. Refusing
 * rather than linking ₪0 is what tells the person the screen offered them something that
 * cannot help — a silent zero would look like it had worked and leave the payment red.
 */
export const linkDocument = db.transaction((
  paymentId: string,
  expenseId: string,
  matchedBy: 'auto' | 'user' = 'user'
): void => {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(paymentId) as any;
  if (!payment) throw Object.assign(new Error('payment not found'), { status: 404 });
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!expense) throw Object.assign(new Error('expense not found'), { status: 404 });

  // Measured as if this link did not exist yet, so re-linking a document that is already on
  // this payment recomputes the same figure instead of shrinking it to nothing.
  const pair = db
    .prepare('SELECT allocated_amount FROM supplier_payment_docs WHERE payment_id = ? AND expense_id = ?')
    .get(paymentId, expenseId) as any;
  const claimed = round2(documentedTotal(paymentId) - round2(Number(pair?.allocated_amount) || 0));
  const remaining = round2(Math.max(0, round2(Number(payment.amount) || 0) - claimed));
  if (remaining <= TOLERANCE) {
    throw Object.assign(new Error('התשלום כבר מכוסה במלואו במסמכים'), { status: 409 });
  }

  const available = availableOf(expense, paymentId);
  if (available <= TOLERANCE) {
    throw Object.assign(new Error('המסמך כבר משויך במלואו לתשלומים אחרים'), { status: 409 });
  }

  db.prepare(
    `INSERT INTO supplier_payment_docs (payment_id, expense_id, allocated_amount, matched_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(payment_id, expense_id) DO UPDATE SET allocated_amount = excluded.allocated_amount`
  ).run(paymentId, expenseId, round2(Math.min(available, remaining)), matchedBy);
});

export function unlinkDocument(paymentId: string, expenseId: string) {
  db.prepare('DELETE FROM supplier_payment_docs WHERE payment_id = ? AND expense_id = ?')
    .run(paymentId, expenseId);
}

/**
 * The documents already answering for a payment, for showing under it.
 *
 * `remaining` is what the document still has to give *anywhere* — its total less everything it
 * covers, on this payment and on any other. An invoice that covered two gigs and has been
 * attached to one of them is not spent, and a screen that showed only what it covers here
 * would leave the person believing the other half of it is gone.
 */
export function paymentDocs(paymentId: string): any[] {
  return db
    .prepare(
      `SELECT e.id, e.number, e.date, e.supplier_name, e.total, e.vat_amount, e.doc_type,
              d.allocated_amount, d.matched_by,
              ROUND(e.total - (
                SELECT COALESCE(SUM(allocated_amount), 0)
                  FROM supplier_payment_docs WHERE expense_id = e.id
              ), 2) AS remaining
         FROM supplier_payment_docs d JOIN expenses e ON e.id = d.expense_id
        WHERE d.payment_id = ?
        ORDER BY e.date`
    )
    .all(paymentId) as any[];
}

/**
 * Why a document is being offered for a payment, strongest first. Shown on the row, because
 * «אותו ספק» and «סכום זהה, ספק לא מזוהה» are two very different things to be asked to confirm.
 */
export type SuggestionReason = 'supplier' | 'amount' | 'similar';

/**
 * One row of the suggestion list, and of the manual picker — the same shape either way.
 *
 * `payeeNames` is what the payment's payee answers to, passed in rather than looked up: this
 * runs once per candidate document, and a query per row would make a screen of twenty waiting
 * payments a few thousand of them.
 */
function documentCard(
  expense: any,
  remaining: number,
  payee: Payee | undefined,
  aliases: Map<string, string>,
  payees: Payee[],
  payeeNames: string[]
) {
  const available = round2(Number(expense.available ?? expense.total) || 0);
  const resolved = resolvePayee(expense, payees, aliases);
  const mineKey = payee ? keyOf(payee) : '';
  const similarity = Math.max(
    nameSimilarity(expense.supplier_name, payee?.name),
    ...payeeNames.map((name) => nameSimilarity(expense.supplier_name, name)),
    0
  );
  return {
    id: expense.id,
    number: expense.number,
    date: expense.date,
    supplier_name: expense.supplier_name,
    description: expense.description,
    total: round2(Number(expense.total) || 0),
    available,
    vat_amount: round2(Number(expense.vat_amount) || 0),
    doc_type: expense.doc_type,
    exact: Math.abs(available - remaining) <= TOLERANCE,
    mine: !!resolved && keyOf(resolved.payee) === mineKey,
    /** Who this document is currently taken to belong to, so a wrong pick can be seen coming. */
    resolved_payee_key: resolved ? keyOf(resolved.payee) : null,
    resolved_supplier_name: resolved?.payee.name ?? null,
    resolved_by: resolved?.strength ?? null,
    /** Whether attaching it would teach the mapping something it does not already know. */
    alias_known: !!normalizeName(expense.supplier_name)
      && aliases.get(normalizeName(expense.supplier_name)) === mineKey,
    similarity: Math.round(similarity * 100) / 100,
  };
}

/**
 * The documents that could plausibly answer for a payment, best first.
 *
 * Computed on demand rather than stored. A suggestion is a reading of two tables that both
 * keep changing — the next Morning pull adds documents, and linking one elsewhere spends a
 * candidate — so a stored suggestion is a stale one, and there is nothing here worth the cost
 * of keeping it fresh.
 *
 * Three kinds of row are offered, and the reason is carried with each. A document that
 * resolves to this supplier is the obvious one. But the case that made this list useless in
 * practice is the supplier nothing resolves to at all — no tax id in Morning, an invoice
 * headed with a company nobody has typed in — and for those the money speaks: an unplaced
 * document for exactly what is still open, dated near the transfer, is worth putting in front
 * of a person even though the app cannot say whose it is. A name that merely looks alike comes
 * last. Nothing here links by itself; every row is a question.
 *
 * Documents that already belong to *another* supplier are never offered, at any strength: that
 * supplier is where they answer, and offering them here is offering a wrong answer.
 */
export function suggestionsFor(
  payment: any,
  payees?: Payee[],
  pool?: any[],
  aliases?: Map<string, string>,
  aliasNames?: Map<string, string[]>
): any[] {
  const all = payees || listPayees();
  const names = aliases || aliasMap();
  const ref = payeeRef(payment);
  const payee = ref ? all.find((p) => p.kind === ref.kind && p.id === ref.id) : undefined;
  const ownNames = (payee && (aliasNames || aliasNamesByPayee()).get(keyOf(payee))) || [];
  const candidates = pool || availableExpenses();
  const remaining = remainingOf(payment);
  const from = shiftDate(payment.date, -WINDOW_BEFORE_DAYS);
  const to = shiftDate(payment.date, WINDOW_AFTER_DAYS);

  const rows: Array<{ card: any; reason: SuggestionReason; rank: number }> = [];
  for (const expense of candidates) {
    const date = String(expense.date || '');
    if (date < from || date > to) continue;
    const card = documentCard(expense, remaining, payee, names, all, ownNames);
    if (card.resolved_payee_key && !card.mine) continue;

    const reason: SuggestionReason | null = card.mine ? 'supplier'
      : card.exact ? 'amount'
        : card.similarity >= SIMILAR_ENOUGH ? 'similar'
          : null;
    if (!reason) continue;

    // Ordering, best first: the supplier's own document for exactly the open amount, then the
    // rest of their documents, then an unplaced one whose figure matches to the agora, then a
    // name that resembles theirs.
    const rank = card.mine ? (card.exact ? 0 : 1) : reason === 'amount' ? 2 : 3;
    rows.push({ card: { ...card, reason }, reason, rank });
  }

  return rows
    .sort((a, b) => a.rank - b.rank
      || Math.abs(a.card.available - remaining) - Math.abs(b.card.available - remaining))
    .slice(0, 8)
    .map((row) => row.card);
}

/**
 * Every document a person may attach to a payment by hand, filtered by what they typed.
 *
 * This is the answer to the case no automatic rule can reach: the supplier invoices under a
 * company nobody has recorded, the document is dated four months off because it was issued
 * against the wrong month, the amount differs because two gigs were billed on one invoice.
 * The app cannot guess any of those, and the person looking at the transfer knows all three —
 * so the list is everything with value left to give, searchable, rather than only what a rule
 * could vouch for.
 *
 * A query of digits searches the amount as well as the text, because «1755» is how somebody
 * looks for the invoice they are holding.
 */
export function searchDocuments(paymentId: string, query: string, limit = 40): any[] {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(paymentId) as any;
  if (!payment) throw Object.assign(new Error('payment not found'), { status: 404 });
  const payees = listPayees();
  const ref = payeeRef(payment);
  const payee = ref ? payees.find((p) => p.kind === ref.kind && p.id === ref.id) : undefined;
  const aliases = aliasMap();
  const ownNames = (payee && aliasNamesByPayee().get(keyOf(payee))) || [];
  const remaining = remainingOf(payment);

  const q = String(query || '').trim().toLowerCase();
  const asNumber = q && /^[\d.,]+$/.test(q) ? Number(q.replace(/,/g, '')) : NaN;

  const cards = availableExpenses(paymentId)
    .map((expense) => documentCard(expense, remaining, payee, aliases, payees, ownNames))
    .filter((card) => {
      if (!q) return true;
      if (!Number.isNaN(asNumber) && Math.abs(card.total - asNumber) <= 1) return true;
      return [card.supplier_name, card.number, card.description, card.resolved_supplier_name]
        .some((field) => String(field || '').toLowerCase().includes(q));
    });

  // Unsearched, the useful order is «what this payment is most likely to be»: its own
  // supplier's documents first, then whatever matches the open amount, then by how far the
  // document is dated from the transfer. A typed query keeps the same order — the person is
  // narrowing the same list, not asking for a different one.
  const distance = (date: string) => Math.abs(daysBetween(payment.date, date || payment.date));
  return cards
    .sort((a, b) =>
      Number(b.mine) - Number(a.mine)
      || Number(b.exact) - Number(a.exact)
      || b.similarity - a.similarity
      || distance(a.date) - distance(b.date))
    .slice(0, limit);
}

/**
 * Links every document that can be tied to a payment beyond doubt, and leaves the rest alone.
 *
 * Beyond doubt means two things at once: the supplier was resolved by something certain — an
 * identity, or an invoice name a person has tied to them — rather than by two strings looking
 * alike, and what the document has left to give is what the payment still has open. Gross is
 * the side that matches — a show's cost lines are entered including מע"מ (`vat_summary`
 * restates what is inside them rather than adding to it), so `expenses.total` is the
 * comparable figure and `expenses.amount` would be short by the VAT on every מורשה supplier.
 *
 * Everything softer than that is returned as a suggestion for a person to confirm. A wrong
 * link is worse than an unmatched row: it closes a queue item that should still be open and
 * puts a document against money it has nothing to do with.
 */
export function runMatch(): { linked: number } {
  const payees = listPayees();
  if (!payees.length) return { linked: 0 };
  const aliases = aliasMap();

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

    // Re-read inside the loop: what an earlier payment in this pass took of a document is
    // gone, so the same shekels can never be claimed twice.
    const match = availableExpenses().find((expense) => {
      const date = String(expense.date || '');
      if (date < from || date > to) return false;
      const resolved = resolvePayee(expense, payees, aliases);
      if (!isCertain(resolved?.strength ?? null)) return false;
      const ref = payeeRef(payment);
      if (!ref || keyOf(resolved!.payee) !== payeeKey(ref.kind, ref.id)) return false;
      return Math.abs(round2(Number(expense.available) || 0) - remaining) <= TOLERANCE;
    });
    if (!match) continue;
    linkDocument(payment.id, match.id, 'auto');
    linked++;
  }
  return { linked };
}

// ============================== reading it back ==============================

export function getPayment(id: string, payees?: Map<string, Payee>): any {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id) as any;
  if (!payment) return null;
  const documented = documentedTotal(id);
  const ref = payeeRef(payment);
  const payee = ref
    ? (payees || payeesByKey()).get(payeeKey(ref.kind, ref.id))
    : undefined;
  return {
    ...payment,
    expects_invoice: !!payment.expects_invoice,
    payee_kind: ref?.kind ?? null,
    payee_id: ref?.id ?? null,
    payee_key: ref ? payeeKey(ref.kind, ref.id) : null,
    // `supplier_name` is the name every screen already reads; it is the payee's name whichever kind
    // they are, so a member's payment reads as naturally in the queue as a supplier's.
    supplier_name: payee?.name ?? '?',
    payee_name: payee?.name ?? '?',
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
  const payees = listPayees();
  const byKey = payeesByKey(payees);
  const aliases = aliasMap();
  const aliasNames = aliasNamesByPayee();
  const pool = availableExpenses();
  const rows = db.prepare('SELECT * FROM supplier_payments ORDER BY date DESC').all() as any[];
  const now = today();

  return rows.map((payment) => {
    const full = getPayment(payment.id, byKey);
    const waiting = full.doc_status === 'waiting';
    return {
      ...full,
      age_days: Math.max(0, daysBetween(payment.date, now)),
      suggestions: waiting ? suggestionsFor(payment, payees, pool, aliases, aliasNames) : [],
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

/** Per payee, keyed as in payees.ts: what they have been paid that no document answers for. */
export function supplierInvoiceGaps(): Map<string, { missing: number; payments: number; oldest_days: number }> {
  const gaps = new Map<string, { missing: number; payments: number; oldest_days: number }>();
  for (const row of listPayments()) {
    if (row.doc_status !== 'waiting' || !row.payee_key) continue;
    const entry = gaps.get(row.payee_key) || { missing: 0, payments: 0, oldest_days: 0 };
    entry.missing = round2(entry.missing + row.missing);
    entry.payments += 1;
    entry.oldest_days = Math.max(entry.oldest_days, row.age_days);
    gaps.set(row.payee_key, entry);
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
        `INSERT INTO supplier_payment_lines (id, payment_id, event_id, role, member_key, amount)
         VALUES (?, ?, ?, ?, NULL, ?)`
      ).run(uuid(), id, row.event_id, row.role, amount);
      n++;
    }
    setSetting('moonlight_supplier_payments_v1', 'done');
    return n;
  })();

  return created;
}

/**
 * The same for the members' shares of every show already marked «שולם לנגנים».
 *
 * A member's share was money that left the band with no record of whose invoice was owed for
 * it, so the ledger starts with one payment per member per settled show — which is what makes
 * the queue's total the band's real undocumented spend rather than the part of it that went to
 * outsiders.
 *
 * Shows through the same cut-off enter closed for the same reason the suppliers' do: that
 * paperwork was dealt with before any of this existed, and rows arriving red would be asking
 * for invoices that came and went a year ago. A member registered as לא רשום is recorded as
 * expecting nothing, whenever the show was.
 */
export function backfillMemberPayments(): number {
  if (getSetting('moonlight_member_payments_v1', '') === 'done') return 0;

  const created = db.transaction((): number => {
    const rows = db
      .prepare(
        `SELECT s.event_id, s.member_key, s.amount, e.date, m.business_type
           FROM band_event_shares s
           JOIN band_events e ON e.id = s.event_id
           LEFT JOIN band_members m ON m.member_key = s.member_key
          WHERE e.paid_to_musicians = 1
          ORDER BY e.date`
      )
      .all() as any[];

    let n = 0;
    for (const row of rows) {
      const amount = round2(Number(row.amount) || 0);
      if (!amount) continue;
      if (db.prepare('SELECT 1 FROM supplier_payment_lines WHERE event_id = ? AND member_key = ?')
        .get(row.event_id, row.member_key)) continue;

      const id = uuid();
      const settled = row.date <= VERIFIED_THROUGH;
      db.prepare(
        `INSERT INTO supplier_payments
           (id, supplier_id, member_key, date, amount, expects_invoice, resolution, source, notes)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 'backfill', ?)`
      ).run(
        id, row.member_key, row.date, amount,
        row.business_type && row.business_type !== 'none' ? 1 : 0,
        settled ? 'verified' : null,
        settled ? 'הועבר מהסימון «שולם לנגנים» — חשבונית טופלה לפני המעקב' : null
      );
      db.prepare(
        `INSERT INTO supplier_payment_lines (id, payment_id, event_id, role, member_key, amount)
         VALUES (?, ?, ?, NULL, ?, ?)`
      ).run(uuid(), id, row.event_id, row.member_key, amount);
      n++;
    }
    setSetting('moonlight_member_payments_v1', 'done');
    return n;
  })();

  return created;
}
