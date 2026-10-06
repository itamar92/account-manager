/**
 * יועץ קמפיינים — the judgement layer over the ad data.
 *
 * The פרסום tab already answers *what* a show's promotion cost: spend per show, cost per ticket,
 * spend as a share of the fee. What it cannot answer is whether any of that was good, why one
 * show's campaign sold tickets and another's did not, and what to buy differently next time.
 * That is a reading-comprehension problem, so it goes to the agent over SSH (`agentClient.ts`).
 *
 * The context is assembled from the readers that already exist in `metaSync.ts` rather than from
 * fresh SQL. Two tabs disagreeing about what a show's ads cost would be worse than either of them
 * being wrong, and the only way to guarantee they agree is to compute it once.
 *
 * The agent gets a JSON document and returns a JSON document. It has no database handle, no Meta
 * token and no write path: nothing it says takes effect until a person acts on it.
 */

import { db, uuid, setSetting } from './db.js';
import { runAgent, AgentError } from './agentClient.js';
import { adAnalysis, campaignDaily, listCampaigns, monthlyBreakdown, pastAdCopy } from './metaSync.js';
import { eventLabel } from './moonlight.js';
import { israelDate } from './campaignTasks.js';

// ---------------------------------------------------------------- context

/** How many campaigns' daily curves are worth sending. The long tail is noise in a prompt. */
const DAILY_CURVE_CAMPAIGNS = 12;
/** How many distinct past ads' wording to send — enough to hear the band's voice, newest first. */
const PAST_ADS = 30;

export interface AdviserContext {
  generated_at: string;
  /** Today in Israel — what every date the agent writes is relative to. */
  today: string;
  range: { from?: string; to?: string };
  totals: ReturnType<typeof adAnalysis>['totals'];
  shows: Array<Record<string, unknown>>;
  campaigns: Array<Record<string, unknown>>;
  monthly: ReturnType<typeof monthlyBreakdown>['months'];
  upcoming_shows: Array<{ id: string; label: string; date: string; venue: string; tickets: number }>;
  /** What the band's earlier ads said, by campaign — join to `campaigns` for how each did. */
  past_ads: ReturnType<typeof pastAdCopy>;
}

/**
 * Everything the agent is allowed to reason from, and nothing else.
 *
 * Deliberately narrower than the database: no member names, no division, no bank detail, no
 * supplier debt. A campaign question needs shows, tickets, money in, money out and the campaigns
 * themselves — sending the rest would be handing an outside process the band's payroll for no
 * gain in the answer.
 */
export function buildContext(range: { from?: string; to?: string } = {}): AdviserContext {
  const analysis = adAnalysis(range);
  const campaigns = listCampaigns();

  // The daily curve is what says whether the money went out in time to sell a ticket — a campaign
  // that spent everything in the last two days reads very differently from one that ramped. Only
  // for the campaigns that actually spent, biggest first, so the prompt stays readable.
  const curved = [...campaigns]
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, DAILY_CURVE_CAMPAIGNS);
  const curves = new Map(curved.map((c) => [c.id, campaignDaily(c.id)]));

  const upcoming = (
    db
      .prepare(
        `SELECT id, venue, date, tickets FROM band_events
         WHERE date >= date('now') ORDER BY date LIMIT 20`
      )
      .all() as Array<{ id: string; venue: string; date: string; tickets: number }>
  ).map((e) => ({ ...e, label: eventLabel(e.venue, e.date) }));

  return {
    generated_at: new Date().toISOString(),
    today: israelDate(),
    range,
    totals: analysis.totals,
    shows: analysis.rows.map((row) => ({
      event_id: row.event_id,
      label: row.label,
      date: row.date,
      venue: row.venue,
      tickets: row.tickets,
      revenue: row.revenue,
      ad_spend: row.ad_spend,
      cost_per_ticket: row.cost_per_ticket,
      spend_share_of_revenue: row.spend_share_of_revenue,
      impressions: row.impressions,
      clicks: row.clicks,
      campaigns: row.campaigns,
      profit: row.profit,
    })),
    campaigns: campaigns.map((c) => ({
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
      mapped_shows: c.events.map((e: any) => ({ event_id: e.event_id, label: e.label, attributed: e.attributed })),
      daily: curves.get(c.id) ?? undefined,
    })),
    monthly: monthlyBreakdown(range).months,
    upcoming_shows: upcoming,
    past_ads: pastAdCopy(PAST_ADS),
  };
}

