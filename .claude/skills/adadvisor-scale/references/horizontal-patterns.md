## Horizontal scaling patterns

Horizontal scaling duplicates a proven winner into adjacent contexts — new audience, new geo, new placement structure — to open auctions that vertical scaling can't reach. This reference is the cookbook: each pattern lists the exact MCP call sequence and starting-budget guidance.

The starting-budget rule of thumb: **half of the source ad set's current daily budget** while you validate. New ad set re-enters learning; you don't want to spend the same on day 1 of unproven duplication as you do on a known winner.

## Pattern 1 — New geo

Duplicate the winner into a new country (or set of countries). Keep creative, audience structure (LAL or interests), and bid strategy. Only swap geo.

### When to use

- US winner stable for 14+ days; AOV / margin works in CA, AU, UK, etc.
- Source audience is saturating (frequency >3, Net New Reach declining).
- You've validated that fulfillment, shipping, and currency support the new geo.

### Sequence

```
1. adadvisor:duplicate_adset(
     adset_id=<winner>,
     deep_copy=True
   )
   → new_adset_id (status='PAUSED')

2. adadvisor:update_adset_targeting(
     adset_id=<new_adset_id>,
     countries=['CA']    # the new geo
     # custom_audiences/interests preserved from the source by default
   )

3. adadvisor:change_entity_budget(
     entity_id=<new_adset_id>,
     entity_type='adset',
     daily_budget=<source_budget × 0.5>
   )

4. adadvisor:change_entity_status(
     entity_type='adset',
     entity_id=<new_adset_id>,
     action='resume'
   )
```

### Starting budget

Half of source. Example: source running at $400/day in US → new CA ad set at $200/day. Re-evaluate at day 5; if CPA is within target × 1.3, raise to source's level. If above target × 1.5, kill and try a different geo.

### Expected behavior

- Days 1-3: learning, CPA elevated 30-50%.
- Days 4-7: settles toward 10-20% above source CPA (new geo never matches source exactly).
- Net result: typically adds 30-60% of source spend volume at modestly worse CPA.

## Pattern 2 — Next LAL tier

The cleanest horizontal scale on a Meta-mature account. Duplicate the winner; swap the lookalike to a wider band (1% → 3% → 5%).

### When to use

- 1% LAL has been the workhorse and is starting to fatigue.
- You've confirmed the seed audience is healthy (≥1,000 high-quality records, recent).
- Account spend ≥$1K/day — below this, the LAL bands collapse into each other and the duplication is wasted.

### Sequence

```
1. (If the LAL doesn't exist) adadvisor:create_lookalike_audience(
     seed_audience_id=<purchase or high-LTV seed>,
     country='US',
     ratio=0.03  # 3%
   )
   → new_lal_audience_id

2. adadvisor:duplicate_adset(
     adset_id=<winner>,
     deep_copy=True
   )
   → new_adset_id

3. adadvisor:update_adset_targeting(
     adset_id=<new_adset_id>,
     custom_audiences=[<new_lal_audience_id>]
     # interests/geo/etc preserved
   )

4. adadvisor:change_entity_budget(
     entity_id=<new_adset_id>, entity_type='adset',
     daily_budget=<source_budget × 0.5>
   )

5. adadvisor:change_entity_status(
     entity_type='adset', entity_id=<new_adset_id>, action='resume'
   )
```

Build the ladder: 1% → 3% → 5% → 10%. Each tier produces wider reach at typically 15-30% worse CPA than the previous tier. Stop laddering when the next tier doesn't justify its CPA against target.

### Starting budget

Half of source per tier. The portfolio total ends up roughly equal to (or greater than) the source as you ladder.

## Pattern 3 — Duplicate creative to a different ad set

Not duplicating the ad set — duplicating an *ad* to attach a known-winner creative to a different audience. This is the cleanest way to test "is the audience or the creative driving the result?"

### When to use

- A specific creative is winning in one ad set; you want to know if it carries over to a different audience.
- You're refreshing a fatigued ad set and want to inject a known winner from elsewhere in the account.
- Avoiding the overhead of recreating the creative object (which would lose social proof if reused later).

### Sequence

```
1. adadvisor:list_ads(adset_id=<source_winner_adset>)
   → identify the winning ad's id

2. adadvisor:duplicate_ad(
     ad_id=<winning_ad>,
     target_adset_id=<destination_adset>
   )
   → new_ad_id (PAUSED, in destination_adset)

3. adadvisor:change_entity_status(
     entity_type='ad', entity_id=<new_ad_id>, action='resume'
   )
```

`duplicate_ad` reuses the creative object, preserving social-proof engagement (likes, comments, shares) from any other ad using the same creative.

### Starting budget

N/A — the destination ad set has its own budget. The new ad just joins the rotation. Expect 5-15% of the destination ad set's traffic to route to the new ad as Meta evaluates it.

