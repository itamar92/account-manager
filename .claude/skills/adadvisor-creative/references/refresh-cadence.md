## Creative refresh cadence

Creative is responsible for 70-89% of Meta ad performance (AppsFlyer 2025, Nielsen). At any non-trivial spend, the rate-limiting input on an ad account is creative production. This reference is the schedule — by spend tier — and the early-warning cues for refreshing sooner.

The core principle: **refresh ≠ replace.** Winners keep running while you introduce fresh creatives that overlap with the existing ones for 3-5 days. The fatigued ad gets paused only when the new creative has proven it can carry the spend.

## Refresh schedule by daily spend

| Daily spend | Refresh cadence | New concepts per cycle | Operational template |
|---|---|---|---|
| $100-$200/day | Every 2-3 weeks | 1-2 net-new | Monthly production day; queue 4-6 weeks ahead |
| $200-$1K/day | Every 7-14 days | 2-3 net-new | Bi-weekly production sprint; 2-3 hook variations per concept |
| $1K-$10K/day | Every 7-10 days | 4-6 net-new | Weekly production; in-house or rotating UGC creator pool |
| $10K+/day | Weekly | 4-6 net-new | Dedicated creative ops; UGC creator pipeline + studio team |

Volume of *new concepts* matters more than total ad count in rotation. Foxwell / Motion consensus (2026): brands shipping 4 net-new concepts/week beat brands with 50 stale ads, every time.

A "concept" is a distinct angle or value-prop framing. A "variation" is a hook/body/CTA permutation of the same concept. 4 concepts × 3 variations each = 12 net-new ads per week at the $10K+/day tier.

## Why cadence scales with spend

- **Frequency compounds faster.** At $100/day, your audience sees an ad maybe twice in two weeks. At $10K/day, the same audience sees it 6 times in three days. Fatigue accumulates with frequency, not with calendar time.
- **CPM rises with spend.** Diminishing returns kick in as you climb auctions; new creative buys back some of the lost efficiency.
- **The signal density is higher.** At scale, you can read winners and losers within 48 hours. The system can absorb more frequent injections without drowning in noise.

## Detection cues for needing refresh sooner

The schedule is a default. Real refresh cadence should respond to leading indicators:

| Signal | Threshold | What it means |
|---|---|---|
| Frequency on prospecting | >3.0 | Audience is seeing the same creative too often |
| Frequency on retargeting | >6.0 | Retargeting audience is saturating |
| CTR decay week-over-week | -20% or worse | Viewers stopped clicking the same hook |
| CPM creep | +15% week-over-week with stable audience | Auctions getting more expensive on the same creative |
| Hook rate decay | -20% week-over-week | Creative is no longer stopping the scroll |
| Net New Reach (Curtis Howland) | Trending down | Audience exhausted; new creative reactivates new viewers |

If any two of these fire simultaneously, accelerate refresh — don't wait for the calendar.

Detection via MCP:

```
adadvisor:get_timeseries(entity_id=<ad_id>, entity_type='ad', days=14)
  → look at the daily ctr, frequency, and cpm columns
  → compute the week-over-week delta on each
adadvisor:get_performance(level='ad', entity_id=<ad_id>, date_range='last_7_days')
  → confirm against headline performance numbers
```

## Refresh execution — keep winners overlapping

The wrong way: pause the fatigued ad on Monday, launch the new ad Monday. Result: ad set goes back into learning, learning resets, CPA spikes for 5-7 days.

The right way:

```
Day 0 — Launch new creative alongside the fatigued one
  adadvisor:create_creative(...) → creative_id
  adadvisor:create_ad(adset_id=<live ad set>, creative_id=...)
  adadvisor:change_entity_status(entity_type='ad', entity_id=<new>, action='resume')
  → ad set now has both the old and new ads competing

Day 3-5 — Evaluate the new creative
  adadvisor:get_performance(level='ad', entity_id=<new>)
  → if hook rate ≥ old, CTR ≥ old, CPA ≤ old × 1.2 — promote it
  → if not, kill the new and try another concept

Day 5-7 — Retire the fatigued one
  adadvisor:change_entity_status(entity_type='ad', entity_id=<old>, action='pause')
  → ad set transition is smooth; no learning reset because the new creative was already proven
```

