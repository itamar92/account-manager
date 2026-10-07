/**
 * What an outside AI agent is allowed to read from this app.
 *
 * This is the whole authorization surface of the MCP server: a tool that is not in this list
 * does not exist, and every tool here is a **read**. There is deliberately no write path — not a
 * "safe" one, not a guarded one. An assistant that can tell you a client is overdue is useful; an
 * assistant that can issue an invoice because a web page it read told it to is a liability, and
 * the app's own UI is three clicks away.
 *
 * Every handler calls the same reader the browser's own screens call, so the agent and the screen
 * can never disagree about what a number is. Nothing here builds its own SQL for data that
 * already has a reader.
 */

import { db } from './db.js';
import { listClients, listInvoices, listWorks, outstandingSql } from './queries.js';
import { RECEIVABLE_DOC_TYPES_SQL } from './docTypes.js';
import { listExpenses, expenseCategories, expensesSummary } from './morningExpenses.js';
import { bandDivision, bandFollowUps, bandSummary } from './routes.js';
import { adAnalysis, listCampaigns, monthlyBreakdown, campaignDaily } from './metaSync.js';
import { assignmentsForEvent, listSuppliers, missingRoles, supplierDebts } from './assignments.js';
import { incomeTaxReport, monthlyPnl, pnlTotals, vatReport } from './reports.js';
import { annualOutlook, annualReport } from './annualReport.js';
import { depreciationSchedule } from './fixedAssets.js';
import { getBusinessDetails } from './business.js';
import { eventLabel } from './band.js';
import { lastReport } from './campaignAdvisor.js';

/** JSON Schema, written by hand — the shapes are small and the agent reads them as documentation. */
type JsonSchema = Record<string, unknown>;

export interface McpTool {
  name: string;
  /**
   * Read by the model to decide whether to call this at all, so it says *when* to reach for the
   * tool, not just what it returns. A description that only names the table gets called at random.
   */
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, any>) => unknown;
}

const NO_ARGS: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };

/** The date-range pair almost every list accepts, in the one spelling the whole server uses. */
const rangeProps = {
  from: { type: 'string', description: 'Earliest date to include, YYYY-MM-DD. Omit for no lower bound.' },
  to: { type: 'string', description: 'Latest date to include, YYYY-MM-DD. Omit for no upper bound.' },
};

const rangeSchema = (extra: Record<string, unknown> = {}): JsonSchema => ({
  type: 'object',
  properties: { ...rangeProps, ...extra },
  additionalProperties: false,
});

const yearSchema: JsonSchema = {
  type: 'object',
  properties: {
    year: { type: 'integer', description: 'Tax year, e.g. 2026. Defaults to the current year.' },
  },
  additionalProperties: false,
};

const range = (args: Record<string, any>) => ({
  from: typeof args?.from === 'string' ? args.from : undefined,
  to: typeof args?.to === 'string' ? args.to : undefined,
});

const year = (args: Record<string, any>): number => {
  const parsed = parseInt(args?.year, 10);
  return Number.isFinite(parsed) && parsed > 1970 && parsed < 3000 ? parsed : new Date().getFullYear();
};

/** A hard cap on rows per call, so one broad question cannot return the whole database. */
const MAX_ROWS = 500;

const capped = <T>(rows: T[]): { rows: T[]; count: number; truncated?: true } =>
  rows.length > MAX_ROWS
    ? { rows: rows.slice(0, MAX_ROWS), count: rows.length, truncated: true }
    : { rows, count: rows.length };

