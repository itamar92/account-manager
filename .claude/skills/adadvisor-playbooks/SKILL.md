---
name: adadvisor-playbooks
description: |
  Tactical Meta-ads playbooks for specific situations — BFCM (Black Friday / Cyber Monday), new-product launches, lead-gen account setup, banned-account recovery, $1k-to-$10k/day scale plans. Multi-week sequences with checkpoints rather than one-off workflows. Use when: "BFCM", "Black Friday", "Cyber Monday", "holiday campaign", "promo playbook", "launch a new product", "product launch", "drop", "lead gen account", "lead form", "banned", "account banned", "ad account restricted", "recover account", "pixel got banned", "scale from X to Y", "1k to 10k", "5k a day", "ramp plan", "holiday playbook". Chain with: adadvisor (always); adadvisor-launch and adadvisor-scale as building blocks; adadvisor-creative for the creative cadence per playbook; adadvisor-targeting for audience expansion sequences. NOT for: one-shot questions about a single campaign (use adadvisor-diagnose or adadvisor-launch); ongoing day-to-day management (use adadvisor-audit + adadvisor-diagnose).
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
> **For this skill:** the playbooks are written for online shops (BFCM, $1k→$10k/day, lead-gen setup, ban recovery). Use them as *structure* — phases, checkpoints, cadence — and replace every ROAS/revenue gate with cost per ticket and the show runway. A "show promotion" is the playbook that fits this band; build it from `adadvisor-launch`, `-creative` and `-scale` on a countdown to the show date. E-commerce-only playbooks should be adapted explicitly, saying what you changed, or declined as not applicable.

# AdAdvisor — Tactical Playbooks

Some situations need a sequence, not a workflow. This skill ships five named playbooks for the moments where a senior buyer follows a defined cadence over weeks: BFCM, product launches, lead-gen setup, banned-account recovery, and the $1k→$10k/day scale plan.

Each playbook below is a summary. The full sequence with checkpoints lives in `references/`.

## When to use

The user mentions one of the playbook names, or describes the situation:
- "Black Friday is coming, what do I do" → `bfcm-playbook.md`
- "We're launching X next month" → `product-launch.md`
- "We're moving to lead-gen ads, set me up" → `lead-gen-setup.md`
- "My account got banned, how do I recover" → `account-recovery.md`
- "Help me scale from $5K to $10K/day" → `scale-1k-to-10k.md`

## Playbook 1 — BFCM (Black Friday / Cyber Monday)

The full operational timeline starts 8 weeks out. Key checkpoints:

| When | Action |
|---|---|
| T-8 weeks (early October) | Audience warm-up. Build retargeting pools with high-frequency awareness content. Test offers softly. Establish creative library with BFCM-specific concepts. |
| T-2 weeks | **Freeze structural changes.** No new pixels, no new campaigns, no audience swaps. Lock in learning. |
| T-1 week | Final creative QA. Verify pixel/CAPI on BFCM-specific landing pages. Increase budgets 30-50% for pre-Thanksgiving warm-up. |
| BFCM weekend (Thu-Mon) | Ramp budget 200-400% vs baseline. Hour-by-hour pacing plan. Expect CPM +50-80%. Use bid caps if margins are tight. |
| Cyber Week (Tue-Fri) | Last-chance creative, urgency messaging, abandoned-cart layer. |
| Post-BFCM (Dec 1-15) | Cool down. Reduce budgets 30-40%. Reactivate new customers with welcome series. Don't let learning collapse. |

Budget split during peak: 50-70% evergreen + 30-50% BFCM-promo specific. Full timeline with the exact MCP calls per checkpoint in [`references/bfcm-playbook.md`](references/bfcm-playbook.md).

## Playbook 2 — New product launch

Sequence for launching a product Meta has never seen perform:

| Phase | Days | Actions |
|---|---|---|
| Pre-launch | T-2 weeks | TOF video views + engagement campaign to seed retargeting pool with people who've shown interest. |
| Launch week | Day 1-7 | ASC + manual prospecting CBO side-by-side (with proper exclusions). 5-8 distinct concept angles in week 1: problem-aware / solution-aware / product-feature / founder-story / comparison / UGC testimonial. |
| Validation | Day 7-14 | Identify true winners (≥3 days stable CPA). Apply tighter kill thresholds — at launch you don't have benchmark data, so kill at 3× target CPA with zero conversions. |
| Scale | Day 14+ | Standard scaling — 20% vertical every 2-3 days, expand horizontally to new audiences once vertical CPA creeps. |

Bid strategy: **Lowest Cost for first 7 days** (max signal collection), then layer Cost Cap once you see CPA stabilize.

Full playbook with MCP call sequences in [`references/product-launch.md`](references/product-launch.md).

## Playbook 3 — Lead-gen account setup

For B2B / SaaS / services moving onto Meta lead-gen:

| Step | Action |
|---|---|
| 1 | Confirm Page has `ADVERTISE` + `MANAGE_LEADS` tasks via `adadvisor:list_pages`. |
| 2 | Build the lead form with `adadvisor:create_lead_form`. Privacy policy URL mandatory. `follow_up_action_url` required (often missed — Meta subcode 1892085). |
| 3 | `create_campaign(objective='OUTCOME_LEADS')` — campaign-level. |
| 4 | `create_adset(optimization_goal='LEAD_GENERATION', destination_type='ON_AD')` — ad-set level. |
| 5 | `create_creative(format='image_link' | 'video', lead_gen_form_id=<from step 2>, call_to_action_type='SIGN_UP')`. The MCP auto-overrides `link` to `http://fb.me/` and embeds the form ID. |
| 6 | `create_ad(...)` — no `conversion_domain` needed for lead-form ads. |
| 7 | Activate from leaf up. |

