## The bid-cap method (Tichenor)

Ralph Burns and Dara Denney popularized the concept; Charley Tichenor codified the operational sequence: validate on Lowest Cost, duplicate with a bid cap at `target_CPA × 1.20`, ladder upward, build a portfolio. This is the method to use when an account needs CPA discipline at scale.

## Prerequisites

Bid caps fail without volume. Meta's bidding system needs enough auction signal to find winning bids under the cap; thin data means the ad set under-spends or doesn't deliver at all.

| Prerequisite | Why | How to verify |
|---|---|---|
| ≥50 conversions in the last 7 days on the source ad set | Below this, Meta is still learning — capping noise produces noise | `adadvisor:get_performance` or `adadvisor:get_timeseries` |
| Post learning phase (no `learning_phase` flag) | A capped ad set in learning is double-throttled | Inspect the source ad set's delivery insights |
| Stable CPA across 3+ consecutive days within target × 1.2 | The cap is anchored on a real target, not a hopeful one | `adadvisor:get_timeseries` |
| Pixel + value tracking healthy | Bid caps care about cost per *result*; rotten data = rotten cap | `adadvisor:get_pixel_health` |
| Sufficient daily budget headroom | A $30/day cap-ad-set will starve | `business.daily_budget_cap` on context resource |

If any fail, defer the bid-cap layer. Hold on Lowest Cost; revisit when volume justifies it.

## The cap formula

```
bid_cap = target_CPA × 1.20
```

The 20% buffer matters. Meta interprets the cap as "do not bid above this for any single impression"; a cap set exactly at target_CPA prevents Meta from ever winning the impressions that average down toward target. The 1.20 multiplier lets the algorithm catch enough above-target impressions to balance the below-target ones, producing a mean that lands near target.

Worked example — target CPA $30:

- Cap = $30 × 1.20 = **$36**.
- Meta will bid $0 to $36 per result; mean settles near $28-$32 depending on auction conditions.
- Setting cap = $30 typically means the ad set fails to spend.
- Setting cap = $60 defeats the point — too loose to enforce discipline.

## The sequence

The Tichenor pattern in five steps:

```
1. Validate on Lowest Cost.
   adadvisor:get_performance → confirm winner ROAS, conversions, CPA stability.

2. Duplicate the proven ad set, preserving creative.
   adadvisor:duplicate_adset(adset_id=<winner>, deep_copy=True)
   → returns new adset_id, status='PAUSED'.

3. Apply the bid cap.
   adadvisor:update_entity(
     entity_type='adset',
     entity_id=<new_adset_id>,
     fields={
       'bid_strategy': 'LOWEST_COST_WITH_BID_CAP',
       'bid_amount': <target_CPA × 1.20>
     }
   )

4. Resume.
   adadvisor:change_entity_status(entity_type='adset', entity_id=<new>, action='resume')
   → wait 3-5 days; expect softness during the new learning phase.

5. Ladder. If stable, duplicate again at a higher cap.
   adadvisor:duplicate_adset → adadvisor:update_entity with bid_amount = previous × 1.10-1.15.
```

Each rung in the ladder is a new ad set with a slightly higher cap, finding its own price point in the auction. Stop when adding a higher-cap rung doesn't add net conversions — that's the audience's true headroom.

## Portfolio construction

The point of laddering isn't a single bid-capped ad set. It's a portfolio:

| Tier | Cap | Role |
|---|---|---|
| Anchor | `target × 1.10` | Below-target conversions, low volume |
| Core | `target × 1.20` | Workhorse — most spend lands here |
| Stretch | `target × 1.35` | Above-target conversions; only catches the high-value moments |
| Lowest Cost (untouched) | n/a | Volume engine; capped tier siphons the cheap ones, this fills the rest |

This produces a barbell — disciplined CPA at the core, opportunistic top-up at the stretch. Net account CPA usually lands within 5% of target while spending 20-40% more than a pure Lowest Cost setup could safely scale to.

## The "max 20% of budget on cost caps" rule

> "Don't put more than 20% of your account on cost caps. Bid caps are governors, not engines. Lowest Cost is still the engine." — Tichenor, paraphrased from his 2024 podcast appearances.

Why: bid caps under-deliver by design. If 80% of your account is capped, you're capping 80% of your potential reach. The cap-ad-set portfolio's job is to set a CPA floor (in the directional sense — "we won't pay more than this") while the bulk of the account remains on Lowest Cost.

For a $5K/day account, that means roughly $1K/day across all capped ad sets combined.

## Real example — apparel DTC, target CPA $25

Source ad set (Lowest Cost):
- 7-day spend: $1,400 / 65 conversions / $21.5 CPA / 4.6× ROAS
- Conversion count >50 ✅; CPA stable ≤target × 1.2 ✅; post learning ✅

Action — build a 3-rung bid-cap ladder:

```
Rung 1 (Anchor): cap = $25 × 1.10 = $27.50
  adadvisor:duplicate_adset(adset_id='src_001', deep_copy=True)
    → new_001
  adadvisor:update_entity(entity_type='adset', entity_id='new_001',
    fields={'bid_strategy': 'LOWEST_COST_WITH_BID_CAP', 'bid_amount': 27.50})
  adadvisor:change_entity_budget(entity_id='new_001', daily_budget=100)

Rung 2 (Core): cap = $25 × 1.20 = $30.00
  → new_002 with bid_amount=30.00, daily_budget=200

Rung 3 (Stretch): cap = $25 × 1.35 = $33.75
  → new_003 with bid_amount=33.75, daily_budget=100
```

Total cap-ad-set spend: $400/day. Source Lowest Cost remains at original budget. Re-evaluate in 5-7 days; expect rung 2 to do the most volume, rung 1 to deliver lowest CPA, rung 3 to fill incremental top-of-target conversions.

## What to watch in the next 3-7 days

- **Under-delivery on a rung.** Cap too tight. Either raise it 10% or kill that rung and rebalance.
- **Convergence on one rung.** Meta is finding most of its budget on a single cap level. Compress the ladder around that level.
- **All rungs deliver but composite CPA exceeds target.** Cap was anchored too high (target was aspirational, not real). Recalibrate target_CPA from actual data and rebuild.
- **Cap-ad-sets cannibalize the source Lowest Cost.** Spend on the source drops by >25% in the first week. Expected to some degree; if it exceeds 40%, throttle a stretch rung.

## Anti-patterns

- Setting `bid_amount` in minor units (e.g. 3000 instead of 30.00). The MCP expects major units in account currency.
- Applying the bid cap directly to the source winner instead of duplicating. You lose the unconstrained control if it goes wrong.
- Building a 5-rung ladder on a $500/day account. Insufficient budget per rung — each one starves.
- Ladder rungs with budgets all equal. The core rung should hold the most budget; anchor and stretch should be lighter.
- Skipping the daily-budget assignment on the duplicate. The new ad set inherits the source's budget unless you explicitly reset it.

## Cross-references

- [`scaling-axes.md`](scaling-axes.md) — when bid strategy is the right axis to move on.
- [`target-roas-method.md`](target-roas-method.md) — the alternative when value tracking is wired.
- [`the-20-percent-rule.md`](the-20-percent-rule.md) — interaction with vertical scaling.
- [`stage-plan-1k-to-10k.md`](stage-plan-1k-to-10k.md) — where bid caps slot into the stage plan.
