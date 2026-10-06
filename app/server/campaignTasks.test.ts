import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nodemailer from 'nodemailer';

// db.ts opens its file the moment it is imported, so the directory is set first and the modules
// are loaded after it — a static import would be hoisted above this line and open the real one.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-tasks-test-'));
process.env.SMTP_USER = 'band@example.com';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
process.env.PUBLIC_BASE_URL = 'https://im-tools.org/';
const { db } = await import('./db.js');
const tasks = await import('./campaignTasks.js');
const mailer = await import('./mailer.js');
const { extractAdCopy } = await import('./metaClient.js');

const sent: any[] = [];
const transport = nodemailer.createTransport({ jsonTransport: true });
const realSend = transport.sendMail.bind(transport);
(transport as any).sendMail = async (message: any) => {
  sent.push(message);
  return realSend(message);
};
mailer.useTransport(transport);

const SHOW = 'show-zappa';
const OTHER = 'show-barby';

before(() => {
  db.prepare("INSERT INTO band_events (id, venue, date) VALUES (?, 'זאפה הרצליה', '2026-11-04')").run(SHOW);
  db.prepare("INSERT INTO band_events (id, venue, date) VALUES (?, 'בארבי', '2026-11-20')").run(OTHER);
  db.prepare("INSERT OR IGNORE INTO band_members (id, member_key, name, email) VALUES ('m1', 'yuval', 'יובל', 'yuval@example.com')").run();
  db.prepare("UPDATE band_members SET email = 'yuval@example.com', name = 'יובל' WHERE member_key = 'yuval'").run();
});

/** 2026-10-13 at the given Israel hour (UTC+3 in October). */
const at = (date: string, hour: number) => new Date(`${date}T${String(hour - 3).padStart(2, '0')}:30:00Z`);

