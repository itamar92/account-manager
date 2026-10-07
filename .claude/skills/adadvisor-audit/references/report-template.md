## Audit output template

The audit output is what the user actually reads. Everything in the audit workflow exists to feed this format. Match the structure exactly — users (and downstream agents) come to rely on the section order.

## Template (placeholders in `{braces}`)

```markdown
## Account audit: {business_name}

**Account:** `{ad_account_id}` ({currency}, {timezone})
**Date range analyzed:** {date_from} to {date_to}
**Total spend (period):** {currency_symbol}{spend} ({days} days)

### TL;DR

- **Status:** {GREEN | YELLOW | RED}
- **Critical issues:** {N} (must fix before continuing)
- **Top fixes (priority order):**
  1. {fix #1 — entity — specific number — exact MCP tool call}
  2. {fix #2}
  3. {fix #3}

### Signal integrity

- **Pixel:** {healthy / yellow / red} — {one-sentence summary with specific numbers}
- **EMQ on primary KPI event ({Purchase / Lead / Subscribe}):** {score}/10 ({rating})
- **BROWSER : SERVER event ratio:** {X}% : {Y}%
- **Top host:** `{domain}` ({matches / mismatch with} storefront `{storefront_url}`)
- **AEM priority position 1:** {event_name}
- **Issues:** {bulleted list of specific pixel issues, or "None"}

### Structure

- **Active campaigns:** {N} ({healthy / yellow / red})
- **Active ad sets:** {N} ({how many under exit-learning budget threshold of `target_CPA × 50 / 7` = ${X}/day})
- **Active ads:** {N}
- **Naming convention:** {consistent prefix detected `{prefix}` / mixed / no pattern}
- **CBO / ABO mix:** {N CBO} / {M ABO} ({notes on appropriateness})
- **ASC presence:** {N ASC campaigns} ({whether exclusions configured})
- **Consolidation needed:** {Yes / No} — {if yes, brief why}

### Performance ({date_range})

- **Total spend:** {currency_symbol}{spend}
- **Total `result_count`:** {N} ({primary KPI: Purchase / Lead / Subscribe / mixed})
- **Blended ROAS / CPL:** {X×} vs break-even {Y×} ({gap})

**Profitable campaigns** (ROAS ≥ 1.3× break-even or CPL ≤ 0.8× target):
- `{name}` — ROAS {X×} / CPA ${Y} / spend ${Z}

**Marginal campaigns** (0.8×-1.3× break-even):
- `{name}` — ROAS {X×} / CPA ${Y} / spend ${Z} — watch condition: {trigger to escalate to kill}

**Bleeding campaigns** (< 0.8× break-even):
- `{name}` — ROAS {X×} / CPA ${Y} / spend ${Z} — recommended action: {pause / fix-then-decide}

### Red flags

In priority order (CRITICAL → HIGH → MEDIUM → LOW; within severity, by reversibility):

1. **[SEVERITY]** {pattern name} — `{entity_name}` ({entity_id}) — {specific numbers detected} — Fix: `{exact MCP tool call}`
2. **[SEVERITY]** ...

(Cap at 5-7 surfaced; collapse the rest under "Additional findings".)

### Additional findings (lower priority)

- {LOW / MEDIUM items not in top 5-7}

---

**Want me to act on any of these?** I can:
- Pause the bleeding campaigns
- Scale the winners (via `adadvisor-scale`)
- Drill into a specific issue (via `adadvisor-diagnose`)
- Fix the pixel issues (via `adadvisor-pixel`, if available)
```

## Worked example — hypothetical DTC ecom audit

### Account audit: Sundra Skincare

**Account:** `act_1234567890` (USD, America/Los_Angeles)
**Date range analyzed:** 2026-04-13 to 2026-05-11 (28 days)
**Total spend (period):** $42,180

### TL;DR

