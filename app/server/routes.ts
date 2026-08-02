import { Router } from 'express';
import { randomBytes } from 'crypto';
import {
  db, uuid, sha256, hashPassword, getVatPercent, setSetting, getSetting, getMorningSyncDays,
} from './db.js';
import {
  createSession, currentSessionToken, destroySession, login, requireAuth, requireOwner,
  requireApiKey, loginRateLimit, clearLoginAttempts,
} from './auth.js';
import { createInvoice, setInvoiceStatus, getInvoice } from './invoiceService.js';
import { DOC_TYPE_LABELS, REVENUE_DOC_TYPES_SQL, isRevenueDoc } from './docTypes.js';
import { BUSINESS_TYPE_LABELS, getBusinessDetails, setBusinessDetails } from './business.js';
import { buildMorningDraft, morningStatus, pullFromMorning, pushInvoiceToMorning } from './morningSync.js';
import { calendarStatus, isSyncPriced, previewRule, pullShowsFromCalendar } from './calendarSync.js';
import {
  createRule, deleteRule, deleteOverride, getRule, listOverrides, listRules, setOverride,
  updateRule, type CalendarRule,
} from './calendarRules.js';
import { listCalendars } from './calendarClient.js';
import {
  deleteEventCascade, ensureExpenseRow, eventLabel, expenseRowForEvent, expenseTotal, getEvent,
  recomputeEvent, syncExpenseLabel,
} from './moonlight.js';

/**
 * Drops the rows a calendar event produced, so excluding it takes effect at once.
 * Rows carrying money are left alone — an exclusion is a filtering decision, not a
 * licence to delete bookkeeping.
 */
function removeRowsForEvent(eventId: string): number {
  let removed = 0;
  const event = db.prepare('SELECT * FROM band_events WHERE calendar_event_id = ?').get(eventId) as any;
  if (event) {
    const moneyFields = ['tickets', 'amount_pre_vat', 'amount_with_vat', 'expenses', 'expenses_paid',
      'profit', 'commission_amount', 'amir', 'itamar', 'yuval', 'guy'];
    // Its expense row is created empty with the show, so an untouched one does not count as
    // bookkeeping — but anything typed into it does.
    if (moneyFields.every((f) => !Number(event[f])) && !expenseTotal(expenseRowForEvent(event.id))) {
      db.prepare('DELETE FROM band_event_expenses WHERE event_id = ?').run(event.id);
      db.prepare('DELETE FROM band_events WHERE id = ?').run(event.id);
      removed++;
    }
  }
  const work = db.prepare('SELECT * FROM works WHERE calendar_event_id = ?').get(eventId) as any;
  if (work && work.status === 'unpaid' && isSyncPriced(work)) {
    db.prepare('DELETE FROM works WHERE id = ?').run(work.id);
    removed++;
  }
  return removed;
}

/** Stand-in used when previewing a rule that has not been saved yet. */
const DRAFT_RULE: CalendarRule = {
  id: 'draft', name: 'טיוטה', target: 'band', calendar_id: 'primary',
  keywords: '', organizers: '', ignore_words: '', client_name: null, fixed_amount: 0,
  skip_declined: 1, match_description: 0, enabled: 1, sort_order: 0,
};

export const router = Router();

function handle(fn: (req: any, res: any) => void) {
  return (req: any, res: any) => {
    try {
      fn(req, res);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || 'internal error' });
    }
  };
}

/**
 * The date window a list is asking for. Every end is optional: the tables ask for one year,
 * the moonlight summary can ask for any span, and callers that ask for nothing — the
 * dashboard — keep getting everything.
 */
function dateRange(query: any): { from?: string; to?: string } {
  const year = parseInt(query?.year, 10);
  if (Number.isFinite(year) && year > 1970) return { from: `${year}-01-01`, to: `${year}-12-31` };
  return {
    from: typeof query?.from === 'string' && query.from ? query.from : undefined,
    to: typeof query?.to === 'string' && query.to ? query.to : undefined,
  };
}

/** The same window as a WHERE clause, for queries that have no other filters. */
function rangeClause(column: string, range: { from?: string; to?: string }): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (range.from) { parts.push(`${column} >= ?`); params.push(range.from); }
  if (range.to) { parts.push(`${column} <= ?`); params.push(range.to); }
  return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
}

