/**
 * התראות — push notifications to the app saved on a phone's home screen (or to a desktop browser).
 *
 * Nothing here is stored as a to-do. Like the inbox, every notification is worked out from the
 * books at the moment it is due: the month is ending and there are jobs nobody has invoiced, a
 * supplier was paid a week ago and no invoice came back, the מע"מ period closes in five days. A
 * fix made anywhere in the app clears the condition, and the next pass simply finds nothing.
 *
 * What *is* stored is what was already sent (`notification_log`), so a condition that holds all
 * week is one notification — or one every few days, for the ones that are worth repeating — and
 * not one every ten minutes.
 *
 * Delivery is Web Push with VAPID. The keys are generated on first use and kept in the settings
 * table (the private half sealed by secrets.ts), or come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 * when those are set. iPhones deliver Web Push only to a site added to the home screen (iOS 16.4+);
 * Android and desktop browsers deliver it to the browser itself as well.
 */
import { Router } from 'express';
import webpush from 'web-push';
import { db, getSetting, setSetting, uuid } from './db.js';
import { requireAuth } from './auth.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { addDays, israelDate, israelHour } from './campaignTasks.js';
import { eventLabel, moneyReceived } from './band.js';
import { listPayments } from './supplierPayments.js';
import { vatReport, getVatFrequency } from './reports.js';
import { annualOutlook } from './annualReport.js';
import { quoteFollowUps } from './quoteShow.js';
import { missingRoles } from './assignments.js';
import { roleName } from './supplierRoles.js';
import { outstandingSql } from './queries.js';
import { RECEIVABLE_DOC_TYPES_SQL } from './docTypes.js';

// ---------------------------------------------------------------- categories

export type Role = 'owner' | 'band';

export interface Category {
  key: string;
  label: string;
  description: string;
  /** Who may turn it on. A band member's login never hears about the business's taxes. */
  roles: Role[];
  default: boolean;
  /** Where a notification of this kind opens when several are folded into one. */
  url: string;
  /** Shown indented under another category, as a refinement of it. */
  parent?: string;
}

export const CATEGORIES: Category[] = [
  {
    key: 'month_end', label: 'סוף חודש — להוציא חשבוניות',
    description: 'ביום האחרון של החודש, אם יש עבודות פתוחות שעוד לא הופקה עליהן חשבונית',
    roles: ['owner'], default: true, url: '/works',
  },
  {
    key: 'campaign_tasks', label: 'משימות קמפיין',
    description: 'משימה שהגיע מועדה, ושוב כל יומיים עד שתסומן כבוצעה',
    roles: ['owner', 'band'], default: true, url: '/campaigns/tasks',
  },
  {
    key: 'supplier_invoice', label: 'ספק ששולם ולא שלח חשבונית',
    description: 'שבוע אחרי התשלום, ושוב כל שבוע עד שהחשבונית משויכת',
    roles: ['owner'], default: true, url: '/band/supplierPayments',
  },
  {
    key: 'gov_payments', label: 'תשלומים לרשויות',
    description: 'מע"מ — 5 ימים לפני, יום לפני ובאיחור; דוח שנתי — חודש, שבוע ויום לפני',
    roles: ['owner'], default: true, url: '/reports',
  },
  {
    key: 'gov_mikdamot', label: 'לצרף מקדמות מס הכנסה לתזכורת המע"מ',
    description: 'משולמות באותו מועד ובאותה תדירות כמו המע"מ',
    roles: ['owner'], default: false, url: '/reports', parent: 'gov_payments',
  },
  {
    key: 'gov_bl', label: 'מקדמת ביטוח לאומי חודשית',
    description: 'יומיים לפני ה-15 בכל חודש (כבו אם יש הוראת קבע)',
    roles: ['owner'], default: false, url: '/reports', parent: 'gov_payments',
  },
  {
    key: 'overdue_invoices', label: 'לקוחות שלא שילמו בזמן',
    description: 'סיכום שבועי ביום ראשון של חשבוניות שעבר מועד התשלום שלהן',
    roles: ['owner'], default: true, url: '/invoices',
  },
  {
    key: 'quote_signed', label: 'הצעת מחיר נחתמה',
    description: 'ברגע שלקוח חותם על הצעה מהקישור',
    roles: ['owner'], default: true, url: '/band/quotes',
  },
  {
    key: 'show_staffing', label: 'הופעה קרובה בלי צוות מלא',
    description: '10 ימים לפני הופעה שעוד חסר בה תפקיד חובה',
    roles: ['owner', 'band'], default: true, url: '/band/shows',
  },
  {
    key: 'show_payment', label: 'הופעה שהכסף עליה לא הגיע',
    description: 'סיכום שבועי ביום ראשון של הופעות שעברו שבועיים ועוד לא שולמו',
    roles: ['owner'], default: true, url: '/band/shows',
  },
];