// ---------------------------------------------------------------- prompts

/**
 * What the agent needs to know about this band to judge a campaign at all.
 *
 * The economics are the whole point: a Moonlight campaign is not selling a product with a margin,
 * it is filling a room on one night for a fee that is fixed before the ads start. So reach and
 * impressions are means, tickets are the end, and a campaign that spent well after the show is
 * money that could not possibly have worked.
 */
const BAND_BRIEF = `
אתה יועץ פרסום דיגיטלי של להקת "Moonlight" — להקת הופעות חיה בישראל.
הלהקה מפרסמת הופעות בפייסבוק ובאינסטגרם דרך Meta Ads. הכלכלה של קמפיין כאן:

- לכל הופעה יש תאריך אחד. אחרי התאריך, כל שקל שהקמפיין ממשיך להוציא הוא בזבוז מוחלט.
- ההכנסה מהופעה היא לרוב סכום קבוע שסוכם מראש מול המקום, ולפעמים תלויה בכרטיסים.
- המדד שקובע הוא «עלות לכרטיס» (ad_spend חלקי tickets) ו«אחוז הפרסום מההכנסה».
  חשיפות וקליקים הם אמצעי בלבד — הם לא מצדיקים קמפיין שלא מכר כרטיסים.
- קהל היעד הוא ישראלי, דובר עברית, ומיקום גאוגרפי סביב מקום ההופעה הוא קריטי.
- תקציבים קטנים: קמפיין טיפוסי הוא מאות עד אלפי שקלים בודדים.

כל הסכומים בשקלים חדשים. כל התאריכים בפורמט YYYY-MM-DD.
`.trim();

/** Wraps a task and its schema around the context, and demands JSON and nothing else. */
function buildPrompt(task: string, schema: string, context: unknown): string {
  return [
    BAND_BRIEF,
    '',
    task,
    '',
    'החזר אך ורק אובייקט JSON יחיד בפורמט הבא, ללא טקסט לפניו או אחריו, ללא הסברים וללא קוד:',
    schema,
    '',
    'הנתונים:',
    JSON.stringify(context),
  ].join('\n');
}

// ---------------------------------------------------------------- parsing

/**
 * Digs the model's answer out of what came back on stdout.
 *
 * Two layers to peel. `--output-format json` wraps the answer in the CLI's own envelope, whose
 * `result` field holds the text; and the text itself may be a bare object, a fenced block, or an
 * object with a sentence in front of it however firmly the prompt asked otherwise. Everything
 * failing is reported as a failure with the raw tail attached — a half-parsed report that renders
 * as an empty verdict is worse than an error, because it looks like an answer.
 */
export function parseAgentJson(stdout: string): any {
  const attempt = (text: string): any | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch { /* not bare JSON — try the shapes below */ }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch { /* fall through */ }
    }
    const braced = trimmed.match(/\{[\s\S]*\}/);
    if (braced) {
      try {
        return JSON.parse(braced[0]);
      } catch { /* fall through */ }
    }
    return null;
  };

  const outer = attempt(stdout);
  // The CLI envelope: `{ type: 'result', result: '…the answer…' }`. An answer that already parsed
  // into the shape we wanted is left alone.
  if (outer && typeof outer === 'object' && typeof outer.result === 'string') {
    const inner = attempt(outer.result);
    if (inner) return inner;
    throw new AgentError(`תשובת הסוכן אינה JSON תקין: ${outer.result.slice(0, 300)}`);
  }
  if (outer) return outer;

  throw new AgentError(`תשובת הסוכן אינה JSON תקין: ${stdout.trim().slice(-300) || '(ריק)'}`);
}