/** Same as `handle`, for routes that await network calls — a rejected promise still answers. */
function handleAsync(fn: (req: any, res: any) => Promise<void>) {
  return (req: any, res: any) => {
    fn(req, res).catch((err: any) => {
      res.status(err.status || 500).json({ error: err.message || 'internal error' });
    });
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Unauthenticated liveness probe for the container healthcheck and the keepalive
// cron. Says nothing about the data behind it.
router.get('/health', (_req, res) => res.json({ ok: true }));

// ============ auth ============
router.post('/auth/login', loginRateLimit, handle((req, res) => {
  const { email, password } = req.body || {};
  const user = email && password ? login(email, password) : null;
  if (!user) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  clearLoginAttempts(req);
  createSession(res, user.id);
  res.json({ user });
}));

router.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

// ============ dashboard (owner) ============
router.get('/dashboard', requireOwner, handle((_req, res) => {
  // Revenue figures count tax documents only. A sale usually also has a חשבון עסקה (300)
  // recording the same money, so summing every document would count it twice.
  const openInvoices = db.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM invoices
     WHERE status = 'issued' AND doc_type IN (${REVENUE_DOC_TYPES_SQL})`
  ).get() as any;
  const paidYtd = db.prepare(
    `SELECT COALESCE(SUM(total),0) AS total FROM invoices
     WHERE status = 'paid' AND doc_type IN (${REVENUE_DOC_TYPES_SQL})
       AND date >= date('now','start of year')`
  ).get() as any;
  const unpaidWorks = db.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM works WHERE status = 'unpaid'"
  ).get() as any;
  const monthly = db.prepare(
    `SELECT substr(date, 1, 7) AS month,
            SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS paid,
            SUM(CASE WHEN status = 'issued' THEN total ELSE 0 END) AS open
     FROM invoices WHERE status IN ('paid','issued') AND doc_type IN (${REVENUE_DOC_TYPES_SQL})
     GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all().reverse();
  const recentInvoices = db.prepare(
    `SELECT i.id, i.number, i.date, i.total, i.status, i.doc_type, c.name AS client_name
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ORDER BY i.date DESC, i.created_at DESC LIMIT 8`
  ).all();
  const band = bandSummary();
  res.json({ openInvoices, paidYtd, unpaidWorks, monthly, recentInvoices, band });
}));

// ============ clients (owner) ============
router.get('/clients', requireOwner, handle((_req, res) => {
  const clients = db.prepare(
    `SELECT c.*,
       (SELECT COALESCE(SUM(total),0) FROM works w WHERE w.client_id = c.id AND w.status = 'unpaid') AS unpaid_total,
       (SELECT COUNT(*) FROM works w WHERE w.client_id = c.id AND w.status = 'unpaid') AS unpaid_count,
       (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.client_id = c.id AND i.status = 'issued'
          AND i.doc_type IN (${REVENUE_DOC_TYPES_SQL})) AS open_invoices_total
     FROM clients c ORDER BY c.name`
  ).all();
  res.json({ clients });
}));

router.post('/clients', requireOwner, handle((req, res) => {
  const { name, email, phone, tax_id, payment_terms_days, notes } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'שם לקוח חובה' });
  const id = uuid();
  db.prepare(
    'INSERT INTO clients (id, name, email, phone, tax_id, payment_terms_days, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name.trim(), email || null, phone || null, tax_id || null, payment_terms_days || 30, notes || null);
  res.json({ client: db.prepare('SELECT * FROM clients WHERE id = ?').get(id) });
}));

router.put('/clients/:id', requireOwner, handle((req, res) => {
  const { name, email, phone, tax_id, payment_terms_days, notes } = req.body || {};
  const result = db.prepare(
    'UPDATE clients SET name = ?, email = ?, phone = ?, tax_id = ?, payment_terms_days = ?, notes = ? WHERE id = ?'
  ).run(name, email || null, phone || null, tax_id || null, payment_terms_days || 30, notes || null, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'client not found' });
  res.json({ client: db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) });
}));

/**
 * Deletes a client, with the guards that keep the books intact.
 *
 * A client with invoices is never deleted — that is billing history, and the invoices
 * would be left pointing at nothing. Uninvoiced works are deletable along with the client,
 * but only when the caller asks for it (`?delete_works=1`), so the row count is never a
 * surprise. An enabled calendar rule pointing at the client blocks the delete outright:
 * the next sync would recreate both the client and its works.
 */
