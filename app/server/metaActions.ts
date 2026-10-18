/**
 * פעולות ב-Meta — the advisor's recommendations, carried out once a person has seen exactly what
 * they will change.
 *
 * The agent still writes nothing. Where a recommendation is a change one click can make — pause a
 * campaign still spending after its show, move a daily budget, set an end date, open a pixel — its
 * answer carries it as a structured `action` beside the text. The app does the rest, in two steps
 * that cannot be merged:
 *
 *  1. **Preview.** The target is read live from Meta (its name, status, budget, end date, which
 *     account it is in), the change is laid out as «now → after», and anything that would make it
 *     wrong — a target outside the band's account, a budget set at the other level, a show that
 *     already happened — is listed. The preview is stored with the state it was computed from.
 *  2. **Confirm.** Only a stored preview can be carried out, by the owner, within minutes, and only
 *     if the target still reads as it did: anything changed in between (in Ads Manager, or by an
 *     earlier action) and the owner is shown a new preview instead of a change they never saw.
 *
 * Writes go out with the sync's own token (`META_ACCESS_TOKEN`), which needs `ads_management` for
 * them. A token with `ads_read` only still previews everything; confirming is then refused by Meta,
 * with a message saying which permission to add, and the preview is the instruction for Ads Manager.
 */
import { db, uuid, getBandName, getMetaCurrencyRate, getSetting } from './db.js';
import { AgentError } from './agentClient.js';
import {
  adAccountId, fetchObject, fetchPixels, graphWrite, isMetaConfigured, MetaError,
} from './metaClient.js';
import { eventLabel } from './band.js';
import { israelDate } from './campaignTasks.js';