/** Runs the agent, records how it went, and hands back the parsed object. */
async function ask(prompt: string): Promise<{ data: any; duration_ms: number }> {
  const run = await runAgent(prompt);
  if (run.code !== 0) {
    setSetting('agent_last_error', `exit ${run.code}: ${run.stderr.trim().slice(0, 300)}`);
    throw new AgentError(`הסוכן החזיר שגיאה: ${run.stderr.trim().slice(0, 300) || `קוד ${run.code}`}`);
  }
  const data = parseAgentJson(run.stdout);
  setSetting('agent_last_run', new Date().toISOString());
  setSetting('agent_last_error', '');
  return { data, duration_ms: run.duration_ms };
}

// ---------------------------------------------------------------- stored reports

export interface StoredReport {
  id: string;
  kind: string;
  range_from: string | null;
  range_to: string | null;
  event_id: string | null;
  response: any;
  duration_ms: number | null;
  created_at: string;
}

function saveReport(row: {
  kind: string;
  range: { from?: string; to?: string };
  eventId?: string | null;
  request: unknown;
  response: unknown;
  durationMs: number;
}): StoredReport {
  const id = uuid();
  db.prepare(
    `INSERT INTO ai_campaign_reports (id, kind, range_from, range_to, event_id, request, response, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, row.kind, row.range.from ?? null, row.range.to ?? null, row.eventId ?? null,
    JSON.stringify(row.request), JSON.stringify(row.response), row.durationMs
  );
  return {
    id,
    kind: row.kind,
    range_from: row.range.from ?? null,
    range_to: row.range.to ?? null,
    event_id: row.eventId ?? null,
    response: row.response,
    duration_ms: row.durationMs,
    created_at: new Date().toISOString(),
  };
}

/**
 * The most recent report of a kind for a range, or null.
 *
 * This is what the tab paints on load. A run takes a minute over SSH, so a page that started one
 * on every mount would be unusable — and an analysis of last month's shows does not go stale
 * between two page loads anyway.
 */
export function lastReport(kind: string, range: { from?: string; to?: string } = {}, eventId?: string): StoredReport | null {
  const row = db
    .prepare(
      `SELECT * FROM ai_campaign_reports
       WHERE kind = ?
         AND range_from IS ? AND range_to IS ?
         AND (? IS NULL OR event_id = ?)
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(kind, range.from ?? null, range.to ?? null, eventId ?? null, eventId ?? null) as any;
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    range_from: row.range_from,
    range_to: row.range_to,
    event_id: row.event_id,
    response: JSON.parse(row.response),
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------- the three asks

const ANALYSIS_SCHEMA = `{
  "verdict": "good" | "ok" | "poor",
  "headline": "משפט אחד בעברית שמסכם את מצב הפרסום בתקופה",
  "benchmarks": {
    "cost_per_ticket": number | null,
    "spend_share_of_revenue": number | null,
    "best_event_id": string | null,
    "worst_event_id": string | null
  },
  "findings": [
    { "severity": "high" | "medium" | "low", "title": "כותרת קצרה",
      "detail": "מה נמצא ולמה זה משנה", "event_id": string | null, "campaign_id": string | null }
  ],
  "suggestions": [
    { "title": "המלצה קצרה", "detail": "מה בדיוק לעשות",
      "expected_impact": "מה זה צפוי לשנות", "effort": "low" | "medium" | "high" }
  ]
}`;

export async function analyzeCampaigns(range: { from?: string; to?: string } = {}): Promise<StoredReport> {
  const context = buildContext(range);
  if (context.shows.length === 0) {
    throw new AgentError('אין הופעות בטווח הזה לנתח', 400);
  }

  const prompt = buildPrompt(
    [
      'נתח את ביצועי הפרסום של ההופעות בנתונים המצורפים.',
      'קבע verdict כולל, ציין ממצאים קונקרטיים (findings) שמסתמכים על מספרים מהנתונים,',
      'ותן המלצות מעשיות (suggestions) מדורגות מהחשובה לפחות חשובה.',
      'התייחס במפורש להופעות עם עלות לכרטיס חריגה, לקמפיינים שהמשיכו להוציא אחרי ההופעה,',
      'ולהוצאה שלא שויכה לאף הופעה (unmapped_spend) אם יש כזו.',
      'כל event_id ו-campaign_id חייבים להילקח מהנתונים — אל תמציא מזהים.',
      'כתוב הכל בעברית.',
    ].join('\n'),
    ANALYSIS_SCHEMA,
    context
  );

  const { data, duration_ms } = await ask(prompt);
  return saveReport({ kind: 'analysis', range, request: { range }, response: data, durationMs: duration_ms });
}

const DRAFT_SCHEMA = `{
  "objective": "מטרת הקמפיין ב-Meta",
  "audience": "תיאור קהל היעד: גיל, מיקום, תחומי עניין",
  "budget_total": number,
  "daily_budget": number,
  "schedule": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "placements": ["מיקום פרסום"],
  "creative": {
    "primary_text": "טקסט המודעה",
    "headline": "כותרת",
    "description": "תיאור",
    "headline_options": ["כותרת חלופית"],
    "description_options": ["תיאור חלופי"],
    "based_on": "על אילו מודעות קודמות (campaign_id ושם) הנוסח מבוסס ולמה" | null
  },
  "tasks": [
    { "title": "פעולה קצרה לביצוע", "detail": "מה בדיוק לבדוק או לשנות, ולפי איזה סף",
      "due_date": "YYYY-MM-DD" }
  ],
  "notes": ["הערה כללית שאינה משימה עם תאריך"]
}`;

/**
 * Keeps what the UI will render and drops what it cannot use. Tasks are the part that gets
 * written to the database, so a task without a real date or title is dropped here rather than
 * being offered and then refused when somebody presses «הוספה».
 */
export interface SuggestedTask {
  title: string;
  detail: string;
  due_date: string;
}

/** The tasks in an answer that could actually be saved — a title and a real date — and no others. */
export function cleanSuggestedTasks(list: unknown): SuggestedTask[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t: any) => typeof t?.title === 'string' && t.title.trim()
      && typeof t?.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date)
      && !Number.isNaN(Date.parse(t.due_date)))
    .map((t: any) => ({ title: t.title.trim(), detail: typeof t.detail === 'string' ? t.detail.trim() : '', due_date: t.due_date }));
}