Quality filter — require 2-3 form fields beyond email to filter junk leads. Many lead-gen accounts have "high volume, low quality" because forms are too easy.

Optimization event: **Lead Submitted** fired from CRM via CAPI is the gold standard. Optimizing for the on-Meta `LEAD_GENERATION` event is fine but allows lower-quality leads through.

Full setup in [`references/lead-gen-setup.md`](references/lead-gen-setup.md).

## Playbook 4 — Banned-account recovery

When an ad account is disabled or restricted:

| Step | Action |
|---|---|
| 1 | **Don't appeal repeatedly.** Each rejected appeal makes the next harder. Submit ONE appeal through Account Quality with documentation. |
| 2 | While the appeal pends: warm up a backup ad account (have one always pre-built in Business Manager). Move pixel to the backup. Restart with low budgets ($25-50/day). |
| 3 | New-account discipline: 50% of normal budget for first 7 days. No creative that's been flagged before. Conservative claims. No policy-edge content. |
| 4 | Identity-confirm everything. Domain verification, business verification, payment method match. |

Pixel-specific issue: if pixel events stop firing, immediately verify CAPI is still firing via `adadvisor:get_pixel_health` — campaigns can survive a pixel outage if CAPI is healthy. Then debug client-side (often a GTM or theme update broke it).

Full recovery sequence in [`references/account-recovery.md`](references/account-recovery.md).

## Playbook 5 — $1k → $10k/day scale plan

Three stages, each ~2-6 weeks depending on creative production cadence:

| Stage | Range | Plays |
|---|---|---|
| 1 | $1k → $2.5k/day | Vertical 20% on confirmed winners. Add 1-2 ad sets with broader audience. Lock in 3-5 winning creatives. |
| 2 | $2.5k → $5k/day | Horizontal scaling — duplicate winners into new audiences (LAL expansions, geo). Introduce ASC alongside manual. Creative production becomes weekly. Track MER. |
| 3 | $5k → $10k/day | Bid-cap diversification (Tichenor method). Target ROAS campaigns (Faris method). Brand/awareness at 10-15%. Creative production cadence: 4+ new concepts/week. |

Critical: at each stage, expect CPA to inflate 10-20%. Most operators stall at $5k-$10k/day because they protect a misleading ROAS instead of optimizing for total profit dollars. The senior buyer's discipline: optimize for **marginal profit on marginal spend**.

Full stage-by-stage plan with budget caps, kill thresholds, and audience-expansion sequences in [`references/scale-1k-to-10k.md`](references/scale-1k-to-10k.md).

## Workflow — picking the playbook

1. Listen for the trigger phrase. If ambiguous, ask.
2. Load the matching `references/<playbook>.md`. Walk the user through the relevant phase first; don't dump the entire playbook.
3. Ground every checkpoint in the user's actual account state — read the context resource, pull current performance, surface what's already in place.
4. Track which checkpoint they're at. Most playbooks span weeks; check in at each milestone.
5. Cross-reference other skills as needed: `adadvisor-launch` for new campaign creation; `adadvisor-scale` for scaling mechanics; `adadvisor-creative` for production cadence.

## Decision rules

- **Playbooks are templates, not prescriptions.** If the user's situation diverges (different vertical, different account maturity, different margins), adapt — but say so explicitly.
- **Always pair playbook checkpoints with measurable thresholds.** "Increase budget 30%" isn't a checkpoint; "increase budget 30% when ROAS holds ≥1.2× break-even for 3 days" is.
- **Never run a playbook in parallel with another (without coordination).** BFCM playbook + product launch in the same week is operationally fatal.
- **Re-baseline expectations.** At every transition, the user should confirm they understand the trade-off (higher CPA at scale; higher CPM during BFCM).

## Anti-patterns

- ❌ Running the BFCM playbook starting T-2 weeks. ✅ The lead time is 6-8 weeks for audience warm-up; if it's too late, do a compressed version honestly.
- ❌ Launching a new product with no creative diversity in week 1. ✅ 5-8 distinct concepts minimum.
- ❌ Appealing a banned account 4 times in one week. ✅ One careful appeal with documentation, then move to backup.
- ❌ Scaling from $1k to $10k/day in 2 weeks. ✅ 6-12 weeks per the stage plan; faster requires accepting CPA inflation and tightened kill rules.
- ❌ Using lead-gen Meta-form leads without a CRM-fired CAPI event. ✅ Optimization on a "Lead Submitted" event from CRM is the discipline; Meta-form events alone leak quality.
- ❌ "BFCM is just turning the budgets up." ✅ Pacing, creative refresh cadence, bid strategy, exclusion logic, post-BFCM cool-down — all part of the play.

## References

- [`references/bfcm-playbook.md`](references/bfcm-playbook.md) — full 8-week BFCM timeline with MCP calls per checkpoint.
- [`references/product-launch.md`](references/product-launch.md) — new product launch with the 5-8 concept matrix.
- [`references/lead-gen-setup.md`](references/lead-gen-setup.md) — end-to-end lead-gen account setup including CRM/CAPI optimization.
- [`references/account-recovery.md`](references/account-recovery.md) — banned-account and pixel-outage recovery sequence.
- [`references/scale-1k-to-10k.md`](references/scale-1k-to-10k.md) — the three-stage scale plan with thresholds.
- [`references/multi-account-agency.md`](references/multi-account-agency.md) — agency workflows: managing 5+ client accounts in the same session.
