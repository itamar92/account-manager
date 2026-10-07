---
name: adadvisor-audit
description: |
  Full Meta ad account audit — pixel/measurement integrity, account structure, performance baseline, and red-flag detection — the workflow a senior media buyer runs on day one of a takeover. Use when: "audit my account", "audit this account", "take over this account", "review my ads", "what's wrong with my account", "give me an overview", "is my account healthy", "I just inherited an account", "what's broken", "scan my ads", "review for me". Chain with: adadvisor (always — data limits and show economics); adadvisor-diagnose when the audit surfaces specific performance issues; adadvisor-pixel for deep pixel/CAPI/EMQ remediation. NOT for: ongoing daily checks (just call get_performance with 7d window directly); single-campaign deep-dives (use adadvisor-diagnose); creative refresh decisions (use adadvisor-creative).
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
> **For this skill:** the pixel, structure and creative checks need ad-set / ad / pixel data that is not available — mark them *not checked* and give the user the Ads Manager steps to check them. What *can* be audited from data: spend by show vs the band's median cost per ticket, unmapped spend, campaigns still spending after their show, spend timing against the show date (daily curve), objective-vs-judgement mismatches, and frequency (lifetime) per campaign. Say up front that this is a **partial audit** and list what was not covered.

# AdAdvisor — Full Account Audit

The audit is the first thing a senior media buyer does on a new account. The order matters: **measurement → structure → performance → red flags**. Every performance interpretation is meaningless until you trust the data, and every recommendation is biased until you understand the structure that produced the results.

This skill orchestrates the audit. The output is a structured report with prioritized findings the user can act on.

## When to use

- The user wants a full overview of an account they don't know well.
- The user is taking over an account (agency, new hire, freelancer onboarding).
- The user senses something is off but can't articulate what.
- After 30+ days of running, as a quarterly health check.

## Pre-audit: foundation

Confirm `adadvisor` foundation steps are done — `list_ad_accounts` → check `data_synced` → read `adadvisor://account/{id}/context` → pixel sanity check. If any of those failed, the audit is paused until they pass.

## Audit workflow

### Step 1 — Signal integrity (the half-day that saves the quarter)

Trust nothing about performance until measurement is sound. Call:

- `adadvisor:get_pixel_health(account_id)` — returns `pixel_count`, per-pixel `last_fired_time`, automatic-matching fields, source breakdown (BROWSER vs SERVER), event counts by type, host coverage.

Flag the following:

| Signal | Healthy | Yellow | Red |
|---|---|---|---|
| Number of pixels | 1 per business | 2-3 with clear separation | >3 or none |
| `last_fired_time` | <1 hour ago | <24 hours ago | >24 hours ago, or null |
| Server-side events (CAPI) | 20%+ of total | 5-19% | 0% |
| `automatic_matching_fields` count | ≥6 | 4-5 | <4 |
| Top host has `_fbp` cookie traffic | yes | uncertain | no |
| Hosts list matches `storefront_url` from context | yes | partial | mismatched |

For a real example, an account with `enable_automatic_matching: true` and 9 fields including `em, fn, ln, ge, ph, ct, st, zp, db, country, external_id`, BROWSER:SERVER ratio of 6190:178, top host `adadvisor.ai` matching the storefront — that's healthy and the audit can proceed. An account with `automatic_matching_fields: ["em"]` and 0 server events is the *first* problem to surface, before touching performance.

Output to the user: a pixel health summary with healthy / yellow / red rating per dimension.

### Step 2 — Account structure

Call `adadvisor:list_campaigns(account_id)` to get the full campaign roster (use `limit=200`; paginate if `has_more`). For each active campaign also pull `adadvisor:list_adsets(campaign_id=...)`.

Score:

| Dimension | Healthy | Yellow | Red |
|---|---|---|---|
| Active campaigns | 3-10 | 10-20 | >20 (consolidation needed) |
| Ad sets per campaign | 1-3 prospecting, 1-2 retargeting | 4-6 | ≥7 (each starved of conversions) |
| Daily budget per ad set | ≥(target_CPA × 50 / 7) — the "exit learning" threshold | within 50% of threshold | <50% of threshold |
| Naming convention | consistent prefix (e.g. `ADADVISOR ||`, `WSO ||`) | mixed but readable | ad-hoc / no pattern |
| CBO vs ABO mix | matches strategy (CBO at scale, ABO for testing) | mixed without rationale | every campaign CBO with low budget |
| Advantage+ Sales Campaigns (ASC) | 1-2 ASCs alongside manual | ASC without exclusions on manual | competing ASC + manual targeting same audience |

The "starved ad sets" check is the most common red flag. Compute: `target_CPA` from `business.target_cpl` or AOV / 3 if no target. If a healthy ad-set budget is `target_CPA × 50 / 7`, anything significantly under that is in permanent learning. Surface every undersized active ad set.

### Step 3 — Performance baseline

Call `adadvisor:get_performance(account_id, level='campaign', response_format='full')` with no date overrides (defaults to last 45 days). Cross-check with shorter windows:

- 7-day: `date_from = today - 7d, date_to = yesterday`
- 14-day: `date_from = today - 14d, date_to = yesterday`
- 28-day: `date_from = today - 28d, date_to = yesterday`

