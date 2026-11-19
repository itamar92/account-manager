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
import { fetchAdVideos, fetchCustomAudiences, fetchInstagramAccounts, fetchPromotePages, type MetaAudience } from './metaClient.js';
import { imageBase64, imagePath } from './metaImages.js';
import { applyCampaignSpend } from './metaSync.js';

export const ACTION_TYPES = [
  'pause', 'activate', 'set_daily_budget', 'set_end_date', 'create_pixel', 'rename', 'archive', 'create_campaign',
  'create_audience',
] as const;
/**
 * What only a person can start from the campaign studio. The agent may suggest a rename or an
 * archive like any other click, but a whole new campaign is built in the wizard, never handed
 * over in an answer.
 */
const MANUAL_ONLY: ReadonlySet<string> = new Set(['create_campaign', 'create_audience']);
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
  /** The new name, for rename. */
  new_name?: string | null;
  /** Everything a new campaign is built from, for create_campaign. */
  spec?: CampaignSpec | null;
  /** Everything a new saved audience is built from, for create_audience. */
  audience?: AudienceSpec | null;
  reason: string | null;
}

/**
 * A saved («hot») audience, built from one source:
 *  - `website` — people the pixel saw on a ticket page: everyone, or those who reached an event
 *    (ViewContent, InitiateCheckout, Purchase); `exclude_buyers` takes Purchase out of the rest.
 *  - `instagram` — everyone who engaged with the band's Instagram profile.
 *  - `page` — everyone who engaged with the band's Facebook page.
 *  - `video` — everyone who watched one of the chosen videos, to a depth (3 seconds … the end).
 */
export const AUDIENCE_KINDS = ['website', 'instagram', 'page', 'video'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];
export const WEBSITE_EVENTS = ['all', 'ViewContent', 'InitiateCheckout', 'Purchase'] as const;
export type WebsiteEvent = (typeof WEBSITE_EVENTS)[number];
/** Meta's ceilings on how far back each kind of audience can look. */
const MAX_DAYS: Record<AudienceKind, number> = { website: 180, instagram: 365, page: 365, video: 365 };
/** How far into a video someone has to get to count, as Meta's engagement events name it. */
export const VIDEO_EVENTS = ['video_watched', 'video_view_25_percent', 'video_view_50_percent', 'video_view_75_percent', 'video_completed'] as const;
export type VideoEvent = (typeof VIDEO_EVENTS)[number];
const VIDEO_EVENT_LABELS: Record<VideoEvent, string> = {
  video_watched: 'צפו 3 שניות לפחות', video_view_25_percent: 'צפו ברבע', video_view_50_percent: 'צפו בחצי',
  video_view_75_percent: 'צפו ב-75%', video_completed: 'צפו עד הסוף',
};
const MAX_VIDEOS = 20;
const EVENT_LABELS: Record<WebsiteEvent, string> = {
  all: 'כל מי שביקר', ViewContent: 'צפו בדף ההופעה', InitiateCheckout: 'התחילו לקנות', Purchase: 'קנו כרטיס',
};

export interface AudienceSpec {
  kind: AudienceKind;
  name: string;
  /** The pixel, Instagram account or page the audience is built from. */
  source_id: string;
  days: number;
  event: WebsiteEvent;
  exclude_buyers: boolean;
  /** For `video`: the videos, and how far into one of them counts. */
  video_ids: string[];
  video_event: VideoEvent;
}

export function cleanAudienceSpec(raw: any): AudienceSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = (AUDIENCE_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as AudienceKind) : null;
  const name = text(raw.name, 200);
  const videos = [...new Set((Array.isArray(raw.video_ids) ? raw.video_ids : []).map(String).filter((id: string) => META_ID.test(id)))].slice(0, MAX_VIDEOS) as string[];
  // A video audience is built from its videos; the others from one pixel, account or page.
  const source = kind === 'video' ? videos[0] ?? '' : raw.source_id != null ? String(raw.source_id).trim() : '';
  if (!kind || !name || !META_ID.test(source)) return null;
  const event: WebsiteEvent = kind === 'website' && (WEBSITE_EVENTS as readonly string[]).includes(raw.event) ? raw.event : 'all';
  return {
    kind,
    name,
    source_id: source,
    days: clamp(Math.round(Number(raw.days) || 30), 1, MAX_DAYS[kind]),
    event,
    exclude_buyers: kind === 'website' && event !== 'Purchase' && raw.exclude_buyers === true,
    video_ids: kind === 'video' ? videos : [],
    video_event: (VIDEO_EVENTS as readonly string[]).includes(raw.video_event) ? raw.video_event : 'video_view_50_percent',
  };
}

