import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts opens its file on import, so the directory is set before any module is loaded.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notifications-test-'));
const { db } = await import('./db.js');
const n = await import('./notifications.js');
const webpush = (await import('web-push')).default;

const pushed: Array<{ endpoint: string; payload: any }> = [];
let failWith: number | null = null;
(webpush as any).sendNotification = async (sub: any, body: string) => {
  if (failWith) throw Object.assign(new Error('push failed'), { statusCode: failWith });
  pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
  return { statusCode: 201 };
};

const OWNER = { id: 'u-owner', email: 'owner@example.com', role: 'owner' as const };
const DANA = { id: 'u-dana', email: 'dana@example.com', role: 'band' as const };
const sub = (id: string) => ({ endpoint: `https://push.example.com/${id}`, keys: { p256dh: 'p', auth: 'a' } });

/** 2026-11-30 at the given Israel hour (UTC+2 in November). */
const at = (date: string, hour: number) => new Date(`${date}T${String(hour - 2).padStart(2, '0')}:15:00Z`);

before(() => {
  for (const u of [OWNER, DANA]) {
    db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, 'x', 'x', ?)").run(u.id, u.email, u.role);
  }
  db.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'לקוח א')").run();
  db.prepare(
    `INSERT INTO works (id, client_id, date, description, amount, total, status)
     VALUES ('w1', 'c1', '2026-11-10', 'עבודה', 1000, 1180, 'unpaid'),
            ('w2', 'c1', '2026-11-20', 'עבודה', 500, 590, 'unpaid'),
            ('w3', 'c1', '2026-11-21', 'עבודה', 500, 590, 'invoiced')`
  ).run();
  db.prepare("INSERT INTO band_events (id, venue, date) VALUES ('e1', 'בארבי', '2026-12-05')").run();
  db.prepare("INSERT OR IGNORE INTO band_members (id, member_key, name, email) VALUES ('m1', 'm_dana', 'דנה', 'dana@example.com')").run();
  db.prepare("INSERT INTO campaign_task_owners (event_id, member_key) VALUES ('e1', 'm_dana')").run();
  db.prepare(
    `INSERT INTO campaign_tasks (id, event_id, title, due_date, done_token)
     VALUES ('t1', 'e1', 'להעלות תקציב', '2026-11-29', 'tok-1'),
            ('t2', 'e1', 'עתידית', '2026-12-03', 'tok-2')`
  ).run();
});

test('preferences default per category and only cover what the role may see', () => {
  const owner = n.getPrefs(OWNER.id, 'owner');
  assert.equal(owner.month_end, true);
  assert.equal(owner.gov_bl, false);
  const band = n.getPrefs(DANA.id, 'band');
  assert.deepEqual(Object.keys(band).sort(), ['campaign_tasks', 'show_staffing']);
  // A band login cannot switch on a category it is not offered.
  n.savePrefs(DANA.id, 'band', { gov_payments: true, show_staffing: false });
  assert.equal(n.getPrefs(DANA.id, 'band').show_staffing, false);
  assert.equal('gov_payments' in n.getPrefs(DANA.id, 'band'), false);
});

test('month end fires on the last day only, counting the unbilled jobs', () => {
  const before = n.alertsFor(OWNER, '2026-11-29').filter((a) => a.category === 'month_end');
  assert.equal(before.length, 0);
  const [alert] = n.alertsFor(OWNER, '2026-11-30').filter((a) => a.category === 'month_end');
  assert.equal(alert.key, 'month-end:2026-11');
  assert.match(alert.body, /^2 עבודות פתוחות/);
  assert.match(alert.body, /לקוח א/);
});

