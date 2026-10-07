## The $1K → $10K/day scale plan — three stages

Most operators stall at $5K-$10K/day. The reason is rarely tactical — it's that they protect a misleading ROAS instead of optimizing for marginal profit on marginal spend. This playbook covers the structural sequence for getting from $1K/day to $10K/day, the per-stage thresholds, and the discipline that separates operators who break through the wall from operators who flatten at $5K.

Synthesizes Disruptive Digital (Pawliw), Theriot Digital, Common Thread Collective, Pilothouse, and Tichenor / Faris bid-strategy frameworks.

## The three stages

| Stage | Range | Duration | Primary play |
|---|---|---|---|
| 1 | $1K → $2.5K/day | 2-4 weeks | Vertical scale on confirmed winners |
| 2 | $2.5K → $5K/day | 2-6 weeks | Horizontal expansion + ASC + creative cadence |
| 3 | $5K → $10K/day | 4-8 weeks | Bid-strategy diversification + brand layer |

Total elapsed: 8-18 weeks depending on creative production cadence and account maturity. Faster than 8 weeks requires accepting CPA inflation and tighter kill rules. Slower than 18 weeks usually means the account isn't ready — the offer, margin, or LTV doesn't support the scale ambition.

## Stage 1 — $1K → $2.5K/day (2-4 weeks)

**Objective:** lock in vertical scale on the 3-5 confirmed winning creatives and 1-2 winning ad sets.

### Plays

| Play | Mechanics |
|---|---|
| Vertical 20% every 2-3 days on winners | Don't double; CBO budget bumps >50% trigger relearn |
| Add 1-2 ad sets with broader audience | Broaden geo or move from LAL 1% → LAL 1-3% banded |
| Lock 3-5 winning creatives, retire underperformers | CTR + CPA matter; don't keep a creative for nostalgia |
| Tighten exclusions | Add Purchasers 90D to every prospecting ad set if not already |

### MCP call sequence — daily ops at Stage 1

```
# Morning audit
adadvisor:get_performance(level='campaign', date_range='last_7d')
adadvisor:get_performance(level='adset', date_range='last_3d')
adadvisor:get_performance(level='ad', date_range='last_3d')

# Identify winners (ROAS ≥ 1.2× target for 3+ days)
# For each winner:
adadvisor:change_entity_budget(
  entity_type='adset' or 'campaign',
  entity_id=<winner>,
  daily_budget=<current × 1.2>
)

# Kill losers (ROAS < 0.5× break-even for 3 days)
adadvisor:change_entity_status(entity_type='ad', entity_id=<loser>, action='pause')
```

### Thresholds at Stage 1

| Metric | Expected | Action if exceeded |
|---|---|---|
| ROAS | 1.0-1.3× target | Hold and scale if ≥1.2× for 3 days |
| CPA inflation vs Stage 0 | 0-10% | Normal — scaling has cost |
| Frequency on winners | 1.5-2.5/week | Refresh creative if >3 |
| Ad set learning status | Active learning | Wait if learning; don't budget-bump in learning |

### When to advance to Stage 2

- 3 stable days at the new spend level
- Winners hold ≥1.2× target ROAS
- Creative library has 3-5 production-ready new concepts queued

## Stage 2 — $2.5K → $5K/day (2-6 weeks)

**Objective:** transition from vertical-only to horizontal scaling. Layer ASC alongside manual prospecting. Establish weekly creative production cadence.

### Plays

| Play | Mechanics |
|---|---|
| Horizontal expansion: LAL bands (1-3%, 3-5%) | Each new ad set targets a non-overlapping band; see [`adadvisor-targeting/references/lookalike-strategy.md`](../../adadvisor-targeting/references/lookalike-strategy.md) |
| Geo expansion: CA, UK, AU one at a time | One geo per week; don't launch 3 simultaneously |
| ASC alongside manual prospecting | With cross-exclusions to prevent overlap |
| Weekly creative production: 2-3 new concepts/week | UGC + product feature + comparison — rotate angles |
| Track MER, not just campaign ROAS | At $2.5K+/day, MER (total revenue / total marketing spend) is the right number |