## Pattern 4 — Campaign-structure switch (CBO ↔ ABO, or new ASC)

Less common, higher leverage. You're not adding budget; you're restructuring how the budget is allocated.

### When to use

- ABO ad set is winning but the campaign as a whole is wasting budget on losers. Move winner to a CBO campaign for algorithmic allocation.
- CBO campaign is over-allocating to one ad set, starving the others. Move to ABO so you can manually balance.
- Testing ASC alongside manual — you want a fresh ASC campaign without disturbing the manual setup.

### Sequence — winner ABO → new CBO

```
1. adadvisor:duplicate_campaign(
     campaign_id=<source_campaign>,
     deep_copy=False   # shell only — no ad sets/ads copied
   )
   → new_campaign_id (CBO, PAUSED)

2. adadvisor:update_entity(
     entity_type='campaign',
     entity_id=<new_campaign_id>,
     fields={
       'budget_optimization': True,
       'daily_budget': <target_daily>,
       'name': '<descriptive CBO name>'
     }
   )

3. For each winner adset_id to move:
   adadvisor:duplicate_adset(
     adset_id=<winner>,
     target_campaign_id=<new_campaign_id>,
     deep_copy=True
   )

4. adadvisor:change_entity_status(
     entity_type='campaign', entity_id=<new_campaign_id>, action='resume'
   )
   # then resume each ad set inside
```

### Sequence — fresh ASC alongside manual

```
1. adadvisor:create_campaign(
     campaigns=[{
       'name': 'ASC Prospecting',
       'objective': 'OUTCOME_SALES',
       'special_ad_categories': [],
       'is_advantage_plus_shopping': True,
       'daily_budget': <ASC_daily>
     }]
   )
   → asc_campaign_id

2. Create the manual exclusion on existing campaigns:
   adadvisor:update_adset_targeting(
     adset_id=<each existing prospecting adset>,
     excluded_custom_audiences=[<existing-customer LAL>]
   )

3. Resume the ASC campaign and its ad sets after creative is attached.
```

### Starting budget

For CBO/ABO switches: match the source campaign's spend so you don't lose volume during the transition.

For ASC-alongside-manual: start ASC at 20-30% of total account spend; track new-customer rate separately on each. Foxwell's framing: if ASC's new-customer rate is materially higher than the manual setup at comparable CPA, ASC keeps growing; if not, ASC is just cannibalizing.

## Pattern 5 — Interest-stack expansion

Duplicate to a different interest cluster (broader or narrower). Lighter touch than LAL ladders.

### When to use

- A specific interest stack is winning but saturating; you want to test an adjacent interest cluster.
- Going broader: from "yoga + meditation" to "wellness" (the broader category).
- Going narrower: from "fitness" to "powerlifting + strength training" (the niche slice).

### Sequence

```
1. adadvisor:search_targeting(query='<new_interest>', type='interests', limit=20)
   → list of valid interest IDs

2. adadvisor:duplicate_adset(adset_id=<source>, deep_copy=True)
   → new_adset_id

3. adadvisor:update_adset_targeting(
     adset_id=<new_adset_id>,
     interests=[<list of new interest IDs>]
   )

4. adadvisor:estimate_audience_size(
     # the MCP will read the targeting from the adset
     adset_id=<new_adset_id>
   )
   → confirm reach is in a healthy range (>1M for prospecting, >100K for retargeting)

5. Set budget at half of source; resume.
```

### Starting budget

Half of source. Interest stacks have less predictable CPM than LAL bands; over-budgeting early can produce noisy data.

## Common horizontal-scale failures

- **Skipping `deep_copy=True`.** Shell-only duplication produces an empty ad set with no creative. The duplicate won't deliver until you attach ads.
- **Forgetting to reset budget on the duplicate.** Some MCP responses surface the inherited budget; some don't. Always set the new ad set's budget explicitly.
- **Duplicating an adset that's still in learning.** You're cloning unproven optimization. Wait for the source to exit learning before horizontal-scaling.
- **Stacking horizontal duplications too fast.** 3 new ad sets in one day = 3 fresh learning phases simultaneously. Stagger 24-48 hours apart so each gets monitored.
- **Forgetting exclusions.** Two ad sets targeting overlapping LAL bands without exclusions cannibalize each other. Use `excluded_custom_audiences` to keep them disjoint.

## Cross-references

- [`scaling-axes.md`](scaling-axes.md) — when horizontal is the right axis.
- [`stage-plan-1k-to-10k.md`](stage-plan-1k-to-10k.md) — when horizontal patterns slot into the stage plan.
- [`bid-cap-method.md`](bid-cap-method.md) — the next step after horizontal expansion saturates.
- Sibling skill `adadvisor-targeting` — targeting-API specifics.
