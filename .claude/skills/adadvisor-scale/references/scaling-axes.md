## The four scaling axes

"Scale" gets used as a synonym for "increase budget." It isn't. There are four independent axes you can move along, and senior buyers pick the axis based on where the campaign is stuck — not by reflex. This reference is the decision matrix.

## The axes

| Axis | What changes | What stays the same | Primary MCP call |
|---|---|---|---|
| **Vertical** | Daily budget on the same entity | Audience, creative, placement, bid strategy | `adadvisor:change_entity_budget` |
| **Horizontal** | Audience (new LAL tier, geo, interest, custom audience) | Creative, bid strategy, budget level | `adadvisor:duplicate_adset` + `adadvisor:update_adset_targeting` |
| **Bid strategy** | Lowest Cost → Bid Cap → Target ROAS | Audience, creative, budget | `adadvisor:duplicate_adset` + `adadvisor:update_entity` |
| **Audience expansion** | Add new lookalike seeds, customer-list uploads, or pixel-event audiences | Existing winners untouched | `adadvisor:create_lookalike_audience` / `adadvisor:create_website_audience` |

## Vertical — when to use

The default first move. Working bracket: $0 → ~$1K/day on a single ad set. Above that, vertical scaling hits a CPM ceiling — Meta runs out of cheap impressions in your current audience and starts buying expensive ones to fill the budget.

- **Use when:** confirmed winner, ROAS ≥ 1.2× target for 3+ days, daily spend < $1K.
- **Expect:** CPA inflates 10-20% per increment. The 7-day ROAS lags 2-3 days behind the daily change.
- **Learning impact:** ≤20% budget changes don't reset learning. >2× changes (`force=True`) do.
- **Tool:** `adadvisor:change_entity_budget(entity_type='adset', entity_id=..., daily_budget=<old × 1.2>)`.

See [`the-20-percent-rule.md`](the-20-percent-rule.md) for the math and exceptions.

## Horizontal — when to use

The "I've hit a spend ceiling vertically" move. Once the same audience produces $1K-2K/day at target, additional dollars push CPM higher than incremental revenue. New audiences open new auctions.

- **Use when:** vertical CPA is creeping >20% above target; spend has flatlined at the new budget; CPM is rising day-over-day with the same creative.
- **Expect:** new ad set re-enters learning (50-conversion / 7-day clock starts fresh). First 3-5 days will look worse than the winner. Don't kill prematurely.
- **Learning impact:** new ad set = new learning phase. Budget-split the spend so neither side starves.
- **Patterns:** new geo, next LAL tier (1% → 3% → 5%), interest expansion, ASC alongside manual (with exclusions).

See [`horizontal-patterns.md`](horizontal-patterns.md) for exact MCP sequences.

## Bid strategy — when to use

Two flavors: Bid Cap (Tichenor) and Target ROAS (Faris). Both move you off Lowest Cost, which is great at finding the cheapest auctions until it isn't — at scale, Lowest Cost optimizes for volume at the expense of unit economics.

- **Use Bid Cap when:** you have a hard target CPA you cannot exceed, conversion volume is high (≥50/week), and you want to ration spend against a price ceiling. See [`bid-cap-method.md`](bid-cap-method.md).
- **Use Target ROAS when:** value tracking is wired up (pixel + CAPI), the winner has been stable ≥7 days, and you want the algorithm to throttle below the floor automatically. See [`target-roas-method.md`](target-roas-method.md).
- **Learning impact:** bid-strategy switches always re-enter learning. Budget for a 3-7 day softness window.

## Audience expansion — when to use

The slowest-moving axis. You're not scaling an existing winner — you're building the next winner so the portfolio doesn't run dry when current creatives fatigue.

- **Use when:** prospecting pool is saturated (Net New Reach declining, frequency >3 on prospecting), or you want to feed horizontal-scale duplications in 2-4 weeks.
- **Expect:** no immediate impact. The seed audience needs 7-14 days of pixel data before LAL quality stabilizes.
- **Tools:**
  - `adadvisor:create_website_audience` for pixel-event seeds (Purchase, AddToCart, ViewContent).
  - `adadvisor:create_lookalike_audience` for 1%-20% LAL bands.
  - Customer-list uploads happen in the AdAdvisor app, not via MCP. Surface them with `adadvisor:list_custom_audiences`.

## Decision matrix

| Daily spend | CPA stability | Available audiences | Recommended axis |
|---|---|---|---|
| <$500/day | Stable | Plenty of room in LAL 1% | **Vertical** — keep going |
| $500-$1K/day | Stable | LAL 1% saturating | **Vertical + start horizontal seed** (next LAL tier ready to duplicate) |
| $1K-$2K/day | Drifting up 10-15% | Multiple LAL tiers or new geo | **Horizontal** — duplicate to a new audience |
| $2K-$5K/day | Volatile | Audience saturated | **Bid strategy** — Bid Cap layer to enforce CPA discipline |
| $5K+/day | Stable winner ≥7d | Value tracking healthy | **Target ROAS** — Faris portfolio shift |
| Any | Fatigue (CTR decay, frequency spike) | New creatives in production | **Creative refresh first, then re-evaluate axis** — see `adadvisor-creative` |

## Common axis-mismatch failures

- **Pushing vertical past the ceiling.** Budget went from $500 → $750 → $1.1K and CPA blew up. The signal wasn't budget — it was audience saturation. Switch to horizontal.
- **Horizontal-scaling a non-winner.** Duplicating an ad set that's only barely above target into 4 new audiences just multiplies a marginal result. Confirm scale-eligibility before duplicating.
- **Bid-capping too aggressively.** Setting cap = target_CPA exactly. Meta needs headroom — use `target_CPA × 1.20` as the cap.
- **Target ROAS without value events.** The bid strategy will fail to spend if the pixel isn't sending purchase values. Validate `get_pixel_health` returns recent Purchase events with non-zero value.
- **Switching all four axes at once.** Now you cannot attribute the result to any one change. Move one axis at a time, give it 3-5 days, then reassess.

## Sequencing across axes

Senior buyers (Tichenor, Faris, Foxwell, Pawliw) tend to layer axes in this order on a healthy account:

1. **Vertical** until the ceiling.
2. **Horizontal** to open new auctions and rebuild headroom.
3. **Bid strategy** once volume is high enough to support it (≥50 conversions/week per ad set on the bid-capped variant).
4. **Audience expansion** as a continuous background process, feeding the next horizontal duplications.

Skipping ahead — e.g. jumping to Target ROAS before the winner has volume — is the most common cause of "I switched to a smarter bid and it stopped spending." The smarter bid isn't smarter on thin data.

## Quick reference

- "What axis should I pick?" → match the row in the decision matrix above.
- "Will this reset learning?" → vertical ≤20% no; vertical >2× yes; horizontal yes (new ad set); bid strategy yes; audience expansion no (until used).
- "What's the expected CPA impact?" → vertical: +10-20% per increment; horizontal: 0-30% on the new ad set during learning; bid strategy: softness for 3-7 days then re-stabilizes; audience expansion: n/a.
