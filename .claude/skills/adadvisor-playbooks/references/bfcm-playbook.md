## BFCM playbook — the 8-week operational timeline

Black Friday / Cyber Monday is not a "turn up the budget" moment. It's a 6-8 week sequence with predictable checkpoints, predictable risks, and predictable recovery patterns. The buyers who win BFCM start in early October and protect their post-BFCM December — the buyers who lose treat BFCM weekend as the whole campaign.

This playbook synthesizes Ray Jang (Pilothouse), Andrew Foxwell, the Common Thread Collective (Taylor Holiday + Richard Gaffin), Triple Whale, and Motion's 2024-2025 BFCM postmortems.

## Why BFCM is structurally different

| Factor | Normal week | BFCM week |
|---|---|---|
| CPM | Baseline | +50-80% |
| Auction competition | Stable | Spikes hour-to-hour |
| Conversion rate | Baseline | +30-100% (urgency) |
| Creative fatigue | 7-10 days | 2-4 days (frequency spikes) |
| Pixel data freshness | Lag tolerable | Lag = lost decisions |
| Cash flow | Steady | Heavily weighted Thursday-Monday |

The CPM inflation is unavoidable. The win comes from being *prepared* for it — pre-built audiences, pre-tested creatives, pre-warmed pixel signal — so that when CPMs spike, the conversion rate spike outpaces them.

## The timeline

### T-8 to T-6 weeks (early-to-mid October): audience warm-up

**Objective:** seed retargeting pools and surface creative concepts that will work for BFCM.

```
adadvisor:create_campaign(objective='OUTCOME_AWARENESS' OR 'OUTCOME_TRAFFIC', ...)
adadvisor:create_adset(optimization_goal='THRUPLAY' OR 'LANDING_PAGE_VIEWS', ...)
adadvisor:create_creative(format='video', ...)  # high-frequency video content
adadvisor:create_ad(...)
adadvisor:change_entity_status(action='resume')
```

Budget: 10-15% of normal prospecting daily spend. The point isn't direct ROAS — it's building the Warm-1 and video-viewer audiences that will fuel BFCM retargeting.

Concurrent: test 3-5 distinct BFCM-specific creative concepts at low spend ($50-100/day each). The winners get scaled into BFCM proper. Foxwell's rule: if a concept can't get a 1.5× ROAS in October on broad, it will not win at BFCM CPMs.

### T-4 weeks (late October): structural prep

| Task | MCP call |
|---|---|
| Build BFCM-specific landing pages (offsite) | n/a |
| Verify pixel firing on those pages | `adadvisor:get_pixel_health` |
| Build BFCM-specific custom audiences | `adadvisor:create_website_audience(...)` |
| Pre-build retargeting ad sets (paused) | `adadvisor:create_adset(...)` then leave PAUSED |
| Confirm payment caps with Meta (cards on file) | n/a |

Don't activate the retargeting ad sets yet — they're staged for the weekend.

### T-2 weeks (early November): **structural freeze**

No new pixels. No new campaigns. No new audience swaps. Lock in whatever learning Meta has built. Continue creative refresh.

Why: every structural change resets the learning phase. Two weeks before BFCM is too close to the spike to risk a 7-day relearn.

```
# What you CAN do:
adadvisor:change_entity_budget(...)        # ≤2× changes; idempotent
adadvisor:change_entity_status(action='pause' or 'resume')  # idempotent
adadvisor:duplicate_ad(...)                # for creative refresh on a stable ad set

# What you SHOULDN'T do:
adadvisor:create_campaign(...)
adadvisor:create_adset(...)                # new ad sets relearn
adadvisor:update_adset_targeting(...)      # targeting changes can trigger relearn
```

### T-1 week (mid-November): final QA + warm-up budget bump

Final checks:
- Pixel + CAPI both firing on BFCM landing pages — `adadvisor:get_pixel_health`.
- Conversion event dedup verified (event_id matching) — outside MCP.
- BFCM creatives uploaded and previewed — `adadvisor:preview_existing_creatives`.
- Retargeting ad sets ready to activate (still PAUSED).

Budget bump: +30-50% on prospecting ad sets to drive pre-Thanksgiving traffic into the warm-1 retargeting audience.

```
adadvisor:get_performance(level='campaign', date_range='last_14d')  # baseline
adadvisor:change_entity_budget(
  entity_type='campaign', entity_id=<prospecting_cbo>,
  daily_budget=<baseline × 1.4>
)
```

### BFCM weekend (Thursday-Monday): the spike

Hour-by-hour pacing matters. Don't load the budget evenly across the day; Meta's auction is more efficient at certain hours.

| When | Action |
|---|---|
| Wed midnight ET | Activate all staged retargeting ad sets. Ramp prospecting budget +50% over previous week. |
| Thursday 6am ET | First check: spend pacing, ROAS so far, CPM. |
| Thursday noon | Budget ramp +50% on winners. Kill any ad set at <0.5× break-even ROAS with ≥10 impressions/$. |
| Thursday evening | Second budget ramp on top 30% of ad sets. |
| Friday-Sunday | Continuous monitoring (every 4-6 hours). Ramp by 50-100% on confirmed winners. |
| Monday (Cyber Monday) | Last-chance creative angle. Urgency messaging. Increase retargeting budget share to ~30%. |

Total BFCM weekend budget: typically 200-400% of normal baseline. CPMs +50-80%; conversion rate +30-100%; net effect is usually a 1.2-2× ROAS improvement vs baseline despite the CPM inflation.

