import { randomBytes } from 'crypto';
import { db, getBandName, getSetting, setSetting } from './db.js';
import { listRules } from './calendarRules.js';
import { activeBandMembers } from './band.js';
import { attendeeEmails, assignmentsForEvent } from './assignments.js';
import { roleNames } from './supplierRoles.js';
import { looksPrivate } from './showPrivacy.js';
import { israelDate } from './campaignTasks.js';

/**
 * Two boards of upcoming shows, each a link that opens without a login.
 *
 *  - The **public board** (`/board/:token`) is for friends and fans: every upcoming show — the
 *    band's and the owner's own calendar gigs — with a tidy name, the place, a map link and the
 *    ticket link. Private events (a wedding, a company evening) never appear on it.
 *  - The **crew board** (`/crew/:token`) is for the band: the band's shows only, private ones
 *    included, with who is playing in which role, the sound company, when to arrive, when the
 *    sound check starts, where to park, and the reminders the venue calls for («זאפה» → bring the
 *    wireless microphone).
 *
 * Everything starts from what the calendar sync stored. The owner can correct any of it per
 * show (show_board_items): a nicer name, a ticket link, hide it, or the logistics typed by hand.
 * Money never appears on either board, and of the calendar description only the lines about
 * arrival, sound check, stage time and parking are read — the rest of it stays in the database.
 *
 * The token in the path is the whole credential, exactly as with a quote's link. Rotating it
 * (or switching the board off) kills every copy of the old link at once.
 */

export class BoardError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type BoardKind = 'public' | 'crew';

const TOKEN_KEY: Record<BoardKind, string> = { public: 'show_board_token', crew: 'crew_board_token' };

const newToken = () => randomBytes(24).toString('base64url');

/** A board's link token, or '' while the board is switched off. */
export const boardToken = (kind: BoardKind) => getSetting(TOKEN_KEY[kind], '');

/** Switches a board on with a fresh link (which also kills the old one), or off. */
export function setBoardEnabled(kind: BoardKind, enabled: boolean): string {
  const token = enabled ? newToken() : '';
  setSetting(TOKEN_KEY[kind], token);
  return token;
}

const sameToken = (a: string, b: string) => !!a && !!b && a.length === b.length && a === b;

// ---------------------------------------------------------------- settings

export interface VenueReminder {
  /** Comma-separated words; any of them in the show's name or place triggers the reminder. */
  keywords: string;
  text: string;
}

/** The clubs whose own sound means the singer brings the wireless microphone. Editable. */
const DEFAULT_REMINDERS: VenueReminder[] = [
  { keywords: 'זאפה, Zappa, גריי, Gray', text: 'להביא מיקרופון אלחוטי' },
];

export interface BoardSettings {
  public_title: string;
  crew_title: string;
  /** Whether the band's own (non-private) shows are on the public board. */
  include_band: boolean;
  /** Personal calendar rules whose works are on the public board; null = all of them. */
  /** Retired: the public board used to pick works by calendar rule. Read only to carry it over. */
  personal_rules: string[] | null;
  /**
   * Clients whose works stay off the public board. Every work has a client — the calendar's and
   * the ones typed into «עבודות» by hand alike — so this is the one switch that covers them all.
   * Opt-out: a work shows unless its client is listed here.
   */
  excluded_clients: string[];
  reminders: VenueReminder[];
  /** Acts typed by hand: a name and the words in a calendar title that mean it. */
  acts: ActDef[];
}

