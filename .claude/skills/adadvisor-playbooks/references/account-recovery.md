## Account recovery — banned accounts and pixel outages

The hardest moment in Meta advertising isn't underperformance — it's an account ban or a pixel outage. Both are recoverable if you follow the right sequence; both are made worse by panicked actions.

This playbook covers the discipline for both situations.

## Banned-account recovery

### Cardinal rule: don't appeal repeatedly

Every rejected appeal makes the next harder. Meta's appeal-review system uses prior appeals as signal — repeat appeals from the same business / payment method / IP get auto-flagged.

The senior buyer's discipline:

| Action | When |
|---|---|
| Submit ONE careful appeal with documentation | Within 24 hours of the ban |
| Set up backup ad account, move pixel | Within 48 hours |
| Begin warmed-up restart on backup | Within 7 days |
| Don't appeal again | Until 30+ days have passed |
| If second appeal needed, escalate via Meta Business Support (live chat) | After 30 days if first appeal pending or rejected with no clarity |

### Step 1 — Diagnose the ban

When the account is restricted, Meta typically returns one of:

| Reason | What it means | Recoverability |
|---|---|---|
| "Unusual activity" | Login from new IP / VPN / shared device | Usually recoverable in 1-3 days |
| "Policy violation: prohibited content" | An ad violated content policy | Recoverable with appeal + ad removal |
| "Policy violation: low quality" | Multiple ad rejections + user-experience signals | Hardest to recover; takes 14-30 days |
| "Payment issue" | Card declined, fraud signal | Recoverable by updating payment + verification |
| "Identity not confirmed" | Business identity verification incomplete | Recoverable by completing verification |
| "Permanent disable" | Severe violation, multi-account ban | Often unrecoverable; new entity needed |

Read Meta's exact ban reason in Account Quality (visible in Business Manager → Account Quality). The reason determines the appeal language.

### Step 2 — Submit ONE appeal

Through Business Manager → Account Quality → "Request a Review" or "Submit an Appeal."

Include:
- Specific identification of the ad/policy in question (if Meta cited one)
- Business documentation: business license, EIN, domain registration, business email
- Explanation of remediation (what you changed, what you removed)
- Confirmation that you've reviewed Meta's Advertising Policies

Don't include:
- Emotional language
- Threats to dispute payments
- Accusations of unfair treatment
- Multiple appeals through different channels

The MCP doesn't expose appeal submission — it's done in Business Manager directly.

### Step 3 — Warm up a backup ad account

This is why every senior buyer has a backup ad account pre-built in Business Manager. If you don't have one, build one immediately — same Business Manager, different ad account, different payment method (different card or bank).

```
# Migrate pixel to backup account
# (Pixel migration is done in Events Manager → Settings, not via MCP)

# Once pixel is on backup ad account:
adadvisor:list_ad_accounts()  # confirm backup account is visible with pixel attached
adadvisor:get_pixel_health(account_id=<backup>, pixel_id=<pixel>)
# Confirm event volume is healthy on the backup
```

### Step 4 — Restart with discipline

The "new-account discipline" prevents the backup from being banned in the same way:

| Setting | First 7 days | Days 8-21 | Days 22+ |
|---|---|---|---|
| Daily budget per ad set | $25-50 | $50-100 | Normal levels |
| Ad concepts | Conservative, no policy-edge | Slightly more aggressive | Normal mix |
| Audiences | Broad + Advantage+ | Add LAL, retargeting | Full mix |
| Bid strategy | Lowest Cost | Lowest Cost | Add Cost Cap as needed |
| Creative claims | Soft, factual | Slightly stronger | Normal positioning |

Meta's risk scoring weighs early account behavior heavily. A new account that spends $500/day on aggressive claims in week 1 gets re-flagged.

### Step 5 — Identity-confirm everything

The single biggest factor in long-term account stability:

| Verification | Why |
|---|---|
| Domain verification | Confirms ad account is tied to a real domain you control |
| Business verification | Confirms the business entity is real |
| Payment method matches business | Card / bank name matches business name |
| Page admin access matches | Same person/entity admins the Page and the ad account |
| Meta Business Manager verified | Two-factor enabled, contact info current |

Domain verification specifically is the most under-utilized win. Many bans on "low quality" / "policy violation" accounts trace to unverified domains where Meta couldn't trust the ad-to-landing-page chain.

## Pixel-specific recovery

A pixel outage looks similar to a ban from the campaign-performance side — conversions drop, ROAS collapses — but it's a different problem with a different fix.

### Step 1 — Distinguish pixel outage from real performance drop

```
adadvisor:get_pixel_health(account_id, pixel_id=<from list_ad_accounts>)
```

