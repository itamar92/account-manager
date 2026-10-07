## The Target ROAS method (Faris)

> "70% of the money I spend on Meta Ads for my clients is on Target ROAS campaigns. Most accounts I see spend 0% of their money there." — Andrew Faris, AJF Growth.

Target ROAS — `LOWEST_COST_WITH_MIN_ROAS` in Meta's bidding enum — is the underutilized counterpart to bid caps. Where Bid Cap polices CPA at the bid level, Target ROAS polices revenue-per-dollar at the value level. Faris's thesis: once you have value tracking and a stable winner, Target ROAS is the scaling layer with the highest leverage in the modern Meta bidding system.

## When to use

| Condition | Why it matters |
|---|---|
| Value events are firing on pixel + CAPI | The bid strategy optimizes against `result_value`. No values, no signal. |
| Winner has been stable ≥7 days | The ROAS floor is anchored on real history, not a wishful number. |
| ≥50 value-tracked conversions in the last 7 days | Below this, the floor will starve the ad set. |
| You want stability over volume | Target ROAS smooths spend toward profitable impressions; it does not maximize reach. |
| Lowest Cost is fully exploited | Target ROAS layers on top; it doesn't replace Lowest Cost on day 1. |

If value tracking isn't wired (server-side CAPI sending purchase value, pixel firing purchase value), defer entirely. Use Bid Cap or stay on Lowest Cost. See [`bid-cap-method.md`](bid-cap-method.md).

## The sequence

```
1. Confirm value tracking.
   adadvisor:get_pixel_health
     → look for recent Purchase events with non-zero values; check CAPI deduplication.

2. Duplicate the winner (preserves audience, creative, placements).
   adadvisor:duplicate_adset(adset_id=<winner>, deep_copy=True)
     → new_adset_id, status='PAUSED'

3. Switch the bid strategy to LOWEST_COST_WITH_MIN_ROAS and the optimization goal to VALUE.
   adadvisor:update_entity(
     entity_type='adset',
     entity_id=<new_adset_id>,
     fields={
       'bid_strategy': 'LOWEST_COST_WITH_MIN_ROAS',
       'optimization_goal': 'VALUE',
       'roas_average_floor': <target_ROAS_multiplier>  # e.g. 1.5 for $1.50 back per $1
     }
   )

4. Resume and watch.
   adadvisor:change_entity_status(entity_type='adset', entity_id=<new>, action='resume')
     → 3-5 day softness window; do not panic-kill.
```

The MCP's AdSet schema requires `optimization_goal: 'VALUE'` whenever `bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS'` is set. Setting one without the other will reject. The `roas_average_floor` is a decimal multiplier (1.5 = 150% return, not 15.0 or 150).

## Setting the floor

The floor anchors what spend ladders to. Set it too high and the ad set won't spend; set it too low and you've added a bidding strategy without enforcing discipline.

| Starting condition | Initial floor |
|---|---|
| Winner running at 4.0× ROAS | Set floor to 0.75 × current ROAS = **3.0** |
| Winner running at 2.5× ROAS, target is 2.0× | Set floor to **1.8** (slightly below target — Meta needs headroom) |
| Subscription / value-based — strong AOV variance | Floor at 0.7 × historical ROAS to avoid starvation |

The pattern: floor at **0.7 to 0.8 × current ROAS**. Meta needs room to underperform on some impressions to land on the right average. A floor set at current ROAS itself almost always causes the ad set to under-deliver.

## The kill signal — spend drops below 75% of daily budget

The single clearest signal that the floor is too high:

```
if (daily_spend / daily_budget) < 0.75 over 3 consecutive days:
    lower roas_average_floor by 0.2× and re-check
