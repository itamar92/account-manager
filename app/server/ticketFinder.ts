import { db, getBandName, getSetting, setSetting, uuid } from './db.js';
import { eventDate, listEvents, type CalendarEvent } from './calendarClient.js';
import { listRules } from './calendarRules.js';
import { updateBoardItem } from './showBoard.js';

/**
 * Finds where a show's tickets are sold.
 *
 * The band names the pages to look on (`ticket_sources`): a venue's listing on a ticketing
 * site, or a site's search address with {q} where the search words go. Nothing here knows any
 * one site. A source page is read for links that carry the band's name; each of those is opened
 * and read for what every sale page publishes for search engines — the schema.org Event block,
 * with the date, the hall, the price and whether it has sold out. A page without that block
 * still has a title, and a sale page's title nearly always carries the date. So a new site is a
 * new row in the table, not new code here.
 *
 * What it cannot read is a page a browser has to build: a site that ships an empty shell and
 * draws its listing with JavaScript has nothing in it to read. The source says so after a run,
 * and the link can be pasted by hand on the show's page instead.
 */

export type Availability = 'available' | 'limited' | 'sold_out';

export interface FoundEvent {
  url: string;
  title: string;
  date: string;                  // YYYY-MM-DD, or '' when the page gives none
  time: string | null;           // HH:MM
  venue: string | null;
  price: number | null;
  availability: Availability | null;
}

export interface Page { status: number; url: string; html: string }
export type Fetcher = (url: string) => Promise<Page>;

export type SourceStatus = 'ok' | 'empty' | 'unreadable' | 'error';

/** What the band is called on a sale page until the owner says otherwise: its name (Settings → כללי). */
export const defaultKeywords = () => [getBandName()];

const KEYWORDS_SETTING = 'ticket_keywords';
const LAST_AUTO_RUN_SETTING = 'ticket_search_last_auto';

/** Sale pages opened per source page. A listing rarely has more than a few of one band. */
const MAX_CANDIDATES = 12;
/** Searches per {q} source — one per search word, up to this many. */
const MAX_SEARCHES = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const PAUSE_MS = 300;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export class TicketError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// ---------- search words ----------

export function getKeywords(): string[] {
  const list = splitKeywords(getSetting(KEYWORDS_SETTING, ''));
  return list.length ? list : defaultKeywords();
}

export function setKeywords(input: unknown): string[] {
  const list = Array.isArray(input) ? input.map(String) : splitKeywords(String(input ?? ''));
  const clean = [...new Set(list.map((k) => k.trim()).filter((k) => k.length >= 2))];
  if (!clean.length) throw new TicketError('צריך לפחות מילת חיפוש אחת');
  setSetting(KEYWORDS_SETTING, clean.join(', '));
  return clean;
}

const splitKeywords = (raw: string) => raw.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);

/** Whether a piece of text names the band. No search words means anything does. */
export function hasKeyword(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = text.toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

// ---------- addresses ----------

/**
 * Refuses an address that points back inside the server's own network.
 *
 * The sources are typed by the owner, but the sale pages are whatever links a public page
 * carries, and a planted link to 127.0.0.1 should not be fetched on the band's behalf. This
 * checks what the address says, not what its name resolves to — enough for a scraper that only
 * reads and only keeps a title and a date.
 */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TicketError('כתובת לא תקינה'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TicketError('רק כתובות http או https');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || host.startsWith('[') || isPrivateIPv4(host)
  ) {
    throw new TicketError('כתובת פנימית — רק אתרים ציבוריים');
  }
  return url;
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Query parameters that only say where a visitor came from. Two links differing in these are one page. */
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|mc_.*|ref|.*_ref)$/i;

/** An address as the finder keeps it: absolute, without its #fragment or tracking parameters. */
export function cleanUrl(raw: string, base?: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim(), base); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/** The pages one source asks for: itself, or one search per search word. */
export function sourcePages(url: string, keywords: string[]): string[] {
  if (!url.includes('{q}')) return [url];
  if (!keywords.length) return [url.split('{q}').join('')];
  return keywords.slice(0, MAX_SEARCHES).map((k) => url.split('{q}').join(encodeURIComponent(k)));
}

// ---------- reading HTML ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** The words a reader would see, in one line. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = attr(tag, 'property') ?? attr(tag, 'name');
    if (k && k.toLowerCase() === key) return attr(tag, 'content');
  }
  return null;
}

function canonicalOf(html: string, pageUrl: string): string {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'rel') ?? '').toLowerCase() === 'canonical') {
      const href = attr(tag, 'href');
      const clean = href && cleanUrl(href, pageUrl);
      if (clean) return clean;
    }
  }
  const og = metaContent(html, 'og:url');
  return (og && cleanUrl(og, pageUrl)) || cleanUrl(pageUrl) || pageUrl;
}

function pageTitle(html: string): string {
  const og = metaContent(html, 'og:title');
  if (og) return og.trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * A page that a browser has to build before there is anything on it: little to read and almost
 * no links. A real listing — even a short one — has a menu's worth of each.
 */
export function looksUnreadable(html: string): boolean {
  const anchors = (html.match(/<a\b/gi) ?? []).length;
  return visibleText(html).length < 400 && anchors < 5;
}

// ---------- dates ----------

/**
 * A date as a sale page writes it: 2.12.26, 02/12/2026. Day first, as everywhere here.
 * Two-digit years are this century.
 */
const DMY = /(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/g;

function dmyToIso(d: string, m: string, y: string): string | null {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** Every date in a stretch of text, in order. */
function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DMY)) {
    const iso = dmyToIso(m[1], m[2], m[3]);
    if (iso) out.push(iso);
  }
  return out;
}

