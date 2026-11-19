## Audience overlap — the silent profit killer

When two ad sets target overlapping audiences, Meta's auction makes them bid *against each other* for the same impression. The user pays for the privilege of competing with themselves: CPMs inflate, frequency rises, and CPA degrades — without any signal in the surface metrics that overlap is the cause.

Meta flags overlap at ≥30% in its in-app overlap tool. By the time it's that high, the damage has been compounding for weeks.

## What overlap costs

| Effect | Mechanism |
|---|---|
| CPM inflation | Two ad sets bid in the same auction; the loser still pays the higher second-place price for nothing |
| Frequency >3 within a week | Same user sees ads from two ad sets, doubling effective frequency |
| ROAS attribution confusion | Both ad sets get partial credit; neither has clean data for decisions |
| Slower learning exits | Conversions split across ad sets, neither reaches the 50-events/7-day learning threshold |
| False kill signals | Underperforming ad set might be the *better* one with conversions stolen by its overlapping sibling |

A 30% overlap typically costs 10-20% of effective spend. A 50%+ overlap can cost 30-40%.

## Detecting overlap via the MCP

Meta's own overlap tool is the gold standard but isn't exposed via the API directly. Detect overlap symptoms via the MCP:

### 1. Multiple ad sets with the same custom audiences

```
adadvisor:list_adsets(account_id, fields=['name', 'targeting'])
```

Inspect the returned `targeting.custom_audiences` arrays. Any audience ID that appears in 2+ ad sets is a direct overlap — both ad sets target literally the same users.

### 2. Multiple lookalike ad sets without `starting_ratio`

```
adadvisor:list_adsets(...)
# Look for: LAL 1%, LAL 3%, LAL 5% all targeting the same seed, none with starting_ratio
```

A 1% LAL is a subset of the 3% LAL is a subset of the 5% LAL. Running all three as separate ad sets means the 1% audience is included in all three — ~70% overlap by construction. Fix with `starting_ratio` bands (see [`lookalike-strategy.md`](lookalike-strategy.md)).

### 3. ASC + manual prospecting without exclusions

If the account has an Advantage+ Shopping Campaign (`smart_promotion_type='AUTOMATED_SHOPPING_ADS'`) AND a manual prospecting CBO, and the manual prospecting ad sets don't exclude the ASC-targeted audience (or vice versa), the two campaigns will overlap heavily on prospecting users.

```
adadvisor:list_campaigns(account_id, fields=['name', 'smart_promotion_type'])
adadvisor:list_adsets(...)
# Look for: ASC campaign live AND manual prospecting live, with no cross-exclusion
```

The ASC ↔ manual exclusion pattern is in [`exclusion-patterns.md`](exclusion-patterns.md).

### 4. Multiple ad sets with similar broad targeting

```
adadvisor:list_adsets(...)
# Compare: age_min/age_max, gender, geo, advantage_audience flag.
# Two ad sets that share country + age + advantage_audience=true will overlap nearly 100%
# unless distinguished by custom audiences or interests.
```

This is the classic "I duplicated the ad set to test a creative" mistake — two broad ad sets in the same country compete in the same auction.

### 5. Heuristic check: reach overlap of the spec itself

For two ad sets A and B with comparable targeting specs:

```
adadvisor:estimate_audience_size(account_id, <spec A>)  → users_a
adadvisor:estimate_audience_size(account_id, <spec B>)  → users_b
adadvisor:estimate_audience_size(account_id, <combined spec, union>)  → users_union

overlap_estimate = (users_a + users_b - users_union) / min(users_a, users_b)
```

If `overlap_estimate > 0.3`, you have a problem. (This is rough — Meta's overlap tool uses delivery-time data, not estimated reach — but it's directionally useful.)

## When overlap is acceptable

Not all overlap is bad. Some overlap is the deliberate structure of the campaign.

| Scenario | Acceptable overlap | Why |
|---|---|---|
| Prospecting CBO vs retargeting | Up to ~20% | Retargeting will pull users who also fit prospecting; the exclusion is on the *retargeting* side via excluded_custom_audiences |
| ASC + manual prospecting with exclusions | Up to ~10% | Properly excluded, the slight residual is mostly Advantage+ Audience expansion |
| LAL 0-1% and LAL 1-3% (banded via starting_ratio) | <5% | Bands are designed to be non-overlapping; Meta gets the math close but not perfect |

