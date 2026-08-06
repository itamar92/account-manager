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
  fetchAccount, fetchCampaigns, fetchDailyCampaignInsights, isMetaConfigured,
} from './metaClient.js';
import { eventLabel, recomputeEvent } from './moonlight.js';

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
  if (account.currency !== 'ILS' && getMetaCurrencyRate() === 1) {
    result.warning =
      `חשבון הפרסום מחויב ב-${account.currency} ולא הוגדר שער המרה — ` +
      'הסכומים לא נכתבו לעמודת «קמפיין». הגדירו meta_currency_rate בהגדרות.';
  }
  return result;
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
    unmapped_campaigns: unmapped.n,
    unmapped_spend: round2(unmapped.spend * getMetaCurrencyRate()),
  };

  if (currency !== 'ILS' && getMetaCurrencyRate() === 1) return { ...base, skipped_currency: true };

  const attributed = attributedSpendByEvent();
  const touched: string[] = [];

  db.transaction(() => {
    for (const [eventId, totals] of attributed) {
      const row = db
        .prepare('SELECT id, campaign, campaign_locked FROM band_event_expenses WHERE event_id = ?')
        .get(eventId) as { id: string; campaign: number; campaign_locked: number } | undefined;
      // No row means no such show — a mapping to a show that has since been deleted. Harmless
      // and self-correcting: the mapping is cleaned up with the show.
      if (!row) continue;
      if (row.campaign_locked) {
        base.locked++;
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
  campaigns: number;
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
      `SELECT e.id, e.venue, e.date, e.tickets, e.amount_pre_vat, e.profit,
              x.id AS expense_id, x.campaign AS campaign_on_row, x.campaign_locked
       FROM band_events e LEFT JOIN band_event_expenses x ON x.event_id = e.id${where}
       ORDER BY e.date DESC`
    )
    .all(...params) as any[];

  const attributed = attributedSpendByEvent();

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
      campaigns: totals?.campaigns ?? 0,
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
