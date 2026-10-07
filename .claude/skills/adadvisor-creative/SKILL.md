---
name: adadvisor-creative
description: |
  Meta ad creative strategy — testing frameworks (3-2-2, 5-3-1, Pilothouse 3-3-3), refresh cadence by spend tier, hook → body → CTA hierarchy, and the Dynamic Creative workflow, as advice and copy for the user to enter in Ads Manager. Use when: "test ads", "creative", "refresh creatives", "fatigue", "what to make next", "new creative", "test new hooks", "creative is tired", "ads are stale", "swap creative", "upload images", "build a creative", "dynamic creative", "asset feed", "find images", "find videos", "preview existing", "ugc". Chain with: adadvisor (always — data limits and show economics); adadvisor-launch when creative is being launched for the first time; adadvisor-diagnose when fatigue is suspected; adadvisor-scale when scaling reveals creative limits. NOT for: image / video generation (use an image-generation skill or external tool, then upload via this skill); copywriting from scratch with no brand context (read the context resource first); managing creatives across non-Meta platforms.
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
> **For this skill:** there is no creative-level performance data and the ad copy is not exposed through MCP, so you cannot rank ads or detect fatigue from data. The frameworks, hook library, format rules and refresh cadence are strategy and still apply — use them to advise and to write new copy in the band's voice. Ask the user to paste existing copy, the creative's Ads Manager results, and the audience. The in-app advisor's stored report (`band_campaign_advice`) may already hold copy suggestions: read it first.

# AdAdvisor — Creative Strategy

> Creative drives 70-89% of Meta ad performance. (AppsFlyer 2025; Nielsen.) Targeting won. Bidding won. Creative is what's left to compete on.

This skill encodes how a senior buyer thinks about creative testing: what frameworks to use, how often to refresh, how to read creative-level performance, and how to operate the MCP's creative tools without losing social proof.

## When to use

- The user is testing new ads (3-2-2 / 5-3-1 frameworks).
- Creatives are fatiguing — CPM up, CTR down, frequency creeping.
- The user is asking "what should I make next."
- The user needs to upload, find, or pair images/videos to ads.
- The user is setting up Dynamic Creative for multi-variant copy testing.

## Pre-creative: foundation

`adadvisor` loaded → you have `business.business_name`, `business.tagline`, `business.key_selling_points`, `business.brand_tone`, `business.brand_colors`, `business.target_audience_summary`. Use these to ground every creative recommendation. Don't write copy that contradicts the brand tone or skips the key selling points.

## Testing frameworks — pick one

| Framework | Structure | Best for |
|---|---|---|
| **3-2-2 (Tichenor)** | 3 creatives × 2 primary texts × 2 headlines = 12 dynamic variants in one ad set | Validation of an established angle; small but rigorous tests |
| **5-3-1 (Ben & Vic / Motion)** | 5 hook variations × 3 body variations × 1 CTA = 15 ads | After identifying a winning concept — milking the angle |
| **3-3-3 (Pilothouse)** | 3 concepts × 3 formats × 3 hooks = 27 combinations | Initial mapping of a new product / offer / audience |
| **Hook → Body → CTA hierarchy** | Test hooks first (5-8 hooks, identical body+CTA); winner → iterate body; winner → iterate CTA | Methodical buyer with budget; finds the load-bearing element |

Default for a new offer with no winners yet: **3-3-3**. Default after identifying an angle: **5-3-1** or **3-2-2**.

Tichenor caveat (Sep 2025): "I was wrong about 3:2:2 — Meta's Andromeda update changed it. Top advertisers are ramping up creative production, testing multiple concepts and variations of those concepts per segment." Treat 3-2-2 as a floor, not a ceiling.

## Refresh cadence — scales with daily spend

| Daily spend | Refresh cadence | New concepts per cycle |
|---|---|---|
| $100-200/day | Every 2-3 weeks | 1-2 |
| $200-1,000/day | Every 7-14 days | 2-3 |
| $1,000-10,000/day | Every 7-10 days | 4-6 |
| $10,000+/day | Weekly | 4-6 net-new concepts |

(Foxwell / Motion 2026 consensus.) Volume of new concepts matters more than total ad count. Brands that produce 4 net-new concepts/week beat brands with 50 stale ads.

## Reading creative performance — hook rate vs hold rate

The funnel from `adadvisor-diagnose`:

| Metric | Healthy | Strong | Weak | What it means |
|---|---|---|---|---|
| Hook Rate (3-sec / impressions) | 25-35% | 30-45% | <20% | Did people stop scrolling? |
| Hold Rate (15-sec / 3-sec) | 40-50% | 60%+ | <30% | Did they stay through the body? |
| CTR (link clicks / impressions) | 1.0-1.8% | ≥2.0% | <0.8% | Did the body + CTA convince them to click? |

Diagnostic mapping:
- **Hook problem** → fix the first 1-3 seconds. Replace the hook, keep the body.
- **Hold problem** → fix the transition from hook to body. The hook overpromised or the body was boring.
- **Click problem** → fix the CTA, value prop, or visual confidence.

## MCP creative workflow

Two paths to a creative, depending on whether the asset already exists:

### Path A — Reuse / find existing

```
1. adadvisor:search_ad_images(queries=['<keyword>', '<keyword>'])
   → returns image hashes + thumbnails via the asset-picker widget
2. (optional) adadvisor:preview_existing_creatives(image_hash=<picked>)
   → if this image has been used before with engagement, surface that creative —
     reuse via existing_post format to preserve social proof (likes, comments, shares)
3. adadvisor:create_creative(creatives=[{ format: 'image_link', image_hash, link, ... }])
```

