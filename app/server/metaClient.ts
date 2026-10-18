/**
 * Meta (Facebook/Instagram) Marketing API read client — what the band's ad spend is pulled from.
 *
 * Credentials come from the environment: `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`. The token
 * is meant to be a **System User** token generated in Business Settings with the `ads_read`
 * scope, not a personal login token: a system user belongs to the business rather than to a
 * person, so its token does not expire every 60 days and does not stop working when someone
 * changes their password. Reading your own ad account with `ads_read` needs no App Review.
 *
 * Reads, with one exception kept apart at the bottom of the file: the writes the campaign
 * advisor's actions make (`metaActions.ts`), each only after the owner confirmed its preview. They
 * use the same token, which then needs `ads_management` beside `ads_read`; a token without it
 * still syncs, and a confirmed action is refused by Meta with a message that says so.
 */

// Overridable so the sync can be pointed at a stub, the same way GREEN_INVOICE_BASE_URL points
// the Morning client at the sandbox.
const GRAPH_URL = process.env.META_GRAPH_URL || 'https://graph.facebook.com';
const API_VERSION = process.env.META_API_VERSION || 'v25.0';

export class MetaError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

/**
 * The ad account id in the form the Graph API wants it, `act_<digits>`.
 *
 * Ads Manager shows the bare number and the API needs the prefix, so both spellings are
 * accepted and normalised here rather than in every caller.
 */
export function adAccountId(): string {
  const raw = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!raw) throw new MetaError('Meta לא מוגדר — חסר META_AD_ACCOUNT_ID', 503);
  return raw.startsWith('act_') ? raw : `act_${raw.replace(/^act/, '')}`;
}

function accessToken(): string {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!token) throw new MetaError('Meta לא מוגדר — חסר META_ACCESS_TOKEN', 503);
  return token;
}

/**
 * One Graph call.
 *
 * Meta answers a failure with 200-or-4xx plus an `error` object, and its `message` is the only
 * part worth showing — "(#190) invalid token" says what to fix, a bare 400 does not. The token
 * is never included in an error, since these messages reach the browser.
 */
async function graph<T>(path: string, params: Record<string, string>, write = false): Promise<T> {
  const res = write
    ? await fetch(`${GRAPH_URL}/${API_VERSION}/${path}`, {
        method: 'POST',
        body: new URLSearchParams({ ...params, access_token: accessToken() }),
      })
    : await fetch(`${GRAPH_URL}/${API_VERSION}/${path}?${new URLSearchParams({ ...params, access_token: accessToken() })}`);

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new MetaError(`Meta החזירה תשובה לא תקינה (${res.status})`);
  }
  if (body?.error) {
    const err = body.error;
    // 190 is an expired or revoked token, 102 a session problem — both mean "generate a new
    // system user token", which is worth saying rather than leaving as a code.
    // On a write, 10 and the 200s are permission errors: the token was generated with ads_read
    // only, which is enough for everything but the advisor's actions.
    const hint = err.code === 190 || err.code === 102
      ? ' — יש להנפיק טוקן חדש ב-Business Settings'
      : write && (err.code === 10 || (err.code >= 200 && err.code < 300))
        ? ' — לטוקן של Meta אין הרשאת ads_management. יש להנפיק אותו מחדש עם ads_management ו-ads_read ולעדכן את META_ACCESS_TOKEN'
        : '';
    throw new MetaError(`Meta: ${err.message || 'שגיאה לא ידועה'}${hint}`, res.status === 403 ? 403 : 502);
  }
  if (!res.ok) throw new MetaError(`Meta ${path} נכשל (${res.status})`);
  return body as T;
}

/** Follows `paging.next` until the data runs out, capped so a bad cursor cannot loop forever. */
async function graphPaged<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  let after: string | undefined;

  for (let page = 0; page < 50; page++) {
    const body = await graph<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      path,
      { ...params, limit: '200', ...(after ? { after } : {}) }
    );
    rows.push(...(body.data ?? []));
    // `next` is the authority on whether there is more: a full page with no next link is the
    // last one, and a cursor without it would ask for the same page again.
    if (!body.paging?.next || !body.paging.cursors?.after) break;
    after = body.paging.cursors.after;
  }
  return rows;
}

export interface MetaAccount {
  id: string;
  name?: string;
  /** ILS, USD, … — the currency every spend figure below is denominated in. */
  currency: string;
  timezone_name?: string;
}

/** The ad account itself — read for its currency, which every spend figure depends on. */
export async function fetchAccount(): Promise<MetaAccount> {
  const body = await graph<any>(adAccountId(), { fields: 'id,name,currency,timezone_name' });
  return { id: body.id, name: body.name, currency: body.currency || 'ILS', timezone_name: body.timezone_name };
}

export interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  start_time?: string;
  stop_time?: string;
}

/**
 * Every campaign on the account, spend or no spend.
 *
 * Insights alone would not do: a campaign built for next month's show has no spend yet and so
 * appears in no insights row, and that is exactly the one to map to the show before the money
 * goes out.
 */
export async function fetchCampaigns(): Promise<MetaCampaign[]> {
  return graphPaged<MetaCampaign>(`${adAccountId()}/campaigns`, {
    fields: 'id,name,status,objective,start_time,stop_time',
  });
}

export interface MetaInsightRow {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  /** The day this row covers — `time_increment=1` makes every row exactly one day. */
  date: string;
}