The unacceptable cases — where overlap is silently degrading delivery — are the ones that need consolidation or exclusions.

## Fixes

### Fix 1: consolidate

If two ad sets target effectively the same audience, merge them. Keep the better-performing one's settings; pause the other; move its budget into the survivor.

```
# Identify which one to keep based on performance
adadvisor:get_performance(level='adset', adset_ids=[<a>, <b>], date_range='last_14d')

# Pause the loser
adadvisor:change_entity_status(entity_type='adset', entity_id=<loser>, action='pause')

# Move budget to the winner (add the loser's daily_budget to the winner's)
adadvisor:change_entity_budget(entity_type='adset', entity_id=<winner>, daily_budget=<combined>)
```

### Fix 2: add exclusions

When two ad sets *should* run side-by-side but target overlapping audiences (e.g. ASC + manual prospecting), exclude one from the other.

```
# Exclude manual-prospecting audience from ASC (or vice versa)
adadvisor:update_adset_targeting(
  account_id, adset_id=<asc_or_manual>,
  excluded_custom_audiences=[
    {id: <other_audience>, name: '<other audience name>'}
  ]
)
```

If the "other" audience is broad (no custom audience to exclude by ID), you may need to build a custom audience representing it first — e.g. create a website audience of recent visitors and exclude that from the other ad set.

### Fix 3: tiered LALs via `starting_ratio`

The classic LAL-overlap fix:

```
# Before: three overlapping LALs at 1%, 3%, 5%
# After: three non-overlapping banded LALs
adadvisor:create_lookalike_audience(name='LAL 0-1%', starting_ratio=0.0, ratio=0.01, ...)
adadvisor:create_lookalike_audience(name='LAL 1-3%', starting_ratio=0.01, ratio=0.03, ...)
adadvisor:create_lookalike_audience(name='LAL 3-5%', starting_ratio=0.03, ratio=0.05, ...)
```

Then swap the targeting on the existing ad sets:

```
adadvisor:update_adset_targeting(
  adset_id=<mid_lal_adset>,
  custom_audiences=[{id: <new_1_3_lal>, name: 'LAL 1-3%'}]
)
```

### Fix 4: campaign consolidation

When an account has 8+ campaigns, each with 3-4 ad sets, the overlap surface area becomes unmanageable. The senior buyer's response (Pilothouse, CTC, Foxwell): consolidate to 1-3 campaigns with well-structured ad sets. The "Power 5" thesis from 2020 (single CBO, broad audiences, broad placements) was overstated, but the consolidation impulse is correct — fewer, bigger ad sets out-deliver many small ones.

The MCP makes this easier because all `list_*` calls return enough structure to map the overlap surface in a single pass.

## Diagnosis workflow

When a user complains "CPMs are up and ROAS dropped — nothing's changed":

```
1. adadvisor:list_campaigns(account_id) → enumerate live campaigns
2. adadvisor:list_adsets(account_id) → enumerate live ad sets, get targeting fields
3. Compare custom_audiences across ad sets — look for repeats
4. Check for ASC + manual coexistence
5. Check for LAL stacking without starting_ratio
6. adadvisor:get_timeseries(entity_type='account', date_range='last_60d')
   → look for CPM trend; sudden CPM rise correlates with structural overlap
7. Report findings with remediation plan
```

If overlap is the cause and is fixed cleanly, expect CPMs to recover 10-20% within 7-14 days.

## Anti-patterns

- Running 5 ad sets each at 1%, 2%, 3%, 4%, 5% LAL on the same seed without `starting_ratio`. Massive overlap; consolidate to banded LALs.
- "Just duplicating the winner to scale" without changing audience or adding exclusions. Creates a perfect 100%-overlap pair.
- Ignoring Meta's in-app overlap warnings because "the ROAS is still good." It's good for now; CPMs are the leading indicator.
- Adding exclusions only to ASC and not to manual prospecting (or vice versa). Exclusions must be symmetric or you've only fixed half the problem.
- Treating overlap as something Meta sorts out automatically. The auction is per-impression; Meta cannot sort overlap retroactively.

## References cited

- Meta's in-app Audience Overlap tool documentation.
- Common Thread Collective podcast on auction-bidding mechanics.
- Pilothouse / Foxwell on campaign consolidation (2024-2025).
- Lebesgue 2025: average overlap cost = 12-18% of effective spend.