export interface ActDef {
  name: string;
  /** Comma-separated; the name itself always counts as one. */
  keywords: string;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = getSetting(key, '');
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function boardSettings(): BoardSettings {
  return {
    public_title: getSetting('show_board_title', ''),
    crew_title: getSetting('crew_board_title', ''),
    include_band: getSetting('show_board_include_band', '1') !== '0',
    personal_rules: readJson<string[] | null>('show_board_rules', null),
    excluded_clients: readJson<string[]>('show_board_excluded_clients', []),
    reminders: readJson<VenueReminder[]>('crew_board_reminders', DEFAULT_REMINDERS),
    acts: readJson<ActDef[]>('show_board_acts', []),
  };
}

const cleanText = (value: unknown, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function updateBoardSettings(patch: Partial<BoardSettings>): BoardSettings {
  if (patch.public_title !== undefined) setSetting('show_board_title', cleanText(patch.public_title, 120));
  if (patch.crew_title !== undefined) setSetting('crew_board_title', cleanText(patch.crew_title, 120));
  if (patch.include_band !== undefined) setSetting('show_board_include_band', patch.include_band ? '1' : '0');
  if (patch.excluded_clients !== undefined) {
    const ids = Array.isArray(patch.excluded_clients) ? patch.excluded_clients.map((id) => String(id)).filter(Boolean) : [];
    setSetting('show_board_excluded_clients', JSON.stringify([...new Set(ids)]));
  }
  if (patch.personal_rules !== undefined) {
    const rules = Array.isArray(patch.personal_rules)
      ? patch.personal_rules.map((id) => String(id)).filter(Boolean)
      : null;
    setSetting('show_board_rules', rules ? JSON.stringify(rules) : '');
  }
  if (patch.reminders !== undefined) {
    const list = (Array.isArray(patch.reminders) ? patch.reminders : [])
      .map((r) => ({ keywords: cleanText(r?.keywords, 300), text: cleanText(r?.text, 200) }))
      .filter((r) => r.keywords && r.text)
      .slice(0, 30);
    setSetting('crew_board_reminders', JSON.stringify(list));
  }
  if (patch.acts !== undefined) {
    const list = (Array.isArray(patch.acts) ? patch.acts : [])
      .map((a) => ({ name: cleanText(a?.name, 60), keywords: cleanText(a?.keywords, 300) }))
      .filter((a) => a.name)
      .slice(0, 40);
    setSetting('show_board_acts', JSON.stringify(list));
  }
  return boardSettings();
}

// ---------------------------------------------------------------- parsing the calendar

/**
 * «אופציה» in an event's name: the date is held for a quote the client has not signed yet
 * (server/quoteOption.ts writes it at the front; a hand-written one may sit anywhere). Read as a
 * whole word, with the Hebrew prefixes, so «אופציות» in a venue's name does not count.
 */
const OPTION_WORD = /(^|[^\p{L}\p{N}])[הב]?אופציה(?![\p{L}\p{N}])/u;

export const isOption = (...texts: Array<string | null | undefined>) => texts.some((t) => !!t && OPTION_WORD.test(t));

/** The name with «אופציה» (and the dash that glued it on) taken out, for showing next to its badge. */
export function withoutOptionWord(title: string): string {
  const out = title
    .replace(/(^|[^\p{L}\p{N}])[הב]?אופציה(?![\p{L}\p{N}])\s*[-–—:|]?\s*/gu, '$1')
    .replace(/\s*[-–—:|]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return out || title;
}

/** Words that say "this is a show" and nothing else, taken off the front of a public name. */
const LEADING_NOISE = ['הופעה', 'הופעות', 'גיג', 'show', 'gig'];
const SEPARATORS = '\\-–—:|,';

/**
 * The name a show goes by on the public page: the calendar's own title with the word «הופעה»
 * taken off the front. «הופעה קולדפליי זאפה תל אביב» → «קולדפליי זאפה תל אביב»; a title that
 * already reads well («קרניבנד אלטון ג'ון בהיכל התרבות») is left exactly as it is.
 */
export function publicTitle(raw: string | null | undefined): string {
  let title = withoutOptionWord(String(raw ?? '').replace(/\s+/g, ' ').trim());
  const original = title;
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of LEADING_NOISE) {
      const next = title.replace(new RegExp(`^${word}(?![\\p{L}\\p{N}])[\\s${SEPARATORS}]*`, 'iu'), '');
      if (next !== title) {
        title = next;
        changed = true;
      }
    }
  }
  return title.trim() || original;
}

export interface Place {
  /** What the place is called — the first part of the calendar's location. */
  name: string;
  /** The rest of it, the street and the town, when there is a rest. */
  address: string | null;
  maps_url: string;
  waze_url: string;
}

/**
 * The calendar's location as a person reads it. Google writes a picked place as
 * «Zappa Tel Aviv, Raoul Wallenberg St 24, Tel Aviv-Yafo, Israel»: the name, then the address,
 * then the country nobody here needs. The full string is what the map links search for.
 */
export function splitLocation(location: string | null | undefined): Place | null {
  const full = String(location ?? '').replace(/\s+/g, ' ').trim();
  if (!full) return null;
  const parts = full.split(',').map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1 && /^(israel|ישראל)$/i.test(parts[parts.length - 1])) parts.pop();
  // A bare street address ("Raoul Wallenberg St 24") has no name before it; show it whole.
  const firstIsAddress = /\d/.test(parts[0] ?? '') && parts.length > 1;
  const name = firstIsAddress ? parts.join(', ') : parts[0];
  const address = firstIsAddress ? null : parts.slice(1).join(', ') || null;
  const q = encodeURIComponent(full);
  return {
    name,
    address,
    maps_url: `https://www.google.com/maps/search/?api=1&query=${q}`,
    waze_url: `https://waze.com/ul?q=${q}&navigate=yes`,
  };
}

