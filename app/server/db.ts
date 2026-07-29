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

/** Calendar the show sync reads from. Defaults to the owner's primary calendar. */
export function getCalendarId(): string {
  return getSetting('calendar_id', process.env.GOOGLE_CALENDAR_ID || 'primary');
}

/** Only calendar events whose title contains this word are treated as shows. */
export function getShowKeyword(): string {
  return getSetting('calendar_show_keyword', 'הופעה');
}

/** How far back each Morning pull looks, in days. */
export function getMorningSyncDays(): number {
  return parseInt(getSetting('morning_sync_days', '90'), 10) || 90;
}

export const uuid = () => randomUUID();
