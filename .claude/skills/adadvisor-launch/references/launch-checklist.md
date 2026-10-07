## Launch checklist — copy-paste before any `create_campaign`

This is the pre-flight checklist for any campaign launch. Every box must be checked before the first `adadvisor:create_campaign` call. The cost of skipping a step is either Meta rejection (subcodes 2490408, 3858079, 3858081, 1892085) or silent attribution failure (wrong pixel on multi-pixel accounts).

Copy this checklist verbatim into your working notes for each launch, mark boxes as you go.

## Pre-flight — foundation

- [ ] **Account confirmed.** Called `adadvisor:list_ad_accounts` and identified the right `account_id`. If the user has multiple accounts, confirmed which one explicitly — don't assume "the active one."
- [ ] **`data_synced=true`** on the chosen account. If false, performance reads are stale; mutations work but planning is blind.
- [ ] **Context resource read.** Called `ReadMcpResourceTool('adadvisor://account/{account_id}/context')`. Have `business.break_even_roas`, `business.average_order_value`, `business.target_cpl` (if lead-gen), `business.storefront_url`, AI research report.
- [ ] **Pixel chosen** if multi-pixel. Cross-referenced `pixels[].hosts` to `storefront_url`. pixel_id in hand. *(Skip if not conversion.)*
- [ ] **`target_CPA` computed.** `target_CPA = AOV / target_ROAS`; `target_ROAS = break_even_ROAS × (1 + profit_margin)`. Default 30% profit. Surfaced to user.
- [ ] **`target_CPL` confirmed** if lead-gen.
- [ ] **Structure decision.** ASC / Advantage+ / Manual; CBO / ABO. See [`./structure-decisions.md`](./structure-decisions.md).
- [ ] **Audience strategy.** Broad+AdvAudience / 1% LAL / interest-stack / retargeting. Custom audience IDs in hand.
- [ ] **Creatives sourced.** `image_hash` / `video_id` / existing `creative_id` / `upload_creatives`.
- [ ] **Min daily budget.** `min_daily_budget = (target_CPA × 50) / 7`. Floor to exit learning.
- [ ] **EU targeting flagged.** `dsa_beneficiary`/`dsa_payor` required if any EU country in `countries`.

## `create_campaign` params

- [ ] `objective` — chosen from the launch decision tree (`OUTCOME_SALES`, `OUTCOME_LEADS`, `OUTCOME_APP_PROMOTION`, `OUTCOME_TRAFFIC`, `OUTCOME_AWARENESS`, `OUTCOME_ENGAGEMENT`).
- [ ] `name` — follows account naming convention (or AdAdvisor default `<ANGLE> || <OBJECTIVE> || <AUDIENCE> || <DATE>`).
- [ ] `buying_type` — usually `AUCTION`. Reserve-only buys (e.g., Reach & Frequency) require `RESERVED` and a different launch flow.
- [ ] `spend_cap` — **always set** when an agent is creating. Lifetime safety rail. Suggest 2-4 weeks of intended daily spend.
- [ ] `special_ad_categories` — set if applicable (`HOUSING`, `EMPLOYMENT`, `CREDIT` retired → use `FINANCIAL_PRODUCTS_SERVICES`, `SOCIAL_ISSUES_ELECTIONS_POLITICS`). If non-`NONE`, MUST set `special_ad_category_country`.
- [ ] `bid_strategy` (if setting at campaign level for CBO) — see [`./bid-strategies.md`](./bid-strategies.md).

## `create_adset` params

- [ ] `campaign_id` — from the just-created campaign.
- [ ] `name` — follows ad-set naming convention.
- [ ] `daily_budget` OR `lifetime_budget`, **never both**. Lifetime requires `end_time`.
- [ ] `optimization_goal` — matches objective; deepest pixel event firing ≥ 25/week.
- [ ] `billing_event` — `IMPRESSIONS` for most cases.
- [ ] `bid_strategy` and `bid_amount` / `roas_average_floor` — see [`./bid-strategies.md`](./bid-strategies.md).
- [ ] `promoted_object` for conversion ad sets: `{pixel_id, custom_event_type}`. Required for multi-pixel; explicit is safer everywhere.
- [ ] `targeting` — `countries`, `age_min/max`, optional `genders`, `interests`/`behaviors` (validated IDs from `search_targeting`), `custom_audiences` for retargeting, `excluded_custom_audiences` (purchasers), `targeting_automation: {advantage_audience: 1}` for broad.
- [ ] `dsa_beneficiary` and `dsa_payor` if EU-targeted (≤ 512 chars).
- [ ] `is_dynamic_creative: true` only with ONE DCO ad.
- [ ] `start_time` / `end_time` — `end_time` required with `lifetime_budget`.

## `create_creative` params