/** A calendar description as plain lines: Google stores it as light HTML. */
export function descriptionLines(description: string | null | undefined): string[] {
  const text = String(description ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export interface Logistics {
  call_time: string | null;
  soundcheck_time: string | null;
  stage_time: string | null;
  parking: string | null;
}

const TIME = '(\\d{1,2})[:.](\\d{2})';

const CALL_WORDS = 'הגעה|להגיע|מגיעים|הגעת|נפגשים|התכנסות|call\\s*time|load[\\s-]*in';
const SOUNDCHECK_WORDS = "בלאנס|באלאנס|בלנס|סאונד\\s*צ['׳]?ק|סאונדצ['׳]?ק|בדיקת\\s*סאונד|sound\\s*check|soundcheck";
const STAGE_WORDS = 'עלייה\\s*לבמה|עליה\\s*לבמה|עולים|תחילת\\s*(?:ה)?הופעה|תחילת\\s*מופע|stage\\s*time|on\\s*stage';
const PARKING_WORDS = 'חניה|חנייה|חניון|לחנות|parking';

const hhmm = (h: string, m: string) => `${h.padStart(2, '0')}:${m}`;

/** The first time written within a few words after one of the words. */
function timeAfter(lines: string[], words: string): string | null {
  const pattern = new RegExp(`(?:${words})[^\\d\\n]{0,20}${TIME}`, 'iu');
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && Number(match[1]) < 24) return hhmm(match[1], match[2]);
  }
  return null;
}

/**
 * The logistics a band writes into a show's calendar description — «הגעה 17:30», «בלאנס 18:00»,
 * «חניה בחניון הבימה» — picked out of it line by line. Nothing else is read: a description is
 * also where the fee and the promoter's phone get written down.
 */
export function parseLogistics(description: string | null | undefined): Logistics {
  const lines = descriptionLines(description);
  const parkingLine = lines.find((l) => new RegExp(`(?:${PARKING_WORDS})`, 'iu').test(l));
  return {
    call_time: timeAfter(lines, CALL_WORDS),
    soundcheck_time: timeAfter(lines, SOUNDCHECK_WORDS),
    stage_time: timeAfter(lines, STAGE_WORDS),
    // "חניה: חניון ארלוזורוב" reads better without its label; "יש חניה מאחורי המועדון" keeps it.
    parking: parkingLine ? parkingLine.replace(/^(?:חניה|חנייה|parking)\s*[:\-–]\s*/iu, '').slice(0, 300) : null,
  };
}

/** The reminders whose words appear in the show's name or place. */
export function remindersFor(reminders: VenueReminder[], ...texts: Array<string | null | undefined>): string[] {
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return [];
  const out: string[] = [];
  for (const r of reminders) {
    const words = r.keywords.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.some((w) => haystack.includes(w)) && !out.includes(r.text)) out.push(r.text);
  }
  return out;
}

// ---------------------------------------------------------------- acts

export type ActFinder = (...texts: Array<string | null | undefined>) => string | null;

/** Words a calendar rule may search for that say "a show" rather than whose show it is. */
const NOT_AN_ACT = new Set(['הופעה', 'הופעות', 'מופע', 'מופעים', 'גיג', 'גיגים', 'show', 'shows', 'gig', 'gigs']);

/**
 * Which act a show is — the badge the public board filters by («Disco Train», «קולדפליי»).
 *
 * Acts typed by hand come first, matched on their name or any of their words. Failing those,
 * the calendar rules' own keywords are the acts: a rule that draws «קולדפליי» events is the
 * Coldplay act's rule. The longest match wins, so «קרניבנד אלטון ג'ון» beats «קרניבנד».
 * Nothing matching leaves the caller's fallback (the band's name, or the rule's).
 */