const categoryByKey = new Map(CATEGORIES.map((c) => [c.key, c]));

export type Prefs = Record<string, boolean>;

export function categoriesFor(role: Role): Category[] {
  return CATEGORIES.filter((c) => c.roles.includes(role));
}

export function getPrefs(userId: string, role: Role): Prefs {
  const row = db.prepare('SELECT prefs FROM notification_prefs WHERE user_id = ?').get(userId) as
    { prefs: string } | undefined;
  let stored: Record<string, unknown> = {};
  try { stored = row ? JSON.parse(row.prefs) : {}; } catch { stored = {}; }
  const prefs: Prefs = {};
  for (const c of categoriesFor(role)) {
    prefs[c.key] = typeof stored[c.key] === 'boolean' ? (stored[c.key] as boolean) : c.default;
  }
  return prefs;
}

export function savePrefs(userId: string, role: Role, input: unknown): Prefs {
  const current = getPrefs(userId, role);
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (key in current && typeof value === 'boolean') current[key] = value;
    }
  }
  db.prepare(
    `INSERT INTO notification_prefs (user_id, prefs, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(current));
  return current;
}

// ---------------------------------------------------------------- VAPID

let vapid: { publicKey: string; privateKey: string } | null = null;

/**
 * The server's push identity. Changing it orphans every subscription (each was made against
 * the old public key), so a key that cannot be read back is replaced *and* the subscriptions
 * made with it are dropped — the devices re-subscribe the next time the app is opened.
 */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  if (vapid) return vapid;
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) {
    vapid = { publicKey: envPublic, privateKey: envPrivate };
  } else {
    const storedPublic = getSetting('vapid_public_key', '');
    const storedPrivate = decryptSecret(getSetting('vapid_private_key', ''));
    if (storedPublic && storedPrivate) {
      vapid = { publicKey: storedPublic, privateKey: storedPrivate };
    } else {
      const fresh = webpush.generateVAPIDKeys();
      setSetting('vapid_public_key', fresh.publicKey);
      setSetting('vapid_private_key', encryptSecret(fresh.privateKey));
      db.prepare('DELETE FROM push_subscriptions').run();
      vapid = fresh;
    }
  }
  return vapid;
}

function vapidSubject(): string {
  const explicit = process.env.VAPID_SUBJECT?.trim();
  if (explicit) return explicit;
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (base?.startsWith('https://')) return base.replace(/\/+$/, '');
  const owner = process.env.SEED_OWNER_EMAIL?.trim();
  return `mailto:${owner || 'owner@example.com'}`;
}

// ---------------------------------------------------------------- subscriptions

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function isSubscription(value: any): value is PushSubscriptionInput {
  return value && typeof value.endpoint === 'string' && /^https:\/\//.test(value.endpoint)
    && value.keys && typeof value.keys.p256dh === 'string' && typeof value.keys.auth === 'string';
}

export function saveSubscription(userId: string, sub: unknown, userAgent: string | null) {
  if (!isSubscription(sub)) throw Object.assign(new Error('מנוי התראות לא תקין'), { status: 400 });
  // The key exists before the first device is stored: creating it later would clear the table.
  vapidKeys();
  // The endpoint is the device. If it was registered under another login on the same phone,
  // it now belongs to whoever subscribed last.
  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, user_agent = excluded.user_agent, failures = 0`
  ).run(uuid(), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300) ?? null);
}

