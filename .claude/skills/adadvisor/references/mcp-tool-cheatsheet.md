# Tool cheatsheet — upstream `adadvisor:*` tools → this connection

The other `adadvisor-*` skills were written for the adadvisor.ai MCP server (~33 tools, reads **and** writes). This project does not use it. Use this table to translate every `adadvisor:<tool>` the skills mention.

**Rule of thumb:** a *read* maps to one of the `account-manager` tools below, at **campaign level only**; a *write* has no equivalent and becomes **an instruction for the user to do in Ads Manager** (see `mutation-safety.md`).

## What exists

| Tool | Arguments | Returns |
|---|---|---|
| `moonlight_campaigns` | none · `campaign_id` · `unmapped_only` | All campaigns with status, objective, spend (ILS), `spend_original` + `currency`, impressions, clicks, reach, first/last spend date, mapped shows (`events[]` with `share` and `attributed` spend), `suggestions[]` for unmapped ones. With `campaign_id`: `daily[]` of `{date, spend, impressions, clicks}`. |
| `moonlight_ad_analysis` | `from`, `to` (`YYYY-MM-DD`) | `rows[]` per show: `tickets`, `revenue` (the fee), `ad_spend`, `campaign_on_row`, `cost_per_ticket`, `spend_share_of_revenue`, `clicks`, `impressions`, `spend_months`, `spending_after_show`, `settled`, `profit`. `totals` incl. `unmapped_spend`. `monthly_invoices`. |
| `moonlight_shows` | `from`, `to` | Shows: venue, date, tickets, fee, expenses, profit. |
| `moonlight_summary` | `from`, `to` | Band totals and follow-up lists (incl. upcoming shows). |
| `moonlight_campaign_advice` | `from`, `to` | The last stored in-app advisor report — findings and ranked suggestions. Never triggers a new analysis. |
| `get_overview` | `year` | Orientation, P&L by month, band totals. |

## Reads: upstream tool → what to do

| Upstream | Here |
|---|---|
| `list_ad_accounts` | Not needed — there is one account, fixed in the app. Currency is ILS in all outputs. |
| `adadvisor://account/{id}/context` (break-even ROAS, AOV, target CPL, budget cap, brand details) | **No equivalent.** Replace with the show economics in `economics.md`: the band's own cost-per-ticket history from `moonlight_ad_analysis`. Brand voice and audience: ask the user, or use the stored advisor report. |
| `list_campaigns` | `moonlight_campaigns` |
| `get_performance(level=campaign)` | `moonlight_campaigns` (lifetime) or `moonlight_ad_analysis` (per show). Spend, impressions, clicks, reach only. |
| `get_performance(level=adset\|ad)` | **Not available.** Say "campaign level only"; ask the user to paste the Ads Manager breakdown. |
| `get_timeseries` (campaign) | `moonlight_campaigns` with `campaign_id` — daily spend, impressions, clicks. No daily reach or frequency. |
| `get_timeseries` (adset / ad) | **Not available.** |
| `list_adsets`, `list_ads`, `list_creatives` | **Not available.** |
| `get_pixel_health` | **Not available.** The pixel/EMQ checks in the audit cannot be run from data; ask the user to check Events Manager, and say the audit is therefore partial. |
| `search_targeting`, `estimate_audience_size`, `list_custom_audiences`, `list_pages` | **Not available.** Targeting advice is strategic only; the user checks reach estimates in Ads Manager. |
| `search_ad_images`, `search_ad_videos`, `preview_existing_creatives` | **Not available.** Ask the user for the creative or its screenshot. |

## Metrics you can compute (and the ones you cannot)

| From | You can derive | Caveat |
|---|---|---|
| spend, impressions | **CPM** = spend ÷ impressions × 1000 | ILS, converted. |
| clicks, impressions | **CTR (all clicks)** = clicks ÷ impressions | `clicks` is **all** clicks, not link clicks — it overstates the click-through to the ticket page and runs higher than Ads Manager's link CTR. Compare campaign to campaign, not to outside benchmarks. |
| spend, clicks | **CPC (all clicks)** = spend ÷ clicks | Same caveat. |
| impressions, reach | **Frequency (lifetime)** = impressions ÷ reach | Per campaign over its whole life. Not daily; reach is not additive across days. |
| spend, show tickets | **Cost per ticket** | Spend against tickets from the books — not attributed conversions. |
| spend, show fee | **Spend share of the fee** | |

**Cannot derive:** ROAS, CPA, CPL, hook rate, hold rate, conversion rate, any ad-set or ad ranking, creative fatigue curves, learning-phase status.

## Writes: upstream tool → what to do

Every row below becomes a **written instruction** with the entity name, setting, value and order — never a claim that it was done.

| Upstream | Instruction to give |
|---|---|
| `change_entity_status` (pause / resume) | "In Ads Manager, pause/resume *<campaign / ad set / ad name>*." Resume leaf-up: ad → ad set → campaign. |
| `change_entity_budget` | "Set *<name>* daily budget to ₪X (from ₪Y)." Keep the stepping rules in `adadvisor-scale`. |
| `update_entity` | The specific setting, with the exact value. |
| `update_adset_targeting` | The targeting change, written out. |
| `create_campaign`, `create_adset`, `create_ad`, `create_creative`, `create_lead_form` | A build sheet: objective, budget type, audience, placements, creative, copy, destination URL, name. Everything starts **paused**; say so. |
| `duplicate_campaign`, `duplicate_adset`, `duplicate_ad` | "Duplicate *<name>* in Ads Manager; set the copy to paused; change *<setting>*." |
| `create_website_audience`, `create_lookalike_audience` | The audience definition (seed, source events, retention days, ratio, country). |
| `upload_*` | "Upload *<asset>* in Ads Manager." |

## Naming

Upstream auto-generates names like `ADADVISOR || CBO || TOF || …`. Do not. When proposing names in a build sheet, **match what the account already uses** — read the names from `moonlight_campaigns` and follow the pattern, and where a show is involved, include the show's label (`label` from `moonlight_shows`) so the app's mapping suggestions can match it later (`suggestions[]` are based on the campaign name).