Returns:

| Field | What to check |
|---|---|
| `total_events_last_7d` | Should be steady week-over-week |
| `events_by_event_name` | Look for missing events (e.g. Purchase = 0 today, healthy yesterday) |
| `source_breakdown` | browser/server/system_generated split |
| `event_match_quality_score` | Should be ≥6 |

If `total_events_last_7d` is suddenly near-zero or the Purchase count cratered, the pixel is the problem — not the campaign performance.

### Step 2 — Check whether CAPI is still firing

If you have CAPI (Conversions API server-side firing), check the `source_breakdown`. If `server` events are still flowing, CAPI is healthy and the issue is browser-side (pixel script).

**Critical: campaigns can survive a browser-pixel outage if CAPI is healthy.** Meta uses dedupe to merge browser + server events; if browser fails but server fires, Meta still gets the conversion signal (just with degraded match quality).

If `server` events are also gone, both pixel and CAPI are down — this is the worst case, and Meta has lost all conversion signal for the account. Performance will collapse within 48 hours as the algorithm loses optimization signal.

### Step 3 — Debug client-side (pixel script)

Most browser-pixel outages trace to:

| Cause | How to find it |
|---|---|
| GTM (Google Tag Manager) update broke the pixel tag | Check GTM container version history; rollback if a recent change matches the outage time |
| Theme update (Shopify, WordPress) overrode the pixel snippet | Check theme version history; restore pixel snippet |
| Cookie consent / GDPR popup blocking the pixel | Check consent manager config; ensure pixel fires post-consent |
| Pixel ID copy-paste error after a re-implementation | Inspect page source; confirm pixel ID matches the one in `list_ad_accounts.pixels` |
| Third-party script error breaking page JS | Open console on the affected page; look for JS errors above the pixel snippet |

These debug steps are outside the MCP — they're browser/server-side, not in Meta's API surface.

### Step 4 — Re-test pixel firing

After fixing client-side:

1. Use Meta's Pixel Helper Chrome extension to verify the pixel fires on a real page load.
2. Wait 30-60 minutes for the MCP's cached pixel data to refresh.
3. Re-call `adadvisor:get_pixel_health` to confirm event volume recovers.

### Step 5 — Reconnect / rebuild custom audiences

Custom audiences built from pixel events (`adadvisor:create_website_audience`) populate from the event stream. If events were missing for several days, those audiences may have shrunk. Wait 7-14 days for them to rebuild, or extend `retention_days` temporarily.

```
# Check whether key retargeting audiences are still healthy
adadvisor:list_custom_audiences(account_id, search='Purchasers')
adadvisor:list_custom_audiences(account_id, search='AddToCart')
# Look at approximate_count_lower_bound — has it dropped vs prior reads?
```

## What an "always-have-it" backup looks like

The pre-flight checklist for any account doing >$1K/day:

| Item | Status |
|---|---|
| Backup ad account exists in Business Manager | Yes — pre-built, never used |
| Backup payment method on file (different card from primary) | Yes |
| Pixel can be migrated to backup (verify in Events Manager) | Yes |
| Business verified in Business Manager | Yes |
| Domain verified | Yes |
| CAPI firing (not just browser pixel) | Yes |
| Two-factor enabled on all Business Manager admins | Yes |
| Recent ad creatives backed up locally | Yes |
| Custom audiences documented (you can rebuild from CSVs if lost) | Yes |

Most operators don't do this until they've been burned once. The senior buyer's frame: you will eventually be banned or experience a pixel outage. The question is whether you have 24 hours of downtime or 14 days.

## Anti-patterns

- Appealing 4 times in one week. Each rejection makes the next harder.
- Submitting an appeal that blames Meta. Tone matters; Meta's reviewers are human.
- Starting the backup ad account at full normal spend on Day 1. Meta's risk scoring flags it.
- Treating a pixel outage as a campaign-performance problem. Diagnose the pixel first via `adadvisor:get_pixel_health`.
- Rebuilding custom audiences from scratch when retention windows would have recovered them. Wait 7-14 days first.
- Not having a backup ad account pre-built. The cost of building one is zero; the cost of not having one is weeks of downtime.
- Continuing to spend on the backup at the rate of the banned account. Slow start; demonstrate "good behavior" to Meta's risk scoring.

## References cited

- Meta Business Help Center documentation on Account Quality and appeals.
- Meta documentation on CAPI and event deduplication.
- Common Thread Collective on backup-account doctrine.
- Andrew Foxwell on pixel-outage triage.
- AdAdvisor MCP: `get_pixel_health` source_breakdown semantics.
