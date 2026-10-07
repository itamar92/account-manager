# KPI decoder — which Meta number to trust

The MCP's `get_performance` and `get_timeseries` responses include both **legacy fields** and **canonical Results fields**. Legacy fields are correct for some optimization goals and wrong for others. This reference tells you which to use, when.

## The fields

Every row from `get_performance(level='campaign'|'adset'|'ad')` and every day from `get_timeseries(entity_type=...)` contains:

| Field | Source | Meaning |
|---|---|---|
| `result_count` | Meta canonical | The "Results" column volume — count of the entity's primary optimization event |
| `result_value` | Meta canonical | Total value attributed to those results (when applicable, e.g. revenue for Purchase) |
| `cost_per_result` | Meta canonical | Spend / `result_count` |
| `result_action_type` | Meta canonical | The raw event string (e.g. `offsite_conversion.fb_pixel_purchase`, `subscribe_website`, `lead`) |
| `conversion_result_name` | MCP-humanized | Display string ("Purchase", "Subscribe", "Lead") |
| `purchases` | Legacy | Count of Purchase pixel events — 0 if optimization isn't Purchase |
| `leads` | Legacy | Count of Lead pixel events — 0 if optimization isn't Lead |
| `revenue` | Legacy | Sum of Purchase event values — 0 if no Purchase events |
| `cpa` | Legacy | Spend / `purchases` — wrong if optimization isn't Purchase |
| `cpl` | Legacy | Spend / `leads` — wrong if optimization isn't Lead |
| `roas` | Legacy | `revenue` / spend — wrong if not Purchase-optimized |

`has_multiple_conversions: true` means the entity (often a multi-ad-set campaign or a campaign with mixed objectives) spans multiple KPIs. In that case, `result_count` aggregates across types and **misleads**. Inspect `kpi_breakdown` (array of per-KPI buckets sorted by volume DESC, returned in `response_format='full'`) instead.

## Mapping — optimization goal → which field to trust

| Optimization goal | `conversion_result_name` | Use this | Don't use this |
|---|---|---|---|
| OFFSITE_CONVERSIONS (Purchase) | "Purchase" | `result_count` / `revenue` / `roas` | — |
| OFFSITE_CONVERSIONS (Subscribe) | "Subscribe" | `result_count` / `cost_per_result` | `revenue` / `roas` (will be 0) |
| OFFSITE_CONVERSIONS (Lead) | "Lead" | `result_count` / `cost_per_result` | `revenue` / `roas` (will be 0) |
| OFFSITE_CONVERSIONS (ViewContent / AddToCart / InitiateCheckout / CompleteRegistration / StartTrial / Schedule) | varies | `result_count` / `cost_per_result` | `purchases` / `revenue` (will be 0) |
| LEAD_GENERATION (Meta on-platform forms) | "Lead" | `result_count` / `cost_per_result` | `leads` field (may diverge due to attribution differences) |
| LANDING_PAGE_VIEWS | "Landing page view" | `result_count` (volume) — use against spend, not target_CPA | revenue/ROAS (n/a) |
| LINK_CLICKS | "Link click" | `clicks`, `ctr` | revenue/ROAS (n/a) |
| IMPRESSIONS / REACH | "Impressions" / "Reach" | `impressions` | everything monetary |
| THRUPLAY (video) | "ThruPlay" | `result_count` | revenue/ROAS (n/a) |
| VALUE (LOWEST_COST_WITH_MIN_ROAS) | "Purchase" / "Subscribe" | `result_value` / `roas` | — |

## Worked examples

### Example 1 — Subscription ($19.99/mo product)

Performance row:
```
{
  "name": "WSO || Subscribe || RET || CBO",
  "spend": 293.20,
  "revenue": 49.99,
  "roas": 0.17,
  "purchases": 1,           ← misleading
  "cpa": 293.20,            ← misleading
  "result_count": 1,
  "result_action_type": "subscribe_website",
  "conversion_result_name": "Subscribe",
  "cost_per_result": 293.20
}
```

Report to user: "1 subscription at $293/CAC. Against an LTV-implied target CAC of ~$50 (LTV $200, 50% margin, 50% payback target), this is bleeding."

NOT: "ROAS 0.17, kill it" — that's the wrong frame for a subscription business.

### Example 2 — Pure ecom (Purchase optimization)

Performance row:
```
{
  "spend": 1200.00,
  "revenue": 4800.00,
  "roas": 4.0,
  "purchases": 48,
  "cpa": 25.00,
  "result_count": 48,
  "conversion_result_name": "Purchase"
}
```

Either set of fields works here — `purchases`/`revenue`/`roas` and `result_count`/`result_value` will match.

### Example 3 — Awareness campaign

Performance row:
```
{
  "spend": 500.00,
  "revenue": 0,
  "roas": 0,
  "purchases": 0,
  "result_count": 156000,
  "result_action_type": "impressions",
  "conversion_result_name": "Impressions",
  "cost_per_result": 0.0032
}
```

Report: "$500 spend / 156,000 impressions = $3.21 CPM. That's slightly elevated but the campaign objective is awareness — revenue/ROAS aren't applicable."

### Example 4 — `has_multiple_conversions: true`

```
{
  "name": "ACC level rollup",
  "spend": 5000,
  "result_count": 130,        ← sum across types, misleading
  "has_multiple_conversions": true,
  "kpi_breakdown": [
    {"result_action_type": "offsite_conversion.fb_pixel_purchase", "result_count": 90, "result_value": 3600, "cost_per_result": 33.3},
    {"result_action_type": "subscribe_website", "result_count": 40, "result_value": 800, "cost_per_result": 50.0}
  ]
}
```

Report by bucket: "90 purchases at $33.3 CAC; 40 subscriptions at $50 CAC. Don't sum — they're different KPIs."

## The "modeled conversions" caveat

For iOS 14.5+ traffic, Meta uses statistical modeling to fill the attribution gap. The fields above include modeled conversions by default. They are not "fake" but they are not deterministic — a 7-day-click ROAS of 4.0 on modeled data might be 2.5 on 1-day-click data.

Cross-check matters:
- **Shopify / DB orders** = ground truth for ecom.
- **Triple Whale / Northbeam** = multi-touch view; usually 30-50% lower ROAS than Meta-reported.
- **GA4 with UTMs** = alternate frame; usually undercounts.

If Meta-reported revenue ÷ Shopify revenue is:
- 0.4 - 0.8: normal (Meta over-attributes to itself via view-through)
- > 1.0: deduplication bug in pixel/CAPI
- < 0.3: pixel or CAPI broken

## Attribution window

Default is `7d_click + 1d_view`. Meta optimizes to whatever window you report. The MCP doesn't expose per-request window selection — what you see is what Meta returns at the account's default. Note Meta's 2026 attribution overhaul:

- View-through being phased into "engaged-view" (1-day)
- Click-attribution window is the dominant signal for buyers in 2026 (Mitch Barham, LinkedIn 2026)
- Expect click-based ROAS numbers to drop and "engaged-view" to fill in — re-baseline targets when the change rolls out fully

## Quick reference

If you're not sure which field to use:
1. Check `result_action_type` and `conversion_result_name`.
2. If `conversion_result_name = "Purchase"`, the legacy fields are fine.
3. Otherwise, use `result_count` and `cost_per_result`.
4. If `has_multiple_conversions: true`, decompose via `kpi_breakdown`.