**Bid caps:** if margins are tight, switch winning ad sets to Cost Cap with a CPA target 1.2× normal target. This caps the downside if conversion-rate gains evaporate after the weekend.

```
adadvisor:update_entity(
  entity_type='adset', entity_id=<winner>,
  bid_strategy='COST_CAP',
  bid_amount=<target_cpa × 1.2>
)
```

### Cyber Week (Tuesday-Friday after BFCM): last-chance + abandoned cart

The post-weekend lull is real but not as steep as people fear. Average ROAS holds at 60-80% of weekend peak for Tuesday-Friday.

| Tactic | Why |
|---|---|
| Last-chance urgency creative | The "before sale ends Friday" angle still converts |
| Abandoned-cart retargeting +50% budget | The volume of abandoned carts from the weekend is huge |
| Email/SMS retargeting custom audiences | Re-engage non-purchasers who hit the site over BFCM |
| Bid caps stay on | Margins still tight; protect downside |

### T+2 weeks to T+4 weeks (December 1-15): cool down, don't break

**The cardinal mistake:** treating December 1 as the end and slashing budgets to baseline-minus. This breaks learning and forces a January relearn.

| Action | Why |
|---|---|
| Reduce budget 30-40% from peak (not 70%) | Protect learning; don't reset CBO budget pacing |
| Activate welcome-series creative for new customers acquired during BFCM | Convert one-time BFCM buyers to repeat |
| Pause BFCM-specific promo creative | The "Black Friday" hook stops converting Dec 1 |
| Continue retargeting at slightly elevated levels | Cart-abandoners from BFCM still convert through mid-Dec |
| Maintain ASC if running | It's the cleanest learning carrier into Jan |

```
adadvisor:list_campaigns(account_id, status_filter=['ACTIVE'])
adadvisor:get_performance(level='campaign', date_range='last_7d')
# For each winner, drop budget 30-40%:
adadvisor:change_entity_budget(
  entity_type='campaign', entity_id=<c>,
  daily_budget=<peak × 0.65>
)
```

## Budget split during peak

Ray Jang's BFCM split (multiple Pilothouse breakdowns, 2024-2025):

| Bucket | Share |
|---|---|
| Evergreen prospecting (existing winning creatives, broad audience) | 50-70% |
| BFCM-specific promo creative (offer-led, time-limited) | 30-50% |

Within the BFCM-specific bucket:
- 50% on the highest-volume offer
- 30% on a secondary offer or bundle
- 20% on testing alternative angles (gift-giving, last-chance, etc.)

The evergreen bucket protects learning and continues to convert at near-normal CPA from the LAL/broad seed. The BFCM-specific bucket captures the urgency-driven incremental volume.

## Pacing checkpoints (hour-by-hour BFCM weekend)

| Hour | Check |
|---|---|
| Thursday 6am | Spend on track to hit daily budget? CPMs reasonable? |
| Thursday noon | ROAS so far ≥ break-even? Identify top 30% of ad sets. |
| Thursday 6pm | Apply +50% budget to winners. Pause any ad set with ≥$100 spend and <0.3× break-even ROAS. |
| Friday 6am | Recap Thursday. Identify creative winners (CTR + CPA together). |
| Friday noon | Refresh creative on ad sets with frequency >4. |
| Friday-Sunday | Repeat 12-hour cycle: ramp winners, kill losers, refresh frequency-burned creatives. |
| Monday 6pm | Last call for budget. Cyber Monday tail until midnight. |

## Common BFCM failures

| Failure | Why | Fix |
|---|---|---|
| "We didn't have audiences built — frequency exploded" | Skipped T-8 to T-4 warm-up phase | Cannot fix mid-BFCM; do compressed warm-up if late |
| "Pixel broke on the BFCM landing page" | New page, untested pixel | T-1 week QA mandatory; have CAPI as backup |
| "ROAS collapsed Sunday and we kept spending" | No pacing checkpoints; no kill thresholds | Hour-by-hour discipline with explicit thresholds |
| "December was a disaster" | Slashed budget Dec 1; broke learning | Hold at 60-70% of peak through Dec 15 |
| "BFCM creative didn't outperform evergreen" | Generic offer with no creative angle | Pre-test concepts in October; only run winners |
| "ASC ate the manual prospecting budget" | No ASC ↔ manual exclusions | Symmetric audience exclusions before T-2 |

## Anti-patterns

- Launching new campaigns during T-2. They won't exit learning before the weekend.
- Spending the BFCM budget evenly across the week. Front-load Thursday-Sunday; ~40% of weekend spend hits Friday.
- Killing BFCM-specific creative on Saturday because Friday looked weak. Friday is often a soft pre-Saturday day; hold through Sunday.
- Ignoring the December 1-15 cool-down. December performance pays for January performance.
- Trying to run a product launch concurrent with BFCM. Pick one.
- Activating retargeting ad sets weeks early. They'll burn through warm audiences before BFCM weekend.

## References cited

- Ray Jang (Pilothouse), multiple BFCM threads on budget split and pacing (2023-2025).
- Andrew Foxwell, T-8 warm-up doctrine.
- Common Thread Collective (Taylor Holiday + Richard Gaffin), BFCM postmortems 2024-2025.
- Triple Whale BFCM benchmark reports.
- Motion BFCM creative-cadence breakdowns.
