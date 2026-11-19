## Audit checklist — paste into your response and tick as you go

Copy this checklist into your reply at the start of the audit. Tick each box `- [x]` only when you've actually executed the call and inspected the result — not when you've decided you "will." Skipped items get a strikethrough with a reason.

The audit is **diagnostic only**. No mutations until the user signs off on a fix plan. See [`report-template.md`](report-template.md) for the final output format.

## Phase 0 — Foundation

- [ ] Called `adadvisor:list_ad_accounts` and identified the target account.
- [ ] Confirmed `data_synced: true` on the target account.
- [ ] Read `adadvisor://account/{ad_account_id}/context` and noted `break_even_roas`, `average_order_value`, `target_cpl`, `daily_budget_cap`.
- [ ] Captured `business.business_name`, `business.storefront_url`, and `research.business_details` (industry, AOV bucket, tone, target audience).
- [ ] Noted account `currency` and `timezone` for all subsequent numbers.

If any Phase 0 box can't be ticked, **stop**. The downstream analysis is ungrounded without business context.

## Phase 1 — Signal integrity

```
adadvisor:get_pixel_health(account_id=...)
```

- [ ] Pixel count: 1 healthy, 2-3 with clear separation OK, >3 or 0 is RED.
- [ ] `last_fired_time` < 1 hour on the primary pixel (under 24h yellow, over 24h or null RED).
- [ ] `enable_automatic_matching: true` on the primary pixel.
- [ ] `automatic_matching_fields` count ≥ 6 (em, fn, ln, ph, ge, ct, st, zp, country, external_id are the 10 standard fields — score 8+ healthy).
- [ ] BROWSER : SERVER event ratio noted. Server-side ≥ 20% of total is healthy; 5-19% yellow; 0% RED (CAPI missing).
- [ ] Top pixel host(s) match `business.storefront_url`. Mismatch = pixel firing on wrong domain or stale install.
- [ ] Event counts by type: Purchase / AddToCart / ViewContent / Lead all present (volumes vary by business).
- [ ] Deduplication key present (browser + server events share `event_id`) — implied by parallel host counts on Purchase event; absence shows as 2× inflation.
- [ ] AEM (Aggregated Event Measurement) priority ordering — Purchase = position 1 for ecom, primary lead event = position 1 for lead-gen.

If pixel issues surface here, the audit pauses on the user's call. Performance numbers downstream are unreliable to the extent the pixel is broken. See [`pixel-deep-dive.md`](pixel-deep-dive.md) for remediation.

## Phase 2 — Structure

```
adadvisor:list_campaigns(account_id=..., limit=200)
adadvisor:list_adsets(campaign_id=..., limit=200)   # per active campaign
adadvisor:list_ads(adset_id=..., limit=200)         # per active ad set worth inspecting
```

- [ ] Total active campaigns counted. 3-10 healthy, 10-20 yellow, > 20 RED (consolidation needed).
- [ ] Active ad sets per campaign noted. 1-3 prospecting / 1-2 retargeting healthy; 4-6 yellow; ≥ 7 RED.
- [ ] Ads per active ad set noted. 3-6 distinct creative concepts healthy; 1-2 starved-of-rotation; >10 cannibalizing.
- [ ] Naming convention assessed. Consistent prefix (e.g. `WSO ||`, `ADADVISOR ||`, `MCP ||`) healthy. Mixed prefixes yellow. No pattern RED (no way to grep / report).
- [ ] CBO vs ABO mix. CBO appropriate for scale + multiple comparable ad sets; ABO appropriate for testing + isolated learning. Every-campaign-CBO with low budget = anti-pattern.
- [ ] Advantage+ Sales Campaigns (ASC) presence noted. Healthy: 1-2 ASCs alongside manual prospecting with exclusions. RED: ASC and manual competing for same audience with no exclusions.
- [ ] Budget-vs-learning threshold per active ad set computed: `target_CPA × 50 / 7`. Under-budgeted ad sets enumerated.
- [ ] Naming flagged for missing required parts (objective, funnel stage, audience type, geography).
- [ ] Special ad categories (`HOUSING`, `EMPLOYMENT`, `CREDIT` → `FINANCIAL_PRODUCTS_SERVICES`, `ISSUES_ELECTIONS_POLITICS`) verified — if applicable to the business and missing, that's a policy risk.

See [`structure-rules.md`](structure-rules.md) for vertical-specific structure expectations.

## Phase 3 — Performance baseline

```
adadvisor:get_performance(account_id=..., level='campaign', response_format='full')         # default 45d
adadvisor:get_performance(account_id=..., level='campaign', date_from='today-7d', date_to='yesterday')
adadvisor:get_performance(account_id=..., level='campaign', date_from='today-28d', date_to='yesterday')
```

