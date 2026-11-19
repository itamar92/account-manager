## Dynamic Creative — deep dive

Dynamic Creative is Meta's multi-variant testing mode: one ad object, arrays of message / headline / description variants, Meta auto-combines and optimizes the combination per viewer. It's the operational deployment for Tichenor's 3-2-2 framework and the cleanest way to run copy A/B tests at scale.

This reference covers when to use it, the schema constraints the MCP enforces, and the worked example.

## What Dynamic Creative does

For a single ad in a Dynamic Creative ad set, Meta accepts arrays for the variant-capable fields and synthesizes combinations on the fly. The viewer sees one combination chosen by Meta's optimizer; the reporting aggregates at the combination level.

Variant-capable fields (max 5 per array):

| Field | Max | Notes |
|---|---|---|
| `messages` | 5 | Primary text — the body of the ad |
| `headlines` | 5 | Headlines |
| `descriptions` | 5 | Descriptions (when surface supports them) |
| (Images / videos via `asset_feed_spec`) | 10 | Mixed media within a single ad |

Singular fields (`message`, `headline`, `description`) are **mutually exclusive** with the array forms — set one or the other, not both. The MCP rejects mixed.

## Setting up a Dynamic Creative ad set

```
1. adadvisor:create_adset(
     adsets=[{
       'name': '<descriptive>',
       'campaign_id': <campaign>,
       'is_dynamic_creative': true,
       'optimization_goal': 'OFFSITE_CONVERSIONS',
       'billing_event': 'IMPRESSIONS',
       'daily_budget': <budget>,
       'targeting': { ... }
     }]
   )
   → adset_id

2. adadvisor:create_creative(
     creatives=[{
       'name': 'DC_creative_v1',
       'format': 'image_link' | 'video',
       'page_id': <page>,
       'link': <destination>,
       'messages': ['<text 1>', '<text 2>', '<text 3>'],     # max 5
       'headlines': ['<head 1>', '<head 2>'],                # max 5
       'descriptions': ['<desc 1>', '<desc 2>'],             # max 5
       'image_hash': <hash>  # or video_id for video
     }]
   )
   → creative_id

3. adadvisor:create_ad(
     ads=[{
       'name': 'DC_ad',
       'adset_id': <adset_id>,
       'creative_id': <creative_id>
     }]
   )
   → ad_id (ONLY ONE AD; see below)

4. adadvisor:change_entity_status(entity_type='ad', entity_id=<ad_id>, action='resume')
   → also resume the ad set and campaign as needed
```

## Hard limitations

### One ad per Dynamic Creative ad set

This is the constraint that breaks the most workflows. A Dynamic Creative ad set accepts exactly one ad object. Trying to create a second ad in the same ad set returns an error from Meta.

Why: Dynamic Creative reads the variant arrays from the single ad's creative. A second ad has no place in the architecture.

If you need multiple ads, use multiple ad sets. Or use static creative testing (one ad per variant, manual A/B).

### Cannot pair with `lead_gen_form_id`

The MCP enforces this — Dynamic Creative ad sets cannot route to a Meta Lead Form. Use static creative for lead-gen campaigns. (Meta has signaled this may change in 2026; treat the current limitation as authoritative until the MCP says otherwise.)

### Combination-level reporting only

When you run `adadvisor:get_performance(level='ad', entity_id=<DC ad>)`, you get aggregate performance on that ad — not a per-variant breakdown. Meta does surface per-variant data in the Ads Manager UI under "Asset Customization" or "Dynamic Creative reporting," but that view is not currently exposed through the MCP.

Operationally, this means: Dynamic Creative is for finding the *combination* that wins, not for isolating which specific hook or which specific headline is load-bearing. For the latter, run separate ads in a non-dynamic ad set.

## When to use Dynamic Creative vs static A/B

| Goal | Use Dynamic Creative | Use static A/B |
|---|---|---|
| Find which combination of text variants performs best | ✅ | |
| Isolate which exact hook is the winner | | ✅ |
| Lead-gen campaign | | ✅ |
| Compress 12 variants into one ad set | ✅ | |
| Compare 2-3 distinctly different creative concepts | | ✅ |
| Tight budget, can only afford 1-2 ads worth of spend | | ✅ |
| Test copy variations under a confirmed-winner image/video | ✅ | |
| Test image/video variations under confirmed-winner copy | ✅ (via asset_feed_spec) | |