test('campaign tasks reach the owner and the member who owns the show, and nobody else', () => {
  const owner = n.alertsFor(OWNER, '2026-11-30').filter((a) => a.category === 'campaign_tasks');
  assert.deepEqual(owner.map((a) => a.key), ['campaign-task:t1']);
  assert.match(owner[0].title, /באיחור/);
  const dana = n.alertsFor(DANA, '2026-11-30').filter((a) => a.category === 'campaign_tasks');
  assert.equal(dana.length, 1);
  const stranger = n.alertsFor({ id: 'u-x', email: 'x@example.com', role: 'band' }, '2026-11-30')
    .filter((a) => a.category === 'campaign_tasks');
  assert.equal(stranger.length, 0);
});

test('a repeating alert is owed again only after its interval', () => {
  const alert = { category: 'campaign_tasks', key: 'k-repeat', title: 't', body: 'b', url: '/', repeatDays: 2 };
  const once = { ...alert, key: 'k-once', repeatDays: undefined };
  assert.equal(n.isOwed(OWNER.id, alert, '2026-11-01'), true);
  db.prepare("INSERT INTO notification_log (user_id, key, category, title, body, sent_on) VALUES (?, 'k-repeat', 'x', 't', 'b', '2026-11-01')").run(OWNER.id);
  db.prepare("INSERT INTO notification_log (user_id, key, category, title, body, sent_on) VALUES (?, 'k-once', 'x', 't', 'b', '2026-11-01')").run(OWNER.id);
  assert.equal(n.isOwed(OWNER.id, alert, '2026-11-02'), false);
  assert.equal(n.isOwed(OWNER.id, alert, '2026-11-03'), true);
  assert.equal(n.isOwed(OWNER.id, once, '2026-12-30'), false);
});

test('several alerts of one kind fold into one notification', () => {
  const mk = (key: string, category = 'supplier_invoice') => ({ category, key, title: key, body: 'b', url: '/x' });
  const payloads = n.fold([mk('a'), mk('b'), mk('c'), mk('m', 'month_end')]);
  assert.equal(payloads.length, 2);
  const folded = payloads.find((p) => p.tag === 'supplier_invoice')!;
  assert.match(folded.title, /· 3$/);
  assert.equal(folded.url, '/band/supplierPayments');
  assert.equal(payloads.find((p) => p.tag === 'm')!.title, 'm');
});

test('subscriptions are validated and an endpoint belongs to whoever subscribed last', () => {
  assert.throws(() => n.saveSubscription(OWNER.id, { endpoint: 'http://insecure', keys: {} }, null));
  n.saveSubscription(DANA.id, sub('shared'), 'ua');
  n.saveSubscription(OWNER.id, sub('shared'), 'ua');
  const rows = db.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint LIKE '%shared'").all() as any[];
  assert.deepEqual(rows, [{ user_id: OWNER.id }]);
  n.removeSubscription(OWNER.id, sub('shared').endpoint);
});

test('the scheduler sends within the window, logs what it sent, and does not repeat it', async () => {
  n.saveSubscription(OWNER.id, sub('owner-phone'), null);
  n.saveSubscription(DANA.id, sub('dana-phone'), null);
  pushed.length = 0;

  const early = await n.runNotifications(at('2026-11-30', 7));
  assert.equal(early.notifications, 0);

  const first = await n.runNotifications(at('2026-11-30', 10));
  assert.ok(first.notifications >= 2);
  const ownerTitles = pushed.filter((p) => p.endpoint.endsWith('owner-phone')).map((p) => p.payload.title);
  assert.ok(ownerTitles.some((t) => /סוף החודש/.test(t)));
  assert.ok(pushed.some((p) => p.endpoint.endsWith('dana-phone') && /להעלות תקציב/.test(p.payload.title)));

  pushed.length = 0;
  await n.runNotifications(at('2026-11-30', 11));
  assert.equal(pushed.length, 0, 'nothing is sent twice on the same day');
});

test('a device the push service reports gone is removed', async () => {
  failWith = 410;
  try {
    await n.pushToUser(DANA.id, { title: 't', body: 'b', url: '/', tag: 't' });
  } finally {
    failWith = null;
  }
  const left = db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?').get(DANA.id) as any;
  assert.equal(left.c, 0);
});

