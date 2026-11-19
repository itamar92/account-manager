## The full diagnostic tree — symptom to action

The SKILL.md ships a 7-row cause→action table. This reference expands each row with detection thresholds, secondary signals, exact MCP queries, and edge cases (lead-gen, awareness, app, retargeting).

Walk the tree top-down. Each row is "if you see X, confirm with Y, fix with Z." Never jump to action without confirming the secondary signal — the surface symptom has multiple causes, and a wrong action costs days of CPA inflation.

## Row 1 — CPM up, CTR up, CVR down

**Thresholds.** CPM ≥ 1.3× trailing 14-day avg. CTR ≥ 1.2× baseline. CVR ≤ 0.5× baseline. The combination is the "wrong people / wrong page" signature, not creative fatigue.

**Secondary signals.** Session recordings show bounce ≥ 75% on paid traffic. GA4 view_item → add_to_cart drops ≥ 60% week-over-week. Mobile-only bounce crater = mobile UX issue.

**MCP queries.**
```
adadvisor:get_timeseries(entity_type='ad', entity_id=<ad_id>, lookback_days=45)
adadvisor:get_performance(level='ad', level_specific_filter=<ad_id>, breakdown='age,gender,country')
```

A "wrong audience" pattern shows CVR cratering for one segment while CTR rises for that segment.

**Action.** Do NOT kill the ad. Fix the funnel: audit LP (mobile-first, page speed ≥ 75), check creative-LP consistency, narrow geo to highest-CVR countries from the breakdown.

## Row 2 — CPM up, CTR down, CVR flat

**Thresholds.** CPM ≥ 1.2× baseline. CTR ≤ 0.8×. CVR 0.85-1.15×. More expensive impressions reaching people who don't engage.

**Secondary signals.** Frequency: prospecting ≥ 3.0, retargeting ≥ 5.0. Net New Reach < 40%. Ad-level CTR decay: first-3-days vs trailing-3-days delta ≥ 25%. Creative age ≥ 14 days.

**MCP query.** `adadvisor:get_timeseries(entity_type='adset', ...)`. If frequency trends up while reach grows linearly, you're hitting the same people more often.

**Action.** Frequency creeping → refresh creative (see `adadvisor-creative`). Audience saturated (< 1M, CPM up everywhere) → expand (see `adadvisor-targeting`). Both → do both. Frequency cap buys 2-3 days but doesn't fix the underlying problem.

## Row 3 — CPM flat, CTR down, CVR flat

**Thresholds.** CPM 0.85-1.15× baseline. CTR ≤ 0.8×. CVR 0.85-1.15×.

**Secondary signals.** Ad-level CTR decay. Quality Ranking "Below Average." Days-since-launch ≥ 10.

**MCP query.** `adadvisor:get_timeseries(entity_type='ad', entity_id=<each ad>, lookback_days=21)`. The ad-level view identifies which specific creative is decaying; ad-set averages mask one ad pulling the rest down.

**Action.** Replace the decaying ad. Don't kill the ad set. Quote Foxwell: "Creative fatigue is the most diagnosable problem in paid social. Frequency tells you it's coming; ad-level CTR decay confirms it."

## Row 4 — CPM up, CTR flat, CVR flat

**Thresholds.** CPM ≥ 1.2× baseline. CTR and CVR within 0.85-1.15×.

**Secondary signals.** Industry CPM trend (Madgicx, Foxwell newsletter). Account's CPM uniform across placements. Calendar — Q4, BFCM, election week, Mother's Day.

**Action.** Hold. Competition or seasonality, not a creative or audience problem. If CAC inflation is intolerable, raise the Bid Cap or temporarily switch to Bid Cap at `target_CPA × 1.20`. Don't kill — you lose learning and CPM normalizes.

## Row 5 — CPM flat, CTR flat, CVR down

**Thresholds.** CPM and CTR within 0.85-1.15×. CVR ≤ 0.7× baseline.

**Secondary signals.** Recent LP deploy. Offer or price change. Sold-out SKU. Pixel-firing-rate drop (`adadvisor:get_pixel_health`).

**Action.** The ads are fine. The offer or page broke. Pull a session recording. If intentional (new pricing/offer), recompute target_CPA. If unintentional (broken checkout, slow LP), fix the page first.

