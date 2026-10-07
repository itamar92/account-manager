---
name: adadvisor-launch
description: |
  Plan a Meta campaign launch for a show as a build sheet to enter in Ads Manager — objective selection, CBO vs ABO vs ASC, ad-set structure, targeting, creative, budget and schedule against the show date, and PAUSED-by-default activation. Use when: "launch a campaign", "create a campaign", "set up an ad", "build me a campaign", "start running ads", "spin up", "I want to advertise X", "create an ad set", "create an ad", "make a campaign for", "duplicate this and change", "test a new audience". Chain with: adadvisor (always — data limits and show economics); adadvisor-targeting for audience strategy; adadvisor-creative for creative selection and pairing; adadvisor-playbooks for vertical-specific launch SOPs (BFCM, lead-gen, new product). NOT for: scaling existing winners (use adadvisor-scale); diagnosing problems (use adadvisor-diagnose); refresh-only operations (use adadvisor-creative).
license: Apache-2.0
version: 0.1.0-account-manager
---

> **Connection override — read this first.** This skill was written for the adadvisor.ai MCP server, which can read *and change* a Meta ad account. This project does **not** use that server. It uses the app's own **read-only** Meta connection (`account-manager` MCP: `moonlight_campaigns`, `moonlight_ad_analysis`, `moonlight_shows`, `moonlight_campaign_advice`), which is **campaign-level only** and measures a band's **shows** (cost per ticket), not an online shop (ROAS).
>
> - Load the `adadvisor` foundation skill first; it defines the data limits and the show economics.
> - Wherever this skill says `adadvisor:<tool>`, translate it with `../adadvisor/references/mcp-tool-cheatsheet.md`. A **read** maps to a campaign-level tool or is *not available*; a **write** becomes **an instruction for the user to carry out in Ads Manager** (`../adadvisor/references/mutation-safety.md`) — never claim it was done.
> - Replace break-even ROAS / target CPA / AOV with the band's own cost-per-ticket history (`../adadvisor/references/economics.md`). The show date sets the runway; always state it.
> - Where a step needs something this connection cannot see (ad set / ad data, pixel, frequency by day, copy), say what is missing and ask the user to paste it from Ads Manager. Do not guess.
> - Everything below describes the method; the method is sound, the tool calls are not available as written.
>
> **For this skill:** nothing can be created. The output of a launch is a **build sheet** the user enters in Ads Manager: show and date, runway, objective, structure, budget (₪/day and total), schedule (start ≥ 3 weeks out where possible), audience, placements, creative and copy, destination URL, names that match the account's existing pattern and contain the show label (so the app's mapping suggestions find it), and **everything created paused**. Skip the `conversion_domain`, lead-form and API-field details unless the user asks for the Ads Manager equivalent. After launch, tell the user to map the campaign to its show in the app.

# AdAdvisor — Campaign Launch

This skill orchestrates the full launch flow. Done right, launches go from "I want to advertise X" to a properly-structured PAUSED campaign ready for the user's final sign-off — in under 10 turns, without losing context, without missing fields Meta will reject on.

## When to use

- The user wants something new running.
- The user is duplicating an existing winner to test a new audience / geo / creative angle (use `duplicate_*` tools instead of `create_*` when this applies).
- The user is testing a brand-new product, offer, or angle from scratch.

## Pre-launch: foundation

`adadvisor` foundation must have run — you have the account, business context (AOV, break-even ROAS, target CPL), and pixel selection if there are multiple pixels. **If the account has multiple pixels and you're launching a conversion campaign, you MUST pick the right one** (match by `hosts` in `list_ad_accounts.pixels` to the storefront URL). The default of "first pixel" silently breaks attribution.

## Launch decision tree

Walk the user through these decisions in order before touching the MCP. If they answered some upfront, skip:

### 1. Objective

| User goal | Objective |
|---|---|
| Online sales (ecom, subscription, in-app purchase) | `OUTCOME_SALES` |
| Form-fill leads, quote requests, demos | `OUTCOME_LEADS` |
| App installs / in-app actions | `OUTCOME_APP_PROMOTION` |
| Site visits without conversion intent | `OUTCOME_TRAFFIC` |
| Awareness, reach, brand video views | `OUTCOME_AWARENESS` |
| Page likes, post engagement | `OUTCOME_ENGAGEMENT` |

**Default for DTC ecom: `OUTCOME_SALES`.** Optimize on the deepest pixel event that fires ≥25 times/week. For low-volume new businesses, optimize on `LANDING_PAGE_VIEWS` until you have purchase volume.

### 2. Structure — ASC vs Advantage+ Sales Campaign vs Manual