### Structure at Stage 2

```
Campaigns at this stage (typical):
├── Manual Prospecting CBO
│   ├── Broad ad set (US)
│   ├── LAL 0-1% (US)
│   ├── LAL 1-3% banded (US)
│   └── LAL 3-5% banded (US)
├── ASC (Advantage+ Shopping)
│   └── (1 ad set; Meta-managed)
├── Manual Prospecting CBO (CA)
│   └── (mirror of US, smaller budget)
└── Retargeting CBO
    ├── AddToCart 30D
    ├── ViewContent 60D
    └── Site Visitors 30D
```

### MCP call sequence — adding a new geo

```
# Step 1: Identify a winning US ad set
adadvisor:list_adsets(account_id, fields=['name', 'targeting'])
adadvisor:get_performance(level='adset', adset_ids=[<candidates>], date_range='last_14d')

# Step 2: Duplicate with deep copy
adadvisor:duplicate_adset(
  source_adset_id=<winner>,
  target_campaign_id=<same campaign or new geo campaign>,
  deep_copy=True
)
# Returns new adset_id with status PAUSED

# Step 3: Update targeting to the new geo
adadvisor:update_adset_targeting(
  adset_id=<new>,
  countries=['CA'],
  age_min, age_max  # same as US winner
)

# Step 4: Build geo-specific LAL if going beyond broad
adadvisor:create_lookalike_audience(
  origin_audience_id=<seed>,
  country='CA',
  ratio=0.01
)
# Wait 1-6 hours for populate

# Step 5: Set budget at 30-50% of US winner
adadvisor:change_entity_budget(
  entity_id=<new>,
  daily_budget=<US_winner × 0.4>
)

# Step 6: Activate
adadvisor:change_entity_status(entity_id=<new>, action='resume')
```

### Thresholds at Stage 2

| Metric | Expected | Action if exceeded |
|---|---|---|
| ROAS | 0.9-1.2× target | Hold; CPA inflation is expected at horizontal expansion |
| CPA inflation vs Stage 1 | 10-20% | Normal; bake into target ROAS expectation |
| MER | 2.5×-4× depending on margin | If MER drops below break-even, slow scale |
| Net New Reach (Curtis Howland) | ≥40% of impressions to new users | If declining, audience saturation is approaching |

### When to advance to Stage 3

- ≥7 stable days at $5K/day
- Horizontal layers (LAL bands, new geos) holding their own
- Creative production at 3-4 new concepts/week
- MER ≥ 3.0× for the past 14 days

## Stage 3 — $5K → $10K/day (4-8 weeks)

**Objective:** diversify bid strategies. Add brand/awareness layer. Push creative production cadence. This is where most operators stall.

### Plays

| Play | Mechanics |
|---|---|
| Bid-cap diversification (Tichenor) | Split winners: some on Lowest Cost, some on Cost Cap at target × 1.2 |
| Target ROAS campaigns (Faris) | One campaign with `bid_strategy='LOWEST_COST_WITH_MIN_ROAS'`; floor at break-even |
| Brand / awareness at 10-15% of spend | OUTCOME_AWARENESS or REACH, broad, no exclusions |
| Creative production: 4+ new concepts/week | Multi-format: video, image, carousel, IG Reels |
| MER-driven decisions, not ROAS-driven | At this scale, campaign ROAS is increasingly cannibalistic |

### Bid strategy diversification — the Tichenor framework

| Bid strategy | Use for | Trade-off |
|---|---|---|
| LOWEST_COST_WITHOUT_CAP | Top-of-funnel prospecting; new concept tests | Max signal, less control |
| COST_CAP (target × 1.2) | Confirmed winners that need volume protection | Caps downside; some delivery sacrificed |
| LOWEST_COST_WITH_MIN_ROAS | Mature, high-confidence campaigns | Best on retargeting where ROAS is predictable |
| BID_CAP | Niche use; very controlled CPA | Hardest to scale; rarely worth it past Stage 1 |