The general guideline: Dynamic Creative is for *combinations* within a known angle. Static A/B is for *angles*. Run a 3-3-3 (Pilothouse) to find the angle, then run a 3-2-2 (Tichenor) via Dynamic Creative to optimize the winning angle.

## Worked example — apparel DTC

Brand: D2C activewear. Confirmed angle: "30-day comfort test."

```
Adset:
  name: "DC || 30-day comfort || US prospecting"
  is_dynamic_creative: true
  optimization_goal: OFFSITE_CONVERSIONS
  billing_event: IMPRESSIONS
  daily_budget: 200
  targeting: {
    countries: ['US'],
    custom_audiences: [<1% LAL of purchasers>],
    age_min: 25, age_max: 54
  }

Creative:
  name: "DC_30day_v1"
  format: 'image_link'
  page_id: <brand page>
  link: 'https://brand.com/30-day-test'
  image_hash: <hero studio image>
  messages: [
    "30 days of wearing this. Still comfortable.",
    "We tested these for 30 days straight. Here's why they stayed on.",
    "If you don't love them in 30 days, send them back."
  ]
  headlines: [
    "30-Day Comfort Guarantee",
    "Built for All-Day Wear"
  ]
  descriptions: [
    "Free returns. No questions asked.",
    "Try them risk-free for 30 days."
  ]

Ad: one only, named "DC_30day_ad"
```

Total combinations: 3 messages × 2 headlines × 2 descriptions = 12 combinations Meta will mix and serve.

After 5-7 days at $200/day, expect ~$1,400 spend / 40-60 conversions. The reporting shows the ad as a whole; check the Ads Manager UI for per-combination breakdown to identify winners. Promote the winning combination into a non-dynamic ad set if you want isolated-variant data.

## Common Dynamic Creative failures

- **Setting `is_dynamic_creative: true` then trying to add a second ad.** Schema rejects. Move to a second ad set.
- **Setting both `message` and `messages`.** Mutually exclusive — pick one.
- **Trying to pair with a Meta Lead Form.** `lead_gen_form_id` is incompatible. Use static creative.
- **Putting 5 nearly-identical messages.** Meta can't optimize variance it doesn't see. Make the variants meaningfully different.
- **Running Dynamic Creative on a $30/day ad set.** 12 combinations × $30/day = ~$2.50 per combination per day. Won't read.
- **Expecting per-variant reporting in MCP responses.** Not available via `get_performance` — check the Ads Manager UI directly for variant-level breakdown.

## Migrating from static to Dynamic Creative

When you have 12 manual ads testing variants and want to consolidate:

1. Identify the winning image/video (the asset that's carrying the variants).
2. Build a new Dynamic Creative ad set with the same audience and budget structure.
3. Create one creative with the winning asset + the variant arrays.
4. Run the static ad set and the Dynamic ad set in parallel for 5-7 days.
5. Compare CPA on the new Dynamic ad set vs the average of the static ads. Promote whichever wins; pause the loser.

## Anti-patterns

- "I'll add 3 ads with different creatives to the same DC ad set." → Only 1 ad allowed. Use 3 separate ad sets.
- "Reporting says my ad is winning. Which message is the winner?" → MCP doesn't break it down per-variant. Open Ads Manager UI or move to static testing.
- Treating Dynamic Creative as "set and forget." Variants still fatigue; refresh on the standard cadence.
- Using Dynamic Creative for cross-concept testing (e.g., problem-hook vs founder-POV in the same array). The concepts are too different — break them into separate ad sets.

## Cross-references

- [`testing-frameworks.md`](testing-frameworks.md) — 3-2-2 framework lives operationally inside Dynamic Creative.
- [`hook-library.md`](hook-library.md) — populating the `messages` array with distinct hooks.
- [`existing-post.md`](existing-post.md) — incompatible with Dynamic Creative; use `existing_post` ads in separate ad sets.
- [`format-rules.md`](format-rules.md) — aspect-ratio and length constraints still apply per asset.