## Row 6 — Quality Ranking "Below Average"

**Detection.** `get_performance` returns `quality_ranking` of `'BELOW_AVERAGE_LOW_10K'` or `'BELOW_AVERAGE_LOWER_20'` — users hide/scroll past your ad more than 70% of peers.

**Secondary signals.** Negative feedback ≥ 0.2%. Engagement and Conversion rankings also "Below Average."

**Action.** Replace the creative. Below-Average compounds — higher CPM, throttled delivery. No tweak recovers an asset-level penalty.

## Row 7 — Spend below daily budget

**Thresholds.** Daily spend < 80% of `daily_budget` for 3+ consecutive days.

**Secondary signals.** `effective_status` includes "Limited" or "Learning Limited." Audience < 1M (prospecting). Bid Cap too low. Optimization event volume < 25/week.

**MCP queries.** `adadvisor:estimate_audience_size(adset_id=<id>)` and `adadvisor:get_pixel_health(...)`.

**Action.** Audience too narrow → expand. Bid Cap too low → raise to `target_CPA × 1.20`. Optimization volume low → shallower funnel event (LANDING_PAGE_VIEWS). Learning capped → see `learning-phase.md`.

## Edge case — Lead-gen (OUTCOME_LEADS)

ROAS is meaningless. Use **CPL vs target_CPL**.

- Detection threshold for "spend up, results down": CPL ≥ 1.3× target.
- Skip the CVR row — your funnel ends at form-submit; you have no purchase event.
- Add a row: **lead quality drop**. Symptoms — CPL flat, lead-to-customer rate from CRM dropping. Cause — form is too easy to spam-submit. Action — add 2-3 qualifying fields beyond email (covered in the `adadvisor-launch` skill's `references/lead-gen-flow.md`).
- Don't compare CPL to industry benchmarks blindly. Insurance CPL (~$45) and B2B SaaS CPL ($200-400) live on different planets.

## Edge case — Awareness (OUTCOME_AWARENESS)

CPM is the only number that matters. Ignore CTR, CVR, ROAS. The tree collapses to one row:

- CPM ≥ 1.5× baseline → audience too narrow OR placement competition. Loosen audience or accept the rate.
- CPM ≤ 0.7× baseline → audience too broad / wrong people. Tighten.

Reach efficiency = unique reach / spend. Track week-over-week.

## Edge case — App Promotion (OUTCOME_APP_PROMOTION, iOS)

SKAdNetwork attribution lag is 24-72 hours. **Do not diagnose on day-of-spend data.** Pull `get_timeseries(lookback_days=14)` and trim the most recent 2-3 days from the analysis. Action thresholds should use the 4-14-day window.

- iOS conversion data is bucketed (SKAN postback values). You won't see per-user revenue — use `cost_per_install` and post-install event rate from your in-app SDK (AppsFlyer / Adjust), not Meta's `roas`.
- Android attribution behaves more like web — closer to the canonical tree.

## Edge case — Retargeting

Frequency tolerance is higher. The "frequency > 5 = kill" rule applies to prospecting; retargeting routinely runs at frequency 6-10.

- Kill threshold for retargeting: frequency > 10 AND CTR declining AND CPA above target.
- CPM is expected to be higher (smaller audience, repeated bid).
- The diagnostic move when retargeting CPA inflates: refresh creative (you've shown the same offer 10x), not expand audience (the audience IS the asset).

## Reading the tree as language

When the user asks "why is my CPA up," do not answer with a row from the tree. Walk them through it:

> "CPM is up 35% vs your 14-day average — that's outside the noise band. CTR is also down 18%. That puts you in row 2: creative fatigue or audience saturation. Frequency is at 3.4 on a 600K audience. That's the fatigue+saturation combination. Recommend: refresh the top 2 ads AND expand the lookalike from 1% to 3%."

The diagnostic is more useful as a sentence than as a verdict.

## See also

- [`./kill-rules.md`](./kill-rules.md) — once the tree points at "kill," the unsentimental thresholds.
- [`./benchmarks.md`](./benchmarks.md) — what "baseline" looks like by vertical.
- [`./learning-phase.md`](./learning-phase.md) — the tree is invalid for entities in learning.
- [`./attribution-windows.md`](./attribution-windows.md) — why Meta's CVR may disagree with Shopify's.
