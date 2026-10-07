---
name: adadvisor-scale
description: |
  Scale proven Meta ad winners — vertical (raise budget) and horizontal (duplicate to new audiences) — without resetting learning or running into spend ceilings. Encodes the 20% rule, the bid-cap escalation method (Tichenor), and the target-ROAS portfolio strategy (Faris). Use when: "scale", "scale this campaign", "scale this winner", "increase budget", "give it more budget", "ramp up", "grow spend", "expand", "raise budget", "duplicate to new audience", "more reach", "what should I do with this winner". Chain with: adadvisor (always — break-even ROAS, target CPA); adadvisor-diagnose to confirm scale-eligible (3+ stable days above target); adadvisor-creative when scaling is creative-bound; adadvisor-targeting for horizontal-scale audience picks. NOT for: testing new things (use adadvisor-launch); diagnosing why scaling failed (use adadvisor-diagnose).
license: Apache-2.0
version: 0.1.0
---

# AdAdvisor — Scaling Proven Winners

Scaling is the most-talked-about and least-understood part of Meta ads. The mistake everyone makes: scale fast, reset learning, watch CPA spike, panic, kill the winner. This skill prevents that.

## When to use

The user has identified a campaign or ad set that's performing above target and wants to grow spend on it. Confirm scale-eligibility first; route to `adadvisor-diagnose` if not.

## Scale-eligibility check

Before scaling anything, verify:

1. **ROAS ≥ target × 1.2 for 3+ consecutive days** (from `adadvisor:get_timeseries`). Single-day spikes are noise.
2. **New-customer rate stable.** A "scaling winner" that's actually retargeting existing customers won't survive vertical scale.
3. **Past Meta's learning phase** — entity has ≥50 conversions in the last 7 days. Scaling in learning resets the clock.
4. **Frequency healthy** (prospecting <2.5, retargeting <6).
5. **Pixel firing** within the last 12 hours (`get_pixel_health`).

If any fail, stop and explain. Recommend a 48-hour hold and re-check, or route to `adadvisor-diagnose`.

## The two scaling axes

### Vertical scaling — same entity, more budget

**The 20% rule** is the consensus default: raise daily budget by ≤20% every 2-3 days. Larger jumps reset the learning phase, which costs you the established CPA you were scaling.

Math:
- Day 0: $100/day, $25 CPA
- Day 2: scale to $120/day → CPA tolerance still ~$25
- Day 4: scale to $144/day → 7-day window now shows $135/day average
- Day 7: scale to $173/day
- After 1 month: ~$430/day with CPA in range

If you need to scale faster, you have to accept a CPA inflation buffer (10-20% per increment) and tighten kill rules.

Call: `adadvisor:change_entity_budget(entity_type='adset', entity_id=..., daily_budget=<old × 1.2>)`.

The MCP server rejects any change >2× or <0.5× by default — pass `force=True` only when the user is explicitly accepting learning reset (e.g., aggressive scale window before BFCM).

### Horizontal scaling — duplicate to new audiences

When vertical scaling causes CPA to creep past target (typical at $1K-2K/day on a single ad set), duplicate to new audiences / geos / creative angles instead.

Patterns:

| Goal | Pattern | Call |
|---|---|---|
| Test a new audience with the proven creative | `duplicate_adset(deep_copy=True, target_campaign_id=<same or new>)` then `update_adset_targeting(...)` on the copy | preserves ads + creative; swaps audience |
| Test the proven audience in a new campaign (CBO ↔ ABO switch) | `duplicate_campaign(deep_copy=False)` then `duplicate_adset(adset_id=<winner>, target_campaign_id=<new shell>, deep_copy=True)` | clean budget split |
| Scale via geo expansion | `duplicate_adset(deep_copy=True)` → `update_adset_targeting(countries=[new])` | preserves everything else |
| Scale via lookalike tier | `duplicate_adset(deep_copy=True)` → `update_adset_targeting(custom_audiences=[<new LAL>])` | next LAL band (1% → 3% → 5%) |
| Add the proven creative to a new ad set | `duplicate_ad(target_adset_id=<other>)` | reuses creative and preserves social proof |

The MCP's `duplicate_*` responses include `next_steps` with the exact `change_entity_budget` and `change_entity_status` calls — follow them.

### Bid-cap escalation (the Tichenor method)

When Lowest Cost can't push past a spend ceiling without CPA blowing up, switch to Bid Cap:

1. Confirm the entity is producing enough conversions for Meta to find bids below the cap (≥50/week, post learning).
2. Cap = `target_CPA × 1.20`.
3. Duplicate the proven ad set with the cap applied: `duplicate_adset(deep_copy=True)`, then `update_entity(entity_type='adset', entity_id=<new>, fields={bid_strategy: 'LOWEST_COST_WITH_BID_CAP', bid_amount: target_CPA × 1.20})`.
4. Once stable, duplicate again with a higher cap. Build a portfolio of bid-capped ad sets each finding their own price point.

This works because bid caps respect a hard CPA ceiling — Meta won't bid above it. The trade-off: less volume. Allocate ≤20% of total spend to cost caps; the rest stays on Lowest Cost or moves to Target ROAS.

### Target ROAS portfolio (the Faris method)

> "70% of the money I spend on Meta Ads for my clients is on Target ROAS campaigns. Most accounts I see spend 0% of their money there." — Andrew Faris

When you have a confirmed winner that's been stable for ≥7 days, duplicate it into a Target ROAS variant for the stability floor:

