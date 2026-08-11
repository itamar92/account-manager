import Database from 'better-sqlite3';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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
  doc_type INTEGER NOT NULL DEFAULT 320,
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
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_tax_id TEXT,
  external_supplier_id TEXT,
  category TEXT,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reported')),
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
CREATE TABLE IF NOT EXISTS band_suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('lightman','soundman','singer','sound_company')),
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_band_suppliers_email
  ON band_suppliers(email) WHERE email IS NOT NULL AND email != '';

-- Who is staffed on each show, one row per role. supplier_id NULL with not_needed = 1 is an
-- explicit "this show has no sound company"; no row at all means nobody decided yet, which
-- is what the missing-staff alert looks for.
CREATE TABLE IF NOT EXISTS band_event_assignments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('lightman','soundman','singer','sound_company')),
  supplier_id TEXT,
  not_needed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','calendar')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, role)
);

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
// Where a show's money has got to: waiting for the venue's report, invoiced, or in the bank.
addColumnIfMissing('band_events', 'payment_status', "TEXT NOT NULL DEFAULT 'waiting_report'");
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
// The Morning payload a synced expense was mapped from. Kept so a field Morning spells
// differently than expected can be seen in the data instead of guessed at — reading the
// classification object as a scalar once wrote "[object Object]" into every category, and
// there was nothing stored to diagnose it from.
addColumnIfMissing('expenses', 'raw', 'TEXT');
// A קמפיין figure typed by hand outranks the Meta sync, the same way a renamed show outranks
// the calendar. Set the moment someone edits the cell; from then on the sync reports the row
// as held back rather than overwriting it, until the lock is handed back.
addColumnIfMissing('band_event_expenses', 'campaign_locked', 'INTEGER NOT NULL DEFAULT 0');

// That bad value is cleared here rather than left for the next sync: the sync only refreshes
// its own window (90 days by default), so anything older would keep a category that is not a
// category, in the list and in the filter. Cleared rows read as ללא סיווג until re-synced.
db.prepare("UPDATE expenses SET category = NULL WHERE category = '[object Object]'").run();

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

seedDefaultCalendarRules();

export const uuid = () => randomUUID();
