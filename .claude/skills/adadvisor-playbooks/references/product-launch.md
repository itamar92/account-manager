## Product launch playbook — the first 30 days

Launching a product on Meta that the platform has never seen perform is structurally different from scaling an existing winner. Meta has no signal, the creative library is unproven, and your kill thresholds need to be tighter than normal to avoid burning through learning budget on early flops.

This playbook covers pre-launch seeding, launch-week structure, validation, and the transition to standard scaling. Synthesizes Common Thread Collective, Motion, Pilothouse, and Sarah Levinger's creative framework.

## The four phases

| Phase | Days | Goal |
|---|---|---|
| Pre-launch | T-2 weeks to T-0 | Build retargeting seed; surface working creative angles |
| Launch | Day 1-7 | Volume prospecting + parallel creative testing; collect signal |
| Validation | Day 7-14 | Identify true winners with ≥3 stable days; kill flops aggressively |
| Scale | Day 14+ | Standard scaling (vertical → horizontal); see scale-1k-to-10k.md |

## Phase 1 — Pre-launch (T-2 weeks)

**Objective:** seed the retargeting audience pool with people who've shown interest in adjacent content, so Day 1 retargeting has somewhere to land.

Without pre-launch seeding, retargeting on Day 1 is an empty bucket. Most launches that "didn't work" on Meta lost because they had no warm-1 audience to convert at the launch CPM peak.

```
adadvisor:create_campaign(
  objective='OUTCOME_ENGAGEMENT',  # OR 'OUTCOME_TRAFFIC' for traffic seed
  name='Pre-launch || Warm-up'
)
adadvisor:create_adset(
  optimization_goal='THRUPLAY',  # for video; or 'LANDING_PAGE_VIEWS' for traffic
  countries=['US'], age_min=25, age_max=55,
  advantage_audience=true,
  daily_budget=50  # small; this is signal-building, not direct-response
)
adadvisor:create_creative(format='video', ...)  # category-aware content, not the product launch creative
adadvisor:create_ad(...)
adadvisor:change_entity_status(action='resume')
```

Concurrent: pre-test 3-5 product-specific creative concepts at $30-50/day each on broad to surface which concept angles already have signal. The winners become Day 1 launch ads.

Pre-launch budget: ~10-15% of expected launch-week daily budget. Two weeks × that share = enough to build a 20K-100K warm-1 audience depending on country.

## Phase 2 — Launch week (Day 1-7)

**Objective:** maximize signal collection while testing 5-8 distinct creative angles. Bid for volume, not efficiency.

### Campaign structure

Run two campaigns side-by-side from Day 1:

| Campaign | Why |
|---|---|
| ASC (Advantage+ Shopping) | Meta's auto-targeting on a fresh product picks up signal Meta can't see in manual |
| Manual prospecting CBO | Controlled creative + audience testing |

Exclusions are critical — see [`adadvisor-targeting/references/exclusion-patterns.md`](../../adadvisor-targeting/references/exclusion-patterns.md):

```
# ASC excludes manual-prospecting audience (or builds-in via Existing Customer Cap)
# Manual prospecting excludes ASC's likely reach (Site Visitors 7D)
```

### Creative concept matrix — 5-8 distinct angles in week 1

This is non-negotiable. Sarah Levinger's framing: each concept tests a different psychological frame. You don't know which one works for *this* product until you've tested several.

| Angle | Hook | Typical format |
|---|---|---|
| Problem-aware | "If you've ever struggled with X..." | Talking-head UGC, 15-30s |
| Solution-aware | "There's a new way to..." | Product demo, 15-20s |
| Product-feature | "[Feature X] is the reason..." | Close-up product shot, 8-12s |
| Founder-story | "I built this because..." | Authentic founder UGC, 30-45s |
| Comparison | "vs. [alternative]" | Side-by-side demo, 15-20s |
| UGC testimonial | "[Customer name] used it and..." | Real customer footage, 15-20s |
| Listicle | "3 reasons [product] works" | Quick-cut animated text, 15s |
| Trend-jack | Reference to current cultural moment | Whatever the moment is |

Pick 5-8 of these, produce them in week T-1, launch all of them on Day 1. The MCP supports batched ad creation:

```
adadvisor:create_creative([...5-8 creatives...])  # batched
adadvisor:create_ad([...5-8 ads...])              # batched, attached to ad sets
adadvisor:change_entity_status(...)               # bulk activate
```

### Bid strategy — Lowest Cost for first 7 days

Meta needs signal. Cost Cap and ROAS-based bidding constrain delivery — fine once Meta knows what works, terrible on Day 1 when Meta doesn't.

```
adadvisor:create_adset(
  ...
  bid_strategy='LOWEST_COST_WITHOUT_CAP',  # default; max signal
)
```

Switch to Cost Cap only after Day 7 when CPA stabilizes.

### Launch-week budgets

- ASC: 50-60% of launch budget
- Manual prospecting CBO: 30-40% of launch budget
- Retargeting (Warm-1 from pre-launch + Day 1 visitors): 10-20%

Total daily budget: at least 5× target CPA per ad set per day. Meta exits learning at 50 events in 7 days — that's ~7 events/day per ad set, which at target CPA × 7 events = your minimum daily budget for learning.

## Phase 3 — Validation (Day 7-14)

**Objective:** separate true winners from launch-week noise.