`search_ad_images` queries match: 32-char hex string → hash lookup; anything else → `ILIKE %query%` on image name. Multi-select returns up to 10 hashes in one round trip. **`unmatched_queries` lists every input term that returned zero results — do NOT silently substitute an unrelated image.**

### Path B — Upload new asset

```
1. adadvisor:upload_creatives(account_id) → opens upload widget
   (widget drives init_upload + S3 PUT + complete_upload internally)
2. complete_upload returns image_hash or video_id for each uploaded asset
3. adadvisor:create_creative(...)
```

Image limit: 30MB. Video limit: 4GB. Allowed: `image/jpeg`, `image/png`, `video/mp4`, `video/quicktime`.

### Critical — image hash provenance

Every `image_hash` must come from `search_ad_images` or `complete_upload` **in the current conversation**. Do not reuse hashes from prior conversations or from training context. Image hashes are account-scoped — using a hash from another account silently fails or produces wrong creative.

## Dynamic Creative — multi-variant copy

For testing copy variations efficiently:

1. Create ad set with `is_dynamic_creative: true`.
2. Create ONE creative with array fields: `messages: [...]`, `headlines: [...]`, `descriptions: [...]` — max 5 each. Mutually exclusive with the singular `message` / `headline` / `description` fields.
3. Create ONE ad with that creative (Dynamic Creative ad sets accept only ONE ad).
4. Meta auto-combines variants and optimizes the combination per viewer.

Limitations:
- Cannot pair with `lead_gen_form_id` (yet).
- Cannot have multiple ads in the same ad set.
- Reporting is at combination level, not per-variant.

## Existing-post format (preserving social proof)

When an Instagram or Facebook post already has organic engagement (likes, comments, shares), reuse it directly via `format: 'existing_post'`. The MCP's `create_creative` accepts:

- `object_story_id`: `<PAGE_ID>_<POST_ID>` (the Meta canonical form)
- `facebook_post_url`: e.g. `https://www.facebook.com/123/posts/456`
- `instagram_post_url`: e.g. `https://www.instagram.com/p/ABC123/`

URLs are auto-resolved. The MCP first checks the DB for known posts before hitting Meta's API.

**Use existing_post whenever the post has engagement >100 reactions.** Social proof compounds — a paid promotion of an organically successful post outperforms a fresh ad with the same creative.

## Format / production guidance (2026)

- **UGC dominates Meta prospecting.** Polished studio for retargeting and brand. Barry Hott's "ugly ads" school: native, relatable, authentic > polished — $1B+ in spend behind the thesis.
- **Video length**: 5-15 seconds. Meta auto-loops video ≤30s up to 90s total — short ads get replayed more.
- **Aspect ratios**: 4:5 (portrait) and 9:16 (vertical) are mandatory. 1:1 is the safety net. Horizontal is dead in 2026.
- **Static still works**: simple, high-contrast, large text, "ugly" testimonial screenshots and SMS-style mockups continue to win.

## Workflow

1. Identify the goal: net-new test, refresh, or scaling. Each implies a different framework.
2. Read the context resource for brand tone / colors / key selling points.
3. Pick the testing framework (3-3-3 default for new; 5-3-1 for established angle).
4. Source assets — search existing first, then upload if needed.
5. Decide on Dynamic Creative vs static creative. Default to static unless explicitly multi-variant.
6. For each creative concept, write: hook (3 variations) + body + CTA. Pull copy ideas from `business.key_selling_points` and `business.target_audience_summary`.
7. Create creatives in a single batched `create_creative` call. The MCP returns `creative_ids: list[str]` — feed straight into `create_ad`.
8. Build ads with the new creatives via batched `create_ad`, all PAUSED.
9. Confirm with user before activation.
10. Set a re-check cadence (7-14 days for $1K-day accounts).

## Anti-patterns

- ❌ Generating creatives from scratch without reading the context. ✅ Pull brand tone, colors, key selling points first.
- ❌ Reusing image hashes from a previous session. ✅ Always fetch fresh via `search_ad_images` or `complete_upload`.
- ❌ Pasting the assembled prompt back to the user (when using an image-gen tool). ✅ Show the user the final image, not your prompt.
- ❌ Building one fresh ad to "test." ✅ Test in batches per framework (3-3-3 / 5-3-1) for statistical sanity.
- ❌ Setting `is_dynamic_creative: true` then attaching 3 ads. ✅ Dynamic ad sets accept ONE ad with multi-variant arrays.
- ❌ Killing a creative after 24h. ✅ Use `adadvisor-diagnose` — kill threshold is 3× target CPA / zero conversions.
- ❌ Promoting an organic post by uploading the same image as a new ad (losing social proof). ✅ Use `existing_post` with the post URL.
- ❌ Reporting "this creative has the highest ROAS" on 1-day data. ✅ 3+ days, ideally with enough volume to be significant (≥50 conversions per variant).
- ❌ Building 16:9 horizontal videos for Reels placement. ✅ 9:16 for Reels/Stories, 4:5 for Feed.

## References

- [`references/testing-frameworks.md`](references/testing-frameworks.md) — 3-2-2 / 5-3-1 / 3-3-3 detailed structure with example creative briefs.
- [`references/hook-library.md`](references/hook-library.md) — proven hook patterns: problem, before/after, claim-and-evidence, social proof, founder POV, demonstration.
- [`references/refresh-cadence.md`](references/refresh-cadence.md) — by spend tier with operational templates.
- [`references/dynamic-creative.md`](references/dynamic-creative.md) — when to use, limitations, copy-variant matrix.
- [`references/existing-post.md`](references/existing-post.md) — preserving social proof; URL formats; eligibility checks.
- [`references/format-rules.md`](references/format-rules.md) — aspect ratios, video length, placement requirements.
- [`references/creative-fatigue.md`](references/creative-fatigue.md) — detecting fatigue early; the CTR-decay curve.