export function removeSubscription(userId: string, endpoint: unknown) {
  if (typeof endpoint !== 'string') return;
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

function subscriptionsOf(userId: string): Array<{ id: string; endpoint: string; p256dh: string; auth: string }> {
  return db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId) as any[];
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Sends one payload to every device of one user. A device the push service reports gone (404 /
 * 410) is deleted on the spot; any other failure is counted, and a device that keeps failing is
 * dropped after a week of tries rather than retried for ever.
 */
export async function pushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const keys = vapidKeys();
  const result = { sent: 0, failed: 0 };
  for (const sub of subscriptionsOf(userId)) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        {
          TTL: 24 * 3600,
          urgency: 'normal',
          vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
        }
      );
      db.prepare("UPDATE push_subscriptions SET last_success_at = datetime('now'), failures = 0 WHERE id = ?").run(sub.id);
      result.sent++;
    } catch (err: any) {
      result.failed++;
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(sub.id);
        db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND failures >= 50').run(sub.id);
        console.warn('[notifications] push failed:', err?.statusCode ?? '', err?.body || err?.message);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------- the rules

export interface Alert {
  category: string;
  /** Names this occurrence. Sent once, or again every `repeatDays` while it still holds. */
  key: string;
  title: string;
  body: string;
  url: string;
  repeatDays?: number;
}

export interface Recipient {
  id: string;
  email: string;
  role: Role;
}

const ddmm = (date: string) => {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
};

const shekel = (n: number) => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const lastDayOfMonth = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Sunday in Israel — the weekly digests go out on the first day of the working week. */
const isSunday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() === 0;

/** The 15th, moved to Sunday when it is a Saturday — the same rule the מע"מ dates follow. */
function fifteenth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 15));
  if (d.getUTCDay() === 6) d.setUTCDate(16);
  return d.toISOString().slice(0, 10);
}

/** Which reminder a deadline is owed today, by how far off it is. */
function deadlineBucket(daysLeft: number, steps: number[]): string | null {
  if (daysLeft < 0) return 'late';
  const step = [...steps].sort((a, b) => a - b).find((s) => daysLeft <= s);
  return step === undefined ? null : `d${step}`;
}

const whenText = (daysLeft: number, date: string) =>
  daysLeft < 0 ? `באיחור של ${-daysLeft} ימים (היה עד ${ddmm(date)})`
  : daysLeft === 0 ? 'היום'
  : daysLeft === 1 ? `מחר, ${ddmm(date)}`
  : `עד ${ddmm(date)} (בעוד ${daysLeft} ימים)`;

