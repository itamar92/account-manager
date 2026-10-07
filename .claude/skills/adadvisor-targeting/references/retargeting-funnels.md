## Layered retargeting — the funnel that scales

Retargeting is tactical, not scalable. It exists to convert traffic prospecting already paid for. The discipline is in the *layering* — each warm audience addresses a different stage of intent, with different exclusions, creative angles, and budget weights.

The MCP surfaces these via `adadvisor:create_website_audience` (for pixel-event audiences), `adadvisor:list_custom_audiences` (for existing audiences and uploaded customer lists), and the `custom_audiences` / `excluded_custom_audiences` arguments to `adadvisor:create_adset` and `adadvisor:update_adset_targeting`.

## The four layers

| Layer | Audience | Retention | Intent signal | Typical budget share |
|---|---|---|---|---|
| Warm-1 | All website visitors | 30 days | Brand-aware; low intent | 10-15% of retargeting |
| Warm-2 | ViewContent / AddToCart / InitiateCheckout | 30/60/90 days (escalating) | Product-aware; mid-to-high intent | 40-50% of retargeting |
| Warm-3 | Email subscribers / customer list (non-purchasers) | n/a | Off-Meta-sourced intent; highest qualification | 15-25% of retargeting |
| Engagement | Page / IG profile engagers | 180 days | Brand-affinity but no product action | 5-10% of retargeting |
| Video viewers | ≥25% / ≥50% / ≥75% completion | 180 days | Content-engagement; can be funnel mid-stage | 5-10% of retargeting |

Total retargeting is usually 15-30% of total ad spend. The remaining 70-85% is prospecting (broad + LAL). Inverting this split — where retargeting dominates — almost always signals an unhealthy account that's burning through warm audiences faster than prospecting refills them.

## Layer-by-layer playbook

### Warm-1: all website visitors, 30 days

The first retargeting layer. Built from the pixel's `PageView` event (or implicit on visit if pixel is healthy).

```
adadvisor:create_website_audience(
  account_id,
  name='Site Visitors 30D',
  retention_days=30,
  # event_name omitted → ALL website traffic
  pixel_id=<from list_ad_accounts.pixels>,
  prefill=True
)
```

| Element | Setting |
|---|---|
| Creative angle | Brand reminder; non-urgent; reinforce value prop |
| Exclusions | Purchasers 90D; cart abandoners (so they get Warm-2 messaging instead) |
| Budget | Small — 5-10% of retargeting spend |
| Frequency cap | If reach <50K, watch frequency; rotate creative every 7-10 days |

### Warm-2: product-aware retargeting (ViewContent / AddToCart / InitiateCheckout)

The workhorse of retargeting. Three sub-tiers, escalating intent.

```
# Sub-tier A: ViewContent 60 days
adadvisor:create_website_audience(
  name='ViewContent 60D', retention_days=60, event_name='ViewContent', ...
)

# Sub-tier B: AddToCart 30 days
adadvisor:create_website_audience(
  name='AddToCart 30D', retention_days=30, event_name='AddToCart', ...
)

# Sub-tier C: InitiateCheckout 30 days
adadvisor:create_website_audience(
  name='InitiateCheckout 30D', retention_days=30, event_name='InitiateCheckout', ...
)
```

Run as separate ad sets when audience sizes support it (≥1,000 each). Otherwise consolidate.

| Sub-tier | Creative angle | Exclusions |
|---|---|---|
| ViewContent 60D | Product features; social proof; address top-of-mind objections | Purchasers 90D, AddToCart 30D, InitiateCheckout 30D |
| AddToCart 30D | Urgency; cart-recovery; specific product imagery; discount if margin allows | Purchasers 90D, InitiateCheckout 30D |
| InitiateCheckout 30D | Friction-reduction; payment options; shipping promise; tightest discount | Purchasers 90D |

The exclusion chain is mandatory — each tighter audience excludes the looser audiences below it, so a single user sees ONE retargeting message at a time, not three competing ones.

### Warm-3: email subscribers / customer list

Uploaded customer-list audiences (built in-app, not via MCP). Surface them with `adadvisor:list_custom_audiences(search='email')` or `subtype='CUSTOM'`.

Highest-qualification retargeting layer because the user has voluntarily given email — they want to hear from you.

| Element | Setting |
|---|---|
| Creative angle | Product education for non-buyers; exclusive offers for buyers (post-purchase upsell separate) |
| Exclusions | Purchasers 90D (assuming this list contains pre-purchase subscribers) |
| Budget | 15-25% of retargeting; can be large if list is big |
| Match rate caveat | Email-to-Meta-user match rate is typically 50-70%. Audience size shown is post-match. |

### Engagement: page / IG profile engagers, 180 days

Built in-app from Meta's own engagement signals (page likes, post engagement, IG profile visits). Surface via `adadvisor:list_custom_audiences(subtype='ENGAGEMENT' or 'IG_BUSINESS')`.

| Element | Setting |
|---|---|
| Creative angle | Brand-story; UGC testimonials; reinforce why-now |
| Exclusions | Purchasers 90D, all Warm-2 |
| Budget | 5-10% of retargeting |
| Caveat | High brand-affinity but variable purchase intent — don't expect Warm-2 CPAs |

### Video viewers: 25% / 50% / 75% completion, 180 days

Built in-app from video-engagement signals. Useful when you've run TOF video views campaigns (BFCM warm-up, product launch pre-seed) and want to retarget the warmest viewers.

