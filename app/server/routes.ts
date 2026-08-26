import { Router } from 'express';
import { randomBytes } from 'crypto';
import {
  db, uuid, sha256, hashPassword, getVatPercent, setSetting, getSetting, getMorningSyncDays,
  getMetaCurrencyRate, getMetaSyncDays,
} from './db.js';
import {
  createSession, currentSessionToken, destroySession, login, requireAuth, requireOwner,
  requireApiKey, loginRateLimit, clearLoginAttempts,
} from './auth.js';
import { createInvoice, deleteInvoice, setInvoiceStatus, getInvoice } from './invoiceService.js';
import { DOC_TYPE_LABELS, RECEIVABLE_DOC_TYPES_SQL, REVENUE_DOC_TYPES_SQL, isRevenueDoc } from './docTypes.js';
import { BUSINESS_TYPE_LABELS, getBusinessDetails, setBusinessDetails } from './business.js';
import {
  buildMorningDraft, buildPendingMorningDraft, issueWorksToMorning, morningStatus,
  pullFromMorning, pushInvoiceToMorning,
} from './morningSync.js';
import {
  expenseCategories, expenseStatusAudit, expensesStatus, expensesSummary, listExpenses,
  pullExpensesFromMorning,
} from './morningExpenses.js';
import { calendarStatus, isSyncPriced, previewRule, pullShowsFromCalendar } from './calendarSync.js';
import {
  adAnalysis, applyCampaignSpend, campaignDaily, deleteMapping, listCampaigns, metaStatus,
  monthlyBreakdown, pullCampaignsFromMeta, setMapping,
} from './metaSync.js';
import {
  createRule, deleteRule, deleteOverride, getRule, listOverrides, listRules, setOverride,
  updateRule, type CalendarRule,
} from './calendarRules.js';
import { listCalendars } from './calendarClient.js';
import {
  BUSINESS_TYPES, DEFAULT_COMMISSION_PERCENT, FUND_PAYER, FUND_TRANSFERRED,
  activeBandMembers, bandMemberByKey,
  deleteEventCascade, deleteExpenseRow, eventShares, eventSharesTotal, listBandMembers,
  setEventShares, withShares,
  ensureExpenseRow, eventLabel, expenseOutstanding, expenseRowForEvent, expenseTotal, getEvent,
  memberByName, moneyReceived, normalizeCommissionPercent, normalizePaymentStatus,
  reassignExpenseRow, settleFundTransfer,
  PAID_EXPENSE_FIELDS,
  recomputeEvent, syncExpenseLabel, type MemberKey,
} from './moonlight.js';
import {
  ASSIGNMENT_ROLES, assignmentsForEvent, attendeeEmails, autoAssignAll, deleteSupplier,
  isAssignmentRole, listSuppliers, missingRoles, setAssignment, supplierDebts,
} from './assignments.js';
import {
  getCreditPoints, getVatFrequency, incomeTaxReport, monthlyPnl, pnlTotals, saveFiling, vatReport,
} from './reports.js';
import { annualReport, getProfile, saveProfile } from './annualReport.js';
import {
  createAsset, deleteAsset, depreciationSchedule, listAssets, updateAsset,
} from './fixedAssets.js';
import {
  creditBreakdown, clearCreditStatus, EMPTY_STATUS, getCreditStatus, normalizeStatus,
  saveCreditStatus,
} from './creditPoints.js';
import {
  isExpenseBasis, isPeriodKey, overview, recognitionRates, setRecognitionRates,
} from './overview.js';
import { listClients, listInvoices, listWorks, outstandingSql } from './queries.js';
import { agentStatus, ping as agentPing } from './agentClient.js';
import { AgentConfigError, agentConfigView, saveAgentConfig } from './agentConfig.js';
import {
  analyzeCampaigns, chat, chatHistory, clearChat, draftCampaign, lastReport,
} from './campaignAdvisor.js';

/**
 * The follow-up conversation is a single shared thread rather than one per user: the owner is
 * the only person who can ask, and a band member reading along should see the same exchange
 * rather than an empty box.
 */
const CAMPAIGN_CHAT_THREAD = 'moonlight-campaigns';

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
      'profit', 'commission_amount'];
    // Its expense row is created empty with the show, so an untouched one does not count as
    // bookkeeping — but anything typed into it does, and so does a division.
    if (moneyFields.every((f) => !Number(event[f]))
      && !eventSharesTotal(event.id)
      && !expenseTotal(expenseRowForEvent(event.id))) {
      db.prepare('DELETE FROM band_event_expenses WHERE event_id = ?').run(event.id);
      db.prepare('DELETE FROM band_event_shares WHERE event_id = ?').run(event.id);
      db.prepare('DELETE FROM meta_campaign_events WHERE event_id = ?').run(event.id);
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
 * optionally narrowed to one month within it, the moonlight summary can ask for any span, and
 * callers that ask for nothing — the dashboard — keep getting everything.
 *
 * A month is only meaningful inside a year, so one sent without a year is ignored rather than
 * guessed at against the current one: "March" of no particular year is not a period.
 */
function dateRange(query: any): { from?: string; to?: string } {
  const year = parseInt(query?.year, 10);
  if (Number.isFinite(year) && year > 1970) {
    const month = parseInt(query?.month, 10);
    if (Number.isFinite(month) && month >= 1 && month <= 12) {
      const mm = String(month).padStart(2, '0');
      // Day 0 of the next month is the last day of this one, so February is right in a leap year.
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` };
    }
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
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
/** The year a dashboard or report is being read for; anything unparseable is this year. */
function reportYear(query: any): number {
  const year = parseInt(query?.year, 10);
  return Number.isFinite(year) && year > 1970 && year < 3000 ? year : new Date().getFullYear();
}

router.get('/dashboard', requireOwner, handle((req, res) => {
  const year = reportYear(req.query);
  // Revenue figures count tax documents only. A sale usually also has a חשבון עסקה (300)
  // recording the same money, so summing every document would count it twice.
  //
  // The two outstanding-balance cards are deliberately not scoped to the year: an invoice
  // issued last December and still unpaid is money owed now, whichever year is on screen.
  // They count receivable documents rather than revenue ones — a חשבון עסקה that is still open
  // is money owed too, and on a business that bills that way it is most of the balance.
  const openInvoices = db.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(owed),0) AS total FROM (
       SELECT ${outstandingSql()} AS owed FROM invoices
       WHERE doc_type IN (${RECEIVABLE_DOC_TYPES_SQL})
     ) WHERE owed > 0`
  ).get() as any;
  const unpaidWorks = db.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM works WHERE status = 'unpaid'"
  ).get() as any;

  // Income against expenses, month by month — the chart's series and the profit cards are
  // the same numbers the דוחות page reports, so the two can never tell different stories.
  const monthly = monthlyPnl(`${year}-01-01`, `${year}-12-31`);
  const yearTotals = pnlTotals(monthly);
  const currentMonth = new Date().toISOString().slice(0, 7);
  // On a past year "this month" has no meaning; its last month with activity is the useful
  // stand-in, and December is the backstop — `monthly` always holds the year's twelve months,
  // so there is always a row to land on.
  const monthRow = monthly.find((m) => m.month === currentMonth)
    ?? [...monthly].reverse().find((m) => m.income || m.expenses)
    ?? monthly[monthly.length - 1];

  const recentInvoices = db.prepare(
    `SELECT i.id, i.number, i.date, i.total, i.status, i.doc_type, c.name AS client_name
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ORDER BY i.date DESC, i.created_at DESC LIMIT 8`
  ).all();
  // The band's follow-ups (money not yet in, suppliers not yet paid) live on the
  // moonlight summary, not here — this dashboard keeps only the one headline figure.
  const band = bandSummary();
  res.json({
    year,
    openInvoices,
    unpaidWorks,
    monthly,
    yearTotals,
    month: monthRow,
    paidYtd: { total: yearTotals.paid },
    recentInvoices,
    band,
  });
}));

/**
 * The סקירה panel: the period's income against its recognised expenses, the VAT the two leave
 * owing, and where the money that came in came from.
 *
 * It is a separate read from `/dashboard` because it answers for a period rather than a year,
 * and because the expense side is weighted by what the tax return recognises — two questions
 * the year cards below it do not ask.
 */
router.get('/dashboard/overview', requireOwner, handle((req, res) => {
  const period = isPeriodKey(req.query.period) ? req.query.period : 'current_year';
  const basis = isExpenseBasis(req.query.basis) ? req.query.basis : 'recognized';
  res.json(overview(period, basis));
}));

