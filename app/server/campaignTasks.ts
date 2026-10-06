/**
 * משימות קמפיין — the dates a campaign plan implies, kept and chased.
 *
 * A plan from the advisor ends in things to do later: "a week in, compare the spend to tickets
 * sold", "a week before the show, raise the daily budget". Read once on a screen, those are gone
 * by the time they matter. Here each becomes a row with a due date, and the band member who owns
 * the show's promotion gets an email on that date — and again every two days while it stays open.
 *
 * One owner per show, not per task: a show's campaign is one person's job, and splitting it by
 * task would leave every reminder with somebody who does not hold the rest of the picture.
 *
 * The reminder carries a one-click «בוצע» link (see `publicCampaignTaskRouter`), because most of
 * the band reads the app through a shared login or not at all, and a reminder nobody can stop is
 * one everybody learns to ignore.
 */
import { randomBytes } from 'crypto';
import { Router } from 'express';
import { db, uuid } from './db.js';
import { eventLabel } from './moonlight.js';
import { isMailConfigured, sendMail } from './mailer.js';

export class TaskError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** A reminder goes out on the due date, then again every this many days until it is done. */
export const REMINDER_REPEAT_DAYS = 2;
/** Nothing is sent before this hour, Israel time — a reminder at 3am is read at 9 anyway. */
export const REMINDER_HOUR = 9;
/** How often the scheduler looks. Sends are keyed by date, so a shorter tick only means sooner. */
const TICK_MS = 10 * 60_000;

const ZONE = 'Asia/Jerusalem';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- dates

/** Today's date in Israel, which is the date a due date means — not the server's UTC date. */
export function israelDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
}

