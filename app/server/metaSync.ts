/**
 * Meta ad campaigns → shows.
 *
 * Two halves. The first pulls campaigns and their daily spend into the local cache. The second
 * turns that into the קמפיין line of each show's expense row, which is where the band's books
 * already expect ad spend to be — the column existed and was typed by hand before this.
 *
 * Which campaign paid for which show is **decided by hand** (`meta_campaign_events`), never
 * guessed: campaign names are written for people, and a run of shows promoted together cannot be
 * split by any rule the data supports. The sync suggests matches and a human confirms them, so a
 * wrong mapping is a correction rather than a number nobody can account for.
 */
import { db, uuid, getMetaCurrencyRate, getMetaSyncDays, getSetting, setSetting } from './db.js';
import {
  fetchAccount, fetchAds, fetchCampaigns, fetchDailyCampaignInsights, isMetaConfigured,
  type MetaAdCopy,
} from './metaClient.js';
import { eventLabel, recomputeEvent } from './band.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- pull

export interface MetaPullResult {
  campaigns: number;
  created: number;
  updated: number;
  days_of_spend: number;
  spend: number;
  currency: string;
  from: string;
  to: string;
  /** Filled in by `applyCampaignSpend`, which every sync runs straight afterwards. */
  applied?: ApplyResult;
  /** How many ads' copy was read for the campaign advisor. */
  ads?: number;
  /** Set when the account is not billed in shekels and no rate has been configured. */
  warning?: string;
}

/**
 * Pulls campaigns and their daily spend into the cache.
 *
 * Nothing here is edited locally, so an existing campaign is refreshed in full — a campaign
 * renamed in Ads Manager is meant to reach this list on the next sync. The daily rows are
 * upserted rather than cleared and rewritten, because Meta restates the last few days as
 * conversions settle and a delete-then-insert would drop a day the new window no longer covers.
 */