/** The date a page is about: the one it repeats most. Ties go to the first written. */
function mainDate(text: string): string | null {
  const counts = new Map<string, number>();
  for (const d of datesIn(text)) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best: string | null = null;
  for (const [d, n] of counts) if (!best || n > counts.get(best)!) best = d;
  return best;
}

const TIME = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/;

/**
 * Splits a schema.org startDate into the date and time of the show where it happens.
 *
 * Written with an offset (…T21:30:00+02:00) it already is local time and is read as written.
 * Written in UTC (…Z) it is turned into Israel's time, or a 23:30 show would land on the next
 * day's date.
 */
export function splitStartDate(raw: string): { date: string; time: string | null } | null {
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}T.*Z$/i.test(s)) {
    const when = new Date(s);
    if (Number.isNaN(when.getTime())) return null;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(when).map((p) => [p.type, p.value])
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  return m ? { date: m[1], time: m[2] ?? null } : null;
}

// ---------- schema.org ----------

function jsonLdNodes(html: string): any[] {
  const nodes: any[] = [];
  const walk = (x: any, depth = 0) => {
    if (depth > 6 || !x) return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (typeof x !== 'object') return;
    nodes.push(x);
    for (const key of ['@graph', 'itemListElement', 'item', 'event', 'subEvent', 'mainEntity']) {
      if (x[key]) walk(x[key], depth + 1);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* one broken block does not spoil the rest */ }
  }
  return nodes;
}

const isEventNode = (n: any) =>
  ([] as unknown[]).concat(n?.['@type'] ?? []).some((t) => /event$/i.test(String(t)));

function availabilityOf(raw: unknown): Availability | null {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('soldout') || s.includes('outofstock') || s.includes('discontinued')) return 'sold_out';
  if (s.includes('limited')) return 'limited';
  if (s.includes('instock') || s.includes('preorder') || s.includes('presale') || s.includes('onlineonly')) return 'available';
  return null;
}

/** A block that only points at another one ({"@id": "…#venue"}) is read as the one it points at. */
type Resolve = (x: any) => any;

function venueOf(location: any, resolve: Resolve): string | null {
  const place = resolve(Array.isArray(location) ? location[0] : location);
  if (!place) return null;
  if (typeof place === 'string') return place.trim() || null;
  const name = typeof place.name === 'string' ? decodeEntities(place.name).trim() : '';
  const address = resolve(place.address);
  const city = address && typeof address === 'object' ? String(address.addressLocality ?? '').trim() : '';
  if (name && city && !name.includes(city)) return `${name}, ${city}`;
  return name || city || null;
}

function fromEventNode(n: any, url: string, resolve: Resolve): FoundEvent {
  const when = n.startDate ? splitStartDate(n.startDate) : null;
  const offers = ([] as any[]).concat(n.offers ?? []).map(resolve).filter((o) => o && typeof o === 'object');
  const offer = offers.find((o) => o.price != null || o.lowPrice != null) ?? offers[0];
  const rawPrice = offer?.price ?? offer?.lowPrice;
  const price = rawPrice != null && rawPrice !== '' && Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : null;
  return {
    url,
    title: decodeEntities(String(n.name ?? '')).trim(),
    date: when?.date ?? '',
    time: when?.time ?? null,
    venue: venueOf(n.location, resolve),
    price,
    availability: availabilityOf(offer?.availability ?? n.eventStatus),
  };
}

/**
 * The band's shows a page describes in its schema.org blocks.
 *
 * On a sale page the page itself is the link — a node's own url there often names the
 * performer rather than the sale. On a listing, each show has to carry an address of its own,
 * its sale page's or its ticket offer's; one with neither cannot be linked to and is skipped.
 */
export function parseEvents(html: string, pageUrl: string, keywords: string[], { onEventPage = false } = {}): FoundEvent[] {
  const canonical = onEventPage ? canonicalOf(html, pageUrl) : '';
  const nodes = jsonLdNodes(html);
  const byId = new Map<string, any>();
  for (const n of nodes) if (typeof n['@id'] === 'string' && Object.keys(n).length > 1) byId.set(n['@id'], n);
  const resolve: Resolve = (x) =>
    x && typeof x === 'object' && typeof x['@id'] === 'string' && Object.keys(x).length === 1 ? byId.get(x['@id']) ?? x : x;
  const out: FoundEvent[] = [];
  for (const node of nodes) {
    if (!isEventNode(node) || !hasKeyword(String(node.name ?? ''), keywords)) continue;
    const offerUrl = ([] as any[]).concat(node.offers ?? []).map((o) => o?.url).find((u) => typeof u === 'string');
    const url = onEventPage
      ? canonical
      : (typeof node.url === 'string' && cleanUrl(node.url, pageUrl)) || (offerUrl && cleanUrl(offerUrl, pageUrl)) || '';
    if (url) out.push(fromEventNode(node, url, resolve));
  }
  return dedupe(out);
}

/**
 * What one sale page says about the show it sells.
 *
 * The schema.org block first. Without one, the page's title — a sale page's title is written
 * for search results and nearly always says who, where and when — and the date the page repeats
 * most. Pages whose title does not name the band are not the band's.
 */
export function parseEventPage(html: string, pageUrl: string, keywords: string[]): FoundEvent[] {
  const structured = parseEvents(html, pageUrl, keywords, { onEventPage: true });
  if (structured.length) return structured;

  const title = pageTitle(html);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = h1 ? visibleText(h1[1]) : '';
  if (!hasKeyword(`${title} ${heading}`, keywords)) return [];

  const text = visibleText(html);
  const date = datesIn(title)[0] ?? mainDate(text);
  let time = title.match(TIME)?.[0] ?? null;
  if (!time && date) {
    const [y, m, d] = date.split('-');
    const at = text.search(new RegExp(`(?<!\\d)0?${Number(d)}[./]0?${Number(m)}[./](?:${y}|${y.slice(2)})(?!\\d)`));
    if (at >= 0) time = text.slice(at, at + 200).match(TIME)?.[0] ?? null;
  }
  return [{
    url: canonicalOf(html, pageUrl),
    title: title || heading,
    date: date ?? '',
    time: time ? time.padStart(5, '0') : null,
    venue: null,
    price: null,
    availability: null,
  }];
}