test('מע"מ: only the latest unticked period alerts, and not once it is long overdue', () => {
  const vat = (today: string) => n.alertsFor(OWNER, today).filter((a) => a.key.startsWith('vat:'));
  // Nov 12: Sep–Oct is due on Sunday the 15th, three days away.
  const nov = vat('2026-11-12');
  assert.equal(nov.length, 1);
  assert.match(nov[0].key, /^vat:2026-P5:d5$/);
  assert.match(nov[0].body, /תקופות קודמות לא סומנו/);
  // Far past every deadline with nothing ticked: silence rather than a list of stale periods.
  assert.equal(vat('2026-11-01').length, 0);
});

test('a failed sync alerts until a sync succeeds, and a stale one reminds', async () => {
  const health = await import('./syncHealth.js');
  const morning = health.SERVICES.find((s) => s.key === 'morning')!;
  const original = morning.configured;
  morning.configured = () => true;
  try {
    const sync = (today: string) => n.alertsFor(OWNER, today).filter((a) => a.category === 'sync_health');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('morning_last_sync', '2026-11-28T10:00:00Z')").run();
    assert.equal(sync('2026-11-30').length, 0, 'synced two days ago: nothing to say');

    await assert.rejects(health.tracked('morning', async () => { throw new Error('401 token expired'); }));
    const [fail] = sync('2026-11-30');
    assert.match(fail.title, /Morning/);
    assert.match(fail.body, /401 token expired/);
    assert.equal(fail.url, '/settings?section=connections');

    await health.tracked('morning', async () => 'ok');
    assert.equal(sync('2026-11-30').length, 0, 'a successful sync clears it');
    const [stale] = sync('2026-12-06');
    assert.match(stale.title, /לא סונכרן 8 ימים/);
  } finally {
    morning.configured = original;
  }
});

test('the daily probe retries once, records a lasting failure, and runs once a day', async () => {
  const health = await import('./syncHealth.js');
  let calls = 0;
  let fail = true;
  const fake = {
    key: 'calendar' as const, label: 'Google Calendar', configured: () => true,
    probe: async () => { calls++; if (fail) throw new Error('invalid_grant'); },
    lastSyncSetting: null, staleDays: null,
  };
  await health.runHealthChecks(at('2026-11-30', 8), [fake], 0);
  assert.equal(calls, 2, 'tried twice');
  assert.match(health.healthOf(fake).last_error!, /invalid_grant/);
  await health.runHealthChecks(at('2026-11-30', 12), [fake], 0);
  assert.equal(calls, 2, 'not again the same day');
  fail = false;
  await health.runHealthChecks(at('2026-12-01', 8), [fake], 0);
  assert.equal(health.healthOf(fake).failing_since, null, 'recovered the next day');
});

test('tax shortfall: monthly, only once the year is configured and the gap is real', async () => {
  const shortfall = (today: string) => n.alertsFor(OWNER, today).filter((a) => a.category === 'tax_shortfall');
  assert.equal(shortfall('2026-11-30').length, 0, 'no declared side yet: quiet');
  const { saveProfile } = await import('./annualReport.js');
  // Enough income on the books that a year with no advances paid owes real tax.
  db.prepare(
    `INSERT INTO invoices (id, client_id, number, date, subtotal, vat_amount, total, status, doc_type)
     VALUES ('inv-big', 'c1', '9001', '2026-06-01', 400000, 72000, 472000, 'paid', 320)`
  ).run();
  saveProfile(2026, { mikdamot_paid: 0 });
  const [alert] = shortfall('2026-11-30');
  assert.ok(alert, 'a configured year with a gap alerts');
  assert.equal(alert.key, 'shortfall:2026-11');
  assert.match(alert.title, /^2026 בדרך ליתרת מס של/);
  assert.match(alert.body, /בחודש יסגרו את הפער/);
});
