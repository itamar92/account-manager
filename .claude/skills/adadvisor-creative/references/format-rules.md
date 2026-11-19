## Format rules — aspect ratios, length, technical limits

Format rules are the easy way to lose performance silently. A 16:9 video crammed into Reels gets letterboxed and ignored. A 4MB image fails to upload. A 90-second ad on Stories cuts off mid-message. This reference is the technical floor every creative briefer should know.

## Aspect ratios — what to ship in 2026

| Ratio | Surface | Use it when |
|---|---|---|
| **4:5 (portrait, 1080×1350)** | Feed (FB + IG) | Default for any Feed-targeted ad |
| **9:16 (vertical, 1080×1920)** | Reels, Stories, IG Lives | Mandatory for any Reels/Stories targeting |
| **1:1 (square, 1080×1080)** | Feed fallback, IG, Marketplace | Safety net; works everywhere but isn't optimal for any single surface |
| **16:9 (horizontal, 1920×1080)** | Audience Network and some legacy placements | Dead in 2026 for most use cases |

The 2026 consensus (Foxwell, Motion, CTC): ship at least **4:5 + 9:16** for every concept. Reusing one as 1:1 is a fallback, not a strategy. Don't ship horizontal unless you specifically need Audience Network placement and accept the lower CPM ceiling.

### Why 16:9 is dead

Meta's auction prefers vertical placements (Reels, Stories) because that's where attention is. A horizontal video forced into a vertical placement gets letterboxed with black bars or cropped awkwardly — both are scroll-trigger events for viewers.

Some edge cases keep horizontal alive: Audience Network display ads, OEM partnerships, certain regional Marketplace surfaces. For 95% of accounts in 2026, horizontal is a waste of production budget.

## Video length

| Length | Where it lives | Notes |
|---|---|---|
| **5-15s** | Reels, Stories, Feed | Sweet spot. Meta auto-loops video ≤30s up to 90s of total view time |
| **15-30s** | Feed, longer-form Reels | Stronger storytelling; weaker scroll-stop |
| **30-60s** | Top-of-funnel education, founder POVs | Use sparingly; usually only works on warm or retargeting audiences |
| **60-90s** | Brand storytelling | Niche use; expect significant drop-off after 15s |

The 5-15s window dominates Reels and prospecting in 2026 for one reason: **Meta loops short videos**. A 9-second ad gets replayed roughly 10 times over a 90-second view window, accumulating impressions and reinforcement without the viewer ever feeling the length. Long-form ads don't get this multiplier.

### Hook in the first 1-3 seconds, regardless of length

Even on 60s videos: the first 1-3 seconds determine whether anyone watches the rest. Hook rate (3-sec views / impressions) is the first diagnostic check. See [`hook-library.md`](hook-library.md).

## Image specifications

| Constraint | Limit | Notes |
|---|---|---|
| File size | 30 MB max | Per the MCP's `upload_ad_image` |
| Allowed types | `image/jpeg`, `image/png` | No GIF, no WebP, no HEIC |
| Recommended dimensions | 1080×1350 (4:5), 1080×1920 (9:16), 1080×1080 (1:1) | Higher resolution doesn't help; lower compresses badly |
| Color profile | sRGB | Wide-gamut profiles render incorrectly in some placements |

The 30 MB ceiling is rarely the binding constraint at appropriate resolutions. A 1080×1350 JPEG at quality 85 is ~300 KB; 1080×1920 lands at ~450 KB. If you're hitting 30 MB you're shipping uncompressed PNG with no optimization. Target ≤2 MB for production assets.

## Video specifications

| Constraint | Limit | Notes |
|---|---|---|
| File size | 4 GB max | Per the MCP's `upload_ad_video` |
| Allowed types | `video/mp4`, `video/quicktime` (.mov) | No WebM, no AVI |
| Codec | H.264 video, AAC audio | Meta re-encodes anyway; H.264 is fastest to upload |
| Resolution | 1080p preferred | 4K source is fine but Meta downsizes to 1080p |
| Frame rate | 24-30 fps standard, 60 fps acceptable for action | Higher fps doesn't help; Meta caps display fps |
| Audio | Recommended, even if muted by default | 85%+ of Reels viewers play with sound on by 2026 |

Practical: most modern phones output MP4 H.264 by default. UGC creators on iPhone don't need to do anything special; just deliver the .mov/.mp4 unconverted. Target ≤50 MB for short-form video to keep upload-and-processing snappy.

## The "20% text" rule is gone (but heavy text still hurts)