function normaliseDraft(data: any) {
  // The chosen wording leads its own list of options, so swapping in an alternative on screen
  // never loses the one the plan started with.
  const options = (main: unknown, list: any) => [...new Set(
    [main, ...(Array.isArray(list) ? list : [])].filter((x): x is string => typeof x === 'string' && !!x.trim())
  )];
  return {
    ...data,
    creative: data?.creative
      ? {
          ...data.creative,
          headline_options: options(data.creative.headline, data.creative.headline_options),
          description_options: options(data.creative.description, data.creative.description_options),
        }
      : data?.creative,
    tasks: cleanSuggestedTasks(data?.tasks),
  };
}

export async function draftCampaign(eventId: string, brief: string): Promise<StoredReport> {
  const event = db
    .prepare('SELECT id, venue, date, tickets, amount_pre_vat FROM band_events WHERE id = ?')
    .get(eventId) as { id: string; venue: string; date: string; tickets: number; amount_pre_vat: number } | undefined;
  if (!event) throw new AgentError('ההופעה לא נמצאה', 404);

  // The whole history, not just the range on screen: a plan for a new show is worth building on
  // every campaign the band has ever run, and the tab's period filter is about reading, not this.
  const context = {
    ...buildContext({}),
    target_show: { ...event, label: eventLabel(event.venue, event.date) },
    brief: brief || null,
  };

  const prompt = buildPrompt(
    [
      `בנה תוכנית קמפיין להופעה: ${eventLabel(event.venue, event.date)} בתאריך ${event.date}.`,
      'הסתמך על מה שעבד ומה שלא עבד בקמפיינים הקודמים שבנתונים.',
      'התקציב חייב להיות ריאלי ביחס לתקציבים ההיסטוריים ולהכנסה הצפויה מההופעה.',
      'תאריך הסיום של הקמפיין לא יכול להיות אחרי תאריך ההופעה.',
      `היום ${context.today}. תאריך ההתחלה של הקמפיין לא יכול להיות לפני היום.`,
      brief ? `בקשה מיוחדת מהמשתמש: ${brief}` : '',
      '',
      'נוסח המודעה:',
      'כתוב את טקסט המודעה בעברית, בטון של להקת הופעות — לא שיווקי מדי.',
      'past_ads הן המודעות שהלהקה כבר הריצה. בנה את הכותרת והתיאור בסגנון שלהן, והעדף את הנוסחים',
      'של קמפיינים שמכרו כרטיסים בעלות נמוכה (חבר past_ads.campaign_id לקמפיינים ולהופעות שבנתונים).',
      'תן 2-3 חלופות לכותרת (headline_options) ו-2-3 חלופות לתיאור (description_options),',
      'וב-based_on כתוב על אילו מודעות קודמות התבססת. אם past_ads ריק — כתוב null ב-based_on.',
      '',
      'משימות מעקב (tasks):',
      'פרק את ניהול הקמפיין לרשימת פעולות עם תאריך יעד, שאדם יקבל עליהן תזכורת במייל באותו יום.',
      'למשל: ביום ההשקה לוודא שהמודעה אושרה ורצה; אחרי שבוע לבדוק כמה הוצא מול כמה כרטיסים נמכרו',
      'ולהחליט אם להמשיך; שבוע לפני ההופעה לבדוק מצב ולהעלות תקציב יומי אם המכירות חלשות;',
      'יום אחרי ההופעה לוודא שהקמפיין נעצר ולרשום כמה כרטיסים נמכרו.',
      'כל משימה: פעולה אחת, ניתנת לביצוע, עם ספים מספריים מהנתונים כשאפשר (למשל עלות לכרטיס מעל X).',
      'כל due_date בין היום לבין יומיים אחרי ההופעה, בסדר כרונולוגי, בדרך כלל 4-8 משימות.',
      'notes מיועד רק להערות כלליות שאין להן תאריך.',
    ].filter(Boolean).join('\n'),
    DRAFT_SCHEMA,
    context
  );

  const { data: raw, duration_ms } = await ask(prompt);
  const data = normaliseDraft(raw);
  return saveReport({
    kind: 'draft', range: {}, eventId, request: { event_id: eventId, brief }, response: data, durationMs: duration_ms,
  });
}