- [ ] 45-day account-level performance pulled. Total spend, blended ROAS / CPL, total `result_count` noted.
- [ ] 7-day window pulled for "what's happening now."
- [ ] 28-day window pulled for trend.
- [ ] For each active campaign: `conversion_result_name` identified; `result_count` and `cost_per_result` recorded; legacy `purchases` / `revenue` cross-referenced only when `conversion_result_name = "Purchase"`.
- [ ] `has_multiple_conversions` flag checked. If true on any campaign, `kpi_breakdown` inspected per-KPI rather than summed.
- [ ] Each campaign scored against business break-even:
  - Profitable: ROAS ≥ break-even × 1.3 (or `cost_per_result` ≤ target_CPL × 0.8 for lead-gen)
  - Marginal: 0.8× to 1.3× break-even
  - Bleeding: < 0.8× break-even
- [ ] For active ad sets in marginal/bleeding campaigns: `adadvisor:get_timeseries(entity_type='adset', entity_id=...)` pulled to spot CPM creep, CTR decline, frequency rise.
- [ ] Modeled-conversion reliance assessed — if iOS / Safari traffic is high in the breakdown, modeled-vs-deterministic gap flagged.
- [ ] If user has a backend source of truth (Shopify, Stripe, CRM), Meta-reported revenue / leads cross-referenced. 0.4-0.8 ratio normal; > 1.0 dedup bug; < 0.3 broken tracking.

## Phase 4 — Red flag scan

Run the [`red-flags.md`](red-flags.md) pattern list against everything gathered so far. Tick each pattern as checked, regardless of whether it triggered:

- [ ] Undersized winning ad sets (ROAS > 1.3× break-even AND daily_budget under the learning threshold).
- [ ] High frequency on small audience (frequency > 3 on audience < 1M).
- [ ] All-spend-to-one-ad concentration (>70% of campaign spend on one ad in a multi-ad set).
- [ ] Negative feedback rate ≥ 0.1% on any ad.
- [ ] Retargeting without purchaser exclusion.
- [ ] Wrong optimization event (e.g. LANDING_PAGE_VIEWS on OUTCOME_SALES).
- [ ] Pixel fired > 24h ago (already caught in Phase 1; re-flag here for the report).
- [ ] Manual-placement restriction (`publisher_platforms` or `facebook_positions` narrowed without rationale).
- [ ] ASC + manual prospecting same audience.
- [ ] Naming-convention drift across recently-created entities.
- [ ] Dead campaigns spending (objective mismatch, lifetime budget exhausted but daily-budget shadow still active).
- [ ] EU campaigns missing DSA fields (`dsa_beneficiary` and `dsa_payor`).
- [ ] Modeled-conversion reliance > 30% (where iOS share is high and conversion lift suspicious).
- [ ] Attribution-window mismatch (different windows across campaigns producing inconsistent ROAS).
- [ ] Learning-limited ad sets (status `LEARNING_LIMITED` or implied by `result_count < 50` over 7 days).
- [ ] Restricted placements via `publisher_platforms = ['facebook']` only (excluding Instagram + Audience Network leaves 40-60% reach on the table).
- [ ] All-spend-to-one-creative within a single creative test (defeats the test).
- [ ] Dynamic Product Ads (DPA) without catalog feed health check.

## Phase 5 — Composing the report

- [ ] TL;DR drafted (status GREEN / YELLOW / RED, count of critical issues, top 3 fixes).
- [ ] Phase 1 signal-integrity summary with healthy / yellow / red rating per dimension.
- [ ] Phase 2 structure summary with counts and consolidation status.
- [ ] Phase 3 performance summary with date range, totals, profitable / marginal / bleeding lists, each with specific campaign names.
- [ ] Phase 4 red-flag list ranked by impact × reversibility, each with the exact MCP fix call (don't execute yet).
- [ ] Closing prompt: "Want me to act on any of these? I can pause the bleeding campaigns, scale the winners, or open `adadvisor-diagnose` on a specific issue."

## Time budget

A full audit on a 5-10 active-campaign account: 8-12 minutes of MCP calls and synthesis. If you're past 15 minutes without a report drafted, you're going too deep — pull back to the report and offer to drill into specific issues from `adadvisor-diagnose`.

## What "skipped" looks like

If a check is intentionally skipped (e.g. user explicitly said "don't audit the pixel"), write:

`- [~] Pixel health — skipped per user request, performance numbers reported as-is.`

Tilde, not check. Don't leave un-ticked boxes in the final report — that signals incompleteness without explaining why.