export function actFinder(manual: ActDef[] = boardSettings().acts): ActFinder {
  const entries: Array<{ word: string; name: string; manual: boolean }> = [];
  for (const act of manual) {
    for (const word of [act.name, ...act.keywords.split(',')]) {
      const w = word.trim().toLowerCase();
      if (w) entries.push({ word: w, name: act.name, manual: true });
    }
  }
  for (const rule of listRules()) {
    for (const keyword of rule.keywords.split(/[,\n]/)) {
      const k = keyword.trim();
      if (k && !NOT_AN_ACT.has(k.toLowerCase()) && !k.includes('@')) entries.push({ word: k.toLowerCase(), name: k, manual: false });
    }
  }
  entries.sort((a, b) => Number(b.manual) - Number(a.manual) || b.word.length - a.word.length);
  return (...texts) => {
    const hay = texts.filter(Boolean).join(' ').toLowerCase();
    if (!hay) return null;
    return entries.find((e) => hay.includes(e.word))?.name ?? null;
  };
}

// ---------------------------------------------------------------- regions

/** The regions the public board filters by, in the order they are offered (north to south). */
export const REGIONS = ['צפון', 'שרון', 'מרכז', 'ירושלים', 'דרום', 'אילת'] as const;
export type Region = (typeof REGIONS)[number];

/** Towns, in Hebrew and as Google spells them, and the region each one is in. */
const TOWNS: Record<Region, string[]> = {
  'צפון': ['חיפה', 'Haifa', 'קריית', 'קרית', 'Kiryat', 'Qiryat', 'נהריה', 'Nahariya', 'עכו', 'Akko', 'Acre',
    'כרמיאל', 'Karmiel', 'נצרת', 'Nazareth', 'עפולה', 'Afula', 'טבריה', 'Tiberias', 'צפת', 'Safed', 'Tzfat',
    'יקנעם', 'Yokneam', 'זכרון יעקב', 'Zikhron', 'טירת כרמל', 'Tirat Carmel', 'נשר', 'Nesher', 'מעלות',
    'ראש פינה', 'Rosh Pina', 'גליל', 'Galil', 'Galilee', 'גולן', 'Golan', 'קצרין', 'Katzrin', 'עתלית', 'בית שאן',
    'Beit She\'an', 'מגדל העמק', 'Migdal HaEmek', 'שפרעם', 'יוקנעם'],
  'שרון': ['נתניה', 'Netanya', 'הרצליה', 'Herzliya', 'רעננה', "Ra'anana", 'Raanana', 'כפר סבא', 'Kefar Sava',
    'Kfar Saba', 'הוד השרון', 'Hod HaSharon', 'חדרה', 'Hadera', 'קיסריה', 'Caesarea', 'פרדס חנה', 'Pardes Hanna',
    'אבן יהודה', 'Even Yehuda', 'כוכב יאיר', 'רמת השרון', 'Ramat HaSharon', 'אור עקיבא', 'Or Akiva', 'שרון'],
  'מרכז': ['תל אביב', 'Tel Aviv', 'Tel-Aviv', 'יפו', 'Jaffa', 'Yafo', 'רמת גן', 'Ramat Gan', 'גבעתיים', 'Givatayim',
    'בני ברק', 'Bnei Brak', 'פתח תקווה', 'פתח תקוה', 'Petah Tikva', 'Petah Tiqva', 'ראשון לציון', 'Rishon',
    'חולון', 'Holon', 'בת ים', 'Bat Yam', 'אור יהודה', 'Or Yehuda', 'יהוד', 'Yehud', 'ראש העין', 'Rosh HaAyin',
    'אייר פורט סיטי', 'Airport City', 'שוהם', 'Shoham', 'לוד', 'Lod', 'רמלה', 'Ramla', 'מודיעין', "Modi'in",
    'Modiin', 'נס ציונה', 'Ness Ziona', 'Nes Tziona', 'רחובות', 'Rehovot', 'קריית אונו', 'קרית אונו', 'Kiryat Ono',
    'יבנה', 'Yavne', 'גדרה', 'Gedera', 'אלעד', 'Elad', 'גני תקווה', 'Ganei Tikva', 'סביון', 'Savyon'],
  'ירושלים': ['ירושלים', 'Jerusalem', 'בית שמש', 'Beit Shemesh', 'מבשרת', 'Mevaseret', 'מעלה אדומים',
    "Ma'ale Adumim", 'אבו גוש', 'Abu Ghosh'],
  'דרום': ['אשדוד', 'Ashdod', 'אשקלון', 'Ashkelon', 'באר שבע', 'Beer Sheva', "Be'er Sheva", 'Beersheba',
    'קריית גת', 'קרית גת', 'Kiryat Gat', 'שדרות', 'Sderot', 'נתיבות', 'Netivot', 'אופקים', 'Ofakim', 'דימונה',
    'Dimona', 'ערד', 'Arad', 'מצפה רמון', 'Mitzpe Ramon', 'קריית מלאכי', 'Kiryat Malakhi', 'נגב', 'Negev'],
  'אילת': ['אילת', 'Eilat', 'Elat'],
};

