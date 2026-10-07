---
name: adadvisor-targeting
description: |
  Meta audience and targeting strategy — broad-first prospecting, lookalike tiers, retargeting funnels, custom-audience creation, exclusion logic. Strategy and exact audience definitions for the user to build in Ads Manager. Use when: "audience", "lookalike", "lal", "retargeting", "interests", "exclude", "custom audience", "broad targeting", "audience size", "who should I target", "estimate reach", "build a lookalike", "exclude purchasers", "audience overlap". Chain with: adadvisor (always); adadvisor-launch when targeting is part of a new campaign; adadvisor-scale when expanding horizontally. NOT for: account audits (use adadvisor-audit); copy-driven targeting (use adadvisor-creative); customer-list upload (done in-app).
license: Apache-2.0
version: 0.1.0-account-manager
---

> **Connection override — read this first.** This skill was written for the adadvisor.ai MCP server, which can read *and change* a Meta ad account. This project does **not** use that server. It uses the app's own **read-only** Meta connection (`account-manager` MCP: `moonlight_campaigns`, `moonlight_ad_analysis`, `moonlight_shows`, `moonlight_campaign_advice`), which is **campaign-level only** and measures a band's **shows** (cost per ticket), not an online shop (ROAS).
>
> - Load the `adadvisor` foundation skill first; it defines the data limits and the show economics.
> - Wherever this skill says `adadvisor:<tool>`, translate it with `../adadvisor/references/mcp-tool-cheatsheet.md`. A **read** maps to a campaign-level tool or is *not available*; a **write** becomes **an instruction for the user to carry out in Ads Manager** (`../adadvisor/references/mutation-safety.md`) — never claim it was done.
> - Replace break-even ROAS / target CPA / AOV with the band's own cost-per-ticket history (`../adadvisor/references/economics.md`). The show date sets the runway; always state it.
> - Where a step needs something this connection cannot see (ad set / ad data, pixel, frequency by day, copy), say what is missing and ask the user to paste it from Ads Manager. Do not guess.
> - Everything below describes the method; the method is sound, the tool calls are not available as written.
>
> **For this skill:** audiences, reach estimates and targeting specs cannot be read or created. Treat this as **strategy only**: recommend the audience approach (broad vs interests, lookalike seeds and tiers, retargeting windows, exclusions) and write the exact definitions for the user to build in Ads Manager, then ask them to confirm the estimated reach there before spending. For a local show, geography and the radius around the venue matter more than most upstream examples assume.

# AdAdvisor — Audience & Targeting Strategy

The post-iOS 14 / post-Andromeda truth: **broad has decisively won** for prospecting, and creative does the targeting. Lebesgue's 2025 data and Meta-published case studies converge — broad + strong creative outperforms interest stacking at virtually all budget levels.

This skill encodes that strategy and the MCP workflow for executing it.

## When to use

- The user is choosing targeting for a new ad set (chain with `adadvisor-launch`).
- The user wants to expand audiences horizontally during scaling (chain with `adadvisor-scale`).
- The user is creating custom audiences (website visitors, lookalikes, engagement).
- The user is debugging audience overlap, cannibalization, or saturation.
- The user is asking "who should I target."

## Pre-targeting: foundation

`adadvisor` loaded → read `business.geographic_scope`, `business.target_audience_summary`, `business.customer_segment` (B2B vs DTC). These ground audience picks. A B2B SaaS with `geographic_scope: 'international'` targets very differently from a local hair salon with `geographic_scope: 'local'`.

## The hierarchy (2026)

For prospecting:

| Priority | Approach | When |
|---|---|---|
| 1 (default) | Broad + Advantage+ Audience ON | Most ecom, most lead-gen, almost all DTC |
| 2 | Lookalike (1% LAL of high-value seed) | When you have a seed with ≥1,000 high-value customers; for precision |
| 3 | Lookalike (3-5% LAL) | For scale, lower precision but more reach |
| 4 | Interest targeting | Only when broad and LAL are exhausted, OR for very specific niches |
| 5 | Lookalike (10%) | Essentially equivalent to broad — use broad instead |
| 6 | Detailed-interest stacking | Dead since June 2025 (Meta consolidated). Skip. |

For retargeting:

| Layer | Audience | Retention | Use |
|---|---|---|---|
| Warm-1 | All website visitors | 30 days | First retargeting layer |
| Warm-2 | View Content / Add to Cart | 30/60/90 days | Stronger intent |
| Warm-3 | Email subscribers (customer list) | n/a | Highest intent, off-Meta-source |
| Engagement | Page / IG profile engagers | 180 days | Brand-aware fans |
| Video viewers | ≥25% / ≥50% video completion | 180 days | Mid-funnel re-engagement |