```

When Target ROAS can't find enough impressions priced above the floor, it simply doesn't spend. The user sees a budget set at $500/day with $300/day delivered — Meta's way of saying "your floor is unrealistic given the auction conditions."

Drop the floor by 0.2× and give it another 3 days. Repeat until spend stabilizes at >85% of budget. The resulting floor is your real ROAS ceiling for this audience/creative pair.

## Faris's portfolio framing

In Faris's accounts, the split looks roughly like:

| Layer | % of spend | Bid strategy |
|---|---|---|
| Discovery / new winners | ~10% | Lowest Cost |
| Workhorse Target ROAS portfolio | ~70% | LOWEST_COST_WITH_MIN_ROAS at varied floors |
| Bid Cap on specific volume-sensitive ad sets | ~10% | LOWEST_COST_WITH_BID_CAP |
| Brand / retargeting | ~10% | Mixed |

The 70% Target ROAS slice is itself a ladder — multiple ad sets at floor 1.5, 2.0, 2.5, 3.0 — each catching the impressions that meet its bar. The cumulative effect: account-level ROAS lands at the weighted mean of the floors, with much less spend volatility than a pure Lowest Cost setup at the same total budget.

## Worked example — apparel DTC, $80 AOV, 50% margin, target ROAS 2.5×

Current winner (Lowest Cost, 7-day data):
- Spend $1,800 / revenue $5,400 / ROAS 3.0× / 67 purchases / pixel + CAPI firing values cleanly ✅

Target ROAS layer:

```
adadvisor:duplicate_adset(adset_id='winner_017', deep_copy=True)
  → new_017

adadvisor:update_entity(
  entity_type='adset',
  entity_id='new_017',
  fields={
    'bid_strategy': 'LOWEST_COST_WITH_MIN_ROAS',
    'optimization_goal': 'VALUE',
    'roas_average_floor': 2.3   # 0.77 × current 3.0× — leaves headroom
  }
)

adadvisor:change_entity_budget(entity_id='new_017', daily_budget=300)
adadvisor:change_entity_status(entity_type='adset', entity_id='new_017', action='resume')
```

Day 3 check: spend $200/day on a $300 budget (66%). Floor too high.

```
adadvisor:update_entity(
  entity_type='adset', entity_id='new_017',
  fields={'roas_average_floor': 2.1}
)
```

Day 6 check: spend $270/day on $300 budget (90%), ROAS 2.6×. Settled. The new ad set is the Target ROAS rung; the source Lowest Cost stays running in parallel.

## Pixel/CAPI requirement — the hidden blocker

> "If your value events aren't firing, no amount of clever bidding fixes that. Target ROAS amplifies your data quality." — Faris

The most common failure mode is invisible: pixel reports the Purchase event but `value` is null or zero. Meta then treats every conversion as $0 revenue, which means the floor immediately fails (every conversion's value/cost ratio is zero). Symptom: the ad set spends $0.

Diagnostic via MCP:

```
adadvisor:get_pixel_health(account_id=...)
  → look at the Purchase event row: it should show recent counts AND non-zero average value.
  → If average value is $0 with non-zero counts, CAPI/pixel is sending events without the
    `value` and `currency` parameters. The Target ROAS layer cannot work until that's fixed.
```

Wire value events first, validate with 24-48 hours of clean data, then deploy the Target ROAS layer.

## Anti-patterns

- Setting `roas_average_floor` to a percentage (250 for 2.5×). The schema is a decimal.
- Switching to `bid_strategy='LOWEST_COST_WITH_MIN_ROAS'` without `optimization_goal='VALUE'`. The schema rejects.
- Setting the floor at or above current ROAS. Guaranteed under-spend.
- Killing after 24 hours of soft delivery. Target ROAS needs 3-5 days of recalibration before the kill rule applies.
- Deploying Target ROAS on lead-gen / non-value-tracked campaigns. Use Bid Cap or Cost Cap on CPA instead.

## Cross-references

- [`bid-cap-method.md`](bid-cap-method.md) — the CPA-discipline counterpart.
- [`scaling-axes.md`](scaling-axes.md) — when to pick bid strategy as the scaling axis.
- [`stage-plan-1k-to-10k.md`](stage-plan-1k-to-10k.md) — Target ROAS enters in Stage 3.
- Foundation skill `adadvisor` (economics reference) — break-even ROAS, target ROAS math.
- Foundation skill `adadvisor` (kpi-decoder reference) — `result_value` vs `revenue` fields.