1. `duplicate_adset(deep_copy=True)` of the winner.
2. `update_entity(entity_type='adset', entity_id=<new>, fields={bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS', optimization_goal: 'VALUE'})` — note: the MCP server requires you to also have value-event tracking via the pixel.
3. Set the ROAS floor — `roas_average_floor: <target_ROAS_multiplier>` (e.g. `1.5` for 150% ROAS / $1.50 back per $1 spent). Note the AdSet schema requires `optimization_goal: 'VALUE'`.

Kill signal: if spend drops below 75% of daily budget, the floor is too high. Lower the floor by 0.2× and re-check.

## Phase-based scaling (the TheOptimizer / Aden's Lab synthesis)

| Phase | Days | Budget action | Threshold to advance |
|---|---|---|---|
| Phase 1 — Validate | 0-7 | Don't touch | Stable CPA across 3+ days |
| Phase 2 — Identify | 7-14 | Don't touch winners; kill losers via `adadvisor-diagnose` | True winner identified |
| Phase 3 — Scale | 14+ | 20% every 2-3 days vertical; duplicate horizontally | Spend ceiling hits |
| Phase 4 — Ceiling | ≥$1K/day per entity | Bid-cap method, new audience expansion, brand spend layer | — |

## $1K → $10K/day scaling plan

The classic playbook (Disruptive Digital, Pawliw, Theriot syntheses):

| Stage | From → To | Plays |
|---|---|---|
| 1 | $1K → $2.5K | Vertical 20% on confirmed winners. Add 1-2 ad sets with broader audience. Lock in 3-5 winning creatives. |
| 2 | $2.5K → $5K | Horizontal scaling — duplicate winners into new audiences (LAL expansions, geo). Introduce ASC alongside manual (with exclusions). Weekly creative production. Track MER seriously. |
| 3 | $5K → $10K | Bid-cap diversification (Tichenor). Target ROAS campaigns (Faris). Brand/awareness at 10-15%. Creative production cadence: 4+ new concepts/week. |

Critical: at each stage, expect CPA to inflate 10-20%. The job is to keep marginal revenue positive vs marginal spend. Most operators stall at $5K-$10K/day because they protect a misleading ROAS instead of optimizing for total profit dollars. See `adadvisor-playbooks` for the full stage-by-stage operational plan.

## Workflow

1. User identifies the scale target. If vague ("what should I scale?"), route through `adadvisor-audit` first to find winners.
2. Run scale-eligibility check above.
3. Pick the scaling axis (vertical / horizontal / bid-cap / target ROAS) based on:
   - Current spend (vertical works <$1K/day, hits ceiling above)
   - CPA stability (stable → bid-cap or target ROAS; volatile → horizontal expansion)
   - Available audiences (new LAL tier or geo to add → horizontal; saturated → vertical)
4. Calculate the exact mutation. Quote the multiplier, the threshold, and the next-step cadence.
5. **Ask before mutating.** "Want me to scale `<adset_name>` from $100/day to $120/day (20% increase, the safe vertical cadence)?"
6. On confirmation: call the mutation tool. Use the response's `next_steps` to surface what to do in 2-3 days.
7. Set a re-check trigger ("I'll re-check this in 48 hours; you can ping me sooner if anything changes").

## Decision rules

- **The 20% rule is the floor, not the ceiling.** Aggressive scaling (50%, 100% jumps) is real on confirmed winners with deep conversion volume — but only with bid caps and accepting learning-phase reset.
- **Never scale a campaign in learning.** Wait for ≥50 conversions / 7d.
- **Always include a check-in cadence.** Scaling without follow-up is gambling.
- **MER over ROAS at scale.** Once spend crosses $5K/day, the user's marketing-efficiency ratio (total revenue / total marketing spend) tells you more than per-campaign ROAS.
- **Don't scale ASC and manual on the same audience without exclusions.** Cannibalization.

## Anti-patterns

- ❌ Scaling 50% on day 1 of a winner. ✅ Wait 3 days, scale 20%.
- ❌ Telling the user "I scaled, ROAS should improve" — scaling typically INFLATES CPA short-term as you exit the optimal audience. ✅ Set expectations: "CPA will likely creep 10-20% in the first 3 days; we kill the scale if it crosses target × 1.5."
- ❌ Vertical scaling past a flat spend ceiling. ✅ Switch axes — horizontal or bid-cap.
- ❌ Treating "scale" as "increase budget" only. ✅ Scale has four axes: vertical, horizontal, bid strategy, audience expansion.
- ❌ Using `force=True` on `change_entity_budget` to do a 5× jump. ✅ Stage it: 1.5× → wait → 1.5× → wait. The 2× guardrail exists for a reason.
- ❌ Scaling a campaign whose ROAS is healthy but driven entirely by repeat customers. ✅ Check `new-customer rate` first (or proxy via `result_action_type='Purchase'` vs `is_returning`).

## References

- [`references/scaling-axes.md`](references/scaling-axes.md) — when to use vertical / horizontal / bid-cap / target ROAS, with examples.
- [`references/the-20-percent-rule.md`](references/the-20-percent-rule.md) — math, exceptions, when to break it.
- [`references/bid-cap-method.md`](references/bid-cap-method.md) — Tichenor's full method with portfolio construction.
- [`references/target-roas-method.md`](references/target-roas-method.md) — Faris's method; AdSet schema requirements; kill signals.
- [`references/stage-plan-1k-to-10k.md`](references/stage-plan-1k-to-10k.md) — the $1K → $10K/day playbook with thresholds.
- [`references/horizontal-patterns.md`](references/horizontal-patterns.md) — duplicate patterns by goal (geo, LAL, creative, campaign-structure switch).