const TOWN_LIST: Array<{ word: string; region: Region }> = Object.entries(TOWNS)
  .flatMap(([region, words]) => words.map((word) => ({ word: word.toLowerCase(), region: region as Region })))
  // The longest name wins, so «קריית אונו» is the centre and not the north's «קריית».
  .sort((a, b) => b.word.length - a.word.length);

/** The region a show is in, from the town in its location (or failing that, its name). */
export function regionFor(...texts: Array<string | null | undefined>): Region | null {
  for (const text of texts) {
    const hay = String(text ?? '').toLowerCase();
    if (!hay) continue;
    const hit = TOWN_LIST.find((t) => hay.includes(t.word));
    if (hit) return hit.region;
  }
  return null;
}

export const isRegion = (value: unknown): value is Region => (REGIONS as readonly string[]).includes(String(value));

// ---------------------------------------------------------------- per-show decisions

export interface BoardItemOverride {
  public_title: string | null;
  ticket_url: string | null;
  hidden: boolean;
  call_time: string | null;
  soundcheck_time: string | null;
  parking: string | null;
  notes: string | null;
  region: Region | null;
  act: string | null;
}

function overrides(): Map<string, BoardItemOverride> {
  const rows = db.prepare('SELECT * FROM show_board_items').all() as any[];
  return new Map(rows.map((r) => [r.item_key, {
    public_title: r.public_title ?? null,
    ticket_url: r.ticket_url ?? null,
    hidden: !!r.hidden,
    call_time: r.call_time ?? null,
    soundcheck_time: r.soundcheck_time ?? null,
    parking: r.parking ?? null,
    notes: r.notes ?? null,
    region: isRegion(r.region) ? r.region : null,
    act: r.act ?? null,
  }]));
}

const EMPTY_OVERRIDE: BoardItemOverride = {
  public_title: null, ticket_url: null, hidden: false, call_time: null, soundcheck_time: null, parking: null, notes: null,
  region: null, act: null,
};

/** A link someone typed, or null: only http(s), so the page never renders a javascript: href. */
export function cleanUrl(value: unknown): string | null {
  let raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^[a-z]+:/i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.toString();
  } catch {
    throw new BoardError('קישור לא תקין');
  }
}

const cleanTime = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new BoardError(`שעה לא תקינה: ${raw}`);
  return hhmm(match[1], match[2]);
};

const optionalText = (value: unknown, max: number) => cleanText(value, max) || null;

const KEY_PATTERN = /^(show|work):[\w-]+$/;