export const MCP_TOOLS: McpTool[] = [
  // ---------------------------------------------------------------- orientation

  {
    name: 'get_overview',
    description:
      'Start here. Returns what this app holds and the headline figures for a year: business ' +
      'profit and loss by month, money owed to the business, and the band\'s totals. Call this ' +
      'first when asked a broad question so you know which of the other tools to reach for.',
    inputSchema: yearSchema,
    handler: (args) => {
      const y = year(args);
      const monthly = monthlyPnl(`${y}-01-01`, `${y}-12-31`);
      return {
        year: y,
        business: getBusinessDetails(),
        profit_and_loss: { monthly, totals: pnlTotals(monthly) },
        owed_to_business: {
          // The same "still owed" the dashboard card is counted from, so the agent and the
          // screen cannot quote different figures for the same question.
          open_invoices: db
            .prepare(
              `SELECT COUNT(*) AS count, COALESCE(SUM(owed),0) AS total FROM (
                 SELECT ${outstandingSql()} AS owed FROM invoices
                 WHERE doc_type IN (${RECEIVABLE_DOC_TYPES_SQL})
               ) WHERE owed > 0`
            )
            .get(),
          uninvoiced_works: db
            .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM works WHERE status = 'unpaid'")
            .get(),
        },
        band: bandSummary(),
        currency: 'ILS',
        note:
          'All amounts are in shekels. The business side (clients, works, invoices, expenses, tax) ' +
          'is a sole proprietorship; the band side is a separate set of books for live shows.',
      };
    },
  },

  // ---------------------------------------------------------------- business

  {
    name: 'list_clients',
    description:
      'Every client, each with what they still owe: uninvoiced work and invoices issued but not ' +
      'paid. Use when asked who owes money, or to find a client id for the other tools.',
    inputSchema: NO_ARGS,
    handler: () => capped(listClients() as any[]),
  },
  {
    name: 'list_works',
    description:
      'Billable jobs (עבודות) — the atomic unit of business income, before invoicing. Statuses ' +
      'run unpaid → invoiced → paid. Use to see what work has not been billed yet.',
    inputSchema: rangeSchema({
      status: { type: 'string', enum: ['unpaid', 'invoiced', 'paid'], description: 'Narrow to one status.' },
      client_id: { type: 'string', description: 'Narrow to one client, by id from list_clients.' },
    }),
    handler: (args) =>
      capped(
        listWorks({
          ...range(args),
          status: typeof args?.status === 'string' ? args.status : undefined,
          client_id: typeof args?.client_id === 'string' ? args.client_id : undefined,
        }) as any[]
      ),
  },
  {
    name: 'list_invoices',
    description:
      'Issued documents with their client, status and totals. Each row says which document type ' +
      'it is and whether it counts as revenue — only sum rows where is_revenue is true, because a ' +
      'sale often carries a second document recording the same money.',
    inputSchema: rangeSchema({
      status: { type: 'string', enum: ['issued', 'paid', 'cancelled'], description: 'Narrow to one status.' },
    }),
    handler: (args) =>
      capped(
        listInvoices({
          ...range(args),
          status: typeof args?.status === 'string' ? args.status : undefined,
        }) as any[]
      ),
  },
  {
    name: 'list_expenses',
    description:
      'Business expenses with their category, VAT and totals for the same filters. Use for ' +
      'spending questions and for anything about deductible input VAT (מע"מ תשומות).',
    inputSchema: rangeSchema({
      category: { type: 'string', description: 'Narrow to one category — see categories in the result.' },
      status: { type: 'string', description: 'Narrow to one status.' },
    }),
    handler: (args) => {
      const filters = {
        ...range(args),
        category: typeof args?.category === 'string' ? args.category : undefined,
        status: typeof args?.status === 'string' ? args.status : undefined,
      };
      return {
        ...capped(listExpenses(filters) as any[]),
        summary: expensesSummary(filters),
        categories: expenseCategories(),
      };
    },
  },
  {
    name: 'get_tax_report',
    description:
      'Israeli tax position for a year: the מע"מ (VAT) report period by period, and the income-tax ' +
      'report with the profit it is computed from. Use for "how much do I owe", filing deadlines, ' +
      'and year-end projections.',
    inputSchema: yearSchema,
    handler: (args) => {
      const y = year(args);
      return { year: y, vat: vatReport(y), income_tax: incomeTaxReport(y) };
    },
  },

  {
    name: 'get_annual_report',
    description:
      'The דוח שנתי (Form 1301) as it is shaping up for a tax year: every income source — ' +
      'business, salary, מילואים — through the deductions, the brackets and the credits, down ' +
      'to יתרה לתשלום, which is what will actually be owed after everything already withheld ' +
      'and paid in advance. Also the reconciliation from the books\' profit to the profit the ' +
      'return is filed on (depreciation and part-recognised expenses), and the filing deadline. ' +
      'Use this — not get_tax_report — for "what will I owe", "is the return filed", "are the ' +
      'מקדמות keeping up", and anything about the annual return. Note that get_tax_report\'s ' +
      'income-tax half prices the business profit as if it were the only income there is, so it ' +
      'understates the tax badly for anyone who also draws a salary.',
    inputSchema: yearSchema,
    handler: (args) => {
      const y = year(args);
      const report = annualReport(y);
      return {
        year: y,
        // The headline first: an agent reading this wants the balance and the date before it
        // wants the ladder that produced them.
        outlook: annualOutlook(y),
        // Last year too, so "is this normal" has something to be normal against.
        previous_outlook: report.previous ? annualOutlook(y - 1) : null,
        assessment: report.current,
        depreciation: depreciationSchedule(y),
      };
    },
  },

  // ---------------------------------------------------------------- band

  {
    name: 'band_shows',
    description:
      'The band\'s live shows: venue, date, tickets sold, fee, computed expenses and profit, ' +
      'payment status, and how the profit divides between the four members. The core table of ' +
      'the band\'s books.',
    inputSchema: rangeSchema(),
    handler: (args) => {
      const r = range(args);
      const where: string[] = [];
      const params: string[] = [];
      if (r.from) { where.push('date >= ?'); params.push(r.from); }
      if (r.to) { where.push('date <= ?'); params.push(r.to); }
      const rows = db
        .prepare(
          `SELECT * FROM band_events${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC`
        )
        .all(...params) as any[];
      return capped(rows.map((e) => ({ ...e, label: eventLabel(e.venue, e.date) })));
    },
  },
  {
    name: 'band_summary',
    description:
      'The band\'s totals for a period and what each member is owed, plus the follow-up lists: ' +
      'shows whose money has not arrived, suppliers not yet paid, and upcoming shows with nobody ' +
      'staffed. Use for "how is the band doing" and "what needs chasing".',
    inputSchema: rangeSchema(),
    handler: (args) => ({
      summary: bandSummary(range(args)),
      division: bandDivision(range(args)),
      follow_ups: bandFollowUps(),
    }),
  },
  {
    name: 'band_assignments',
    description:
      'Who is staffed on which show (per supplier role: lighting, sound, singer, PA company…), the supplier ' +
      'list, what each supplier is still owed, and which upcoming shows are missing a required role.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'One show, by id from band_shows. Omit for all suppliers and debts.' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      if (typeof args?.event_id === 'string' && args.event_id) {
        return {
          event_id: args.event_id,
          assignments: assignmentsForEvent(args.event_id),
          missing_roles: missingRoles(args.event_id),
        };
      }
      return {
        suppliers: listSuppliers(),
        debts: [...supplierDebts().entries()].map(([supplier, debt]) => ({ supplier, ...debt })),
      };
    },
  },

  // ---------------------------------------------------------------- advertising

  {
    name: 'band_ad_analysis',
    description:
      'What each show\'s Meta (Facebook/Instagram) promotion cost, against the tickets it sold and ' +
      'the fee it earned: ad spend, cost per ticket, spend as a share of revenue, clicks. Use for ' +
      'any question about whether advertising is paying for itself.',
    inputSchema: rangeSchema(),
    handler: (args) => {
      const r = range(args);
      return { ...adAnalysis(r), monthly_invoices: monthlyBreakdown(r).months };
    },
  },
  {
    name: 'band_campaigns',
    description:
      'The Meta ad campaigns themselves — name, objective, status, spend, impressions, clicks, ' +
      'reach, and which shows each one is mapped to. Pass campaign_id for that campaign\'s ' +
      'day-by-day spend curve, which is what says whether the money went out in time to sell a ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'One campaign\'s daily spend, by id from this same tool.' },
        unmapped_only: { type: 'boolean', description: 'Only campaigns not yet tied to a show.' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      if (typeof args?.campaign_id === 'string' && args.campaign_id) {
        return { campaign_id: args.campaign_id, daily: campaignDaily(args.campaign_id) };
      }
      return capped(listCampaigns({ unmappedOnly: args?.unmapped_only === true }));
    },
  },
  {
    name: 'band_campaign_advice',
    description:
      'The most recent verdict from the app\'s own in-app campaign advisor for a period, if one has ' +
      'been produced: findings and ranked suggestions. Read-only — this returns a stored report and ' +
      'never starts a new analysis.',
    inputSchema: rangeSchema(),
    handler: (args) => ({ report: lastReport('analysis', range(args)) }),
  },
];

export const TOOLS_BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));

/** The server's own description, shown to the agent once at connect time. */
export const MCP_SERVER_INFO = {
  name: 'account-manager',
  version: '1.0.0',
  instructions:
    'Read-only access to a small business\'s accounting app: a sole proprietorship (clients, billable works, ' +
    'invoices, expenses, Israeli VAT and income tax) and the band workspace, a live band with its own books ' +
    '(shows, expenses, staffing, Meta ad campaigns). All amounts are in shekels (ILS) and all dates ' +
    'are YYYY-MM-DD. Call get_overview first for orientation. Nothing here can change data — when ' +
    'the answer is that something should be created or paid, say so and let the user do it in the app.',
};