```
adadvisor:update_entity(
  entity_type='adset', entity_id=<winner>,
  bid_strategy='COST_CAP',
  bid_amount=<target_cpa × 1.2>  # major units
)
```

### Target ROAS (Faris method)

For mature campaigns with stable conversion patterns:

```
adadvisor:create_adset(
  bid_strategy='LOWEST_COST_WITH_MIN_ROAS',
  bid_amount=<break_even_ROAS × 100>,  # ROAS encoded as integer × 100
  ...
)
```

Floor the campaign at break-even — Meta won't deliver below that ROAS. Useful as a safety net at scale; constraining when applied too tight.

### Brand/awareness at 10-15%

Often-skipped at scale but materially compounds:

```
adadvisor:create_campaign(objective='OUTCOME_AWARENESS', name='Brand || US')
adadvisor:create_adset(
  optimization_goal='REACH', countries=['US'],
  daily_budget=<total × 0.10>,
  advantage_audience=true
  # No exclusions — brand reaches everyone
)
```

The MER lift from brand campaigns shows up 30-60 days later, not immediately. Operators who only optimize on 7-day campaign ROAS will kill the brand campaign before it pays back.

### Thresholds at Stage 3

| Metric | Expected | Action if exceeded |
|---|---|---|
| ROAS | 0.8-1.1× target | Acceptable; protect MER, not campaign ROAS |
| CPA inflation vs Stage 2 | 10-20% | Normal; the marginal-spend cost rises |
| MER | 2.5×-4× | Floor; below this, scale is unprofitable |
| New-customer rate | ≥60% of conversions | If <40%, retargeting is cannibalizing prospecting |
| Creative refresh cadence | Every 7-10 days at winners | Fatigue compounds at scale |

## Why most operators stall at $5K-$10K/day

The frame that breaks the wall:

> "Optimize for marginal profit on marginal spend, not for average ROAS." — Pawliw (Disruptive Digital), CTC podcast

Consider:

| Spend level | Average ROAS | Marginal ROAS (last 20% of spend) |
|---|---|---|
| $5K/day | 3.0× | 3.0× |
| $7K/day | 2.8× | 2.0× |
| $10K/day | 2.5× | 1.5× |

At $10K/day, average ROAS (2.5×) looks bad, but marginal ROAS (1.5×) is what determines whether the next dollar is profitable. If 1.5× exceeds break-even (e.g. break-even is 1.4× because contribution margin is 71%), every marginal dollar is still profitable — even though the average ROAS has dropped from peak.

Operators who protect average ROAS slow down before they hit unprofitable marginal spend. The discipline: read marginal performance via `adadvisor:get_timeseries` and segment the last week of spend changes, not the full 30-day average.

## Anti-patterns

- Doubling budgets to scale faster. >50% CBO budget changes trigger relearn; lose 7 days of momentum.
- Scaling vertically past the audience-size budget capacity. A 5M-reach LAL can support $1-2K/day; above that, frequency exceeds 4 in a week and ROAS collapses.
- Killing the brand campaign because its 7-day ROAS is 0.8×. Brand pays back over 30-60 days.
- Adding 3 new geos at the same time. Each launch needs validation; serializing prevents diagnosis confusion.
- Protecting average ROAS at $10K/day. Look at marginal ROAS on the last 20% of spend.
- Skipping MER tracking. Campaign ROAS at scale is mostly cannibalistic; MER is the company-level truth.
- Running 8 campaigns at this scale because "more is more." Consolidate; overlap and structural debt are real.

## References cited

- Disruptive Digital (Pawliw), $1K-$10K scale framework.
- Theriot Digital, horizontal-scale mechanics.
- Common Thread Collective (Taylor Holiday), MER-vs-ROAS doctrine.
- Tichenor, bid-cap diversification.
- Faris, Target ROAS campaign structure.
- Pilothouse (Ray Jang), creative cadence at scale.
- Curtis Howland, Net New Reach framing.
