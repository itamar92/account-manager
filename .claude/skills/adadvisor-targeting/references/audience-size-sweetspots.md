## Audience size sweet-spots — reach ranges that actually deliver

Audience size determines whether Meta can deliver stable, learnable traffic. The wrong range — too small or too large — breaks delivery in different ways. The ranges below are the operational guardrails for prospecting, retargeting, and lookalike construction.

The MCP surfaces audience size at three points:
- `adadvisor:list_custom_audiences` returns `approximate_count_lower_bound` / `approximate_count_upper_bound` for custom audiences.
- `adadvisor:estimate_audience_size` returns `users_lower_bound` / `users_upper_bound` for a targeting spec.
- `adadvisor:update_adset_targeting` and `adadvisor:create_adset` return `estimated_reach` after spec validation.

## Reach ranges by use case

### Prospecting

| Range | Behavior | Recommendation |
|---|---|---|
| < 500K | Learning phase exits slowly; conversions sparse; ROAS variance high | Avoid for prospecting. Expand geo or drop interest stacks. |
| 500K - 1M | Workable for niche products; learning exits in 14-21 days | Acceptable for premium / niche; not ideal for general DTC. |
| **1M - 10M** | **Sweet spot for most DTC.** Learning exits in 7-14 days. Stable CPMs. | Default target range. |
| **10M - 50M** | **Sweet spot for scaled DTC.** Andromeda has room to operate. | Default for accounts at $5K+/day. |
| 50M - 100M | Edge of stability. Meta may over-deliver to noisy users. | Use only when broader signal is needed (mass-market consumer). |
| > 100M | Meta delivers poorly; high frequency on a few hot pockets, sparse elsewhere | Avoid — narrow with country or age. |

Lebesgue's 2025 data confirms 1M-50M as the optimum for ROAS in prospecting across budget tiers. Below 500K, ROAS drops 30-50% from peak; above 50M, it drops 10-20%.

### Retargeting

| Range | Behavior | Recommendation |
|---|---|---|
| < 1,000 | Meta cannot deliver stably; frequency spikes ≥5 in a week | Don't run as standalone. Consolidate into looser layer. |
| **1,000 - 10,000** | **Stable delivery.** Frequency 2-4/week with healthy creative refresh. | Most warm-2 audiences live here. |
| **10,000 - 100,000** | **Sweet spot.** Frequency 1-3/week; clean attribution. | Most warm-1 + email layers live here. |
| 100,000 - 500,000 | Becoming pseudo-prospecting; warmth signal dilutes | Acceptable for large brands; consider splitting into tighter tiers. |
| > 500,000 | Not retargeting anymore — it's prospecting with a website-visitor signal | Re-classify; use prospecting exclusions / structure. |

Enhencer's 2026 audience-stability benchmark formalized the 1,000-member floor for retargeting. Below it, delivery is mathematically unstable — Meta's auction matcher can't find enough impressions/day in the audience to maintain pacing.

### Lookalike seed

| Range | Behavior | Recommendation |
|---|---|---|
| < 100 | Meta will reject the LAL build | Hard floor (Meta enforced). |
| 100 - 500 | LAL is statistical noise; weekly re-modeling drifts the audience | Don't build. Wait for seed to grow. |
| 500 - 1,000 | Marginal — LAL is functional but unstable | Acceptable only when no better seed exists. |
| **1,000 - 50,000** | **Sweet spot.** Stable LAL modeling; consistent week-over-week behavior. | Aim for this range. |
| 50,000 - 500,000 | Excellent. Very stable. | Optimal. |
| > 500,000 | Diminishing returns — the seed is so broad that 1% LAL ≈ broad anyway | Use broad if seed is this large. |

The senior buyer's rule: minimum 1,000 to even consider a LAL. Best results above 5,000. See [`lookalike-strategy.md`](lookalike-strategy.md) for the full seed-selection hierarchy.

### Custom audience for delivery (general)

A custom audience used as a primary targeting layer (not just for exclusion) needs ≥1,000 active members to deliver. The MCP surfaces this in `list_custom_audiences` as `approximate_count_lower_bound`. If lower-bound is <1,000, expect spotty delivery.

Audiences used purely for *exclusion* don't have this floor — even a 50-person exclusion still excludes those 50 people. The floor only applies to audiences you're targeting *toward*.

## Reading `estimate_audience_size` responses

The `adadvisor:estimate_audience_size` tool returns:

```json
{
  "users_lower_bound": 12500000,
  "users_upper_bound": 14700000,
  "estimate_ready": true,
  "targeting_summary": {...}
}
```

Interpret as:

| Field | Meaning |
|---|---|
| `users_lower_bound` | Pessimistic estimate (lower 95% CI bound) |
| `users_upper_bound` | Optimistic estimate (upper 95% CI bound) |
| `estimate_ready: true` | Meta has confidence in the estimate; report the range to the user |
| `estimate_ready: false` | Audience too new/niche; Meta cannot estimate yet |
| `users_lower_bound: -1` | Audience too small or undefined; treat as "unestimable, probably <1,000" |

When `estimate_ready=false`:
- Wait 24-48 hours and retry; new custom audiences need time to be measured.
- If the spec is fully formed and Meta still can't estimate, the spec is probably too narrow — try expanding age range or dropping interest filters.

When `users_lower_bound = -1`:
- The audience is below Meta's measurement threshold.
- If this is a custom audience, it has <1,000 members or is still populating.
- If this is a targeting spec, the combination of filters is too narrow to deliver.

## Reach-vs-frequency math

Audience size constrains how much budget you can spend before frequency overwhelms creative.

```
weekly_impressions_capacity = audience_size × max_acceptable_frequency
                            = audience_size × 3   (default for retargeting)
                            = audience_size × 2   (default for prospecting)

weekly_spend_capacity = weekly_impressions_capacity × (CPM / 1000)
                      = audience_size × frequency × (CPM / 1000)
```

Worked example: a 10,000-person retargeting audience, $30 CPM, max frequency 3/week:

```
10,000 × 3 × ($30 / 1000) = $900/week capacity
                          ≈ $130/day before frequency tips into fatigue
```

If the user is spending $400/day on a 10,000-person retargeting audience, frequency is already 9-10/week — explains the rising fatigue, drop in CTR, and rising CPA. Either expand the audience or cut budget.

## How to expand a too-small audience

| Tactic | Effect |
|---|---|
| Add country (US → US+CA+UK+AU) | 2-5× reach for English-speaking ecom |
| Widen age (25-55 → 18-65) | 1.3-1.5× reach |
| Drop interests entirely (let Advantage+ Audience do it) | 3-10× reach |
| Switch from 1% LAL to 3% or 5% LAL | 3-5× reach per ratio band |
| Switch from LAL to broad | Effectively infinite reach |
| Lengthen retargeting retention (30 → 60 → 90 → 180 days) | 1.5-3× reach |

Don't add interests to expand reach — they narrow, not widen. The exception is geo (a country is an "interest" in the API sense).

## How to narrow a too-large audience

| Tactic | Effect |
|---|---|
| Tighten geo (whole US → 5 major metros) | 0.05-0.1× reach |
| Tighten age (18-65 → 25-45) | 0.5× reach |
| Add custom audience layer (broad + LAL signal) | Mixed — depends on overlap |
| Disable Advantage+ Audience | Restricts to spec strictly — but rarely advisable |

Tightening is almost always done *before* launch, not as a fix mid-flight. Mid-flight tightening forces Meta to relearn.

## Country-level reach reference (US + English-speaking, age 25-55)

Rough Meta reach estimates for prospecting baselines, broad targeting:

| Geo + age | Approx. reach |
|---|---|
| US 25-55 | 100-130M |
| US 25-55, women | 50-65M |
| CA 25-55 | 12-15M |
| UK 25-55 | 18-22M |
| AU 25-55 | 7-9M |
| US + CA + UK + AU 25-55 | 140-180M |

Layer Advantage+ Audience on top — Meta will deliver within this reach, biased by signal.

## Anti-patterns

- Building a 500-person retargeting audience and running it as a standalone ad set. Below 1,000, consolidate into a looser layer or skip.
- Targeting US 18-65 broad with no audience floor reasoning. That's 230M+ reach; nothing wrong with it for $10K+/day, but at $50/day Meta has too much room to wander.
- Treating `estimate_ready=false` as a hard error. Often it just means "wait 24 hours."
- Building a 10% LAL on a tiny seed and declaring it "scale-ready." 10% LAL is functionally broad — see [`broad-vs-detailed.md`](broad-vs-detailed.md).
- Ignoring frequency. A perfectly-sized 50K audience at $1K/day will hit frequency 10+/week in 14 days; the creative refresh cadence in [`/economics.md`](../../adadvisor/references/economics.md) and the warm-audience capacity math above must agree.
- Spending $500/day on a 5,000-person retargeting audience and being surprised when CPMs spike. The audience is exhausted in 3-5 days at that spend.

## References cited

- Lebesgue 2025 reach-vs-ROAS benchmark across budget tiers.
- Enhencer 2026 audience-stability minimums (1,000-member floor for retargeting).
- Meta's `/reachestimate` API documentation.
- Common Thread Collective on frequency-vs-reach capacity math.
