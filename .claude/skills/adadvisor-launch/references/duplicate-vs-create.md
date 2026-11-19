## Duplicate vs Create — which tool, when

The MCP exposes both `create_*` and `duplicate_*` tools at every level (campaign, adset, ad). The choice is meaningful: duplicates preserve learning, social proof, and configuration. Creates start clean. This reference encodes the decision logic, the `deep_copy` semantics, the cross-parent duplication mechanics, and the PAUSED-by-default invariant.

## The decision rule

```
Have you launched something like this before AND it worked?
├── Yes → duplicate_*
└── No  → create_*
```

That's the core rule. The corollaries:

| Situation | Tool | Why |
|---|---|---|
| Proven winner, want to test a new audience | `duplicate_adset(target_campaign_id=<same or new>)` | Keep the ads with their engagement / social proof |
| Proven winner, want to scale to new geo | `duplicate_adset(target_campaign_id=<same>, then update_adset_targeting)` | Geo is a targeting change; ad set duplicated to isolate the new geo's learning |
| Proven creative, want to test in a different audience cohort | `duplicate_ad(target_adset_id=<new>)` | The ad keeps its post engagement; social proof transfers |
| Brand-new offer, different product line | `create_campaign` | No learning to preserve |
| Same offer but switching from sales to lead-gen | `create_campaign` | Different objective is a structural change |
| Same campaign, want to test a different bid strategy | `create_adset` | Bid strategy resets learning anyway, no preservation benefit |
| A/B test of headline / hook on an existing ad | `duplicate_ad` then edit the duplicate | Preserves the original's performance baseline |
| BFCM seasonal campaign, similar to last year's | `duplicate_campaign(deep_copy=True)` | Reuse structure, audience, creative shell — then update offer copy |

## What "preserving learning" actually means

Meta learns at the ad-set level. A duplicate inherits the **structure** but **starts fresh** in the auction — the ad set re-learns.

Where duplicates win is at the **ad** level: a duplicated ad keeps the original post's `object_story_id`, inheriting all social proof (likes, comments, shares, video views). That social proof IS the ad. Re-creating loses every interaction.

- `duplicate_campaign` — preserves structure, not performance.
- `duplicate_adset` — preserves targeting/budget/bid, not learning.
- `duplicate_ad` — preserves post engagement. The high-value duplicate.

## `deep_copy=True` vs `deep_copy=False`

The `duplicate_*` tools all accept a `deep_copy` parameter.

- **`deep_copy=True`** (default for most cases): recursively duplicates children.
  - `duplicate_campaign(deep_copy=True)` → duplicates the campaign, all ad sets, all ads.
  - `duplicate_adset(deep_copy=True)` → duplicates the ad set and all its ads.
  - `duplicate_ad` doesn't have children, so `deep_copy` is irrelevant.

- **`deep_copy=False`**: shallow duplicate. Creates the parent shell only.
  - `duplicate_campaign(deep_copy=False)` → creates an empty campaign. The response includes `next_steps` enumerating "now duplicate or create ad sets under this."
  - `duplicate_adset(deep_copy=False)` → creates an empty ad set, no ads attached. The response includes `next_steps` for attaching ads.

The shallow form is useful when you want the shell's configuration (campaign name pattern, ad set targeting/budget/bid strategy) but want to attach different children. Common in seasonal restarts where the audience changes year-over-year but the structure repeats.

## Cross-parent duplication — `target_campaign_id` / `target_adset_id`

By default, duplicates land in the same parent. To move:

- `duplicate_adset(..., target_campaign_id=<other>)` — moves into a different campaign.
- `duplicate_ad(..., target_adset_id=<other>)` — moves into a different ad set.

Both must be in the same ad account. Target parent must exist before the call.

**Example — manual → Advantage+:**

```
adadvisor:duplicate_adset(source_adset_id='as_winner', target_campaign_id='c_advplus', deep_copy=True)
```

**Example — winning creative against new audience:**

```
adadvisor:duplicate_ad(source_ad_id='a_winner', target_adset_id='as_new_audience')
```

## PAUSED by default — the activation invariant

All `duplicate_*` results return `status='PAUSED'` by default, just like `create_*`. There is no "duplicate and activate" — agents must explicitly call `change_entity_status(action='resume')` after duplication.

