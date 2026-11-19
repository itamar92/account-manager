## Creative fatigue — detecting it early

> "Creative is responsible for 70-89% of Meta ad performance. That means fatigue is the silent killer of accounts. Everything you're optimizing — bidding, audiences, structures — moves a single-digit percentage; creative is the rest." — paraphrased from Motion's 2026 State of Creative report.

This reference is the detection playbook. The goal: catch fatigue 5-7 days before it shows up in headline CPA, so you have time to refresh without a learning reset.

## The fatigue signature

When a winning creative starts to fade, these signals move together:

| Metric | Trend |
|---|---|
| **CTR (link-click)** | Down 20-30% week-over-week with no audience change |
| **Frequency on prospecting** | Rises past 2.5, then past 3.0 |
| **CPM with stable audience** | Up 10-20% week-over-week |
| **Hook rate (3-sec views / impressions)** | Drops below the asset's first-week baseline |
| **Quality ranking** | Slides from "Above Average" → "Average" → "Below Average" |

Any one signal in isolation is noise. **Any two firing simultaneously is fatigue.** Three or more, and you're already late.

## The CTR-decay curve

A healthy creative's CTR roughly follows:

```
Days 0-3:   CTR rising as Meta finds the audience
Days 3-14:  Plateau — the creative's "true" CTR
Days 14-21: Slight decay as repeat exposure accumulates
Days 21+:   Decay accelerates; refresh window opens
```

A typical winning creative's CTR over time, indexed to baseline:

```
Week 1:  100%
Week 2:  95-100%
Week 3:  90-95%   (mild decay)
Week 4:  80-90%   (fatigue starting)
Week 5:  70-80%   (action needed)
Week 6:  60-70%   (replace now)
Week 7+: <60%     (too late — refreshing now hurts because audience signal degraded)
```

Refresh between weeks 3-5 of an ad's life. The exact week depends on:

- **Audience size.** Small audiences fatigue faster (frequency saturates quickly).
- **Daily spend.** $1K/day fatigues a creative in days, not weeks.
- **Creative type.** UGC + testimonials fatigue slower than polished studio.

The decay isn't linear — it's a curve. The dangerous moment is the inflection between the 14-21 plateau and the >21 acceleration. By the time it shows up in 7-day-rolling ROAS, you've lost 5-7 days of efficient spend.

Detect via:

```
adadvisor:get_timeseries(entity_id=<ad_id>, entity_type='ad', days=21)
  → look at the daily CTR column
  → compute rolling 3-day averages; the second derivative going negative is the early signal
```

A **20% week-over-week drop in CTR with no audience change = fatigue, period.** There are no other explanations — same audience seeing same creative, behavior shifted, the creative is the variable.

## Frequency on prospecting

Frequency is impressions per unique user. The healthy range:

| Funnel stage | Healthy frequency | Fatigue threshold |
|---|---|---|
| Prospecting (cold) | 1.5-2.5 | >3.0 |
| Warm prospecting | 2.0-3.5 | >4.5 |
| Retargeting (cart, browse) | 4.0-6.0 | >7.0 |
| Retargeting (existing customer) | 3.0-5.0 | >6.5 |

Prospecting frequency >3 means the average prospect has seen the creative more than three times. CTR drops, conversion rate drops, fatigue compounds. Above 4 on prospecting, the ad is actively hurting the audience's view of the brand.

Detect via `adadvisor:get_performance(level='ad'|'adset', date_range='last_7_days')` — the `frequency` field is calculated by Meta.

## CPM creep with stable audience

CPM (cost per 1,000 impressions) rises naturally as you scale spend — you run out of cheap auctions. But **CPM rising on the same audience with the same creative, week over week, is a fatigue signal**: Meta's relevance score for that creative is declining, so it costs more to win impressions.

Diagnostic: hold audience constant (same ad set, same targeting, no budget change) and compare last week's CPM to the prior week's CPM. >15% jump with no other explanation = fatigue.

## Hook rate decay

Hook rate = 3-second views / impressions. It's the cleanest fatigue signal because it isolates the first 1-3 seconds of the ad — the hook itself.

| Hook rate | Status |
|---|---|
| 30-45% | Strong |
| 25-35% | Healthy |
| 20-25% | Wearing |
| <20% | Fatigued — refresh now |

Hook rate moves *before* CTR moves and *before* frequency moves. By the time CTR has dropped 20%, hook rate dropped 25-30% a week earlier. If you're tracking it, you can refresh in time.

Detect via the funnel mapping in `adadvisor-diagnose`:

```
adadvisor:get_performance(level='ad', entity_id=<ad>)
adadvisor:get_timeseries(entity_id=<ad>, entity_type='ad', days=14)
  → daily hook rate column for trend analysis
```

## The replacement rule — overlap, don't swap

When fatigue is confirmed, **introduce new creative AT the fatigue threshold, not after.** Let the new ad overlap with the fatigued ad for 3-5 days before pausing the old one.

