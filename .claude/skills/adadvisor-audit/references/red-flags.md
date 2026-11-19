## Red-flag catalog

Exhaustive list of patterns to scan during the audit's Phase 4. Each row has: **detection** (what to look for in MCP responses), **severity** (CRITICAL / HIGH / MEDIUM / LOW based on impact × time-to-loss), and **fix** (the exact MCP tool call). Surface every detection in the report; prioritize CRITICAL and HIGH in the user's action list.

Severity rubric:
- **CRITICAL** — blocks correct analysis or is bleeding money daily. Fix before continuing.
- **HIGH** — material P&L impact within a week. Fix this audit.
- **MEDIUM** — drag on performance; fix this month.
- **LOW** — hygiene; fix when convenient.

## The 20 patterns

| # | Pattern | Detection | Severity | Fix |
|---|---|---|---|---|
| 1 | **Pixel last fired > 24h ago** | `get_pixel_health.last_fired_time` older than now − 24h, or null | CRITICAL | Investigate site install (likely removed / blocked). See [`pixel-deep-dive.md`](pixel-deep-dive.md). No MCP call — needs site fix. |
| 2 | **CAPI missing** | `get_pixel_health` shows BROWSER:SERVER ratio with 0% server events | CRITICAL | Install Conversions API via Meta's setup or a partner integration (Shopify CAPI, Stape, Elevar). MCP cannot install CAPI. |
| 3 | **Low EMQ (< 5)** | `get_pixel_health.event_match_quality < 5` on the Purchase event (or primary KPI event) | HIGH | Send more identifiers from CAPI: email, phone, fn, ln, FBP, FBC, IP, UA, external_id. EMQ 8+ requires 7+ identifiers. |
| 4 | **Undersized winning ad set** | From `get_performance` (level='adset'): ROAS > 1.3× break-even AND `daily_budget < (target_CPA × 50 / 7)` | HIGH | `adadvisor:change_entity_budget(entity_id=..., daily_budget=new)` with 20-30% step up; if jump > 2× of current, stage or pass `force=True`. |
| 5 | **High frequency on small audience** | From timeseries: `frequency > 3.0` on `adset_id` where `estimate_audience_size < 1_000_000` | HIGH | Either expand the audience (broaden interests, raise age range, layer lookalikes) via `adadvisor:update_adset_targeting`, or refresh creative — saturation is the symptom of either. Foxwell 2026: frequency > 4 on < 1M audience = fatigue-confirmed. |
| 6 | **All-spend-to-one-ad concentration** | One ad accounts for > 70% of the ad set's `spend` while ≥ 5 ads are ACTIVE in the same set | MEDIUM | Either pause the underperformers via `change_entity_status`, or split the winning ad into its own ad set so it doesn't suffocate testing. CTC's "ad-of-one" rule: when one ad dominates, isolate it. |
| 7 | **Retargeting without purchaser exclusion** | An OUTCOME_SALES campaign with engagement / website custom audience in `targeting.custom_audiences` AND the same purchaser audience NOT in `targeting.excluded_custom_audiences` | HIGH | `adadvisor:update_adset_targeting(adset_id=..., excluded_custom_audiences=[purchaser_audience_id, ...])`. You're paying to retarget people who already bought. |
| 8 | **Wrong optimization event** | `optimization_goal` doesn't match campaign `objective`. Examples: LANDING_PAGE_VIEWS on OUTCOME_SALES; LINK_CLICKS on OUTCOME_LEADS | HIGH | Cannot change `optimization_goal` on a running ad set without rebuilding. Recommend `adadvisor:duplicate_adset` with corrected `optimization_goal` then pause the original. |
| 9 | **ASC + manual cannibalization** | An Advantage+ Sales Campaign exists AND a manual campaign targets the same audience (same custom audience IDs in `targeting.custom_audiences` without exclusion) | HIGH | Either pause one or add the manual prospecting custom audience to the ASC's `excluded_custom_audiences`. ASC self-optimizes; manual stepping on it dilutes both. Tichenor: pick one acquisition layer, not both. |
| 10 | **Restricted placements (no rationale)** | Ad set's `targeting.publisher_platforms` is narrower than `['facebook', 'instagram', 'audience_network', 'messenger']`, OR `targeting.facebook_positions` or `instagram_positions` is set | MEDIUM | `adadvisor:update_adset_targeting(adset_id=..., publisher_platforms=None, facebook_positions=None, instagram_positions=None)` — open to Advantage+ Placements unless the user has a specific reason (e.g. brand-safety policy). Meta 2026 default: Advantage+ Placements outperforms manual by 7-15% on $/result. |
| 11 | **No exclusion of purchasers from prospecting** | Prospecting campaign's ad set does NOT have the all-time purchaser custom audience in `excluded_custom_audiences` | HIGH | `adadvisor:update_adset_targeting(adset_id=..., excluded_custom_audiences=[purchaser_audience_id])`. Otherwise, prospecting spend leaks to retargeting territory and inflates "new customer" CAC. |
| 12 | **Dead campaigns spending** | Campaign has `status: ACTIVE` and recent spend, but `result_count: 0` over the last 7 days AND objective is conversion-based | CRITICAL | `adadvisor:change_entity_status(entity_type='campaign', entity_ids=[...], action='pause')`. Confirm with user — usually means catalog gone, pixel mismatch, or wrong destination URL. |
| 13 | **Naming-convention drift** | Recently created entities (last 30 days) don't match the existing prefix convention (e.g. mix of `WSO || ...`, `ADADVISOR || ...`, no prefix) | LOW | No mutation needed — flag in the report. Going forward, ask the user for the canonical convention and use it on creates. Optional cleanup via `adadvisor:update_entity(entity_id=..., name=...)`. |
| 14 | **EU campaigns missing DSA fields** | Campaign delivers in EU (geo targeting includes EU countries, or `special_ad_categories` not set) AND `dsa_beneficiary` / `dsa_payor` are null on the campaign | CRITICAL | `adadvisor:update_entity(entity_type='campaign', entity_id=..., dsa_beneficiary='...', dsa_payor='...')`. Required by Meta as of Feb 2024 under the EU Digital Services Act; missing → delivery rejected in EU. |
| 15 | **Modeled-conversion reliance** | `get_performance` breakdown shows > 30% of conversions are modeled (iOS / Safari heavy traffic) AND lift looks suspicious vs backend | MEDIUM | Not directly fixable. Reduce reliance by installing CAPI (raises EMQ → less modeling), broadening attribution to 7-click + 1-day-view, and reconciling against Shopify / Stripe ground truth weekly. Mitch Barham 2026: "trust click; verify modeled." |
| 16 | **Attribution-window mismatch** | Different campaigns report performance under different attribution windows (`7d_click + 1d_view` vs `1d_click`) producing inconsistent ROAS comparison | MEDIUM | Account-default attribution is set once; per-campaign overrides are rare but possible. Standardize via `adadvisor:update_entity` if exposed, or escalate to user — at minimum, note the inconsistency in the report. |
| 17 | **Learning-limited ad sets** | `delivery_info.status = LEARNING_LIMITED`, or implied: `result_count < 50` over 7 days on an ad set spending > $50/day | HIGH | Two paths: (a) consolidate — merge sibling ad sets via duplicate-and-redirect so the survivor exits learning; or (b) increase budget to `target_CPA × 50 / 7` minimum via `change_entity_budget`. Foxwell: "stuck in learning is spending on a noise floor." |
| 18 | **Audience overlap on prospecting** | Multiple active prospecting ad sets target overlapping custom audiences or lookalikes (same seed at different %, no mutual exclusion) | MEDIUM | Use `excluded_custom_audiences` to disambiguate, or consolidate via `adadvisor:duplicate_adset` then pause. Meta auction overlap inflates CPMs against yourself. |
| 19 | **Catalog feed unhealthy (DPA / ASC)** | ASC or DPA campaign exists; user reports declining performance; no MCP signal but cross-check with Commerce Manager required | MEDIUM | Outside MCP scope — surface as "Verify catalog feed in Commerce Manager: error rate, item count, image quality. Common silent failure mode for DPA." |
| 20 | **Unspent budget on lifetime campaigns** | Campaign with `lifetime_budget` set, `stop_time` in the past, but `status: ACTIVE` and zero recent spend | LOW | `adadvisor:change_entity_status(entity_type='campaign', entity_ids=[...], action='pause')`. Lifetime campaigns past stop time are zombies — not bleeding but not delivering. |