// ---------------------------------------------------------------- follow-up chat

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Tasks an answer proposed, each for one show. Empty for a question, or an answer with none. */
  tasks: Array<SuggestedTask & { event_id: string }>;
  created_at: string;
}

/** How much of a thread is replayed to the agent. Long enough to follow up, short enough to send. */
const CHAT_HISTORY_TURNS = 12;

export function chatHistory(threadId: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT * FROM ai_chat_messages WHERE thread_id = ? ORDER BY created_at, rowid')
    .all(threadId) as Array<Omit<ChatMessage, 'tasks'> & { tasks: string | null }>;
  return rows.map((row) => {
    let tasks: ChatMessage['tasks'] = [];
    try {
      tasks = row.tasks ? JSON.parse(row.tasks) : [];
    } catch { /* a row that cannot be read proposes nothing */ }
    return { ...row, tasks };
  });
}

export function clearChat(threadId: string): { deleted: number } {
  const info = db.prepare('DELETE FROM ai_chat_messages WHERE thread_id = ?').run(threadId);
  return { deleted: info.changes };
}

function appendChat(threadId: string, role: 'user' | 'assistant', content: string, tasks: ChatMessage['tasks'] = []) {
  db.prepare('INSERT INTO ai_chat_messages (id, thread_id, role, content, tasks) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), threadId, role, content, tasks.length ? JSON.stringify(tasks) : null);
}

/**
 * The tasks of a chat answer that name a real show. Unlike a draft, a chat answer is not about
 * one show fixed in advance, so every task carries its own event_id — and one the agent made up
 * is dropped rather than offered and then refused.
 */
export function cleanChatTasks(list: unknown, eventIds: Set<string>): ChatMessage['tasks'] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw: any) => {
    const eventId = typeof raw?.event_id === 'string' ? raw.event_id : '';
    if (!eventIds.has(eventId)) return [];
    return cleanSuggestedTasks([raw]).map((task) => ({ event_id: eventId, ...task }));
  });
}

