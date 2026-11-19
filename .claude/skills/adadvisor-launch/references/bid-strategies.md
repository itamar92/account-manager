## Bid strategies — when to use each, with formulas

Meta exposes four bid strategies. The MCP server enforces the field combinations, but choosing the wrong strategy is a soft failure — Meta will deliver, just at lower efficiency than optimal. This reference encodes the decision rules, required fields, and `bid_amount` / `roas_average_floor` formulas.

## The four strategies

| Strategy | `bid_amount` required? | Other required fields | What Meta does |
|---|---|---|---|
| `LOWEST_COST_WITHOUT_CAP` | No | — | Spend the budget, get as many results as possible, no bid ceiling |
| `LOWEST_COST_WITH_BID_CAP` | Yes — max bid per auction | — | Get results, never bid above the cap |
| `COST_CAP` | Yes — target average CPA | — | Maintain CPA at-or-below the cap on average; some auctions may bid higher |
| `LOWEST_COST_WITH_MIN_ROAS` | No (mutually exclusive) | `roas_average_floor`, `optimization_goal: 'VALUE'` | Maintain ROAS at-or-above the floor on average |

The four are mutually exclusive — set one, not multiple. The MCP server rejects invalid combinations.

## Decision table

| Account state | Recommended strategy | Why |
|---|---|---|
| New campaign, no data | `LOWEST_COST_WITHOUT_CAP` | Let Meta explore; bid caps starve learning |
| Mature campaign, CPA stable, want to scale | `LOWEST_COST_WITHOUT_CAP` with daily budget increases | Scale by raising budget, not by capping bid |
| Mature campaign, CPA inflating with budget increases | `COST_CAP` | The cap stops Meta from chasing expensive marginal conversions |
| Mature campaign, predictable AOV variance, want ROAS guarantee | `LOWEST_COST_WITH_MIN_ROAS` (VALUE optimization) | Floor enforces unit economics |
| Auction-competitive niche, single high-value conversion | `LOWEST_COST_WITH_BID_CAP` | Max bid prevents overpaying on outliers |
| Lead-gen, want predictable CPL | `COST_CAP` at target_CPL | Enforces the CPL ceiling |
| App promotion, iOS, SKAN attribution | `LOWEST_COST_WITHOUT_CAP` | SKAN lag makes ROAS-floor unreliable |

Default for most new campaigns: `LOWEST_COST_WITHOUT_CAP`. Switch to `COST_CAP` only after you have a real target_CPA grounded in 30+ days of data.

## `LOWEST_COST_WITHOUT_CAP` — when and how

**When.** Default for new campaigns, scaling (raise budget, not bid ceiling), and high-volume mature campaigns.

**Field.** Just `bid_strategy: 'LOWEST_COST_WITHOUT_CAP'`. No bid math.

**Risk.** Meta may bid aggressively during learning. Acceptable as long as the entity is on a path to exit.

**When NOT to use.** Account bleeding ≥ 14 days at consistently 1.5×+ target — Cost Cap re-anchors. But fixing creative or audience first is usually a better lever.

## `LOWEST_COST_WITH_BID_CAP` — when and how

**When.** You know the maximum you'd ever pay for a single auction win. Useful in narrow niches where outlier-priced auctions ruin the average — e.g., niche B2B where one click can clear $50 but you'd never pay $200.

**Field.**
```
bid_strategy: 'LOWEST_COST_WITH_BID_CAP'
bid_amount: <max_per_auction_bid_in_account_currency>
```

**Formula.**
```
bid_amount = target_CPA × 1.50
```

The 1.50 multiplier accounts for the fact that bid is per-auction, not per-conversion. You'd happily pay 1.50× target_CPA for a single auction if it converts.

**Risk.** A too-low bid cap suppresses delivery — the ad set won't spend its budget. If `effective_status` shows under-delivery and Bid Cap is low, raise the cap or switch to LOWEST_COST_WITHOUT_CAP.

## `COST_CAP` — when and how

**When.** Mature campaign with a known target_CPA, where you want to prevent CPA drift as you scale. Lead-gen campaigns benefit from COST_CAP because CPL is the primary constraint.

**Field.**
```
bid_strategy: 'COST_CAP'
bid_amount: <target_average_CPA_in_account_currency>
```

**Formula.**
```
bid_amount = target_CPA × 1.15 to 1.20
```