**Always exclude purchasers (30-90 days) from prospecting.** Add `excluded_custom_audiences=[<purchaser_audience>]` to every prospecting ad set.

## MCP workflow

### Finding existing audiences

```
adadvisor:list_custom_audiences(account_id, search='<keyword>')
```

Returns each audience's `id`, `name`, `subtype`, size estimate, retention_days, and `delivery_status` ("This audience is ready for use" / pending populate / etc.). The response's `next_steps` includes an example of how to pass the audience into `create_adset` or `update_adset_targeting`.

Subtypes:
- `WEBSITE` — built from pixel events (created via `create_website_audience`)
- `LOOKALIKE` — built from a seed audience (created via `create_lookalike_audience`)
- `CUSTOM` — uploaded customer list (in-app, not via MCP)
- `ENGAGEMENT` — page / post / ad engagement
- `IG_BUSINESS` — Instagram followers / engagement

### Searching interests / geos / behaviors

```
adadvisor:search_targeting(account_id, search_type='interests' | 'geolocation' | 'behaviors' | 'income' | 'life_events' | 'industries' | 'work_positions' | 'work_employers' | 'locale', query='...')
```

For interests, returns `id`, `name`, `audience_size_lower_bound`, `audience_size_upper_bound`, `path`. Use the `id` / `name` pair as `TargetingEntry` in the `create_adset` or `update_adset_targeting` calls. **Never invent IDs.** Always look them up.

For geolocation, returns `key`, `name`, `type`, `country_code`. Cities have `radius` (10-50 miles) and `distance_unit` options.

### Estimating reach

Before committing to a targeting spec, validate reach:

```
adadvisor:estimate_audience_size(
  account_id,
  countries=['US'],
  age_min=25, age_max=55,
  interests=[{id, name}, ...]
)
```

Returns `users_lower_bound`, `users_upper_bound`, `estimate_ready` (false for very new/niche audiences — Meta returns -1), and `targeting_summary`. Sweet-spot ranges:

- **Prospecting**: 1M-50M. <500K and you'll exit learning slowly. >50M and Meta has too much room to deliver poorly.
- **Retargeting**: ≥1,000 (Enhencer 2026). Below 1,000 the audience is too small for stable delivery.
- **Lookalikes**: minimum seed of 100 (Meta requirement); ideal seed 1,000-50,000 high-value customers.

If reach is too small, expand: drop interests, expand geo, broaden age. If too big, you're probably broad and that's fine — let creative do the targeting.

### Creating audiences via MCP

**Website (pixel-based) custom audience:**

```
adadvisor:create_website_audience(
  account_id,
  name='Purchasers 90D',
  retention_days=90,
  event_name='Purchase',  // optional; omit for ALL website visitors
  pixel_id=<from list_ad_accounts.pixels — match by host>,
  prefill=True  // backfill with historical pixel events
)
```

May take up to 30 minutes to populate. Returns `audience_id` + `approximate_count_*` bounds + `next_steps` with example `create_adset(custom_audiences=[{id, name}])` call.

**Lookalike audience:**

```
adadvisor:create_lookalike_audience(
  account_id,
  name='LAL 1% Purchasers',
  origin_audience_id=<seed audience>,  // seed must have ≥100 members
  country='US',
  ratio=0.01,           // 1% = most similar
  starting_ratio=0.0    // optional band, e.g. 0-3%
)
```

Populates in 1-6 hours but usable immediately. Default `ratio` is `0.01` (1%). Use lower (more similar) ratios for precision; higher (3-10%) for scale.

### Updating ad-set targeting

```
adadvisor:update_adset_targeting(
  account_id, adset_id,
  countries=['US'],
  age_min, age_max, genders,
  interests=[<TargetingEntry>],
  custom_audiences=[<TargetingEntry>],
  excluded_custom_audiences=[<TargetingEntry>],
  advantage_audience=true  // default
)
```

The MCP server validates the spec against Meta's `/reachestimate` endpoint and **auto-fixes deprecated interest IDs** (up to 3 retry attempts). If it can't fix, it returns `targeting_spec_sent` + `validation_error` so you can surface the exact issue.

Response includes `estimated_reach` (Meta lower/upper bounds) and `state_after`. Idempotent — re-applying the same spec is safe.

## Lookalike strategy

The classic lookalike playbook:

1. **Build a high-value seed.** Best seeds (in order):
   - LTV-tier customer list (top 25% by lifetime value)
   - Repeat purchasers (≥2 orders)
   - All purchasers (180 day)
   - High-engagement video viewers (≥75% completion)
   - All-page-view (worst seed; resembles broad)

