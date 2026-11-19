## Meta's learning phase — what it is, how to detect, what NOT to change

The learning phase is the 7-day window where Meta's algorithm explores the audience-creative-bid combination at higher variance to find the conversion pocket. **Decision rules from `kill-rules.md` and `diagnostic-tree.md` are invalid for entities in learning.** This reference encodes detection signals, exit threshold, reset triggers, and the cost of getting it wrong.

## What triggers learning

A learning phase begins whenever any of these change at the ad-set level:

| Trigger | Detection |
|---|---|
| Ad set created | `created_time` within last 7 days |
| Budget changed by > 20% (up or down) | Compare `daily_budget` vs prior |
| New creative added or removed (≥ 1 ad change) | Ad-set ad count differs from 24h prior |
| Optimization event changed | `optimization_goal` change |
| Conversion event window changed | `attribution_spec` change |
| Audience changed (interests, custom audiences, geo, age, gender) | `targeting` field hash differs |
| Bid strategy changed (e.g., LOWEST_COST → COST_CAP) | `bid_strategy` differs |
| Placement changed (manual ↔ Advantage+ Placements) | `publisher_platforms` differs |
| Ad set status flipped PAUSED → ACTIVE → PAUSED → ACTIVE | Any status flip resets |

Changes at **campaign** level (objective, campaign budget) restart learning on every child ad set. CBO budget changes ≥ 20% restart all child ad sets. Trivial ad-level edits — pausing one ad in a 5-ad set, single-headline change — generally don't reset. When in doubt, assume it reset.

## How to detect learning

Meta exposes the state via the `effective_status` field on the ad set. Possible values:

| `effective_status` | Meaning | Decision impact |
|---|---|---|
| `LEARNING` | In learning phase, on track to exit | Do not change. Pull data but do not act on it. |
| `LEARNING_LIMITED` | In learning, but the math says it won't exit (budget × audience × event volume too low) | Fix one of the three: raise budget OR expand audience OR shallower event |
| `ACTIVE` | Out of learning, optimizing normally | Diagnostic and kill rules apply |
| `INACTIVE` | Not delivering | Check `status`, `configured_status`, and parent statuses |

The MCP surfaces `effective_status` on most read endpoints. When present, `learning_stage_info` may include `status`, `attribution_windows`, and `conversions` — count toward the 50-event threshold.

**MCP query.** `adadvisor:list_adsets(account_id=<id>, campaign_id=<id>)` for `effective_status`. `adadvisor:get_timeseries(entity_type='adset', ...)` to plot spend velocity (learning ad sets spend in bursts, not flat).

If `effective_status` isn't present: ad set < 7 days old AND conversions < 50 → in learning. Spend velocity highly variable, CPA ±50% day-to-day → learning.

## The 50-conversion / 7-day exit threshold

To exit, the ad set needs **50 of its optimization-goal events in a rolling 7-day window**. Crucially: events are ad-set-level (two ad sets at 30 events each don't pool); they must match the optimization goal (Purchase-optimized doesn't exit on 50 AddToCarts); the 7 days roll.

If an entity has been live ≥ 7 days AND has < 50 events in the trailing 7 days, it stays in learning indefinitely. Meta surfaces this as `LEARNING_LIMITED`.

## What NOT to change while in learning

Treat the ad set as locked. Don't change budget (except to escape `LEARNING_LIMITED`, accepting reset), pause/add ads, edit creative copy, edit targeting, change bid strategy, or flip ACTIVE/PAUSED. All reset.

Do: wait. Pull `get_timeseries` to watch progress. Report state to user: "Ad set in learning, 18 conv in last 7 days, ETA to exit ≈ 4-5 days." If user pushes for change, quote the reset cost.

## The cost of resetting learning

Reset forces 5-10 days of inflated CPA. Estimate:

```
reset_cost ≈ (CPA_learning - CPA_steady) × conversions_in_reset_window
```

Example. Steady CPA = $30. Learning CPA ≈ 1.5× = $45. 12 conversions/day × 7 days = 84. Reset cost = $15 × 84 = **$1,260**.

That's $1,260 of incremental spend to "fix" a problem that may not have existed. Always quote this before changing a learning ad set.

## `LEARNING_LIMITED` — how to escape

Budget × audience × event-volume can't produce 50 events/week. Three levers:

1. **Raise budget.** `min_daily_budget = (target_CPA × 50) / 7`. At $30 target: $214/day minimum.
2. **Expand audience.** If audience < 1M and CPA healthy, more reach = more candidates per dollar.
3. **Shallower event.** If Purchase volume < 25/week, drop to AddToCart, then ViewContent, then LANDING_PAGE_VIEWS. Most common fix for sub-$20K/mo accounts. Optimize for AddToCart 30 days, then switch back.

**MCP queries.** `adadvisor:estimate_audience_size(adset_id=<id>)`, `adadvisor:get_pixel_health(...)` for Purchase event count trailing 14 days.

## Edge case — CBO and learning

Under CBO (Campaign Budget Optimization), each ad set still has its own learning phase, but they compete for budget. A weak ad set under CBO will be starved by the algorithm and may never accumulate 50 events. If you see one ad set under CBO at `LEARNING_LIMITED` while siblings exit cleanly, the issue isn't the ad set — it's the CBO allocation. Pause the weak one or migrate to ABO.

## Edge case — Dynamic Creative

Dynamic Creative ad sets (`is_dynamic_creative: true`) need slightly higher event volume because Meta is also learning the asset combination. Treat the threshold as ~75 events / 7 days rather than 50, even though Meta still reports against 50.

## Edge case — Bid Cap and learning

`COST_CAP` and `LOWEST_COST_WITH_BID_CAP` ad sets often take longer to exit learning because the bid ceiling artificially constrains spend velocity. If your Bid Cap is below the auction floor, the ad set won't deliver enough impressions to find 50 events. Raise the cap or switch to LOWEST_COST_WITHOUT_CAP during learning, then switch back.

## When to apply the diagnostic tree vs wait

| Entity state | Apply diagnostic tree? | Apply kill rules? |
|---|---|---|
| `LEARNING` (active, < 50 conv/7d) | No | No (except the 3× rule with zero conv — still valid) |
| `LEARNING_LIMITED` (capped under the threshold) | No (fix the cap first) | No |
| `ACTIVE` (≥ 50 conv / 7d) | Yes | Yes |
| `INACTIVE` (status issue) | N/A — fix activation first | N/A |

The single exception during learning is the 3× rule: spent ≥ 3× target_CPA with zero conversions, regardless of learning state. At triple the test budget with zero signal, the ad set isn't going to find a pocket — kill it and start over.

## Reporting learning state to the user

If in learning:

> "Ad set is in learning — 18 conversions in trailing 7 days against the 50-event exit. CPA during learning runs 30-50% higher than steady state. ETA to exit ≈ 4 days. Don't touch it. Re-diagnose next Wednesday."

If `LEARNING_LIMITED`:

> "Ad set is `LEARNING_LIMITED` — budget ($120/day) × audience (180K) × Purchase volume can't produce 50/week. Options: (1) raise daily budget to $214 [target_CPA × 50 / 7], (2) expand audience past 1M, or (3) switch optimization to AddToCart until Purchase volume builds. Pick one — don't do all three, you'll lose the signal."

## See also

- [`./diagnostic-tree.md`](./diagnostic-tree.md) — only applies to `ACTIVE` ad sets.
- [`./kill-rules.md`](./kill-rules.md) — the 3× rule is the only kill rule that holds during learning.
- [`./attribution-windows.md`](./attribution-windows.md) — modeled conversions count toward the 50-event threshold.
