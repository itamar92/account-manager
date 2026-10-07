## Lookalikes — when, how, and why most are wasted

A lookalike audience is only as good as its seed. Most underperforming lookalikes are not algorithm failures — they're seed-quality failures. The discipline below puts seed selection first, ratio bands second, and operational mechanics last.

## Seed-selection hierarchy

The seed is the input vector that Meta learns from. A junk seed makes a junk LAL no matter how sophisticated the modeling.

| Rank | Seed | Why it works | Minimum useful size |
|---|---|---|---|
| 1 | LTV-tier customer list (top 25% by lifetime value) | Encodes both *who buys* and *who keeps buying* — the highest-signal cohort | 1,000+ ideal |
| 2 | Repeat purchasers (≥2 orders, last 365 days) | Filters out one-time impulse buyers; signal of retention | 1,000+ |
| 3 | All purchasers, last 180 days | Standard ecom seed; broadly trained on conversion intent | 500+ acceptable, 1,000+ ideal |
| 4 | High-engagement video viewers (≥75% completion, 180 days) | Mid-funnel signal; better than nothing when you have no purchase data | 1,000+ |
| 5 | All page views (last 30 days) | Weakest seed; resembles broad. Only use when you have no other option | n/a — prefer broad over this |

Meta's hard minimum is 100. In practice, anything under 1,000 produces an unstable LAL — the modeled audience drifts week to week as Meta re-fits to the small seed.

Senior buyer's rule (Foxwell, CTC): if your seed is <1,000, don't build the lookalike — wait until you have data. Run broad in the meantime.

## Ratio bands

The `ratio` parameter on `adadvisor:create_lookalike_audience` controls how similar the modeled audience is to the seed.

| Ratio | Reach (US, typical) | Use case |
|---|---|---|
| 1% | ~2.5M | Precision prospecting. Most-similar to seed. Default first LAL. |
| 2% | ~5M | Bridge between precision and scale |
| 3-5% | ~7.5M-12.5M | Scale layer; lower precision, more reach |
| 6-9% | ~15M-22M | High-scale; CPA inflates noticeably |
| 10% | ~25M | Essentially broad. Use broad instead — it's cheaper. |

The Lebesgue 2025 benchmark shows median CPA inflation of roughly 8-15% per ratio tier as you climb 1% → 3% → 5% → 10%. By the time you're at 10%, the LAL is statistically indistinguishable from broad — and broad gets you there without the seed dependency.

## Tiered LALs via `starting_ratio`

When you scale, you eventually want the "next ring out" without overlapping your existing 1% LAL ad set. This is what `starting_ratio` is for:

```
adadvisor:create_lookalike_audience(
  account_id,
  name='LAL 1-3% Purchasers (band)',
  origin_audience_id=<seed>,
  country='US',
  starting_ratio=0.01,   # band starts at 1%
  ratio=0.03,            # band ends at 3%
)
```

This creates an audience of people in the 1-3% similarity band — *excluding* the most-similar 1% you're already targeting. Practical use:

| Ad set | Audience | Why |
|---|---|---|
| LAL Precision | 0-1% LAL | Highest precision; small reach |
| LAL Mid | 1-3% LAL (band) | Next ring out; no overlap with Precision |
| LAL Scale | 3-5% LAL (band) | Further out; bigger reach, looser similarity |

Three non-overlapping ad sets, each at a different CPA target. This is the structure for stage 2 of the [`scale-1k-to-10k.md`](../../adadvisor-playbooks/references/scale-1k-to-10k.md) plan.

The alternative — three ad sets each at 1%, 3%, 5% *without* `starting_ratio` — produces ~70% audience overlap between them, which means Meta's auction self-bids and CPMs inflate. See [`audience-overlap.md`](audience-overlap.md) for the detection mechanics.

## Value-based lookalikes

Standard LALs treat every seed member equally. Value-based LALs weight members by the purchase value attached to their pixel events.

Salesforce's 2026 benchmark (cited by ATTN Agency and CTC) shows value-based LALs outperform standard LALs by 20-35% in CAC on accounts with consistent purchase-value tracking.

Requirements:
- Pixel and CAPI must send the `value` and `currency` parameters on Purchase events.
- Minimum 30-day history of valued events for the seed to populate.
- Seed must be a website custom audience (created via `adadvisor:create_website_audience` with `event_name='Purchase'`) — not a customer-list audience.