/** The audience's rule, in the shape Meta's `customaudiences` endpoint takes. */
export function audienceRule(spec: AudienceSpec): Record<string, unknown> {
  const retention_seconds = spec.days * 86_400;
  if (spec.kind === 'website') {
    const source = { event_sources: [{ id: spec.source_id, type: 'pixel' }], retention_seconds };
    const filter = spec.event === 'all'
      ? { operator: 'and', filters: [{ field: 'url', operator: 'i_contains', value: '' }] }
      : { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: spec.event }] };
    return {
      inclusions: { operator: 'or', rules: [{ ...source, filter }] },
      ...(spec.exclude_buyers ? {
        exclusions: { operator: 'or', rules: [{ ...source, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'Purchase' }] } }] },
      } : {}),
    };
  }
  if (spec.kind === 'video') {
    return {
      inclusions: {
        operator: 'or',
        rules: [{
          event_sources: spec.video_ids.map((id) => ({ id, type: 'video' })),
          retention_seconds,
          filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: spec.video_event }] },
        }],
      },
    };
  }
  const type = spec.kind === 'instagram' ? 'ig_business' : 'page';
  const value = spec.kind === 'instagram' ? 'ig_business_profile_all' : 'page_engaged';
  return {
    inclusions: {
      operator: 'or',
      rules: [{ event_sources: [{ id: spec.source_id, type }], retention_seconds, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value }] } }],
    },
  };
}

/** The three goals the wizard offers, and what each means in Meta's terms. */
export const OBJECTIVES = {
  sales: { objective: 'OUTCOME_SALES', optimization_goal: 'OFFSITE_CONVERSIONS', label: 'מכירת כרטיסים (לפי הפיקסל)' },
  traffic: { objective: 'OUTCOME_TRAFFIC', optimization_goal: 'LANDING_PAGE_VIEWS', label: 'כניסות לדף הכרטיסים' },
  awareness: { objective: 'OUTCOME_AWARENESS', optimization_goal: 'REACH', label: 'חשיפה — להגיע לכמה שיותר אנשים' },
} as const;
export type Goal = keyof typeof OBJECTIVES;

/**
 * Who the ad set reaches. Cold is prospecting — people who do not know the band, found by the
 * area, the ages and the creative. Hot is retargeting — saved audiences of people who already
 * showed interest (visited the ticket page, watched a video, engaged with the page).
 */
export const TEMPERATURES = { cold: 'קהל קר', hot: 'קהל חם' } as const;
export type Temperature = keyof typeof TEMPERATURES;
/** Below this, Meta struggles to deliver a retargeting ad set and the same few people see it over and over. */
export const MIN_HOT_AUDIENCE = 1_000;
const MAX_AUDIENCES = 10;

export const CTAS = ['BUY_TICKETS', 'LEARN_MORE', 'BOOK_NOW', 'GET_OFFER'] as const;
const CTA_LABELS: Record<string, string> = {
  BUY_TICKETS: 'לרכישת כרטיסים', LEARN_MORE: 'מידע נוסף', BOOK_NOW: 'להזמנה', GET_OFFER: 'לקבלת ההצעה',
};