function monthEnd(today: string): Alert[] {
  if (today !== lastDayOfMonth(today)) return [];
  const rows = db.prepare(
    `SELECT c.name AS client, COUNT(*) AS count, COALESCE(SUM(w.total), 0) AS total
       FROM works w JOIN clients c ON c.id = w.client_id
      WHERE w.status = 'unpaid' AND w.date <= ?
      GROUP BY c.id ORDER BY total DESC`
  ).all(today) as Array<{ client: string; count: number; total: number }>;
  if (!rows.length) return [];
  const count = rows.reduce((s, r) => s + r.count, 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const clients = rows.slice(0, 3).map((r) => r.client).join(', ') + (rows.length > 3 ? ` ועוד ${rows.length - 3}` : '');
  return [{
    category: 'month_end', key: `month-end:${today.slice(0, 7)}`,
    title: 'סוף החודש — זמן להוציא חשבוניות',
    body: `${count} עבודות פתוחות (${shekel(total)}) — ${clients}`,
    url: '/works',
  }];
}

function campaignTasks(today: string, user: Recipient): Alert[] {
  const rows = db.prepare(
    `SELECT t.id, t.title, t.due_date, e.venue, e.date, m.email
       FROM campaign_tasks t
       JOIN band_events e ON e.id = t.event_id
       LEFT JOIN campaign_task_owners o ON o.event_id = t.event_id
       LEFT JOIN band_members m ON m.member_key = o.member_key
      WHERE t.done_at IS NULL AND t.due_date <= ?
      ORDER BY t.due_date`
  ).all(today) as Array<{ id: string; title: string; due_date: string; venue: string; date: string; email: string | null }>;
  // The owner sees every show's tasks; a member sees the shows whose promotion is theirs.
  const mine = user.role === 'owner'
    ? rows
    : rows.filter((r) => r.email && r.email.toLowerCase() === user.email.toLowerCase());
  return mine.map((r) => ({
    category: 'campaign_tasks', key: `campaign-task:${r.id}`, repeatDays: 2,
    title: r.due_date < today ? `משימת קמפיין באיחור: ${r.title}` : `משימת קמפיין להיום: ${r.title}`,
    body: eventLabel(r.venue, r.date),
    url: '/campaigns/tasks',
  }));
}

const SUPPLIER_INVOICE_GRACE_DAYS = 7;

function supplierInvoices(): Alert[] {
  return listPayments()
    .filter((p) => p.doc_status === 'waiting' && p.age_days >= SUPPLIER_INVOICE_GRACE_DAYS)
    .map((p) => ({
      category: 'supplier_invoice', key: `supplier-invoice:${p.id}`, repeatDays: 7,
      title: `${p.supplier_name} לא שלח/ה חשבונית`,
      body: `שולם ${shekel(p.missing)} ב-${ddmm(p.date)}, לפני ${p.age_days} ימים — בלי חשבונית אין קיזוז מע"מ`,
      url: '/band/supplierPayments',
    }));
}

/** Past this, an unticked מע"מ period is a missing tick in the app, not a deadline to chase. */
const VAT_LATE_LIMIT = 45;

function govPayments(today: string, prefs: Prefs): Alert[] {
  const alerts: Alert[] = [];
  const year = Number(today.slice(0, 4));

  // מע"מ. January's deadline belongs to last year's last period, so both years are read.
  //
  // Only the latest unticked period alerts. Older ones that were never marked filed are almost
  // always periods filed outside the app and never ticked here — a phone buzzing about each of
  // them every three days would teach anyone to switch the category off. They are counted in
  // the body instead, and a period more than VAT_LATE_LIMIT days late stops alerting at all.
  const frequencyLabel = getVatFrequency() === 'monthly' ? 'החודשי' : 'הדו-חודשי';
  const unticked = [year - 1, year]
    .flatMap((y) => vatReport(y).periods)
    .filter((p) => p.status === 'due' || p.status === 'overdue')
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const p = unticked[unticked.length - 1];
  if (p) {
    const daysLeft = daysBetween(today, p.due_date);
    const bucket = daysLeft < -VAT_LATE_LIMIT ? null : deadlineBucket(daysLeft, [1, 5]);
    if (bucket) {
      const extra = prefs.gov_mikdamot ? ' + מקדמות מס הכנסה' : '';
      const amount = Math.abs(p.vat_due) < 1 ? 'אין תשלום (דוח אפס)'
        : p.vat_due > 0 ? `לתשלום ${shekel(p.vat_due)}` : `להחזר ${shekel(-p.vat_due)}`;
      const older = unticked.length - 1;
      alerts.push({
        category: 'gov_payments', key: `vat:${p.key}:${bucket}`, repeatDays: bucket === 'late' ? 3 : undefined,
        title: `דיווח מע"מ ${frequencyLabel}${extra} — ${whenText(daysLeft, p.due_date)}`,
        body: `${p.label}: ${amount}`
          + (p.open_expenses ? ` · ${p.open_expenses} הוצאות עוד לא דווחו` : '')
          + (older > 0 ? ` · ועוד ${older} תקופות קודמות לא סומנו כמדווחות` : ''),
        url: '/reports',
      });
    }
  }

  // ביטוח לאומי: a monthly advance on the 15th, with no record in the app of having been paid,
  // so it is one reminder two days ahead and no more.
  if (prefs.gov_bl) {
    const [y, m] = today.split('-').map(Number);
    const due = fifteenth(y, m);
    const daysLeft = daysBetween(today, due);
    if (daysLeft >= 0 && daysLeft <= 2) {
      alerts.push({
        category: 'gov_payments', key: `bl:${today.slice(0, 7)}`,
        title: `מקדמת ביטוח לאומי — ${whenText(daysLeft, due)}`,
        body: 'תשלום המקדמה החודשית לביטוח לאומי',
        url: '/reports',
      });
    }
  }

  // The annual return of the year that has closed.
  const closed = annualOutlook(year - 1);
  if (closed.configured && (closed.deadline.status === 'due' || closed.deadline.status === 'overdue')) {
    const bucket = deadlineBucket(closed.deadline.days_left, [1, 7, 30]);
    if (bucket) {
      alerts.push({
        category: 'gov_payments', key: `annual:${closed.year}:${bucket}`, repeatDays: bucket === 'late' ? 7 : undefined,
        title: `דוח שנתי ${closed.year} — ${whenText(closed.deadline.days_left, closed.deadline.file_by)}`,
        body: closed.balance > 0 ? `צפי לתשלום עם הדוח: ${shekel(closed.balance)}` : 'צפי להחזר מס או לאיפוס',
        url: `/reports?tab=annual&year=${closed.year}`,
      });
    }
  }
  return alerts;
}

function overdueInvoices(today: string): Alert[] {
  if (!isSunday(today)) return [];
  const row = db.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(${outstandingSql('i')}), 0) AS total, MIN(i.due_date) AS oldest
       FROM invoices i
      WHERE i.due_date IS NOT NULL AND i.due_date < ?
        AND i.doc_type IN (${RECEIVABLE_DOC_TYPES_SQL})
        AND ${outstandingSql('i')} > 0`
  ).get(today) as { count: number; total: number; oldest: string | null };
  if (!row.count) return [];
  return [{
    category: 'overdue_invoices', key: `overdue:${today}`,
    title: `${row.count} חשבוניות שעבר מועד התשלום שלהן`,
    body: `${shekel(row.total)} פתוח לגבייה · הוותיקה מ-${ddmm(row.oldest!)}`,
    url: '/invoices',
  }];
}

function quotesSigned(): Alert[] {
  return quoteFollowUps().newlySigned.map((q: any) => ({
    category: 'quote_signed', key: `quote-signed:${q.id}`,
    title: `${q.client_name || 'לקוח'} חתם/ה על הצעת המחיר`,
    body: `${q.event_date ? `הופעה ב-${ddmm(q.event_date)} · ` : ''}${shekel(q.total)}`,
    url: `/band/quotes/${q.id}`,
  }));
}

const STAFFING_HORIZON_DAYS = 10;

function showStaffing(today: string): Alert[] {
  const events = db.prepare('SELECT id, venue, date FROM band_events WHERE date > ? AND date <= ? ORDER BY date')
    .all(today, addDays(today, STAFFING_HORIZON_DAYS)) as Array<{ id: string; venue: string; date: string }>;
  return events.flatMap((e) => {
    const missing = missingRoles(e.id);
    if (!missing.length) return [];
    return [{
      category: 'show_staffing', key: `staffing:${e.id}`, repeatDays: 3,
      title: `חסר צוות להופעה ${eventLabel(e.venue, e.date)}`,
      body: `עוד לא נקבע: ${missing.map(roleName).join(', ')}`,
      url: `/band/shows/${e.id}`,
    }];
  });
}

function showPayments(today: string): Alert[] {
  if (!isSunday(today)) return [];
  const rows = db.prepare('SELECT id, venue, date, amount_pre_vat, payment_status FROM band_events WHERE date <= ?')
    .all(addDays(today, -14)) as any[];
  const open = rows.filter((e) => !moneyReceived(e.payment_status));
  if (!open.length) return [];
  const total = open.reduce((s, e) => s + (Number(e.amount_pre_vat) || 0), 0);
  return [{
    category: 'show_payment', key: `show-payment:${today}`,
    title: `${open.length} הופעות שהכסף עליהן עוד לא הגיע`,
    body: `${shekel(total)} לפני מע"מ · ${open.slice(0, 3).map((e) => e.venue).join(', ')}`,
    url: '/band/shows',
  }];
}