function dedupe(events: FoundEvent[]): FoundEvent[] {
  const seen = new Map<string, FoundEvent>();
  for (const e of events) if (!seen.has(`${e.url}|${e.date}`)) seen.set(`${e.url}|${e.date}`, e);
  return [...seen.values()];
}

// ---------- finding the sale pages on a source page ----------

const ASSET = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|woff2?|ttf|mp4|mp3|pdf)(?:$|\?)/i;

/**
 * The links on a page that look like they sell the band's show.
 *
 * A link counts when its text, its title or its address names the band. A listing that draws
 * its cards in the browser often still ships them in the page as data; when no plain link
 * qualifies, every mention of the band in that data is followed to the nearest address after
 * it. Either way each link is only a candidate — it is opened and read before it is believed.
 */
export function findCandidates(html: string, pageUrl: string, keywords: string[]): string[] {
  const self = cleanUrl(pageUrl);
  const out = new Set<string>();
  const add = (raw: string) => {
    const u = cleanUrl(decodeEntities(raw), pageUrl);
    if (u && u !== self && !ASSET.test(u)) out.add(u);
  };

  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;
    const label = `${visibleText(m[2])} ${attr(m[1], 'title') ?? ''} ${attr(m[1], 'aria-label') ?? ''} ${safeDecode(href)}`;
    if (hasKeyword(label, keywords)) add(href);
  }

  if (!out.size && keywords.length) {
    const flat = html.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/\\"/g, '"');
    const lower = flat.toLowerCase();
    const URL_FIELD = /"(?:url|href|link|path|slug|permalink)"\s*:\s*"((?:https?:\/\/|\/)[^"\s]{1,300})"/i;
    let hits = 0;
    for (const k of keywords) {
      let at = lower.indexOf(k.toLowerCase());
      while (at >= 0 && hits < 20) {
        hits++;
        const after = flat.slice(at, at + 4000).match(URL_FIELD);
        if (after) add(after[1]);
        at = lower.indexOf(k.toLowerCase(), at + k.length);
      }
    }
  }
  return [...out].slice(0, MAX_CANDIDATES);
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ---------- a band's own list of shows ----------

interface El { tag: string; start: number; end: number; attrs: string; parent: El | null; children: El[] }

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TAGS = new Set(['script', 'style', 'noscript', 'template', 'textarea']);

/**
 * The page's elements as a tree of offsets — enough to ask "what is the smallest block around
 * this link", without a full HTML parser. A closing tag closes everything opened inside it, the
 * way browsers forgive unclosed <p>s; a stray one closes nothing.
 */
function elementTree(html: string): { anchors: El[] } {
  const root: El = { tag: '#root', start: 0, end: html.length, attrs: '', parent: null, children: [] };
  const stack: El[] = [root];
  const anchors: El[] = [];
  const lower = html.toLowerCase();
  const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(html))) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    const top = stack[stack.length - 1];
    if (m[1] !== '/') {
      const el: El = { tag, start: m.index, end: html.length, attrs: m[3], parent: top, children: [] };
      top.children.push(el);
      if (RAW_TAGS.has(tag)) {
        const close = lower.indexOf(`</${tag}`, TAG.lastIndex);
        el.end = close < 0 ? html.length : close;
        TAG.lastIndex = el.end;
        continue;
      }
      if (tag === 'a') anchors.push(el);
      if (!VOID_TAGS.has(tag) && !m[3].trim().endsWith('/')) stack.push(el);
    } else {
      let i = stack.length - 1;
      while (i > 0 && stack[i].tag !== tag) i--;
      if (i > 0) {
        for (let j = stack.length - 1; j >= i; j--) stack[j].end = TAG.lastIndex;
        stack.length = i;
      }
    }
  }
  return { anchors };
}

