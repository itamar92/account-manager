/**
 * בדיקת מצב — a second opinion on a campaign that is already under way.
 *
 * A plan (`draftCampaign`) is written before the money goes out. A week later the question is
 * different: the plan said 50 ₪ a day and a check on the 28th, the campaign has spent 600 ₪, the
 * club's page says «כרטיסים אחרונים» — so carry on, push, change the ad, or stop? That needs the
 * plan and what has happened since side by side, which is what this run is given: the plan, the
 * show's tasks and which were done, the campaigns tied to the show with their daily spend, what the
 * club's site said about tickets, and the last review, so the answer can say what changed.
 *
 * Like every advisor answer it is text for a person. A decision that is one click — pause, a new
 * daily budget, an end date — also comes back as an action, previewed against Meta before the owner
 * may confirm it (`metaActions.ts`); anything else is carried out in Ads Manager by hand, and the
 * tasks it proposes are offered, not added.
 */
import { db } from './db.js';
import { AgentError } from './agentClient.js';
import {
  ask, buildContext, buildPrompt, cleanSuggestedTasks, lastReport, saveReport, type StoredReport,
} from './campaignAdvisor.js';
import { checkTickets, lastTicketCheck, ticketLinks } from './ticketCheck.js';
import { campaignDaily, listCampaigns } from './metaSync.js';
import { eventLabel } from './band.js';
import { addDays, israelDate } from './campaignTasks.js';
import { ACTIONS_GUIDE, ACTIONS_SCHEMA, cleanActions } from './metaActions.js';

export const REVIEW_STATUSES = ['on_track', 'at_risk', 'off_track', 'not_started', 'finished'] as const;
export const REVIEW_ACTIONS = [
  'continue', 'raise_budget', 'lower_budget', 'change_creative', 'change_audience',
  'start_campaign', 'pause', 'stop', 'wait',
] as const;

/** A ticket check this recent is read rather than repeated before a review. */
const FRESH_TICKET_CHECK_HOURS = 12;

const REVIEW_SCHEMA = `{
  "status": "on_track" | "at_risk" | "off_track" | "not_started" | "finished",
  "headline": "משפט אחד בעברית: איפה הקמפיין עומד מול התוכנית",
  "days_left": number,
  "progress": [
    { "label": "מה נמדד (הוצאה, תקציב יומי, תאריכים, כרטיסים, משימה…)", "planned": "מה התוכנית אמרה",
      "actual": "מה קרה בפועל", "ok": true | false | null }
  ],
  "decision": {
    "action": "continue" | "raise_budget" | "lower_budget" | "change_creative" | "change_audience" | "start_campaign" | "pause" | "stop" | "wait",
    "title": "ההחלטה המומלצת במשפט קצר",
    "detail": "מה בדיוק לעשות ב-Ads Manager: שם הקמפיין, ההגדרה, מהערך הנוכחי לערך החדש",
    "condition": "מתי לחזור ולבדוק, ולפי איזה סף מספרי להחליט אחרת"
  },
  "alternatives": [ { "title": "אפשרות אחרת", "detail": "מה היא אומרת", "when": "מתי עדיף לבחור בה" } ],
  "tickets": "מה ידוע על מכירת הכרטיסים, ומאיפה (אתר המועדון / הספרים / לא ידוע)",
  "tasks": [ { "title": "פעולה קצרה לביצוע", "detail": "מה בדיוק ולפי איזה סף", "due_date": "YYYY-MM-DD" } ],
  "questions": ["שאלה למשתמש שהתשובה עליה תשנה את ההחלטה"],
  ${ACTIONS_SCHEMA}
}`;