### Kill thresholds (tighter than normal)

Standard scaling kills at 0.5× break-even ROAS over 3 days. Launch validation kills harder because you have no benchmark.

| Threshold | Action |
|---|---|
| 3× target CPA with zero conversions, ≥$100 spend | Kill the ad |
| 2× target CPA over 3 days, any volume | Kill the ad |
| <0.7× break-even ROAS over 5 days | Kill the ad |
| Frequency >4 in 7 days with no scaling | Kill the ad (fatigue, not opportunity) |
| Stable CPA ≤ target × 1.2 over 3 days | Hold and prepare to scale |
| Stable CPA ≤ target over 3 days | Scale (Phase 4) |

```
adadvisor:get_performance(level='ad', ad_ids=[...], date_range='last_7d')
# For each ad below threshold:
adadvisor:change_entity_status(entity_type='ad', entity_id=<ad>, action='pause')
```

### Concept-level vs ad-level

Validate at the concept level, not just the ad level. If two ads of the same concept (e.g. two UGC testimonials with different actors) both perform, the concept is the winner — produce more variants.

Motion's frame: launch tests *concepts*; scaling iterates *variants within winning concepts*.

### Identify the winning angle by Day 10-14

By Day 14, you should know:
- Which 2-3 concept angles are working for this product
- Which audience layer (ASC vs manual prospecting vs LAL) has the cleanest CPA
- Whether the offer holds — if CPA on the best angle is still 2× target, the *offer* may be the bottleneck, not the creative

## Phase 4 — Scale (Day 14+)

Once you have ≥3 days of stable CPA at or below target:

| Step | Action |
|---|---|
| 1 | Vertical scale on winners: 20% budget increase every 2-3 days |
| 2 | Horizontal expansion: duplicate winners into new audiences (LAL 3-5%, geo) |
| 3 | Switch Lowest Cost → Cost Cap on the most stable winners |
| 4 | Begin scheduled creative production cadence (4+ new concepts/week at $1K+/day) |
| 5 | Refresh creative every 7-10 days |

Full mechanics in [`scale-1k-to-10k.md`](scale-1k-to-10k.md).

## MCP call sequence — Day 1 launch

```
# Step 1: Confirm pre-launch warm-up has built audiences
adadvisor:list_custom_audiences(account_id, search='site visitors')
adadvisor:list_custom_audiences(account_id, search='video viewer')

# Step 2: Build any retargeting audiences not yet present
adadvisor:create_website_audience(name='AddToCart 30D', event_name='AddToCart', ...)
adadvisor:create_website_audience(name='ViewContent 60D', event_name='ViewContent', ...)
adadvisor:create_website_audience(name='Purchasers 90D', event_name='Purchase', ...)

# Step 3: Create ASC campaign + ad set
adadvisor:create_campaign(objective='OUTCOME_SALES', smart_promotion_type='AUTOMATED_SHOPPING_ADS', ...)
adadvisor:create_adset(...)

# Step 4: Create manual prospecting CBO + ad sets
adadvisor:create_campaign(objective='OUTCOME_SALES', name='Launch || Manual CBO', ...)
adadvisor:create_adset([...]),  # batched — broad, 1% LAL, 3-5% LAL
  # excluded_custom_audiences=[Purchasers 90D, Site Visitors 7D]

# Step 5: Create retargeting CBO
adadvisor:create_campaign(objective='OUTCOME_SALES', name='Launch || RET', ...)
adadvisor:create_adset(...)  # AddToCart, ViewContent, Site Visitors with full exclusion chain

# Step 6: Batch-create 5-8 creatives (one per concept angle)
adadvisor:create_creative([...])

# Step 7: Batch-create ads attaching creatives to ad sets
adadvisor:create_ad([...])

# Step 8: Resume from leaf up
adadvisor:change_entity_status(entity_type='ad', action='resume')   # all ads
adadvisor:change_entity_status(entity_type='adset', action='resume') # all ad sets
adadvisor:change_entity_status(entity_type='campaign', action='resume') # all campaigns
```

## Anti-patterns

- Launching with 1-2 creatives "to see what works." Not enough signal; you'll kill the wrong things.
- Skipping pre-launch warm-up. Retargeting is empty on Day 1; you've burned a critical conversion lever.
- Using Cost Cap or Target ROAS on Day 1. Meta needs signal-collection latitude; constraining the bid kills delivery.
- Killing an ad on Day 3 because CPA is 2× target. Without 50 events, the data is noise. Wait for learning to exit (Day 7) before any kill that isn't 3× CPA + zero conversions.
- Running BFCM playbook + product launch concurrent. Pick one — the operational tempo conflicts.
- Launching with broad targeting only and no LAL because "you don't have a seed yet." Build a Page Visitors / Video Viewer LAL from the pre-launch phase; even imperfect seeds beat broad-only.
- Treating Day 1 ASC CPA as the benchmark. ASC overspends on Day 1 and recalibrates by Day 5-7. Wait.

## References cited

- Sarah Levinger, "5 concept angles" frame (Motion, CTC podcast).
- Common Thread Collective on launch-week structure (Taylor Holiday + Richard Gaffin).
- Motion product-launch postmortems (2024-2025).
- Pilothouse launch playbooks (Ray Jang).
- Andrew Foxwell on kill-rate discipline during launch validation.