- **Status:** YELLOW
- **Critical issues:** 1 (CAPI coverage missing; signal degraded)
- **Top fixes (priority order):**
  1. Install Conversions API to recover iOS / Safari signal loss. EMQ 5.2 → target 8+. No MCP fix — site-level integration (Shopify CAPI app or Stape).
  2. Scale `SUNDRA || PRO || MOF || VC30 || US` from $80/day to $200/day. ROAS 5.4× over 14 days vs break-even 2.5×, but budget is far under exit-learning threshold of $750/day. Call: `adadvisor:change_entity_budget(entity_id='1209512345', daily_budget=200.0)`.
  3. Pause `SUNDRA || PRO || TOF || INTEREST-STACK` — ROAS 1.1× over 21 days, $7,200 spent, no creative refresh in 35 days. Call: `adadvisor:change_entity_status(entity_type='campaign', entity_ids=['1209512999'], action='pause')`.

### Signal integrity

- **Pixel:** YELLOW — 1 pixel, fired 23 min ago, automatic matching with 7 fields (em, fn, ln, ph, ge, ct, country) — healthy on browser, missing CAPI.
- **EMQ on Purchase event:** 5.2/10 (OK — below the 8 target for great)
- **BROWSER : SERVER event ratio:** 100% : 0% — RED on CAPI coverage
- **Top host:** `sundra.com` (matches storefront `https://sundra.com`)
- **AEM priority position 1:** Purchase (correct)
- **Issues:**
  - No server-side events. iOS / Safari conversions modeled at ~35% of total — directional impact on ROAS readings by 15-25%.
  - EMQ on AddToCart only 4.1 (not enough identifiers passed at AddToCart event vs Purchase). Funnel optimization signal weak.

### Structure

- **Active campaigns:** 5 (healthy)
- **Active ad sets:** 11 (healthy count; 7 under exit-learning threshold of $214/day @ $30 target CPA)
- **Active ads:** 38 (some ad sets carrying 7+ ads)
- **Naming convention:** Consistent prefix `SUNDRA ||` (healthy)
- **CBO / ABO mix:** 3 CBO / 2 ABO (appropriate — ABO on the two testing campaigns)
- **ASC presence:** 1 ASC (`SUNDRA || PRO || TOF || ASC || US`) with exclusion list referencing the manual prospecting custom audience — well configured
- **Consolidation needed:** Partial — 4 of the 7 starved ad sets are in `SUNDRA || PRO || MOF || RET-MIX || US`. Recommend merging into 2 ad sets to push each over learning threshold.

### Performance (last 28 days)

- **Total spend:** $42,180
- **Total `result_count`:** 612 (primary KPI: Purchase, single conversion type — `has_multiple_conversions: false` on all campaigns)
- **Blended ROAS:** 2.9× vs break-even 2.5× (just above; marginal account-level)