export const ACTION_TYPES = ['pause', 'activate', 'set_daily_budget', 'set_end_date', 'create_pixel'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const ACTION_LEVELS = ['campaign', 'adset', 'ad'] as const;
export type ActionLevel = (typeof ACTION_LEVELS)[number];

export interface ProposedAction {
  type: ActionType;
  level: ActionLevel | null;
  /** Meta's id of the campaign, ad set or ad. Null only for create_pixel. */
  id: string | null;
  /** What the agent called it — shown beside the live name, never trusted over it. */
  name: string | null;
  /** The new daily budget in shekels, for set_daily_budget. */
  daily_budget: number | null;
  /** YYYY-MM-DD, Israel time, for set_end_date. */
  end_date: string | null;
  pixel_name: string | null;
  reason: string | null;
}

/** More than this in one answer is a plan, not a set of clicks. */
const MAX_ACTIONS = 5;
/** How long a preview stays good for. Long enough to read it, short enough that it is still true. */
export const PREVIEW_TTL_MINUTES = 15;
/** ₪ a day. The band's campaigns are tens to hundreds; a figure above this is a typo. */
const MAX_DAILY_BUDGET = 20_000;
/** A raise above this share is the step Meta treats as a new campaign (the learning phase). */
const LEARNING_STEP = 0.2;
/** Currencies Meta counts in whole units rather than hundredths. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'PYG', 'TWD', 'VND']);

const META_ID = /^\d{5,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * The actions in an answer that could be previewed, and no others. An id that is not a Meta id, a
 * budget that is not a positive number or a date that is not a date is dropped here rather than
 * offered as a button that fails.
 */
export function cleanActions(list: unknown): ProposedAction[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ProposedAction[] = [];
  for (const raw of list as any[]) {
    const type = ACTION_TYPES.includes(raw?.type) ? (raw.type as ActionType) : null;
    if (!type) continue;
    const action: ProposedAction = {
      type,
      level: null,
      id: null,
      name: text(raw?.name),
      daily_budget: null,
      end_date: null,
      pixel_name: null,
      reason: text(raw?.reason, 500),
    };
    if (type === 'create_pixel') {
      action.pixel_name = text(raw?.pixel_name, 100);
    } else {
      const level = ACTION_LEVELS.includes(raw?.level) ? (raw.level as ActionLevel) : null;
      const id = typeof raw?.id === 'string' || typeof raw?.id === 'number' ? String(raw.id).trim() : '';
      if (!level || !META_ID.test(id)) continue;
      if ((type === 'set_daily_budget' || type === 'set_end_date') && level === 'ad') continue;
      action.level = level;
      action.id = id;
      if (type === 'set_daily_budget') {
        const amount = Number(raw?.daily_budget);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        action.daily_budget = Math.round(amount * 100) / 100;
      }
      if (type === 'set_end_date') {
        const date = typeof raw?.end_date === 'string' ? raw.end_date : '';
        if (!DATE.test(date) || Number.isNaN(Date.parse(date))) continue;
        action.end_date = date;
      }
    }
    const key = `${type}:${action.id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

/** The `actions` field every advisor answer may carry, as its schema shows it to the agent. */
export const ACTIONS_SCHEMA = `"actions": [
    { "type": "pause" | "activate" | "set_daily_budget" | "set_end_date" | "create_pixel",
      "level": "campaign" | "adset" | "ad" | null,
      "id": "מזהה Meta של הקמפיין / קבוצת המודעות / המודעה" | null,
      "name": "השם כפי שהוא בנתונים" | null,
      "daily_budget": number | null,
      "end_date": "YYYY-MM-DD" | null,
      "reason": "למה, במשפט אחד" }
  ]`;

/** How to fill it. Sent with every ask whose schema carries `actions`. */
export const ACTIONS_GUIDE = `
פעולות לביצוע בלחיצה (actions):
- כשהמלצה היא שינוי שאפשר לבצע בלחיצה — השהיה (pause), הפעלה (activate), תקציב יומי חדש (set_daily_budget),
  תאריך סיום (set_end_date), או יצירת פיקסל כשאין בחשבון (create_pixel) — החזר אותה גם ב-actions.
  אתה לא מבצע דבר: האפליקציה קוראת את המצב הנוכחי מ-Meta, מציגה לבעלים תצוגה מקדימה «עכשיו → אחרי», ומבצעת
  רק אם אישר. ההמלצה בטקסט נשארת כמו שהיא.
- id: רק מזהה שראית — campaign_id מהנתונים, או מזהה קבוצת מודעות / מודעה שקראת בכלי Meta. לעולם אל תמציא מזהה.
- daily_budget: התקציב היומי החדש בשקלים (לא התוספת). אם בדקת בכלי Meta שהתקציב מוגדר ברמת קבוצת המודעות —
  level "adset" עם המזהה שלה; אחרת level "campaign". התצוגה המקדימה תגיד אם התקציב מוגדר ברמה האחרת.
- end_date: היום האחרון שהקמפיין רץ — בדרך כלל יום ההופעה. pause לקמפיין שממשיך להוציא אחרי ההופעה.
- מה שלא ניתן לבצע כך — מודעה או קהל חדשים, החלפת קריאייטיב, קמפיין חדש — נשאר הוראה בטקסט בלבד.
- לא יותר משלוש פעולות, ולא פעולה שכבר במצב המבוקש. אם אין — actions ריק.
`.trim();

// ---------------------------------------------------------------- reading the target

export interface ActionChange {
  label: string;
  from: string;
  to: string;
}

export interface ActionPreview {
  id: string;
  status: ActionRecord['status'];
  action: ProposedAction;
  title: string;
  target: {
    level: ActionLevel | null;
    id: string | null;
    name: string | null;
    status: string | null;
    effective_status: string | null;
    ads_manager_url: string | null;
  };
  /** The shows the target's campaign is mapped to — what makes «the show already happened» a fact. */
  shows: Array<{ event_id: string; label: string; date: string }>;
  changes: ActionChange[];
  warnings: string[];
  /** Why it cannot be carried out. Non-empty means the confirm button is not offered. */
  blockers: string[];
  can_execute: boolean;
  created_at: string;
  expires_at: string;
}

export interface ActionRecord {
  id: string;
  type: ActionType;
  level: ActionLevel | null;
  target_id: string | null;
  target_name: string | null;
  status: 'previewed' | 'executing' | 'done' | 'failed' | 'cancelled';
  source: string | null;
  source_id: string | null;
  event_id: string | null;
  preview: ActionPreview;
  result: any;
  error: string | null;
  created_at: string;
  executed_at: string | null;
}

const FIELDS: Record<ActionLevel, string> = {
  campaign: 'id,name,status,effective_status,account_id,daily_budget,lifetime_budget,stop_time,objective',
  adset: 'id,name,status,effective_status,account_id,daily_budget,lifetime_budget,end_time,campaign{id,name,status,daily_budget,lifetime_budget}',
  ad: 'id,name,status,effective_status,account_id,campaign{id,name,status},adset{id,name}',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'פעיל',
  PAUSED: 'מושהה',
  ARCHIVED: 'בארכיון',
  DELETED: 'נמחק',
  CAMPAIGN_PAUSED: 'הקמפיין מושהה',
  ADSET_PAUSED: 'קבוצת המודעות מושהית',
  IN_PROCESS: 'בעיבוד',
  WITH_ISSUES: 'עם בעיות',
  PENDING_REVIEW: 'בבדיקה',
  DISAPPROVED: 'נדחה',
};
const statusLabel = (s: string | null | undefined) => (s ? STATUS_LABELS[s] ?? s : 'לא ידוע');

const LEVEL_LABELS: Record<ActionLevel, string> = { campaign: 'הקמפיין', adset: 'קבוצת המודעות', ad: 'המודעה' };

/** Minor units (what the Graph API counts in) per unit of the account's currency. */
function currencyOffset(): number {
  return ZERO_DECIMAL.has(getSetting('meta_account_currency', 'ILS')) ? 1 : 100;
}

/** A Graph budget (minor units of the account's currency) in shekels. */
export function budgetToShekels(minor: unknown): number | null {
  const n = parseFloat(String(minor ?? ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / currencyOffset()) * getMetaCurrencyRate() * 100) / 100;
}

/** Shekels as the Graph API wants a budget: whole minor units of the account's currency. */
export function shekelsToBudget(shekels: number): number {
  return Math.round((shekels / getMetaCurrencyRate()) * currencyOffset());
}

const shekels = (n: number | null) => (n == null ? 'לא מוגדר' : `₪${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ליום`);

/**
 * The last minute of a day in Israel, with the offset that day actually has — a campaign set to
 * end on the show's date should run through that evening, summer time or not.
 */
export function israelEndOfDay(date: string): string {
  const probe = new Date(`${date}T21:00:00Z`);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  const offset = zone.replace('GMT', '') || '+00:00';
  return `${date}T23:59:00${offset}`;
}

/** The shows a campaign is mapped to, soonest first. */
function showsOf(campaignId: string | null): ActionPreview['shows'] {
  if (!campaignId) return [];
  return (
    db.prepare(
      `SELECT e.id, e.venue, e.date FROM meta_campaign_events m JOIN band_events e ON e.id = m.event_id
       WHERE m.campaign_id = ? ORDER BY e.date`
    ).all(campaignId) as Array<{ id: string; venue: string; date: string }>
  ).map((e) => ({ event_id: e.id, label: eventLabel(e.venue, e.date), date: e.date }));
}

function adsManagerUrl(level: ActionLevel, id: string): string {
  const account = adAccountId().replace(/^act_/, '');
  const tab = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${account}&selected_${level}_ids=${id}`;
}

/** The fields whose change between preview and confirm means the preview is no longer true. */
function fingerprint(action: ProposedAction, live: any): Record<string, unknown> {
  if (action.type === 'create_pixel') return { pixels: live.pixels };
  return {
    status: live.status ?? null,
    daily_budget: live.daily_budget ?? null,
    lifetime_budget: live.lifetime_budget ?? null,
    end: live.end_time ?? live.stop_time ?? null,
    campaign_budget: live.campaign?.daily_budget ?? null,
  };
}

async function readLive(action: ProposedAction): Promise<any> {
  if (action.type === 'create_pixel') {
    const pixels = await fetchPixels();
    return { pixels: pixels.map((p) => p.id), list: pixels };
  }
  return fetchObject(action.id!, FIELDS[action.level!]);
}

/**
 * The preview itself: what the target is now, what it will be, and what stands in the way. Pure
 * apart from the shows lookup, so the rules can be tested against a canned Meta answer.
 */
export function describe(action: ProposedAction, live: any, today = israelDate()): Omit<ActionPreview, 'id' | 'status' | 'created_at' | 'expires_at'> {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const changes: ActionChange[] = [];

  if (action.type === 'create_pixel') {
    const list: Array<{ id: string; name: string | null }> = live.list ?? [];
    const name = action.pixel_name || `${getBandName()} — tickets`;
    action = { ...action, pixel_name: name };
    changes.push({ label: 'פיקסל חדש בחשבון המודעות', from: list.length ? `${list.length} קיימים` : 'אין פיקסל', to: name });
    if (list.length) {
      warnings.push(`כבר יש בחשבון פיקסל: ${list.map((p) => `«${p.name ?? p.id}» (${p.id})`).join(', ')} — בדרך כלל עדיף לתת למועדונים את הקיים ולא לפתוח חדש.`);
    }
    return {
      action,
      title: 'יצירת פיקסל Meta לחשבון המודעות',
      target: { level: null, id: null, name: null, status: null, effective_status: null, ads_manager_url: 'https://business.facebook.com/events_manager2' },
      shows: [],
      changes,
      warnings,
      blockers,
      can_execute: blockers.length === 0,
    };
  }

  const level = action.level!;
  const account = adAccountId().replace(/^act_/, '');
  if (String(live.account_id ?? '') !== account) {
    blockers.push('היעד לא שייך לחשבון המודעות של הלהקה — הפעולה לא תבוצע.');
  }
  const campaignId = level === 'campaign' ? String(live.id ?? action.id) : live.campaign?.id ? String(live.campaign.id) : null;
  const shows = showsOf(campaignId);
  const upcoming = shows.filter((s) => s.date >= today);
  const name = text(live.name) ?? action.name;
  if (action.name && name && action.name !== name) {
    warnings.push(`הסוכן קרא לזה «${action.name}», ובחשבון השם הוא «${name}» — ודאו שזה היעד הנכון.`);
  }
  if (live.status === 'ARCHIVED' || live.status === 'DELETED') blockers.push(`${LEVEL_LABELS[level]} ${statusLabel(live.status)}.`);

  let title = '';
  switch (action.type) {
    case 'pause':
    case 'activate': {
      const to = action.type === 'pause' ? 'PAUSED' : 'ACTIVE';
      title = `${action.type === 'pause' ? 'השהיית' : 'הפעלת'} ${LEVEL_LABELS[level]} «${name ?? action.id}»`;
      changes.push({ label: 'מצב', from: statusLabel(live.status), to: statusLabel(to) });
      if (live.status === to) blockers.push(`${LEVEL_LABELS[level]} כבר ${statusLabel(to)}.`);
      if (action.type === 'activate') {
        if (shows.length && !upcoming.length) blockers.push('כל ההופעות שהקמפיין משויך אליהן כבר היו — אין מה להפעיל.');
        if (!shows.length) warnings.push('הקמפיין לא משויך לאף הופעה — ודאו שזה הקמפיין הנכון לפני שמפעילים.');
        const end = String(live.end_time ?? live.stop_time ?? '').slice(0, 10);
        if (end && end < today) warnings.push(`תאריך הסיום (${end}) כבר עבר — הקמפיין לא יפיץ עד שיוגדר תאריך חדש.`);
        if (level !== 'campaign' && live.campaign?.status === 'PAUSED') warnings.push(`הקמפיין «${live.campaign.name}» עצמו מושהה, אז זה לא יתחיל לרוץ עד שיופעל.`);
        warnings.push('הפעלה מתחילה להוציא כסף מיד.');
      }
      break;
    }
    case 'set_daily_budget': {
      const current = budgetToShekels(live.daily_budget);
      const next = action.daily_budget!;
      title = `תקציב יומי ל${LEVEL_LABELS[level]} «${name ?? action.id}»`;
      changes.push({ label: 'תקציב יומי', from: shekels(current), to: shekels(next) });
      if (budgetToShekels(live.lifetime_budget) != null) blockers.push('מוגדר תקציב לכל חיי הקמפיין ולא תקציב יומי — יש לשנות ב-Ads Manager.');
      else if (current == null) {
        blockers.push(level === 'campaign'
          ? 'התקציב של הקמפיין הזה מוגדר ברמת קבוצות המודעות — צריך לשנות את התקציב של קבוצת המודעות.'
          : 'התקציב מוגדר ברמת הקמפיין (Advantage+ campaign budget) — צריך לשנות את התקציב של הקמפיין.');
      }
      if (next > MAX_DAILY_BUDGET) blockers.push(`₪${next} ליום חורג מהתקרה (₪${MAX_DAILY_BUDGET}) — כנראה טעות.`);
      if (current != null) {
        if (next === current) blockers.push('זה כבר התקציב היומי.');
        else if (next > current * 5) blockers.push(`פי ${Math.round(next / current)} מהתקציב הנוכחי — כנראה טעות. אם זו כוונה, עשו זאת ב-Ads Manager.`);
        else if (next > current * (1 + LEARNING_STEP)) {
          const left = upcoming.length ? Math.round((Date.parse(upcoming[0].date) - Date.parse(today)) / 86_400_000) : null;
          warnings.push(`העלאה של ${Math.round((next / current - 1) * 100)}% — מעל 20% Meta עלולה להחזיר את הקמפיין לשלב הלמידה.`
            + (left != null && left < 7 ? ` נשארו ${left} ימים להופעה, אז זה בדרך כלל שווה את זה.` : ' כשיש זמן, עדיף בכמה צעדים.'));
        }
      }
      if (shows.length && !upcoming.length) warnings.push('כל ההופעות שהקמפיין משויך אליהן כבר היו.');
      if (getMetaCurrencyRate() !== 1) {
        const code = getSetting('meta_account_currency', 'ILS');
        warnings.push(`החשבון ב-${code}: ₪${next} יישלחו כ-${(shekelsToBudget(next) / currencyOffset()).toFixed(2)} ${code} לפי השער השמור.`);
      }
      break;
    }
    case 'set_end_date': {
      const current = String(live.end_time ?? live.stop_time ?? '').slice(0, 10) || null;
      title = `תאריך סיום ל${LEVEL_LABELS[level]} «${name ?? action.id}»`;
      changes.push({ label: 'תאריך סיום', from: current ?? 'ללא (רץ עד שעוצרים)', to: `${action.end_date} בסוף היום` });
      if (action.end_date! < today) blockers.push('תאריך הסיום כבר עבר — כדי לעצור עכשיו, השהו את הקמפיין.');
      if (current === action.end_date) blockers.push('זה כבר תאריך הסיום.');
      const last = upcoming[upcoming.length - 1];
      if (last && action.end_date! > last.date) warnings.push(`אחרי ההופעה האחרונה שהקמפיין משויך אליה (${last.label}) — כל יום אחריה הוא הוצאה בלי הופעה.`);
      if (level === 'campaign') warnings.push('תאריך סיום לקמפיין עוצר את כל קבוצות המודעות שבו.');
      break;
    }
  }

  return {
    action,
    title,
    target: {
      level,
      id: action.id,
      name,
      status: text(live.status),
      effective_status: text(live.effective_status),
      ads_manager_url: adsManagerUrl(level, action.id!),
    },
    shows,
    changes,
    warnings,
    blockers,
    can_execute: blockers.length === 0,
  };
}

// ---------------------------------------------------------------- the two steps

function readRecord(row: any): ActionRecord {
  const parse = (s: string | null) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  const preview = parse(row.preview) as ActionPreview;
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    target_id: row.target_id,
    target_name: row.target_name,
    status: row.status,
    source: row.source,
    source_id: row.source_id,
    event_id: row.event_id,
    preview: { ...preview, id: row.id, status: row.status },
    result: parse(row.result),
    error: row.error,
    created_at: row.created_at,
    executed_at: row.executed_at,
  };
}

export function getAction(id: string): ActionRecord {
  const row = db.prepare('SELECT * FROM meta_actions WHERE id = ?').get(id);
  if (!row) throw new AgentError('הפעולה לא נמצאה', 404);
  return readRecord(row);
}

/** Every action previewed or carried out, newest first — the log of what the app did in Meta. */
export function listActions(limit = 30): ActionRecord[] {
  return (db.prepare('SELECT * FROM meta_actions ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as any[]).map(readRecord);
}

/** Step one: read the target, lay out the change, and keep it as the one thing confirm may do. */
export async function previewAction(
  raw: unknown,
  origin: { source?: string | null; source_id?: string | null; event_id?: string | null } = {}
): Promise<ActionPreview> {
  const [action] = cleanActions([raw]);
  if (!action) throw new AgentError('הפעולה לא מוכרת או חסרים בה פרטים', 400);
  if (!isMetaConfigured()) throw new MetaError('Meta לא מוגדר — אי אפשר לקרוא את המצב הנוכחי לתצוגה מקדימה', 503);

  const live = await readLive(action);
  const described = describe(action, live);
  const id = uuid();
  const created = new Date();
  const preview: ActionPreview = {
    ...described,
    id,
    status: 'previewed',
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + PREVIEW_TTL_MINUTES * 60_000).toISOString(),
  };
  db.prepare(
    `INSERT INTO meta_actions (id, type, level, target_id, target_name, action, preview, state, source, source_id, event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, described.action.type, described.action.level, described.action.id, described.target.name,
    JSON.stringify(described.action), JSON.stringify(preview), JSON.stringify(fingerprint(action, live)),
    text(origin.source, 40), text(origin.source_id, 80), text(origin.event_id, 80)
  );
  return preview;
}

/** A preview nobody is going to confirm. */
export function cancelAction(id: string): ActionRecord {
  db.prepare(`UPDATE meta_actions SET status = 'cancelled' WHERE id = ? AND status = 'previewed'`).run(id);
  return getAction(id);
}

const finish = (id: string, status: 'done' | 'failed' | 'cancelled', fields: { result?: unknown; error?: string }) =>
  db.prepare(
    `UPDATE meta_actions SET status = ?, result = ?, error = ?, executed_at = datetime('now') WHERE id = ?`
  ).run(status, fields.result === undefined ? null : JSON.stringify(fields.result), fields.error ?? null, id);

/**
 * Step two: carry out a stored preview, if it is still the truth.
 *
 * The row is claimed before anything is sent, so a double press sends once. The target is then
 * read again; if anything the preview showed has moved, nothing is sent and the owner is asked to
 * look again — confirming a change is only confirming the one that was on screen.
 */
export async function executeAction(id: string): Promise<ActionRecord> {
  const record = getAction(id);
  if (record.status !== 'previewed') {
    throw new AgentError(record.status === 'done' ? 'הפעולה כבר בוצעה' : 'הפעולה הזו כבר לא ממתינה לאישור — הציגו אותה מחדש', 409);
  }
  if (!record.preview.can_execute || record.preview.blockers?.length) {
    throw new AgentError('לפי התצוגה המקדימה אי אפשר לבצע את הפעולה הזו', 409);
  }
  if (Date.parse(record.preview.expires_at) < Date.now()) {
    finish(id, 'cancelled', { error: 'התצוגה המקדימה פגה' });
    throw new AgentError(`התצוגה המקדימה ישנה מ-${PREVIEW_TTL_MINUTES} דקות — הציגו אותה מחדש לפני הביצוע`, 409);
  }

  const claimed = db.prepare(`UPDATE meta_actions SET status = 'executing' WHERE id = ? AND status = 'previewed'`).run(id);
  if (claimed.changes === 0) throw new AgentError('הפעולה כבר בביצוע', 409);

  const action = record.preview.action;
  try {
    const stored = (db.prepare('SELECT state FROM meta_actions WHERE id = ?').get(id) as { state: string }).state;
    const live = await readLive(action);
    if (JSON.stringify(fingerprint(action, live)) !== stored) {
      finish(id, 'cancelled', { error: 'המצב ב-Meta השתנה מאז התצוגה המקדימה' });
      throw new AgentError('המצב ב-Meta השתנה מאז התצוגה המקדימה — הציגו אותה מחדש וראו מה השתנה', 409);
    }

    let result: any;
    switch (action.type) {
      case 'pause':
        result = await graphWrite(action.id!, { status: 'PAUSED' });
        break;
      case 'activate':
        result = await graphWrite(action.id!, { status: 'ACTIVE' });
        break;
      case 'set_daily_budget':
        result = await graphWrite(action.id!, { daily_budget: String(shekelsToBudget(action.daily_budget!)) });
        break;
      case 'set_end_date':
        result = await graphWrite(action.id!, { [action.level === 'campaign' ? 'stop_time' : 'end_time']: israelEndOfDay(action.end_date!) });
        break;
      case 'create_pixel':
        result = await graphWrite(`${adAccountId()}/adspixels`, { name: action.pixel_name! });
        break;
    }
    finish(id, 'done', { result });
    // The campaign list reads the synced status; a pause made here should not wait for the next pull.
    if (action.level === 'campaign' && (action.type === 'pause' || action.type === 'activate')) {
      db.prepare('UPDATE meta_campaigns SET status = ? WHERE id = ?').run(action.type === 'pause' ? 'PAUSED' : 'ACTIVE', action.id);
    }
  } catch (err: any) {
    const current = (db.prepare('SELECT status FROM meta_actions WHERE id = ?').get(id) as { status: string }).status;
    if (current === 'executing') finish(id, 'failed', { error: String(err?.message || err).slice(0, 500) });
    throw err;
  }
  return getAction(id);
}