/** The deduction ratios the panel weights by, so an accountant's own numbers can replace them. */
router.get('/settings/expense-recognition', requireOwner, handle((_req, res) => {
  res.json({ rates: recognitionRates() });
}));

router.put('/settings/expense-recognition', requireOwner, handle((req, res) => {
  res.json({ rates: setRecognitionRates(req.body?.rates ?? {}) });
}));

// ============ inbox — מה דורש טיפול ============
/**
 * The loose ends, computed rather than kept: every item here is something the books already
 * say is unfinished, so nothing has to be ticked off by hand and nothing can go stale.
 *
 * Each entry carries its own count and sum, because the point of the screen is to be read
 * without opening anything — the amount is the reason to act on one item before another.
 */
export function inboxItems() {
  const today = new Date().toISOString().slice(0, 10);

  // `total` here is what the document still has outstanding, not what it was written for —
  // this is a list of what to chase, and a part-paid invoice is only worth chasing for the rest.
  const overdue = db.prepare(
    `SELECT i.id, i.number, i.date, i.due_date, ${outstandingSql('i')} AS total, c.name AS client_name,
            CAST(julianday(?) - julianday(i.due_date) AS INTEGER) AS days_late
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.due_date IS NOT NULL AND i.due_date < ?
       AND i.doc_type IN (${RECEIVABLE_DOC_TYPES_SQL})
       AND ${outstandingSql('i')} > 0
     ORDER BY i.due_date`
  ).all(today, today) as any[];

  // Which client has the most unbilled work is what decides whether one invoice can cover
  // several jobs, so it travels with the count.
  const unbilled = db.prepare(
    `SELECT w.id, w.total, c.name AS client_name FROM works w JOIN clients c ON c.id = w.client_id
     WHERE w.status = 'unpaid'`
  ).all() as any[];
  const byClient = new Map<string, { count: number; total: number }>();
  for (const w of unbilled) {
    const entry = byClient.get(w.client_name) ?? { count: 0, total: 0 };
    entry.count++;
    entry.total += Number(w.total) || 0;
    byClient.set(w.client_name, entry);
  }
  const biggestClient = [...byClient.entries()].sort((a, b) => b[1].count - a[1].count)[0];

  // An expense with no category is input VAT that will not make it into a return — the sum
  // that matters on it is the VAT, not what was paid.
  const uncategorized = db.prepare(
    // The full VAT, not the deductible figure: an unclassified expense has no deduction
    // percentage to apply, and what this item is about is the VAT at stake until it gets one.
    `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(vat_amount),0) AS vat
     FROM expenses WHERE category IS NULL OR TRIM(category) = ''`
  ).get() as any;

  // The VAT period standing between "closed" and "filed": the one with a deadline ahead of it,
  // or behind it. An open period is still collecting documents and asks nothing of anybody.
  const report = vatReport(new Date().getFullYear());
  const period = report.periods.find((p) => p.status === 'overdue')
    ?? report.periods.find((p) => p.status === 'due');
  const vat = period ? {
    key: period.key,
    label: period.label,
    due_date: period.due_date,
    days_left: Math.round(
      (Date.parse(`${period.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
    ),
    vat_due: period.vat_due,
    output_vat: period.output_vat,
    input_vat: period.input_vat,
    open_expenses: period.open_expenses,
    status: period.status,
  } : null;

  const band = bandFollowUps();

  const sum = (rows: any[], key: string) => round2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
  // One number for the sidebar badge, counted here so it can never disagree with the list.
  const openCount = [
    overdue.length, unbilled.length, Number(uncategorized.count) || 0,
    band.awaitingPayment.length, band.missingAssignments.length,
  ].filter(Boolean).length;

  return {
    openCount,
    overdueInvoices: {
      count: overdue.length,
      total: sum(overdue, 'total'),
      oldest: overdue[0] ?? null,
    },
    unbilledWorks: {
      count: unbilled.length,
      total: sum(unbilled, 'total'),
      topClient: biggestClient ? { name: biggestClient[0], ...biggestClient[1] } : null,
    },
    uncategorizedExpenses: {
      count: Number(uncategorized.count) || 0,
      total: round2(Number(uncategorized.total) || 0),
      vat: round2(Number(uncategorized.vat) || 0),
    },
    vat,
    band: {
      awaitingPaymentTotal: band.awaitingPaymentTotal,
      awaitingPaymentCount: band.awaitingPayment.length,
      owedToSuppliersTotal: band.owedToSuppliersTotal,
      missingAssignments: band.missingAssignments,
    },
  };
}

router.get('/inbox', requireOwner, handle((_req, res) => res.json({ inbox: inboxItems() })));

// ============ reports — מע"מ and מס הכנסה (owner) ============
router.get('/reports/vat', requireOwner, handle((req, res) => {
  res.json({ report: vatReport(reportYear(req.query)) });
}));

router.get('/reports/income-tax', requireOwner, handle((req, res) => {
  res.json({ report: incomeTaxReport(reportYear(req.query)) });
}));

/**
 * The annual return as it is shaping up — the 1301 ladder, this year against last.
 *
 * `basis=ytd` reads the business side as the books have it so far; the default projects the
 * year from the months that have closed, which is the only reading that means anything before
 * December. The declared side is annual either way.
 */
router.get('/reports/annual', requireOwner, handle((req, res) => {
  const basis = req.query.basis === 'ytd' ? 'ytd' : 'projected';
  res.json({ report: annualReport(reportYear(req.query), basis) });
}));

router.get('/reports/annual/profile/:year', requireOwner, handle((req, res) => {
  res.json({ profile: getProfile(parseInt(req.params.year, 10) || new Date().getFullYear()) });
}));

router.put('/reports/annual/profile/:year', requireOwner, handle((req, res) => {
  const year = parseInt(req.params.year, 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100)
    return res.status(400).json({ error: 'שנת מס לא תקינה' });
  res.json({ profile: saveProfile(year, req.body || {}) });
}));

// ============ רכוש קבוע ופחת (owner) ============

/**
 * The depreciation schedule for a tax year — the 1342 as this app keeps it. Assets bought
 * after the year are left out, since they have nothing to say about it yet.
 */
router.get('/tax/assets', requireOwner, handle((req, res) => {
  const year = reportYear(req.query);
  res.json({ year, schedule: depreciationSchedule(year), assets: listAssets() });
}));

router.post('/tax/assets', requireOwner, handle((req, res) => {
  res.status(201).json({ asset: createAsset(req.body || {}) });
}));

router.put('/tax/assets/:id', requireOwner, handle((req, res) => {
  res.json({ asset: updateAsset(req.params.id, req.body || {}) });
}));

router.delete('/tax/assets/:id', requireOwner, handle((req, res) => {
  deleteAsset(req.params.id);
  res.json({ ok: true });
}));

// ============ נקודות זיכוי calculator (owner) ============

/**
 * The saved status and what it is worth in the requested tax year. The status is the durable
 * thing — birth years and a discharge date do not change — and the points are recomputed from
 * it per year, because the same facts are worth different numbers in different years.
 */
router.get('/tax/credit-points', requireOwner, handle((req, res) => {
  const year = reportYear(req.query);
  const status = getCreditStatus();
  res.json({
    status: status ?? EMPTY_STATUS,
    configured: status !== null,
    year,
    breakdown: creditBreakdown(status ?? EMPTY_STATUS, year),
    // What the estimate is using right now, whether from the calculator or the typed number.
    active_points: getCreditPoints(year),
  });
}));

/** Previews a status without saving it, so the form can total as it is filled in. */
router.post('/tax/credit-points/preview', requireOwner, handle((req, res) => {
  const year = reportYear(req.query);
  res.json({ breakdown: creditBreakdown(normalizeStatus(req.body?.status), year) });
}));

/**
 * Saves the status and writes the resulting points into the setting the estimates read, so
 * "submit" on the calculator is the same act as typing the number into the field by hand.
 */
router.post('/tax/credit-points', requireOwner, handle((req, res) => {
  const year = reportYear(req.query);
  const status = saveCreditStatus(req.body?.status);
  const breakdown = creditBreakdown(status, year);
  setSetting('tax_credit_points', String(breakdown.total));
  res.json({ status, breakdown, active_points: breakdown.total });
}));

/** Drops the status and goes back to the number typed into the settings field. */
router.delete('/tax/credit-points', requireOwner, handle((_req, res) => {
  clearCreditStatus();
  res.json({ status: EMPTY_STATUS, configured: false, active_points: getCreditPoints() });
}));

/**
 * Ticks a period off as filed and/or paid. The report itself is recomputed from the books
 * every time it is opened — this records only the decision, which nothing else knows.
 */
router.put('/reports/filings/:kind/:periodKey', requireOwner, handle((req, res) => {
  const { kind, periodKey } = req.params;
  if (kind !== 'vat' && kind !== 'income_tax') return res.status(400).json({ error: 'invalid filing kind' });
  const b = req.body || {};
  res.json({
    filing: saveFiling(kind, periodKey, {
      filed: b.filed === undefined ? undefined : !!b.filed,
      paid: b.paid === undefined ? undefined : !!b.paid,
      amount: b.amount,
      reference: b.reference,
      notes: b.notes,
    }),
  });
}));

// ============ clients (owner) ============
router.get('/clients', requireOwner, handle((_req, res) => {
  res.json({ clients: listClients() });
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

/**
 * True when this request actually changes a name. A form that posts every field back sends the
 * name it was given, so only a different one counts as someone renaming the row — which is what
 * locks the name against the next calendar sync.
 */
function renamed(incoming: unknown, current: unknown): boolean {
  return incoming !== undefined && String(incoming).trim() !== String(current ?? '').trim();
}

// ============ works (owner) ============
router.get('/works', requireOwner, handle((req, res) => {
  res.json({
    works: listWorks({
      ...dateRange(req.query),
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      client_id: typeof req.query.client_id === 'string' ? req.query.client_id : undefined,
    }),
  });
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
  const { date, description, amount, description_locked } = req.body || {};
  const amt = round2(Number(amount ?? work.amount));
  const vat = round2((amt * getVatPercent()) / 100);
  // As with a show's name: an edited description stops following the calendar.
  const locked = renamed(description, work.description) ? 1
    : description_locked !== undefined ? (description_locked ? 1 : 0)
    : work.description_locked ? 1 : 0;
  db.prepare(
    `UPDATE works SET date = ?, description = ?, amount = ?, vat_amount = ?, total = ?, description_locked = ?
     WHERE id = ?`
  ).run(
    date ?? work.date, description ?? work.description, amt, vat, round2(amt + vat), locked, req.params.id
  );
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
  res.json({
    invoices: listInvoices({
      ...dateRange(req.query),
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    }),
  });
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

/**
 * Deletes an invoice that only ever existed here — one whose issue to Morning was abandoned.
 * An invoice that reached Morning is refused (409): that document can only be credited.
 */
router.delete('/invoices/:id', requireOwner, handle((req, res) => {
  res.json(deleteInvoice(req.params.id));
}));

// ============ expenses (owner) ============
/**
 * The expense list with the totals for the same filters — the two are computed from one
 * WHERE clause, so what the cards say is always what the table shows.
 */
router.get('/expenses', requireOwner, handle((req, res) => {
  const range = dateRange(req.query);
  const filters = {
    ...range,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
  };
  res.json({
    expenses: listExpenses(filters),
    summary: expensesSummary(filters),
    categories: expenseCategories(),
    status: expensesStatus(),
  });
}));

/**
 * What Morning's expense payloads actually say — the same audit `bin/expense-status-probe.ts`
 * prints, over HTTP.
 *
 * It is a route and not only a script because the question it answers ("which field carries
 * דווח in this account?") comes up while looking at the הוצאות page, and opening a URL is
 * something that can be done from there. It reads the payloads the sync kept in
 * `expenses.raw` and reports the keys Morning sends and what the status-like ones hold.
 *
 * `sample` is one payload in full, so a field that does not announce itself in its name can
 * still be found. That one carries a supplier name and an amount — everything else in the
 * response is field names and enum values.
 */
router.get('/expenses/status-audit', requireOwner, handle((_req, res) => {
  res.json(expenseStatusAudit());
}));

// ============ moonlight (owner + band members) ============
/**
 * The two follow-up lists for the band: shows whose money has not arrived, and shows whose
 * suppliers have not been paid. Both are about shows that already happened — a gig next month
 * owing nobody anything yet is not a loose end.
 */
export function bandFollowUps() {
  const today = new Date().toISOString().slice(0, 10);
  const past = db
    .prepare('SELECT * FROM band_events WHERE date <= ? ORDER BY date DESC')
    .all(today) as any[];

  const awaitingPayment = past
    .filter((e) => !moneyReceived(e.payment_status))
    .map((e) => ({
      id: e.id, venue: e.venue, date: e.date,
      amount: round2(Number(e.amount_pre_vat) || 0),
      payment_status: e.payment_status,
    }));

  const owedToSuppliers = past
    .map((e) => ({ event: e, outstanding: expenseOutstanding(expenseRowForEvent(e.id)) }))
    .filter((r) => r.outstanding > 0)
    .map((r) => ({ id: r.event.id, venue: r.event.venue, date: r.event.date, outstanding: r.outstanding }));

  // The third loose end looks forward rather than back: a show that is coming up with
  // nobody staffed for one of its required roles.
  const upcoming = db
    .prepare('SELECT * FROM band_events WHERE date > ? ORDER BY date')
    .all(today) as any[];
  const missingAssignments = upcoming
    .map((e) => ({ id: e.id, venue: e.venue, date: e.date, missing: missingRoles(e.id) }))
    .filter((r) => r.missing.length > 0);

  return {
    awaitingPayment,
    awaitingPaymentTotal: round2(awaitingPayment.reduce((s, e) => s + e.amount, 0)),
    owedToSuppliers,
    owedToSuppliersTotal: round2(owedToSuppliers.reduce((s, e) => s + e.outstanding, 0)),
    missingAssignments,
  };
}

export function bandSummary(range: { from?: string; to?: string } = {}) {
  const eventsWhere = rangeClause('date', range);
  const events = db.prepare(`SELECT * FROM band_events${eventsWhere.sql}`).all(...eventsWhere.params) as any[];
  const general = db
    .prepare(`SELECT * FROM band_general_expenses${eventsWhere.sql}`)
    .all(...eventsWhere.params) as any[];
  const sum = (arr: any[], key: string) => round2(arr.reduce((acc, r) => acc + (Number(r[key]) || 0), 0));
  // The member split is shown for the shows whose money has come in but has not been handed
  // out yet — "what is still coming to each of us" — so a show marked שולם לנגנים drops out of
  // it, and one whose money has not actually arrived yet is not counted as profit either.
  const unsettled = events.filter((e) => !e.paid_to_musicians && moneyReceived(e.payment_status));
  // Keyed by member rather than spread across named fields, so the shape follows the roster
  // instead of pinning it to four names the way the old columns did.
  const sumShares = (rows: any[]) => {
    const totals: Record<string, number> = Object.fromEntries(
      listBandMembers().map((m) => [m.member_key, 0])
    );
    for (const row of rows) {
      for (const [key, amount] of Object.entries(eventShares(row.id))) {
        totals[key] = round2((totals[key] || 0) + amount);
      }
    }
    return totals;
  };
  return {
    unpaidDivision: {
      shares: sumShares(unsettled),
      profit: sum(unsettled, 'profit'),
      count: unsettled.length,
    },
    totalRevenue: sum(events, 'amount_pre_vat'),
    totalExpenses: sum(events, 'expenses'),
    totalProfit: sum(events, 'profit'),
    shares: sumShares(events),
    fundExpenses: sum(general, 'fund'),
    generalExpenses: sum(general, 'amount'),
    eventCount: events.length,
    upcomingEvents: events.filter((e) => e.date >= new Date().toISOString().slice(0, 10)).length,
    // One bar per show, oldest first, for the moonlight dashboard's income/expenses/profit chart.
    perShow: events
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        id: e.id,
        label: eventLabel(e.venue, e.date),
        income: round2(Number(e.amount_pre_vat) || 0),
        expenses: round2(Number(e.expenses) || 0),
        profit: round2(Number(e.profit) || 0),
      })),
  };
}

/**
 * How the money owed to each member is arrived at, step by step — the three steps the band's
 * own spreadsheet has always laid out, so the final figure can be checked rather than trusted.
 *
 * 1. Every show whose money has come in («התקבל») and is not yet marked «שולם לנגנים»
 *    contributes its per-member share of the profit.
 * 2. A general expense a member paid out of their own pocket is added back to them in full —
 *    it is a refund, not a share of anything.
 * 3. A general expense the band's float (קופה) covered was borne by everybody, so it comes off
 *    each member's payout in equal parts.
 *
 * `paid` is what settled means for a general expense: the moonlight migration set it from the
 * sheet's «הוחזר» columns, so a row already squared takes no further part in the division.
 * Both halves follow the selected range, as the rest of the summary does.
 */
export function bandDivision(range: { from?: string; to?: string } = {}) {
  const where = rangeClause('date', range);
  const events = db
    .prepare(`SELECT * FROM band_events${where.sql} ORDER BY date`)
    .all(...where.params) as any[];
  const general = db
    .prepare(`SELECT * FROM band_general_expenses${where.sql} ORDER BY date`)
    .all(...where.params) as any[];

  // Everyone who has ever been in the band, not only who is in it now: a member who left is
  // still owed their share of the shows they played, and dropping them would quietly lose it.
  const roster = listBandMembers();
  const memberKeys: MemberKey[] = roster.map((m) => m.member_key);
  const perMember = (fn: (key: MemberKey) => number) =>
    Object.fromEntries(memberKeys.map((key) => [key, round2(fn(key))])) as Record<MemberKey, number>;

  // Step 1 — shows whose money has actually come in but whose profit has not been handed
  // out yet. A show still waiting on payment is not profit to divide, whatever its calculated
  // share would be.
  const shows = events
    .filter((e) => !e.paid_to_musicians && moneyReceived(e.payment_status))
    .map((e) => {
      const shares = eventShares(e.id);
      return {
        id: e.id,
        venue: e.venue,
        date: e.date,
        profit: round2(Number(e.profit) || 0),
        ...perMember((key) => shares[key] || 0),
      };
    });
  const showsTotal: Record<string, number> = {
    ...perMember((key) => shows.reduce((sum, s) => sum + ((s as any)[key] || 0), 0)),
    profit: round2(shows.reduce((sum, s) => sum + s.profit, 0)),
    count: shows.length,
  };

  // Step 2 — what a member fronted and has not had back.
  const unsettled = general.filter((g) => !g.paid);
  const refunds = unsettled
    .map((g) => ({ row: g, member: memberByName(g.paid_by) }))
    .filter((r) => r.member)
    .map((r) => ({
      id: r.row.id,
      date: r.row.date,
      description: r.row.description,
      paid_by: r.row.paid_by,
      member: r.member as MemberKey,
      amount: round2(Number(r.row.amount) || 0),
    }));
  const refundsByMember = perMember((key) =>
    refunds.filter((r) => r.member === key).reduce((sum, r) => sum + r.amount, 0)
  );

  // Step 3 — what the float covered, split evenly.
  const fundExpenses = unsettled
    .filter((g) => String(g.paid_by ?? '').trim() === FUND_PAYER)
    .map((g) => ({
      id: g.id, date: g.date, description: g.description, amount: round2(Number(g.amount) || 0),
    }));
  const fundTotal = round2(fundExpenses.reduce((sum, g) => sum + g.amount, 0));
  // Costs the float covered are shared by the members who are in the band now — somebody who
  // has left does not go on paying for it.
  const current = activeBandMembers().map((m) => m.member_key as MemberKey);
  const sharers = current.length > 0 ? current : memberKeys;
  const fundShare = sharers.length > 0 ? round2(fundTotal / sharers.length) : 0;

  // What each member's own share works out to once the shared costs are taken off, before any
  // money they fronted comes back to them. It is the figure that says how the shows actually
  // went for everybody — a refund is the band returning someone's own money, not a share of
  // anything, and leaving it in makes one member look like they earned more than the rest.
  const beforeRefund = perMember((key) =>
    (showsTotal[key] || 0) - (sharers.includes(key) ? fundShare : 0));
  const payout = perMember((key) => beforeRefund[key] + refundsByMember[key]);

  const sumOver = (values: Record<MemberKey, number>) =>
    round2(memberKeys.reduce((sum: number, key: MemberKey) => sum + (values[key] || 0), 0));

  return {
    members: roster,
    shows,
    showsTotal,
    refunds,
    refundsByMember,
    refundsTotal: round2(refunds.reduce((sum, r) => sum + r.amount, 0)),
    fundExpenses,
    fundTotal,
    fundShare,
    beforeRefund,
    beforeRefundTotal: sumOver(beforeRefund),
    payout,
    payoutTotal: sumOver(payout),
  };
}

router.get('/moonlight/summary', requireAuth, handle((req, res) => {
  res.json({ summary: bandSummary(dateRange(req.query)), fund: bandFund() });
}));

/**
 * The band's float (קופה), from both ends.
 *
 * `computed` is what the books say should be in it: money that actually came in, less what has
 * been paid out to suppliers and handed to members, less the costs the float itself covered.
 * `actual` is what the bank says, typed in by whoever last looked. The gap between them is the
 * only interesting number of the three — it is a receipt nobody entered, or a payment nobody
 * recorded, and it is worth seeing before it is a year old.
 */
export function bandFund() {
  const events = db.prepare('SELECT * FROM band_events').all() as any[];
  const general = db.prepare('SELECT * FROM band_general_expenses').all() as any[];
  const sum = (rows: any[], fn: (row: any) => number) => round2(rows.reduce((s, r) => s + (fn(r) || 0), 0));

  const received = sum(events.filter((e) => moneyReceived(e.payment_status)), (e) => Number(e.amount_pre_vat));
  const toSuppliers = sum(events, (e) => Number(e.expenses_paid));
  const toMembers = sum(events.filter((e) => e.paid_to_musicians), (e) => Number(e.profit));
  const fromFund = sum(general.filter((g) => String(g.paid_by ?? '').trim() === FUND_PAYER), (g) => Number(g.amount));

  const computed = round2(received - toSuppliers - toMembers - fromFund);
  const raw = getSetting('band_fund_actual', '');
  const actual = raw === '' ? null : round2(Number(raw) || 0);
  return {
    received, toSuppliers, toMembers, fromFund, computed, actual,
    gap: actual === null ? null : round2(actual - computed),
  };
}

/**
 * The same four lines, with the rows behind each one — and, more to the point, where the gap
 * against the bank comes from.
 *
 * `bandFund` answers "what should be in the account"; it cannot say why that disagrees with
 * what is. This does, by naming the four things that make the books and the bank diverge and
 * pricing each of them, so a gap of thousands stops being a mystery and becomes a list.
 *
 * The signs are all in terms of the gap itself — `actual − computed` — so a suspect's `effect`
 * is how much of that gap it accounts for, and what is left over after all four is genuinely
 * unexplained: a receipt or a payment nobody entered.
 */
export function bandFundExplain() {
  const events = db.prepare('SELECT * FROM band_events ORDER BY date').all() as any[];
  const general = db.prepare('SELECT * FROM band_general_expenses ORDER BY date').all() as any[];
  const expenseRows = db.prepare('SELECT * FROM band_event_expenses').all() as any[];
  const fund = bandFund();

  const num = (value: unknown) => round2(Number(value) || 0);
  const showRow = (event: any, amount: number) => ({
    id: event.id, venue: event.venue, date: event.date,
    status: event.payment_status, amount,
  });
  const generalRow = (row: any, amount: number) => ({
    id: row.id, description: row.description, date: row.date, paid_by: row.paid_by, amount,
  });
  const total = (rows: Array<{ amount: number }>) =>
    round2(rows.reduce((sum, r) => sum + r.amount, 0));
  const line = (rows: Array<{ amount: number }>) => ({ rows, total: total(rows), count: rows.length });

  // ---- the four lines of the sum, itemised ----
  const received = line(events
    .filter((e) => moneyReceived(e.payment_status) && num(e.amount_pre_vat) !== 0)
    .map((e) => showRow(e, num(e.amount_pre_vat))));
  const toSuppliers = line(events
    .filter((e) => num(e.expenses_paid) !== 0)
    .map((e) => showRow(e, num(e.expenses_paid))));
  const toMembers = line(events
    .filter((e) => e.paid_to_musicians && num(e.profit) !== 0)
    .map((e) => showRow(e, num(e.profit))));
  const fromFund = line(general
    .filter((g) => String(g.paid_by ?? '').trim() === FUND_PAYER && num(g.amount) !== 0)
    .map((g) => generalRow(g, num(g.amount))));

  // ---- the gap, itemised ----

  // A show at «התקבל» has been paid, so the sum counts its income — but the payment landed in
  // the private account and the transfer into the band's has not happened. Every shekel of this
  // is money the calculation holds and the bank has never seen.
  const awaitingTransfer = line(events
    .filter((e) => e.payment_status === 'received' && num(e.amount_pre_vat) !== 0)
    .map((e) => showRow(e, num(e.amount_pre_vat))));

  // A transfer that did happen rarely moves the whole of the show's income: מע"מ belongs to the
  // state and a provision for מס הכנסה stays behind for it. The sum counts the income; the
  // account got the transfer. The difference between the two is recorded per show, so this is
  // arithmetic rather than an estimate.
  const withheld = line(events
    .filter((e) => e.payment_status === FUND_TRANSFERRED && e.fund_transfer_amount != null)
    .map((e) => ({
      ...showRow(e, round2(num(e.amount_pre_vat) - num(e.fund_transfer_amount))),
      income: num(e.amount_pre_vat),
      transferred: num(e.fund_transfer_amount),
    }))
    .filter((r) => Math.abs(r.amount) >= 0.5));

  // Costs the sum takes off the float although the float did not pay them: the cost row names a
  // member, so that money came out of somebody's own pocket.
  const rowByEvent = new Map<string, any>();
  for (const row of expenseRows) if (row.event_id) rowByEvent.set(row.event_id, row);
  const memberPaidCosts = line(events
    .filter((e) => {
      const row = rowByEvent.get(e.id);
      return !!row && !!memberByName(row.paid_by) && num(e.expenses_paid) !== 0;
    })
    .map((e) => ({ ...showRow(e, num(e.expenses_paid)), paid_by: rowByEvent.get(e.id).paid_by })));

  // The other direction: a cost a member fronted and has since been squared up for. The money
  // left the float when they were paid back, but the sum only subtracts what the float paid
  // directly, so it is still counted as being there.
  const refundedToMembers = line(general
    .filter((g) => g.paid && !!memberByName(g.paid_by) && num(g.amount) !== 0)
    .map((g) => generalRow(g, num(g.amount))));

  const suspects = [
    { key: 'awaitingTransfer', effect: -awaitingTransfer.total, ...awaitingTransfer },
    { key: 'withheld', effect: -withheld.total, ...withheld },
    { key: 'memberPaidCosts', effect: memberPaidCosts.total, ...memberPaidCosts },
    { key: 'refundedToMembers', effect: -refundedToMembers.total, ...refundedToMembers },
  ].filter((s) => s.count > 0);

  const explained = round2(suspects.reduce((sum, s) => sum + s.effect, 0));

  // What the suppliers are still owed is not a gap — that money is genuinely in the account,
  // and correctly counted. It is here because it is the next question anybody asks of a float
  // that looks healthier than it is.
  const owedToSuppliers = round2(expenseRows.reduce((sum, r) => sum + expenseOutstanding(r), 0));

  return {
    fund,
    lines: { received, toSuppliers, toMembers, fromFund },
    suspects,
    explained,
    unexplained: fund.gap === null ? null : round2(fund.gap - explained),
    owedToSuppliers,
  };
}

router.get('/moonlight/fund/explain', requireAuth, handle((_req, res) => {
  res.json({ explain: bandFundExplain() });
}));

/** Records what the account actually holds. Empty clears it back to "nobody has said". */
router.post('/moonlight/fund', requireOwner, handle((req, res) => {
  const value = req.body?.actual;
  setSetting('band_fund_actual', value === null || value === '' ? '' : String(Number(value) || 0));
  res.json({ fund: bandFund() });
}));

/** The worked-out version of the summary's division figures — every step and its rows. */
router.get('/moonlight/division', requireAuth, handle((req, res) => {
  res.json({ division: bandDivision(dateRange(req.query)) });
}));

router.get('/moonlight/events', requireAuth, handle((req, res) => {
  const where = rangeClause('date', dateRange(req.query));
  const events = db
    .prepare(`SELECT * FROM band_events${where.sql} ORDER BY date`)
    .all(...where.params) as any[];
  // Which roles are unstaffed travels with the show, because that is what the list is scanned
  // for — a gig three weeks out with nobody on sound is the row you are looking for.
  res.json({ events: events.map((e) => ({ ...withShares(e), missing: missingRoles(e.id) })) });
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

/**
 * Everything about one show, in one request: the show, its costs, who is staffed on it and
 * the suppliers that could be.
 *
 * It exists because the show page is now where all of that is read and written. Fetching the
 * four lists separately and matching them up in the browser is how the old tabs worked, and
 * it is exactly what made a show's numbers something you had to assemble in your head.
 */
router.get('/moonlight/events/:id', requireAuth, handle((req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'event not found' });
  const expense = ensureExpenseRow(event);
  const suppliers = listSuppliers();
  const byId = new Map(suppliers.map((s) => [s.id, s]));

  const assignments: Record<string, any> = {};
  for (const a of assignmentsForEvent(event.id)) {
    assignments[a.role] = {
      supplier_id: a.supplier_id,
      supplier_name: a.supplier_id ? byId.get(a.supplier_id)?.name ?? '?' : null,
      not_needed: !!a.not_needed,
      source: a.source,
    };
  }

  res.json({
    event: { ...withShares(event), label: eventLabel(event.venue, event.date) },
    expenses: expense,
    outstanding: expenseOutstanding(expense),
    assignments,
    missing: missingRoles(event.id),
    suppliers,
  });
}));

/**
 * Ticks every cost line of one show as paid. It is the "תשלום לספקים" button: the page can
 * already tick each line on its own, and this is the same decision taken for all of them at
 * once, which is what actually happens on the evening a show is settled.
 *
 * Only lines carrying an amount are touched — marking an empty line paid would say a supplier
 * who was never engaged has been settled with.
 */
router.post('/moonlight/events/:id/pay-suppliers', requireOwner, handle((req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'event not found' });
  const row = ensureExpenseRow(event);
  const paid = PAID_EXPENSE_FIELDS.filter((f) => Number(row[f]) > 0);
  if (paid.length) {
    db.prepare(
      `UPDATE band_event_expenses SET ${paid.map((f) => `${f}_paid = 1`).join(', ')} WHERE id = ?`
    ).run(row.id);
  }
  res.json({ event: recomputeEvent(event.id), settled: paid.length });
}));

/**
 * A show's income is one number written two ways, so entering either side fills in the other.
 *
 * Whichever side the request carries is worked out into the other at the business VAT rate.
 * Typing into one field and leaving the other at a figure that no longer matches it is always
 * a mistake, and re-typing both by hand was the only way to keep them in step. A request that
 * carries two figures of its own is taken at its word — a show can be billed at its own rate,
 * and clearing both to zero has to stay possible.
 */
function showIncome(body: any, existing?: any): { pre: number; gross: number } {
  const num = (value: any) => (value === '' || value == null ? 0 : Number(value) || 0);
  const rate = 1 + getVatPercent() / 100;
  const prePresent = body.amount_pre_vat !== undefined;
  const grossPresent = body.amount_with_vat !== undefined;
  const pre = prePresent ? num(body.amount_pre_vat) : num(existing?.amount_pre_vat);
  const gross = grossPresent ? num(body.amount_with_vat) : num(existing?.amount_with_vat);

  // The side that was just typed leads; the other follows it whenever it holds nothing to lose.
  if (prePresent && pre && (!grossPresent || !gross)) return { pre, gross: round2(pre * rate) };
  if (grossPresent && gross && (!prePresent || !pre)) return { pre: round2(gross / rate), gross };
  return { pre, gross };
}

// Writes to moonlight data are owner-only; band members are view-only.
// `expenses`, `expenses_paid` and `profit` are never taken from the client: they are derived
// from the show's expense row by recomputeEvent.
router.post('/moonlight/events', requireOwner, handle((req, res) => {
  const b = req.body || {};
  if (!b.venue || !b.date) return res.status(400).json({ error: 'venue and date are required' });
  const id = uuid();
  const income = showIncome(b);
  db.prepare(
    `INSERT INTO band_events (id, venue, date, tickets, capacity, amount_pre_vat, amount_with_vat,
      receiver, invoice, has_commission, commission_percent, paid_to_musicians, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, b.venue, b.date, b.tickets || 0, b.capacity || 0, income.pre, income.gross,
    b.receiver || null, b.invoice || null, b.has_commission ? 1 : 0,
    b.commission_percent != null ? normalizeCommissionPercent(b.commission_percent) : DEFAULT_COMMISSION_PERCENT,
    b.paid_to_musicians ? 1 : 0,
    normalizePaymentStatus(b.payment_status) || 'waiting_report'
  );
  ensureExpenseRow(getEvent(id));
  res.json({ event: recomputeEvent(id) });
}));


router.put('/moonlight/events/:id', requireOwner, handle((req, res) => {
  const existing = getEvent(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'event not found' });
  const body = req.body || {};
  const b = { ...existing, ...body };

  // Typing a share by hand takes the division over; asking for 'auto' hands it back.
  const patchedShares: Record<string, unknown> | null =
    body.shares && typeof body.shares === 'object' ? body.shares : null;
  const touchedDivision = !!patchedShares && Object.keys(patchedShares).length > 0;
  const divisionMode = body.division_mode === 'auto' ? 'auto'
    : touchedDivision ? 'manual'
    : existing.division_mode || 'auto';

  // Renaming a show is a decision about its name: from here on the calendar sync leaves it
  // alone. Sending venue_locked: 0 without renaming hands the name back to the sync.
  const venueLocked = renamed(body.venue, existing.venue) ? 1
    : body.venue_locked !== undefined ? (body.venue_locked ? 1 : 0)
    : existing.venue_locked ? 1 : 0;

  const income = showIncome(body, existing);
  // Reaching — or leaving — «הכסף הועבר לקופה» is the one status change that moves money
  // outside this row: the band's recorded balance follows it, and what the show records as
  // transferred is whatever went in, so the same sum can come back out again.
  const paymentStatus =
    normalizePaymentStatus(b.payment_status) || existing.payment_status || 'waiting_report';
  const fundTransfer = settleFundTransfer(existing, paymentStatus, body.fund_transfer_amount);
  db.prepare(
    `UPDATE band_events SET venue=?, date=?, tickets=?, capacity=?, amount_pre_vat=?, amount_with_vat=?,
      receiver=?, invoice=?, has_commission=?, commission_percent=?, paid_to_musicians=?,
      division_mode=?, payment_status=?, fund_transfer_amount=?, venue_locked=?
     WHERE id=?`
  ).run(
    b.venue, b.date, b.tickets, Math.max(0, Math.round(Number(b.capacity) || 0)),
    income.pre, income.gross,
    b.receiver, b.invoice, b.has_commission ? 1 : 0, normalizeCommissionPercent(b.commission_percent),
    b.paid_to_musicians ? 1 : 0, divisionMode, paymentStatus, fundTransfer,
    venueLocked, req.params.id
  );

  // A share patch names only the members it changes, so it is merged over what is stored
  // rather than replacing it — editing one member's share must not zero the other three.
  if (patchedShares) {
    const unknown = Object.keys(patchedShares).filter((key) => !bandMemberByKey(key));
    if (unknown.length > 0) {
      return res.status(400).json({ error: `חבר לא מוכר: ${unknown.join(', ')}` });
    }
    setEventShares(req.params.id, { ...eventShares(req.params.id), ...patchedShares });
  }

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

/**
 * Attaches an existing expense row to a show — the manual counterpart to the migration, for
 * the rows whose written-out name could not be matched to one automatically.
 */
router.post('/moonlight/event-expenses/:id/assign', requireOwner, handle((req, res) => {
  const eventId = req.body?.event_id ? String(req.body.event_id) : null;
  res.json({ expense: reassignExpenseRow(req.params.id, eventId) });
}));

/**
 * Empties a show's expense row, or deletes an unassigned one outright — see deleteExpenseRow
 * for why the two cases differ.
 */
router.delete('/moonlight/event-expenses/:id', requireOwner, handle((req, res) => {
  res.json(deleteExpenseRow(req.params.id));
}));

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

  // Typing a קמפיין figure by hand takes it over from the Meta sync, which from then on reports
  // the row as held back instead of overwriting it — the same bargain a renamed show strikes
  // with the calendar. Sending campaign_locked explicitly is how it is handed back, so the
  // explicit value wins over the implicit lock a co-sent amount would set.
  if (body.campaign_locked !== undefined) {
    sets.push('campaign_locked = ?');
    params.push(body.campaign_locked ? 1 : 0);
  } else if (body.campaign !== undefined) {
    sets.push('campaign_locked = ?');
    params.push(1);
  }

  if (sets.length) {
    db.prepare(`UPDATE band_event_expenses SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.params.id);
  }
  // Handing the lock back means asking for Meta's figure again, so it is restored right away
  // rather than at whatever point somebody next runs a sync.
  if (body.campaign_locked !== undefined && !body.campaign_locked) applyCampaignSpend();
  if (existing.event_id) recomputeEvent(existing.event_id);
  res.json({
    expense: db.prepare('SELECT * FROM band_event_expenses WHERE id = ?').get(req.params.id),
    event: existing.event_id ? withShares(getEvent(existing.event_id)) : null,
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

// ---- moonlight follow-ups: the summary tab's dashboard cards ----
router.get('/moonlight/follow-ups', requireAuth, handle((_req, res) => {
  res.json({ followUps: bandFollowUps() });
}));

// ---- moonlight staffing (שיבוצים): suppliers and who works each show ----
/**
 * Suppliers with what each is still owed, show by show — plus what they are booked for on
 * shows that have not happened yet, which is reported beside the debt rather than inside it.
 */
function suppliersWithDebts() {
  const debts = supplierDebts();
  return listSuppliers().map((s) => ({
    ...s,
    owed: debts.get(s.id)?.owed ?? 0,
    owed_shows: debts.get(s.id)?.shows ?? [],
    upcoming: debts.get(s.id)?.upcoming ?? 0,
    upcoming_shows: debts.get(s.id)?.upcoming_shows ?? [],
  }));
}

// ---- the band itself ----
router.get('/moonlight/members', requireAuth, handle((_req, res) => {
  res.json({ members: listBandMembers(), business_types: BUSINESS_TYPES });
}));

router.post('/moonlight/members', requireOwner, handle((req, res) => {
  const { name, email, role, is_manager, business_type } = req.body || {};
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return res.status(400).json({ error: 'שם חבר חובה' });
  const type = business_type ?? 'none';
  if (!BUSINESS_TYPES.some((t) => t.value === type)) {
    return res.status(400).json({ error: 'סוג עסק לא חוקי' });
  }
  // The name is how a general expense's «שולם על ידי» finds its member, so two members sharing
  // one would make that lookup a coin toss.
  if (listBandMembers().some((m) => m.name === trimmed)) {
    return res.status(409).json({ error: `כבר קיים חבר בשם «${trimmed}»` });
  }
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM band_members')
    .get() as { n: number }).n + 1;
  const id = uuid();
  // The key is never shown and never changes, which is what lets a member be renamed later
  // without orphaning the shows they have already played.
  db.prepare(
    `INSERT INTO band_members (id, member_key, name, email, role, is_manager, business_type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, `m_${id.slice(0, 8)}`, trimmed, String(email ?? '').trim() || null,
    String(role ?? '').trim() || null, is_manager ? 1 : 0, type, order
  );
  res.json({ member: db.prepare('SELECT * FROM band_members WHERE id = ?').get(id) });
}));

/**
 * Removing a member is only ever right for one that was entered by mistake. A member who has
 * played is part of the band's history — their shares are money that was divided — so once
 * anything is recorded against them the answer is «לא פעיל», not deletion.
 */
router.delete('/moonlight/members/:key', requireOwner, handle((req, res) => {
  const member = bandMemberByKey(req.params.key);
  if (!member) return res.status(404).json({ error: 'member not found' });
  if (listBandMembers().length <= 1) {
    return res.status(409).json({ error: 'חייב להישאר לפחות חבר אחד בלהקה' });
  }

  const shows = db.prepare(
    'SELECT COUNT(*) AS n FROM band_event_shares WHERE member_key = ? AND amount != 0'
  ).get(req.params.key) as { n: number };
  if (shows.n > 0) {
    return res.status(409).json({
      error: `לא ניתן למחוק — ל${member.name} חלק ב-${shows.n} הופעות. סמנו «לא פעיל» במקום.`,
    });
  }
  const expenses = db.prepare(
    'SELECT COUNT(*) AS n FROM band_general_expenses WHERE TRIM(paid_by) = ?'
  ).get(member.name) as { n: number };
  if (expenses.n > 0) {
    return res.status(409).json({
      error: `לא ניתן למחוק — ${expenses.n} הוצאות כלליות רשומות על ${member.name}. סמנו «לא פעיל» במקום.`,
    });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM band_event_shares WHERE member_key = ?').run(req.params.key);
    db.prepare('DELETE FROM band_members WHERE member_key = ?').run(req.params.key);
  })();
  res.json({ ok: true });
}));

router.put('/moonlight/members/:key', requireOwner, handle((req, res) => {
  const existing = bandMemberByKey(req.params.key);
  if (!existing) return res.status(404).json({ error: 'member not found' });
  const b = { ...existing, ...(req.body || {}) };

  const name = String(b.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'שם חבר חובה' });
  if (!BUSINESS_TYPES.some((t) => t.value === b.business_type)) {
    return res.status(400).json({ error: 'סוג עסק לא חוקי' });
  }
  const email = String(b.email ?? '').trim();
  // The name is what a general expense's «שולם על ידי» is matched against, so renaming a member
  // would orphan every row that names them. Refused rather than silently rewriting history.
  if (name !== existing.name) {
    const inUse = db
      .prepare('SELECT COUNT(*) AS n FROM band_general_expenses WHERE TRIM(paid_by) = ?')
      .get(existing.name) as { n: number };
    if (inUse.n > 0) {
      return res.status(409).json({
        error: `לא ניתן לשנות את השם — ${inUse.n} הוצאות כלליות רשומות על «${existing.name}»`,
      });
    }
  }

  db.prepare(
    `UPDATE band_members
       SET name = ?, email = ?, role = ?, is_manager = ?, business_type = ?, active = ?
     WHERE member_key = ?`
  ).run(
    name, email || null, String(b.role ?? '').trim() || null,
    b.is_manager ? 1 : 0, b.business_type, b.active ? 1 : 0, req.params.key
  );
  res.json({ member: bandMemberByKey(req.params.key) });
}));

router.get('/moonlight/suppliers', requireAuth, handle((_req, res) => {
  res.json({ suppliers: suppliersWithDebts() });
}));

/** A supplier's standing fee. Negative is meaningless, and 0 means "no standing rate". */
const supplierAmount = (value: unknown): number => round2(Math.max(0, Number(value) || 0));

router.post('/moonlight/suppliers', requireOwner, handle((req, res) => {
  const { name, email, role, phone, notes, default_amount } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'שם ספק חובה' });
  if (!isAssignmentRole(role)) return res.status(400).json({ error: 'תפקיד לא חוקי' });
  const id = uuid();
  try {
    db.prepare(
      `INSERT INTO band_suppliers (id, name, email, role, phone, notes, default_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, name.trim(), email?.trim() || null, role, phone || null, notes || null,
      supplierAmount(default_amount)
    );
  } catch {
    return res.status(409).json({ error: 'כבר קיים ספק עם האימייל הזה' });
  }
  // A new email may belong to guests already on synced shows — match them right away.
  autoAssignAll();
  res.json({ supplier: db.prepare('SELECT * FROM band_suppliers WHERE id = ?').get(id) });
}));

router.put('/moonlight/suppliers/:id', requireOwner, handle((req, res) => {
  const existing = db.prepare('SELECT * FROM band_suppliers WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'supplier not found' });
  const b = { ...existing, ...(req.body || {}) };
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'שם ספק חובה' });
  if (!isAssignmentRole(b.role)) return res.status(400).json({ error: 'תפקיד לא חוקי' });
  try {
    db.prepare(
      `UPDATE band_suppliers
         SET name = ?, email = ?, role = ?, phone = ?, notes = ?, default_amount = ?
       WHERE id = ?`
    ).run(
      String(b.name).trim(), b.email?.trim() || null, b.role, b.phone || null, b.notes || null,
      supplierAmount(b.default_amount), req.params.id
    );
  } catch {
    return res.status(409).json({ error: 'כבר קיים ספק עם האימייל הזה' });
  }
  // A changed role invalidates calendar matches made under the old one; redo them.
  if (b.role !== existing.role) {
    db.prepare("DELETE FROM band_event_assignments WHERE supplier_id = ? AND source = 'calendar'")
      .run(req.params.id);
  }
  autoAssignAll();
  res.json({ supplier: db.prepare('SELECT * FROM band_suppliers WHERE id = ?').get(req.params.id) });
}));

router.delete('/moonlight/suppliers/:id', requireOwner, handle((req, res) => {
  deleteSupplier(req.params.id);
  res.json({ ok: true });
}));

/**
 * The staffing board: every show in the range with who holds each role, what that role
 * costs on the show's expense row, and which required roles still have nobody.
 */
router.get('/moonlight/assignments', requireAuth, handle((req, res) => {
  const where = rangeClause('date', dateRange(req.query));
  const events = db
    .prepare(`SELECT * FROM band_events${where.sql} ORDER BY date`)
    .all(...where.params) as any[];
  const suppliers = suppliersWithDebts();
  const byId = new Map(suppliers.map((s) => [s.id, s]));

  const rows = events.map((e) => {
    const expense = expenseRowForEvent(e.id);
    const roles: Record<string, any> = {};
    for (const a of assignmentsForEvent(e.id)) {
      roles[a.role] = {
        supplier_id: a.supplier_id,
        supplier_name: a.supplier_id ? byId.get(a.supplier_id)?.name ?? '?' : null,
        not_needed: !!a.not_needed,
        source: a.source,
      };
    }
    const amounts: Record<string, { amount: number; paid: boolean }> = {};
    for (const role of ASSIGNMENT_ROLES) {
      amounts[role] = { amount: round2(Number(expense?.[role]) || 0), paid: !!expense?.[`${role}_paid`] };
    }
    return {
      id: e.id, venue: e.venue, date: e.date, calendar_event_id: e.calendar_event_id,
      attendees: attendeeEmails(e), roles, amounts, missing: missingRoles(e.id),
    };
  });

  res.json({ events: rows, suppliers });
}));

/** One staffing decision: who fills `role` on this show, or that it is not needed. */
router.put('/moonlight/events/:id/assignments', requireOwner, handle((req, res) => {
  const { role, supplier_id, not_needed } = req.body || {};
  if (!isAssignmentRole(role)) return res.status(400).json({ error: 'תפקיד לא חוקי' });
  res.json({ assignment: setAssignment(req.params.id, role, supplier_id || null, !!not_needed) });
}));

/** Re-matches every stored guest list — for after the supplier table is edited. */
router.post('/moonlight/assignments/auto-match', requireOwner, handle((_req, res) => {
  res.json({ assigned: autoAssignAll() });
}));

// ====== integrations: Morning (Green Invoice) + Google Calendar + Meta ads (owner) ======
router.get('/integrations', requireOwner, handle((_req, res) => {
  res.json({ morning: morningStatus(), calendar: calendarStatus(), meta: metaStatus() });
}));

/**
 * Pulls documents and expenses from Morning into the local database — one button's worth
 * of "fetch everything Morning knows about the period".
 *
 * The expense half is reported rather than fatal: an account whose plan does not expose
 * expenses still gets its documents, and sees why the rest did not arrive.
 */
router.post('/integrations/morning/sync', requireOwner, handleAsync(async (req, res) => {
  const days = req.body?.days != null ? parseInt(req.body.days, 10) : undefined;
  const result = await pullFromMorning({ days });
  const expenses = await pullExpensesFromMorning({ days }).catch((err: any) => ({
    error: err.message || 'משיכת ההוצאות נכשלה',
  }));
  res.json({ result: { ...result, expenses } });
}));

/** Pulls expenses only — what the הוצאות page's own sync button asks for. */
router.post('/integrations/morning/expenses-sync', requireOwner, handleAsync(async (req, res) => {
  const days = req.body?.days != null ? parseInt(req.body.days, 10) : undefined;
  res.json({ result: await pullExpensesFromMorning({ days }) });
}));

/** Pre-fills the issue dialog with the document Morning is about to be asked for. */
router.get('/invoices/:id/morning-draft', requireOwner, handle((req, res) => {
  res.json({ draft: buildMorningDraft(req.params.id) });
}));

/** The same dialog for works that have no invoice yet — the document is what will create one. */
router.post('/invoices/morning-draft', requireOwner, handle((req, res) => {
  const { client_id, work_ids } = req.body || {};
  res.json({ draft: buildPendingMorningDraft({ clientId: client_id, workIds: work_ids || [] }) });
}));

/**
 * Issues selected works as a document in Morning and creates the local invoice from what
 * Morning returned — the invoice never exists before the document does.
 */
router.post('/invoices/issue-to-morning', requireOwner, handleAsync(async (req, res) => {
  const b = req.body || {};
  const { result, invoice } = await issueWorksToMorning({
    clientId: b.client_id,
    workIds: b.work_ids || [],
    docType: b.doc_type != null ? parseInt(b.doc_type, 10) : undefined,
    date: b.date || undefined,
    dueDate: b.due_date || undefined,
    description: b.description,
    remarks: b.remarks,
    clientEmail: b.client_email,
    sendEmail: Boolean(b.send_email),
  });
  res.json({ result, invoice });
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

// ---- Meta ads: pull the campaigns, then attribute them to shows ----

/**
 * Pulls campaigns and daily spend from Meta and writes what the mappings attribute into each
 * show's קמפיין line. Both halves in one button, since a pull nobody applies changes nothing
 * a user can see.
 */
router.post('/integrations/meta/sync', requireOwner, handleAsync(async (req, res) => {
  const days = req.body?.days != null ? parseInt(req.body.days, 10) : undefined;
  const result = await pullCampaignsFromMeta({ days });
  res.json({ result: { ...result, applied: applyCampaignSpend() } });
}));

/**
 * The campaigns with their mappings, their attributed shares, and — for the ones mapped to
 * nothing — what shows they were probably for. `?unmapped=1` narrows it to the work outstanding.
 */
router.get('/integrations/meta/campaigns', requireOwner, handle((req, res) => {
  res.json({ campaigns: listCampaigns({ unmappedOnly: req.query?.unmapped === '1' }) });
}));

/** One campaign's daily spend — the run-up curve behind a show. */
router.get('/integrations/meta/campaigns/:id/daily', requireOwner, handle((req, res) => {
  res.json({ daily: campaignDaily(req.params.id) });
}));

/**
 * Maps a campaign to a show, or re-weights it. `weight` divides a campaign shared by several
 * shows: equal by default, so a tour campaign splits evenly without anyone setting anything.
 */
router.post('/integrations/meta/campaigns/:id/mappings', requireOwner, handle((req, res) => {
  const eventId = req.body?.event_id ? String(req.body.event_id) : '';
  if (!eventId) return res.status(400).json({ error: 'event_id is required' });
  const weight = req.body?.weight != null ? Number(req.body.weight) : 1;
  res.json({ mapping: setMapping(req.params.id, eventId, weight) });
}));

/** Unmaps a campaign from a show. The show keeps the figure already in its books. */
router.delete('/integrations/meta/campaigns/:id/mappings/:eventId', requireOwner, handle((req, res) => {
  res.json(deleteMapping(req.params.id, req.params.eventId));
}));

/**
 * What each show's promotion cost: ad spend beside tickets sold and the fee, with cost per
 * ticket and spend as a share of revenue. The band area's own read, so the period filter is
 * the same one every other list uses.
 */
router.get('/moonlight/ad-analysis', requireAuth, handle((req, res) => {
  res.json(adAnalysis(dateRange(req.query)));
}));

/**
 * Ad spend by calendar month — one row per Meta invoice, since the ads are produced monthly.
 * A campaign runs across months, so this is the view that reconciles an invoice against the
 * campaigns and shows behind it; `ad-analysis` partitions the same money by show instead.
 */
router.get('/moonlight/ad-monthly', requireAuth, handle((req, res) => {
  res.json(monthlyBreakdown(dateRange(req.query)));
}));

// ====== יועץ קמפיינים: the AI advisor over the ad data (agent reached over SSH) ======

/**
 * The last analysis for this period, straight from the database.
 *
 * A read, not a run: producing a report means an SSH session and a minute or two of the agent's
 * time, so a page load must never start one. Everybody in the band can read the report; only the
 * owner can spend a run on a new one.
 */
router.get('/moonlight/campaign-analysis', requireAuth, handle((req, res) => {
  const range = dateRange(req.query);
  res.json({ report: lastReport('analysis', range), agent: agentStatus() });
}));

/** Spends a run: rebuilds the context from the current data and asks the agent for a verdict. */
router.post('/moonlight/campaign-analysis', requireOwner, handleAsync(async (req, res) => {
  res.json({ report: await analyzeCampaigns(dateRange(req.query)) });
}));

/** The last campaign plan drafted for a show, if there is one. */
router.get('/moonlight/campaign-draft/:eventId', requireAuth, handle((req, res) => {
  res.json({ report: lastReport('draft', {}, req.params.eventId) });
}));

/**
 * Drafts a campaign for an upcoming show — audience, budget, schedule and ad copy.
 *
 * Text, not an action: nothing here reaches Meta. The plan is written to be read, corrected and
 * typed into Ads Manager by a person, which is also why the whole history feeds it rather than
 * whatever period the tab happens to be showing.
 */
router.post('/moonlight/campaign-draft', requireOwner, handleAsync(async (req, res) => {
  const eventId = req.body?.event_id ? String(req.body.event_id) : '';
  if (!eventId) return res.status(400).json({ error: 'event_id is required' });
  res.json({ report: await draftCampaign(eventId, String(req.body?.brief || '').slice(0, 2000)) });
}));

/** The follow-up conversation. One thread per owner, which is all this app ever has. */
router.get('/moonlight/campaign-chat', requireAuth, handle((req, res) => {
  res.json({ messages: chatHistory(CAMPAIGN_CHAT_THREAD) });
}));

router.post('/moonlight/campaign-chat', requireOwner, handleAsync(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });
  res.json({ messages: await chat(CAMPAIGN_CHAT_THREAD, message.slice(0, 2000), dateRange(req.query)) });
}));

router.delete('/moonlight/campaign-chat', requireOwner, handle((_req, res) => {
  res.json(clearChat(CAMPAIGN_CHAT_THREAD));
}));

/**
 * Connectivity test for the Settings card: opens the SSH session and asks the agent its version.
 * Proves the host answers, the key opens it, the host key matches the pin and the command exists
 * — without spending a real analysis to find out which of those is broken.
 */
router.post('/integrations/agent/ping', requireOwner, handleAsync(async (_req, res) => {
  res.json({ result: await agentPing() });
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
      vat_report_frequency: getVatFrequency(),
      tax_credit_points: getCreditPoints(),
      meta_sync_days: getMetaSyncDays(),
      meta_currency_rate: getMetaCurrencyRate(),
    },
    business: getBusinessDetails(),
    business_types: Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    integrations: {
      morning: morningStatus(), calendar: calendarStatus(), meta: metaStatus(), agent: agentStatus(),
    },
    calendar_rules: listRules(),
    users: db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY role, name').all(),
    api_keys: db.prepare('SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys ORDER BY created_at').all(),
  });
}));

router.post('/settings', requireOwner, handle((req, res) => {
  const {
    vat_percent, app_name, morning_sync_days, vat_report_frequency, tax_credit_points,
    meta_sync_days, meta_currency_rate,
  } = req.body || {};
  if (vat_percent != null) setSetting('vat_percent', String(vat_percent));
  if (app_name) setSetting('app_name', app_name);
  if (morning_sync_days != null) {
    // Bounded at both ends: a zero or negative window would ask Morning for a range that ends
    // before it starts and quietly sync nothing, and five years is well past any real backfill.
    const days = parseInt(morning_sync_days, 10);
    if (!Number.isFinite(days) || days < 1 || days > 1825)
      return res.status(400).json({ error: 'טווח הסנכרון חייב להיות בין 1 ל-1825 ימים' });
    setSetting('morning_sync_days', String(days));
  }
  if (vat_report_frequency != null) {
    if (!['bimonthly', 'monthly'].includes(vat_report_frequency))
      return res.status(400).json({ error: 'תדירות דיווח מע"מ לא חוקית' });
    setSetting('vat_report_frequency', vat_report_frequency);
  }
  if (tax_credit_points != null) {
    const points = parseFloat(tax_credit_points);
    if (!Number.isFinite(points) || points < 0)
      return res.status(400).json({ error: 'מספר נקודות הזיכוי לא תקין' });
    setSetting('tax_credit_points', String(points));
  }
  if (meta_sync_days != null) {
    const days = parseInt(meta_sync_days, 10);
    if (!Number.isFinite(days) || days < 1 || days > 1825)
      return res.status(400).json({ error: 'טווח סנכרון Meta חייב להיות בין 1 ל-1825 ימים' });
    setSetting('meta_sync_days', String(days));
  }
  if (meta_currency_rate != null) {
    // A rate of zero would zero every campaign, and a negative one would credit the band for
    // advertising — neither is a currency.
    const rate = parseFloat(meta_currency_rate);
    if (!Number.isFinite(rate) || rate <= 0)
      return res.status(400).json({ error: 'שער ההמרה חייב להיות מספר חיובי' });
    setSetting('meta_currency_rate', String(rate));
    // The rate multiplies every attributed figure, so the shows have to be rewritten with it.
    applyCampaignSpend();
  }
  res.json({ ok: true });
}));

/**
 * The agent's SSH connection details, as the settings form sees them.
 *
 * The private key and its passphrase are not in here — only whether one is stored, what type it
 * is and its fingerprint. See agentConfig.ts: a browser that never receives the key cannot leak
 * it, and identifying a stored key is what somebody checking the configuration actually needs.
 */
router.get('/settings/agent', requireOwner, handle((_req, res) => {
  res.json({ agent: agentConfigView(), status: agentStatus() });
}));

/**
 * Saves it. Only the fields present in the body are touched, so the form can correct the host
 * without resending the key — and an empty value is a real instruction to clear that field and
 * fall back to `AGENT_SSH_*` again, except for the two secrets (an empty box there means
 * "unchanged", and removing a stored one is asked for with clear_private_key).
 */
router.post('/settings/agent', requireOwner, handle((req, res) => {
  try {
    res.json({ agent: saveAgentConfig(req.body || {}), status: agentStatus() });
  } catch (err) {
    if (err instanceof AgentConfigError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
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
