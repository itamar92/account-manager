## Kill rules — unsentimental thresholds with worked examples

Senior buyers kill on rules, not feelings. The alternative — running ad spend on hope — is more expensive than killing a runner-up too early. This reference encodes the canonical rules with worked examples. Each rule includes threshold, rationale, anti-pattern.

## The five canonical kill rules

| Rule | Threshold |
|---|---|
| 1. The 3× rule | Spent ≥ 3× target_CPA with **zero** conversions |
| 2. The break-even floor | ROAS < 0.5× break_even_ROAS for 3+ consecutive days |
| 3. The frequency cliff | Frequency > 5 (prospecting) with declining CTR over 7 days |
| 4. The Quality Ranking penalty | `quality_ranking = "BELOW_AVERAGE_LOWER_20"` |
| 5. The negative-feedback flag | Negative feedback rate ≥ 0.2% |

Any one alone is sufficient to kill. Multiple firing simultaneously is overdetermined — kill faster.

## Rule 1 — The 3× rule (worked example)

**Account.** $80K/mo DTC supplements. target_CPA = $42 (AOV $120, 35% contribution).

**Scenario.** New ad set, 4 days old, $300/day. Spent: $1,180. Conversions: 0.

```
Spent / target_CPA = $1,180 / $42 = 28.1× target with zero conversions
Kill threshold = 3× target = $126 — exceeded by 9×.
```

**Decision.** Kill immediately. Even if the next $300 produced 5 purchases, average CPA would be $237 — 5.6× target.

**Anti-pattern.** "Give it one more day." At 3× target_CPA, prior of converting in the next day is <10%. Sunk cost compounds.

**MCP follow-up.** `adadvisor:change_entity_status(entity_type='adset', entity_ids=[<id>], action='pause')`. Then `adadvisor:get_performance(level='ad', level_specific_filter=<adset_id>)` to identify the worst creative — feed to `adadvisor-creative` as a "don't repeat this angle" signal.

## Rule 2 — The break-even floor (worked example)

**Account.** $250K/mo DTC apparel. break_even_ROAS = 2.5× (40% contribution). target_ROAS = 3.5×.

**Scenario.** 6-week-old ad set, post-learning, 89 purchases. ROAS trailing 3 days: 1.18, 1.04, 1.22.

```
0.5 × break_even_ROAS = 1.25. Trailing 3 days all < 1.25 ✓
```

**Decision.** Kill. The ad set loses 50 cents on the dollar after COGS. Three consecutive days is the noise filter.

**Anti-pattern.** Killing on a single day at 1.0× ROAS. Daily variance on a mature ad set is ±30%; one day is noise. The 3-day rule prevents this.

**MCP follow-up.** Pull `adadvisor:get_timeseries(entity_type='adset', entity_id=<id>, lookback_days=14)` first to confirm the 3-day trend isn't just 2 strong outlier days at the start of the window.

## Rule 3 — The frequency cliff (worked example)

**Account.** $40K/mo DTC skincare. Audience: 1% LAL of purchasers, US, ~480K reach.

**Scenario.** Ad set 5 weeks old. Frequency: 5.8. CTR (link) trailing 7 days: 0.9% — down from 1.7% week 1.

```
Frequency 5.8 > 5 ✓
CTR decay 0.9 / 1.7 = 0.53× original ✓
Audience size 480K < 1M ✓
```

**Decision.** Kill or major creative refresh. Sub-1M audience at frequency > 5 is terminal. Two paths: (1) kill the ad set and rebuild with same audience + new creatives; (2) major in-place refresh — pause all current ads, attach 4 new. Path 1 is cleaner because Path 2's learning reset is implicit and confuses the timeline.

**Anti-pattern.** Killing on frequency 4.0 without checking CTR. Frequency alone is not a kill rule for prospecting — accounts run at 4-6 sustainably if creative rotates. CTR decay is the confirmation.

**Retargeting exception.** Retargeting runs at 6-10 frequency without issue. Kill threshold for retargeting: freq > 10 AND CTR declining AND CPA above target.

## Rule 4 — Quality Ranking penalty (worked example)

**Scenario.** `adadvisor:get_performance(level='ad', level_specific_filter=<ad_id>)` returns `quality_ranking: "BELOW_AVERAGE_LOWER_20"` and `engagement_rate_ranking: "BELOW_AVERAGE_LOW_10"`. Meta places the ad below bottom 20% of peers.

**Decision.** Kill the creative. Below-Average quality compounds — Meta charges higher CPM and throttles delivery. No headline tweak recovers a Below-Average asset; the asset itself is the problem.