For each campaign compute against `business.break_even_roas`:

- **Profitable**: ROAS ≥ break-even × 1.3 (or `cost_per_result` ≤ target_CPL × 0.8 for lead-gen).
- **Marginal**: 0.8× to 1.3× break-even.
- **Bleeding**: <0.8× break-even.

**Critical**: use `result_count` / `cost_per_result` / `conversion_result_name`, NOT legacy `purchases` / `revenue`. From the foundation skill — Subscribe / Lead / custom-conversion campaigns will report `revenue: 0` even when performing well.

For each ad set in active campaigns, also pull `adadvisor:get_timeseries(entity_type='adset', entity_id=...)` to spot trends: rising CPM, declining CTR, frequency creep.

### Step 4 — Red flag scan

Apply these checks across the data you've gathered:

| Red flag | How to detect | Action |
|---|---|---|
| Winning ad set capped at low budget | ROAS > 1.3× break-even AND daily_budget < $100 | Recommend 20% scale via `change_entity_budget` |
| High frequency on small audience | Frequency > 3 AND audience_size < 1M (from `estimate_audience_size`) | Either expand audience or refresh creative |
| All spend going to 1 ad | Top ad has >70% of campaign spend with 7+ ads in same set | Creative concentration — pause the others or split into two ad sets |
| Negative feedback rate ≥0.1% | From the ad-level performance data | Pull the ad, replace creative |
| Active retargeting with no exclusion of purchasers | Retargeting custom audience does not appear in `excluded_custom_audiences` of any other ad set targeting purchasers | Add the exclusion |
| Wrong optimization event | `optimization_goal` doesn't match the campaign's `objective` (e.g. LANDING_PAGE_VIEWS for OUTCOME_SALES) | Recommend re-creating with correct goal |
| Pixel last fired >24h ago | From `get_pixel_health` | Highest-priority alert; tracking is broken |
| Manual placements restricted | Look at any ad set's `targeting.publisher_platforms` or `targeting.facebook_positions` — if narrowed | Recommend opening to Advantage+ Placements |
| ASC + manual prospecting same audience | ASC exists AND manual campaign with same audience in `custom_audiences` and not in `excluded_custom_audiences` | Add exclusion or kill duplication |

### Step 5 — Output the report

Structure as:

```
# Account audit: {business_name}

## TL;DR
- Status: {GREEN | YELLOW | RED}
- Critical issues: {N}
- Recommended fixes (in priority order): {first 3}

## Signal integrity
- Pixel health: {summary}
- Event Match Quality: {assessment}

## Structure
- Active campaigns / ad sets / ads: {counts}
- Consolidation status: {OK | needs consolidation}

## Performance ({date range})
- Total spend / ROAS / break-even gap: {numbers}
- Profitable campaigns: {names}
- Bleeding campaigns: {names + reasons}
- Marginal campaigns: {names + watch-conditions}

## Red flags
1. {ranked list with the exact fix}
```

End with: "Want me to act on any of these? I can pause the bleeding campaigns, scale the winners, or open `adadvisor-diagnose` for a deep dive on a specific issue."

## Decision rules

- **Always read the context resource before scoring performance.** Generic "good ROAS" is not actionable — score against business break-even.
- **Never recommend a mutation in the audit report.** The audit's job is diagnosis; mutations come after the user signs off. Use phrases like "I recommend X" not "I will do X".
- **Always cite specifics.** "Frequency is 4.7 on `WSO || TEST 5 || Subscribe || India` (audience 350K)" beats "frequency seems high somewhere."
- **Prioritize by impact × reversibility.** Pixel issues are highest priority (blocks everything downstream). Budget reallocation is high impact, easily reversible. Creative refresh is high impact, irreversible (creative production takes days).
- **Don't propose more than ~5 fixes.** A 30-item punch list overwhelms; pick the top 5 by impact.

## Anti-patterns

- ❌ Running the audit on `data_synced: false` accounts — performance will be wrong. ✅ Tell the user, wait.
- ❌ Reporting frequency without audience size — frequency 3 on 50M is fine, frequency 3 on 100K is fatigue.
- ❌ Using one date window. ✅ 7d for "what's happening now", 14d for decisions, 28-90d for trends.
- ❌ Treating ASC as manual. ✅ ASC has different optimization, learning, and reporting — note it separately.
- ❌ Recommending kills on 1-day data. ✅ Use the 3× target CPA / zero conversions rule from `adadvisor-diagnose`.
- ❌ Skipping the pixel check because performance looks fine. ✅ A broken pixel with modeled conversions can look fine for weeks before crashing.

## References

- [`references/audit-checklist.md`](references/audit-checklist.md) — a literal checkbox list the agent can copy into its response and tick off as it works.
- [`references/red-flags.md`](references/red-flags.md) — exhaustive list of patterns with detection logic + fix.
- [`references/pixel-deep-dive.md`](references/pixel-deep-dive.md) — EMQ, CAPI, AEM priority, dedup; what to test if Step 1 surfaces issues.
- [`references/structure-rules.md`](references/structure-rules.md) — 2026 Meta-recommended structure for DTC ecom, lead-gen, B2B, app promotion.
- [`references/report-template.md`](references/report-template.md) — exact format for the audit output, with examples.
