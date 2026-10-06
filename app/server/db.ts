import Database from 'better-sqlite3';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'account-manager.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- password / token helpers ----------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','band')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  tax_id TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  doc_type INTEGER NOT NULL DEFAULT 305, -- חשבונית מס; see server/docTypes.ts
  client_id TEXT NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL,
  due_date TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','paid','cancelled')),
  paid_date TEXT,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL,
  month TEXT,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  vat_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','invoiced','paid')),
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Expense documents received from suppliers (הוצאות), pulled from Morning. Amounts are in
-- shekels: amount before VAT, vat_amount the input VAT that can be reclaimed, total what was
-- actually paid. The currency column records what the supplier billed in, for a row whose
-- figures were converted on the way in.
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  number TEXT,
  doc_type INTEGER,
  date TEXT NOT NULL,
  payment_date TEXT,
  -- The מע"מ period Morning files the expense under. Set on the expense in Morning and not
  -- derived from the document date: an invoice dated the 20th of August can be reported in July.
  reporting_date TEXT,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_tax_id TEXT,
  external_supplier_id TEXT,
  category TEXT,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  -- What Morning says may actually be set against the books, after the deduction percentage
  -- on the expense's classification. Equal to amount/vat_amount for an expense deducted in
  -- full, smaller for a phone bill at 80% or a car. NULL means Morning did not state it, and
  -- every sum COALESCEs back to the full figure — which is what this app did before it read
  -- these at all, so a payload without them keeps behaving as it used to.
  deductible_amount REAL,
  deductible_vat REAL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  -- 'unknown' is Morning not having said: a payload carrying no reported/status field this
  -- app recognises is left undetermined rather than called open, which is what once showed
  -- an account's every filed expense as טרם דווח.
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('open','reported','unknown')),
  source TEXT NOT NULL DEFAULT 'morning',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which tax periods have already been filed and paid. The reports themselves are computed
-- from the invoices and expenses every time they are opened, so nothing about the numbers
-- lives here — only the decision that a period is done with, which no other table knows.
-- period_key is the report's own key: '2026-P2' for a מע"מ period, '2026' for a year.
CREATE TABLE IF NOT EXISTS tax_filings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('vat','income_tax')),
  period_key TEXT NOT NULL,
  filed_at TEXT,
  paid_at TEXT,
  amount REAL,
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, period_key)
);