/** Keeps what the screen renders, in the shape it expects. Unknown enums read as nothing said. */
export function normaliseReview(data: any) {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const decision = data?.decision && typeof data.decision === 'object' ? data.decision : null;
  return {
    status: REVIEW_STATUSES.includes(data?.status) ? data.status : null,
    headline: text(data?.headline),
    days_left: typeof data?.days_left === 'number' && Number.isFinite(data.days_left) ? Math.round(data.days_left) : null,
    progress: list(data?.progress)
      .filter((p: any) => text(p?.label))
      .map((p: any) => ({
        label: text(p.label), planned: text(p.planned), actual: text(p.actual),
        ok: typeof p.ok === 'boolean' ? p.ok : null,
      })),
    decision: decision && text(decision.title)
      ? {
          action: REVIEW_ACTIONS.includes(decision.action) ? decision.action : null,
          title: text(decision.title),
          detail: text(decision.detail),
          condition: text(decision.condition),
        }
      : null,
    alternatives: list(data?.alternatives)
      .filter((a: any) => text(a?.title))
      .map((a: any) => ({ title: text(a.title), detail: text(a.detail), when: text(a.when) })),
    tickets: text(data?.tickets),
    tasks: cleanSuggestedTasks(data?.tasks),
    questions: list(data?.questions).map(text).filter((q): q is string => !!q),
    actions: cleanActions(data?.actions),
  };
}

/** The campaigns tied to this show, each with its daily curve — what the plan is measured against. */
function showCampaigns(eventId: string) {
  return listCampaigns()
    .filter((c: any) => c.events.some((e: any) => e.event_id === eventId))
    .map((c: any) => ({
      campaign_id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      first_spend_date: c.first_spend_date,
      last_spend_date: c.last_spend_date,
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      reach: c.reach,
      synced_at: c.synced_at ?? null,
      shared_with: c.events.filter((e: any) => e.event_id !== eventId).map((e: any) => e.label),
      daily: campaignDaily(c.id),
    }));
}

const hoursSince = (sqliteUtc: string) => {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(sqliteUtc) ? sqliteUtc : `${sqliteUtc.replace(' ', 'T')}Z`;
  return (Date.now() - Date.parse(iso)) / 3_600_000;
};