| Pattern | When |
|---|---|
| **Advantage+ Sales Campaign (ASC)** | Default for ecom with proven creative and ≥30/week purchases. ~22% ROAS lift over manual on average (Tinuiti 2024 data). |
| **Manual prospecting + retargeting** | Brand-new account, lead-gen, low pixel volume, or you need creative-level kill control. |
| **Both (with exclusions!)** | Mature accounts running ASC + 1 manual testing campaign. ASC must exclude the manual campaign's audience and vice versa to avoid cannibalization. |

If the user picks "both" without intending exclusions, push back — surface the cannibalization risk.

### 3. CBO (campaign budget) vs ABO (ad set budgets)

- **Manual prospecting:** ABO for testing (3-5 ad sets, equal budgets), CBO for scaling (1-3 proven ad sets, Meta allocates).
- **Lebesgue 2024 data:** ABO delivers 94% of target ROAS vs CBO's 81% on prospecting. Tie-breaker for testing: ABO.
- **Retargeting:** CBO wins. Audiences are tightly defined; let Meta allocate.

### 4. Budget threshold

Compute the minimum daily ad-set budget to exit learning:

```
min_budget = (target_CPA × 50) / 7
```

At $30 target CPA: $214/day per ad set. At $50: $357/day. Below this threshold, the ad set sits in permanent learning. If the user's total budget can't support this for the # of ad sets they want, consolidate.

### 5. Ad-set count

- **Testing phase (week 1-2):** 3-5 ad sets in 1 ABO campaign — different audience hypotheses.
- **Validated structure:** 1-2 ad sets per campaign (1 broad, 1 lookalike, optionally 1 interest).
- **Retargeting:** 1 ad set with custom audiences in `custom_audiences` and excluded purchasers in `excluded_custom_audiences`.

### 6. Geographic / demographic

Read `business.geographic_scope` from the context. "International" → broad geo; "US-only" → `countries: ['US']`. Ask the user about specific geo testing intent (e.g., MSAs).

### 7. Targeting

See `adadvisor-targeting` for the full audience playbook. Short version:
- **Prospecting:** broad (geo + age + Advantage+ Audience ON) — let creative do the targeting.
- **Lookalike (where seed available):** 1% LAL for precision, 3-5% for scale.
- **Retargeting:** 30/60/90-day site visitors, 180-day video viewers (≥25%), email subscribers.
- **Interest stacking is dead** for most ecom — Meta consolidated detailed targeting June 2025.

### 8. Creative

See `adadvisor-creative`. Pick:
- **For new accounts (no winners yet):** 3-5 distinct concepts in one ad set; let Meta find what works.
- **For accounts with proven winners:** duplicate the winner via `duplicate_ad(target_adset_id=new)` to preserve social proof.
- **For multi-variant testing:** Dynamic Creative — set `is_dynamic_creative: true` on the ad set, attach ONE ad with `messages: [...]`, `headlines: [...]`, `descriptions: [...]` arrays (max 5 each).

## Workflow — MCP call sequence

For a standard prospecting launch (manual, ABO):

```
1. adadvisor:list_ad_accounts → pick account
2. Read adadvisor://account/{id}/context (resource)
3. (optional) adadvisor:list_pages → confirm page for lead-gen objectives
4. (optional) adadvisor:get_pixel_health → confirm pixel choice
5. adadvisor:create_campaign(account_id, campaigns=[{
     objective: 'OUTCOME_SALES',
     name: '<ADADVISOR convention or user pattern>',
     spend_cap: <lifetime safety rail — recommended whenever an agent creates>,
     buying_type: 'AUCTION'
   }])
6. adadvisor:search_targeting(search_type='interests', query='...') ×N if any interest targeting
7. (optional) adadvisor:estimate_audience_size(...) — sanity check reach before committing
8. adadvisor:create_adset(account_id, adsets=[{
     campaign_id: <from step 5>,
     daily_budget: <≥ (target_CPA × 50 / 7)>,
     countries: ['US'],  // or other geo
     age_min, age_max, genders if specified
     interests / behaviors / custom_audiences from steps 6-7
     promoted_object: { pixel_id, custom_event_type: 'PURCHASE' },  // CRITICAL for multi-pixel accounts
     optimization_goal: 'OFFSITE_CONVERSIONS',
     billing_event: 'IMPRESSIONS',
     dsa_beneficiary, dsa_payor if EU-targeted
   }, ...])
8. adadvisor:search_ad_images(queries=[...]) or adadvisor:upload_creatives → image_hash / video_id
9. (optional) adadvisor:preview_existing_creatives(image_hash=...) → check if this asset has engagement to preserve via existing_post
10. adadvisor:create_creative(account_id, creatives=[{
      format: 'image_link' | 'video' | 'existing_post',
      image_hash | video_id | object_story_id,
      message, headline, description,
      link: <storefront URL>,
      call_to_action_type: 'SHOP_NOW',
      lead_gen_form_id if lead-gen
    }, ...])
11. adadvisor:create_ad(account_id, ads=[{
      adset_id, creative_id, name,
      conversion_domain: '<root domain>'  // REQUIRED for pixel-tracked
    }, ...])
12. (after user confirms) adadvisor:change_entity_status(entity_type='campaign', entity_ids=[id], action='resume')
13. adadvisor:change_entity_status(entity_type='adset', entity_ids=[...], action='resume')
14. adadvisor:change_entity_status(entity_type='ad', entity_ids=[...], action='resume')
```

