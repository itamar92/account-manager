## The $1K → $10K/day stage plan

A composite playbook drawn from Disruptive Digital (Tichenor), Lifeboat Media (Pawliw), Theriot Performance, and Common Thread Collective. The numbers and cadence are calibrated to a typical DTC ecom account on Meta in 2026 — adjust for industry, AOV, and margin, but the structure transfers.

## What "stage" means

A stage is a daily-spend bracket with a coherent operating mode — same axes, same cadence, same kill rules. Moving stages requires moving operating modes, not just budget. Most operators stall between stages because they push budget without changing the mode.

| Stage | Daily spend | Operating mode | Time to next stage |
|---|---|---|---|
| Stage 1 | $1K → $2.5K | Vertical-heavy on confirmed winners; light horizontal | 2-4 weeks |
| Stage 2 | $2.5K → $5K | Horizontal-heavy; ASC alongside manual; MER tracking | 3-6 weeks |
| Stage 3 | $5K → $10K | Bid-cap + Target ROAS portfolio; brand layer; 4+ creatives/week | 4-8 weeks |

## Stage 1 — $1K → $2.5K

### Plays

- **Vertical 20% on confirmed winners.** Pick the 1-2 ad sets that have been stable above target_ROAS × 1.2 for 3+ days. Increment every 2-3 days. See [`the-20-percent-rule.md`](the-20-percent-rule.md).
- **Add 1-2 broader ad sets.** Duplicate the winner to (a) a broader interest stack or (b) the next LAL tier. Run at half the source budget while validating.
- **Lock in 3-5 winning creatives.** Stage 1 is when creative variance is highest signal. Use `adadvisor:get_performance(level='ad')` to identify the top performers; ensure they're attached to multiple ad sets (via `adadvisor:duplicate_ad(target_adset_id=...)`) so the portfolio doesn't depend on one creative.
- **No bid caps, no Target ROAS yet.** Volume isn't there to support them.

### Thresholds to advance to Stage 2

- Account-level CPA within ±15% of target for 7 consecutive days.
- ≥2 ad sets each producing >$500/day with stable CPA.
- ≥3 creatives validated as winners (>50 conversions, CPA ≤ target).
- 7-day MER ≥ break-even MER + 30% buffer.

### CPA inflation expectation

- 0-10% as you climb $1K → $2.5K. Should be modest because the audiences are still relatively cheap.

## Stage 2 — $2.5K → $5K

### Plays

- **Horizontal scaling.** Vertical on a single ad set hits diminishing returns past ~$1.5K. Duplicate winners to new audiences:
  - Next LAL tier (1% → 3% → 5%) — see [`horizontal-patterns.md`](horizontal-patterns.md).
  - New geo (test 1 country at a time).
  - Broader interest stacks ("Tier 2" audiences — adjacent but unproven).
- **Introduce ASC (Advantage+ Shopping) alongside manual.** This is contentious. Foxwell's stance: yes, but with exclusions. Set ASC to exclude existing-customer lookalike audiences so it doesn't cannibalize retargeting. Set manual ad sets to exclude ASC's likely overlap. Track new-customer rate separately on each.
- **Weekly creative production.** Target 2-3 net-new concepts per week, each with 2-3 hook variations. See sibling skill `adadvisor-creative`.
- **Track MER seriously.** At $5K/day, per-campaign ROAS misleads. Compute Marketing Efficiency Ratio at the account level — total revenue / total marketing spend across all channels. The number you defend is MER, not Meta ROAS in isolation.

### Thresholds to advance to Stage 3

- 7-day account MER stable ≥ target_MER for 14+ days.
- ≥4 ad sets at $500-1K/day each (no single ad set carrying the account).
- New-customer rate ≥40% of conversions (proxy via custom event or cross-reference).
- ≥6 creatives in rotation with at least 2 produced in the last 14 days.

### CPA inflation expectation

- 10-20% as you climb $2.5K → $5K. Horizontal expansion brings new (less optimized) audiences; ASC introduces overlap.

## Stage 3 — $5K → $10K

### Plays