The overlap period is the operational discipline. It costs 3-5 days of double-running, but it prevents the much more expensive cost of resetting an entire ad set's optimization.

## Producing the volume

### $100-$200/day tier

Monthly production day. Founder or a single contractor produces 2-3 UGC concepts. Variations come from hook + CTA swaps on the same body. Total ads in rotation: 6-12.

### $200-$1K/day tier

Bi-weekly sprints. Mix of UGC (1-2 concepts) + static design (1-2 concepts). Variations: 2-3 hooks per concept. Total ads in rotation: 12-25.

### $1K-$10K/day tier

Weekly production cycle. UGC creator pipeline (3-5 active creators on rotation) feeding 2-3 UGC concepts per week + in-house or contracted designer for 1-2 static or animated concepts. Variations: 3 hooks × 2-3 bodies per concept. Total ads in rotation: 30-80.

### $10K+/day tier

Dedicated creative operations role. UGC pipeline (8-15 creators), in-house or contracted studio team, weekly briefing meeting. 4-6 net-new concepts shipping every Tuesday, ad set rotation refreshing weekly. Total ads in rotation: 80-200. At this scale, ad management itself is a full-time job.

## Cadence by ad set lifecycle

A given ad set passes through a creative lifecycle:

| Phase | Days | Creative state |
|---|---|---|
| Launch | 0-7 | Fresh creatives; high hook rate, building optimization |
| Steady-state | 7-21 | Stable performance; monitor for fatigue signals |
| Pre-fatigue | 21-35 | Frequency rising; introduce 1-2 new variants |
| Refresh | 35+ | Cycle in net-new concepts; retire fatigued ads |

For high-frequency cycles (>$1K/day), the entire lifecycle compresses to 14-21 days end-to-end.

## What not to refresh

Some ads earn the right to keep running past the standard cadence. Diagnostic:

- The ad has accumulated significant social proof (>1,000 reactions, dozens of comments).
- It's an `existing_post` creative with a viral organic moment behind it.
- Its hook rate has not decayed despite frequency rising.

For these, keep them running indefinitely; refresh the *companion* ads in the ad set instead. The social-proof anchor compounds over time and is hard to replace.

## What "kill creative" vs "refresh creative" means

Different signals trigger different actions:

- **Bad creative (didn't ever win):** kill outright. After $50-$100 spend with no conversions and hook rate <15%, it's not coming back.
- **Fatigued winner:** refresh by introducing alternatives — keep it running until the replacement proves out.
- **Tiring across the account:** check if all creatives share a common element (same product angle, same testimonial source). If so, fatigue is at the *angle* level, not the *ad* level. Refresh the angle entirely.

## Anti-patterns

- Refreshing the calendar without refreshing the angle. Same UGC creator, same product framing, new ad ID. Audience treats it as the same ad — frequency keeps climbing.
- Replacing 1:1. Pausing 5 ads on Monday and launching 5 ads on Monday. Almost guaranteed learning reset for the ad set.
- Refreshing too soon. If hook rate is still healthy and CTR is steady, refreshing wastes production budget. Let it run.
- Ignoring social-proof anchors. Pausing an ad with 2,000 reactions because it's "old" — that social proof is irreplaceable.
- Producing 4 variations of the same hook and calling it 4 new concepts. A new concept is a new angle, not a new word choice.

## Cross-references

- [`creative-fatigue.md`](creative-fatigue.md) — diagnostic signals in detail.
- [`testing-frameworks.md`](testing-frameworks.md) — frameworks to use within each refresh cycle.
- [`hook-library.md`](hook-library.md) — generating hook variations for new concepts.
- [`existing-post.md`](existing-post.md) — preserving the social-proof anchors that earn extended runs.