## Cross-cutting: when severity escalates

A LOW pattern can become CRITICAL when combined:

- Naming drift (LOW) + ASC cannibalization (HIGH) + no exclusion (HIGH) → indicates an unsupervised account; **all of audit findings should default to one severity level higher**.
- Modeled-conversion reliance (MEDIUM) + low EMQ (HIGH) → trusting Meta numbers becomes risky; recommend backend reconciliation as a daily ritual.
- Learning-limited (HIGH) + undersized winning ad set (HIGH) → the ad set is starved, not unprofitable. Fix budget before judging performance.

## What to do in the report

For each detected pattern, the audit report should include a single line of the form:

```
- [SEVERITY] Pattern N — entity reference — specific number — exact fix call
```

Example:

```
- [HIGH] Undersized winning ad set — `WSO || RET || US || CBO` adset_id=12095... — ROAS 5.2× on $80/day budget vs $250/day learning threshold (target_CPA $35 × 50 / 7) — adadvisor:change_entity_budget(entity_id='12095...', daily_budget=100.0); plan to step to $150 in 48h.
```

Ranked output rules:
1. CRITICAL first, then HIGH, then MEDIUM, then LOW.
2. Within a severity, rank by reversibility — easily-reversible fixes (budget, status, targeting) above hard-to-reverse (pixel reinstall, campaign rebuild).
3. Cap user-facing list at **top 5-7 items**; surface the rest under "Additional findings (lower priority)" in a collapsed section.

See [`report-template.md`](report-template.md) for the full report skeleton with a worked example.