-- The declared half of the annual return (טופס 1301): salary, מילואים, deposits, what was
-- withheld at source and what was paid in advance. None of it can be discovered from the
-- business's own documents — it comes off טופס 106, the ביטוח לאומי certificate and the
-- קופות' annual statements — so it is entered once a year and kept per tax year.
-- The *_allowed columns hold what an assessment actually let through, where that is known;
-- NULL means it was never stated and the report falls back to its own estimate.
CREATE TABLE IF NOT EXISTS annual_tax_profile (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  salary REAL NOT NULL DEFAULT 0,
  salary_withheld REAL NOT NULL DEFAULT 0,
  miluim REAL NOT NULL DEFAULT 0,
  miluim_withheld REAL NOT NULL DEFAULT 0,
  other_income REAL NOT NULL DEFAULT 0,
  other_withheld REAL NOT NULL DEFAULT 0,
  business_income_override REAL,
  keren_hishtalmut_paid REAL NOT NULL DEFAULT 0,
  keren_hishtalmut_allowed REAL,
  pension_atzmai_paid REAL NOT NULL DEFAULT 0,
  pension_atzmai_allowed REAL,
  ni_paid REAL NOT NULL DEFAULT 0,
  pension_sachir_paid REAL NOT NULL DEFAULT 0,
  pension_sachir_allowed REAL,
  life_insurance_paid REAL NOT NULL DEFAULT 0,
  donations_paid REAL NOT NULL DEFAULT 0,
  mikdamot_paid REAL NOT NULL DEFAULT 0,
  credit_points_override REAL,
  -- Whether to apply this app's own recognition rates on top of Morning's. Off leaves the
  -- profit exactly as the books have it; on brings it closer to what an assessor will allow.
  apply_recognition_rates INTEGER NOT NULL DEFAULT 1,
  -- When this year's return is actually due. Left empty the report falls back to the online
  -- filing date; a filer represented by a CPA usually has a later date from the מייצגים quota,
  -- and only they know what it is.
  file_by TEXT,
  notes TEXT,
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- רכוש קבוע: what the books expensed on purchase and the return depreciates over years.
-- The tax side of the same documents, kept apart from them because the two answers are both
-- correct and differ only in timing. opening_accumulated is פחת שנצבר as a 1342 stated it at
-- the end of opening_year; every year after that is computed forward from it, so a schedule
-- seeded from a real form stays exactly in step with one.
CREATE TABLE IF NOT EXISTS fixed_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_group TEXT NOT NULL DEFAULT '',
  purchase_date TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0.15,
  opening_accumulated REAL NOT NULL DEFAULT 0,
  opening_year INTEGER,
  -- Whether the P&L already deducted the purchase in full, which decides whether the
  -- reconciliation has to add it back. An asset bought before this app existed never did.
  deducted_in_books INTEGER NOT NULL DEFAULT 1,
  disposed_date TEXT,
  expense_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS band_events (
  id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  date TEXT NOT NULL,
  calendar_event_id TEXT,
  location TEXT,
  tickets INTEGER NOT NULL DEFAULT 0,
  amount_pre_vat REAL NOT NULL DEFAULT 0,
  amount_with_vat REAL NOT NULL DEFAULT 0,
  expenses REAL NOT NULL DEFAULT 0,
  expenses_paid REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  receiver TEXT,
  invoice TEXT,
  has_commission INTEGER NOT NULL DEFAULT 0,
  commission_amount REAL NOT NULL DEFAULT 0,
  paid_to_musicians INTEGER NOT NULL DEFAULT 0,
  amir REAL NOT NULL DEFAULT 0,
  itamar REAL NOT NULL DEFAULT 0,
  yuval REAL NOT NULL DEFAULT 0,
  guy REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS band_event_expenses (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  status TEXT,
  tickets INTEGER NOT NULL DEFAULT 0,
  campaign REAL NOT NULL DEFAULT 0,
  refreshments REAL NOT NULL DEFAULT 0,
  design REAL NOT NULL DEFAULT 0,
  other REAL NOT NULL DEFAULT 0,
  expense_amount REAL NOT NULL DEFAULT 0,
  paid_by TEXT,
  akom REAL NOT NULL DEFAULT 0, akom_paid INTEGER NOT NULL DEFAULT 0,
  hall_fee REAL NOT NULL DEFAULT 0, hall_fee_paid INTEGER NOT NULL DEFAULT 0,
  sound_company REAL NOT NULL DEFAULT 0, sound_company_paid INTEGER NOT NULL DEFAULT 0,
  bracelets REAL NOT NULL DEFAULT 0, bracelets_paid INTEGER NOT NULL DEFAULT 0,
  lightman REAL NOT NULL DEFAULT 0, lightman_paid INTEGER NOT NULL DEFAULT 0,
  soundman REAL NOT NULL DEFAULT 0, soundman_paid INTEGER NOT NULL DEFAULT 0,
  singer REAL NOT NULL DEFAULT 0, singer_paid INTEGER NOT NULL DEFAULT 0,
  vat_summary REAL NOT NULL DEFAULT 0,
  total_paid REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS band_general_expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  event TEXT,
  paid_by TEXT,
  amount REAL NOT NULL DEFAULT 0,
  amir REAL NOT NULL DEFAULT 0, amir_returned TEXT,
  itamar REAL NOT NULL DEFAULT 0, itamar_returned TEXT,
  yuval REAL NOT NULL DEFAULT 0, yuval_returned TEXT,
  fund REAL NOT NULL DEFAULT 0, fund_returned TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The band's regular suppliers: who answers to each email, and in what role. The role keys
-- are the expense-row columns that pay them (lightman, soundman, singer, sound_company),
-- which is what ties an assignment to the money it costs.
-- The kinds of supplier the band hires, decided by the band rather than by this file.
--
-- A role is a cost line on a show wearing a name: staffing somebody on it says who that line
-- pays, which is what lets one transfer settle four gigs and wait for one invoice. The four
-- roles this app shipped with — תאורן, סאונדמן, זמר/ת, חברת הגברה — were a list in the source,
-- so the bracelets company, א.ק.ו.ם and the hall could be *costs* but never *somebody you pay*:
-- no supplier, no payment, no invoice chased. They are rows now, and so is anything else the
-- band decides to hire.
--
-- The key is the expense-row column the role is paid out of, which is why a role cannot be
-- invented from nothing: the money has to land somewhere that already exists. «required» is
-- the "you forgot someone" signal on a show; «active» is whether the band uses this role at
-- all — deactivating hides it from the staffing without touching a single show that already
-- used it.
CREATE TABLE IF NOT EXISTS band_supplier_roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS band_suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  -- The role's key in band_supplier_roles. No foreign key: a role that is renamed or retired
  -- must not take the suppliers hired under it with it.
  role TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  -- What this supplier usually charges for one show. Staffing them on a role writes it into
  -- that show's cost line, so the fee arrives with the name instead of being typed after it.
  -- 0 means "no standing rate", and nothing is pre-filled.
  default_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_band_suppliers_email
  ON band_suppliers(email) WHERE email IS NOT NULL AND email != '';

-- The names a supplier's documents actually arrive under.
--
-- The band calls somebody «אבי סאונד»; the invoice is headed «א. כהן הפקות בע"מ», and nothing
-- in either name tells a computer they are one business. This table is where a person says so
-- once, so every document that supplier ever issues is recognised without being asked about
-- again — which is the whole reason it is a table of its own rather than a free-text field:
-- the mapping is the thing being maintained, and it needs to be listable, addable from the
-- place the mistake shows up, and unique.
--
-- normalized is what the match is made on (see normalizeName): quotes, geresh, the legal
-- suffix and the punctuation around them dropped. It is unique across every supplier, because
-- one invoice name pointing at two suppliers is not a mapping — it is a coin toss, and the
-- link it produces would put a document against money it has nothing to do with.
--
-- source records who said so: 'manual' typed into the names screen or the supplier dialog,
-- 'link' learned when a document was attached to a payment by hand, 'migration' carried over
-- from the aliases column this table replaced.
CREATE TABLE IF NOT EXISTS band_supplier_aliases (
  id TEXT PRIMARY KEY,
  -- Whose name this is: a supplier, or a member of the band invoicing their own share.
  supplier_id TEXT REFERENCES band_suppliers(id) ON DELETE CASCADE,
  member_key TEXT,
  alias TEXT NOT NULL,
  normalized TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','link','migration')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((supplier_id IS NOT NULL) + (member_key IS NOT NULL) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_band_supplier_aliases_normalized
  ON band_supplier_aliases(normalized);
CREATE INDEX IF NOT EXISTS idx_band_supplier_aliases_supplier
  ON band_supplier_aliases(supplier_id);

-- The band itself: who is in it, what they do, and — the part the money cares about — what
-- kind of business each one runs. A member who is an עוסק מורשה hands back a חשבונית מס whose
-- מע"מ can be reclaimed; an עוסק פטור hands back an invoice that is deductible but carries
-- none; a member registered as nothing at all hands back nothing that can be deducted.
--
-- member_key is what ties a row here to that member's shares in band_event_shares. It is
-- generated once and never changes, so a member can be renamed without orphaning a single
-- show they played.
-- What each member takes home from one show. This is the authoritative division: it replaced
-- the amir/itamar/yuval/guy columns on band_events, which is what capped the band at exactly
-- those four people. A row per member per show means the roster can grow, shrink, or be
-- renamed without touching the schema.
--
-- The old columns are still on band_events and are deliberately left there: they are the
-- source the backfill read from, and freezing them rather than dropping them keeps a way back
-- if a division ever looks wrong. Nothing writes them any more — moonlight_shares_v1 in
-- settings marks the moment they stopped being the truth.
CREATE TABLE IF NOT EXISTS band_event_shares (
  event_id TEXT NOT NULL,
  member_key TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, member_key)
);

CREATE INDEX IF NOT EXISTS idx_band_event_shares_event ON band_event_shares(event_id);

CREATE TABLE IF NOT EXISTS band_members (
  id TEXT PRIMARY KEY,
  member_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  -- What they do in the band — instrument, vocals, whatever the band calls it. Free text.
  role TEXT,
  -- A manager runs the band's business as well as playing in it; the producer fee is split
  -- between the managers, which is what makes the band's 30/30/20/20 the shape it is.
  is_manager INTEGER NOT NULL DEFAULT 0,
  business_type TEXT NOT NULL DEFAULT 'none'
    CHECK (business_type IN ('patur', 'morshe', 'none')),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Who is staffed on each show, one row per role. supplier_id NULL with not_needed = 1 is an
-- explicit "this show has no sound company"; no row at all means nobody decided yet, which
-- is what the missing-staff alert looks for.
CREATE TABLE IF NOT EXISTS band_event_assignments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  role TEXT NOT NULL,
  supplier_id TEXT,
  not_needed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','calendar')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, role)
);

-- ============ paying suppliers, and the documents that should come back ============
--
-- A payment is its own row rather than a flag on a cost line, because one transfer routinely
-- settles several shows at once: אבי is paid ₪3,000 covering four gigs, and «did his invoice
-- arrive?» is a question about that transfer, not about any one of the four. The _paid
-- columns on band_event_expenses stay exactly what they were — every reader of them keeps
-- working — but they are now the *consequence* of a payment row rather than the record of it.
--
-- The resolution column is how a payment leaves the queue without a document being found: 'verified'
-- for one settled before this table existed (or confirmed by hand outside the app), and
-- 'not_required' for money that legitimately produces no invoice. NULL means still open, and
-- an open payment is either covered by its linked documents or waiting for them. Without
-- these two the queue would fill with rows that can never close, and a list that is
-- permanently red is a list nobody opens.
--
-- Who was paid is either a supplier or a member of the band, and exactly one of the two
-- columns says which. A member's share is money leaving the band for somebody who, if they are
-- an עוסק, owes it an invoice back — the same question about the same money, so it belongs in
-- the same queue rather than in a parallel one that would have to be read beside it.
CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES band_suppliers(id) ON DELETE CASCADE,
  -- band_members.member_key. No foreign key, deliberately: a member who leaves is marked
  -- inactive rather than deleted, and the payments the band made them are its own history.
  member_key TEXT,
  date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  method TEXT,
  notes TEXT,
  -- Whether a document is expected back at all. Copied from the supplier when the payment is
  -- recorded, so changing the supplier's policy later does not silently reopen settled money.
  expects_invoice INTEGER NOT NULL DEFAULT 1,
  resolution TEXT CHECK (resolution IN ('verified','not_required')),
  -- 'manual' is a payment recorded through the pay-supplier dialog; 'line' is one the app
  -- created when a cost line was ticked paid on a show; 'backfill' is one the migration
  -- synthesised from a line that was already paid before payments were recorded at all.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','line','backfill')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Exactly one payee. A table constraint rather than a column one, because it is a
  -- fact about the pair; SQLite wants those after every column has been declared.
  CHECK ((supplier_id IS NOT NULL) + (member_key IS NOT NULL) = 1)
);

-- Which cost lines one transfer settled — the multi-show part. The amount is stored per line
-- rather than only as the payment's total, because the shows pay different fees and the
-- payment is their exact sum.
--
-- The unique index is the invariant that keeps the two representations honest: a cost line is
-- settled by at most one payment, so a show's per-role paid flag and a line row here can never
-- disagree about who paid for what.
-- A line is one show's cost line (role) or one member's share of that show (member_key),
-- exactly one of the two — the same distinction the payment itself carries.
CREATE TABLE IF NOT EXISTS supplier_payment_lines (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES band_events(id) ON DELETE CASCADE,
  role TEXT,
  member_key TEXT,
  amount REAL NOT NULL DEFAULT 0,
  CHECK ((role IS NOT NULL) + (member_key IS NOT NULL) = 1)
);

-- The indexes this table needs are created after the migration below rather than here: one of
-- them is on member_key, and this statement also runs against a database whose lines table
-- has not been rebuilt yet — where indexing a column that does not exist is a hard error
-- before the migration gets its chance.

-- The documents that answer for a payment: rows of the Morning expense table, linked.
--
-- It is a link table rather than a column on either side because the relationship is
-- genuinely many-to-many, and every one of the four shapes happens: one payment answered by
-- one invoice, one payment answered by several (the supplier bills per gig and is paid
-- monthly), several payments answered by one (an advance and a balance), and an invoice that
-- arrived before the payment it belongs to. allocated_amount is what this document covers
-- of this payment, so a partly-documented transfer can say so instead of having to claim it
-- is either finished or untouched.
--
-- expense_id deliberately carries no foreign key. The expenses table is a mirror of Morning
-- and has been rebuilt in place by a migration once already (see below, where it is copied
-- into expenses_migrating and renamed back). A DROP of the referenced table with
-- foreign_keys = ON cascades, which would take every link here with it — the rows would be
-- gone before anyone noticed the schema had been tidied. Nothing deletes an expense in normal
-- use (the sync upserts on external_id), and a link left pointing at a row that no longer
-- exists is pruned rather than cascaded.
CREATE TABLE IF NOT EXISTS supplier_payment_docs (
  payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  expense_id TEXT NOT NULL,
  allocated_amount REAL NOT NULL DEFAULT 0,
  matched_by TEXT NOT NULL DEFAULT 'user' CHECK (matched_by IN ('auto','user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (payment_id, expense_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id, date);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_docs_expense ON supplier_payment_docs(expense_id);

-- Which calendar events to draw, and where they land. One row per rule so a second
-- freelance client (its own organizer, its own ignore words) is configuration, not code.
CREATE TABLE IF NOT EXISTS calendar_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('band','personal')),
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  keywords TEXT NOT NULL DEFAULT '',      -- comma separated; matched in title + description
  organizers TEXT NOT NULL DEFAULT '',    -- comma separated emails; for events you were invited to
  ignore_words TEXT NOT NULL DEFAULT '',  -- comma separated; wins over every include rule
  client_name TEXT,                       -- personal target: which client the work belongs to
  -- Personal target: the agreed price per event for this client. 0 means "no fixed price",
  -- which leaves the created work at 0 for you to price by hand.
  fixed_amount REAL NOT NULL DEFAULT 0,
  skip_declined INTEGER NOT NULL DEFAULT 1,
  -- Off by default: descriptions hold running orders ("20:30 הופעה") that look like
  -- keywords but say nothing about whose show it is.
  match_description INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Manual decisions about individual events, which beat whatever the rules say. Rules are
-- patterns and will always be slightly wrong at the edges; this is the escape hatch that
-- stops a re-sync from undoing a correction.
CREATE TABLE IF NOT EXISTS calendar_event_overrides (
  event_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('exclude','include')),
  rule_id TEXT,           -- 'include' only: which rule should draw it
  summary TEXT,           -- kept so the overrides list is readable without the calendar
  event_date TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Meta (Facebook/Instagram) ad campaigns ----------
-- The campaigns as Meta reports them, refreshed by each sync. Cached locally so the
-- cost-per-show analysis reads the database rather than the Graph API, and so a campaign
-- keeps its history after Meta's own reporting window has moved on.
CREATE TABLE IF NOT EXISTS meta_campaigns (
  id TEXT PRIMARY KEY,                    -- Meta's campaign id
  account_id TEXT NOT NULL,               -- the act_… it was read from
  name TEXT NOT NULL,
  status TEXT,                            -- ACTIVE / PAUSED / …
  objective TEXT,
  first_spend_date TEXT,                  -- first and last day with spend in the synced window,
  last_spend_date TEXT,                   -- which is what the show suggester matches on
  spend REAL NOT NULL DEFAULT 0,          -- total over the synced window, in the currency below
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  synced_at TEXT
);

-- Spend day by day. Attribution does not need it — an explicit mapping decides which show a
-- campaign paid for — but the run-up curve is what says whether the money went out in time
-- to sell a ticket, and a campaign's own window is derived from it.
CREATE TABLE IF NOT EXISTS meta_campaign_daily (
  campaign_id TEXT NOT NULL,
  date TEXT NOT NULL,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, date)
);

-- Which campaigns paid for which show, decided by hand. Many-to-many in both directions: a
-- show is often promoted by two campaigns (early-bird and last push), and one campaign is
-- often run across a whole tour.
--
-- The weight column is how a shared campaign is divided. Shares are computed as weight over sum of
-- the campaign's weights, so the default of 1 everywhere splits it equally and stays correct
-- when a fourth show is added to a campaign that had three — nothing needs recomputing.
CREATE TABLE IF NOT EXISTS meta_campaign_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_events_event ON meta_campaign_events(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaign_daily_date ON meta_campaign_daily(date);

-- ---------- AI campaign advisor ----------
-- What the agent answered, kept rather than recomputed. A run goes over SSH to another machine
-- and takes a minute or two, so the tab paints the last report and asks for a new one only when
-- somebody presses the button. The request is stored beside the response because a report is
-- only readable against the question it answered — a verdict on "2026" means nothing once the
-- period selector has moved on.
CREATE TABLE IF NOT EXISTS ai_campaign_reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                     -- 'analysis' (a period) | 'draft' (one show)
  range_from TEXT,
  range_to TEXT,
  event_id TEXT,                          -- the show a draft is for; null for an analysis
  request TEXT NOT NULL,                  -- JSON: what was asked
  response TEXT NOT NULL,                 -- JSON: what came back, already parsed and validated
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Follow-up questions. Separate from the reports because a conversation is appended to and a
-- report is replaced, and mixing the two makes "the latest one" ambiguous.
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,                     -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_reports_kind ON ai_campaign_reports(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_chat_thread ON ai_chat_messages(thread_id, created_at);

-- The ads underneath the campaigns, for what they *said*. Spend is read at campaign level and
-- stays there; this table exists so the advisor can write a new ad in the voice of the old ones
-- and see which wording sat on the campaigns that sold tickets cheaply.
CREATE TABLE IF NOT EXISTS meta_ads (
  id TEXT PRIMARY KEY,                    -- Meta's ad id
  campaign_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  primary_text TEXT,                      -- the body above the image or video
  headline TEXT,
  description TEXT,
  call_to_action TEXT,
  link_url TEXT,
  created_time TEXT,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign ON meta_ads(campaign_id);

-- ---------- campaign tasks ----------
-- The follow-ups a campaign plan implies ("a week in, compare spend to tickets sold"), turned
-- into dated rows somebody is reminded of by email. One owner per show rather than per task:
-- a show's promotion is one person's job, and the reminders follow that person.
CREATE TABLE IF NOT EXISTS campaign_task_owners (
  event_id TEXT PRIMARY KEY,
  member_key TEXT NOT NULL                -- band_members.member_key
);

CREATE TABLE IF NOT EXISTS campaign_tasks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  due_date TEXT NOT NULL,                 -- YYYY-MM-DD, Israel time
  done_at TEXT,                           -- NULL while open
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  report_id TEXT,                         -- the draft an AI task came from
  -- Opens the one-click "done" page linked from the reminder email. It closes this task and
  -- nothing else, so whoever the email was forwarded to can do no more than that.
  done_token TEXT NOT NULL UNIQUE,
  -- The Israel-time date of the last reminder sent, and how many went out. The scheduler sends
  -- on the due date and every REMINDER_REPEAT_DAYS after while the task stays open.
  last_reminded_on TEXT,
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_campaign_tasks_event ON campaign_tasks(event_id, due_date);
CREATE INDEX IF NOT EXISTS idx_campaign_tasks_due ON campaign_tasks(done_at, due_date);

-- ---------- Moonlight quotes (docs/QUOTES-DESIGN.md) ----------
-- A price quote for a show. A template is a row of the same table with is_template = 1: the
-- usual intro, lines and terms, with no client, number or validity of its own, so it is
-- edited in the same editor and a new quote is a copy of it with three fields filled in.
--
-- The signature columns are written once, by the client's signing, and never again; the
-- snapshot beside them is the quote exactly as it was shown when it was signed.
CREATE TABLE IF NOT EXISTS band_quotes (
  id TEXT PRIMARY KEY,
  is_template INTEGER NOT NULL DEFAULT 0,
  template_name TEXT,
  quote_number TEXT UNIQUE,               -- ML-2026-001; NULL on a template
  public_token TEXT UNIQUE,               -- the client's link; set when first sent
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','viewed','signed','cancelled')),
  client_name TEXT NOT NULL DEFAULT '',
  client_phone TEXT,
  client_email TEXT,
  client_tax_id TEXT,
  event_type TEXT,
  event_date TEXT,                        -- YYYY-MM-DD
  event_location TEXT,
  guest_count INTEGER,
  show_duration TEXT,                     -- free text, as the client reads it: «כ־40 דקות»
  title TEXT NOT NULL DEFAULT '',
  intro TEXT,
  terms TEXT,
  valid_until TEXT,                       -- YYYY-MM-DD; NULL on a template
  contact_name TEXT,
  contact_phone TEXT,
  internal_note TEXT,                     -- never shown to the client
  prices_include_vat INTEGER NOT NULL DEFAULT 0,
  vat_percent REAL NOT NULL,              -- frozen when the quote is made
  discount REAL NOT NULL DEFAULT 0,
  deposit_percent REAL,                   -- of the quote's price; NULL = no deposit
  subtotal REAL NOT NULL DEFAULT 0,
  net_amount REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  show_id TEXT REFERENCES band_events(id) ON DELETE SET NULL,
  show_link_status TEXT,                  -- what signing did about the show: created/linked/choose/error
  show_amount_ok INTEGER NOT NULL DEFAULT 0, -- the band kept the show's own amount over the quote's
  signed_seen_at TEXT,                    -- first opened by the band after signing; until then it is news
  calendar_id TEXT,                       -- the quote's «אופציה» event, on the band rule's calendar
  calendar_event_id TEXT,
  calendar_event_title TEXT,              -- as last written by the app, to tell an option from a booking
  calendar_event_link TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  sent_at TEXT,
  first_viewed_at TEXT,
  last_viewed_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  signed_at TEXT,
  signer_name TEXT,
  signature_png TEXT,
  signer_ip TEXT,
  signer_user_agent TEXT,
  signed_snapshot TEXT,
  signed_snapshot_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A quote's lines. A line picked from a package is a copy of it: changing the price list
-- later must not reprice a quote somebody has already been sent.
CREATE TABLE IF NOT EXISTS band_quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES band_quotes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  package_id TEXT
);

-- The price list lines are picked from.
CREATE TABLE IF NOT EXISTS band_quote_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Images and files for quotes: the band's logo and the owner's signature (quote_id NULL), and
-- later a quote's own attachments. Kept in the database rather than beside it, because the
-- nightly backup copies the database file and nothing else — a logo on disk would be the one
-- thing a restore came back without.
CREATE TABLE IF NOT EXISTS band_quote_files (
  id TEXT PRIMARY KEY,
  quote_id TEXT REFERENCES band_quotes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('attachment','logo','cover','signature')),
  filename TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_band_quote_items_quote ON band_quote_items(quote_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_band_quotes_list ON band_quotes(is_template, created_at);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_works_client ON works(client_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ---------- migrations for databases created before a column existed ----------
function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('band_events', 'calendar_event_id', 'TEXT');
addColumnIfMissing('band_events', 'location', 'TEXT');
addColumnIfMissing('works', 'calendar_event_id', 'TEXT');
addColumnIfMissing('works', 'location', 'TEXT');
addColumnIfMissing('calendar_rules', 'match_description', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('calendar_rules', 'fixed_amount', 'REAL NOT NULL DEFAULT 0');
// 'auto' recomputes the four member shares from the profit on every write; 'manual' is set
// the moment someone types a share by hand, and freezes them until they ask for auto back.
addColumnIfMissing('band_events', 'division_mode', "TEXT NOT NULL DEFAULT 'auto'");
// The link a show's expense row used to express as the free-text label "מקום - DD/MM/YYYY".
addColumnIfMissing('band_event_expenses', 'event_id', 'TEXT');
// Where a show's money has got to: waiting for the venue's report, invoiced, in the private
// account, or moved on from there into the band's own account.
addColumnIfMissing('band_events', 'payment_status', "TEXT NOT NULL DEFAULT 'waiting_report'");
// What was actually moved into the band's account when the show reached «הכסף הועבר לקופה».
// It is stored rather than recomputed because it is the sum that was added to the recorded
// balance: only the same sum can be taken out again if the step is undone. NULL means nothing
// was ever added on this show's account — including the shows the migration marked, whose
// transfers happened long before the step existed and are already in the balance.
addColumnIfMissing('band_events', 'fund_transfer_amount', 'REAL');
addColumnIfMissing('band_general_expenses', 'paid', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('band_general_expenses', 'event_id', 'TEXT');
// A name typed by hand outranks the calendar. Set the moment someone renames a synced show or
// work, and from then on the sync updates its date and place but leaves the name alone.
addColumnIfMissing('band_events', 'venue_locked', 'INTEGER NOT NULL DEFAULT 0');
// The show's calendar guest list, as a JSON array of emails — what the staffing matcher reads.
addColumnIfMissing('band_events', 'attendees', 'TEXT');
// What the producer fee is worth on this show, as a percentage of its profit. Per show,
// because that is a decision about the show; 20 (the default) nets the band's 30/30/20/20.
addColumnIfMissing('band_events', 'commission_percent', 'REAL NOT NULL DEFAULT 20');
addColumnIfMissing('works', 'description_locked', 'INTEGER NOT NULL DEFAULT 0');
// What Morning says a document still has outstanding (its `amountOpened`). A tax invoice is
// settled by a receipt raised against it, which closes it in Morning without changing anything
// about the invoice itself — so what is still owed is a figure to be read rather than inferred.
// NULL means nobody has said: an invoice raised here has never been to Morning, and rows synced
// before this column existed only learn their figure on the next sync.
addColumnIfMissing('invoices', 'open_amount', 'REAL');
// A quote's deposit, as a share of its price rather than a sum typed into its terms.
addColumnIfMissing('band_quotes', 'deposit_percent', 'REAL');
// The Morning payload a synced expense was mapped from. Kept so a field Morning spells
// differently than expected can be seen in the data instead of guessed at — reading the
// classification object as a scalar once wrote "[object Object]" into every category, and
// there was nothing stored to diagnose it from.
// Added after the annual report shipped, so a database created with the first version of the
// table gets the toggle rather than failing every read of it.
addColumnIfMissing('annual_tax_profile', 'apply_recognition_rates', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('annual_tax_profile', 'file_by', 'TEXT');
addColumnIfMissing('expenses', 'raw', 'TEXT');
// Morning's `reportingDate` — see the column comment above.
addColumnIfMissing('expenses', 'reporting_date', 'TEXT');
// What of an expense is deductible — see the column comments above. Nullable on purpose:
// NULL is "Morning did not say", which is not the same as nothing being deductible.
addColumnIfMissing('expenses', 'deductible_amount', 'REAL');
addColumnIfMissing('expenses', 'deductible_vat', 'REAL');
// A קמפיין figure typed by hand outranks the Meta sync, the same way a renamed show outranks
// the calendar. Set the moment someone edits the cell; from then on the sync reports the row
// as held back rather than overwriting it, until the lock is handed back.
addColumnIfMissing('band_event_expenses', 'campaign_locked', 'INTEGER NOT NULL DEFAULT 0');
// How many tickets the room holds. Nothing is derived from it — it exists so the tickets sold
// can be read as a proportion ("318 מתוך 420") instead of a bare number, which is the only way
// to tell a full small room from an empty large one. 0 means nobody has said.
addColumnIfMissing('band_events', 'capacity', 'INTEGER NOT NULL DEFAULT 0');
// A supplier's standing fee, pre-filled onto the cost line of every show they are staffed on.
// 0 (the default, and what every supplier entered before this column had) means nobody has
// said what they charge, and the cost line is left to be typed by hand as before.
addColumnIfMissing('band_suppliers', 'default_amount', 'REAL NOT NULL DEFAULT 0');

// What ties a supplier here to the documents they issue in Morning. The email that staffs
// them off the calendar is not the same identifier: an invoice carries a business, not a
// mailbox. The tax id is the strong match — two businesses cannot share one — and the Morning
// supplier id is stronger still where Morning has one, so a document matched on either is
// safe to link without asking.
//
// The names an invoice may be headed with moved out to band_supplier_aliases, where one of
// them can be added from the screen that noticed it was missing and can never point at two
// suppliers at once. The `aliases` column is frozen rather than dropped: it is what the
// migration read from, and keeping it is the way back if a mapping ever looks wrong. Nothing
// reads it any more — moonlight_supplier_aliases_v1 in settings marks when it stopped being
// the truth.
addColumnIfMissing('band_suppliers', 'tax_id', 'TEXT');
addColumnIfMissing('band_suppliers', 'morning_supplier_id', 'TEXT');
addColumnIfMissing('band_suppliers', 'aliases', 'TEXT');
// Whether this supplier hands back a document at all. On by default, because most do — but
// א.ק.ו.ם, a hall that nets its fee out of the door, and anyone paid against a receipt that
// reaches Morning under another name would otherwise sit in the queue for ever.
addColumnIfMissing('band_suppliers', 'expects_invoice', 'INTEGER NOT NULL DEFAULT 1');

// What ties a member to the documents they issue, exactly as for a supplier. A member who is
// an עוסק invoices the band for their share, and that invoice is headed with their business —
// which is neither their name in the band nor the mailbox the calendar knows them by.
addColumnIfMissing('band_members', 'tax_id', 'TEXT');
addColumnIfMissing('band_members', 'morning_supplier_id', 'TEXT');
// How long the band plays — the one blank the old Google Docs quote had that a quote did not.
addColumnIfMissing('band_quotes', 'show_duration', 'TEXT');
// A signed quote becoming a show (docs/QUOTES-DESIGN.md, «Signing becomes a show»).
addColumnIfMissing('band_quotes', 'show_link_status', 'TEXT');
addColumnIfMissing('band_quotes', 'show_amount_ok', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('band_quotes', 'signed_seen_at', 'TEXT');
// The quote's own calendar event — the way its show comes into being (server/quoteCalendar.ts).
addColumnIfMissing('band_quotes', 'calendar_id', 'TEXT');
addColumnIfMissing('band_quotes', 'calendar_event_id', 'TEXT');
addColumnIfMissing('band_quotes', 'calendar_event_title', 'TEXT');
addColumnIfMissing('band_quotes', 'calendar_event_link', 'TEXT');

// That bad value is cleared here rather than left for the next sync: the sync only refreshes
// its own window (90 days by default), so anything older would keep a category that is not a
// category, in the list and in the filter. Cleared rows read as ללא סיווג until re-synced.
db.prepare("UPDATE expenses SET category = NULL WHERE category = '[object Object]'").run();

// The deduction figures are backfilled from the payloads already stored rather than waited
// for: a sync only refreshes its own window (90 days by default), so without this an older
// expense would keep claiming its full VAT until something happened to re-sync it, and the
// year's מע"מ figure would be part-corrected — worse than either state on its own. Rows whose
// payload predates the `raw` column, or whose Morning payload states no deduction, are left
// null and go on counting their full amounts. `json_valid` guards the extract: `json_extract`
// raises on a value that will not parse, which would take the boot down with it.
db.exec(`
  UPDATE expenses
     SET deductible_amount = ROUND(json_extract(raw, '$.deductibleAmount') *
           (CASE WHEN json_extract(raw, '$.currencyRate') > 0
                 THEN json_extract(raw, '$.currencyRate') ELSE 1 END), 2),
         deductible_vat = ROUND(json_extract(raw, '$.deductibleVat') *
           (CASE WHEN json_extract(raw, '$.currencyRate') > 0
                 THEN json_extract(raw, '$.currencyRate') ELSE 1 END), 2)
   WHERE deductible_amount IS NULL AND deductible_vat IS NULL
     AND raw IS NOT NULL AND json_valid(raw)
     AND json_extract(raw, '$.deductibleVat') IS NOT NULL
`);

// The expenses table was created with a CHECK that allowed only 'open' and 'reported', and a
// CHECK cannot be altered in place — the table has to be rebuilt for 'unknown' to be storable.
// Every row that says 'open' is rewritten to 'unknown' on the way across, because under the
// old mapper 'open' was also what an unreadable payload produced: the two are indistinguishable
// in the stored value, and claiming an expense is unreported is the more damaging of the two
// mistakes. The next sync restores the real 'open' rows from Morning.
const expensesSql = (
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'expenses'").get() as
    | { sql: string }
    | undefined
)?.sql ?? '';
if (!expensesSql.includes("'unknown'")) {
  const columns = (db.prepare('PRAGMA table_info(expenses)').all() as Array<{ name: string }>)
    .map((c) => c.name)
    .join(', ');
  db.exec(`
    CREATE TABLE expenses_migrating (
      id TEXT PRIMARY KEY,
      external_id TEXT,
      number TEXT,
      doc_type INTEGER,
      date TEXT NOT NULL,
      payment_date TEXT,
      reporting_date TEXT,
      supplier_name TEXT NOT NULL DEFAULT '',
      supplier_tax_id TEXT,
      external_supplier_id TEXT,
      category TEXT,
      description TEXT,
      amount REAL NOT NULL DEFAULT 0,
      vat_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      deductible_amount REAL,
      deductible_vat REAL,
      currency TEXT NOT NULL DEFAULT 'ILS',
      status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('open','reported','unknown')),
      source TEXT NOT NULL DEFAULT 'morning',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      raw TEXT
    );
    INSERT INTO expenses_migrating (${columns}) SELECT ${columns} FROM expenses;
    UPDATE expenses_migrating SET status = 'unknown' WHERE status = 'open';
    DROP TABLE expenses;
    ALTER TABLE expenses_migrating RENAME TO expenses;
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  `);
}

// Both syncs upsert on these keys, so they must be unique — but only among synced rows,
// which is why they are partial indexes rather than column constraints. A pre-existing
// database with duplicates would fail to build the index; warn rather than refuse to boot,
// since the syncs are optional and everything else still works.
for (const [name, sql] of [
  [
    'idx_band_events_calendar',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_band_events_calendar
       ON band_events(calendar_event_id) WHERE calendar_event_id IS NOT NULL`,
  ],
  [
    'idx_invoices_external',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_external
       ON invoices(external_id) WHERE external_id IS NOT NULL`,
  ],
  [
    'idx_works_calendar',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_works_calendar
       ON works(calendar_event_id) WHERE calendar_event_id IS NOT NULL`,
  ],
  [
    'idx_expenses_external',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_external
       ON expenses(external_id) WHERE external_id IS NOT NULL`,
  ],
  [
    'idx_band_event_expenses_event',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_band_event_expenses_event
       ON band_event_expenses(event_id) WHERE event_id IS NOT NULL`,
  ],
] as const) {
  try {
    db.exec(sql);
  } catch (err) {
    console.warn(`[db] could not create ${name} — duplicate keys present:`, (err as Error).message);
  }
}

// ---------- settings helpers ----------
export function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getVatPercent(): number {
  return parseFloat(getSetting('vat_percent', '18'));
}

/** How far back each Morning pull looks, in days. */
export function getMorningSyncDays(): number {
  return parseInt(getSetting('morning_sync_days', '90'), 10) || 90;
}

/**
 * How far back each Meta pull looks, in days. Longer than Morning's by default: a campaign for
 * a show is bought weeks ahead, and a year's worth of them is what the cost-per-show comparison
 * is actually made of.
 */
export function getMetaSyncDays(): number {
  return parseInt(getSetting('meta_sync_days', '365'), 10) || 365;
}

/**
 * Shekels per unit of the ad account's currency.
 *
 * 1 is right for an account billed in ILS, which is the assumption until told otherwise. An
 * account billed in USD or EUR needs a real rate here, because the קמפיין column it feeds is
 * in shekels — the sync refuses to write a foreign figure into it rather than quietly
 * understating a show's costs by a third.
 */
export function getMetaCurrencyRate(): number {
  const rate = parseFloat(getSetting('meta_currency_rate', '1'));
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/**
 * Gives a database with no rules a starting pair — one for band shows, one for personal
 * gigs — carrying over whatever single-keyword configuration it had before. Runs on every
 * boot rather than inside the seed, so a database created earlier gets them too.
 */
function seedDefaultCalendarRules() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM calendar_rules').get() as { n: number };
  if (n > 0) return;

  const calendarId = getSetting('calendar_id', process.env.GOOGLE_CALENDAR_ID || 'primary');
  const keyword = getSetting('calendar_show_keyword', 'הופעה');
  const insert = db.prepare(
    `INSERT INTO calendar_rules (id, name, target, calendar_id, keywords, organizers, ignore_words,
       client_name, skip_declined, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // match_description stays at its column default (off).
  // Terms are matched as substrings, so the stem "חזר" catches both חזרה and חזרת —
  // writing the full word would miss the construct form these invitations actually use.
  const defaultIgnore = 'חזר, סאונדצ׳ק, מונטאז, מונטז, הקלט';
  insert.run(
    randomUUID(), 'הופעות להקה', 'band', calendarId, keyword, '', defaultIgnore, null, 1, 1, 0
  );
  // Starts disabled: a personal rule does nothing useful until an organizer or a client
  // is filled in, and enabling it empty would draw in nothing anyway.
  insert.run(
    randomUUID(), 'עבודות פרטיות', 'personal', calendarId, '', '', `${defaultIgnore}, טיפול`,
    null, 1, 0, 1
  );
}

/**
 * The cost lines a supplier can be hired for, and what the band calls each.
 *
 * Seeded once and then owned by the band — one row per cost line a show has, so hiring
 * somebody for any of them is a decision made on a screen rather than a change to this file.
 *
 * The four the app shipped with keep the required flags they had. צמידים, אק״ום and שכר אולם
 * are on beside them, because they are the lines a band actually hands money to somebody for —
 * they already sit on every show and are already settled separately, so switching them on adds
 * a name beside the amount and takes nothing away. None of the three is required, so no show is
 * ever nagged for one.
 *
 * The rest — קמפיין, כיבוד, עיצוב, אחר, הוצאה נוספת — arrive off. Those are usually a card
 * payment that was over when it was made, and turning one on changes when its line counts as
 * settled; that is a decision for the band to take on the screen, and taking it here for them
 * would rewrite what every show says it still owes.
 */
/**
 * Gives every cost line the paid flag the settled ones always had.
 *
 * קמפיין, כיבוד, עיצוב, אחר and הוצאה נוספת were costs nobody was ever staffed on, so they
 * were treated as settled the moment they were typed — there was no flag to say otherwise.
 * A band that hires a designer needs the same "have they been paid, did the invoice arrive"
 * for עיצוב as for תאורן, and that needs somewhere to record it.
 *
 * Everything already entered is marked paid: those costs were settled long before this column
 * existed, and a column that arrived claiming they were all outstanding would invent a debt
 * out of a schema change. New rows start unpaid, which only ever shows up once the band turns
 * a role on for that line — see expensePaidTotal, which asks the roles which lines settle.
 */
function addCostLinePaidFlags() {
  const columns = db.prepare('PRAGMA table_info(band_event_expenses)').all() as Array<{ name: string }>;
  const has = new Set(columns.map((c) => c.name));
  for (const field of ['campaign', 'refreshments', 'design', 'other', 'expense_amount']) {
    if (has.has(`${field}_paid`)) continue;
    db.exec(`ALTER TABLE band_event_expenses ADD COLUMN ${field}_paid INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE band_event_expenses SET ${field}_paid = 1`);
  }
}

addCostLinePaidFlags();

function seedSupplierRoles() {
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM band_supplier_roles').get() as { n: number };
  if (seeded.n) return;
  const insert = db.prepare(
    'INSERT INTO band_supplier_roles (key, name, required, active, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const rows: Array<[string, string, number, number]> = [
    ['lightman', 'תאורן', 1, 1],
    ['soundman', 'סאונדמן', 1, 1],
    ['singer', 'זמר/ת', 1, 1],
    ['sound_company', 'חברת הגברה', 0, 1],
    ['bracelets', 'צמידים', 0, 1],
    ['akom', 'אקו"ם', 0, 1],
    ['hall_fee', 'שכירות אולם', 0, 1],
    ['campaign', 'קמפיין', 0, 0],
    ['refreshments', 'כיבוד', 0, 0],
    ['design', 'עיצוב', 0, 0],
    ['other', 'אחר', 0, 0],
    ['expense_amount', 'הוצאה נוספת', 0, 0],
  ];
  rows.forEach(([key, name, required, active], i) => insert.run(key, name, required, active, i));
}

seedSupplierRoles();

/**
 * Rewrites the supplier tables that were shaped around exactly four roles and exactly one kind
 * of payee.
 *
 * Four CHECK constraints named the roles in the schema itself, and `supplier_payments` could
 * only point at a supplier — so «who do you hire» and «who does the band pay» were both
 * decided here rather than by the band. SQLite cannot drop a CHECK or relax a NOT NULL in
 * place, so each table is rebuilt: created empty in its new shape, copied into, and swapped.
 *
 * Foreign keys are turned off for the duration. With them on, dropping a table cascades into
 * everything that references it — the payments would take their lines and documents with them
 * and the copy would restore rows into an empty world. The ids are preserved exactly, so what
 * is switched back on at the end refers to the same rows it did at the start.
 */
function migratePayeeTables() {
  const schemaOf = (table: string): string =>
    ((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
      | { sql: string }
      | undefined)?.sql) ?? '';

  const jobs: Array<{ table: string; stale: (sql: string) => boolean; create: string; copy: string }> = [
    {
      table: 'band_suppliers',
      stale: (sql) => sql.includes("CHECK (role IN ('lightman'"),
      create: `CREATE TABLE band_suppliers_migrating (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT COLLATE NOCASE, role TEXT NOT NULL,
        phone TEXT, notes TEXT, default_amount REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        tax_id TEXT, morning_supplier_id TEXT, aliases TEXT,
        expects_invoice INTEGER NOT NULL DEFAULT 1
      )`,
      copy: `INSERT INTO band_suppliers_migrating
               (id, name, email, role, phone, notes, default_amount, created_at,
                tax_id, morning_supplier_id, aliases, expects_invoice)
             SELECT id, name, email, role, phone, notes, default_amount, created_at,
                tax_id, morning_supplier_id, aliases, expects_invoice FROM band_suppliers`,
    },
    {
      table: 'band_event_assignments',
      stale: (sql) => sql.includes("CHECK (role IN ('lightman'"),
      create: `CREATE TABLE band_event_assignments_migrating (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES band_events(id) ON DELETE CASCADE,
        role TEXT NOT NULL, supplier_id TEXT, not_needed INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','calendar')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      copy: `INSERT INTO band_event_assignments_migrating
               (id, event_id, role, supplier_id, not_needed, source, created_at)
             SELECT id, event_id, role, supplier_id, not_needed, source, created_at
               FROM band_event_assignments`,
    },
    {
      table: 'supplier_payments',
      stale: (sql) => !sql.includes('member_key'),
      create: `CREATE TABLE supplier_payments_migrating (
        id TEXT PRIMARY KEY,
        supplier_id TEXT REFERENCES band_suppliers(id) ON DELETE CASCADE,
        member_key TEXT,
        date TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, method TEXT, notes TEXT,
        expects_invoice INTEGER NOT NULL DEFAULT 1,
        resolution TEXT CHECK (resolution IN ('verified','not_required')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','line','backfill')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK ((supplier_id IS NOT NULL) + (member_key IS NOT NULL) = 1)
      )`,
      copy: `INSERT INTO supplier_payments_migrating
               (id, supplier_id, member_key, date, amount, method, notes, expects_invoice,
                resolution, source, created_at)
             SELECT id, supplier_id, NULL, date, amount, method, notes, expects_invoice,
                resolution, source, created_at FROM supplier_payments`,
    },
    {
      table: 'supplier_payment_lines',
      stale: (sql) => !sql.includes('member_key'),
      create: `CREATE TABLE supplier_payment_lines_migrating (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES band_events(id) ON DELETE CASCADE,
        role TEXT, member_key TEXT,
        amount REAL NOT NULL DEFAULT 0,
        CHECK ((role IS NOT NULL) + (member_key IS NOT NULL) = 1)
      )`,
      // The line rows had no id of their own — they were keyed by what they settle. One is
      // minted here from the payment and the line it covers, which is unique by that same key.
      copy: `INSERT INTO supplier_payment_lines_migrating
               (id, payment_id, event_id, role, member_key, amount)
             SELECT payment_id || ':' || event_id || ':' || role, payment_id, event_id, role,
                NULL, amount FROM supplier_payment_lines`,
    },
    {
      table: 'band_supplier_aliases',
      stale: (sql) => !sql.includes('member_key'),
      create: `CREATE TABLE band_supplier_aliases_migrating (
        id TEXT PRIMARY KEY,
        supplier_id TEXT REFERENCES band_suppliers(id) ON DELETE CASCADE,
        member_key TEXT,
        alias TEXT NOT NULL, normalized TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','link','migration')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK ((supplier_id IS NOT NULL) + (member_key IS NOT NULL) = 1)
      )`,
      copy: `INSERT INTO band_supplier_aliases_migrating
               (id, supplier_id, member_key, alias, normalized, source, created_at)
             SELECT id, supplier_id, NULL, alias, normalized, source, created_at
               FROM band_supplier_aliases`,
    },
  ];

  const due = jobs.filter((job) => {
    const sql = schemaOf(job.table);
    return sql && job.stale(sql);
  });
  if (!due.length) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const job of due) {
        db.exec(job.create);
        db.exec(job.copy);
        db.exec(`DROP TABLE ${job.table}`);
        db.exec(`ALTER TABLE ${job.table}_migrating RENAME TO ${job.table}`);
      }
      // The indexes went with the tables they were on.
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_band_suppliers_email
          ON band_suppliers(email) WHERE email IS NOT NULL AND email != '';
        CREATE INDEX IF NOT EXISTS idx_band_event_assignments_event
          ON band_event_assignments(event_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_band_event_assignments_role
          ON band_event_assignments(event_id, role);
        CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier
          ON supplier_payments(supplier_id, date);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_lines_role
          ON supplier_payment_lines(event_id, role) WHERE role IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_lines_member
          ON supplier_payment_lines(event_id, member_key) WHERE member_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_supplier_payment_lines_payment
          ON supplier_payment_lines(payment_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_band_supplier_aliases_normalized
          ON band_supplier_aliases(normalized);
        CREATE INDEX IF NOT EXISTS idx_band_supplier_aliases_supplier
          ON band_supplier_aliases(supplier_id);
      `);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const broken = db.pragma('foreign_key_check') as unknown[];
  if (broken.length) console.warn(`[payees] foreign_key_check reported ${broken.length} rows`);
}

/**
 * Turns on the three payee lines that a first cut of this feature seeded switched off.
 *
 * They shipped off out of caution and the caution was wrong: the band cannot name a supplier
 * for a role that is not active, so «add the bracelets company» dead-ended in a dialog that
 * offered four roles and no way to reach a fifth. Once, and guarded, so a band that has since
 * decided it does not hire for one of them keeps that decision.
 */
if (getSetting('moonlight_supplier_roles_v2', '') !== 'done') {
  db.prepare(
    "UPDATE band_supplier_roles SET active = 1 WHERE key IN ('bracelets','akom','hall_fee')"
  ).run();
  setSetting('moonlight_supplier_roles_v2', 'done');
}

/**
 * Corrects the document type on invoices that never left this app.
 *
 * Morning's codes are 305 = חשבונית מס and 320 = חשבונית מס קבלה; this app had the two
 * swapped, so every local invoice raised as "חשבונית מס" was stored as 320 and would now
 * read as a receipt it never was. Rows carrying a Morning `external_id` are left alone —
 * their type came from Morning and was always right — and so is anything but 320, which
 * nothing here could have mislabelled.
 */
function correctSwappedLocalDocTypes() {
  if (getSetting('doc_type_305_320_swap_fixed', '')) return;
  db.prepare(
    "UPDATE invoices SET doc_type = 305 WHERE doc_type = 320 AND (external_id IS NULL OR external_id = '')"
  ).run();
  setSetting('doc_type_305_320_swap_fixed', 'done');
}

correctSwappedLocalDocTypes();

migratePayeeTables();

/**
 * The payment-line invariants: a show's cost line is settled by at most one payment, and so is
 * one member's share of one show.
 *
 * Partial indexes rather than a composite primary key, because the column that is NULL for a
 * line of the other kind must not take part in the uniqueness. Created here, after the
 * migration, so they are applied to the rebuilt table in an existing database and to the
 * freshly created one in a new database alike.
 */
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_lines_role
    ON supplier_payment_lines(event_id, role) WHERE role IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_lines_member
    ON supplier_payment_lines(event_id, member_key) WHERE member_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_supplier_payment_lines_payment
    ON supplier_payment_lines(payment_id);
`);

seedDefaultCalendarRules();

export const uuid = () => randomUUID();