/** A campaign + ad set + ad, as the wizard fills it in. Budgets in shekels, dates in Israel time. */
export interface CampaignSpec {
  event_id: string | null;
  name: string;
  goal: Goal;
  daily_budget: number;
  start_date: string;
  end_date: string;
  age_min: number;
  age_max: number;
  temperature: Temperature;
  /** Saved audiences the ad set targets — required for hot, none for cold. */
  audience_ids: string[];
  /** Saved audiences it never shows to, e.g. people who already bought. */
  excluded_audience_ids: string[];
  page_id: string;
  pixel_id: string | null;
  link: string;
  primary_text: string;
  headline: string;
  description: string | null;
  cta: (typeof CTAS)[number];
  image_id: string;
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
export function cleanActions(list: unknown, options: { manual?: boolean } = {}): ProposedAction[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ProposedAction[] = [];
  for (const raw of list as any[]) {
    const type = ACTION_TYPES.includes(raw?.type) ? (raw.type as ActionType) : null;
    if (!type || (MANUAL_ONLY.has(type) && !options.manual)) continue;
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
    } else if (type === 'create_audience') {
      const audience = cleanAudienceSpec(raw?.audience);
      if (!audience) continue;
      action.audience = audience;
      action.name = audience.name;
    } else if (type === 'create_campaign') {
      const spec = cleanSpec(raw?.spec);
      if (!spec) continue;
      action.spec = spec;
      action.name = spec.name;
    } else {
      const level = ACTION_LEVELS.includes(raw?.level) ? (raw.level as ActionLevel) : null;
      const id = typeof raw?.id === 'string' || typeof raw?.id === 'number' ? String(raw.id).trim() : '';
      if (!level || !META_ID.test(id)) continue;
      if ((type === 'set_daily_budget' || type === 'set_end_date') && level === 'ad') continue;
      if (type === 'rename') {
        const next = text(raw?.new_name, 200);
        if (!next) continue;
        action.new_name = next;
      }
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

const ISO_COUNTRY = /^[A-Z]{2}$/;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A wizard's form as something that can be previewed, or null when a part Meta needs is missing.
 * Ranges are clamped rather than refused (an age of 70 is 65+); a missing page, image or link is
 * refused, because there is no ad without them.
 */
export function cleanSpec(raw: any): CampaignSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const goal = (Object.keys(OBJECTIVES) as Goal[]).includes(raw.goal) ? (raw.goal as Goal) : null;
  const name = text(raw.name, 200);
  const budget = Number(raw.daily_budget);
  const start = typeof raw.start_date === 'string' && DATE.test(raw.start_date) ? raw.start_date : null;
  const end = typeof raw.end_date === 'string' && DATE.test(raw.end_date) ? raw.end_date : null;
  const page = typeof raw.page_id === 'string' || typeof raw.page_id === 'number' ? String(raw.page_id).trim() : '';
  const link = text(raw.link, 1000);
  const primary = text(raw.primary_text, 2000);
  const headline = text(raw.headline, 255);
  const image = typeof raw.image_id === 'string' ? raw.image_id : '';
  if (!goal || !name || !Number.isFinite(budget) || budget <= 0 || !start || !end) return null;
  if (!/^\d{5,30}$/.test(page) || !link || !/^https?:\/\//i.test(link) || !primary || !headline || !image) return null;
  const pixel = raw.pixel_id != null && META_ID.test(String(raw.pixel_id)) ? String(raw.pixel_id) : null;
  const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((id) => META_ID.test(id)))].slice(0, MAX_AUDIENCES);
  const temperature: Temperature = raw.temperature === 'hot' ? 'hot' : 'cold';
  const include = temperature === 'hot' ? ids(raw.audience_ids) : [];
  const exclude = ids(raw.excluded_audience_ids).filter((id) => !include.includes(id));
  const ageMin = clamp(Math.round(Number(raw.age_min) || 18), 18, 65);
  const ageMax = clamp(Math.round(Number(raw.age_max) || 65), ageMin, 65);
  return {
    event_id: text(raw.event_id, 80),
    name,
    goal,
    daily_budget: Math.round(budget * 100) / 100,
    start_date: start,
    end_date: end,
    age_min: ageMin,
    age_max: ageMax,
    temperature,
    audience_ids: include,
    excluded_audience_ids: exclude,
    page_id: page,
    pixel_id: pixel,
    link,
    primary_text: primary,
    headline,
    description: text(raw.description, 255),
    cta: (CTAS as readonly string[]).includes(raw.cta) ? raw.cta : 'BUY_TICKETS',
    image_id: image,
  };
}

/** The `actions` field every advisor answer may carry, as its schema shows it to the agent. */
export const ACTIONS_SCHEMA = `"actions": [
    { "type": "pause" | "activate" | "set_daily_budget" | "set_end_date" | "rename" | "archive" | "create_pixel",
      "level": "campaign" | "adset" | "ad" | null,
      "id": "מזהה Meta של הקמפיין / קבוצת המודעות / המודעה" | null,
      "name": "השם כפי שהוא בנתונים" | null,
      "daily_budget": number | null,
      "end_date": "YYYY-MM-DD" | null,
      "new_name": "שם חדש, ל-rename" | null,
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
- שינוי שם (rename, עם new_name) או העברה לארכיון (archive) לקמפיין שהסתיים ולא יחזור — גם הם פעולות.
- מה שלא ניתן לבצע כך — מודעה או קהל חדשים, החלפת קריאייטיב, קמפיין חדש — נשאר הוראה בטקסט בלבד
  (קמפיין חדש הבעלים בונה באשף «קמפיין חדש», ואפשר למלא אותו מהתוכנית).
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
  if (action.type === 'create_campaign') return { pages: live.pages, pixels: live.pixels, image: live.image, audiences: live.audiences };
  if (action.type === 'create_audience') return { sources: live.sources, names: live.names };
  return {
    name: live.name ?? null,
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
  if (action.type === 'create_audience') {
    const kind = action.audience!.kind;
    const [sources, audiences] = await Promise.all([
      kind === 'website' ? fetchPixels() : kind === 'instagram'
        ? fetchInstagramAccounts().then((l) => l.map((a) => ({ id: a.id, name: a.username ? `@${a.username}` : null })))
        : kind === 'video' ? fetchAdVideos().then((l) => l.map((v) => ({ id: v.id, name: v.title })))
        : fetchPromotePages(),
      fetchCustomAudiences(),
    ]);
    return {
      sources: sources.map((x: any) => x.id),
      names: audiences.map((a) => a.name ?? ''),
      source_list: sources,
      audience_list: audiences,
    };
  }
  if (action.type === 'create_campaign') {
    const spec = action.spec;
    const wantsAudiences = !!spec && (spec.audience_ids.length > 0 || spec.excluded_audience_ids.length > 0);
    const [pages, pixels, audiences] = await Promise.all([
      fetchPromotePages(), fetchPixels(), wantsAudiences ? fetchCustomAudiences() : Promise.resolve([] as MetaAudience[]),
    ]);
    return {
      pages: pages.map((p) => p.id),
      pixels: pixels.map((p) => p.id),
      audiences: audiences.map((a) => `${a.id}:${a.ready ? 1 : 0}`),
      audience_list: audiences,
      image: imagePath(action.spec?.image_id) ? action.spec!.image_id : null,
      page_list: pages,
      pixel_list: pixels,
    };
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

  if (action.type === 'create_campaign') return describeCreate(action, live, today);
  if (action.type === 'create_audience') return describeAudience(action, live);

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
    case 'rename': {
      title = `שינוי שם ל${LEVEL_LABELS[level]} «${name ?? action.id}»`;
      changes.push({ label: 'שם', from: name ?? '—', to: action.new_name! });
      if (name === action.new_name) blockers.push('זה כבר השם.');
      break;
    }
    case 'archive': {
      title = `העברה לארכיון של ${LEVEL_LABELS[level]} «${name ?? action.id}»`;
      changes.push({ label: 'מצב', from: statusLabel(live.status), to: statusLabel('ARCHIVED') });
      warnings.push('ארכיון עוצר את ההוצאה, ואי אפשר להפעיל אותו שוב מהאפליקציה. ההוצאות שכבר נרשמו להופעות נשארות.');
      if (upcoming.length) warnings.push(`ההופעה ${upcoming[0].label} עוד לא הייתה — אם רק רוצים לעצור לרגע, עדיף השהיה.`);
      if (live.status === 'ACTIVE') warnings.push('הוא פעיל עכשיו ויפסיק להוציא מיד.');
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

const day = (date: string) => Date.parse(`${date}T12:00:00Z`);

const SOURCE_LABELS: Record<AudienceKind, string> = { website: 'הפיקסל', instagram: 'חשבון האינסטגרם', page: 'דף הפייסבוק', video: 'הוידאו' };

/** The preview of a new saved audience: where it comes from, how far back, and what it will not be yet. */
function describeAudience(action: ProposedAction, live: any): Omit<ActionPreview, 'id' | 'status' | 'created_at' | 'expires_at'> {
  const spec = action.audience!;
  const warnings: string[] = [];
  const blockers: string[] = [];
  const sources: Array<{ id: string; name: string | null }> = live.source_list ?? [];
  const source = sources.find((x) => x.id === spec.source_id);
  if (spec.kind === 'video') {
    const missing = spec.video_ids.filter((id) => !sources.some((x) => x.id === id));
    if (missing.length) blockers.push(`${missing.length === 1 ? 'וידאו אחד שנבחר לא נמצא' : `${missing.length} סרטונים שנבחרו לא נמצאו`} בספריית הוידאו של חשבון המודעות — בחרו מהרשימה.`);
  } else if (!source) blockers.push(`${SOURCE_LABELS[spec.kind]} שנבחר לא שייך לחשבון המודעות — בחרו מהרשימה.`);
  if ((live.names ?? []).includes(spec.name)) warnings.push(`כבר יש בחשבון קהל בשם «${spec.name}» — כדאי שם אחר, כדי לא להתבלבל ביניהם.`);

  const what = spec.kind === 'website'
    ? `${EVENT_LABELS[spec.event]} בדפים שהפיקסל «${source?.name ?? spec.source_id}» מותקן בהם${spec.exclude_buyers ? ', בלי מי שקנה' : ''}`
    : spec.kind === 'video'
      ? `${VIDEO_EVENT_LABELS[spec.video_event]} ב${spec.video_ids.length === 1
        ? `וידאו «${sources.find((x) => x.id === spec.video_ids[0])?.name ?? spec.video_ids[0]}»`
        : `אחד מ-${spec.video_ids.length} סרטונים`}`
    : spec.kind === 'instagram'
      ? `כל מי שהתעניין בחשבון ${source?.name ?? spec.source_id} (צפה, הגיב, שלח הודעה, שמר)`
      : `כל מי שהתעניין בדף «${source?.name ?? spec.source_id}» (לייק, תגובה, שיתוף, הודעה)`;
  if (spec.kind === 'website') {
    warnings.push('קהל מהפיקסל מתמלא רק מאתרים שהפיקסל מותקן בהם — אם דף הכרטיסים של המועדון לא מריץ אותו, הקהל יישאר ריק. אפשר לבדוק במסך «פיקסל, קהלים ויומן».');
  }
  warnings.push(`Meta בונה את הקהל מהימים שכבר עברו, וזה לוקח עד כחצי שעה. עד אז הגודל לא ידוע, ומתחת ל-${MIN_HOT_AUDIENCE.toLocaleString('he-IL')} איש קמפיין חם מתקשה להפיץ.`);

  return {
    action,
    title: `קהל שמור חדש «${spec.name}»`,
    target: { level: null, id: null, name: spec.name, status: null, effective_status: null, ads_manager_url: 'https://adsmanager.facebook.com/adsmanager/audiences' },
    shows: [],
    changes: [{ label: 'קהל שמור', from: 'אין', to: `«${spec.name}» · ${what} · ${spec.days} ימים אחורה` }],
    warnings,
    blockers,
    can_execute: blockers.length === 0,
  };
}

/** The preview of a whole new campaign: three objects, each laid out as «none → what it will be». */
function describeCreate(action: ProposedAction, live: any, today: string): Omit<ActionPreview, 'id' | 'status' | 'created_at' | 'expires_at'> {
  const spec = action.spec!;
  const warnings: string[] = [];
  const blockers: string[] = [];
  const goal = OBJECTIVES[spec.goal];
  const pages: Array<{ id: string; name: string | null }> = live.page_list ?? [];
  const pixels: Array<{ id: string; name: string | null }> = live.pixel_list ?? [];
  const page = pages.find((p) => p.id === spec.page_id);
  const days = Math.round((day(spec.end_date) - day(spec.start_date)) / 86_400_000) + 1;

  if (!page) blockers.push('הדף שנבחר לא זמין לחשבון המודעות — בחרו דף מהרשימה.');
  if (!live.image) blockers.push('התמונה של המודעה לא נמצאה — העלו אותה שוב.');
  if (spec.end_date < spec.start_date) blockers.push('תאריך הסיום לפני תאריך ההתחלה.');
  if (spec.end_date < today) blockers.push('תאריך הסיום כבר עבר.');
  if (spec.daily_budget > MAX_DAILY_BUDGET) blockers.push(`₪${spec.daily_budget} ליום חורג מהתקרה (₪${MAX_DAILY_BUDGET}) — כנראה טעות.`);
  if (spec.daily_budget < 5) blockers.push('Meta לא מקבלת תקציב יומי נמוך כל כך — לפחות ₪5 ליום.');
  if (spec.goal === 'sales') {
    if (!spec.pixel_id) blockers.push('קמפיין מכירות צריך פיקסל — בחרו פיקסל, או מטרה של כניסות לדף הכרטיסים.');
    else if (!pixels.some((p) => p.id === spec.pixel_id)) blockers.push('הפיקסל שנבחר לא נמצא בחשבון המודעות.');
  }
  if (spec.start_date < today) warnings.push('תאריך ההתחלה כבר עבר — הקמפיין יתחיל מהרגע שיופעל.');

  // The audiences, each checked against the account as it is now.
  const audiences: MetaAudience[] = live.audience_list ?? [];
  const named = (id: string) => audiences.find((a) => a.id === id);
  const label = (id: string) => `«${named(id)?.name ?? id}»`;
  for (const id of [...spec.audience_ids, ...spec.excluded_audience_ids]) {
    const a = named(id);
    if (!a) blockers.push(`הקהל ${id} לא נמצא בחשבון המודעות — בחרו מהרשימה.`);
    else if (!a.ready) warnings.push(`הקהל ${label(id)} עוד לא מוכן אצל Meta (${a.status ?? 'בעיבוד'}) — ייתכן שהמודעה לא תופץ עד שיתמלא.`);
  }
  if (spec.temperature === 'hot') {
    if (!spec.audience_ids.length) blockers.push('קמפיין חם צריך לפחות קהל שמור אחד — מבקרי דף הכרטיסים, צופי וידאו או מי שהתעניין בדף.');
    const known = spec.audience_ids.map(named).filter(Boolean) as MetaAudience[];
    const upper = known.reduce((sum, a) => sum + (a.size_upper ?? 0), 0);
    if (known.length === spec.audience_ids.length && known.every((a) => a.size_upper != null) && upper < MIN_HOT_AUDIENCE) {
      warnings.push(`הקהלים שנבחרו קטנים (עד ${upper.toLocaleString('he-IL')} איש יחד). מתחת ל-${MIN_HOT_AUDIENCE.toLocaleString('he-IL')} Meta מתקשה להפיץ, ואותם אנשים יראו את המודעה שוב ושוב — כדאי תקציב יומי נמוך, או להוסיף קהל.`);
    }
  } else if (!spec.excluded_audience_ids.length) {
    warnings.push('קמפיין קר בלי החרגות: גם מי שכבר קנה כרטיס עלול לראות אותו. אם יש בחשבון קהל של רוכשים, כדאי להחריג אותו.');
  }

  let shows: ActionPreview['shows'] = [];
  if (spec.event_id) {
    const e = db.prepare('SELECT id, venue, date FROM band_events WHERE id = ?').get(spec.event_id) as any;
    if (!e) blockers.push('ההופעה שנבחרה לא נמצאה.');
    else {
      shows = [{ event_id: e.id, label: eventLabel(e.venue, e.date), date: e.date }];
      if (spec.end_date > e.date) warnings.push(`הקמפיין ממשיך אחרי ההופעה (${e.date}) — כל יום אחריה הוא הוצאה בלי הופעה.`);
      if (e.date < today) warnings.push('ההופעה הזו כבר הייתה.');
    }
  } else {
    warnings.push('הקמפיין לא ישויך לאף הופעה, אז ההוצאה שלו תיספר כפרסום לא משויך עד שתשייכו אותו.');
  }
  if (getMetaCurrencyRate() !== 1) {
    const code = getSetting('meta_account_currency', 'ILS');
    warnings.push(`החשבון ב-${code}: ₪${spec.daily_budget} ליום יישלחו כ-${(shekelsToBudget(spec.daily_budget) / currencyOffset()).toFixed(2)} ${code} לפי השער השמור.`);
  }

  const total = days > 0 ? Math.round(spec.daily_budget * days) : null;
  const changes: ActionChange[] = [
    { label: 'קמפיין', from: 'אין', to: `«${spec.name}» · ${goal.label} · נוצר מושהה` },
    {
      label: 'קבוצת מודעות',
      from: 'אין',
      to: `${TEMPERATURES[spec.temperature]}: `
        + (spec.temperature === 'hot' ? `${spec.audience_ids.map(label).join(', ')} · ` : '')
        + `ישראל, גילאי ${spec.age_min}–${spec.age_max}${spec.age_max === 65 ? '+' : ''} · ${shekels(spec.daily_budget)}`
        + ` · ${spec.start_date} עד ${spec.end_date}${total != null ? ` (${days} ימים, עד ₪${total.toLocaleString('he-IL')})` : ''}`,
    },
    ...(spec.excluded_audience_ids.length
      ? [{ label: 'לא יוצג ל', from: 'אין החרגות', to: spec.excluded_audience_ids.map(label).join(', ') }]
      : []),
    { label: 'מודעה', from: 'אין', to: `«${spec.headline}» · ${CTA_LABELS[spec.cta]} · ${page?.name ?? spec.page_id}` },
  ];
  warnings.push('הקמפיין נוצר מושהה, וקבוצת המודעות והמודעה מוכנות בתוכו. שום כסף לא יוצא עד שמפעילים את הקמפיין, והמודעה עוברת קודם בדיקה של Meta.');

  return {
    action,
    title: `קמפיין חדש «${spec.name}»`,
    target: { level: 'campaign', id: null, name: spec.name, status: null, effective_status: null, ads_manager_url: null },
    shows,
    changes,
    warnings,
    blockers,
    can_execute: blockers.length === 0,
  };
}

/**
 * Builds the confirmed campaign, in Meta's order: the image, the campaign (paused), its ad set,
 * the creative and the ad. Each id is kept as it comes back, so a failure half-way says exactly
 * what already exists in the account rather than leaving an orphan nobody knows about.
 */
async function createCampaign(spec: CampaignSpec): Promise<Record<string, string>> {
  const account = adAccountId();
  const goal = OBJECTIVES[spec.goal];
  const made: Record<string, string> = {};
  try {
    const upload = await graphWrite<any>(`${account}/adimages`, { bytes: imageBase64(spec.image_id) });
    const image = Object.values(upload?.images ?? {})[0] as any;
    if (!image?.hash) throw new MetaError('Meta לא החזירה מזהה לתמונה');
    made.image_hash = String(image.hash);

    const campaign = await graphWrite<any>(`${account}/campaigns`, {
      name: spec.name,
      objective: goal.objective,
      status: 'PAUSED',
      special_ad_categories: '[]',
      // The budget lives on the ad set; Meta asks new campaigns to say so explicitly.
      is_adset_budget_sharing_enabled: 'false',
    });
    made.campaign_id = String(campaign.id);

    const adset = await graphWrite<any>(`${account}/adsets`, {
      name: `${spec.name} — ${TEMPERATURES[spec.temperature]}`,
      campaign_id: made.campaign_id,
      daily_budget: String(shekelsToBudget(spec.daily_budget)),
      billing_event: 'IMPRESSIONS',
      optimization_goal: goal.optimization_goal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      start_time: `${spec.start_date}T00:00:00${israelEndOfDay(spec.start_date).slice(-6)}`,
      end_time: israelEndOfDay(spec.end_date),
      targeting: JSON.stringify({
        geo_locations: { countries: ['IL'] },
        age_min: spec.age_min,
        age_max: spec.age_max,
        ...(spec.audience_ids.length ? { custom_audiences: spec.audience_ids.map((id) => ({ id })) } : {}),
        ...(spec.excluded_audience_ids.length ? { excluded_custom_audiences: spec.excluded_audience_ids.map((id) => ({ id })) } : {}),
        targeting_automation: { advantage_audience: 0 },
      }),
      ...(spec.goal === 'awareness' ? {} : { destination_type: 'WEBSITE' }),
      ...(spec.goal === 'sales' ? { promoted_object: JSON.stringify({ pixel_id: spec.pixel_id, custom_event_type: 'PURCHASE' }) } : {}),
      status: 'ACTIVE',
    });
    made.adset_id = String(adset.id);

    const creative = await graphWrite<any>(`${account}/adcreatives`, {
      name: `${spec.name} — מודעה`,
      object_story_spec: JSON.stringify({
        page_id: spec.page_id,
        link_data: {
          link: spec.link,
          message: spec.primary_text,
          name: spec.headline,
          ...(spec.description ? { description: spec.description } : {}),
          image_hash: made.image_hash,
          call_to_action: { type: spec.cta, value: { link: spec.link } },
        },
      }),
    });
    made.creative_id = String(creative.id);

    const ad = await graphWrite<any>(`${account}/ads`, {
      name: spec.name,
      adset_id: made.adset_id,
      creative: JSON.stringify({ creative_id: made.creative_id }),
      status: 'ACTIVE',
    });
    made.ad_id = String(ad.id);
  } catch (err: any) {
    const parts = [
      made.campaign_id && `קמפיין ${made.campaign_id}`,
      made.adset_id && `קבוצת מודעות ${made.adset_id}`,
      made.creative_id && `קריאייטיב ${made.creative_id}`,
    ].filter(Boolean);
    const partial = parts.length ? ` כבר נוצרו (מושהים): ${parts.join(', ')} — אפשר להשלים או למחוק ב-Ads Manager.` : '';
    throw Object.assign(new MetaError(`${err?.message || err}.${partial}`, err?.status ?? 502), { created: made });
  }

  // The studio lists synced campaigns; this one should be there before the next pull, and on its show.
  db.prepare(
    `INSERT INTO meta_campaigns (id, account_id, name, status, objective, currency, synced_at)
     VALUES (?, ?, ?, 'PAUSED', ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status`
  ).run(made.campaign_id, account, spec.name, goal.objective, getSetting('meta_account_currency', 'ILS'));
  if (spec.event_id && db.prepare('SELECT id FROM band_events WHERE id = ?').get(spec.event_id)) {
    db.prepare(
      `INSERT INTO meta_campaign_events (id, campaign_id, event_id, weight) VALUES (?, ?, ?, 1)
       ON CONFLICT(campaign_id, event_id) DO NOTHING`
    ).run(uuid(), made.campaign_id, spec.event_id);
    applyCampaignSpend();
  }
  return made;
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
  // A campaign is built only in the studio's wizard, whose preview says it came from there.
  const [action] = cleanActions([raw], { manual: origin.source === 'studio' });
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
      case 'rename':
        result = await graphWrite(action.id!, { name: action.new_name! });
        break;
      case 'archive':
        result = await graphWrite(action.id!, { status: 'ARCHIVED' });
        break;
      case 'create_campaign':
        result = await createCampaign(action.spec!);
        break;
      case 'create_audience': {
        const spec = action.audience!;
        const made = await graphWrite<any>(`${adAccountId()}/customaudiences`, {
          name: spec.name,
          rule: JSON.stringify(audienceRule(spec)),
          // Fill it from the days that already passed, not only from now on.
          prefill: 'true',
          description: 'נוצר במרכז הקמפיינים',
        });
        result = { audience_id: String(made.id) };
        break;
      }
    }
    finish(id, 'done', { result });
    // The campaign list reads the synced status; a pause made here should not wait for the next pull.
    if (action.level === 'campaign' && action.id) {
      const status = action.type === 'pause' ? 'PAUSED' : action.type === 'activate' ? 'ACTIVE' : action.type === 'archive' ? 'ARCHIVED' : null;
      if (status) db.prepare('UPDATE meta_campaigns SET status = ? WHERE id = ?').run(status, action.id);
      if (action.type === 'rename') db.prepare('UPDATE meta_campaigns SET name = ? WHERE id = ?').run(action.new_name, action.id);
    }
  } catch (err: any) {
    const current = (db.prepare('SELECT status FROM meta_actions WHERE id = ?').get(id) as { status: string }).status;
    if (current === 'executing') finish(id, 'failed', { result: err?.created, error: String(err?.message || err).slice(0, 500) });
    throw err;
  }
  return getAction(id);
}