/** Saves what the owner decided about one show; only the fields sent change. */
export function updateBoardItem(key: string, patch: Record<string, unknown>) {
  if (!KEY_PATTERN.test(key)) throw new BoardError('מזהה לא תקין', 404);
  const [kind, id] = key.split(':');
  const exists = kind === 'show'
    ? db.prepare('SELECT 1 FROM band_events WHERE id = ?').get(id)
    : db.prepare('SELECT 1 FROM works WHERE id = ?').get(id);
  if (!exists) throw new BoardError('ההופעה לא נמצאה', 404);

  const current = overrides().get(key) ?? EMPTY_OVERRIDE;
  const next = { ...current };
  if ('public_title' in patch) next.public_title = optionalText(patch.public_title, 160);
  if ('hidden' in patch) next.hidden = !!patch.hidden;
  if ('call_time' in patch) next.call_time = cleanTime(patch.call_time);
  if ('soundcheck_time' in patch) next.soundcheck_time = cleanTime(patch.soundcheck_time);
  if ('parking' in patch) next.parking = optionalText(patch.parking, 300);
  if ('act' in patch) next.act = optionalText(patch.act, 60);
  if ('region' in patch) next.region = isRegion(patch.region) ? patch.region : null;
  if ('notes' in patch) next.notes = String(patch.notes ?? '').trim().slice(0, 1000) || null;
  if ('ticket_url' in patch) {
    const url = cleanUrl(patch.ticket_url);
    // A band show already has a ticket link (the ticket check reads and fills it); one place for it.
    if (kind === 'show') db.prepare('UPDATE band_events SET ticket_url = ? WHERE id = ?').run(url, id);
    else next.ticket_url = url;
  }

  db.prepare(
    `INSERT INTO show_board_items (item_key, public_title, ticket_url, hidden, call_time, soundcheck_time, parking, notes,
       region, act, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(item_key) DO UPDATE SET public_title = excluded.public_title, ticket_url = excluded.ticket_url,
       hidden = excluded.hidden, call_time = excluded.call_time, soundcheck_time = excluded.soundcheck_time,
       parking = excluded.parking, notes = excluded.notes, region = excluded.region, act = excluded.act, updated_at = excluded.updated_at`
  ).run(key, next.public_title, next.ticket_url, next.hidden ? 1 : 0, next.call_time, next.soundcheck_time, next.parking, next.notes,
    next.region, next.act);
  return boardItems().find((item) => item.key === key) ?? null;
}

// ---------------------------------------------------------------- assembling the boards

export interface BoardItem {
  key: string;
  source: 'band' | 'work';
  /** For a work: which client/rule it came from, so the owner can tell the lists apart. */
  source_label: string;
  date: string;
  time: string | null;
  /** The stored name, as the books know it. */
  name: string;
  /** The name worked out for the public page, before any override. */
  auto_title: string;
  title: string;
  place: Place | null;
  /** The region guessed from the town, and the one in force (the owner's, when set). */
  auto_region: Region | null;
  region: Region | null;
  /** Which act this is — guessed from the title (see actFor), or the owner's. */
  auto_act: string | null;
  act: string | null;
  ticket_url: string | null;
  is_private: boolean;
  /** «אופציה»: held for a quote that is not signed yet — on the band's board, never on the public one. */
  is_option: boolean;
  hidden: boolean;
  /** Whether it appears on the public board, all things considered. */
  on_public: boolean;
  /** Why not, when it does not. */
  off_reason: string | null;
  override: BoardItemOverride;
  /** Band shows only: what the calendar description says, before anything typed by hand. */
  parsed: Logistics | null;
}

function regionOf(o: BoardItemOverride, ...texts: Array<string | null | undefined>) {
  const auto = regionFor(...texts);
  return { auto_region: auto, region: o.region ?? auto };
}

function actOf(o: BoardItemOverride, finder: ActFinder, fallback: string | null, ...texts: Array<string | null | undefined>) {
  const auto = finder(...texts) ?? fallback;
  return { auto_act: auto, act: o.act ?? auto };
}