/** Everything one user is owed today, before anything is filtered for having been sent already. */
export function alertsFor(user: Recipient, today: string = israelDate()): Alert[] {
  const prefs = getPrefs(user.id, user.role);
  const on = (key: string) => prefs[key] === true;
  const alerts: Alert[] = [];
  // Each rule on its own: one that throws (a half-configured integration, say) must not
  // silence the others.
  const run = (key: string, rule: () => Alert[]) => {
    if (!on(key)) return;
    try { alerts.push(...rule()); } catch (err) {
      console.warn(`[notifications] rule ${key} failed:`, (err as Error).message);
    }
  };
  if (user.role === 'owner') {
    run('month_end', () => monthEnd(today));
    run('supplier_invoice', () => supplierInvoices());
    run('gov_payments', () => govPayments(today, prefs));
    run('overdue_invoices', () => overdueInvoices(today));
    run('quote_signed', () => quotesSigned());
    run('show_payment', () => showPayments(today));
  }
  run('campaign_tasks', () => campaignTasks(today, user));
  run('show_staffing', () => showStaffing(today));
  return alerts;
}

// ---------------------------------------------------------------- dedupe and send

function lastSent(userId: string, key: string): string | null {
  const row = db.prepare('SELECT MAX(sent_on) AS last FROM notification_log WHERE user_id = ? AND key = ?')
    .get(userId, key) as { last: string | null };
  return row.last;
}