export async function pullCampaignsFromMeta(options: { days?: number } = {}): Promise<MetaPullResult> {
  const days = options.days ?? getMetaSyncDays();
  const from = daysAgo(days);
  const to = today();

  const account = await fetchAccount();
  const campaigns = await fetchCampaigns();
  const insights = await fetchDailyCampaignInsights(from, to);

  // Totals per campaign, built from the daily rows so the two can never disagree.
  const totals = new Map<string, {
    spend: number; impressions: number; clicks: number; reach: number; first: string; last: string;
  }>();
  for (const row of insights) {
    const t = totals.get(row.campaign_id);
    if (!t) {
      totals.set(row.campaign_id, {
        spend: row.spend, impressions: row.impressions, clicks: row.clicks, reach: row.reach,
        first: row.date, last: row.date,
      });
      continue;
    }
    t.spend += row.spend;
    t.impressions += row.impressions;
    t.clicks += row.clicks;
    // Reach is people, not events: summing days would count the same person once per day. The
    // largest single day is the closest honest floor the daily breakdown can give.
    t.reach = Math.max(t.reach, row.reach);
    if (row.date < t.first) t.first = row.date;
    if (row.date > t.last) t.last = row.date;
  }

  // A campaign that spent in the window but is missing from /campaigns (deleted since) still
  // has to be storable — its money was real and a show may already be mapped to it.
  const named = new Map(campaigns.map((c) => [c.id, c]));
  for (const row of insights) {
    if (!named.has(row.campaign_id)) {
      named.set(row.campaign_id, { id: row.campaign_id, name: row.campaign_name || row.campaign_id });
    }
  }

  let created = 0;
  let updated = 0;

  const tx = db.transaction(() => {
    for (const campaign of named.values()) {
      const t = totals.get(campaign.id);
      const values = [
        account.id, campaign.name || campaign.id, campaign.status ?? null, campaign.objective ?? null,
        t?.first ?? null, t?.last ?? null, round2(t?.spend ?? 0), Math.round(t?.impressions ?? 0),
        Math.round(t?.clicks ?? 0), Math.round(t?.reach ?? 0), account.currency, new Date().toISOString(),
      ];
      const existing = db.prepare('SELECT id FROM meta_campaigns WHERE id = ?').get(campaign.id);
      if (existing) {
        db.prepare(
          `UPDATE meta_campaigns SET account_id = ?, name = ?, status = ?, objective = ?,
             first_spend_date = ?, last_spend_date = ?, spend = ?, impressions = ?, clicks = ?,
             reach = ?, currency = ?, synced_at = ?
           WHERE id = ?`
        ).run(...values, campaign.id);
        updated++;
      } else {
        db.prepare(
          `INSERT INTO meta_campaigns (account_id, name, status, objective, first_spend_date,
             last_spend_date, spend, impressions, clicks, reach, currency, synced_at, id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(...values, campaign.id);
        created++;
      }
    }

    const upsertDay = db.prepare(
      `INSERT INTO meta_campaign_daily (campaign_id, date, spend, impressions, clicks)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, date) DO UPDATE SET
         spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks`
    );
    for (const row of insights) {
      upsertDay.run(row.campaign_id, row.date, round2(row.spend), Math.round(row.impressions), Math.round(row.clicks));
    }

    setSetting('meta_last_sync', new Date().toISOString());
    setSetting('meta_account_currency', account.currency);
  });
  tx();

  const result: MetaPullResult = {
    campaigns: named.size,
    created,
    updated,
    days_of_spend: insights.length,
    spend: round2(insights.reduce((sum, r) => sum + r.spend, 0)),
    currency: account.currency,
    from,
    to,
  };
  const warnings: string[] = [];
  if (account.currency !== 'ILS' && getMetaCurrencyRate() === 1) {
    warnings.push(
      `חשבון הפרסום מחויב ב-${account.currency} ולא הוגדר שער המרה — ` +
      'הסכומים לא נכתבו לעמודת «קמפיין». הגדירו meta_currency_rate בהגדרות.'
    );
  }

  // The ad copy is for the advisor and nothing else, so failing to read it must not fail a sync
  // whose spend figures already landed — it is reported beside the result instead.
  try {
    result.ads = storeAds(await fetchAds());
  } catch (err) {
    warnings.push(`נוסחי המודעות לא נקראו: ${(err as Error).message}`);
  }

  if (warnings.length) result.warning = warnings.join(' · ');
  return result;
}

/**
 * Replaces the stored copy of every ad Meta returned. Ads Meta no longer returns are kept: a
 * deleted ad's wording is still what that campaign ran, and the advisor learns from history.
 */
function storeAds(ads: MetaAdCopy[]): number {
  const upsert = db.prepare(
    `INSERT INTO meta_ads (id, campaign_id, name, status, primary_text, headline, description,
       call_to_action, link_url, created_time, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       campaign_id = excluded.campaign_id, name = excluded.name, status = excluded.status,
       primary_text = excluded.primary_text, headline = excluded.headline,
       description = excluded.description, call_to_action = excluded.call_to_action,
       link_url = excluded.link_url, created_time = excluded.created_time,
       synced_at = excluded.synced_at`
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const ad of ads) {
      upsert.run(
        ad.id, ad.campaign_id, ad.name, ad.status, ad.primary_text, ad.headline, ad.description,
        ad.call_to_action, ad.link_url, ad.created_time, now
      );
    }
  })();
  return ads.length;
}

/**
 * The distinct wording each campaign ran, newest first — the material the advisor writes a new ad
 * from. How each campaign did is joined in the prompt by `campaign_id`, from the campaign rows
 * the advisor already gets. Identical copy across an ad set's placements is collapsed to one.
 */
export function pastAdCopy(limit = 40) {
  const rows = db
    .prepare(
      `SELECT a.campaign_id, c.name AS campaign_name, c.objective,
              COALESCE(c.last_spend_date, c.first_spend_date, a.created_time) AS ran_until,
              a.primary_text, a.headline, a.description, a.call_to_action
       FROM meta_ads a LEFT JOIN meta_campaigns c ON c.id = a.campaign_id
       WHERE COALESCE(a.primary_text, a.headline, a.description) IS NOT NULL
       ORDER BY ran_until DESC`
    )
    .all() as any[];

  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const key = [row.campaign_id, row.primary_text, row.headline, row.description].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      objective: row.objective,
      primary_text: row.primary_text,
      headline: row.headline,
      description: row.description,
      call_to_action: row.call_to_action,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- attribution

/**
 * What each mapped show is owed of each campaign's spend.
 *
 * A campaign's spend is divided by weight across the shows mapped to it — the default weight of
 * 1 everywhere means an equal split, so a campaign promoting three nights of a tour puts a third
 * on each without anyone configuring anything. Weights are summed per campaign at read time
 * rather than stored as fractions, so adding a fourth show re-divides the campaign correctly
 * instead of leaving three thirds and an orphan.
 */
export function attributedSpendByEvent(): Map<string, { spend: number; impressions: number; clicks: number; campaigns: number }> {
  const rows = db
    .prepare(
      `SELECT m.event_id, m.weight, c.spend, c.impressions, c.clicks,
              (SELECT SUM(weight) FROM meta_campaign_events WHERE campaign_id = m.campaign_id) AS total_weight
       FROM meta_campaign_events m
       JOIN meta_campaigns c ON c.id = m.campaign_id`
    )
    .all() as Array<{
      event_id: string; weight: number; spend: number; impressions: number; clicks: number; total_weight: number;
    }>;

  const rate = getMetaCurrencyRate();
  const byEvent = new Map<string, { spend: number; impressions: number; clicks: number; campaigns: number }>();
  for (const row of rows) {
    // A zero or missing total would divide by nothing; treat the row as an equal single share.
    const total = Number(row.total_weight) > 0 ? Number(row.total_weight) : 1;
    const share = (Number(row.weight) || 1) / total;
    const current = byEvent.get(row.event_id) ?? { spend: 0, impressions: 0, clicks: 0, campaigns: 0 };
    current.spend += (Number(row.spend) || 0) * share * rate;
    current.impressions += (Number(row.impressions) || 0) * share;
    current.clicks += (Number(row.clicks) || 0) * share;
    current.campaigns += 1;
    byEvent.set(row.event_id, current);
  }
  for (const value of byEvent.values()) {
    value.spend = round2(value.spend);
    value.impressions = Math.round(value.impressions);
    value.clicks = Math.round(value.clicks);
  }
  return byEvent;
}

export interface ApplyResult {
  /** Shows whose קמפיין line the sync wrote. */
  written: number;
  /** Shows already carrying the right figure — nothing to do. */
  unchanged: number;
  /** Shows whose קמפיין was typed by hand, so the sync left it alone. */
  locked: number;
  /**
   * Shows already paid out to the musicians, whose costs the sync will not touch even though
   * the campaign that promoted them has spent more since.
   */
  settled: number;
  /** Of those, the ones where the campaign has in fact moved on — worth knowing about. */
  settled_stale: number;
  /** Campaigns with spend that no show claims — the ones needing a mapping. */
  unmapped_campaigns: number;
  /** Spend sitting in those unmapped campaigns, in shekels. */
  unmapped_spend: number;
  skipped_currency?: boolean;
}

/**
 * Writes the attributed spend into each mapped show's קמפיין line, then recomputes the show.
 *
 * A row whose קמפיין was typed by hand is never overwritten: `campaign_locked` is the same
 * escape hatch a renamed show uses against the calendar sync, and the count of held-back rows
 * is reported so a figure that stopped tracking Meta is visible rather than mysterious.
 *
 * **A show already paid out to the musicians is never touched either**, and this is the more
 * important of the two guards. Campaigns are bought per month but run across months, so a
 * campaign promoting a show keeps spending after it — the ads are produced monthly and one
 * campaign lands on two or three invoices. Left to itself the sync would raise a past show's
 * costs every month, re-divide its profit, and change what each member is owed for a night
 * whose money has already changed hands. Growth after the payout is real spend and it is
 * counted in the monthly reconciliation and the unattributed totals; what it must not do is
 * silently rewrite a settled division.
 *
 * An account billed in a currency other than shekels with no rate configured writes nothing at
 * all — putting a dollar figure in a shekel column would understate every show's costs.
 */
export function applyCampaignSpend(): ApplyResult {
  const currency = getSetting('meta_account_currency', 'ILS');
  const unmapped = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(spend), 0) AS spend FROM meta_campaigns
       WHERE spend > 0 AND id NOT IN (SELECT campaign_id FROM meta_campaign_events)`
    )
    .get() as { n: number; spend: number };

  const base: ApplyResult = {
    written: 0,
    unchanged: 0,
    locked: 0,
    settled: 0,
    settled_stale: 0,
    unmapped_campaigns: unmapped.n,
    unmapped_spend: round2(unmapped.spend * getMetaCurrencyRate()),
  };

  if (currency !== 'ILS' && getMetaCurrencyRate() === 1) return { ...base, skipped_currency: true };

  const attributed = attributedSpendByEvent();
  const touched: string[] = [];

  db.transaction(() => {
    for (const [eventId, totals] of attributed) {
      const row = db
        .prepare(
          `SELECT x.id, x.campaign, x.campaign_locked, e.paid_to_musicians
           FROM band_event_expenses x JOIN band_events e ON e.id = x.event_id
           WHERE x.event_id = ?`
        )
        .get(eventId) as
        | { id: string; campaign: number; campaign_locked: number; paid_to_musicians: number }
        | undefined;
      // No row means no such show — a mapping to a show that has since been deleted. Harmless
      // and self-correcting: the mapping is cleaned up with the show.
      if (!row) continue;
      if (row.campaign_locked) {
        base.locked++;
        continue;
      }
      if (row.paid_to_musicians) {
        base.settled++;
        // Counted separately from the plain settled case: this is the one that means a campaign
        // has kept spending on a night already paid for, which someone may want to act on.
        if (round2(Number(row.campaign) || 0) !== totals.spend) base.settled_stale++;
        continue;
      }
      if (round2(Number(row.campaign) || 0) === totals.spend) {
        base.unchanged++;
        continue;
      }
      db.prepare('UPDATE band_event_expenses SET campaign = ? WHERE id = ?').run(totals.spend, row.id);
      base.written++;
      touched.push(eventId);
    }
  })();

  // Outside the transaction above: each recompute opens its own, as it does everywhere else.
  for (const eventId of touched) recomputeEvent(eventId);
  return base;
}

// ---------------------------------------------------------------- mappings

/** Maps a campaign to a show, or changes what share of it that show carries. */
export function setMapping(campaignId: string, eventId: string, weight = 1): any {
  const campaign = db.prepare('SELECT id FROM meta_campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw Object.assign(new Error('campaign not found'), { status: 404 });
  const event = db.prepare('SELECT id FROM band_events WHERE id = ?').get(eventId);
  if (!event) throw Object.assign(new Error('event not found'), { status: 400 });

  const safeWeight = Number(weight) > 0 ? round2(Number(weight)) : 1;
  db.prepare(
    `INSERT INTO meta_campaign_events (id, campaign_id, event_id, weight) VALUES (?, ?, ?, ?)
     ON CONFLICT(campaign_id, event_id) DO UPDATE SET weight = excluded.weight`
  ).run(uuid(), campaignId, eventId, safeWeight);

  // The other shows on this campaign now carry a different share of it, so the whole campaign's
  // shows are rewritten rather than just this one.
  applyCampaignSpend();
  return db.prepare('SELECT * FROM meta_campaign_events WHERE campaign_id = ? AND event_id = ?')
    .get(campaignId, eventId);
}

/**
 * Unmaps a campaign from a show.
 *
 * The show keeps whatever is in its קמפיין column — that figure was real spend, and zeroing it
 * on an unmap would quietly rewrite a settled show's profit. Re-applying afterwards is what
 * re-divides the campaign among the shows that remain.
 */
export function deleteMapping(campaignId: string, eventId: string): { deleted: number } {
  const info = db.prepare('DELETE FROM meta_campaign_events WHERE campaign_id = ? AND event_id = ?')
    .run(campaignId, eventId);
  if (info.changes) applyCampaignSpend();
  return { deleted: info.changes };
}

// ---------------------------------------------------------------- suggestions

/** Strips punctuation and the definite article so "זאפה חיפה" matches "זאפה-חיפה!". */
function tokens(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 1);
}

/** Dates a campaign name might carry: 17.6, 17/06, 17-06-2026. Day and month only — the year is rarely written. */
function datesInName(name: string): Array<{ day: number; month: number }> {
  const found: Array<{ day: number; month: number }> = [];
  for (const m of String(name || '').matchAll(/(\d{1,2})[./-](\d{1,2})/g)) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) found.push({ day, month });
  }
  return found;
}

export interface MappingSuggestion {
  event_id: string;
  label: string;
  /** 0–1. Only what the name and the dates support — never enough to write a mapping on its own. */
  score: number;
  reason: string;
}

/**
 * What show a campaign was probably for.
 *
 * Three signals, and the reason is reported alongside the score so a suggestion can be judged
 * rather than trusted: the venue's name appearing in the campaign's name, a date in the campaign
 * name matching the show's, and the spend having happened in the weeks before the show. None of
 * them writes anything — this only ranks the dropdown.
 */
export function suggestEventsForCampaign(campaignId: string, limit = 3): MappingSuggestion[] {
  const campaign = db.prepare('SELECT * FROM meta_campaigns WHERE id = ?').get(campaignId) as any;
  if (!campaign) return [];

  const nameTokens = new Set(tokens(campaign.name));
  const nameDates = datesInName(campaign.name);
  const events = db.prepare('SELECT id, venue, date FROM band_events ORDER BY date DESC').all() as any[];

  const scored = events.map((event) => {
    const venueTokens = tokens(event.venue);
    const hits = venueTokens.filter((t) => nameTokens.has(t)).length;
    const nameScore = venueTokens.length ? hits / venueTokens.length : 0;

    const [, month, day] = String(event.date || '').split('-').map((n) => parseInt(n, 10));
    const dateHit = nameDates.some((d) => d.day === day && d.month === month);

    // Spend that stopped in the three weeks before the show, and not after it, is the shape a
    // show's own promotion has. It is the weakest of the three signals, so it is worth least.
    let windowScore = 0;
    if (campaign.last_spend_date && event.date) {
      const gap = (Date.parse(event.date) - Date.parse(campaign.last_spend_date)) / 86400_000;
      if (gap >= -1 && gap <= 21) windowScore = 1 - Math.max(0, gap) / 21;
    }

    const score = Math.min(1, nameScore * 0.55 + (dateHit ? 0.3 : 0) + windowScore * 0.15);
    const reasons = [
      hits ? `שם המקום (${hits}/${venueTokens.length})` : '',
      dateHit ? 'תאריך בשם הקמפיין' : '',
      windowScore > 0 ? 'הוצאה בשבועות שלפני ההופעה' : '',
    ].filter(Boolean);

    return { event_id: event.id, label: eventLabel(event.venue, event.date), score: round2(score), reason: reasons.join(' · ') };
  });

  // Below a third of a match the "suggestion" is noise, and offering it invites a wrong mapping.
  return scored.filter((s) => s.score >= 0.34).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------- reads

/** Every campaign with the shows mapped to it, for the mapping screen. */
export function listCampaigns(options: { unmappedOnly?: boolean } = {}) {
  const campaigns = db
    .prepare('SELECT * FROM meta_campaigns ORDER BY COALESCE(last_spend_date, first_spend_date) DESC, name')
    .all() as any[];
  const mappings = db
    .prepare(
      `SELECT m.campaign_id, m.event_id, m.weight, e.venue, e.date
       FROM meta_campaign_events m JOIN band_events e ON e.id = m.event_id`
    )
    .all() as any[];

  const rate = getMetaCurrencyRate();
  const byCampaign = new Map<string, any[]>();
  for (const m of mappings) {
    const list = byCampaign.get(m.campaign_id) ?? [];
    list.push(m);
    byCampaign.set(m.campaign_id, list);
  }

  const rows = campaigns.map((campaign) => {
    const mapped = byCampaign.get(campaign.id) ?? [];
    const totalWeight = mapped.reduce((sum, m) => sum + (Number(m.weight) || 1), 0) || 1;
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      objective: campaign.objective,
      first_spend_date: campaign.first_spend_date,
      last_spend_date: campaign.last_spend_date,
      spend: round2((Number(campaign.spend) || 0) * rate),
      spend_original: round2(Number(campaign.spend) || 0),
      currency: campaign.currency,
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      reach: campaign.reach,
      events: mapped.map((m) => ({
        event_id: m.event_id,
        label: eventLabel(m.venue, m.date),
        date: m.date,
        weight: Number(m.weight) || 1,
        share: round2((Number(m.weight) || 1) / totalWeight),
        attributed: round2((Number(campaign.spend) || 0) * rate * ((Number(m.weight) || 1) / totalWeight)),
      })),
      // Only worked out for the campaigns that need it: suggesting for hundreds of already
      // mapped campaigns is work nobody reads.
      suggestions: mapped.length ? [] : suggestEventsForCampaign(campaign.id),
    };
  });

  return options.unmappedOnly ? rows.filter((r) => r.events.length === 0) : rows;
}

export interface AdAnalysisRow {
  event_id: string;
  /** The show's expense row, so the UI can hand a hand-typed קמפיין back to the sync. */
  expense_id: string | null;
  label: string;
  venue: string;
  date: string;
  tickets: number;
  revenue: number;
  ad_spend: number;
  /** What the campaign figure on the expense row says, which differs when it was typed by hand. */
  campaign_on_row: number;
  campaign_locked: boolean;
  /** Paid out to the musicians — its costs are frozen whatever the campaigns do next. */
  settled: boolean;
  campaigns: number;
  /**
   * The months this show's promotion was invoiced in, earliest first. A campaign bought at the
   * end of one month runs into the next two, so a single show's ads routinely appear on three
   * separate Meta invoices — this is what says which.
   */
  spend_months: string[];
  /** A mapped campaign was still spending after the show. Ordinary while it runs; worth a look once it is settled. */
  spending_after_show: number;
  impressions: number;
  clicks: number;
  cost_per_ticket: number | null;
  spend_share_of_revenue: number | null;
  profit: number;
}

/**
 * The question this whole integration exists to answer: what one show's promotion cost, and
 * whether it was worth it.
 *
 * Ad spend comes from the mappings rather than from the expense row, so the analysis is about
 * what Meta charged even where somebody has since typed a different figure into the books — both
 * are reported, side by side, because a gap between them is worth seeing rather than smoothing.
 *
 * `cost_per_ticket` is null rather than 0 for a show with no ticket count: dividing by nothing
 * is not a cost of zero, and a zero would sort to the top of the cheapest-shows list.
 */
export function adAnalysis(range: { from?: string; to?: string } = {}): {
  rows: AdAnalysisRow[];
  totals: {
    ad_spend: number; tickets: number; revenue: number; shows: number;
    cost_per_ticket: number | null; spend_share_of_revenue: number | null; unmapped_spend: number;
  };
} {
  const clauses: string[] = [];
  const params: string[] = [];
  if (range.from) { clauses.push('e.date >= ?'); params.push(range.from); }
  if (range.to) { clauses.push('e.date <= ?'); params.push(range.to); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const events = db
    .prepare(
      `SELECT e.id, e.venue, e.date, e.tickets, e.amount_pre_vat, e.profit, e.paid_to_musicians,
              x.id AS expense_id, x.campaign AS campaign_on_row, x.campaign_locked
       FROM band_events e LEFT JOIN band_event_expenses x ON x.event_id = e.id${where}
       ORDER BY e.date DESC`
    )
    .all(...params) as any[];

  const attributed = attributedSpendByEvent();

  // Which months each show's campaigns were billed in, and whether any of them carried on
  // spending past the show itself. One query for every show rather than one per row.
  const monthsByEvent = new Map<string, Set<string>>();
  const afterByEvent = new Map<string, Set<string>>();
  for (const row of db
    .prepare(
      `SELECT m.event_id, substr(d.date, 1, 7) AS month, d.date, e.date AS event_date, d.campaign_id
       FROM meta_campaign_events m
       JOIN meta_campaign_daily d ON d.campaign_id = m.campaign_id
       JOIN band_events e ON e.id = m.event_id
       WHERE d.spend > 0`
    )
    .all() as Array<{ event_id: string; month: string; date: string; event_date: string; campaign_id: string }>) {
    const months = monthsByEvent.get(row.event_id) ?? new Set<string>();
    months.add(row.month);
    monthsByEvent.set(row.event_id, months);
    if (row.event_date && row.date > row.event_date) {
      const after = afterByEvent.get(row.event_id) ?? new Set<string>();
      after.add(row.campaign_id);
      afterByEvent.set(row.event_id, after);
    }
  }

  const rows: AdAnalysisRow[] = events.map((event) => {
    const totals = attributed.get(event.id);
    const adSpend = totals?.spend ?? 0;
    const tickets = Number(event.tickets) || 0;
    const revenue = round2(Number(event.amount_pre_vat) || 0);
    return {
      event_id: event.id,
      expense_id: event.expense_id ?? null,
      label: eventLabel(event.venue, event.date),
      venue: event.venue,
      date: event.date,
      tickets,
      revenue,
      ad_spend: adSpend,
      campaign_on_row: round2(Number(event.campaign_on_row) || 0),
      campaign_locked: !!event.campaign_locked,
      settled: !!event.paid_to_musicians,
      campaigns: totals?.campaigns ?? 0,
      spend_months: [...(monthsByEvent.get(event.id) ?? [])].sort(),
      spending_after_show: (afterByEvent.get(event.id) ?? new Set()).size,
      impressions: totals?.impressions ?? 0,
      clicks: totals?.clicks ?? 0,
      cost_per_ticket: tickets > 0 && adSpend > 0 ? round2(adSpend / tickets) : null,
      spend_share_of_revenue: revenue > 0 && adSpend > 0 ? round2((adSpend / revenue) * 100) : null,
      profit: round2(Number(event.profit) || 0),
    };
  });

  const spend = round2(rows.reduce((sum, r) => sum + r.ad_spend, 0));
  const tickets = rows.reduce((sum, r) => sum + r.tickets, 0);
  const revenue = round2(rows.reduce((sum, r) => sum + r.revenue, 0));
  // Spend no show claims, so the totals can be read against the account's real spend rather
  // than looking complete when a third of the money is unattributed.
  const unmapped = db
    .prepare(
      `SELECT COALESCE(SUM(spend), 0) AS spend FROM meta_campaigns
       WHERE spend > 0 AND id NOT IN (SELECT campaign_id FROM meta_campaign_events)`
    )
    .get() as { spend: number };

  return {
    rows,
    totals: {
      ad_spend: spend,
      tickets,
      revenue,
      shows: rows.filter((r) => r.ad_spend > 0).length,
      cost_per_ticket: tickets > 0 && spend > 0 ? round2(spend / tickets) : null,
      spend_share_of_revenue: revenue > 0 && spend > 0 ? round2((spend / revenue) * 100) : null,
      unmapped_spend: round2((Number(unmapped.spend) || 0) * getMetaCurrencyRate()),
    },
  };
}

export interface MonthlyCampaignRow {
  campaign_id: string;
  name: string;
  /** What this campaign cost **in this month** — its share of this month's invoice. */
  spend: number;
  /** What the campaign has cost in total, across every month it ran. */
  total_spend: number;
  /** How many calendar months it has spent in, and which of them this row is. */
  months_spanned: number;
  month_index: number;
  events: Array<{ event_id: string; label: string; attributed: number }>;
}

export interface MonthlyRow {
  /** YYYY-MM — one month, which is one Meta invoice. */
  month: string;
  spend: number;
  /** Of that, what no show claims. */
  unmapped_spend: number;
  campaigns: MonthlyCampaignRow[];
}

/**
 * Spend by calendar month — the axis the invoices arrive on.
 *
 * Ads are produced monthly, so each month is one Meta invoice; but a campaign started at the end
 * of a month keeps running into the next two, so that invoice is a slice of several campaigns
 * rather than the cost of anything in particular. This is the view that reconciles: for a given
 * month, what Meta charged, which campaigns it was for, how far through each campaign that month
 * was, and which shows the month's portion belongs to.
 *
 * It is deliberately a different question from `adAnalysis`. A show's promotion costs what its
 * campaigns cost, whichever months those landed on — that figure answers "was this show worth
 * advertising". This one answers "what is this invoice, and does it add up", and the two will
 * never be the same partition of the money.
 */
export function monthlyBreakdown(range: { from?: string; to?: string } = {}): {
  months: MonthlyRow[];
  totals: { spend: number; unmapped_spend: number; months: number };
} {
  const clauses: string[] = [];
  const params: string[] = [];
  if (range.from) { clauses.push('d.date >= ?'); params.push(range.from); }
  if (range.to) { clauses.push('d.date <= ?'); params.push(range.to); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rate = getMetaCurrencyRate();
  // Grouped in SQL rather than in JS: the daily table is the only place a month's spend is
  // recorded, and summing it here keeps the month totals and the campaign rows in step.
  const rows = db
    .prepare(
      `SELECT substr(d.date, 1, 7) AS month, d.campaign_id, c.name,
              COALESCE(SUM(d.spend), 0) AS spend
       FROM meta_campaign_daily d
       LEFT JOIN meta_campaigns c ON c.id = d.campaign_id${where}
       GROUP BY month, d.campaign_id
       ORDER BY month DESC, spend DESC`
    )
    .all(...params) as Array<{ month: string; campaign_id: string; name: string | null; spend: number }>;

  // Every month a campaign spent in, unfiltered by the range — a campaign is "1 of 3" by its own
  // life, not by how much of it the current filter happens to show.
  const spans = new Map<string, string[]>();
  for (const row of db
    .prepare(
      `SELECT campaign_id, substr(date, 1, 7) AS month FROM meta_campaign_daily
       WHERE spend > 0 GROUP BY campaign_id, month ORDER BY month`
    )
    .all() as Array<{ campaign_id: string; month: string }>) {
    const list = spans.get(row.campaign_id) ?? [];
    list.push(row.month);
    spans.set(row.campaign_id, list);
  }

  const totalSpend = new Map<string, number>();
  for (const row of db
    .prepare('SELECT id, spend FROM meta_campaigns').all() as Array<{ id: string; spend: number }>) {
    totalSpend.set(row.id, Number(row.spend) || 0);
  }

  // The weights, so a month's portion of a shared campaign is divided the same way its whole is.
  const mappings = new Map<string, Array<{ event_id: string; label: string; weight: number }>>();
  for (const m of db
    .prepare(
      `SELECT m.campaign_id, m.event_id, m.weight, e.venue, e.date
       FROM meta_campaign_events m JOIN band_events e ON e.id = m.event_id`
    )
    .all() as any[]) {
    const list = mappings.get(m.campaign_id) ?? [];
    list.push({ event_id: m.event_id, label: eventLabel(m.venue, m.date), weight: Number(m.weight) || 1 });
    mappings.set(m.campaign_id, list);
  }

  const byMonth = new Map<string, MonthlyRow>();
  for (const row of rows) {
    const month = byMonth.get(row.month) ?? { month: row.month, spend: 0, unmapped_spend: 0, campaigns: [] };
    const spend = round2((Number(row.spend) || 0) * rate);
    const mapped = mappings.get(row.campaign_id) ?? [];
    const totalWeight = mapped.reduce((sum, m) => sum + m.weight, 0) || 1;
    const months = spans.get(row.campaign_id) ?? [];

    month.spend = round2(month.spend + spend);
    if (mapped.length === 0) month.unmapped_spend = round2(month.unmapped_spend + spend);
    month.campaigns.push({
      campaign_id: row.campaign_id,
      name: row.name || row.campaign_id,
      spend,
      total_spend: round2((totalSpend.get(row.campaign_id) ?? 0) * rate),
      months_spanned: months.length,
      // 1-based, so a campaign's second month reads "2/3" — which is what says the invoice in
      // hand is not the whole of what this campaign will cost.
      month_index: Math.max(1, months.indexOf(row.month) + 1),
      events: mapped.map((m) => ({
        event_id: m.event_id,
        label: m.label,
        attributed: round2(spend * (m.weight / totalWeight)),
      })),
    });
    byMonth.set(row.month, month);
  }

  const months = [...byMonth.values()];
  return {
    months,
    totals: {
      spend: round2(months.reduce((sum, m) => sum + m.spend, 0)),
      unmapped_spend: round2(months.reduce((sum, m) => sum + m.unmapped_spend, 0)),
      months: months.length,
    },
  };
}

/** The daily spend curve of one campaign — whether the money went out in time to sell a ticket. */
export function campaignDaily(campaignId: string) {
  const rate = getMetaCurrencyRate();
  return (
    db.prepare('SELECT date, spend, impressions, clicks FROM meta_campaign_daily WHERE campaign_id = ? ORDER BY date')
      .all(campaignId) as any[]
  ).map((row) => ({ ...row, spend: round2((Number(row.spend) || 0) * rate) }));
}

export function metaStatus() {
  const campaigns = db.prepare('SELECT COUNT(*) AS n FROM meta_campaigns').get() as { n: number };
  const mapped = db
    .prepare('SELECT COUNT(DISTINCT campaign_id) AS n FROM meta_campaign_events').get() as { n: number };
  const unmapped = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(spend), 0) AS spend FROM meta_campaigns
       WHERE spend > 0 AND id NOT IN (SELECT campaign_id FROM meta_campaign_events)`
    )
    .get() as { n: number; spend: number };

  return {
    configured: isMetaConfigured(),
    last_sync: getSetting('meta_last_sync', '') || null,
    sync_days: getMetaSyncDays(),
    currency: getSetting('meta_account_currency', 'ILS'),
    currency_rate: getMetaCurrencyRate(),
    campaigns: campaigns.n,
    mapped_campaigns: mapped.n,
    unmapped_campaigns: unmapped.n,
    unmapped_spend: round2((Number(unmapped.spend) || 0) * getMetaCurrencyRate()),
  };
}