The 1.15-1.20 cushion lets Meta breathe during exploration days. A cap exactly at target_CPA suppresses delivery — Meta won't bid at all on marginal auctions, missing the easy wins.

**Worked example.** target_CPA = $40 (lead-gen, target_CPL = $40).
```
bid_amount = $40 × 1.18 = $47.20
```
Round to $47. Meta will average roughly $40 CPL while paying up to $47 on individual conversions.

**Risk.** Cap too low → starves delivery and stays in `LEARNING_LIMITED`. Cap too high → no effective constraint, equivalent to LOWEST_COST_WITHOUT_CAP.

**Transition.** Don't move from LOWEST_COST to COST_CAP on day 1 of a campaign. Wait until the entity has ≥ 50 conversions and a stable 14-day CPA. Then transition. Cost Cap during learning kills the exploration.

## `LOWEST_COST_WITH_MIN_ROAS` — when and how

**When.** Pure ecom with reliable revenue tracking (Purchase pixel + CAPI deduplicated). The strategy enforces a ROAS floor — Meta won't bid where projected ROAS is below the floor.

**Field.**
```
bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS'
roas_average_floor: <floor_as_decimal>   # 1.5 means 150% ROAS = 1.5×
optimization_goal: 'VALUE'                # REQUIRED — this strategy needs value optimization
```

**Do NOT set `bid_amount` with this strategy.** The MCP server rejects the combination.

**Formula.**
```
roas_average_floor = break_even_ROAS × 1.05 to 1.10
```

The 1.05-1.10 multiplier gives the algorithm room to find the break-even conversions while ensuring on-average profitability. Setting the floor at exactly break-even causes Meta to over-restrict and starves the campaign.

**Worked example.** break_even_ROAS = 2.5× (40% contribution margin).
```
roas_average_floor = 2.5 × 1.08 = 2.70
```
Pass `roas_average_floor: 2.70`. Meta will aim to keep the campaign's average ROAS at ≥ 2.70×.

**Risk.** With Min ROAS, low-conversion-value days disappear (Meta withholds delivery). You may see 30-50% under-delivery on slow days. That's the strategy working — but the campaign won't scale aggressively.

**Compatibility.** VALUE optimization requires Purchase events with non-zero `value` field on every event. If the pixel isn't firing value, this strategy is impossible. Check with `adadvisor:get_pixel_health` for Purchase event value distribution.

## The mutual-exclusivity gates

The MCP server enforces these. Trying to violate them returns an error before Meta sees the request.

- `bid_amount` is required for `COST_CAP` and `LOWEST_COST_WITH_BID_CAP`.
- `bid_amount` is rejected for `LOWEST_COST_WITHOUT_CAP` and `LOWEST_COST_WITH_MIN_ROAS`.
- `roas_average_floor` is required for `LOWEST_COST_WITH_MIN_ROAS` and rejected for the other three.
- `LOWEST_COST_WITH_MIN_ROAS` requires `optimization_goal: 'VALUE'`. Other optimization goals are incompatible.

## Updating bid strategy on a live ad set

Bid strategy changes via `adadvisor:update_entity` reset learning. Cost: 5-10 days of CPA inflation. Quote before switching:

> "Switching LOWEST_COST_WITHOUT_CAP → COST_CAP resets learning. Expect 5-10 days at ~1.5× current CPA. Recommend only if current CPA is ≥ 1.5× target on a sustained basis."

## Anti-patterns

- Setting `bid_amount` exactly at target_CPA on COST_CAP — starves delivery. Use 1.15-1.20× target.
- Setting Bid Cap during the first 7 days of a new campaign — prevents exploration. Wait 14 days, then add the cap.
- Setting Min ROAS without `optimization_goal: 'VALUE'` — Meta rejects.
- Setting Min ROAS on a campaign without Purchase value firing — algorithm can't compute, starves delivery.
- Switching bid strategy weekly to "tune" CPA — every switch resets learning. Settle on a strategy and let it run 30 days.
- Confusing `bid_amount` semantics — for BID_CAP it's the auction ceiling, for COST_CAP it's the target average. Same field, different meaning.

## See also

- [`./launch-checklist.md`](./launch-checklist.md) — pre-flight including bid-strategy choice.
- [`./structure-decisions.md`](./structure-decisions.md) — CBO/ABO impacts bid behavior (CBO uses campaign-level bid).
- The `adadvisor` foundation skill's `references/economics.md` — how to derive target_CPA from contribution margin and AOV.