- [ ] `format` — `'image_link'` / `'video'` / `'existing_post'`.
- [ ] `image_hash` (for image_link) OR `video_id` (for video) OR `object_story_id` (for existing_post).
- [ ] `message` — primary text. Length ≤ 125 chars best for mobile feed; truncation safe to 2,200.
- [ ] `headline` — ≤ 40 chars.
- [ ] `description` — ≤ 30 chars (often hidden in mobile).
- [ ] `link` — full storefront URL (or product page).
- [ ] `call_to_action_type` — appropriate for objective:
  - Ecom: `SHOP_NOW`, `LEARN_MORE`, `ORDER_NOW`
  - Lead-gen: `SIGN_UP`, `LEARN_MORE`, `APPLY_NOW`
  - App: `INSTALL_NOW`, `USE_APP`
- [ ] `lead_gen_form_id` — required for lead-gen creatives. Comes from `create_lead_form`.
- [ ] `page_id` — required. Comes from `list_pages`.
- [ ] `instagram_actor_id` — optional; if omitted, Meta uses the Page's IG account.

## `create_ad` params

- [ ] `adset_id` — from the just-created ad set.
- [ ] `creative_id` — from the just-created creative (or existing creative).
- [ ] `name` — usually `<CREATIVE_ANGLE> | <CREATIVE_FORMAT>`.
- [ ] **`conversion_domain`** — registrable second-level domain (e.g., `'example.com'`, NOT `'https://shop.example.com/path'`). REQUIRED for pixel-tracked. Meta rejects with subcode 2490408 otherwise. See [`./conversion-domain.md`](./conversion-domain.md).
- [ ] `tracking_specs` — optional. Default works for most accounts.

## Activation sequence

After all creates return successfully:

- [ ] Surface the complete entity tree to the user — campaign name, ad sets, ads, budgets, audiences. Confirm before activating.
- [ ] Call `adadvisor:change_entity_status(entity_type='campaign', entity_ids=[<id>], action='resume')`.
- [ ] Call `adadvisor:change_entity_status(entity_type='adset', entity_ids=[<ids>], action='resume')`.
- [ ] Call `adadvisor:change_entity_status(entity_type='ad', entity_ids=[<ids>], action='resume')`.
- [ ] Verify activation: call `adadvisor:list_ads(campaign_id=<id>)` and confirm `effective_status` is delivering (`ACTIVE`, `LEARNING`, etc., not `INACTIVE` or `WITH_ISSUES`).

## Edge cases — extra boxes for specific launch types

### Lead-gen

- [ ] `list_pages` called and Page confirmed to have `ADVERTISE` + `MANAGE_LEADS` tasks.
- [ ] `create_lead_form` called with valid `privacy_policy.url` AND `follow_up_action_url`. The follow-up URL is required even though undocumented — Meta subcode 1892085. See [`./lead-gen-flow.md`](./lead-gen-flow.md).
- [ ] `destination_type: 'ON_AD'` on the ad set.
- [ ] `optimization_goal: 'LEAD_GENERATION'`.
- [ ] Creative has `lead_gen_form_id` set; CTA defaults to `SIGN_UP`.

### App promotion

- [ ] Campaign-level `promoted_object` includes `application_id` + `object_store_url`.
- [ ] iOS: `is_skadnetwork_attribution: true`.
- [ ] SKAN postback configuration in place at the user's MMP (AppsFlyer / Adjust).

### Dynamic Creative

- [ ] `is_dynamic_creative: true` on the ad set.
- [ ] Exactly ONE ad per ad set.
- [ ] Creative has multi-variant `messages: [...]`, `headlines: [...]`, `descriptions: [...]` arrays (max 5 each).

### Catalog / DPA

- [ ] `product_catalog_id` in `promoted_object`.
- [ ] Creative uses `template_url_spec` or product set IDs.

## Anti-patterns the checklist prevents

- Launching with no `spend_cap` — discovered $4K of unintended spend the next morning.
- Skipping pixel-pick on multi-pixel — silently optimizing on wrong pixel; attribution scrambled.
- Activating campaign and assuming ad sets and ads follow — they don't. Three explicit `change_entity_status` calls.
- Missing `conversion_domain` — Meta rejects, agent retries with garbage value, ad goes live attributing to wrong domain.
- Missing `dsa_beneficiary`/`dsa_payor` on EU — Meta rejects with subcode 3858079/3858081.
- Setting `is_dynamic_creative: true` AND attaching 3 ads — Meta rejects.

## See also

- [`./structure-decisions.md`](./structure-decisions.md) — ASC vs ABO vs CBO rationale.
- [`./bid-strategies.md`](./bid-strategies.md) — bid strategy decision table.
- [`./conversion-domain.md`](./conversion-domain.md) — what makes a domain "registrable."
- [`./eu-dsa.md`](./eu-dsa.md) — DSA beneficiary/payor strings.
- [`./lead-gen-flow.md`](./lead-gen-flow.md) — full lead-gen launch.
- [`./duplicate-vs-create.md`](./duplicate-vs-create.md) — when to duplicate instead of create.
