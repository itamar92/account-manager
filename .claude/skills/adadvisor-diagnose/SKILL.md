---
name: adadvisor-diagnose
description: |
  Diagnose Meta ad performance regressions and decide whether to kill, hold, or scale. Encodes the senior media buyer's diagnostic stack (Hook Rate → Hold Rate → CTR → CVR → AOV) and the canonical "spend up, results down" decision tree. Use when: "CPA went up", "ROAS dropped", "what happened", "why is this campaign not working", "diagnose", "performance is bad", "should I kill this", "should I scale this", "is this ad working", "what's wrong with this campaign", "investigate", "spend without results", "frequency too high". Chain with: adadvisor (always — data limits and show economics); adadvisor-scale when the diagnosis says "scale"; adadvisor-creative when the diagnosis surfaces creative fatigue; adadvisor-targeting when audience saturation is the root cause. NOT for: full account audits (use adadvisor-audit); kill/scale decisions without a specific entity in mind (run audit first); launching new things (use adadvisor-launch).
license: Apache-2.0
version: 0.1.0-account-manager
---

> **Connection override — read this first.** This skill was written for the adadvisor.ai MCP server, which can read *and change* a Meta ad account. This project does **not** use that server. It uses the app's own **read-only** Meta connection (`account-manager` MCP: `band_campaigns`, `band_ad_analysis`, `band_shows`, `band_campaign_advice`), which is **campaign-level only** and measures a band's **shows** (cost per ticket), not an online shop (ROAS).
>
> - Load the `adadvisor` foundation skill first; it defines the data limits and the show economics.
> - Wherever this skill says `adadvisor:<tool>`, translate it with `../adadvisor/references/mcp-tool-cheatsheet.md`. A **read** maps to a campaign-level tool or is *not available*; a **write** becomes **an instruction for the user to carry out in Ads Manager** (`../adadvisor/references/mutation-safety.md`) — never claim it was done.
> - Replace break-even ROAS / target CPA / AOV with the band's own cost-per-ticket history (`../adadvisor/references/economics.md`). The show date sets the runway; always state it.
> - Where a step needs something this connection cannot see (ad set / ad data, pixel, frequency by day, copy), say what is missing and ask the user to paste it from Ads Manager. Do not guess.
> - Everything below describes the method; the method is sound, the tool calls are not available as written.
>
> **For this skill:** the diagnostic stack (Hook Rate → Hold Rate → CTR → CVR → AOV) is only partly computable. Available: CPM, CTR and CPC on *all clicks*, lifetime frequency, the daily spend curve, and cost per ticket against the books. Hook/hold rate and on-site conversion are not available — name the layer you cannot see rather than skipping it, and ask for the Ads Manager column if the diagnosis hinges on it. Kill/hold/scale verdicts become instructions for the user, and must weigh the days left to the show.

# AdAdvisor — Performance Diagnosis & Decisions

When a campaign's numbers move, a senior media buyer does not panic. They run a diagnostic stack. This skill encodes that stack and turns it into a decision: kill, hold, or scale.

## When to use

- The user is asking "why" — why did CPA jump, why did ROAS drop, why is this ad set spending without converting.
- The user is asking "should I" — kill / pause / scale / hold this.
- A specific entity (campaign, ad set, or ad) is in focus. For account-wide health, use `adadvisor-audit` instead.

## Pre-diagnosis: foundation

Confirm the `adadvisor` foundation has loaded — you have `business.break_even_roas`, `business.target_cpl` (if lead-gen), the optimization goal from the entity's parent, and the data is synced. If you don't know break-even, no diagnostic conclusion is reliable.

## Diagnostic stack — the funnel

Performance is a funnel. When the bottom moves, find the level that broke:

```
Impressions      → CPM     ← creative quality, audience saturation, competition
   ↓
3-sec views      → Hook Rate (3sec/impressions)
   ↓
15-sec views     → Hold Rate (15sec/3sec)
   ↓
Link clicks      → CTR (clicks/impressions)
   ↓
Landing page     → LP CVR (LPV/clicks) — separates ad from page
   ↓
Purchases       → CVR (results/LPV) — the offer
```

