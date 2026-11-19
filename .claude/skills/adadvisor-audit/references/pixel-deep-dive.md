## Pixel / CAPI / EMQ — deep technical reference

The Meta pixel is the single most-leveraged piece of infrastructure in a Meta-ads account. A pixel firing on browser-only with 4 identifiers loses 30-50% of conversions to iOS / Safari signal loss; a properly-tuned pixel with browser + CAPI dual-firing at EMQ 8+ recovers almost all of it. This reference is the technical playbook for what to inspect and how to remediate.

## Event Match Quality (EMQ) — the score that drives delivery

EMQ is Meta's measure of how confidently it can match a pixel event to a Facebook user. It ranges 0-10. Meta uses EMQ both for attribution (matching outcomes back to ad exposures) and for optimization signal (training the bidder).

| EMQ range | Rating | What it means |
|---|---|---|
| 0-4 | **Poor** | Most events unmatched. Bidder is flying blind; CPAs inflate 20-40%. |
| 5-6 | **OK** | Adequate for awareness / volume objectives; lossy for conversion optimization. |
| 7-7.9 | **Good** | Standard for healthy ecom. iOS / Safari mostly resolved via modeling. |
| 8-10 | **Great** | Optimal. Meta's optimizer has near-deterministic signal. |

EMQ is scored *per event type*, not per pixel. A pixel with EMQ 8 on Purchase but EMQ 3 on AddToCart is still failing — Meta uses AddToCart for funnel optimization.

## The 9+ identifiers needed for EMQ 8+

Each identifier you can pass via the pixel (browser) or Conversions API (server) raises EMQ. The marginal lift diminishes — first 3 identifiers raise EMQ from 2 to 6; 7+ identifiers push EMQ from 7 to 9. To hit 8+ reliably, target these:

| Identifier | Field name | Source | Notes |
|---|---|---|---|
| Email (hashed) | `em` | Customer-provided | SHA-256, lowercased, trimmed |
| Phone (hashed) | `ph` | Customer-provided | SHA-256, E.164 format pre-hash |
| First name (hashed) | `fn` | Customer-provided | SHA-256, lowercased, trimmed |
| Last name (hashed) | `ln` | Customer-provided | SHA-256, lowercased, trimmed |
| Facebook click ID | `fbc` | URL `fbclid` param → cookie `_fbc` | Critical — directly identifies the ad click |
| Facebook browser ID | `fbp` | Cookie `_fbp` set by pixel | Anonymous user identifier |
| IP address | `client_ip_address` | Server-side (CAPI) | Hashed by Meta on receipt |
| User agent | `client_user_agent` | Server-side (CAPI) | Browser + device fingerprint |
| External ID | `external_id` | Your CRM / DB customer ID (hashed) | Cross-session identity bridge |
| City / State / Zip (hashed) | `ct`, `st`, `zp`, `country` | Customer address | Each adds incremental EMQ |
| Date of birth | `db` | Customer profile | YYYYMMDD format pre-hash |
| Gender | `ge` | Customer profile | `m` or `f` pre-hash |

**Meta's EMQ engine rewards FBC + Email + Phone above all others.** A CAPI-only Purchase event with `email + phone + fbc + fbp + ip + user_agent + external_id` typically scores 8.5-9.5 EMQ. Add `fn + ln + zp` and you cross 9.

Hashing rules (Meta-mandated):
- Lowercase before hashing.
- Trim whitespace.
- For email: validate format pre-hash.
- For phone: strip all non-digit characters, then prepend country code (E.164 minus the `+`), then hash.
- Use SHA-256, hex-encoded.

## AEM (Aggregated Event Measurement) priority

Aggregated Event Measurement is Meta's iOS 14.5+ framework for handling Apple's App Tracking Transparency. Each verified domain gets **8 event slots**, ordered by priority. Only the highest-priority event that fires per user per attribution window is reported for iOS / Safari traffic.

