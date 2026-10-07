## Existing-post creative — preserving social proof

When an Instagram or Facebook post has accumulated organic engagement — likes, comments, shares, saves — that social proof compounds the post's paid performance. Promoting the existing post (rather than uploading the same image as a fresh ad) preserves the engagement count and the lift it creates. This reference covers the three input formats, when to use them, and the MCP's auto-resolution behavior.

## The three input formats

The MCP's `adadvisor:create_creative(format='existing_post')` accepts any of:

| Input | Shape | Example |
|---|---|---|
| `object_story_id` | `<PAGE_ID>_<POST_ID>` — Meta's canonical form | `'123456789_987654321'` |
| `facebook_post_url` | The public Facebook URL of the post | `'https://www.facebook.com/yourbrand/posts/987654321'` |
| `instagram_post_url` | The public Instagram URL of the post | `'https://www.instagram.com/p/ABC123xyz/'` |

You provide exactly one of the three. The MCP normalizes URLs into `object_story_id` server-side before calling Meta.

### Sequence

```
adadvisor:create_creative(
  creatives=[{
    'name': 'IG viral post promotion',
    'format': 'existing_post',
    'page_id': <page_id>,
    'instagram_post_url': 'https://www.instagram.com/p/ABC123xyz/'
  }]
)
  → creative_id, ready to attach via create_ad
```

## URL auto-resolution

The MCP's resolution order:

1. **Check the DB.** If the post has been promoted by this account before, the `object_story_id` is cached. Resolved in ~10ms.
2. **Call Meta's Graph API.** If not cached, the MCP calls `GET /{page_id}/posts?filter=URL` (Facebook) or the equivalent IG Business API for Instagram URLs. Resolved in 200-800ms.
3. **Return error.** If the URL is malformed, the post is private/deleted, or the page doesn't own the post, the call returns a 400 with a specific reason.

For Instagram, the MCP extracts the shortcode via regex (`instagram\.com/(?:[^/]+/)?(?:p|reel|tv)/([A-Za-z0-9_-]+)`); Reels and IGTV URLs both work as input. Don't iterate URL resolution — pass the URL once, get the creative, attach to ads.

## When to use existing_post

The default rule: **any post with >100 organic engagements should be promoted via existing_post, not re-uploaded as a fresh creative.**

| Condition | Use existing_post? |
|---|---|
| Organic IG/FB post with >100 reactions, dozens of comments | Yes — preserve the social proof |
| The same image you also have in your image library | Yes if it was posted organically and got engagement — fresh upload loses the engagement count |
| A post that organically went viral (>1K reactions) | Strongly yes — the social proof is rocket fuel |
| A creator's UGC posted on their own IG | Only with IG Branded Content authorization; otherwise no |
| A post older than 12 months | Mixed — social proof still helps but recency signal is dated |
| A post you haven't published yet | No — use static creative (`image_link` or `video`) instead |

## Eligibility check

The MCP runs `check_post_promotion_eligibility` (Facebook) or `check_ig_post_eligibility` (Instagram) under the hood before creating the creative. A failed eligibility check returns a structured error explaining the specific blocker.

Common ineligibility causes:

- Post visibility restricted to friends / private / specific audiences.
- Instagram post from a personal (non-business) account — switch IG account to Business/Creator first.
- Instagram media not connected to the Facebook Page being advertised.
- Page doesn't own the post (cross-posted, branded-content without authorization).
- Post older than 7 years on Facebook.
- Post violates an active ad policy.

If you want to pre-validate before the create call, `adadvisor:preview_existing_creatives(image_hash=<asset_hash>)` (or `video_id=...`) will surface any existing creatives that share an asset along with their engagement counts — useful for deciding whether to promote an existing creative or upload fresh.

## Cannot pair with `lead_gen_form_id`

Like Dynamic Creative, existing-post ads cannot route to a Meta Lead Form. The format hard-codes the destination to the original post — you can't bolt a lead form on. If the campaign objective is `OUTCOME_LEADS` and you need on-platform Lead Forms, use static creative (`format: 'image_link'` or `'video'`) with `lead_gen_form_id`.