export function isOwed(userId: string, alert: Alert, today: string): boolean {
  const last = lastSent(userId, alert.key);
  if (!last) return true;
  if (!alert.repeatDays) return false;
  return last <= addDays(today, -alert.repeatDays);
}

/**
 * Several of one kind become one notification: four suppliers without invoices is one ping
 * listing them, not four pings in a row.
 */
export function fold(alerts: Alert[]): PushPayload[] {
  const byCategory = new Map<string, Alert[]>();
  for (const a of alerts) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
  const payloads: PushPayload[] = [];
  for (const [category, list] of byCategory) {
    if (list.length === 1) {
      const [a] = list;
      payloads.push({ title: a.title, body: a.body, url: a.url, tag: a.key });
      continue;
    }
    const cat = categoryByKey.get(category);
    payloads.push({
      title: `${cat?.label ?? 'התראות'} · ${list.length}`,
      body: list.slice(0, 4).map((a) => a.title).join('\n') + (list.length > 4 ? `\nועוד ${list.length - 4}…` : ''),
      url: cat?.url ?? '/',
      tag: category,
    });
  }
  return payloads;
}

function logSent(userId: string, alerts: Alert[], today: string) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notification_log (user_id, key, category, title, body, url, sent_on)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    for (const a of alerts) insert.run(userId, a.key, a.category, a.title, a.body, a.url, today);
  })();
}

/** Nothing before 9 or after 21, Israel time: a reminder at 3am is read at 9 anyway. */
export const SEND_FROM_HOUR = 9;
export const SEND_UNTIL_HOUR = 21;

let running = false;

export interface RunResult { users: number; notifications: number; alerts: number }