router.delete('/clients/:id', requireOwner, handle((req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
  if (!client) return res.status(404).json({ error: 'client not found' });

  const invoices = (db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?').get(client.id) as any).n;
  if (invoices)
    return res.status(409).json({ error: `ללקוח יש ${invoices} חשבוניות — לקוח עם היסטוריית חיוב לא נמחק` });

  const rules = db.prepare(
    "SELECT name FROM calendar_rules WHERE enabled = 1 AND target = 'personal' AND client_name = ?"
  ).all(client.name) as Array<{ name: string }>;
  if (rules.length)
    return res.status(409).json({
      error: `כלל יומן פעיל («${rules.map((r) => r.name).join('», «')}») מושך עבודות ללקוח הזה — כבה או שנה אותו קודם`,
    });

  const works = (db.prepare('SELECT COUNT(*) AS n FROM works WHERE client_id = ?').get(client.id) as any).n;
  if (works && !req.query.delete_works)
    return res.status(409).json({ error: `ללקוח יש ${works} עבודות שטרם חויבו`, works });

  db.transaction(() => {
    db.prepare('DELETE FROM works WHERE client_id = ?').run(client.id);
    db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
  })();

  res.json({ ok: true, deleted_works: works });
}));

// ============ works (owner) ============
router.get('/works', requireOwner, handle((req, res) => {
  const { status, client_id } = req.query;
  let sql = `SELECT w.*, c.name AS client_name, i.number AS invoice_number
             FROM works w JOIN clients c ON c.id = w.client_id
             LEFT JOIN invoices i ON i.id = w.invoice_id WHERE 1=1`;
  const params: any[] = [];
  if (status) { sql += ' AND w.status = ?'; params.push(status); }
  if (client_id) { sql += ' AND w.client_id = ?'; params.push(client_id); }
  const range = dateRange(req.query);
  if (range.from) { sql += ' AND w.date >= ?'; params.push(range.from); }
  if (range.to) { sql += ' AND w.date <= ?'; params.push(range.to); }
  sql += ' ORDER BY w.date DESC';
  res.json({ works: db.prepare(sql).all(...params) });
}));

router.post('/works', requireOwner, handle((req, res) => {
  const { client_id, date, description, amount } = req.body || {};
  if (!client_id || !date || !description || amount == null)
    return res.status(400).json({ error: 'client_id, date, description, amount are required' });
  const amt = round2(Number(amount));
  const vat = round2((amt * getVatPercent()) / 100);
  const id = uuid();
  db.prepare(
    `INSERT INTO works (id, client_id, date, description, amount, vat_amount, total, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', 'app')`
  ).run(id, client_id, date, description, amt, vat, round2(amt + vat));
  res.json({ work: db.prepare('SELECT * FROM works WHERE id = ?').get(id) });
}));

router.put('/works/:id', requireOwner, handle((req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) as any;
  if (!work) return res.status(404).json({ error: 'work not found' });
  if (work.status !== 'unpaid') return res.status(409).json({ error: 'עבודה שכבר חויבה נעולה לעריכה' });
  const { date, description, amount } = req.body || {};
  const amt = round2(Number(amount ?? work.amount));
  const vat = round2((amt * getVatPercent()) / 100);
  db.prepare('UPDATE works SET date = ?, description = ?, amount = ?, vat_amount = ?, total = ? WHERE id = ?')
    .run(date ?? work.date, description ?? work.description, amt, vat, round2(amt + vat), req.params.id);
  res.json({ work: db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id) });
}));

router.delete('/works/:id', requireOwner, handle((req, res) => {
  const work = db.prepare('SELECT status FROM works WHERE id = ?').get(req.params.id) as any;
  if (!work) return res.status(404).json({ error: 'work not found' });
  if (work.status !== 'unpaid') return res.status(409).json({ error: 'אי אפשר למחוק עבודה שמקושרת לחשבונית' });
  db.prepare('DELETE FROM works WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

/** The ids of a bulk request, rejected as one bad request rather than silently trimmed. */
function bulkIds(body: any): string[] {
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === 'string' && id) : [];
  if (!ids.length) throw Object.assign(new Error('לא נבחרו עבודות'), { status: 400 });
  return ids;
}

/**
 * Deletes the selected works in one go. Only unpaid works can go — anything already on an
 * invoice is reported back as locked rather than quietly skipped.
 *
 * `exclude_from_calendar` also pins the underlying events out, because deleting a work the
 * calendar created would otherwise last until the next sync drew it again.
 */
router.post('/works/bulk-delete', requireOwner, handle((req, res) => {
  const ids = bulkIds(req.body);
  const excludeFromCalendar = !!req.body?.exclude_from_calendar;
  const locked: string[] = [];
  let deleted = 0;
  let excluded = 0;

  db.transaction(() => {
    for (const id of ids) {
      const work = db.prepare('SELECT * FROM works WHERE id = ?').get(id) as any;
      if (!work) continue;
      if (work.status !== 'unpaid') { locked.push(work.description); continue; }
      if (excludeFromCalendar && work.calendar_event_id) {
        setOverride({
          event_id: work.calendar_event_id, action: 'exclude',
          summary: work.description, event_date: work.date,
        });
        excluded++;
      }
      db.prepare('DELETE FROM works WHERE id = ?').run(id);
      deleted++;
    }
  })();

  res.json({ deleted, excluded, locked });
}));

/** Moves the selected works to another client — the fix for a rule that filed them wrong. */
router.post('/works/bulk-client', requireOwner, handle((req, res) => {
  const ids = bulkIds(req.body);
  const clientId = req.body?.client_id;
  if (!clientId) return res.status(400).json({ error: 'client_id is required' });
  if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId))
    return res.status(404).json({ error: 'client not found' });

  const locked: string[] = [];
  let updated = 0;
  db.transaction(() => {
    for (const id of ids) {
      const work = db.prepare('SELECT * FROM works WHERE id = ?').get(id) as any;
      if (!work) continue;
      // A work on an invoice belongs to that invoice's client; moving it would leave the
      // invoice billing one client for another's work.
      if (work.status !== 'unpaid') { locked.push(work.description); continue; }
      if (work.client_id === clientId) continue;
      db.prepare('UPDATE works SET client_id = ? WHERE id = ?').run(clientId, id);
      updated++;
    }
  })();

  res.json({ updated, locked });
}));

// ============ invoices (owner) ============
router.get('/invoices', requireOwner, handle((req, res) => {
  const { status } = req.query;
  let sql = `SELECT i.*, c.name AS client_name,
               (SELECT COUNT(*) FROM works w WHERE w.invoice_id = i.id) AS works_count
             FROM invoices i JOIN clients c ON c.id = i.client_id`;
  const params: any[] = [];
  const filters: string[] = [];
  if (status) { filters.push('i.status = ?'); params.push(status); }
  const range = dateRange(req.query);
  if (range.from) { filters.push('i.date >= ?'); params.push(range.from); }
  if (range.to) { filters.push('i.date <= ?'); params.push(range.to); }
  if (filters.length) sql += ` WHERE ${filters.join(' AND ')}`;
  sql += ' ORDER BY i.date DESC, i.created_at DESC';
  const invoices = (db.prepare(sql).all(...params) as any[]).map((inv) => ({
    ...inv,
    doc_type_label: DOC_TYPE_LABELS[inv.doc_type] ?? null,
    is_revenue: isRevenueDoc(inv.doc_type),
  }));
  res.json({ invoices });
}));

router.get('/invoices/:id', requireOwner, handle((req, res) => {
  const invoice = getInvoice(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'invoice not found' });
  res.json({ invoice });
}));