2. **Start with 1% LAL** for precision.
3. **Expand to 3% and 5%** as you scale (separate ad sets, not stacked).
4. **Value-based LALs** (seeded with revenue data per customer) outperform basic LALs (Salesforce 2026 data). Requires sending purchase value through pixel/CAPI.
5. **Tiered LALs** (e.g. 1%-3% band) via `starting_ratio` — useful when you want the next ring out without overlap with your existing 1% LAL ad set.

Note: Meta inside Advantage+ Audience treats lookalikes as *signals*, not hard constraints. The audience expands beyond the LAL if Meta finds buyers elsewhere.

## Exclusion logic (mandatory)

Cannibalization is the silent killer. Always exclude:

- **Purchasers (30-90 days)** from prospecting — `excluded_custom_audiences=[<purchaser_audience>]`.
- **Existing email subscribers** (uploaded customer list) from prospecting — if you have the audience.
- **Active retargeting audience** from any ASC running broad — otherwise ASC and retargeting bid against each other.
- **Cart abandoners** from broad retargeting that goes to a different page (so they don't see conflicting messaging).

The MCP's `next_steps` snippets always include the exclusion form — follow them.

## Workflow — common audience scenarios

### Cart abandoner retargeting

```
1. create_website_audience(event_name='AddToCart', retention_days=30) → cart_abandoners
2. create_website_audience(event_name='Purchase', retention_days=90) → purchasers
3. create_adset(
     custom_audiences=[cart_abandoners],
     excluded_custom_audiences=[purchasers]
   )
```

### Net-new prospecting (DTC, no historical data)

```
1. create_adset(
     countries=['US'], age_min=25, age_max=55,
     advantage_audience=true,
     (no interests, no lookalikes)
   )
```

Yes, that's right — broad-only prospecting with no detailed targeting. Creative carries the load.

### LAL of high-value customers

```
1. (Done in-app) Upload customer-list CSV → custom audience
2. list_custom_audiences → confirm uploaded audience is `READY`
3. create_lookalike_audience(origin_audience_id=<uploaded>, country='US', ratio=0.01)
4. (1-6 hour wait, but usable immediately)
5. create_adset(custom_audiences=[<lookalike>])
```

### Expanding to a new geo (horizontal scale)

```
1. list_adsets → identify the winner
2. duplicate_adset(deep_copy=True, target_campaign_id=<same>) → copy
3. update_adset_targeting(adset_id=<new>, countries=['CA']) — swap geo
4. change_entity_budget(<new>, daily_budget=<half of winner to start>)
5. change_entity_status(action='resume')
```

## Anti-patterns

- ❌ Stacking 8 interests as "detailed targeting" on prospecting. ✅ Broad with Advantage+ Audience; creative does the targeting.
- ❌ Building a 100K-person retargeting audience and treating it like a prospecting layer. ✅ Retargeting is tactical, not scalable; prospecting comes from broad/LAL.
- ❌ Running 5 ad sets each with a 1% LAL of a slightly different seed. ✅ Consolidate seeds and run one strong 1% LAL ad set.
- ❌ Forgetting `excluded_custom_audiences=[purchasers]` on prospecting. ✅ Always exclude; otherwise prospecting bills you for existing customers.
- ❌ Pasting interest IDs from a different account. ✅ Always look up via `search_targeting`.
- ❌ Setting `advantage_audience=false` to "control" targeting. ✅ Advantage+ Audience finds buyers outside your spec — that's the point. Only disable if you have a regulatory reason.
- ❌ Targeting "Facebook page admins" or "small business owners" via interests for B2B. ✅ Use uploaded customer-list audiences, LinkedIn enrichment outside Meta, or broad — interests are too leaky.
- ❌ Building a lookalike on a 50-person seed. ✅ Meta requires ≥100; in practice you want 1,000+ for a stable signal.

## References

- [`references/broad-vs-detailed.md`](references/broad-vs-detailed.md) — the case for broad-first; when detailed targeting still wins.
- [`references/lookalike-strategy.md`](references/lookalike-strategy.md) — seed selection, ratio bands, tiered LALs, value-based LALs.
- [`references/retargeting-funnels.md`](references/retargeting-funnels.md) — the layered retargeting playbook with retention-day rules.
- [`references/audience-overlap.md`](references/audience-overlap.md) — detection, the >30% threshold, fixing via exclusions.
- [`references/exclusion-patterns.md`](references/exclusion-patterns.md) — every kind of audience that should be excluded from where.
- [`references/audience-size-sweetspots.md`](references/audience-size-sweetspots.md) — reach ranges by objective and ad set size.