**Anti-pattern.** "Let me change targeting and see if Quality recovers." Quality Ranking is asset-level. Targeting doesn't move it.

## Rule 5 — Negative feedback (worked example)

**Scenario.** Trailing 30-day: 280,000 impressions, 612 negative feedback events.

```
612 / 280,000 = 0.219% ≥ 0.2% ✓
```

**Decision.** Kill. At 0.2% negative feedback you're losing brand equity faster than gaining customers. The creative is misleading, aggressive, or hitting the wrong audience hard enough that 1 in 500 people report it.

**Anti-pattern.** Ignoring negative feedback because ROAS is acceptable. It compounds — Quality Ranking drops, CPM rises, ROAS craters 4-6 weeks later. By the time ROAS reflects it, you've burned $20-50K.

## Budget-per-test by account size

The kill threshold scales with account spend. Don't apply a $200K/mo brand's threshold to a $5K/mo bootstrapper.

| Account size | Budget per test ad | Kill threshold (no conv.) | Days at $50 CPA |
|---|---|---|---|
| <$10K/mo | $25–75/day | $75–225 | 1.5–4.5 |
| $10K–50K/mo | $50–150/day | $150–450 | 3–9 |
| $50K–200K/mo | $100–300/day | $300–900 | 6–18 |
| $200K+/mo | $300–1,000/day | $900–3,000 | 18–60 |

(Source: GrowwithBA 2026 brackets.) Pick the row matching monthly spend; read across to find the spend threshold at which the 3× rule fires. Below it, not enough data to kill.

## The anti-pattern that kills accounts — killing too early

The most expensive mistake is killing winners during noise. The 3× rule and the 3-consecutive-day rule both enforce patience.

Daniel/DKoves's quote, encoded as policy:

> "I saw an ad creative drop from 5× to 3× ROAS. Panicked. Killed it. Two days later, I realized it was within normal variance."

Push back on "kill this" if: entity in learning, spend < 2× target_CPA, only 1 day of bad data, or 7-day trend is flat-to-improving.

Pushback script:

> "Spend at 1.6× target with 2 conv — hold band. Kill is 3× with zero. 7-day trend improving. Give it 48 more hours, or are you sure?"

The user can override. They shouldn't be surprised.

## Decision flowchart

```
                       ┌─────────────────────────┐
                       │ Pull get_performance +  │
                       │ get_timeseries          │
                       └────────────┬────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │  In learning phase                │
                  │  (<50 conv / 7d)?                 │
                  └─────────────────┬─────────────────┘
                       Yes          │              No
                ┌──────────────┐    │    ┌─────────────────────┐
                │ Wait. Do not │    │    │ Spent ≥ 3× target   │
                │ change.      │    │    │ CPA with 0 conv?    │
                │ See learning-│    │    └────┬─────────────┬──┘
                │ phase.md     │    │   Yes  │             │  No
                └──────────────┘    │   ┌────▼───┐   ┌─────▼──────────┐
                                    │   │ KILL   │   │ ROAS < 0.5 ×   │
                                    │   └────────┘   │ break-even for │
                                    │                │ 3+ days?       │
                                    │                └─┬────────────┬─┘
                                    │             Yes │            │ No
                                    │              ┌──▼─┐    ┌─────▼────────┐
                                    │              │KILL│    │ Freq > 5 AND │
                                    │              └────┘    │ CTR decay?   │
                                    │                        └──┬────────┬──┘
                                    │                       Yes │       │ No
                                    │                        ┌──▼─┐     │
                                    │                        │KILL│     │
                                    │                        │/RFRSH    │
                                    │                        └────┘     │
                                    │                                   │
                                    │              ┌────────────────────▼────────────┐
                                    │              │ Quality Ranking "Below Avg"     │
                                    │              │ OR neg feedback ≥ 0.2%?         │
                                    │              └──┬─────────────────────────┬────┘
                                    │             Yes │                         │ No
                                    │              ┌──▼─┐                  ┌────▼────┐
                                    │              │KILL│                  │  HOLD   │
                                    │              └────┘                  └─────────┘
```

## See also

- [`./diagnostic-tree.md`](./diagnostic-tree.md) — the cause→action tree that gets you TO a kill decision.
- [`./benchmarks.md`](./benchmarks.md) — what break_even and target ROAS look like by vertical.
- [`./learning-phase.md`](./learning-phase.md) — why kill rules don't apply during learning.
- The `adadvisor` foundation skill's `references/economics.md` — how to compute break-even and target_CPA from first principles.