const CHAT_SCHEMA = `{
  "answer": "התשובה בעברית",
  "tasks": [
    { "event_id": "מזהה הופעה מ-upcoming_shows", "title": "פעולה קצרה לביצוע",
      "detail": "מה בדיוק לבדוק או לשנות, ולפי איזה סף", "due_date": "YYYY-MM-DD" }
  ]
}`;

/**
 * One follow-up turn.
 *
 * Answers in prose rather than a report — this is the "why was that show so expensive?" box, and
 * forcing a structure onto a conversation gets a worse answer than asking for a sentence. The reply
 * is still wrapped in JSON so a truncated stream cannot be mistaken for a short answer, and so an
 * answer that says "do this next week" can carry it as a task to accept with one click.
 */
export async function chat(threadId: string, message: string, range: { from?: string; to?: string } = {}): Promise<ChatMessage[]> {
  const history = chatHistory(threadId).slice(-CHAT_HISTORY_TURNS);
  // The tasks already open, so an answer proposes what is missing rather than what is planned.
  const openTasks = db
    .prepare(
      `SELECT event_id, title, due_date FROM campaign_tasks
       WHERE done_at IS NULL ORDER BY due_date LIMIT 60`
    )
    .all();
  const context = { ...buildContext(range), open_tasks: openTasks };

  const prompt = buildPrompt(
    [
      'ענה על שאלת ההמשך של המשתמש על סמך נתוני הפרסום המצורפים.',
      'ענה בעברית, קצר ולעניין, והסתמך על מספרים מהנתונים כשאפשר.',
      'אם הנתונים לא מספיקים כדי לענות — אמור זאת במפורש במקום לנחש.',
      '',
      'משימות (tasks):',
      'אם המשתמש מבקש מה לעשות, תוכנית, או משימות להופעה שעוד לא הייתה — או שהתשובה שלך ממליצה',
      'על פעולות קונקרטיות עם מועד להופעה כזו — החזר אותן גם ב-tasks, כך שאדם יקבל עליהן תזכורת במייל.',
      'כל משימה: פעולה אחת לביצוע, event_id של הופעה מתוך upcoming_shows בלבד, ו-due_date בין',
      `היום (${context.today}) לבין יומיים אחרי ההופעה. אל תחזור על משימות שכבר ב-open_tasks.`,
      'אם השאלה היא שאלת הבנה ולא שאלת "מה לעשות" — החזר tasks ריק.',
      'אם הוספת משימות, ציין זאת במשפט קצר בסוף התשובה.',
      '',
      'השיחה עד כה:',
      ...history.map((m) => `${m.role === 'user' ? 'משתמש' : 'יועץ'}: ${m.content}`),
      `משתמש: ${message}`,
    ].join('\n'),
    CHAT_SCHEMA,
    context
  );

  const { data } = await ask(prompt);
  const answer = typeof data?.answer === 'string' ? data.answer : JSON.stringify(data);
  const eventIds = new Set(context.upcoming_shows.map((show) => show.id));

  appendChat(threadId, 'user', message);
  appendChat(threadId, 'assistant', answer, cleanChatTasks(data?.tasks, eventIds));
  return chatHistory(threadId);
}