Activation order: leaf-up activation is unnecessary because Meta uses the entity-level status. But **all three levels** must be ACTIVE for delivery. Step 14 isn't optional.

## Decision rules — mutual-exclusivity gates

The MCP server rejects these combinations:

- `daily_budget` AND `lifetime_budget` on the same entity → pick one. Lifetime requires `stop_time`/`end_time`.
- `bid_strategy: 'COST_CAP' | 'LOWEST_COST_WITH_BID_CAP'` requires `bid_amount`.
- `bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS'` requires `roas_average_floor` AND `optimization_goal: 'VALUE'`. Do not set `bid_amount` with this strategy.
- `special_ad_categories` with any non-`NONE` value requires `special_ad_category_country`.
- `is_dynamic_creative: true` requires ONLY ONE ad in that ad set, and that ad's creative must have multi-variant `messages` / `headlines` / `descriptions` arrays.
- For OUTCOME_LEADS with on-platform forms: `optimization_goal: 'LEAD_GENERATION'`, `destination_type: 'ON_AD'`, and the creative must have `lead_gen_form_id` set (CTA defaults to `SIGN_UP`).
- For `OUTCOME_APP_PROMOTION`: campaign-level `promoted_object` with `application_id` + `object_store_url` is REQUIRED; iOS requires `is_skadnetwork_attribution: true`.

## `conversion_domain` — the silent killer

For any `create_ad` on a pixel-optimized campaign, `conversion_domain` is mandatory. Meta rejects with subcode 2490408. Format: **registrable second-level domain**, e.g. `'adadvisor.ai'` — NOT `'https://app.adadvisor.ai/path'`, NOT `'app.adadvisor.ai'`. Strip the subdomain.

Skip `conversion_domain` for awareness, engagement, and lead-form ads.

## EU / DSA fields

Any ad set targeting EU countries needs `dsa_beneficiary` and `dsa_payor` (max 512 chars each). The MCP auto-populates from the ad account's default if available; otherwise Meta rejects with subcodes 3858079 / 3858081. If the ad account has no defaults set, ask the user to set them in the AdAdvisor app first, or pass values explicitly.

## Anti-patterns

- ❌ Creating one ad set per audience hypothesis with low budgets — each starves. ✅ ABO with 3-5 ad sets at proper budget threshold, OR consolidate to 1-2 ad sets with broader audiences.
- ❌ Skipping the pixel-pick on a multi-pixel account. ✅ Cross-reference `pixels[].hosts` to `storefront_url`; pass `promoted_object={pixel_id, custom_event_type}` explicitly.
- ❌ Activating the campaign and assuming everything inside is on. ✅ Activate each level explicitly.
- ❌ Launching with no `spend_cap`. ✅ Always include a lifetime safety rail when an agent is creating the campaign.
- ❌ Pasting "https://shop.example.com/path" into `conversion_domain`. ✅ Strip to `example.com`.
- ❌ Setting `is_dynamic_creative: true` and then attaching 3 ads. ✅ Dynamic creative ad sets accept only ONE ad.
- ❌ Using `OUTCOME_TRAFFIC` to drive purchases. ✅ Wrong objective — Meta won't optimize for buyers; use `OUTCOME_SALES` with `LANDING_PAGE_VIEWS` if pixel volume is too low for purchase optimization.
- ❌ Using detailed-interest stacking in 2026. ✅ Broad with Advantage+ Audience; let creative do the targeting.

## References

- [`references/launch-checklist.md`](references/launch-checklist.md) — copy-pasteable pre-flight checklist before any `create_campaign`.
- [`references/structure-decisions.md`](references/structure-decisions.md) — ASC vs Advantage+ Sales Campaign vs Manual, CBO vs ABO, ad-set count rationale.
- [`references/bid-strategies.md`](references/bid-strategies.md) — when to use each bid strategy, with thresholds, and `bid_amount` formulas.
- [`references/conversion-domain.md`](references/conversion-domain.md) — Meta subcodes and registrable-domain rules, with examples.
- [`references/eu-dsa.md`](references/eu-dsa.md) — DSA beneficiary/payor requirements; account-default fallback.
- [`references/lead-gen-flow.md`](references/lead-gen-flow.md) — full lead-gen launch sequence including `create_lead_form`.
- [`references/duplicate-vs-create.md`](references/duplicate-vs-create.md) — when to `duplicate_campaign` / `duplicate_adset` / `duplicate_ad` vs `create_*`.