Pull `adadvisor:get_timeseries(entity_type=..., entity_id=...)` for the entity. Trends across days are more informative than the latest value.

### Healthy ranges (2026 DTC ecom)

| Metric | Healthy | Strong | Weak |
|---|---|---|---|
| CPM (prospecting) | $10-25 | <$15 | >$30 |
| Hook Rate | 25-35% | 30-45% | <20% |
| Hold Rate | 40-50% | 60%+ | <30% |
| CTR (outbound link) | 1.0-1.8% | ≥2.0% | <0.8% |
| CTR (all) | ≥2% | ≥3% | <1% |
| LP CVR | 30-50% | 60%+ | <20% |
| CVR (purchase) | 1-3% | ≥4% | <0.5% |
| Frequency (prospecting) | 1.5-2.5 | <2 | ≥3 |
| Frequency (retargeting) | 4-6 | 3-5 | ≥7 |

Adjust by vertical — luxury / B2B SaaS / lead-gen all have their own benchmarks. When in doubt, compare to the same account's trailing 14-day average rather than industry numbers.

## The diagnostic tree — "spend up, results down"

When CPA goes up or ROAS drops, identify which combination is changing. The cause determines the action:

| Symptom | Likely cause | Confirm with | Action |
|---|---|---|---|
| CPM ↑, CTR ↑, CVR ↓ | Wrong audience OR landing-page friction | LP session recordings, GA4 funnel | Fix LP, don't kill ads |
| CPM ↑, CTR ↓, CVR flat | Creative fatigue OR audience saturation | Frequency, new-reach %, ad-level CTR decay | If frequency creeping: refresh creative. If audience saturated: expand. |
| CPM flat, CTR ↓, CVR flat | Creative fatigue | Ad-level CTR trendline vs first 3 days | Refresh or kill creative |
| CPM ↑, CTR flat, CVR flat | Competition or seasonality | Compare CPM week-over-week | Hold or raise bid |
| CPM flat, CTR flat, CVR ↓ | Offer / price / LP change | Funnel analytics | Fix offer or LP |
| Quality ranking "Below Avg" | Negative feedback / clickbait | Ad relevance diagnostics | Replace creative |
| Spend < daily budget delivery | Bid too low / audience too narrow / learning capped | Audience size, bid strategy | Loosen bid or expand audience |

Walk the user through this tree explicitly: "CPM is up 35% vs 14-day average. CTR is also down. That's the fatigue/saturation pattern. Let's check frequency."

## Decision rules — kill / hold / scale

These are unsentimental, brand-agnostic, expressed as multiples of the user's target (which you got from the context resource). All assume the entity is past Meta's learning phase (≥50 conversions / 7d) — fresh entities need 3-5 days before any decision.

### Kill rules

- **Kill immediately**: spent ≥3× target CPA with zero conversions. Especially in learning phase.
- **Kill**: ROAS < 0.5× break-even for 3+ consecutive days.
- **Kill or major refresh**: frequency > 5 on a small audience (<1M) with declining CTR over 7 days.
- **Kill**: ad-level negative feedback ≥0.2%.

### Hold rules