test('Israel dates and hours, not the server clock', () => {
  // 22:30 UTC on the 12th is already the 13th in Israel.
  assert.equal(tasks.israelDate(new Date('2026-10-12T22:30:00Z')), '2026-10-13');
  assert.equal(tasks.israelHour(new Date('2026-10-13T06:00:00Z')), 9);
  assert.equal(tasks.addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(tasks.addDays('2026-03-01', -1), '2026-02-28');
});

test('a reminder is due on the date, then every two days while open', () => {
  const t = (due_date: string, last_reminded_on: string | null, done_at: string | null = null) =>
    ({ due_date, last_reminded_on, done_at });
  assert.equal(tasks.isReminderDue(t('2026-10-14', null), '2026-10-13'), false, 'not before the date');
  assert.equal(tasks.isReminderDue(t('2026-10-13', null), '2026-10-13'), true, 'on the date');
  assert.equal(tasks.isReminderDue(t('2026-10-10', null), '2026-10-13'), true, 'overdue and never sent');
  assert.equal(tasks.isReminderDue(t('2026-10-10', '2026-10-12'), '2026-10-13'), false, 'sent yesterday');
  assert.equal(tasks.isReminderDue(t('2026-10-10', '2026-10-11'), '2026-10-13'), true, 'sent two days ago');
  assert.equal(tasks.isReminderDue(t('2026-10-10', null, '2026-10-12T10:00:00Z'), '2026-10-13'), false, 'done');
});

test('tasks are validated, and an owner must be a band member', () => {
  assert.throws(() => tasks.createTasks(SHOW, [{ title: '', due_date: '2026-10-13' }]), /כותרת/);
  assert.throws(() => tasks.createTasks(SHOW, [{ title: 'x', due_date: '13/10/2026' }]), /תאריך/);
  assert.throws(() => tasks.createTasks('nope', [{ title: 'x', due_date: '2026-10-13' }]), /ההופעה/);
  assert.throws(() => tasks.setTaskOwner(SHOW, 'nobody'), /חבר הלהקה/);
});

test('the scheduler emails the owner once per day, grouped, and stops when done', async () => {
  const [weekIn, weekBefore] = tasks.createTasks(SHOW, [
    { title: 'לבדוק הוצאה מול כרטיסים', detail: 'אם עלות לכרטיס מעל 40 ₪ — לעצור', due_date: '2026-10-13' },
    { title: 'להעלות תקציב יומי', due_date: '2026-10-28' },
  ], { source: 'ai' });
  tasks.createTasks(OTHER, [{ title: 'משימה בלי אחראי', due_date: '2026-10-12' }]);

  // No owner yet: nothing to send, and it is counted rather than dropped silently.
  let run = await tasks.runReminders(at('2026-10-13', 10));
  assert.equal(run.sent, 0);
  assert.equal(run.unassigned, 2);

  tasks.setTaskOwner(SHOW, 'yuval');

  // Before 9:00 nothing goes out.
  run = await tasks.runReminders(at('2026-10-13', 8));
  assert.equal(run.sent, 0);
  assert.equal(sent.length, 0);

  run = await tasks.runReminders(at('2026-10-13', 9));
  assert.equal(run.sent, 1);
  assert.equal(run.tasks, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'yuval@example.com');
  assert.match(sent[0].subject, /לבדוק הוצאה מול כרטיסים/);
  const token = (db.prepare('SELECT done_token FROM campaign_tasks WHERE id = ?').get(weekIn.id) as any).done_token;
  assert.ok(sent[0].html.includes(`https://im-tools.org/api/public/campaign-tasks/${token}`), 'done link, base without the trailing slash');

  // Ten minutes later, the same day: already sent.
  run = await tasks.runReminders(at('2026-10-13', 10));
  assert.equal(run.sent, 0);

  // Two days later it is still open — reminded again.
  run = await tasks.runReminders(at('2026-10-15', 9));
  assert.equal(run.tasks, 1);
  assert.equal(tasks.getTask(weekIn.id).reminders_sent, 2);

  tasks.updateTask(weekIn.id, { done: true });
  run = await tasks.runReminders(at('2026-10-17', 9));
  assert.equal(run.sent, 0);

  // Postponing restarts the reminders for the new date.
  tasks.updateTask(weekBefore.id, { due_date: '2026-10-29' });
  assert.equal(tasks.getTask(weekBefore.id).last_reminded_on, null);
});

test('the email lists every due task for that person in one message', () => {
  const rows: any[] = [
    { id: 'a', title: 'ראשונה', detail: 'פירוט <b>', due_date: '2026-10-10', done_token: 'tok-a', venue: 'זאפה', date: '2026-11-04' },
    { id: 'b', title: 'שנייה', detail: null, due_date: '2026-10-13', done_token: 'tok-b', venue: 'בארבי', date: '2026-11-20' },
  ];
  const mail = tasks.reminderEmail('יובל', rows, '2026-10-13', null);
  assert.match(mail.subject, /2 משימות \(1 באיחור\)/);
  assert.ok(mail.html.includes('פירוט &lt;b&gt;'), 'detail is escaped');
  assert.ok(!mail.html.includes('/api/public/'), 'no done link without a base URL');
  assert.match(mail.text, /באיחור \(היה ל-10\/10\)/);
});

test('ad copy is found wherever Meta keeps it for that kind of ad', () => {
  const link = extractAdCopy({
    id: '1', campaign_id: 'c1', name: 'ad', effective_status: 'ACTIVE',
    creative: { object_story_spec: { link_data: {
      message: 'ב-4 בנובמבר חוזרים לזאפה', name: 'Moonlight בזאפה | 4.11', description: 'מספר המקומות מוגבל',
      link: 'https://tickets.example', call_to_action: { type: 'BUY_TICKETS' } } } },
  });
  assert.equal(link.primary_text, 'ב-4 בנובמבר חוזרים לזאפה');
  assert.equal(link.headline, 'Moonlight בזאפה | 4.11');
  assert.equal(link.description, 'מספר המקומות מוגבל');
  assert.equal(link.call_to_action, 'BUY_TICKETS');
  assert.equal(link.status, 'ACTIVE');

  const video = extractAdCopy({
    id: '2', campaign_id: 'c1',
    creative: { object_story_spec: { video_data: { message: 'וידאו', title: 'כותרת וידאו', link_description: 'תיאור וידאו' } } },
  });
  assert.deepEqual([video.primary_text, video.headline, video.description], ['וידאו', 'כותרת וידאו', 'תיאור וידאו']);

  const dynamic = extractAdCopy({
    id: '3', campaign_id: 'c2',
    creative: { asset_feed_spec: { bodies: [{ text: 'גוף' }, { text: 'אחר' }], titles: [{ text: 'כותרת' }], descriptions: [] } },
  });
  assert.deepEqual([dynamic.primary_text, dynamic.headline, dynamic.description], ['גוף', 'כותרת', null]);

  const post = extractAdCopy({ id: '4', campaign_id: 'c3', creative: { body: '  פוסט קיים  ', title: '' } });
  assert.deepEqual([post.primary_text, post.headline], ['פוסט קיים', null]);
});
