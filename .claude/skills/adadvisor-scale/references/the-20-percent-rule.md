## The 20% rule — the math, the rationale, the exceptions

The 20% rule says: raise daily budget by no more than 20% every 2-3 days on a winning ad set. It's the most-cited piece of Meta scaling advice and the most-misunderstood. This reference unpacks why it works, when it breaks, and how the MCP enforces it.

## The math

Compounded 20% increments every 2 days, starting from $100/day:

| Day | Budget | Cumulative spend |
|---|---|---|
| 0 | $100 | $0 |
| 2 | $120 | $200 |
| 4 | $144 | $440 |
| 6 | $173 | $728 |
| 8 | $207 | $1,074 |
| 10 | $249 | $1,488 |
| 14 | $358 | $2,452 |
| 20 | $619 | $4,930 |
| 30 | $1,072 (~$430 by day 30 if increments slow at $300+) | ~$11K |

The "$100 → $430 in 30 days" framing comes from buyers throttling the rate past $300/day to ~10% every 2 days, because the marginal auctions get more expensive as you climb. The point isn't the exact curve — it's that 30 days of compounded discipline beats one $100→$500 jump every time.

## Why it works

Meta's auction is a real-time market. When you change daily budget by >20%, the pacing system effectively re-bids you into a different price tier. Practically:

1. **Learning phase preservation.** A 20% increment keeps the same audience and bid trajectory. Meta's delivery algorithm doesn't restart the 50-conversion / 7-day learning clock.
2. **CPM continuity.** Small budget moves access the same auction pool. Large moves force Meta to find new (typically more expensive) impressions to fill the budget.
3. **Statistical sanity.** 20% over 2 days = enough new data points to evaluate the next step. 100% in a day = noise eating signal.

The 20% number itself is empirical, not from any official Meta document. The consensus (Tichenor, Foxwell, CTC, Pixis, Pawliw) is that ≤20% is safe; the variance band is roughly 15-25%.

## The Pixis 15% variant

Some optimization platforms (Pixis, Madgicx, Smartly) lean closer to 15% per increment because they run multiple increments per day. The math:

- 15% × 2/day for 4 weeks: 1.15^56 ≈ 3,300× (theoretical max — saturates long before).
- Real-world: 15% twice daily compounds about as much as 20% every 2 days, with smoother CPM.

Pick the cadence the human will actually follow. For an LLM-assisted operator with daily check-ins, 20% every 2-3 days is operationally simpler.

## When the rule breaks

### Small budgets with insufficient signal

If daily spend is <$30 and conversion volume is <3/day, the rule is moot — there isn't enough data to evaluate any increment. Buyers like Foxwell will move 50-100% on micro-budgets just to get past statistical zero. Don't apply the 20% discipline to a $20/day ad set with 0-1 conversions; you'll spend 60 days getting nowhere.

### Aggressive scaling with bid caps

Pawliw / Tichenor doctrine: with a bid cap in place, you can jump budget aggressively because Meta cannot bid above the cap regardless. The cap, not the budget, governs CPA. A 100% budget jump on a bid-capped ad set is bounded by the cap — worst case, the ad set under-spends.

This is the only context where you'd reasonably pass `force=True` to `adadvisor:change_entity_budget` without flinching.

### BFCM / high-velocity windows

Black Friday weekends, product launches, and viral moments are times when slow-and-steady loses to fast-and-disciplined. Sophisticated buyers will accept a learning reset, pre-warm with 1-2 days of high budget on day -3 to day -1, then aim spend at peak windows. The 20% rule pauses; replaces with explicit pre/post timing.

### Already-saturated audience

If you've been scaling vertically for 14+ days and the audience is genuinely tapped (frequency >3, CPM rising day-over-day, ROAS decaying), more vertical scaling does nothing. The rule didn't break — you ran out of room. Switch axes (see [`scaling-axes.md`](scaling-axes.md)).

## The "build a routine" wisdom

> "Don't chase the magic number. Build a routine — every Monday and Thursday morning, check the winners, scale by 20% if they're still above target, hold otherwise." — Andrew Foxwell, paraphrased from FB Ads OS

The 20% number is replaceable. The cadence is not. An operator who scales 15% three times a week beats one who scales 30% once on a hunch. The MCP's role is to enforce the cadence — `adadvisor:get_timeseries` to confirm 3+ stable days, then `adadvisor:change_entity_budget` with the increment, then a re-check trigger.

## The 2× MCP guardrail

`adadvisor:change_entity_budget` rejects any change >2× or <0.5× by default. This is intentional — it forces the agent to acknowledge that a large jump is a different operation than a routine scale, and to either (a) stage it into multiple smaller jumps or (b) explicitly invoke `force=True`.

When to pass `force=True`:

- User has explicitly said "scale aggressively, I accept the learning reset."
- BFCM / pre-launch with bid caps in place.
- Emergency budget cut (>50% reduction during a crisis — same guardrail catches deep cuts too).

When NOT to pass `force=True`:

- The user said "scale this campaign." Default to 20%. Ask if they want more.
- The 7-day ROAS is volatile. Aggressive scaling on volatile data is gambling.
- You're under conversion threshold (<50/week). Force-scaling a thin ad set forfeits the very signal you need to evaluate the result.

## Sequencing the increment

A single 20% scale is a one-call operation. A scaling routine is a multi-step pattern:

```
1. adadvisor:get_timeseries(entity_id=..., entity_type='adset', days=7)
   → confirm 3+ days above target_ROAS × 1.2.
2. adadvisor:get_performance(level='adset', entity_id=...)
   → cross-check 7-day vs 3-day ROAS; confirm no learning-phase indicator.
3. adadvisor:change_entity_budget(entity_id=..., daily_budget=<old × 1.2>)
   → returns next_steps with the re-check cadence.
4. Set a follow-up — 48-72h later, repeat from step 1.
```

This is the spine of every ongoing scaling conversation. Each call is cheap; the discipline is the product.

## What the user actually feels

A user who has been told "the 20% rule" but never seen it applied tends to ask "why am I only scaling 20%? I have headroom." The answer is two-part:

1. **You don't know you have headroom until you test it.** The 20% scale tells you. A 100% scale obscures it.
2. **CPA inflation is a tax on scaling.** Slow scaling pays less tax. Fast scaling pays more tax. If unit economics are tight, the slow path keeps more profit.

If they still want to go faster, ask whether they accept the learning reset and tighter kill rules. Set thresholds explicitly: "scaling 50% means we kill if CPA crosses target × 1.5 in the next 3 days." Now they own the trade-off.

## Quick reference

- Default: **20% every 2-3 days**.
- Lower-bound: **15% twice daily** for high-cadence operators.
- Hard ceiling without bid caps: **2× change** before the MCP guardrail flags.
- Override: **`force=True`** with explicit user accept of learning reset.
- The number to defend is **profit per day**, not ROAS or daily budget.