For lead-gen campaigns that don't use Meta's on-platform form (i.e., they send traffic to an external landing page with its own form), existing-post is fine.

## Other constraints

- **Multi-variant copy (`asset_feed_spec`) not supported.** Existing posts have one body/headline/description by definition.
- **Copy edits happen on the source post.** If you want to tweak the caption of an existing-post ad, edit the source post itself — the ad inherits. The MCP does not allow editing the creative's text fields on an existing-post creative.
- **No separate CTA button.** The post's existing CTA (in caption or as IG/FB native CTA) is what runs. You can't add a "Shop Now" button to an existing post.

## Why social proof compounds

Meta's algorithm and the viewer's perception both reward engaged-with content:

- **Algorithmic boost.** Posts with high engagement signal "quality" to Meta's relevance score, which translates into lower CPMs on the paid promotion.
- **Trust signal.** Viewers see "1,200 likes, 234 comments" and update their judgment of the brand. A fresh ad with zero engagement reads as an ad; a viral post reads as content others have validated.
- **Comments as social proof inline.** A high-engagement post often has a top comment that itself sells — a customer testimonial, a question answered by the brand, a viral joke. Promoting the post brings all of that along.

A paid promotion of a post with 2,000 reactions consistently outperforms a fresh ad of the same image by 20-50% on cold prospecting CTR, per CTC and Foxwell case studies.

## Worked example — promoting a viral UGC post

```
1. Confirm engagement via preview.
   adadvisor:preview_existing_creatives(
     account_id='881523100949350',
     video_id='<video_id_from_search_ad_videos>'
   )
   → engagement: {reactions: 432, comments: 87, shares: 24}

2. Promote.
   adadvisor:create_creative(
     account_id='881523100949350',
     creatives=[{
       'name': 'UGC viral promo',
       'format': 'existing_post',
       'page_id': '<page_id>',
       'instagram_post_url': 'https://www.instagram.com/p/ABC123xyz/'
       # No message/headline/description — inherited from the post.
       # No call_to_action_type — inherited.
       # No link — inherited.
     }]
   )

3. Attach to ad sets via adadvisor:create_ad.
4. adadvisor:change_entity_status to resume.
```

## Sourcing UGC for existing-post promotion

Creators who film UGC and post to their own IG can be promoted via Branded Content:

1. The creator tags your brand using Instagram's Branded Content tag on their post.
2. Your account requests "Branded Content Ads" permission from the creator (one-time per creator).
3. Once granted, the creator's post becomes promotable from your ad account.
4. Use `instagram_post_url` with the creator's post URL in `create_creative`.

The social proof on the creator's post (their own audience's engagement) transfers when promoted from your account — often outperforming your owned content because the creator's audience profile is closer to your prospecting cold pool.

## Common errors

- **"Cannot find page_id" / "object_story_id invalid"** — the page_id portion doesn't match the ad account's page. Use `adadvisor:list_pages` to find the right page; pass the URL instead.
- **"Post not eligible for promotion"** — privacy / age / IG-business issue from the eligibility check.
- **"Cannot pair lead_gen_form_id with existing_post"** — exactly that. Switch to `image_link` or `video`.

## Anti-patterns

- Re-uploading the post as a fresh image to "test it" — loses the engagement count and the algorithmic boost.
- Treating the URL as a one-time resolution to cache locally — the MCP handles it per call.
- Using existing-post for a post you control without engagement (e.g., just posted yesterday, 3 likes). With no prior engagement, upload as a clean static creative instead.
- Trying to pair existing-post with `lead_gen_form_id`. Won't validate.
- Promoting a competitor's post you don't have authorization for. Fails eligibility, may flag your account.

## Cross-references

- [`refresh-cadence.md`](refresh-cadence.md) — existing-post anchors with strong social proof earn extended runs.
- [`hook-library.md`](hook-library.md) — strong hooks drive the organic engagement that makes a post worth promoting.
- [`dynamic-creative.md`](dynamic-creative.md) — incompatible; if both apply, use existing-post in separate ad sets.
- [`format-rules.md`](format-rules.md) — aspect-ratio rules still apply (a square IG post may not fit Reels placement).