| Position | Recommended event (ecom) | Recommended event (lead-gen) |
|---|---|---|
| 1 | Purchase | Lead (on-platform) / Submit Application |
| 2 | Subscribe | Schedule / Book Appointment |
| 3 | InitiateCheckout | StartTrial |
| 4 | AddPaymentInfo | CompleteRegistration |
| 5 | AddToCart | ViewContent (qualified) |
| 6 | AddToWishlist | Subscribe (newsletter) |
| 7 | ViewContent | Contact |
| 8 | Search | PageView (lowest) |

**Rules:**
- Place your primary KPI event at Position 1. For ecom: Purchase. For lead-gen: Lead (or Submit Application).
- Custom Conversions can fill slots too — useful for high-AOV ecom (e.g. "Purchase > $100") or B2B (e.g. "Lead - Enterprise").
- Re-prioritizing AEM events triggers a **72-hour delivery pause** on iOS traffic. Don't churn the priority list — set it deliberately, leave it.
- Domain verification is prerequisite. Without verified domain, AEM cannot be configured.

## Browser : Server event ratio targets

A healthy modern pixel sends events twice — once from the browser (pixel script), once from the server (CAPI), deduplicated by Meta via `event_id`.

| Ratio (browser : server) | Assessment |
|---|---|
| 100 : 0 | RED — no CAPI; losing 30-50% of conversions on iOS / Safari |
| 80 : 20 | Yellow — CAPI partial coverage; usually means CAPI on Purchase only |
| 60 : 40 | Good — CAPI covering Purchase + AddToCart + InitiateCheckout |
| 50 : 50 | Great — CAPI dual-fires all events |
| 30 : 70 | Suspicious — likely server-only setup with broken browser pixel; dedup may be off |
| 0 : 100 | Server-only — viable but check that browser pixel is intentionally disabled, not broken |

20%+ server-side is the **2026 floor**. Common Thread Collective and Pilothouse both recommend 50%+ server-side as the target. The MCP exposes this ratio in `get_pixel_health` via per-source event counts.

## The deduplication key requirement

When the same event fires from browser AND server, Meta needs to know they're the same event so it doesn't double-count. The deduplication mechanism:

1. Browser pixel fires with `eventID: "<unique-id-per-event>"`.
2. CAPI sends the same event with `event_id: "<same-unique-id>"`.
3. Meta dedupes within a 48-hour window — keeps the highest-EMQ one.

**Without `event_id` on both sides, Meta double-counts.** Symptoms:

- `revenue` from Meta is 2× Shopify revenue.
- `purchases` count is 2× actual orders.
- ROAS looks abnormally high.

If `get_pixel_health` shows event counts that look inflated relative to backend, the dedup key is the first thing to check. Fix is in the implementation, not the MCP — typically a developer task to align IDs.

## Hosts coverage check

`get_pixel_health` returns the **hosts** the pixel has fired from in the last 7 days (top N domains by event count). The audit check:

1. Compare to `business.storefront_url` from the context resource.
2. The top host should be the apex domain of the storefront URL (e.g. storefront `https://shop.example.com/...` → top host `shop.example.com` or `example.com`).
3. If the top host is unrelated (e.g. `partner-tracking.com`, an old domain, a developer staging site), the pixel is firing on the wrong place. Conversions are being lost or misattributed.

Common host issues:

| Symptom | Cause | Fix |
|---|---|---|
| Top host is `staging.example.com` | Developer left pixel firing on staging | Remove pixel from staging or use a separate test pixel |
| Top host is the old domain after a replatform | Old install still active; new install missing | Remove old install; deploy on new domain via Shopify / GTM / direct |
| Multiple unrelated hosts | Pixel installed on partner site, affiliate, marketplace listing | Audit each host; remove unauthorized installs |
| Storefront not in top 10 hosts | Pixel never installed on the actual storefront | Install via Shopify Meta channel, GTM, or direct script |

## What `adadvisor:get_pixel_health` returns

The full response shape:

```
{
  "pixel_count": 1,
  "pixels": [
    {
      "pixel_id": "...",
      "name": "...",
      "last_fired_time": "2026-05-12T11:43:00Z",
      "enable_automatic_matching": true,
      "automatic_matching_fields": ["em", "fn", "ln", "ph", "ct", "st", "zp", "country", "external_id"],
      "event_match_quality": {
        "Purchase": 8.7,
        "AddToCart": 7.2,
        "ViewContent": 6.1
      },
      "events_by_source": {
        "BROWSER": 6190,
        "SERVER": 3450,
        "UNKNOWN": 12
      },
      "events_by_type": {
        "Purchase": 245,
        "AddToCart": 1820,
        "ViewContent": 5230,
        "PageView": 12400
      },
      "hosts": [
        {"domain": "shop.example.com", "event_count": 5800},
        {"domain": "example.com", "event_count": 600}
      ],
      "aem_priority": [
        "Purchase",
        "InitiateCheckout",
        "AddToCart",
        ...
      ]
    }
  ]
}
```

How to read each field:

- `last_fired_time` < 1h: healthy. > 24h or null: tracking broken.
- `enable_automatic_matching: true` AND `automatic_matching_fields` ≥ 6: good Advanced Matching setup.
- `event_match_quality` per-event: aim 8+ on the primary KPI event (Purchase for ecom, Lead for lead-gen).
- `events_by_source` ratio: server share ≥ 20% (target 50%+).
- `events_by_type`: every funnel event present and proportionate (PageView > ViewContent > AddToCart > InitiateCheckout > Purchase, ~10× drop-off each step is typical for ecom).
- `hosts`: top host matches storefront.
- `aem_priority`: Purchase (or primary KPI) at position 1.

## Common pixel failure modes

| Failure | Symptom | Remediation |
|---|---|---|
| No CAPI installed | `events_by_source.SERVER: 0` | Install via Shopify CAPI app, Stape, Elevar, or direct API. Outside MCP. |
| CAPI without dedup | Server events present but Meta-reported counts 2× backend | Add matching `event_id` to browser pixel call. Developer task. |
| Advanced Matching off | `enable_automatic_matching: false` | Toggle in Events Manager; redeploy pixel script if needed. |
| Only `em` matched | `automatic_matching_fields: ["em"]` | Customer data not flowing to pixel call. Update Shopify customer setup or GTM Advanced Matching config. |
| Pixel installed but no events | Pixel exists, `last_fired_time` null | Script not deployed on storefront, or blocked by ad blockers / CSP. Verify in browser dev tools. |
| Duplicate pixels | `pixel_count > 3` with overlapping event counts | Consolidate to one pixel per business. Old pixels: remove from site or pause in Events Manager. |
| Wrong domain | Top host doesn't match storefront | See hosts table above. |
| AEM misordered | Purchase not at AEM position 1 | Re-set in Events Manager. Expect 72-hour iOS delivery pause. |
| EMQ stuck below 5 | Few identifiers passed | Send more fields via CAPI; check Shopify checkout extension is sending phone + address. |

## When pixel issues block the audit

The pixel is **upstream of everything**. If Phase 1 finds CRITICAL issues (no CAPI, last fired > 24h, EMQ < 5 on Purchase), the rest of the audit is degraded:

- Performance numbers under-report (browser-only loses 30-50% of iOS / Safari).
- Modeled conversions inflate to fill the gap, but the model has nothing to anchor to — outputs are noise.
- The "kill / scale" decisions you'd make on the surfaced numbers are wrong by 20-40%.

**Recommended posture:** report the pixel issues in the audit, but flag downstream performance numbers as "directionally informative, not decision-ready." Ask the user to fix pixel issues first; offer to re-audit performance once the pixel is healthy and 14 days of clean data exist.

See [`audit-checklist.md`](audit-checklist.md) for the Phase 1 checks; see [`red-flags.md`](red-flags.md) for pixel-related red flags ranked alongside structural and performance issues.
