## Attribution windows — what Meta is reporting and why it disagrees with Shopify

Every conversion number Meta returns is filtered through an attribution window: how many days after a click (or view) the conversion counts. Default is `7d_click + 1d_view`. The window choice is the single biggest reason Meta's reported ROAS differs from Shopify, Triple Whale, Northbeam, and GA4. This reference encodes what the default means, how iOS 14.5+ modeling fills the gap, and the cross-check formula every diagnostic should run.

## The default window — `7d_click + 1d_view`

A conversion is attributed if either: the user clicked the ad and converted within 7 days (`7d_click`), OR viewed the ad (impression ≥ 1 second) and converted within 1 day (`1d_view`).

Meta optimizes to whichever window is set. The MCP doesn't expose per-call window selection — reads return whatever the account default is. To change, the user edits the account-level setting in Ads Manager. The view-through component is typically 20-40% of attributed revenue.

## What modeled conversions are

Post iOS 14.5, Meta loses deterministic click→conversion on ~75-80% of US iOS traffic. Meta fills the gap with statistical estimates based on aggregated events, CAPI signals, and behavioral models.

Modeled conversions: not "fake" but not deterministic; included by default in `result_count`, `roas`, `cost_per_result`; more accurate for established accounts with strong CAPI; heavier ROAS inflation than count inflation.

Diagnostic implication: accounts with weak CAPI show inflated Meta ROAS relative to Shopify. Check `adadvisor:get_pixel_health` for CAPI status before trusting revenue.

## The 2026 attribution overhaul

Meta rolled out two material changes in late 2025 / early 2026 that bite ROAS interpretation:

1. **View-through attribution is being phased into "engaged-view" (1-day).** A view-through credit now requires the user to have engaged with the ad (≥ 3-second video play, swipe-up, etc.) within 1 day before converting. Pure impression-and-bounce within 24h no longer counts. Result: many accounts saw a 5-15% drop in attributed conversions on the day this rolled.

2. **Click-attribution is the dominant signal for buyers in 2026.** Mitch Barham, LinkedIn 2026: most senior buyers now baseline against 7-day click only (`7d_click`) and treat view-through as supplementary. The argument is that view-through inflates Meta's credit and obscures incrementality.

If the user re-baselines target CPA before/after these changes, expect a 10-25% shift in apparent CPA without any underlying performance change.

## Meta vs Shopify — the canonical gap

Shopify is the ground-truth source for ecom orders. Meta's `revenue` will almost always differ. The healthy ratio:

| Ratio (Meta revenue / Shopify revenue) | Interpretation |
|---|---|
| > 1.0 | **Deduplication bug.** Pixel + CAPI are double-counting. Fix the dedup IDs. |
| 0.8 – 1.0 | Slight Meta over-attribution via view-through. Normal for accounts with conservative organic. |
| **0.4 – 0.8** | **Normal range.** Most healthy DTC accounts live here. |
| 0.3 – 0.4 | Meta is under-counting — possibly pixel issues, no CAPI, or heavy non-Meta channels. |
| < 0.3 | **Pixel or CAPI broken.** Investigate event firing. |

The 0.4-0.8 normal band reflects two truths simultaneously: (1) Meta over-attributes via view-through (people who saw your ad and would have bought anyway), and (2) Meta under-attributes via iOS ATT loss. They partially cancel, leaving Meta with 40-80% of Shopify's reported revenue.

## The cross-check formula

Every diagnostic should answer this question before any decision: **is the Meta-reported ROAS even believable?**

```
trust_ratio = meta_reported_revenue / shopify_revenue
```

If `trust_ratio` is outside the 0.4-1.0 band, stop diagnosing performance and start diagnosing tracking. A 5× Meta ROAS with `trust_ratio = 0.2` means the real ROAS is much higher (you're under-attributing) or the pixel is broken (you can't tell). A 4× Meta ROAS with `trust_ratio = 1.4` means you're double-counting and the real ROAS is lower.

## Meta vs Triple Whale / Northbeam — the multi-touch gap

Triple Whale, Northbeam, and other post-click attribution platforms run their own attribution models, typically with last-click or multi-touch weighting and stricter view-through rules. The pattern:

- Meta-reported ROAS is **30-50% higher than Triple Whale** on the same campaigns.
- Triple Whale uses last-click as a hard floor; Meta uses 7d-click + 1d-view as a credit ceiling.
- For decision-making at scale, blended MER (revenue / total marketing spend across all channels) is more honest than either ROAS.

Don't try to reconcile the two — they answer different questions. Meta tells you "how well is the auction working." Triple Whale tells you "what would have happened without paid social." Both are useful; neither is the truth.

## Meta vs GA4

GA4 typically **undercounts** Meta conversions by 30-50% relative to Meta-reported. Reasons:

- GA4 last-click attribution drops view-through entirely.
- iOS Safari ITP truncates UTM-based session tracking.
- Direct/none traffic from copy-paste, app deeplinks, and dark social hides paid origins.

Use GA4 as a floor, not a ceiling. If GA4 says you have 30 Meta-attributed purchases and Meta says you have 60, the truth is probably in the 35-50 range.

## When the gap is too small (< 0.3) — investigation order

1. `adadvisor:get_pixel_health` — confirm 25+ Purchase events trailing 14 days.
2. Check `data_synced` on `list_ad_accounts` — if false, data is stale.
3. Check `source_breakdown` — if all `browser` and 0 `server`, CAPI is missing (CAPI adds 15-30%).
4. Check Shopify pixel app — Meta pixel firing on order-confirmation, not just add-to-cart?
5. Verify no cookieless / consent-required mode suppressing EU/UK firing.

## When the gap is too large (> 1.0) — investigation order

1. Most common: pixel + CAPI duplicate without `event_id` dedup. Each Purchase counts twice.
2. Check Shopify CAPI integration — dedup key must match client + server.
3. Subscription renewals included in Meta's Purchase but excluded from Shopify revenue.
4. Promo codes — Meta attributes pre-discount cart while Shopify reports post-discount.

## Attribution and the diagnostic tree

Some "spend up, results down" patterns are pure attribution shifts, not performance regressions:

- **Pattern**: Meta-reported ROAS drops 20% in a single week with no obvious creative/audience change.
- **Cause candidates**: account-level attribution window changed; CAPI broke; Shopify pixel app updated; cookie consent mode flipped.
- **Diagnostic move**: pull `pixel_health` and compare pixel event counts week-over-week. If pixel events dropped, the regression is tracking, not delivery.

Quote Foxwell: "Half the 'performance issues' brought to me are attribution issues."

## Practical reporting language

When reporting ROAS to the user, always include the modifier:

> "Meta-reported ROAS is 4.2× (7d-click + 1d-view, includes modeled). Triple Whale shows 2.8×. Both are within normal range for this account."

Not:

> "ROAS is 4.2×."

The naked number invites overconfidence. The window and source make it actionable.

## See also

- [`./diagnostic-tree.md`](./diagnostic-tree.md) — attribution can masquerade as a CVR drop.
- [`./benchmarks.md`](./benchmarks.md) — benchmarks assume default window unless noted.
- The `adadvisor` foundation skill's `references/kpi-decoder.md` — modeled conversions and the canonical fields.