/** Upcoming band shows and calendar works, with everything the boards and the owner need. */
export function boardItems(options: { from?: string } = {}): BoardItem[] {
  const from = options.from ?? israelDate();
  const settings = boardSettings();
  const over = overrides();
  const items: BoardItem[] = [];
  const bandName = getBandName();
  const finder = actFinder(settings.acts);

  const shows = db.prepare(
    `SELECT id, venue, date, location, ticket_url, is_private, venue_locked, start_time, calendar_summary, calendar_description
       FROM band_events WHERE date >= ? ORDER BY date, start_time`
  ).all(from) as any[];
  for (const s of shows) {
    const key = `show:${s.id}`;
    const o = over.get(key) ?? EMPTY_OVERRIDE;
    // A name typed by hand in the app is the owner's choice; otherwise the calendar's own title.
    const auto = publicTitle(s.venue_locked || !s.calendar_summary ? s.venue : s.calendar_summary);
    const isPrivate = !!s.is_private;
    const option = isOption(s.calendar_summary, s.venue);
    const offReason = option ? 'אופציה — עוד לא נסגר' : isPrivate ? 'אירוע פרטי'
      : o.hidden ? 'הוסתר ידנית'
        : !settings.include_band ? `הופעות ${bandName} לא מוצגות` : null;
    items.push({
      key, source: 'band', source_label: bandName, date: s.date, time: s.start_time ?? null,
      name: s.venue, auto_title: auto, title: o.public_title || auto,
      place: splitLocation(s.location), ticket_url: s.ticket_url ?? null,
      ...regionOf(o, s.location, auto, s.venue),
      ...actOf(o, finder, bandName, s.calendar_summary, s.venue),
      is_private: isPrivate, is_option: option, hidden: o.hidden, on_public: !offReason, off_reason: offReason,
      override: o, parsed: parseLogistics(s.calendar_description),
    });
  }

  const personalRules = listRules().filter((r) => r.target === 'personal');
  const ruleById = new Map(personalRules.map((r) => [r.id, r]));
  // A work synced before the rule was recorded on it is still that client's rule's work.
  const ruleByClient = new Map(personalRules.filter((r) => r.client_name).map((r) => [r.client_name!.trim(), r]));
  const excluded = new Set(settings.excluded_clients);
  // Every work, not only the calendar's: a show typed into «עבודות» by hand is a show too.
  const works = db.prepare(
    `SELECT w.id, w.description, w.date, w.location, w.start_time, w.calendar_rule_id, w.calendar_private,
            w.calendar_summary, w.description_locked, w.client_id, c.name AS client_name
       FROM works w LEFT JOIN clients c ON c.id = w.client_id
      WHERE w.date >= ? ORDER BY w.date, w.start_time`
  ).all(from) as any[];
  for (const w of works) {
    const key = `work:${w.id}`;
    const o = over.get(key) ?? EMPTY_OVERRIDE;
    const rule = (w.calendar_rule_id ? ruleById.get(w.calendar_rule_id) : undefined)
      ?? ruleByClient.get(String(w.client_name ?? '').trim());
    const auto = publicTitle(w.description_locked || !w.calendar_summary ? w.description : w.calendar_summary);
    // Typed by hand, there is no calendar flag to read — the name itself may still say «פרטי».
    const isPrivate = !!w.calendar_private || looksPrivate(w.description);
    const option = isOption(w.calendar_summary, w.description);
    const clientOff = excluded.has(w.client_id);
    const offReason = option ? 'אופציה — עוד לא נסגר' : isPrivate ? 'אירוע פרטי'
      : o.hidden ? 'הוסתר ידנית'
        : clientOff ? `${w.client_name || 'הלקוח'} לא מוצג בלוח` : null;
    items.push({
      key, source: 'work', source_label: w.client_name || rule?.name || 'עבודות', date: w.date, time: w.start_time ?? null,
      name: w.description, auto_title: auto, title: o.public_title || auto,
      place: splitLocation(w.location), ticket_url: o.ticket_url,
      ...regionOf(o, w.location, auto, w.description),
      ...actOf(o, finder, rule?.name ?? null, w.calendar_summary, w.description),
      is_private: isPrivate, is_option: option, hidden: o.hidden, on_public: !offReason, off_reason: offReason,
      override: o, parsed: null,
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'));
}

/** What the friends' link answers. Nothing on it but the name, the time, the place and the tickets. */
export function publicBoard(token: string) {
  if (!sameToken(token, boardToken('public'))) throw new BoardError('הקישור הזה כבר לא פעיל', 404);
  const settings = boardSettings();
  return {
    title: settings.public_title || 'ההופעות הקרובות',
    shows: boardItems()
      .filter((item) => item.on_public)
      .map((item) => ({
        id: item.key.split(':')[1].slice(0, 8),
        date: item.date,
        time: item.time,
        title: item.title,
        place: item.place,
        region: item.region,
        act: item.act,
        ticket_url: item.ticket_url,
      })),
    regions: REGIONS,
  };
}

/** Roles that are paid for a show but are not people standing in the room on the night. */
const OFF_SITE_ROLES = new Set(['akom', 'bracelets', 'hall_fee', 'campaign', 'refreshments', 'design', 'other']);

/** Who is playing: the members on the calendar invitation, or the whole band when nobody was invited. */
function lineup(eventRow: any) {
  const members = activeBandMembers();
  const guests = new Set(attendeeEmails(eventRow));
  const email = (m: any) => String(m.email ?? '').trim().toLowerCase();
  const playing = guests.size
    // A member with no email cannot be checked against the invitation, so they are assumed in.
    ? members.filter((m) => !email(m) || guests.has(email(m)))
    : members;
  return playing.map((m) => ({ name: m.name as string, role: (m.role as string | null) || 'הרכב' }));
}

function staff(eventId: string) {
  const names = roleNames();
  const rows = assignmentsForEvent(eventId).filter((a) => a.supplier_id && !a.not_needed && !OFF_SITE_ROLES.has(a.role));
  const out: Array<{ role_key: string; role: string; name: string }> = [];
  for (const a of rows) {
    const supplier = db.prepare('SELECT name FROM band_suppliers WHERE id = ?').get(a.supplier_id) as any;
    if (supplier) out.push({ role_key: a.role, role: names.get(a.role) || a.role, name: supplier.name });
  }
  return out;
}

/** What the band's link answers: the band's shows, private ones too, with the night's logistics. */
export function crewBoard(token: string) {
  if (!sameToken(token, boardToken('crew'))) throw new BoardError('הקישור הזה כבר לא פעיל', 404);
  const settings = boardSettings();
  const bandName = getBandName();
  const today = israelDate();
  // «כל ההופעות» on the band's board reaches back to the start of last year's same month, so the
  // band can look up who played a show they already did; «קרובות» starts at today.
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 8)}01`;
  const shows = boardItems({ from }).filter((item) => item.source === 'band').map((item) => {
    const id = item.key.split(':')[1];
    const row = db.prepare('SELECT * FROM band_events WHERE id = ?').get(id) as any;
    const parsed = item.parsed ?? { call_time: null, soundcheck_time: null, stage_time: null, parking: null };
    const crew = staff(id);
    return {
      id: id.slice(0, 8),
      date: item.date,
      time: item.time,
      // The band knows a private show by the name it has in the books; the public name is for fans.
      title: item.is_private ? withoutOptionWord(item.name) : item.title,
      act: item.act,
      is_private: item.is_private,
      // «סגור» or «אופציה», as the band reads it at a glance.
      status: item.is_option ? 'option' : 'confirmed',
      past: item.date < today,
      place: item.place,
      call_time: item.override.call_time ?? parsed.call_time,
      soundcheck_time: item.override.soundcheck_time ?? parsed.soundcheck_time,
      stage_time: parsed.stage_time,
      parking: item.override.parking ?? parsed.parking,
      notes: item.override.notes,
      reminders: remindersFor(settings.reminders, row?.venue, row?.calendar_summary, row?.location),
      sound_company: crew.find((c) => c.role_key === 'sound_company')?.name ?? null,
      members: lineup(row),
      crew: crew.filter((c) => c.role_key !== 'sound_company').map(({ role, name }) => ({ role, name })),
      ticket_url: item.ticket_url,
    };
  });
  // Everybody on any show, for «בחרו שם לראות רק את שלכם».
  const people = [...new Set(shows.flatMap((s) => [
    ...s.members.map((m) => m.name), ...s.crew.map((c) => c.name), ...(s.sound_company ? [s.sound_company] : []),
  ]))].sort((a, b) => a.localeCompare(b, 'he'));
  return { title: settings.crew_title || 'לוח הופעות', band_name: bandName, today, people, shows };
}

/** The owner's screen: both links, the settings, and every upcoming show with its decisions. */
export function boardAdmin() {
  return {
    tokens: { public: boardToken('public'), crew: boardToken('crew') },
    settings: boardSettings(),
    band_name: getBandName(),
    regions: REGIONS,
    // The clients that have upcoming works: a switch each for the public board.
    clients: db.prepare(
      `SELECT c.id, c.name, COUNT(*) AS upcoming FROM works w JOIN clients c ON c.id = w.client_id
        WHERE w.date >= ? GROUP BY c.id ORDER BY upcoming DESC, c.name`
    ).all(israelDate()) as Array<{ id: string; name: string; upcoming: number }>,
    items: boardItems(),
  };
}