export function israelHour(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return parseInt(hour, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ddmm = (date: string) => {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
};

/**
 * Whether an open task is owed a reminder today: it is due (or overdue), and the last reminder
 * — if any — was at least REMINDER_REPEAT_DAYS ago.
 */
export function isReminderDue(task: { due_date: string; done_at: string | null; last_reminded_on: string | null }, today: string): boolean {
  if (task.done_at) return false;
  if (task.due_date > today) return false;
  if (!task.last_reminded_on) return true;
  return task.last_reminded_on <= addDays(today, -REMINDER_REPEAT_DAYS);
}

// ---------------------------------------------------------------- reads

export interface CampaignTask {
  id: string;
  event_id: string;
  title: string;
  detail: string | null;
  due_date: string;
  done_at: string | null;
  source: 'manual' | 'ai';
  report_id: string | null;
  last_reminded_on: string | null;
  reminders_sent: number;
  created_at: string;
}

const TASK_COLUMNS = `id, event_id, title, detail, due_date, done_at, source, report_id,
  last_reminded_on, reminders_sent, created_at`;

/**
 * Every show that has tasks or an owner, with both. Shows whose date is long past and whose tasks
 * are all done drop off unless `all` is asked for — the list is a to-do list, not an archive.
 */
export function listTaskShows(options: { all?: boolean } = {}) {
  const tasks = db.prepare(`SELECT ${TASK_COLUMNS} FROM campaign_tasks ORDER BY due_date, created_at`).all() as CampaignTask[];
  const owners = db.prepare('SELECT event_id, member_key FROM campaign_task_owners').all() as
    Array<{ event_id: string; member_key: string }>;

  const ids = new Set([...tasks.map((t) => t.event_id), ...owners.map((o) => o.event_id)]);
  if (ids.size === 0) return [];
  const events = db
    .prepare(`SELECT id, venue, date FROM band_events WHERE id IN (${[...ids].map(() => '?').join(',')})`)
    .all(...ids) as Array<{ id: string; venue: string; date: string }>;

  const today = israelDate();
  const shows = events.map((event) => {
    const own = tasks.filter((t) => t.event_id === event.id);
    return {
      event_id: event.id,
      label: eventLabel(event.venue, event.date),
      date: event.date,
      owner: owners.find((o) => o.event_id === event.id)?.member_key ?? null,
      open: own.filter((t) => !t.done_at).length,
      tasks: own,
    };
  });

  return shows
    .filter((s) => options.all || s.open > 0 || s.date >= addDays(today, -14))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- writes

function cleanTask(input: any, { partial = false } = {}) {
  const out: { title?: string; detail?: string | null; due_date?: string } = {};
  if (!partial || input.title !== undefined) {
    const title = String(input.title ?? '').trim();
    if (!title) throw new TaskError('חסרה כותרת למשימה');
    out.title = title.slice(0, 300);
  }
  if (!partial || input.detail !== undefined) {
    const detail = String(input.detail ?? '').trim();
    out.detail = detail ? detail.slice(0, 2000) : null;
  }
  if (!partial || input.due_date !== undefined) {
    const due = String(input.due_date ?? '').trim();
    if (!DATE_RE.test(due) || Number.isNaN(Date.parse(due))) throw new TaskError('תאריך יעד לא תקין');
    out.due_date = due;
  }
  return out;
}

function requireEvent(eventId: string) {
  const event = db.prepare('SELECT id FROM band_events WHERE id = ?').get(eventId);
  if (!event) throw new TaskError('ההופעה לא נמצאה', 404);
}

const newToken = () => randomBytes(24).toString('base64url');

/** Adds tasks to a show — typed by hand, or accepted from an advisor draft (`source: 'ai'`). */
export function createTasks(
  eventId: string,
  inputs: any[],
  options: { source?: 'manual' | 'ai'; reportId?: string | null } = {}
): CampaignTask[] {
  requireEvent(eventId);
  if (!Array.isArray(inputs) || inputs.length === 0) throw new TaskError('אין משימות להוספה');
  const cleaned = inputs.slice(0, 50).map((input) => cleanTask(input));

  const insert = db.prepare(
    `INSERT INTO campaign_tasks (id, event_id, title, detail, due_date, source, report_id, done_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ids: string[] = [];
  db.transaction(() => {
    for (const task of cleaned) {
      const id = uuid();
      insert.run(id, eventId, task.title, task.detail, task.due_date, options.source ?? 'manual',
        options.reportId ?? null, newToken());
      ids.push(id);
    }
  })();
  return ids.map(getTask);
}

export function getTask(id: string): CampaignTask {
  const task = db.prepare(`SELECT ${TASK_COLUMNS} FROM campaign_tasks WHERE id = ?`).get(id) as CampaignTask | undefined;
  if (!task) throw new TaskError('המשימה לא נמצאה', 404);
  return task;
}

/**
 * Edits a task. Moving the due date clears the reminder state, so a task postponed to next week
 * is reminded of next week rather than counted as already chased.
 */
export function updateTask(id: string, patch: any): CampaignTask {
  const current = getTask(id);
  const fields = cleanTask(patch ?? {}, { partial: true });
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (fields.due_date && fields.due_date !== current.due_date) {
    sets.push('last_reminded_on = NULL');
  }
  if (patch?.done !== undefined) {
    sets.push('done_at = ?');
    params.push(patch.done ? (current.done_at ?? new Date().toISOString()) : null);
  }
  if (sets.length) db.prepare(`UPDATE campaign_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getTask(id);
}

export function deleteTask(id: string): void {
  const info = db.prepare('DELETE FROM campaign_tasks WHERE id = ?').run(id);
  if (!info.changes) throw new TaskError('המשימה לא נמצאה', 404);
}

/** Who gets the show's reminders. Null clears it, and the show's tasks then go unsent. */
export function setTaskOwner(eventId: string, memberKey: string | null): { event_id: string; owner: string | null } {
  requireEvent(eventId);
  if (!memberKey) {
    db.prepare('DELETE FROM campaign_task_owners WHERE event_id = ?').run(eventId);
    return { event_id: eventId, owner: null };
  }
  const member = db.prepare('SELECT member_key FROM band_members WHERE member_key = ?').get(memberKey);
  if (!member) throw new TaskError('חבר הלהקה לא נמצא', 404);
  db.prepare(
    `INSERT INTO campaign_task_owners (event_id, member_key) VALUES (?, ?)
     ON CONFLICT(event_id) DO UPDATE SET member_key = excluded.member_key`
  ).run(eventId, memberKey);
  return { event_id: eventId, owner: memberKey };
}

// ---------------------------------------------------------------- the email

interface ReminderRow extends CampaignTask {
  done_token: string;
  venue: string;
  date: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function publicBase(): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  return base || null;
}

/** One email per person per day, listing everything of theirs that is due — never one per task. */
export function reminderEmail(name: string, rows: ReminderRow[], today: string, base: string | null) {
  const overdue = rows.filter((r) => r.due_date < today).length;
  const subject = rows.length === 1
    ? `תזכורת קמפיין: ${rows[0].title} · ${eventLabel(rows[0].venue, rows[0].date)}`
    : `תזכורת קמפיין: ${rows.length} משימות${overdue ? ` (${overdue} באיחור)` : ''}`;

  const lines = rows.map((r) => {
    const show = eventLabel(r.venue, r.date);
    const late = r.due_date < today ? ` — באיחור (היה ל-${ddmm(r.due_date)})` : '';
    const done = base ? `\n  סימון כבוצע: ${base}/api/public/campaign-tasks/${r.done_token}` : '';
    return `• ${r.title} [${show}]${late}${r.detail ? `\n  ${r.detail}` : ''}${done}`;
  });
  const text = [
    `היי ${name},`,
    '',
    'אלה משימות הקמפיין שמחכות לך:',
    '',
    ...lines,
    '',
    base ? `כל המשימות: ${base}/moonlight/campaignAi` : '',
    `התזכורת תחזור כל ${REMINDER_REPEAT_DAYS} ימים עד שהמשימה תסומן כבוצעה.`,
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');

  const items = rows.map((r) => {
    const show = escapeHtml(eventLabel(r.venue, r.date));
    const late = r.due_date < today
      ? `<span style="color:#b42318;font-size:13px"> · באיחור, היה ל-${ddmm(r.due_date)}</span>`
      : '';
    const detail = r.detail
      ? `<div style="color:#555;font-size:14px;margin-top:4px;white-space:pre-wrap">${escapeHtml(r.detail)}</div>`
      : '';
    const done = base
      ? `<div style="margin-top:8px"><a href="${escapeHtml(`${base}/api/public/campaign-tasks/${r.done_token}`)}"
           style="display:inline-block;background:#6b45d6;color:#fff;text-decoration:none;padding:6px 14px;border-radius:8px;font-size:13px">סימון כבוצע</a></div>`
      : '';
    return `<div style="border:1px solid #e4e1ee;border-radius:12px;padding:12px 14px;margin-bottom:10px">
      <div style="font-weight:bold">${escapeHtml(r.title)}</div>
      <div style="color:#888;font-size:13px">${show}${late}</div>${detail}${done}</div>`;
  }).join('');

  const html = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#241d3d;line-height:1.5">
    <p>היי ${escapeHtml(name)},</p>
    <p>אלה משימות הקמפיין שמחכות לך:</p>
    ${items}
    ${base ? `<p><a href="${escapeHtml(`${base}/moonlight/campaignAi`)}" style="color:#6b45d6">לכל המשימות באפליקציה</a></p>` : ''}
    <p style="color:#888;font-size:12px">התזכורת תחזור כל ${REMINDER_REPEAT_DAYS} ימים עד שהמשימה תסומן כבוצעה.</p>
  </div>`;

  return { subject, text, html };
}

// ---------------------------------------------------------------- sending

function reminderRows(where: string, params: unknown[]): Array<ReminderRow & { member_key: string | null; name: string | null; email: string | null }> {
  return db
    .prepare(
      `SELECT t.*, e.venue, e.date, o.member_key, m.name, m.email
       FROM campaign_tasks t
       JOIN band_events e ON e.id = t.event_id
       LEFT JOIN campaign_task_owners o ON o.event_id = t.event_id
       LEFT JOIN band_members m ON m.member_key = o.member_key
       WHERE ${where}
       ORDER BY t.due_date, e.date`
    )
    .all(...params) as any[];
}

function markReminded(ids: string[], today: string) {
  const mark = db.prepare(
    'UPDATE campaign_tasks SET last_reminded_on = ?, reminders_sent = reminders_sent + 1 WHERE id = ?'
  );
  db.transaction(() => { for (const id of ids) mark.run(today, id); })();
}

export interface ReminderRunResult {
  sent: number;
  tasks: number;
  /** Tasks owed a reminder that had nobody to send it to — no owner, or an owner with no email. */
  unassigned: number;
  errors: string[];
}

let running = false;

/**
 * One pass of the scheduler: every open task owed a reminder today, grouped by recipient, one
 * email each. A task is marked reminded only once its email went out, so a failed send is
 * retried on the next tick rather than lost.
 */
export async function runReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { sent: 0, tasks: 0, unassigned: 0, errors: [] };
  if (running || !isMailConfigured() || israelHour(now) < REMINDER_HOUR) return result;
  running = true;
  try {
    const today = israelDate(now);
    const due = reminderRows('t.done_at IS NULL AND t.due_date <= ?', [today]).filter((t) => isReminderDue(t, today));

    const byEmail = new Map<string, { name: string; rows: typeof due }>();
    for (const row of due) {
      const email = row.email?.trim();
      if (!email) { result.unassigned++; continue; }
      const entry = byEmail.get(email.toLowerCase()) ?? { name: row.name || '', rows: [] };
      entry.rows.push(row);
      byEmail.set(email.toLowerCase(), entry);
    }

    for (const [email, { name, rows }] of byEmail) {
      try {
        await sendMail({ to: email, ...reminderEmail(name, rows, today, publicBase()) });
        markReminded(rows.map((r) => r.id), today);
        result.sent++;
        result.tasks += rows.length;
      } catch (err) {
        result.errors.push(`${email}: ${(err as Error).message}`);
      }
    }
    if (result.errors.length) console.warn('[campaign-tasks] reminders failed:', result.errors.join(' | '));
    return result;
  } finally {
    running = false;
  }
}

/** Sends one task's reminder now, whatever its date — the «שליחת תזכורת» button, and a test. */
export async function remindNow(id: string, now: Date = new Date()): Promise<{ to: string }> {
  const [row] = reminderRows('t.id = ?', [id]);
  if (!row) throw new TaskError('המשימה לא נמצאה', 404);
  if (!row.member_key) throw new TaskError('לא נבחר אחראי להופעה — אין למי לשלוח');
  if (!row.email?.trim()) throw new TaskError(`ל${row.name ?? 'חבר הלהקה'} אין כתובת מייל בהגדרות הלהקה`);
  const today = israelDate(now);
  await sendMail({ to: row.email.trim(), ...reminderEmail(row.name || '', [row], today, publicBase()) });
  markReminded([row.id], today);
  return { to: row.email.trim() };
}

/** Starts the reminder loop. Unref'd, so it never holds the process open on its own. */
export function startReminderScheduler(): void {
  const tick = () => {
    runReminders().catch((err) => console.warn('[campaign-tasks] reminder run failed:', err?.message));
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, TICK_MS).unref();
}

// ---------------------------------------------------------------- the «בוצע» link

/**
 * The link in the reminder, mounted at /api/public/campaign-tasks — no login, the token is the
 * credential and it closes one task.
 *
 * The GET only shows a page with a button; the POST is what closes the task. Mail scanners and
 * link previews open every link in a message, and a GET that changed something would mark tasks
 * done before anybody read the email.
 */
export const publicCampaignTaskRouter = Router();

publicCampaignTaskRouter.use((_req, res, next) => {
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  next();
});

function page(title: string, body: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f6f5fa;color:#241d3d;margin:0;padding:24px 16px}
.card{max-width:440px;margin:40px auto;background:#fff;border:1px solid #e4e1ee;border-radius:16px;padding:24px}
h1{font-size:20px;margin:0 0 8px}p{color:#555;line-height:1.5}
button{background:#6b45d6;color:#fff;border:0;border-radius:10px;padding:10px 20px;font-size:16px;cursor:pointer}</style>
</head><body><div class="card">${body}</div></body></html>`;
}

function taskByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return db
    .prepare(
      `SELECT t.id, t.title, t.detail, t.done_at, e.venue, e.date FROM campaign_tasks t
       JOIN band_events e ON e.id = t.event_id WHERE t.done_token = ?`
    )
    .get(token) as { id: string; title: string; detail: string | null; done_at: string | null; venue: string; date: string } | undefined;
}

publicCampaignTaskRouter.get('/:token', (req, res) => {
  const task = taskByToken(req.params.token);
  if (!task) return res.status(404).send(page('לא נמצא', '<h1>המשימה לא נמצאה</h1><p>ייתכן שהיא נמחקה.</p>'));
  const heading = `<h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(eventLabel(task.venue, task.date))}</p>`;
  if (task.done_at) return res.send(page('בוצע', `${heading}<p>✓ המשימה כבר מסומנת כבוצעה.</p>`));
  res.send(page('סימון כבוצע', `${heading}
    ${task.detail ? `<p style="white-space:pre-wrap">${escapeHtml(task.detail)}</p>` : ''}
    <form method="post"><button type="submit">סימון כבוצע</button></form>`));
});

publicCampaignTaskRouter.post('/:token', (req, res) => {
  const task = taskByToken(req.params.token);
  if (!task) return res.status(404).send(page('לא נמצא', '<h1>המשימה לא נמצאה</h1>'));
  if (!task.done_at) db.prepare('UPDATE campaign_tasks SET done_at = ? WHERE id = ?').run(new Date().toISOString(), task.id);
  res.send(page('בוצע', `<h1>${escapeHtml(task.title)}</h1><p>✓ סומן כבוצע. לא יישלחו עוד תזכורות על המשימה הזו.</p>`));
});