/** Words that say which day of the week, before the date: «מוצ"ש, 20.02.2027». */
const WEEKDAY = /(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|מוצ["״']?ש|מוצאי\s+שבת)\s*,/g;
const TICKET_WORDS = /כרטיס|רכיש|להזמנ|ticket|buy|book/i;

/** A row's text without its date, time and weekday — those are kept apart. */
function tidyRow(text: string): string {
  return text
    .replace(DMY, ' ').replace(new RegExp(TIME.source, 'g'), ' ').replace(WEEKDAY, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s·,|–-]+|[\s·,|–-]+$/g, '').trim();
}

/**
 * Every show on a page that lists one band's shows: each row with a date and a link out.
 *
 * A link's row is the smallest block around it that names exactly one date — climbing from the
 * link outward, the first block that names a date is the row, and one that names several has
 * grown into the whole list. A row often carries more than one link (the show's name is a
 * button too), so each row gives one: the one that says tickets, else the one leaving the site,
 * else the last. Dates already past are left out.
 */
export function findListedShows(html: string, pageUrl: string, today: string): FoundEvent[] {
  const { anchors } = elementTree(html);
  const self = cleanUrl(pageUrl);
  const host = (() => { try { return new URL(pageUrl).hostname; } catch { return ''; } })();
  const textCache = new Map<El, string>();
  const textOf = (el: El) => {
    let t = textCache.get(el);
    if (t === undefined) { t = visibleText(html.slice(el.start, el.end)); textCache.set(el, t); }
    return t;
  };

  const rows = new Map<El, Array<{ a: El; url: string }>>();
  for (const a of anchors) {
    const href = attr(a.attrs, 'href');
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;
    const url = cleanUrl(href, pageUrl);
    if (!url || url === self || ASSET.test(url)) continue;

    let row: El | null = null;
    for (let node: El | null = a, depth = 0; node && node.parent && depth < 8; node = node.parent, depth++) {
      const text = textOf(node);
      if (text.length > 700) break;
      const dates = new Set(datesIn(text));
      if (dates.size === 1) { row = node; break; }
      if (dates.size > 1) break;
    }
    if (!row) continue;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push({ a, url });
  }

  const out: FoundEvent[] = [];
  for (const [row, links] of rows) {
    const text = textOf(row);
    const date = datesIn(text)[0];
    if (date < today) continue;
    const offSite = (u: string) => { try { return new URL(u).hostname !== host; } catch { return false; } };
    const pick = links.find((l) => TICKET_WORDS.test(textOf(l.a)))
      ?? links.find((l) => offSite(l.url));
    // A row whose only link leads back into the band's own site has no sale yet — its ticket
    // button is still a placeholder.
    if (!pick) continue;

    // The row's cells, minus the buttons and the date, read as «נתניה · QUEEN · היכל תרבות נתניה».
    const isButton = (t: string) => t.length < 25 && TICKET_WORDS.test(t);
    const cells = row.children
      .filter((c) => !(c.start <= pick.a.start && pick.a.start < c.end && !datesIn(textOf(c)).length))
      .map((c) => tidyRow(textOf(c)))
      .filter((t) => t && !isButton(t));
    const title = (cells.length > 1 ? cells.join(' · ') : tidyRow(text.replace(textOf(pick.a), ' '))).slice(0, 160);
    const time = text.match(TIME)?.[0];

    out.push({
      url: pick.url, title, date, time: time ? time.padStart(5, '0') : null,
      venue: null, price: null, availability: null,
    });
  }
  return dedupe(out);
}

/** Today in Israel, as YYYY-MM-DD — what "already past" is measured against. */
export function israelToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
}

// ---------- fetching ----------

/**
 * One page, as a browser would ask for it. Redirects are followed by hand so each hop is
 * checked like the first; a page in an old Hebrew encoding is read in that encoding.
 */
export async function fetchPage(raw: string): Promise<Page> {
  let url = assertPublicUrl(raw).toString();
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
      },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = assertPublicUrl(new URL(location, url).toString()).toString();
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
    return { status: res.status, url, html: decode(buf, res.headers.get('content-type')) };
  }
  throw new TicketError('יותר מדי הפניות');
}