router.post('/invoices', requireOwner, handle((req, res) => {
  const { client_id, work_ids, line_items, date, due_date, notes } = req.body || {};
  const invoice = createInvoice({
    clientId: client_id, workIds: work_ids, lineItems: line_items, date, dueDate: due_date, notes, source: 'app',
  });
  res.json({ invoice });
}));

router.post('/invoices/:id/status', requireOwner, handle((req, res) => {
  const { status, paid_date } = req.body || {};
  if (!['issued', 'paid', 'cancelled'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  res.json({ invoice: setInvoiceStatus(req.params.id, status, paid_date) });
}));

// ============ moonlight (owner + band members) ============
function bandSummary(range: { from?: string; to?: string } = {}) {
  const eventsWhere = rangeClause('date', range);
  const events = db.prepare(`SELECT * FROM band_events${eventsWhere.sql}`).all(...eventsWhere.params) as any[];
  const general = db
    .prepare(`SELECT * FROM band_general_expenses${eventsWhere.sql}`)
    .all(...eventsWhere.params) as any[];
  const sum = (arr: any[], key: string) => round2(arr.reduce((acc, r) => acc + (Number(r[key]) || 0), 0));
  return {
    totalRevenue: sum(events, 'amount_pre_vat'),
    totalExpenses: sum(events, 'expenses'),
    totalProfit: sum(events, 'profit'),
    amir: sum(events, 'amir'),
    itamar: sum(events, 'itamar'),
    yuval: sum(events, 'yuval'),
    guy: sum(events, 'guy'),
    fundExpenses: sum(general, 'fund'),
    generalExpenses: sum(general, 'amount'),
    eventCount: events.length,
    upcomingEvents: events.filter((e) => e.date >= new Date().toISOString().slice(0, 10)).length,
  };
}

router.get('/moonlight/summary', requireAuth, handle((req, res) => {
  res.json({ summary: bandSummary(dateRange(req.query)) });
}));

router.get('/moonlight/events', requireAuth, handle((req, res) => {
  const where = rangeClause('date', dateRange(req.query));
  res.json({ events: db.prepare(`SELECT * FROM band_events${where.sql} ORDER BY date`).all(...where.params) });
}));

/**
 * Expense rows follow their show's date. Rows that never found a show stay in the list
 * whatever the filter says — they are the ones most in need of attention.
 */
router.get('/moonlight/event-expenses', requireAuth, handle((req, res) => {
  const range = dateRange(req.query);
  const filters: string[] = [];
  const params: string[] = [];
  if (range.from) { filters.push('e.date >= ?'); params.push(range.from); }
  if (range.to) { filters.push('e.date <= ?'); params.push(range.to); }
  const where = filters.length ? ` WHERE x.event_id IS NULL OR (${filters.join(' AND ')})` : '';
  res.json({
    expenses: db.prepare(
      `SELECT x.*, e.date AS event_date, e.venue AS event_venue
       FROM band_event_expenses x LEFT JOIN band_events e ON e.id = x.event_id${where}
       ORDER BY e.date IS NULL DESC, e.date, x.created_at`
    ).all(...params),
  });
}));

router.get('/moonlight/general-expenses', requireAuth, handle((req, res) => {
  const where = rangeClause('date', dateRange(req.query));
  res.json({
    expenses: db.prepare(`SELECT * FROM band_general_expenses${where.sql} ORDER BY date DESC`).all(...where.params),
  });
}));

// Writes to moonlight data are owner-only; band members are view-only.
// `expenses`, `expenses_paid` and `profit` are never taken from the client: they are derived
// from the show's expense row by recomputeEvent.
router.post('/moonlight/events', requireOwner, handle((req, res) => {
  const b = req.body || {};
  if (!b.venue || !b.date) return res.status(400).json({ error: 'venue and date are required' });
  const id = uuid();
  db.prepare(
    `INSERT INTO band_events (id, venue, date, tickets, amount_pre_vat, amount_with_vat,
      receiver, invoice, has_commission, paid_to_musicians)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, b.venue, b.date, b.tickets || 0, b.amount_pre_vat || 0, b.amount_with_vat || 0,
    b.receiver || null, b.invoice || null, b.has_commission ? 1 : 0, b.paid_to_musicians ? 1 : 0
  );
  ensureExpenseRow(getEvent(id));
  res.json({ event: recomputeEvent(id) });
}));

/** The member shares are the only fields whose presence changes the row's mode. */
const DIVISION_FIELDS = ['amir', 'itamar', 'yuval', 'guy'] as const;

router.put('/moonlight/events/:id', requireOwner, handle((req, res) => {
  const existing = getEvent(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'event not found' });
  const body = req.body || {};
  const b = { ...existing, ...body };

  // Typing a share by hand takes the division over; asking for 'auto' hands it back.
  const touchedDivision = DIVISION_FIELDS.some((f) => body[f] !== undefined);
  const divisionMode = body.division_mode === 'auto' ? 'auto'
    : touchedDivision ? 'manual'
    : existing.division_mode || 'auto';

  db.prepare(
    `UPDATE band_events SET venue=?, date=?, tickets=?, amount_pre_vat=?, amount_with_vat=?,
      receiver=?, invoice=?, has_commission=?, paid_to_musicians=?, division_mode=?,
      amir=?, itamar=?, yuval=?, guy=?
     WHERE id=?`
  ).run(
    b.venue, b.date, b.tickets, b.amount_pre_vat, b.amount_with_vat,
    b.receiver, b.invoice, b.has_commission ? 1 : 0, b.paid_to_musicians ? 1 : 0, divisionMode,
    b.amir, b.itamar, b.yuval, b.guy, req.params.id
  );
  const updated = getEvent(req.params.id);
  ensureExpenseRow(updated);
  syncExpenseLabel(updated);
  res.json({ event: recomputeEvent(req.params.id) });
}));

router.delete('/moonlight/events/:id', requireOwner, handle((req, res) => {
  // Excluding is the default: deleting a synced show without it just invites the next sync
  // to put it straight back.
  const flag = req.query.exclude_from_calendar;
  const result = deleteEventCascade(req.params.id, flag !== '0' && flag !== 'false');
  if (!result.deleted) return res.status(404).json({ error: 'event not found' });
  res.json(result);
}));

router.post('/moonlight/events/bulk-delete', requireOwner, handle((req, res) => {
  const ids = bulkIds(req.body);
  const exclude = !!req.body?.exclude_from_calendar;
  const run = db.transaction(() => {
    let deleted = 0;
    let excluded = 0;
    for (const id of ids) {
      const result = deleteEventCascade(id, exclude);
      deleted += result.deleted;
      excluded += result.excluded;
    }
    return { deleted, excluded };
  });
  res.json(run());
}));

/** The label and its link are owned by the show, so neither is editable here. */
const EVENT_EXPENSE_MONEY = ['tickets', 'campaign', 'refreshments', 'design', 'other', 'expense_amount',
  'akom', 'hall_fee', 'sound_company', 'bracelets', 'lightman', 'soundman', 'singer', 'vat_summary'] as const;
const EVENT_EXPENSE_FLAGS = ['akom_paid', 'hall_fee_paid', 'sound_company_paid', 'bracelets_paid',
  'lightman_paid', 'soundman_paid', 'singer_paid'] as const;

router.put('/moonlight/event-expenses/:id', requireOwner, handle((req, res) => {
  const existing = db.prepare('SELECT * FROM band_event_expenses WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'expense row not found' });
  const body = req.body || {};

  const sets: string[] = [];
  const params: any[] = [];
  for (const field of EVENT_EXPENSE_MONEY) {
    if (body[field] === undefined) continue;
    sets.push(`${field} = ?`);
    params.push(Number(body[field]) || 0);
  }
  for (const field of EVENT_EXPENSE_FLAGS) {
    if (body[field] === undefined) continue;
    sets.push(`${field} = ?`);
    params.push(body[field] ? 1 : 0);
  }
  for (const field of ['status', 'paid_by'] as const) {
    if (body[field] === undefined) continue;
    sets.push(`${field} = ?`);
    params.push(body[field] || null);
  }
  if (sets.length) {
    db.prepare(`UPDATE band_event_expenses SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.params.id);
  }
  if (existing.event_id) recomputeEvent(existing.event_id);
  res.json({
    expense: db.prepare('SELECT * FROM band_event_expenses WHERE id = ?').get(req.params.id),
    event: existing.event_id ? getEvent(existing.event_id) : null,
  });
}));

/** Turns a show id into the label the expense row displays; '' means the general bucket. */
function generalExpenseEvent(eventId: unknown): { event_id: string | null; event: string } {
  if (!eventId) return { event_id: null, event: 'כללי' };
  const event = getEvent(String(eventId)) as any;
  if (!event) throw Object.assign(new Error('event not found'), { status: 400 });
  return { event_id: event.id, event: eventLabel(event.venue, event.date) };
}

router.post('/moonlight/general-expenses', requireOwner, handle((req, res) => {
  const b = req.body || {};
  if (!b.date || !b.description) return res.status(400).json({ error: 'date and description are required' });
  const id = uuid();
  const link = generalExpenseEvent(b.event_id);
  db.prepare(
    `INSERT INTO band_general_expenses (id, date, description, event, event_id, paid_by, amount, paid,
      amir, amir_returned, itamar, itamar_returned, yuval, yuval_returned, fund, fund_returned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, b.date, b.description, link.event, link.event_id, b.paid_by || null, b.amount || 0, b.paid ? 1 : 0,
    b.amir || 0, b.amir_returned || null, b.itamar || 0, b.itamar_returned || null,
    b.yuval || 0, b.yuval_returned || null, b.fund || 0, b.fund_returned || null
  );
  res.json({ expense: db.prepare('SELECT * FROM band_general_expenses WHERE id = ?').get(id) });
}));

router.put('/moonlight/general-expenses/:id', requireOwner, handle((req, res) => {
  const existing = db.prepare('SELECT * FROM band_general_expenses WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'expense not found' });
  const body = req.body || {};
  const b = { ...existing, ...body };
  // The label always follows the linked show, so it is never taken from the client.
  const link = body.event_id !== undefined
    ? generalExpenseEvent(body.event_id)
    : { event_id: existing.event_id, event: existing.event };
  db.prepare(
    `UPDATE band_general_expenses SET date=?, description=?, event=?, event_id=?, paid_by=?, amount=?, paid=?,
      amir=?, amir_returned=?, itamar=?, itamar_returned=?, yuval=?, yuval_returned=?, fund=?, fund_returned=?
     WHERE id=?`
  ).run(
    b.date, b.description, link.event, link.event_id, b.paid_by || null, Number(b.amount) || 0, b.paid ? 1 : 0,
    b.amir || 0, b.amir_returned || null, b.itamar || 0, b.itamar_returned || null,
    b.yuval || 0, b.yuval_returned || null, b.fund || 0, b.fund_returned || null, req.params.id
  );
  res.json({ expense: db.prepare('SELECT * FROM band_general_expenses WHERE id = ?').get(req.params.id) });
}));

router.delete('/moonlight/general-expenses/:id', requireOwner, handle((req, res) => {
  const result = db.prepare('DELETE FROM band_general_expenses WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'expense not found' });
  res.json({ deleted: 1 });
}));

// ============ integrations: Morning (Green Invoice) + Google Calendar (owner) ============
router.get('/integrations', requireOwner, handle((_req, res) => {
  res.json({ morning: morningStatus(), calendar: calendarStatus() });
}));

/** Pulls documents from Morning into the local database. */
router.post('/integrations/morning/sync', requireOwner, handleAsync(async (req, res) => {
  const days = req.body?.days != null ? parseInt(req.body.days, 10) : undefined;
  res.json({ result: await pullFromMorning({ days }) });
}));

/** Pre-fills the issue dialog with the document Morning is about to be asked for. */
router.get('/invoices/:id/morning-draft', requireOwner, handle((req, res) => {
  res.json({ draft: buildMorningDraft(req.params.id) });
}));

/** Issues a local invoice as a real document in Morning and adopts its number. */
router.post('/invoices/:id/push-to-morning', requireOwner, handleAsync(async (req, res) => {
  const b = req.body || {};
  const result = await pushInvoiceToMorning(req.params.id, {
    docType: b.doc_type != null ? parseInt(b.doc_type, 10) : undefined,
    date: b.date || undefined,
    dueDate: b.due_date || undefined,
    description: b.description,
    remarks: b.remarks,
    clientEmail: b.client_email,
    sendEmail: Boolean(b.send_email),
  });
  res.json({ result, invoice: getInvoice(req.params.id) });
}));

/** Runs the calendar rules and writes what they draw to their targets. */
router.post('/integrations/calendar/sync', requireOwner, handleAsync(async (req, res) => {
  const monthsBack = req.body?.months_back != null ? parseInt(req.body.months_back, 10) : undefined;
  const monthsAhead = req.body?.months_ahead != null ? parseInt(req.body.months_ahead, 10) : undefined;
  res.json({ result: await pullShowsFromCalendar({ monthsBack, monthsAhead, ruleId: req.body?.rule_id }) });
}));

/** The calendars this account can read, for the rule's calendar picker. */
router.get('/integrations/calendar/calendars', requireOwner, handleAsync(async (_req, res) => {
  res.json({ calendars: await listCalendars() });
}));

// ---- calendar rules: which events to draw, for band and for personal ----
router.get('/calendar-rules', requireOwner, handle((_req, res) => {
  res.json({ rules: listRules(), overrides: listOverrides() });
}));

router.post('/calendar-rules', requireOwner, handle((req, res) => {
  res.json({ rule: createRule(req.body || {}) });
}));

router.put('/calendar-rules/:id', requireOwner, handle((req, res) => {
  res.json({ rule: updateRule(req.params.id, req.body || {}) });
}));

router.delete('/calendar-rules/:id', requireOwner, handle((req, res) => {
  deleteRule(req.params.id);
  res.json({ ok: true });
}));

// ---- manual per-event decisions, which beat the rules ----
router.get('/calendar-overrides', requireOwner, handle((_req, res) => {
  res.json({ overrides: listOverrides() });
}));

/**
 * Pins one event: `exclude` stops any rule drawing it, `include` forces `rule_id` to draw
 * it. Excluding also removes the row it already produced, so the correction is immediate
 * rather than waiting for the next sync — but never a row that already holds money.
 */
router.post('/calendar-overrides', requireOwner, handle((req, res) => {
  const override = setOverride(req.body || {});
  let removed = 0;
  if (override.action === 'exclude') removed = removeRowsForEvent(override.event_id);
  res.json({ override, removed });
}));

router.delete('/calendar-overrides/:eventId', requireOwner, handle((req, res) => {
  deleteOverride(req.params.eventId);
  res.json({ ok: true });
}));

/**
 * Dry run for a rule — what it would draw and why, writing nothing. Accepts an unsaved
 * rule body so filters can be tried before they are committed.
 */
router.post('/calendar-rules/:id/preview', requireOwner, handleAsync(async (req, res) => {
  const saved = getRule(req.params.id);
  if (!saved && req.params.id !== 'draft') return res.status(404).json({ error: 'rule not found' });
  const rule = { ...(saved ?? DRAFT_RULE), ...(req.body?.rule || {}) };
  res.json({
    result: await previewRule(rule, {
      monthsBack: req.body?.months_back,
      monthsAhead: req.body?.months_ahead,
      includeMisses: req.body?.include_misses !== false,
    }),
  });
}));

// ============ settings & admin (owner) ============
router.get('/settings', requireOwner, handle((_req, res) => {
  res.json({
    settings: {
      vat_percent: getVatPercent(),
      app_name: getSetting('app_name', 'Account Manager'),
      morning_sync_days: getMorningSyncDays(),
    },
    business: getBusinessDetails(),
    business_types: Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    integrations: { morning: morningStatus(), calendar: calendarStatus() },
    calendar_rules: listRules(),
    users: db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY role, name').all(),
    api_keys: db.prepare('SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys ORDER BY created_at').all(),
  });
}));

router.post('/settings', requireOwner, handle((req, res) => {
  const { vat_percent, app_name, morning_sync_days } = req.body || {};
  if (vat_percent != null) setSetting('vat_percent', String(vat_percent));
  if (app_name) setSetting('app_name', app_name);
  if (morning_sync_days != null) setSetting('morning_sync_days', String(parseInt(morning_sync_days, 10) || 90));
  res.json({ ok: true });
}));

/** The letterhead shown in the Morning issue preview. Local only — Morning is not told. */
router.post('/settings/business', requireOwner, handle((req, res) => {
  res.json({ business: setBusinessDetails(req.body || {}) });
}));

router.post('/settings/users', requireOwner, handle((req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!email || !name || !password) return res.status(400).json({ error: 'email, name, password are required' });
  if (!['owner', 'band'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  const id = uuid();
  try {
    db.prepare('INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(id, email, name, hashPassword(password), role);
  } catch {
    return res.status(409).json({ error: 'משתמש עם אימייל זה כבר קיים' });
  }
  res.json({ user: db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(id) });
}));

/**
 * Edits a member: name, email, role, and optionally a new password (an empty one leaves the
 * existing password alone, so details can be fixed without resetting anyone's access).
 *
 * Two guards keep the app reachable: the last owner cannot be demoted, and you cannot demote
 * yourself — either would leave nobody able to open this page.
 */
router.put('/settings/users/:id', requireOwner, handle((req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'user not found' });

  const { name, email, password, role } = req.body || {};
  const nextName = String(name ?? target.name).trim();
  const nextEmail = String(email ?? target.email).trim();
  const nextRole = role ?? target.role;
  if (!nextName || !nextEmail) return res.status(400).json({ error: 'שם ואימייל חובה' });
  if (!['owner', 'band'].includes(nextRole)) return res.status(400).json({ error: 'invalid role' });

  if (target.role === 'owner' && nextRole !== 'owner') {
    if (target.id === req.user!.id) return res.status(400).json({ error: 'אי אפשר להוריד לעצמך הרשאות בעלים' });
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get() as { n: number };
    if (n <= 1) return res.status(400).json({ error: 'חייב להישאר לפחות בעלים אחד' });
  }

  try {
    db.prepare('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?')
      .run(nextName, nextEmail, nextRole, target.id);
  } catch {
    return res.status(409).json({ error: 'משתמש עם אימייל זה כבר קיים' });
  }

  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);
    // A new password ends the sessions opened with the old one — except the one making this
    // request, so changing your own password does not log you out mid-edit.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?')
      .run(target.id, currentSessionToken(req));
  }

  res.json({ user: db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(target.id) });
}));

router.delete('/settings/users/:id', requireOwner, handle((req, res) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: 'אי אפשר למחוק את עצמך' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

router.post('/settings/api-keys', requireOwner, handle((req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const key = `am_${randomBytes(24).toString('hex')}`;
  const id = uuid();
  db.prepare('INSERT INTO api_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)')
    .run(id, name.trim(), sha256(key), key.slice(0, 8));
  // The full key is returned exactly once — only the hash is stored.
  res.json({ id, name: name.trim(), key });
}));

router.delete('/settings/api-keys/:id', requireOwner, handle((req, res) => {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ============ external integration API (Morning app / client management system) ============
export const apiV1 = Router();
apiV1.use(requireApiKey);

apiV1.get('/clients', handle((_req, res) => {
  res.json({ clients: db.prepare('SELECT id, name, email, payment_terms_days FROM clients ORDER BY name').all() });
}));

apiV1.get('/works', handle((req, res) => {
  const { client_id, client_name, status } = req.query;
  let sql = `SELECT w.*, c.name AS client_name FROM works w JOIN clients c ON c.id = w.client_id WHERE 1=1`;
  const params: any[] = [];
  if (client_id) { sql += ' AND w.client_id = ?'; params.push(client_id); }
  if (client_name) { sql += ' AND c.name = ?'; params.push(client_name); }
  if (status) { sql += ' AND w.status = ?'; params.push(status); }
  sql += ' ORDER BY w.date DESC';
  res.json({ works: db.prepare(sql).all(...params) });
}));

apiV1.post('/works', handle((req, res) => {
  const { client_id, client_name, date, description, amount } = req.body || {};
  if ((!client_id && !client_name) || !date || !description || amount == null)
    return res.status(400).json({ error: 'client_id or client_name, date, description, amount are required' });
  const clientRow = client_id
    ? db.prepare('SELECT id FROM clients WHERE id = ?').get(client_id) as any
    : (db.prepare('SELECT id FROM clients WHERE name = ?').get(client_name) as any);
  let cid = clientRow?.id;
  if (!cid) {
    if (!client_name) return res.status(404).json({ error: 'client not found' });
    cid = uuid();
    db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(cid, client_name.trim());
  }
  const amt = round2(Number(amount));
  const vat = round2((amt * getVatPercent()) / 100);
  const id = uuid();
  db.prepare(
    `INSERT INTO works (id, client_id, date, description, amount, vat_amount, total, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`
  ).run(id, cid, date, description, amt, vat, round2(amt + vat), req.apiKeyName || 'api');
  res.json({ work: db.prepare('SELECT * FROM works WHERE id = ?').get(id) });
}));

apiV1.post('/invoices', handle((req, res) => {
  const { client_id, client_name, work_ids, line_items, date, due_date, external_id, notes } = req.body || {};
  const invoice = createInvoice({
    clientId: client_id, clientName: client_name, workIds: work_ids, lineItems: line_items,
    date, dueDate: due_date, externalId: external_id, notes, source: req.apiKeyName || 'api',
  });
  res.json({ invoice });
}));

apiV1.post('/invoices/:id/paid', handle((req, res) => {
  const { paid_date } = req.body || {};
  const byExternal = db.prepare('SELECT id FROM invoices WHERE id = ? OR external_id = ? OR number = ?')
    .get(req.params.id, req.params.id, req.params.id) as any;
  if (!byExternal) return res.status(404).json({ error: 'invoice not found' });
  res.json({ invoice: setInvoiceStatus(byExternal.id, 'paid', paid_date) });
}));