This is intentional. The most common duplicate-related mistake is "duplicate then walk away," with the duplicate sitting unactivated for days. Surface the activation step to the user before walking away.

## Idempotency — duplicates are NOT

Every call to `duplicate_*` creates a NEW entity. There is no "duplicate idempotently." Two identical duplicate calls produce two duplicates. If a duplicate call seems to have failed, check `list_*` for the entity before retrying — you may have a successful duplicate AND be about to make a second one.

This contrasts with `change_entity_status` and `change_entity_budget`, which are idempotent.

## When NOT to duplicate

- **Brand-new offer.** Nothing to preserve. `create_*` is cleaner and avoids polluting the duplicate with vestigial settings.
- **Migrating between bid strategies.** Bid strategy changes reset learning; duplicating only carries forward the now-irrelevant prior learning. Just `create_*` with the new strategy.
- **Different objective entirely.** Sales → Lead-gen, or Sales → App Promotion. Different objectives have different field requirements; `duplicate_campaign` across objectives doesn't work cleanly.
- **Different account.** Cross-account duplication isn't supported by Meta's API. Use the AdAdvisor app's account-export tooling instead.
- **Cleaning up a messy structure.** If the source is structured badly, duplicating propagates the mess. Use create with a clean structure.

## Worked examples

### Example 1 — Vertical scale via audience duplication

$80K/mo DTC supplements. Winning ad set at 4.5× ROAS, 60 conv/week. Want a parallel audience without resetting the original's learning.

```
adadvisor:duplicate_adset(source_adset_id='as_winner', deep_copy=True)
adadvisor:update_adset_targeting(adset_id='<new>', targeting={'custom_audiences': ['<3% LAL>'], 'countries': ['US']})
adadvisor:change_entity_status(entity_type='adset', entity_ids=['<new>'], action='resume')
```

Two parallel ad sets, same ads (same social proof), different audience cohorts.

### Example 2 — Cross-campaign migration

Migrating from Manual to Advantage+ while keeping winning ads.

```
adadvisor:create_campaign(...) → c_new
adadvisor:create_adset(campaign_id='c_new', ...) → as_new
adadvisor:duplicate_ad(source_ad_id='a_winner_1', target_adset_id='as_new')
adadvisor:duplicate_ad(source_ad_id='a_winner_2', target_adset_id='as_new')
```

2 ads under the new ad set, preserving post engagement. Run new alongside old for 1-3 days, then pause old.

### Example 3 — Seasonal restart with `deep_copy=False`

```
adadvisor:duplicate_campaign(source_campaign_id='c_bfcm_last_year', deep_copy=False)
# Empty campaign with last year's name pattern, budget, spend cap.
# Build this year's ad sets and ads under it.
```

### Example 4 — Headline A/B test

Prefer `create_creative` + `create_ad` over `duplicate_ad` when the underlying creative differs. Duplicate is for preserving the same creative.

## The "next_steps" pattern

Every mutation response from the MCP includes `next_steps` listing exact follow-up tool calls. For `duplicate_campaign(deep_copy=False)`, `next_steps` typically reads:

```
"This campaign was created as an empty shell. To add ad sets:
1. adadvisor:create_adset(campaign_id='<new_id>', ...)
or
2. adadvisor:duplicate_adset(source_adset_id='<id>', target_campaign_id='<new_id>')"
```

Read this field — it surfaces account-specific guidance the agent can act on directly.

## Anti-patterns

- Using `duplicate_*` for brand-new offers — duplicate is for preserving existing learning/proof, not as a shortcut to skip typing the create params.
- Forgetting to activate duplicates — they sit PAUSED. Always do the three-level activation.
- Two identical duplicate calls in a row — produces two duplicates, both PAUSED, both consuming spend cap. Verify with `list_*` before retrying.
- `duplicate_adset(deep_copy=True)` when only the ads need preserving — wastes the cross-parent move by carrying ad-set-level baggage. Use `duplicate_ad` to a target ad set instead.
- Cross-account duplication attempts — not supported. Use account-export tooling in the AdAdvisor app.

## See also

- [`./launch-checklist.md`](./launch-checklist.md) — pre-flight applies to duplicates too.
- [`./structure-decisions.md`](./structure-decisions.md) — when the structure itself should change (create) vs propagate (duplicate).
- [`./bid-strategies.md`](./bid-strategies.md) — bid strategy changes reset learning regardless of duplicate vs create.