Meta retired the explicit 20% text-overlay rule in 2020. Heavy text on images and videos no longer fails outright — but the algorithm still suppresses delivery on heavily-texted creatives because they perform worse on scroll-engagement metrics.

Operational guidance:

- **Static images:** keep on-image text to ≤30% of canvas area. One short headline + one short subhead. SMS-style mockups and short testimonial screenshots are exceptions — they read as content, not ads.
- **Videos:** captions and lower-thirds are fine and recommended. Full-screen text walls under 15 seconds usually underperform.
- **The "ugly ad" school (Barry Hott):** screenshot-style creative with text is fine because the format reads as native content, not as a designed ad.

## Captions burned in (open captions)

Many users watch Reels with sound off, especially the first time. Burn captions into the video itself (open captions) rather than relying on closed captions or Meta's auto-captioning. Pattern: pattern interrupt in the first 1 second + visible text in seconds 1-3 = strong hook rate even on muted play.

## Safe zones for Stories and Reels (vertical 9:16)

Vertical placements have UI elements that overlay the top and bottom of the frame. On a 1080×1920 canvas:

- **Top 14% (≈270 px):** username + audio strip + close button.
- **Bottom 20% (≈384 px):** caption + CTA + Like/Comment/Share bar.
- **Center 66% (270-1536 px from top):** the safe zone for the primary visual and any text.

When briefing creative, designate the center 66% as the message area. Decorative or non-critical elements can fall in the top/bottom safe zones; CTAs and key product visuals stay centered. Tools like Motion, Foreplay, and Figma have Reels/Stories templates with these overlays pre-marked.

## Multi-asset (carousel) format basics

Briefly:

- Carousel cards are independently 1:1 (or 4:5). Don't mix ratios across cards in one carousel.
- Each card has its own image/video + headline + link.
- Use carousels when the message has 2-5 sequential beats (problem → solution → proof → CTA) or when showing 3-5 product variants in one ad.
- The first card determines whether the viewer engages — treat it like the hook frame of a video.

## Multiple aspect ratios per creative

If you have time/budget to produce 9:16 + 4:5 + 1:1 of the same concept:

- Build the **9:16 master first**.
- Crop **4:5** from the center 80% (vertical) of the 9:16.
- Crop **1:1** from the center 56% (vertical) of the 9:16.

Or use Meta's "Advantage+ Creative" auto-crop — but verify the crops in Ads Manager preview before publishing; the auto-crop is good but not perfect, and occasionally lands a critical visual outside the safe zone.

## Practical upload through the MCP

```
adadvisor:upload_creatives(account_id=<id>)
  → opens widget; user drags/pastes URL
  → returns image_hash or video_id

adadvisor:create_creative(
  creatives=[{
    'name': '<descriptive>',
    'format': 'image_link' | 'video',
    'page_id': <page>,
    'link': <destination>,
    'image_hash': <hash>  # or video_id
    ...
  }]
)
```

The MCP validates file size and type before accepting the upload. If a file exceeds 30 MB image / 4 GB video or uses a disallowed type, the widget surfaces the error inline.

## Quick checklist before `create_creative`

- Asset is **9:16 OR 4:5** (or both). 1:1 only as fallback.
- Video ≤15s for short-form, or has a strong hook in seconds 0-3.
- Open captions burned in.
- Resolution ≥1080 on the long edge.
- On-image text ≤30% of canvas.
- Safe zones respected on 9:16 (no critical content in top 14% / bottom 20%).
- File size: image ≤2 MB, video ≤50 MB short-form.

## Anti-patterns

- 16:9 horizontal video on Reels placement. Letterboxed and ignored.
- 30-second monologue with no hook in the first 3 seconds. Hook rate <10%.
- Text overlay covering >60% of a static image with no other visual interest. Algorithmic suppression even though the explicit rule was retired.
- Uploading a 4K source video assuming "higher is better." Meta downsizes; the only effect is slower upload.
- Designing creative without testing in the actual placement preview. Safe-zone overlaps catch buyers off guard.
- Single 1:1 asset shipped as "the creative." Works in Feed; gets cropped on Reels.

## Cross-references

- [`hook-library.md`](hook-library.md) — hook patterns that respect the first-3-seconds budget.
- [`testing-frameworks.md`](testing-frameworks.md) — how aspect-ratio variations slot into 3-3-3 testing.
- [`dynamic-creative.md`](dynamic-creative.md) — `asset_feed_spec` for multi-asset Dynamic Creative.
- [`creative-fatigue.md`](creative-fatigue.md) — fatigue signals are placement-agnostic but format-sensitive.