function decode(buf: Buffer, contentType: string | null): string {
  const declared = contentType?.match(/charset=([\w-]+)/i)?.[1]
    ?? buf.subarray(0, 4096).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
    ?? 'utf-8';
  try { return new TextDecoder(declared.toLowerCase()).decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- one source ----------

export interface SourceResult {
  status: SourceStatus;
  message: string;
  events: FoundEvent[];
}

/**
 * Everything one source has on the band: its own page (or its searches), then each sale page
 * that page links to. The status is the band's answer to "is this source any use?".
 *
 * No search words means the page is a band's own list of shows: every dated row with a link is
 * taken as it stands, and nothing is followed — the row already says when, and its links lead
 * to as many ticketing sites as the band has halls.
 */
export async function searchSource(
  url: string, keywords: string[], fetcher: Fetcher = fetchPage, today = israelToday(),
): Promise<SourceResult> {
  const listing = !keywords.length;
  const found = new Map<string, FoundEvent>();
  const keep = (events: FoundEvent[]) => { for (const e of events) found.set(`${e.url}|${e.date}`, e); };
  let readable = 0;
  let unreadable = 0;
  let lastError = '';

  for (const pageUrl of sourcePages(url, keywords)) {
    let page: Page;
    try { page = await fetcher(pageUrl); }
    catch (err: any) { lastError = err instanceof TicketError ? err.message : 'לא ניתן לטעון את הדף'; continue; }
    if (page.status >= 400) {
      lastError = page.status === 403 || page.status === 429
        ? `האתר חוסם קריאה אוטומטית (${page.status})`
        : `האתר החזיר שגיאה ${page.status}`;
      continue;
    }
    if (looksUnreadable(page.html)) { unreadable++; continue; }
    readable++;
    if (listing) { keep(findListedShows(page.html, page.url, today)); continue; }

    keep(parseEvents(page.html, page.url, keywords));
    const known = new Set([...found.values()].map((e) => e.url));
    const candidates = findCandidates(page.html, page.url, keywords).filter((c) => !known.has(c));
    for (const c of candidates) {
      await pause(PAUSE_MS);
      try {
        const sale = await fetcher(c);
        if (sale.status < 400) keep(parseEventPage(sale.html, sale.url, keywords));
      } catch { /* one dead link is not the source's failure */ }
    }
    // A source that is itself a sale page has no links to follow; it is read as one.
    if (!candidates.length && !found.size) keep(parseEventPage(page.html, page.url, keywords));
  }

  const events = [...found.values()];
  if (events.length) {
    const dated = events.filter((e) => e.date).length;
    return { status: 'ok', message: dated === 1 ? 'נמצא מועד אחד' : `נמצאו ${dated || events.length} מועדים`, events };
  }
  if (readable) {
    const message = listing
      ? 'הדף נקרא, אבל אין בו הופעות קרובות עם תאריך וקישור'
      : 'הדף נקרא, אבל אין בו הופעה עם מילות החיפוש';
    return { status: 'empty', message, events };
  }
  if (unreadable) {
    return {
      status: 'unreadable',
      message: 'האתר בונה את הדף בדפדפן ואי אפשר לקרוא אותו כך. אפשר להדביק את הקישור ידנית בעמוד ההופעה.',
      events,
    };
  }
  return { status: 'error', message: lastError || 'לא ניתן לטעון את הדף', events };
}

// ---------- handing a link to the rest of the app ----------

type LinkTarget = { eventId?: string | null; calendarEventId?: string | null };

const workFor = (calendarEventId: string) =>
  db.prepare('SELECT id FROM works WHERE calendar_event_id = ?').get(calendarEventId) as { id: string } | undefined;

/**
 * A confirmed link becomes the show's ticket link everywhere else. The show boards, the campaign
 * wizard and the ticket check read band_events.ticket_url; a work keeps its link on its board
 * entry. Only an empty one is filled — a link somebody typed is theirs — and it is saved through
 * the boards' own updateBoardItem, so where each kind lives is decided in one place.
 */
function shareLink(target: LinkTarget, url: string) {
  try {
    if (target.eventId) {
      const show = db.prepare('SELECT ticket_url FROM band_events WHERE id = ?')
        .get(target.eventId) as { ticket_url: string | null } | undefined;
      if (show && !show.ticket_url) updateBoardItem(`show:${target.eventId}`, { ticket_url: url });
    } else if (target.calendarEventId) {
      const work = workFor(target.calendarEventId);
      if (!work) return;
      const item = db.prepare('SELECT ticket_url FROM show_board_items WHERE item_key = ?')
        .get(`work:${work.id}`) as { ticket_url: string | null } | undefined;
      if (!item?.ticket_url) updateBoardItem(`work:${work.id}`, { ticket_url: url });
    }
  } catch { /* a link the boards refuse stays on the ticket pages only */ }
}

/** Takes a link back off its show when it is rejected or gone — only while it is still the one there. */
function unshareLink(target: LinkTarget, url: string) {
  if (target.eventId) {
    db.prepare('UPDATE band_events SET ticket_url = NULL WHERE id = ? AND ticket_url = ?').run(target.eventId, url);
  } else if (target.calendarEventId) {
    const work = workFor(target.calendarEventId);
    if (work) {
      db.prepare(
        "UPDATE show_board_items SET ticket_url = NULL, updated_at = datetime('now') WHERE item_key = ? AND ticket_url = ?"
      ).run(`work:${work.id}`, url);
    }
  }
}

// ---------- matching to shows ----------

interface ShowRow { id: string; venue: string; location: string | null; date: string }

/** Words every hall or show shares, which say nothing about which one. */
const COMMON_WORDS = new Set([
  'היכל', 'התרבות', 'תרבות', 'הופעה', 'הופעות', 'מופע', 'מחווה', 'במחווה', 'להקת', 'רכישת', 'כרטיסים',
  'show', 'live', 'the', 'and', 'of', 'tribute',
]);

function words(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 2 && !COMMON_WORDS.has(w));
}

/** How many words the show's place and the sale page's place share. Hebrew's ב/ה/ל prefixes are forgiven. */
function placeOverlap(a: string, b: string): number {
  const bw = words(b);
  return words(a).filter((w) => bw.some((x) => x === w || (w.length >= 3 && x.length >= 3 && (x.endsWith(w) || w.endsWith(x))))).length;
}

/**
 * Which show a sale page sells. Only a show on the same date can be it. When the hall agrees
 * too, it is taken; when it is the only show that day but the hall says nothing, it is offered
 * for the band to confirm. No show that day leaves the page unassigned.
 *
 * `hint` is the name the band gave the source. A source called «המועדון בחיפה» says where its
 * shows are even when its pages don't.
 */
export function matchShow(
  ev: FoundEvent, shows: ShowRow[], hint = '',
): { event_id: string | null; status: 'confirmed' | 'suggested' } {
  const sameDay = ev.date ? shows.filter((s) => s.date === ev.date) : [];
  if (!sameDay.length) return { event_id: null, status: 'suggested' };
  const place = `${ev.venue ?? ''} ${ev.title} ${hint}`;
  const scored = sameDay
    .map((s) => ({ s, score: placeOverlap(`${s.venue} ${s.location ?? ''}`, place) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  const clear = best.score > 0 && (!second || second.score < best.score);
  return { event_id: best.s.id, status: clear ? 'confirmed' : 'suggested' };
}

/**
 * Records what a run found. A page seen before is refreshed — price and stock move — and an
 * unassigned one is matched again, since its show may have been added since. A page the band
 * rejected stays rejected, and a page the band assigned by hand stays where they put it.
 */
export function recordFound(
  sourceId: string | null, events: FoundEvent[], hint = '',
): { added: number; matched: number } {
  const showsOn = db.prepare('SELECT id, venue, location, date FROM band_events WHERE date = ?');
  const existing = db.prepare('SELECT id, event_id, status FROM band_event_ticket_links WHERE url = ? AND event_date = ?');
  const refresh = db.prepare(
    `UPDATE band_event_ticket_links
       SET title = ?, event_time = ?, venue = ?, price = ?, availability = ?,
           source_id = COALESCE(source_id, ?), last_seen_at = datetime('now')
     WHERE id = ?`
  );
  const assign = db.prepare('UPDATE band_event_ticket_links SET event_id = ?, status = ? WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO band_event_ticket_links
       (id, event_id, source_id, url, title, event_date, event_time, venue, price, availability, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let added = 0;
  let matched = 0;
  db.transaction(() => {
    for (const ev of events) {
      const shows = ev.date ? (showsOn.all(ev.date) as ShowRow[]) : [];
      const row = existing.get(ev.url, ev.date) as { id: string; event_id: string | null; status: string } | undefined;
      if (row) {
        refresh.run(ev.title, ev.time, ev.venue, ev.price, ev.availability, sourceId, row.id);
        if (!row.event_id && row.status !== 'rejected') {
          const m = matchShow(ev, shows, hint);
          if (m.event_id) {
            assign.run(m.event_id, m.status, row.id);
            matched++;
            if (m.status === 'confirmed') shareLink({ eventId: m.event_id }, ev.url);
          }
        }
        continue;
      }
      const m = matchShow(ev, shows, hint);
      insert.run(uuid(), m.event_id, sourceId, ev.url, ev.title, ev.date, ev.time, ev.venue, ev.price, ev.availability, m.status);
      added++;
      if (m.event_id) matched++;
      if (m.event_id && m.status === 'confirmed') shareLink({ eventId: m.event_id }, ev.url);
    }
  })();
  return { added, matched };
}

// ---------- gigs on the owner's calendar ----------

/** One calendar entry, as far as matching it to a sale page goes. */
export interface CalendarGig { id: string; date: string; title: string; text: string }
export type GigLoader = (today: string) => Promise<CalendarGig[]>;

const isDeclined = (e: CalendarEvent) =>
  (e.attendees ?? []).some((a) => a.self && a.responseStatus === 'declined');

/**
 * The owner's calendar for the year ahead — the primary calendar and any the sync rules read.
 * Cancelled entries and invitations the owner turned down are not gigs.
 */
export const loadCalendarGigs: GigLoader = async () => {
  const ids = new Set(['primary', ...listRules().map((r) => r.calendar_id).filter(Boolean)]);
  const timeMin = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + 400 * 86_400_000).toISOString();
  const gigs = new Map<string, CalendarGig>();
  for (const calendarId of ids) {
    for (const e of await listEvents({ calendarId, timeMin, timeMax })) {
      const date = eventDate(e);
      if (!e.id || !date || e.status === 'cancelled' || isDeclined(e)) continue;
      const title = (e.summary ?? '').trim();
      gigs.set(e.id, { id: e.id, date, title, text: `${title} ${e.location ?? ''} ${(e.description ?? '').slice(0, 500)}` });
    }
  }
  return [...gigs.values()];
};

/**
 * The calendar entry a listed show is, if any. It has to be on the same date, and it has to
 * say so: either one of the words the owner gave for this band (its name, say), or the city, the hall
 * or the show — «נתניה» in the calendar against «נתניה · QUEEN · היכל תרבות נתניה» on the site.
 * The owner's own band playing elsewhere the same evening says neither.
 */
export function matchCalendar(ev: FoundEvent, gigs: CalendarGig[], calendarWords: string[]): CalendarGig | null {
  let best: CalendarGig | null = null;
  let bestScore = 0;
  for (const g of gigs) {
    if (g.date !== ev.date) continue;
    const hay = g.text.toLowerCase();
    const named = calendarWords.some((w) => hay.includes(w.toLowerCase())) ? 10 : 0;
    const score = named + placeOverlap(`${ev.title} ${ev.venue ?? ''}`, g.text);
    if (score > bestScore) { best = g; bestScore = score; }
  }
  return best;
}

/**
 * Records a band site's shows that are on the owner's calendar, and only those — the rest of
 * the band's tour is not the owner's business. Each one kept is opened once for its price and
 * stock, since there are only a few. A gig that has left the calendar, or the site, is dropped;
 * one the owner rejected stays rejected.
 */
export async function recordCalendarFound(
  sourceId: string, events: FoundEvent[], gigs: CalendarGig[], calendarWords: string[],
  fetcher: Fetcher = fetchPage, today = israelToday(),
): Promise<{ added: number; kept: number }> {
  const kept: Array<{ ev: FoundEvent; gig: CalendarGig }> = [];
  for (const ev of events) {
    const gig = matchCalendar(ev, gigs, calendarWords);
    if (gig) kept.push({ ev, gig });
  }

  for (const k of kept) {
    try {
      const page = await fetcher(k.ev.url);
      const detail = page.status < 400 ? parseEventPage(page.html, page.url, []).find((e) => e.date === k.ev.date) : undefined;
      if (detail) {
        k.ev = { ...k.ev, price: detail.price, availability: detail.availability, venue: detail.venue ?? k.ev.venue };
      }
    } catch { /* the row's own link and date are enough */ }
    await pause(PAUSE_MS);
  }

  let added = 0;
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM band_event_ticket_links WHERE url = ? AND event_date = ?');
    const keys = new Set<string>();
    for (const { ev, gig } of kept) {
      keys.add(`${ev.url}|${ev.date}`);
      const row = existing.get(ev.url, ev.date) as { id: string } | undefined;
      if (row) {
        db.prepare(
          `UPDATE band_event_ticket_links
             SET title = ?, event_time = ?, venue = ?, price = ?, availability = ?, calendar_event_id = ?,
                 calendar_title = ?, source_id = COALESCE(source_id, ?), last_seen_at = datetime('now')
           WHERE id = ?`
        ).run(ev.title, ev.time, ev.venue, ev.price, ev.availability, gig.id, gig.title, sourceId, row.id);
        continue;
      }
      db.prepare(
        `INSERT INTO band_event_ticket_links
           (id, event_id, source_id, url, title, event_date, event_time, venue, price, availability, status,
            calendar_event_id, calendar_title)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`
      ).run(uuid(), sourceId, ev.url, ev.title, ev.date, ev.time, ev.venue, ev.price, ev.availability, gig.id, gig.title);
      added++;
    }
    for (const { ev, gig } of kept) shareLink({ calendarEventId: gig.id }, ev.url);
    const mine = db.prepare(
      `SELECT id, url, event_date, calendar_event_id FROM band_event_ticket_links
       WHERE source_id = ? AND calendar_event_id IS NOT NULL AND event_date >= ? AND status != 'rejected'`
    ).all(sourceId, today) as Array<{ id: string; url: string; event_date: string; calendar_event_id: string }>;
    const drop = db.prepare('DELETE FROM band_event_ticket_links WHERE id = ?');
    for (const r of mine) {
      if (keys.has(`${r.url}|${r.event_date}`)) continue;
      drop.run(r.id);
      unshareLink({ calendarEventId: r.calendar_event_id }, r.url);
    }
  })();
  return { added, kept: kept.length };
}

// ---------- runs ----------

export interface RunSummary {
  sources: Array<{ id: string; name: string; status: SourceStatus; message: string; found: number }>;
  added: number;
  matched: number;
}

interface RunOptions { sourceId?: string; fetcher?: Fetcher; loadGigs?: GigLoader; today?: string }

let running: Promise<RunSummary> | null = null;

/** Searches every active source (or one). A run already under way is joined, not doubled. */
export function runTicketSearch(opts: RunOptions = {}): Promise<RunSummary> {
  if (running) return running;
  running = doRun(opts).finally(() => { running = null; });
  return running;
}

interface SourceRow {
  id: string; name: string; url: string; all_shows: number; match_to: string; calendar_words: string | null;
}

async function doRun({ sourceId, fetcher = fetchPage, loadGigs = loadCalendarGigs, today = israelToday() }: RunOptions): Promise<RunSummary> {
  const keywords = getKeywords();
  const columns = 'id, name, url, all_shows, match_to, calendar_words';
  const sources = (sourceId
    ? db.prepare(`SELECT ${columns} FROM ticket_sources WHERE id = ?`).all(sourceId)
    : db.prepare(`SELECT ${columns} FROM ticket_sources WHERE active = 1 ORDER BY created_at`).all()
  ) as SourceRow[];
  if (sourceId && !sources.length) throw new TicketError('המקור לא נמצא', 404);

  // Read once for every source that needs it, and only if one does.
  let gigs: CalendarGig[] | Error | undefined;

  const summary: RunSummary = { sources: [], added: 0, matched: 0 };
  for (const s of sources) {
    let result: SourceResult;
    try { result = await searchSource(s.url, s.all_shows ? [] : keywords, fetcher, today); }
    catch (err: any) { result = { status: 'error', message: err?.message || 'שגיאה', events: [] }; }

    if (s.match_to === 'calendar') {
      if (gigs === undefined) {
        gigs = await loadGigs(today).catch((err) => (err instanceof Error ? err : new Error(String(err))));
      }
      if (gigs instanceof Error) {
        result = { status: 'error', message: `היומן לא נקרא: ${gigs.message}`, events: result.events };
      } else if (result.status === 'ok' || result.status === 'empty') {
        // An empty list is recorded too: it is what clears the gigs the site no longer sells.
        const { added, kept } = await recordCalendarFound(s.id, result.events, gigs, splitKeywords(s.calendar_words ?? ''), fetcher, today);
        if (result.status === 'ok') {
          result.message = `${result.events.length} הופעות באתר · ${kept ? `${kept} מהן ביומן שלך` : 'אף אחת מהן לא ביומן שלך'}`;
        }
        summary.added += added;
        summary.matched += kept;
      }
    } else {
      const { added, matched } = recordFound(s.id, result.events, s.name);
      summary.added += added;
      summary.matched += matched;
    }

    db.prepare(
      `UPDATE ticket_sources SET last_run_at = datetime('now'), last_status = ?, last_message = ?, last_found = ?
       WHERE id = ?`
    ).run(result.status, result.message, result.events.length, s.id);
    summary.sources.push({ id: s.id, name: s.name, status: result.status, message: result.message, found: result.events.length });
  }
  return summary;
}

/**
 * Once a day, while the server is up. Checked hourly against the last run, so a restart does
 * not trigger a fresh round of requests to every site.
 */
export function scheduleDailyTicketSearch() {
  const DAY = 24 * 60 * 60 * 1000;
  const tick = () => {
    const last = Date.parse(getSetting(LAST_AUTO_RUN_SETTING, ''));
    if (Number.isFinite(last) && Date.now() - last < DAY - 60 * 60 * 1000) return;
    if (!db.prepare('SELECT 1 FROM ticket_sources WHERE active = 1 LIMIT 1').get()) return;
    setSetting(LAST_AUTO_RUN_SETTING, new Date().toISOString());
    runTicketSearch().catch((err) => console.warn('[tickets] daily search failed:', err?.message));
  };
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

// ---------- sources ----------

export function listSources() {
  return db.prepare('SELECT * FROM ticket_sources ORDER BY created_at').all();
}

function validSourceUrl(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url) throw new TicketError('חסרה כתובת');
  assertPublicUrl(url.split('{q}').join('x'));
  return url;
}

const matchTo = (v: unknown, fallback: string) => (v === 'calendar' || v === 'shows' ? v : fallback);
const wordsOrNull = (v: unknown) => splitKeywords(String(v ?? '')).join(', ') || null;

/**
 * A new source. `match_to: 'calendar'` is another band's own site: every show on it is read,
 * and only the dates on the owner's calendar are kept.
 */
export function createSource(body: any) {
  const url = validSourceUrl(body?.url);
  const name = String(body?.name ?? '').trim() || new URL(url.split('{q}').join('x')).hostname.replace(/^www\./, '');
  const to = matchTo(body?.match_to, 'shows');
  const allShows = body?.all_shows !== undefined ? (body.all_shows ? 1 : 0) : to === 'calendar' ? 1 : 0;
  const id = uuid();
  db.prepare(
    'INSERT INTO ticket_sources (id, name, url, all_shows, match_to, calendar_words) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, url, allShows, to, wordsOrNull(body?.calendar_words));
  return db.prepare('SELECT * FROM ticket_sources WHERE id = ?').get(id);
}

export function updateSource(id: string, body: any) {
  const row = db.prepare('SELECT * FROM ticket_sources WHERE id = ?').get(id) as any;
  if (!row) throw new TicketError('המקור לא נמצא', 404);
  const url = body?.url !== undefined ? validSourceUrl(body.url) : row.url;
  const name = body?.name !== undefined ? String(body.name).trim() || row.name : row.name;
  const active = body?.active !== undefined ? (body.active ? 1 : 0) : row.active;
  const allShows = body?.all_shows !== undefined ? (body.all_shows ? 1 : 0) : row.all_shows;
  const to = matchTo(body?.match_to, row.match_to);
  const words = body?.calendar_words !== undefined ? wordsOrNull(body.calendar_words) : row.calendar_words;
  db.prepare(
    'UPDATE ticket_sources SET name = ?, url = ?, active = ?, all_shows = ?, match_to = ?, calendar_words = ? WHERE id = ?'
  ).run(name, url, active, allShows, to, words, id);
  return db.prepare('SELECT * FROM ticket_sources WHERE id = ?').get(id);
}

export function deleteSource(id: string) {
  db.prepare('DELETE FROM ticket_sources WHERE id = ?').run(id);
}

// ---------- links ----------

const LINK_SELECT = `SELECT l.*, s.name AS source_name FROM band_event_ticket_links l
  LEFT JOIN ticket_sources s ON s.id = l.source_id`;

export function linksForShow(eventId: string) {
  return db.prepare(
    `${LINK_SELECT} WHERE l.event_id = ? AND l.status != 'rejected'
     ORDER BY l.status = 'confirmed' DESC, l.first_seen_at`
  ).all(eventId);
}

/** Sale pages found for a date the band has no show on. Past dates drop off on their own. */
export function unassignedLinks() {
  return db.prepare(
    `${LINK_SELECT} WHERE l.event_id IS NULL AND l.calendar_event_id IS NULL AND l.status != 'rejected'
       AND (l.event_date = '' OR l.event_date >= date('now', '-1 day'))
     ORDER BY l.event_date, l.first_seen_at`
  ).all();
}

/** The owner's own gigs with other bands that have a sale page — the calendar-matched ones, upcoming. */
export function calendarLinks() {
  return db.prepare(
    `${LINK_SELECT} WHERE l.calendar_event_id IS NOT NULL AND l.event_id IS NULL AND l.status != 'rejected'
       AND l.event_date >= date('now', '-1 day')
     ORDER BY l.event_date, l.event_time`
  ).all();
}

/** Confirms, rejects or reassigns a link. Putting it on a show by hand is a confirmation. */
export function updateLink(id: string, body: any) {
  const row = db.prepare('SELECT * FROM band_event_ticket_links WHERE id = ?').get(id) as any;
  if (!row) throw new TicketError('הקישור לא נמצא', 404);
  let { event_id: eventId, status } = row;
  if (body?.event_id !== undefined) {
    eventId = body.event_id || null;
    if (eventId && !db.prepare('SELECT 1 FROM band_events WHERE id = ?').get(eventId)) throw new TicketError('ההופעה לא נמצאה', 404);
    status = eventId ? 'confirmed' : 'suggested';
  }
  if (body?.status !== undefined) {
    if (!['suggested', 'confirmed', 'rejected'].includes(body.status)) throw new TicketError('סטטוס לא מוכר');
    status = body.status;
  }
  db.prepare('UPDATE band_event_ticket_links SET event_id = ?, status = ? WHERE id = ?').run(eventId, status, id);
  // Moved off a show, or turned down: the show stops advertising it. Confirmed on one: it starts.
  if (row.event_id && (row.event_id !== eventId || status === 'rejected')) unshareLink({ eventId: row.event_id }, row.url);
  if (!eventId && status === 'rejected') unshareLink({ calendarEventId: row.calendar_event_id }, row.url);
  if (eventId && status === 'confirmed') shareLink({ eventId }, row.url);
  return db.prepare(`${LINK_SELECT} WHERE l.id = ?`).get(id);
}

/**
 * A link pasted on a show's page. It is the band's word, so it is confirmed as it is; the page
 * is still read, when it can be, for the price and whether it has sold out.
 */
export async function addLinkByHand(eventId: string, rawUrl: string, fetcher: Fetcher = fetchPage) {
  const show = db.prepare('SELECT id, date FROM band_events WHERE id = ?').get(eventId) as { id: string; date: string } | undefined;
  if (!show) throw new TicketError('ההופעה לא נמצאה', 404);
  assertPublicUrl(String(rawUrl ?? '').trim());
  const url = cleanUrl(String(rawUrl).trim())!;

  let info: FoundEvent | undefined;
  try {
    const page = await fetcher(url);
    if (page.status < 400) {
      const events = parseEventPage(page.html, page.url, []);
      info = events.find((e) => e.date === show.date) ?? events[0];
    }
  } catch { /* the link is kept even when its page cannot be read */ }

  // Kept under the page's own address and date — the ones a search would file it under — so the
  // next search refreshes this row rather than adding a second one beside it.
  const finalUrl = info?.url || url;
  const date = info?.date || show.date;
  const existing = db.prepare('SELECT id FROM band_event_ticket_links WHERE url = ? AND event_date = ?')
    .get(finalUrl, date) as { id: string } | undefined;
  const id = existing?.id ?? uuid();
  if (existing) {
    db.prepare("UPDATE band_event_ticket_links SET event_id = ?, status = 'confirmed' WHERE id = ?").run(eventId, id);
  } else {
    db.prepare(
      `INSERT INTO band_event_ticket_links
         (id, event_id, source_id, url, title, event_date, event_time, venue, price, availability, status)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`
    ).run(id, eventId, finalUrl, info?.title || null, date, info?.time ?? null, info?.venue ?? null,
      info?.price ?? null, info?.availability ?? null);
  }
  shareLink({ eventId }, finalUrl);
  return db.prepare(`${LINK_SELECT} WHERE l.id = ?`).get(id);
}