export async function reviewCampaign(
  eventId: string,
  options: { note?: string; checkTickets?: boolean } = {}
): Promise<{ review: StoredReport; tickets: StoredReport | null; ticket_error?: string }> {
  const event = db
    .prepare('SELECT id, venue, date, tickets, capacity, amount_pre_vat FROM band_events WHERE id = ?')
    .get(eventId) as { id: string; venue: string; date: string; tickets: number; capacity: number; amount_pre_vat: number } | undefined;
  if (!event) throw new AgentError('ההופעה לא נמצאה', 404);
  const note = (options.note ?? '').trim();
  const today = israelDate();

  // The club's page first, unless it was read recently — the one live number a review can have.
  // A check that fails does not stop the review: it is reported beside it, and the review is told
  // that the ticket status is unknown rather than given a stale one as if it were today's.
  let tickets = lastTicketCheck(eventId);
  let ticketError: string | undefined;
  const stale = !tickets || hoursSince(tickets.created_at) > FRESH_TICKET_CHECK_HOURS;
  if (options.checkTickets && stale && event.date >= addDays(today, -1)) {
    try {
      tickets = await checkTickets(eventId);
    } catch (err: any) {
      ticketError = String(err?.message || err);
    }
  }

  const plan = lastReport('draft', {}, eventId);
  const previous = lastReport('review', {}, eventId);
  const tasks = db
    .prepare(
      `SELECT title, detail, due_date, done_at, source FROM campaign_tasks
       WHERE event_id = ? ORDER BY due_date, created_at`
    )
    .all(eventId);

  const context = {
    ...buildContext({}),
    target_show: {
      ...event,
      label: eventLabel(event.venue, event.date),
      days_left: Math.round((Date.parse(event.date) - Date.parse(today)) / 86_400_000),
      ...ticketLinks(eventId),
    },
    plan: plan ? { created_at: plan.created_at, brief: plan.request?.brief ?? null, ...plan.response } : null,
    show_tasks: tasks,
    show_campaigns: showCampaigns(eventId),
    ticket_check: tickets ? { checked_at: tickets.created_at, ...tickets.response } : null,
    ticket_check_error: ticketError ?? null,
    previous_review: previous ? { created_at: previous.created_at, ...previous.response } : null,
    note: note || null,
  };

  const label = context.target_show.label;
  const prompt = buildPrompt(
    [
      `בדוק את מצב הקמפיין של ההופעה ${label} (${event.date}) ועזור להחליט מה לעשות עכשיו.`,
      `היום ${today}. נשארו ${context.target_show.days_left} ימים עד ההופעה.`,
      '',
      'מה יש לך:',
      '- plan: התוכנית שנבנתה לקמפיין (אם יש). השווה אליה: תקציב יומי וכולל, תאריכים, קהל ומטרה.',
      '- show_campaigns: הקמפיינים ששויכו להופעה, עם ההוצאה היומית (daily). זה מה שקרה בפועל.',
      '  אם אין קמפיינים משויכים — ייתכן שהקמפיין עוד לא התחיל או שלא שויך; אמור זאת.',
      '- show_tasks: משימות המעקב של ההופעה, ומה כבר בוצע (done_at).',
      '- ticket_check: מה אתר המועדון אמר על הכרטיסים ומתי נבדק. ticket_check_error: אם הבדיקה נכשלה.',
      '  target_show.tickets הוא מספר הכרטיסים מהספרים — לרוב מתעדכן רק אחרי ההופעה.',
      '- previous_review: הבדיקה הקודמת. אם יש — אמור מה השתנה מאז, ואם ההחלטה הקודמת עבדה.',
      '- note: מה המשתמש כתב עכשיו (אם כתב).',
      '',
      'מה להחזיר:',
      '- status ו-headline: איפה הקמפיין עומד מול התוכנית והזמן שנשאר.',
      '- progress: 3-6 שורות של «תוכנית מול בפועל», כל אחת עם מספרים מהנתונים.',
      '- decision: החלטה אחת ברורה עכשיו, לפי הזמן שנשאר (ראה כללי השיפוט), עם תנאי מספרי לבדיקה הבאה.',
      '- alternatives: 1-3 אפשרויות אחרות ומתי לבחור בהן, כדי שהמשתמש יוכל להחליט.',
      '- tasks: רק משימות חדשות שחסרות (לא כאלה שכבר ב-show_tasks), עם due_date בין היום ליומיים אחרי ההופעה.',
      '- questions: רק אם תשובה של המשתמש באמת תשנה את ההחלטה. אחרת מערך ריק.',
      'אם יש לך כלי Meta — בדוק את הקמפיינים של ההופעה ברמת קבוצת המודעות והמודעה (תקציב יומי נוכחי, מצב,',
      'צפיות בדף הנחיתה, תדירות) לפני שאתה מחליט, וציין מה ראית.',
      '',
      ACTIONS_GUIDE,
      'כשההחלטה (decision) היא השהיה, עצירה, הפעלה או שינוי תקציב — החזר אותה גם כפעולה, עם campaign_id מ-show_campaigns.',
      'מעקב: בדוק ב-tracking.venues אם הפיקסל באתר הכרטיסים של המועדון, והתייחס לכך בהחלטה ובחלופות.',
      '',
      'כתוב הכל בעברית.',
    ].join('\n'),
    REVIEW_SCHEMA,
    context
  );

  const { data, duration_ms } = await ask(prompt);
  const review = saveReport({
    kind: 'review', range: {}, eventId,
    request: { event_id: eventId, note: note || null, plan_id: plan?.id ?? null, tickets_id: tickets?.id ?? null },
    response: normaliseReview(data),
    durationMs: duration_ms,
  });
  return { review, tickets, ...(ticketError ? { ticket_error: ticketError } : {}) };
}
