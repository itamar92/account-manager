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

/**
 * The expenses table holds nothing but a copy of what Morning knows, so a shape that has
 * moved on is dropped and rebuilt by the next sync rather than migrated column by column.
 * The marker is the status column: it learned an 'unknown' state once it turned out Morning
 * does not always say whether an expense has been reported.
 */
const expensesTable = (
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'expenses'").get() as
    | { sql?: string }
    | undefined
)?.sql;
if (expensesTable && !expensesTable.includes("'unknown'")) db.exec('DROP TABLE expenses');

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
  -- 'unknown' is for the accounts whose expense search does not report a status at all.
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('open','reported','unknown')),
  source TEXT NOT NULL DEFAULT 'morning',
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
addColumnIfMissing('works', 'description_locked', 'INTEGER NOT NULL DEFAULT 0');

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
