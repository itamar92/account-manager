# AdAdvisor MCP — Tool Cheatsheet

A one-line per-tool summary. Use this to look up *which* tool to call; use the MCP's `inputSchema` for parameter details. Tools are referenced as `adadvisor:<name>` in SKILL.md prose.

## Discovery & reads

| Tool | What it does | When to call |
|---|---|---|
| `adadvisor:list_ad_accounts` | All accessible Meta ad accounts with pixel summary | First call of every session |
| `adadvisor:list_pages` | Facebook Pages reachable from an ad account | Before `create_lead_form`; verify ADVERTISE + MANAGE_LEADS tasks |
| `adadvisor:list_campaigns` | Campaigns with config (no metrics) | "What campaigns do I have"; before mutation |
| `adadvisor:list_adsets` | Ad sets with targeting + config | After picking a campaign; inspecting targeting before update |
| `adadvisor:list_ads` | Ads with creative info | "Which ads are running" |
| `adadvisor:get_performance` | Aggregated KPIs at campaign/adset/ad level over a date range | Performance analysis, audit, diagnosis |
| `adadvisor:get_timeseries` | Daily metrics for a single entity | Trend analysis, fatigue detection, learning-phase tracking |
| `adadvisor:get_pixel_health` | Pixel metadata, event counts, source breakdown | Audit step 1; before trusting performance data |
| `adadvisor:search_targeting` | Find valid targeting IDs (interests, geo, behaviors, income, life events, industries, work positions/employers, locale) | Before `create_adset`/`update_adset_targeting` whenever using interests/geo |
| `adadvisor:estimate_audience_size` | Reach estimate for a targeting spec | Before committing to an ad-set audience |
| `adadvisor:list_custom_audiences` | Existing custom audiences (CUSTOM, LOOKALIKE, WEBSITE, ENGAGEMENT, IG_BUSINESS) | When user mentions audiences by name |
| `adadvisor:list_creatives` | Existing ad creatives | For reuse via `create_ad(creative_id=...)` |
| `adadvisor:search_ad_images` | Find uploaded images by name/hash (visual picker) | Before `create_creative(format='image_link')` |
| `adadvisor:search_ad_videos` | Find uploaded videos by name (visual picker) | Before `create_creative(format='video')` |
| `adadvisor:preview_existing_creatives` | Preview creatives that share an asset, with engagement | Before `create_creative` — preserve social proof if it exists |

## Resource (read via `ReadMcpResourceTool`)

| URI | What it returns |
|---|---|
| `adadvisor://account/{account_id}/context` | Business name, storefront URL, break-even ROAS, AOV, target CPL, daily budget cap, brand details, AI research report |
| `ui://adadvisor/asset-picker` | Visual picker widget for image selection (used internally by `search_ad_images`) |
| `ui://adadvisor/creative-preview` | Visual preview widget for existing creatives (used internally by `preview_existing_creatives`) |
| `ui://adadvisor/upload-creatives` | Upload widget (drag-drop + URL) (used internally by `upload_creatives`) |

## Mutations — status & budget

| Tool | What it does | Idempotent? | Destructive? |
|---|---|---|---|
| `adadvisor:change_entity_status` | Pause / resume campaigns, ad sets, or ads | Yes | Yes |
| `adadvisor:change_entity_budget` | Update daily or lifetime budget (campaign or adset) | Yes | Yes |
| `adadvisor:update_entity` | Long-tail edits (name, bid strategy, schedule, DSA fields, spend cap, etc.) | Yes | Yes |
| `adadvisor:update_adset_targeting` | Update ad-set targeting with validation + auto-fix for deprecated interests | Yes | Yes |

The `change_entity_budget` rejects >2× or <0.5× changes by default. Pass `force=True` to override.

## Mutations — duplication

| Tool | What it does |
|---|---|
| `adadvisor:duplicate_campaign` | Duplicate a campaign (deep or shell) into the same account |
| `adadvisor:duplicate_adset` | Duplicate an ad set; can move to a different campaign |
| `adadvisor:duplicate_ad` | Duplicate an ad; can attach to a different ad set |

All produce entities with `status='PAUSED'` by default. NOT idempotent — each call creates a new copy.

## Mutations — creation

| Tool | What it does |
|---|---|
| `adadvisor:create_campaign` | Create one or more campaigns (batched) |
| `adadvisor:create_adset` | Create one or more ad sets with targeting + validation (batched) |
| `adadvisor:create_creative` | Create one or more ad creatives (image_link / video / existing_post) (batched) |
| `adadvisor:create_ad` | Attach creatives to ad sets (batched) |
| `adadvisor:create_lead_form` | Create one or more Meta Lead Forms on a Page (batched) |

All produce entities with `status='PAUSED'`. NOT idempotent.

## Audiences

| Tool | What it does |
|---|---|
| `adadvisor:create_website_audience` | Build a custom audience from pixel events (Purchase, AddToCart, ViewContent, etc.) |
| `adadvisor:create_lookalike_audience` | Build a lookalike from a seed audience (1%-20% ratio, country-scoped) |

Note: customer-list audiences are uploaded in the AdAdvisor app, not via MCP. Use `list_custom_audiences` to surface them.

## Uploads

| Tool | What it does |
|---|---|
| `adadvisor:upload_creatives` | Open the upload widget (LLM-visible entrypoint) |
| `adadvisor:upload_ad_image` | Upload a single image (called by the widget — agents rarely call directly) |
| `adadvisor:upload_ad_video` | Upload a single video (called by the widget — agents rarely call directly) |

Image limit 30MB; video limit 4GB. Allowed: `image/jpeg`, `image/png`, `video/mp4`, `video/quicktime`. `image_hash` returned by `upload_ad_image` must be used in the same conversation — do not reuse across sessions.

## Pagination

Every list / search tool returns `{total, count, offset, has_more, next_offset}`. When `has_more=true`, call again with `offset=next_offset`.

## Currency

All budget parameters (`daily_budget`, `lifetime_budget`, `spend_cap`, `bid_amount`) are in **major units** in the account's currency. The server converts to Meta's minor units internally.

## Status invariant

Every `create_*` and `duplicate_*` returns `status='PAUSED'`. Activation requires explicit `change_entity_status(action='resume')` at each hierarchy level (ad → ad set → campaign).