- **Hold and monitor (48-72 hours)**: spent 2× target CPA with 1 conversion.
- **Hold (don't optimize)**: spent 1.5× target CPA with steady conversions — CPA may be inflated by misattribution; don't kill what's working in modeled terms.
- **Hold**: entity is in learning (Meta's "Learning" status); changes restart learning. Wait until ≥50 conversions/7d.

### Scale rules

- **Scale (20% vertical)**: ROAS ≥ target × 1.2 for 3+ consecutive days AND new-customer rate stable.
- **Horizontal scale (duplicate to new audience)**: vertical scaling is causing CPA to inflate >10% per increment.
- **Bid-cap escalation**: spending is hitting a ceiling under Lowest Cost; switch to Bid Cap at target_CPA × 1.20.

See `adadvisor-scale` for the full scaling playbook.

## Budget per test — the kill threshold scales with account size

| Account size | Test budget per ad | Kill threshold (no conversion) |
|---|---|---|
| <$10K/mo | $25–75/day | $75–225 spend |
| $10K–50K/mo | $50–150/day | $150–450 spend |
| $50K–200K/mo | $100–300/day | $300–900 spend |
| $200K+/mo | $300–1,000/day | $900–3,000 spend |

(Source: GrowwithBA 2026 brackets.) Use the user's monthly spend to set the right threshold — don't apply the bootstrapped-brand kill rule to a $500K/mo account, and don't apply the agency kill rule to a $5K/mo account.

## The mistake of killing too early

Meta needs 3–5 days of stable signal post-launch. Killing on day 1 of a test ad — even with poor numbers — is usually noise.

Daniel/DKoves's hard-learned rule, encoded:
> "I saw an ad creative drop from 5× to 3× ROAS. Panicked. Killed it. Two days later, I realized it was within normal variance."

When the user says "kill this, it's not working" but the entity has spent <2× target CPA, push back: "We're at 1.4× target CPA, that's within normal variance. The kill threshold is 3× with zero conversions. Want to hold for 48 hours and re-check?"

## Reading Meta's signals as language

The MCP's responses may include Meta status strings that mean specific things:

- **"Learning Limited"** = budget × audience × optimization-event combo can't produce 50 events/week. Don't fight it — fix one of the three.
- **"Creative Limited"** = audience saturation — more creatives or expand audience.
- **"Below Average" quality ranking** = users hide/scroll-past your ad more than competitors. Fix the creative.
- **"Budget exhausted" but spend ≠ budget** = system pacing throttle; check daily-spend limit, payment threshold, AEM priority.

## Workflow — what to do in order

1. Identify the entity (campaign, ad set, or ad). If the user is vague, ask.
2. Pull `adadvisor:get_performance(level=..., level_specific_filter=entity_id)` with default 45-day window.
3. Pull `adadvisor:get_timeseries(entity_type=..., entity_id=...)` for trend.
4. Compute the diagnostic stack: CPM trend, hook rate, hold rate, CTR, frequency.
5. Identify the symptom row in the tree above.
6. Determine the action: kill / hold / scale.
7. Quote the rule that justifies it. The user can disagree but they shouldn't be surprised.
8. **Don't mutate without confirmation.** Recommend, wait for sign-off, then call the appropriate mutation tool.

## Anti-patterns

- ❌ Reporting "CPA is $48" without context. ✅ "CPA is $48, your target is $35 — 1.37× target. Within the hold band; if it doesn't recover in 48h we kill."
- ❌ Killing on 24h of data at $50/day budget. ✅ Use the 3× target CPA rule with the right account-size kill threshold.
- ❌ Recommending creative refresh when the LP CVR cratered. ✅ The funnel says the offer/page broke; new creative won't fix it.
- ❌ Treating Meta's "ROAS" as ground truth on a Subscribe campaign. ✅ Use `cost_per_result` vs LTV-implied target.
- ❌ Recommending a budget cut while in learning. ✅ Wait for learning to complete; changes reset the clock.
- ❌ "Scale by 100%". ✅ The 20% rule — vertical scaling >20% in <2 days resets learning. (See `adadvisor-scale`.)

## References

- [`references/diagnostic-tree.md`](references/diagnostic-tree.md) — the full cause→action table with edge cases (lead-gen, awareness, app promotion).
- [`references/kill-rules.md`](references/kill-rules.md) — the unsentimental rules with worked examples from real accounts.
- [`references/benchmarks.md`](references/benchmarks.md) — 2026 healthy ranges by vertical (DTC, B2B SaaS, lead-gen, app, luxury).
- [`references/learning-phase.md`](references/learning-phase.md) — what triggers learning, how to know you're out, what NOT to change while in it.
- [`references/attribution-windows.md`](references/attribution-windows.md) — 7d-click / 1d-view vs 1d-click, the Meta vs Triple Whale gap, modeled conversions.