| Tier | Use |
|---|---|
| 25% completion | Brand-aware; same treatment as Warm-1 |
| 50% completion | Product-aware; same treatment as Warm-2 ViewContent |
| 75%+ completion | High intent; treat as AddToCart-equivalent for retargeting |

## Exclusion logic (every layer)

| Audience | Excludes |
|---|---|
| Warm-1 (Site Visitors 30D) | Purchasers 90D, AddToCart 30D |
| Warm-2 (ViewContent 60D) | Purchasers 90D, AddToCart 30D, InitiateCheckout 30D |
| Warm-2 (AddToCart 30D) | Purchasers 90D, InitiateCheckout 30D |
| Warm-2 (InitiateCheckout 30D) | Purchasers 90D |
| Warm-3 (Email subscribers) | Purchasers 90D |
| Engagement | Purchasers 90D, all Warm-2 |
| Video viewers ≥50% | Purchasers 90D, AddToCart 30D, InitiateCheckout 30D |

The pattern: tighter audiences exclude looser ones. Purchasers 90D appears in every exclusion list — post-purchase users get post-purchase messaging, not retargeting.

## Creative angles per layer

Each layer addresses a distinct objection, and creative should reflect that.

| Layer | Objection being addressed | Concept angle |
|---|---|---|
| Warm-1 | "What was that brand again?" | Brand reminder, founder story |
| ViewContent | "Looks interesting but..." | Product features, social proof |
| AddToCart | "I almost bought but..." | Urgency, scarcity, free shipping |
| InitiateCheckout | "Why didn't I finish?" | Payment friction, shipping promise, security |
| Email subscribers | "I signed up but never bought" | Exclusive offer, education on value prop |
| Engagement | "I follow but haven't bought" | UGC testimonial, comparison vs competitor |
| Video viewers 50%+ | "I watched but didn't click" | Direct product offer, urgency |

## Budget weighting

A standard split for retargeting (within the 15-30% total spend):

| Layer | Share of retargeting spend |
|---|---|
| Warm-2 (combined: VC + AddToCart + InitiateCheckout) | 50-60% |
| Warm-3 (email/customer list) | 15-25% |
| Warm-1 (all visitors) | 10-15% |
| Engagement | 5-10% |
| Video viewers | 5-10% |

If a layer is undersized for stable delivery (<1,000 reach), consolidate into the tier above.

## MCP call sequence — building a full retargeting funnel

```
# Step 1: Build all the website audiences
adadvisor:create_website_audience(name='Purchasers 90D', retention_days=90, event_name='Purchase', ...)
adadvisor:create_website_audience(name='InitiateCheckout 30D', retention_days=30, event_name='InitiateCheckout', ...)
adadvisor:create_website_audience(name='AddToCart 30D', retention_days=30, event_name='AddToCart', ...)
adadvisor:create_website_audience(name='ViewContent 60D', retention_days=60, event_name='ViewContent', ...)
adadvisor:create_website_audience(name='Site Visitors 30D', retention_days=30, ...)

# Step 2: Verify they're populated
adadvisor:list_custom_audiences(account_id, search='Purchasers')
adadvisor:list_custom_audiences(account_id, search='Cart')
# ... confirm delivery_status="This audience is ready for use" on each

# Step 3: Create campaign (CBO or ABO) for retargeting
adadvisor:create_campaign(objective='OUTCOME_SALES', name='Retargeting CBO', ...)

# Step 4: Create the ad sets, each with the correct exclusion chain
adadvisor:create_adset(
  name='RET || InitiateCheckout 30D',
  custom_audiences=[{id: <ic_id>, name: 'InitiateCheckout 30D'}],
  excluded_custom_audiences=[{id: <purchasers_id>, name: 'Purchasers 90D'}],
  ...
)
adadvisor:create_adset(
  name='RET || AddToCart 30D',
  custom_audiences=[{id: <atc_id>, name: 'AddToCart 30D'}],
  excluded_custom_audiences=[
    {id: <purchasers_id>, name: 'Purchasers 90D'},
    {id: <ic_id>, name: 'InitiateCheckout 30D'}
  ],
  ...
)
# ... etc for each layer
```

## Anti-patterns

- Building a "retargeting" audience with 300 people and expecting stable delivery. Below 1,000 reach, Meta won't deliver consistently — see [`audience-size-sweetspots.md`](audience-size-sweetspots.md).
- Running every retargeting layer with the same creative. Defeats the whole point — each layer has a distinct objection.
- Forgetting to exclude purchasers. Post-purchase users see "complete your purchase" ads, you waste spend, they hate the brand.
- Treating retargeting like prospecting. Retargeting is small reach + high frequency + high CPA. Trying to scale it past warm-audience size produces frequency >5 and ad fatigue inside a week.
- Running retargeting at 60% of spend because "it has the best ROAS". That ROAS is mostly cannibalizing organic / direct. See Peter Quadrel's incrementality framing in [`/economics.md`](../../adadvisor/references/economics.md).

## References cited

- Andrew Foxwell, account-audit threads on retargeting layering (2024-2025).
- Common Thread Collective podcast — Taylor Holiday on retargeting share-of-spend.
- Enhencer 2026 audience-stability benchmarks (the ≥1,000 floor for retargeting).
- Triple Whale retargeting attribution analyses (2025).