**Profitable campaigns:**
- `SUNDRA || PRO || TOF || ASC || US` — ROAS 3.6× / CPA $28 / spend $13,400
- `SUNDRA || PRO || MOF || VC30 || US` — ROAS 5.4× / CPA $19 / spend $4,200 (undersized! see fix #2)
- `SUNDRA || PRO || BOF || ATC60 || US` — ROAS 6.8× / CPA $15 / spend $2,800

**Marginal campaigns:**
- `SUNDRA || PRO || TOF || BROAD || US` — ROAS 2.7× / CPA $35 / spend $14,580 — watch condition: drops below 2.0× for 3 days → pause and rebuild

**Bleeding campaigns:**
- `SUNDRA || PRO || TOF || INTEREST-STACK` — ROAS 1.1× / CPA $85 / spend $7,200 — recommended action: pause (see fix #3)

### Red flags

1. **[CRITICAL]** CAPI missing — Pixel `1234567890` — BROWSER:SERVER ratio 100:0 — Fix: Install Conversions API via Shopify (`Settings → Sales Channels → Facebook → Conversions API`) or Stape. No MCP tool.
2. **[HIGH]** Undersized winning ad set — `SUNDRA || PRO || MOF || VC30 || US` (adset_id=`1209512345`) — ROAS 5.4× at $80/day vs $214/day exit-learning threshold — Fix: `adadvisor:change_entity_budget(entity_id='1209512345', daily_budget=200.0)`; stage to $300 in 48h if performance holds.
3. **[HIGH]** Bleeding campaign with no creative refresh — `SUNDRA || PRO || TOF || INTEREST-STACK` (campaign_id=`1209512999`) — ROAS 1.1× over 21 days, $7,200 spent, all 5 ads have run unchanged for 35+ days — Fix: `adadvisor:change_entity_status(entity_type='campaign', entity_ids=['1209512999'], action='pause')`, then route to `adadvisor-creative` for replacement concept.
4. **[HIGH]** Learning-limited ad sets — `SUNDRA || PRO || MOF || RET-MIX || US` contains 4 ad sets each at $40-60/day producing 8-12 results/week, well under 50 — Fix: Consolidate via `adadvisor:duplicate_adset` merging targeting, then pause originals. Detailed plan: route to `adadvisor-diagnose`.
5. **[MEDIUM]** High frequency on small audience — `SUNDRA || PRO || BOF || ATC60 || US` adset_id=`1209514500` has frequency 4.2 on audience size ~180K (from `estimate_audience_size`) — Fix: Refresh creative on this ad set; consider extending retargeting window from 60d to 90d to widen audience.
6. **[MEDIUM]** Manual placement restriction — `SUNDRA || PRO || TOF || BROAD || US` has `publisher_platforms: ['facebook', 'instagram']` (Audience Network and Messenger excluded). 10-15% reach left on table — Fix: `adadvisor:update_adset_targeting(adset_id=..., publisher_platforms=None)` to open to Advantage+ Placements.

### Additional findings (lower priority)

- **[LOW]** Naming on the two `TEST` campaigns uses dates in `YYYY-MM-DD`, but the production prefix uses `YYYY-MM`. Standardize on one format.
- **[LOW]** Two ads in `SUNDRA || PRO || TOF || ASC || US` have negative feedback 0.08% — just under the 0.1% threshold but trending up; monitor.

---

**Want me to act on any of these?** I can:
- Pause `SUNDRA || PRO || TOF || INTEREST-STACK` and reallocate the budget into the VC30 ad set
- Open `adadvisor-creative` to brief a creative refresh on the bleeding campaign
- Drill into the consolidation plan for `RET-MIX` via `adadvisor-diagnose`
- Walk you through CAPI installation steps (this is site-level, not MCP)

## Format rules — what to keep and what to drop

**Keep:**
- Section order: TL;DR → Signal integrity → Structure → Performance → Red flags → Additional findings → Closing prompt.
- Entity references with both name and ID. The name is human-readable; the ID is canonical for follow-up MCP calls.
- Specific numbers — `ROAS 5.4×`, `frequency 4.2`, `$80/day`. Vague phrasing erodes trust.
- The break-even / target threshold next to every performance number. "ROAS 2.7×" is unactionable without the comparison.
- Exact MCP tool call in each red-flag fix line.
- Closing prompt with concrete next options.

**Drop:**
- Generic advice that doesn't reference specific entities ("consider improving your creative").
- Severity rankings without justification.
- More than ~7 red flags in the user-facing list (move the rest to "Additional findings").
- Mutation execution — the user-facing output is read-only. Mutations happen after user approval.

## When the account is too small for a full audit

If active campaigns < 3 or total monthly spend < $5,000, drop these sections:
- Structure (single campaign accounts don't have meaningful structure)
- Some performance comparisons (variance dominates small-spend numbers)

Replace with: a "launch readiness" check (pixel, budget threshold, audience size for prospecting) and route to `adadvisor-launch` if the user is in setup phase.

## Cross-references

- [`audit-checklist.md`](audit-checklist.md) — the checklist the agent ticks through to produce this output.
- [`red-flags.md`](red-flags.md) — the full pattern catalog the red-flag list draws from.
- [`pixel-deep-dive.md`](pixel-deep-dive.md) — what to write in the Signal Integrity section beyond the summary line.
- [`structure-rules.md`](structure-rules.md) — what "consolidation needed" actually means per vertical.