The mechanics:

- If you pause the fatigued ad and wait 2 days to launch the replacement, the ad set re-enters learning. 5-7 days of recovery.
- If you launch the replacement first and let it overlap 3-5 days with the fatigued ad, the ad set learns the new creative inside the existing optimization. No reset.
- The fatigued ad keeps spending for 3-5 days at degraded efficiency, but the ad-set-level CPA never spikes.

```
Day 0 (fatigue detected):
  adadvisor:create_creative(...) + adadvisor:create_ad(...)
  adadvisor:change_entity_status(entity_type='ad', entity_id=<new>, action='resume')
  → new ad joins the ad set; fatigued ad keeps running

Day 3-5: adadvisor:get_performance(level='ad', entity_id=<new>)
  → if hook rate ≥ old, CTR ≥ old, CPA ≤ old × 1.2 — promote it

Day 5-7: adadvisor:change_entity_status(entity_type='ad', entity_id=<old>, action='pause')
  → fatigued ad retires; ad-set optimization uninterrupted
```

The overlap period is the operational discipline. It costs 3-5 days of double-running, but it prevents the much more expensive cost of resetting an entire ad set's optimization.

## Fatigue vs audience saturation

CPM up + CTR down can be fatigue OR audience saturation. Distinguish:

- **Fatigue:** A new audience would respond, but Meta is showing the same creative to the same people too often.
- **Saturation:** The audience itself is exhausted — even fresh creative won't help on this audience.

Test: duplicate the fatigued ad to a fresh audience via `adadvisor:duplicate_ad(target_adset_id=<broader_lal>)`. If CTR recovers on the new audience, it was fatigue. If CTR stays flat, the creative itself is dying.

## Why creative fatigue is the silent killer

The 70-89% number deserves an unpacking. **Creative drives most of the variance in performance, but it's also the slowest input to change.** Bidding tweaks are instant; audience swaps take a few days; creative production is days to weeks.

Operators who don't track fatigue signals tend to:

1. Run a winning creative until it visibly tanks.
2. Panic-pause and panic-launch replacements.
3. Reset learning across multiple ad sets simultaneously.
4. Endure 7-14 days of degraded performance.
5. Conclude the account "stopped working" — when actually they just let fatigue compound.

The fix is procedural: a weekly check that surfaces the four signals, a creative production pipeline that's always 2-3 weeks ahead, and the discipline of launching replacements *before* pausing originals.

## Detection routine (weekly)

```
1. adadvisor:list_ads (filter to live ads)
2. For each ad with >$50 spend in last 7 days:
     adadvisor:get_timeseries(entity_id=<ad>, entity_type='ad', days=14)
3. For each ad:
     compute week-over-week deltas on CTR, CPM, hook rate, frequency
     flag any ad with ≥2 fatigue signals firing
4. For each flagged ad:
     queue a replacement concept (see refresh-cadence.md for cadence by spend tier)
     launch replacement alongside; do not pause original yet
5. 3-5 days later:
     if replacement proves out, pause original
     if replacement fails, kill replacement, try a different concept
```

## What's NOT fatigue

- **Single-day CTR drop.** Meta's auction noise is real; one-day swings of ±15% happen on healthy creatives.
- **Frequency rising during a budget scale.** Frequency rises mechanically with spend on the same audience; if scaling, frequency *should* rise — the question is whether CTR is also dropping.
- **ROAS dropping after a creative launch.** Learning phase, not fatigue. Wait 5-7 days before reading CPA on a fresh ad.
- **A new audience produces lower performance.** That's audience quality, not creative fatigue. Test with a known-winner creative to isolate.

## Anti-patterns

- "Refreshing" by changing the headline on the same image. Meta groups visually similar ads — the new ad inherits the old fatigue.
- Waiting for ROAS to drop to confirm fatigue. By then you've lost a week of efficient spend. Use leading signals (hook rate, CTR decay).
- Pausing the fatigued ad before the replacement is proven. Triggers learning reset; ad set CPA spikes; the original problem was fatigue, the new problem is reset.
- Treating all creatives in the ad set as fatigued because one is. Isolate per-ad — usually 1-2 of 5 ads carry the issue.
- Ignoring fatigue on a high-spend winner. The winner is doing the most volume; its fatigue costs the most.

## Cross-references

- [`refresh-cadence.md`](refresh-cadence.md) — scheduling refresh ahead of fatigue.
- [`hook-library.md`](hook-library.md) — generating fresh hooks to replace fatigued ones.
- [`testing-frameworks.md`](testing-frameworks.md) — frameworks to run on the replacement cycle.
- [`existing-post.md`](existing-post.md) — social-proof anchors that resist fatigue longer than fresh ads.
- Sibling skill `adadvisor-diagnose` — hook rate, hold rate, CTR funnel diagnostic in more depth.