const num = (value: unknown): number => {
  // Every numeric field arrives as a string ("1234.56"), so this is a parse, not a cast.
  const parsed = parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Daily spend per campaign between two dates.
 *
 * `time_increment=1` is what makes each row a single day rather than one lump per campaign, and
 * `level=campaign` rolls the ad sets and ads underneath it up — which is the altitude a show's
 * promotion is actually decided at.
 */
export async function fetchDailyCampaignInsights(since: string, until: string): Promise<MetaInsightRow[]> {
  const rows = await graphPaged<any>(`${adAccountId()}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
  });

  return rows
    .filter((row) => row.campaign_id && row.date_start)
    .map((row) => ({
      campaign_id: String(row.campaign_id),
      campaign_name: String(row.campaign_name || ''),
      spend: num(row.spend),
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      reach: num(row.reach),
      date: String(row.date_start).slice(0, 10),
    }));
}

export interface MetaAdCopy {
  id: string;
  campaign_id: string;
  name: string | null;
  status: string | null;
  primary_text: string | null;
  headline: string | null;
  description: string | null;
  call_to_action: string | null;
  link_url: string | null;
  created_time: string | null;
}

const text = (value: unknown): string | null => {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || null;
};

/**
 * The words an ad showed, wherever Meta keeps them for that kind of ad.
 *
 * There is no single field. A link ad keeps its copy under `object_story_spec.link_data`, a
 * video ad under `video_data` (where the headline is `title` and the description is
 * `link_description`), a dynamic-creative ad as lists in `asset_feed_spec` — the first variant is
 * the one taken — and an ad made from an existing post often has only the creative's own
 * `body`/`title`. Each is tried in turn, and whatever is missing stays null.
 */
export function extractAdCopy(ad: any): MetaAdCopy {
  const creative = ad?.creative ?? {};
  const story = creative.object_story_spec ?? {};
  const link = story.link_data ?? {};
  const video = story.video_data ?? {};
  const feed = creative.asset_feed_spec ?? {};
  const first = (list: any) => (Array.isArray(list) && list.length ? list[0] : undefined);

  return {
    id: String(ad.id),
    campaign_id: String(ad.campaign_id ?? ''),
    name: text(ad.name),
    status: text(ad.effective_status) ?? text(ad.status),
    primary_text: text(link.message) ?? text(video.message) ?? text(first(feed.bodies)?.text) ?? text(creative.body),
    headline: text(link.name) ?? text(video.title) ?? text(first(feed.titles)?.text) ?? text(creative.title),
    description: text(link.description) ?? text(video.link_description) ?? text(first(feed.descriptions)?.text),
    call_to_action:
      text(link.call_to_action?.type) ?? text(video.call_to_action?.type)
      ?? text(first(feed.call_to_action_types)) ?? text(creative.call_to_action_type),
    link_url:
      text(link.link) ?? text(video.call_to_action?.value?.link)
      ?? text(first(feed.link_urls)?.website_url) ?? text(creative.link_url),
    created_time: text(ad.created_time),
  };
}

/**
 * Every ad on the account with the copy it ran — for the advisor, which writes new ads in the
 * band's own voice. Same `ads_read` scope as the rest; nothing here is written.
 */
export async function fetchAds(): Promise<MetaAdCopy[]> {
  const rows = await graphPaged<any>(`${adAccountId()}/ads`, {
    fields:
      'id,name,status,effective_status,campaign_id,created_time,' +
      'creative{title,body,call_to_action_type,link_url,object_story_spec,asset_feed_spec}',
  });
  return rows.filter((row) => row?.id && row?.campaign_id).map(extractAdCopy);
}

/** Cheap connectivity probe: proves the token works without pulling any reporting. */
export async function ping(): Promise<MetaAccount> {
  return fetchAccount();
}

/** One object — a campaign, ad set, ad or pixel — with the fields asked for. */
export async function fetchObject(id: string, fields: string): Promise<any> {
  if (!/^\d+$/.test(id)) throw new MetaError(`מזהה Meta לא תקין: ${id}`, 400);
  return graph<any>(id, { fields });
}

export interface MetaPixel {
  id: string;
  name: string | null;
  last_fired_time: string | null;
  is_unavailable: boolean;
}

/** The ad account's pixels (datasets). Same `ads_read` scope as the campaigns. */
export async function fetchPixels(): Promise<MetaPixel[]> {
  const rows = await graphPaged<any>(`${adAccountId()}/adspixels`, { fields: 'id,name,last_fired_time,is_unavailable' });
  return rows.filter((row) => row?.id).map((row) => ({
    id: String(row.id),
    name: text(row.name),
    last_fired_time: text(row.last_fired_time),
    is_unavailable: row.is_unavailable === true,
  }));
}

/**
 * What a pixel received since `since`, summed over the period by `aggregation` — `event` gives
 * PageView / ViewContent / Purchase…, `host` gives the sites it fired on. The second is how a
 * club's ticket page is known to carry the pixel without anyone having to say so.
 */
export async function fetchPixelStats(pixelId: string, aggregation: 'event' | 'host', since: Date): Promise<Record<string, number>> {
  if (!/^\d+$/.test(pixelId)) throw new MetaError(`מזהה פיקסל לא תקין: ${pixelId}`, 400);
  const body = await graph<any>(`${pixelId}/stats`, {
    aggregation,
    start_time: String(Math.floor(since.getTime() / 1000)),
  });
  const totals: Record<string, number> = {};
  for (const bucket of Array.isArray(body?.data) ? body.data : []) {
    for (const row of Array.isArray(bucket?.data) ? bucket.data : []) {
      const key = text(row?.value);
      if (key) totals[key] = (totals[key] ?? 0) + num(row?.count);
    }
  }
  return totals;
}

// ---------------------------------------------------------------- writes

/**
 * One write, with the sync's token. Only `metaActions.ts` calls this, and only for an action a
 * person saw previewed and confirmed; the paths it can reach are the few that module builds,
 * never one from a request.
 */
export async function graphWrite<T = any>(path: string, params: Record<string, string>): Promise<T> {
  return graph<T>(path, params, true);
}