When the user mentions "value-based" or "VBLAL", confirm purchase-value tracking is live via `adadvisor:get_pixel_health` and verify `Purchase` event count is healthy before building the LAL.

## Country scoping

The `country` parameter on `adadvisor:create_lookalike_audience` is mandatory and single-valued. To run the same LAL strategy across multiple countries, build one LAL per country:

```
adadvisor:create_lookalike_audience(name='LAL 1% US', ratio=0.01, country='US', ...)
adadvisor:create_lookalike_audience(name='LAL 1% CA', ratio=0.01, country='CA', ...)
adadvisor:create_lookalike_audience(name='LAL 1% UK', ratio=0.01, country='GB', ...)
```

Each populates independently (1-6 hours). Don't try to build a multi-country LAL — Meta doesn't support it, and the MCP will reject the call.

Geo expansion is one of the cleanest horizontal-scale plays. See the workflow in [`adadvisor-targeting/SKILL.md`](../SKILL.md#expanding-to-a-new-geo-horizontal-scale).

## Populate time and delivery

| Phase | Timing | Behavior |
|---|---|---|
| Created | Immediate | `delivery_status` returns "Populating" — but audience is usable |
| Populating | 1-6 hours | Meta models the audience |
| Ready | After populate | `delivery_status="This audience is ready for use"` |

You can attach a populating LAL to an ad set and resume the ad set — Meta will begin delivering once the LAL is ready. Don't wait. The 1-6 hour window is operationally fine for almost all use cases.

## Seed-quality gates (run these before building)

Before calling `adadvisor:create_lookalike_audience`, validate the seed:

1. **Seed size ≥ 100** (Meta hard floor). Confirm via `adadvisor:list_custom_audiences(search='<seed name>')` — check `approximate_count_lower_bound` is ≥100. Ideal ≥1,000.
2. **Seed is the right cohort.** A "Purchase" custom audience with 5,000 members from the last 180 days is materially different from a "ViewContent" audience with 50,000 members. Choose the one with the highest signal density.
3. **Seed `delivery_status` = ready.** Don't seed a LAL from an audience that itself is still populating.
4. **Seed has consistent value events (for VBLAL).** Pixel + CAPI both firing Purchase with `value`. Verify via `adadvisor:get_pixel_health`.

## Common mistakes

- **Building a LAL on a "page view" or "all website visitors" seed.** This is functionally broad with extra steps. Use broad.
- **Building 5 ad sets each on a 1% LAL of slightly different seeds.** Overlap is severe; consolidate seeds and run one strong 1% LAL.
- **Updating the seed and expecting the LAL to refresh.** LALs do auto-refresh weekly, but only on the seed snapshot from build time. To get a "fresh" LAL on a meaningfully changed seed, rebuild.
- **Building a 1% LAL on a 200-person seed.** Meta will accept it. The output is statistical noise. Wait for the seed to grow.
- **Ignoring `starting_ratio` and running overlapping LALs at 1%, 3%, 5%.** Causes auction cannibalization — see [`audience-overlap.md`](audience-overlap.md).
- **Forgetting that LAL members are still subject to Advantage+ Audience expansion.** When `advantage_audience=true`, Meta treats your LAL as a *signal*, not a hard constraint. Members outside the LAL will see ads if Meta judges them likely to convert.

## MCP call sequence — full LAL workflow

```
1. (in app) Upload customer-list CSV → CUSTOM audience
2. adadvisor:list_custom_audiences(account_id, search='top customers')
   → confirm uploaded audience is READY, get audience_id
3. adadvisor:create_lookalike_audience(
     account_id,
     name='LAL 1% Top Customers',
     origin_audience_id=<uploaded>,
     country='US',
     ratio=0.01
   )
4. adadvisor:list_custom_audiences(search='LAL 1% Top Customers')
   → confirm exists; delivery_status will be "Populating"
5. adadvisor:create_adset(
     custom_audiences=[{id: <lal_id>, name: 'LAL 1% Top Customers'}],
     advantage_audience=true,
     ...
   )
6. (1-6 hour wait for full populate; ad set can resume immediately)
```

## References cited

- Meta's documented LAL ratio mechanics (Advantage Lookalike).
- Lebesgue 2025 benchmark on LAL CPA inflation across ratio tiers.
- Salesforce 2026 value-based audience report.
- Andrew Foxwell, CTC podcast (Taylor Holiday), Motion: seed-quality discipline.