export async function runNotifications(now: Date = new Date()): Promise<RunResult> {
  const result: RunResult = { users: 0, notifications: 0, alerts: 0 };
  const hour = israelHour(now);
  if (running || hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return result;
  running = true;
  try {
    const today = israelDate(now);
    // Only users with at least one device: computing the rules for nobody is wasted, and an
    // alert must not be marked sent before there was anywhere to send it.
    const users = db.prepare(
      `SELECT DISTINCT u.id, u.email, u.role FROM users u JOIN push_subscriptions s ON s.user_id = u.id`
    ).all() as Recipient[];
    for (const user of users) {
      const owed = alertsFor(user, today).filter((a) => isOwed(user.id, a, today));
      if (!owed.length) continue;
      let delivered = 0;
      for (const payload of fold(owed)) {
        const { sent } = await pushToUser(user.id, payload);
        if (sent) { delivered++; result.notifications++; }
      }
      if (delivered) {
        logSent(user.id, owed, today);
        result.users++;
        result.alerts += owed.length;
      }
    }
    return result;
  } finally {
    running = false;
  }
}

const TICK_MS = 10 * 60_000;

export function startNotificationScheduler(): void {
  vapidKeys();
  const tick = () => {
    runNotifications().catch((err) => console.warn('[notifications] run failed:', err?.message));
  };
  setTimeout(tick, 45_000).unref();
  setInterval(tick, TICK_MS).unref();
}

// ---------------------------------------------------------------- routes

export const notificationsRouter = Router();

const handle = (fn: (req: any, res: any) => unknown) => async (req: any, res: any) => {
  try { await fn(req, res); } catch (err: any) {
    res.status(err?.status || 500).json({ error: err?.message || 'שגיאה' });
  }
};

notificationsRouter.get('/', requireAuth, handle((req, res) => {
  const user = req.user as Recipient;
  const prefs = getPrefs(user.id, user.role);
  const today = israelDate();
  const pending = alertsFor(user, today);
  res.json({
    publicKey: vapidKeys().publicKey,
    categories: categoriesFor(user.role).map((c) => ({ ...c, enabled: prefs[c.key] })),
    devices: (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(user.id) as any).n,
    window: { from: SEND_FROM_HOUR, until: SEND_UNTIL_HOUR },
    // What holds right now, whether or not it has already been sent — the preview the panel shows.
    pending: pending.map((a) => ({ ...a, sent: !isOwed(user.id, a, today) })),
    history: db.prepare(
      `SELECT key, category, title, body, url, sent_on FROM notification_log
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`
    ).all(user.id),
  });
}));

notificationsRouter.put('/prefs', requireAuth, handle((req, res) => {
  res.json({ prefs: savePrefs(req.user.id, req.user.role, req.body?.prefs) });
}));

notificationsRouter.post('/subscribe', requireAuth, handle((req, res) => {
  saveSubscription(req.user.id, req.body?.subscription, req.get('user-agent') ?? null);
  res.json({ ok: true });
}));

notificationsRouter.post('/unsubscribe', requireAuth, handle((req, res) => {
  removeSubscription(req.user.id, req.body?.endpoint);
  res.json({ ok: true });
}));

notificationsRouter.post('/test', requireAuth, handle(async (req, res) => {
  const result = await pushToUser(req.user.id, {
    title: 'התראת בדיקה',
    body: 'ההתראות עובדות. מעכשיו תקבל/י כאן תזכורות לפי מה שבחרת.',
    url: '/',
    tag: 'test',
  });
  if (!result.sent) throw Object.assign(new Error('אין מכשיר רשום שקיבל את ההתראה — יש להפעיל התראות קודם'), { status: 409 });
  res.json(result);
}));

/** Sends whatever is owed right now, outside the scheduler's tick — the «שלח עכשיו» button. */
notificationsRouter.post('/run', requireAuth, handle(async (req, res) => {
  const user = req.user as Recipient;
  const today = israelDate();
  const owed = alertsFor(user, today).filter((a) => isOwed(user.id, a, today));
  let delivered = 0;
  for (const payload of fold(owed)) {
    const { sent } = await pushToUser(user.id, payload);
    if (sent) delivered++;
  }
  if (delivered) logSent(user.id, owed, today);
  res.json({ notifications: delivered, alerts: delivered ? owed.length : 0 });
}));