- **Bid-cap diversification (Tichenor).** Build a 2-3 rung bid-cap portfolio on 1-2 of the highest-volume ad sets. Cap at `target_CPA × 1.20`, ladder upward. See [`bid-cap-method.md`](bid-cap-method.md). Allocate ≤20% of total spend to cost caps.
- **Target ROAS campaigns (Faris).** Once value tracking is fully wired (pixel + CAPI sending values cleanly), shift 30-50% of stable winners into `LOWEST_COST_WITH_MIN_ROAS` ad sets with floors set at 0.7-0.8 × current ROAS. See [`target-roas-method.md`](target-roas-method.md).
- **Brand/awareness layer at 10-15%.** Senior buyers (Foxwell, MHI, ATTN) maintain a brand spend slice — REACH or AWARENESS objective with the strongest hero creative — at 10-15% of total spend. It seeds future retargeting pools and lifts top-of-funnel performance on the conversion campaigns. Don't expect ROAS attribution here; measure via brand-search lift and net-new reach.
- **4+ new concepts/week.** Creative is now the rate-limiting factor. Production cadence: 4-6 net-new creative concepts each week, each with 2-3 hook/body variations. Refresh cadence: 7-10 days. See sibling skill `adadvisor-creative` (refresh-cadence reference).

### What "graduating" Stage 3 looks like

Most accounts plateau between $7K and $15K/day without a category-defining product or aggressive geo expansion. Graduation either means:

- Geo expansion (US → CA → AU → UK in sequence; each new geo is effectively a new Stage 1 inside the same account).
- Category expansion (new product line treated as a separate funnel).
- TikTok / YouTube layer (a different MCP entirely; not in this skill's scope).

### CPA inflation expectation

- 20-30% as you climb $5K → $10K. The headline ROAS will drop; the question is whether MER stays healthy and profit dollars are still rising.

## What every stage shares

- **Kill rules tighten with scale.** At $1K/day, kill at 3× target CPA / zero conversions. At $10K/day, kill at target × 1.5 / ≤2 conversions per $300 spent. The data is cheaper at scale, so you can afford less waiting.
- **MER over ROAS once above $5K/day.** ROAS at the campaign level lies — it captures attributed revenue, not incremental revenue. MER captures everything.
- **The check-in cadence compounds.** Daily morning check at $1K/day; twice-daily check at $5K/day; near-real-time at $10K/day. Velocity of decisions matters more than depth at scale.
- **Don't scale into chaos.** If you have 12 ad sets all in different lifecycle stages — some learning, some scaling, some fatiguing — the operating mode collapses. Periodically consolidate: pause the laggards, promote the winners to the next stage.

## Stage progression in MCP calls

A simplified weekly review at each stage:

```
Weekly Stage 1/2/3 routine:
  1. adadvisor:list_ad_accounts → confirm context.
  2. adadvisor:get_performance(level='campaign', date_range='last_7_days')
       → score against target_ROAS / target_CPA.
  3. For each winner: adadvisor:get_timeseries(entity_type='adset', days=14)
       → confirm 3+ day stability.
  4. For each scaling candidate:
       - Vertical: adadvisor:change_entity_budget(daily_budget=old × 1.2)
       - Horizontal: adadvisor:duplicate_adset(deep_copy=True) → update_adset_targeting
       - Bid strategy (Stage 3): duplicate_adset → update_entity with bid_strategy
  5. For each laggard: adadvisor:change_entity_status(action='pause')
       (or escalate to adadvisor-diagnose to investigate)
  6. Set a follow-up trigger for 2-3 days later.
```

## Real-world stalls

- **Stuck at $2K.** Almost always single-ad-set dependency. The account has one winner doing $1.5K and a long tail. Fix: horizontal-scale the winner into 2 new audiences; force the long tail to either prove out or get killed.
- **Stuck at $5K.** Usually ASC vs manual cannibalization with no clear exclusion policy. Fix: separate audiences with explicit excludes; measure ASC's marginal contribution to new-customer rate.
- **Stuck at $8K.** Creative production cadence below 2 concepts/week. Fatigue compounds faster than refreshing. Fix: commit to weekly 4+ net-new creatives or accept the ceiling.

## Cross-references

- [`scaling-axes.md`](scaling-axes.md) — picking which axis to move on at each stage.
- [`the-20-percent-rule.md`](the-20-percent-rule.md) — the vertical-scale rhythm that anchors Stage 1.
- [`horizontal-patterns.md`](horizontal-patterns.md) — Stage 2's bread and butter.
- [`bid-cap-method.md`](bid-cap-method.md) and [`target-roas-method.md`](target-roas-method.md) — Stage 3 layers.
- Foundation skill `adadvisor` (economics reference) — MER, break-even ROAS.
