---
name: adadvisor
description: |
  Foundation skill for the AdAdvisor MCP server — Meta (Facebook + Instagram) ad account management. Loads conventions, business-context grounding, and the unit-economics mental model every other AdAdvisor skill assumes. Use when: "adadvisor", "meta ads", "facebook ads", "instagram ads", "my ad account", "look at my ads", "let's work on my account", "connect my meta", or whenever an AdAdvisor MCP tool is about to be called. Chain with: adadvisor-audit for full account audits, adadvisor-diagnose for performance investigations, adadvisor-launch for new campaigns, adadvisor-scale for scaling winners, adadvisor-creative for creative strategy, adadvisor-targeting for audience work, adadvisor-playbooks for tactical SOPs (BFCM, lead-gen, recovery). NOT for: Google Ads / TikTok / Snap / LinkedIn / X — this MCP is Meta-only. NOT for: implementing ad creatives from scratch (use adadvisor-creative + an image/video generation tool). NOT for: analytics platforms outside Meta (use the relevant analytics MCP).
license: Apache-2.0
version: 0.1.0
---

# AdAdvisor — Foundation

This skill is the floor. It loads automatically whenever the user mentions Meta ads, AdAdvisor, or their ad account, and it sets the conventions every other AdAdvisor skill builds on. Read this once; the chained skills assume you have.

## What AdAdvisor is

The AdAdvisor MCP server exposes ~33 tools to read and modify Meta ad accounts. Read tools (campaigns, ad sets, ads, performance, pixel health, targeting, audiences, creatives) return data synced every 30 min. Mutation tools (status, budget, create, duplicate, update targeting) call Meta's Marketing API directly and take effect immediately.

You — the agent — are pairing with a real ad account that real spend flows through. Treat every mutation as production. Default to PAUSED, ask before activating, and confirm budget changes match the user's stated intent.

## Workflow — the first 90 seconds of every session

Do these in order before any analysis or mutation:

1. **`adadvisor:list_ad_accounts`** — discover available accounts. Returns `ad_account_id`, currency, timezone, business name, `data_synced`, and a pixel summary per account. If multiple accounts exist, ask which one the user wants to work on; do not guess.

2. **Check `data_synced`.** If `false` on the chosen account, performance reads will be empty or incomplete — the initial import is still running. Tell the user, suggest they wait ~10-30 min, and pause analysis.

3. **Read `adadvisor://account/{ad_account_id}/context`** (resource, not tool). This returns:
   - `business.break_even_roas`, `business.average_order_value`, `business.target_cpl`, `business.daily_budget_cap` — the unit-economics gates for every downstream decision.
   - `business.storefront_url`, `business.business_name` — used to ground naming and copy.
   - `research.business_details` — industry, AOV bucket, brand tone, brand colors, target audience summary, key selling points. This is the "what does this business do" snapshot.
   - `research.research_report` — multi-page AI-generated marketing intelligence.

   Every recommendation downstream is grounded in this. **Decisions made without reading the context resource are ungrounded — they default to generic "good ROAS" thinking and miss what's actually going on at this business.**

4. **Verify the pixel.** Look at `accounts[].pixels` from `list_ad_accounts`. If the account has no pixel, or `last_fired_time` is older than 24 hours, performance data is unreliable — call `adadvisor:get_pixel_health` to confirm and surface to the user before recommending mutations.

After those four checks, you can route to the specific workflow skill (`adadvisor-audit`, `adadvisor-diagnose`, etc.).

## Unit economics — the operating model

A senior media buyer thinks in **contribution margin**, never raw ROAS. Internalize these:

- **Break-even ROAS** (from the context resource: `business.break_even_roas`) is `1 ÷ contribution_margin`. At 30% margin, break-even = 3.33×. At 50%, break-even = 2.0×.
- **Target ROAS** is break-even × the user's desired profit-margin multiple. The context resource may not surface "target" — derive it: target ≈ break-even × 1.3 to 1.5 for healthy scaling, or ask the user.
- **Kill threshold**: ad-level ROAS < 0.8× of break-even after spending 1.5× target CPA → kill.
- **Scale threshold**: campaign-level ROAS > target for 3 consecutive days AND new-customer rate stable → scale (see `adadvisor-scale`).
- **Lead-gen flips the math** — replace ROAS with CPL vs `target_cpl`. If `target_cpl` is null on the context, ask the user what their CPL target is.

When you report performance to the user, **always pair the number with the business threshold**. "ROAS 2.1×" is meaningless; "ROAS 2.1× against a 3.3× break-even — losing money on every order" is the conversation.

## KPI mental model — read Meta's "Results" column, not legacy fields

Every performance response from `adadvisor:get_performance` and `adadvisor:get_timeseries` includes both **legacy fields** (`purchases`, `leads`, `revenue`, `cpa`, `cpl`) and **canonical Results fields** (`result_count`, `result_value`, `cost_per_result`, `result_action_type`, `conversion_result_name`).

**Prefer the Results fields.** They match what the user sees in Meta Ads Manager's "Results" column, which depends on each ad set's optimization goal:

| Optimization goal | `conversion_result_name` | Legacy field that's WRONG |
|---|---|---|
| OFFSITE_CONVERSIONS (Purchase) | "Purchase" | use `purchases` — OK |
| OFFSITE_CONVERSIONS (Subscribe) | "Subscribe" | `purchases`/`revenue` will be 0 |
| OFFSITE_CONVERSIONS (Lead) | "Lead" | `purchases`/`revenue` will be 0 |
| LEAD_GENERATION (on-platform form) | "Lead" | `leads` may be 0 if attribution mismatch |
| Custom conversion | "Complete Registration" / custom name | both legacy fields likely 0 |
| LANDING_PAGE_VIEWS | "Landing page view" | volume vs spend, not revenue |

When `has_multiple_conversions=True` on a row, the entity spans mixed KPIs — inspect `kpi_breakdown` (array of per-KPI buckets sorted by volume DESC) instead of summing `result_count` across types. `kpi_breakdown` is returned in `response_format='full'`.

For a real example: an account optimizing for "Subscribe" (subscription business) might show `revenue: 19.99, roas: 0.05, result_count: 1, cost_per_result: 379.01, conversion_result_name: "Subscribe"`. The "ROAS 0.05" is misleading — the campaign isn't optimized for purchases, it's optimized for first-month subscription value. Report against `cost_per_result` vs an LTV-implied CPL target, not against ROAS.

## Naming conventions for new entities

When `create_campaign` is called with no `name`, the MCP auto-generates: `ADADVISOR || CBO/ABO || BOF/MOF/TOF || {strategy} || {business} || {date}`. Ad sets auto-generate: `ADADVISOR || {audience_type} || {summary} || {geo} || {demographics} || AUTO`. **Prefer auto-generated names** when launching multiple entities — they're predictable and grepable.

Override when the user has an existing naming convention (look at `list_campaigns` results to detect — e.g., `WSO ||`, `MCP ||`, `ADADVISOR ||` prefixes). Match the existing pattern.

## Currency and units

All budget params and budget responses are in **major units** in account currency (e.g. `daily_budget: 50.0` for $50/day in USD, ¥50 in JPY, $50.000 in KWD). The MCP server converts to Meta's minor units (cents) internally. **Never** write `daily_budget: 5000` thinking in cents — the server will treat that as $5,000/day.

Each list/performance response includes a `currency` field and a `_units` legend. Trust those.

## Status invariant — everything starts PAUSED

Every entity returned by `create_campaign`, `create_adset`, `create_ad`, `create_creative`, `create_lead_form`, and the `duplicate_*` tools defaults to `status: "PAUSED"`. **Always** activate explicitly via `adadvisor:change_entity_status(entity_type, entity_ids=[id], action='resume')`.

Activation does NOT cascade. If you create a campaign + ad set + ad in one flow and only resume the ad, the ad is still off because the parent ad set and campaign are paused. Activate from the leaf up: ad → ad set → campaign. The MCP tools' `next_steps` strings list the exact calls.

## Mutation safety

- **`change_entity_budget` rejects changes >2× or <0.5× of the current value.** Pass `force=True` to override, or split into staged changes (e.g. 1.5× then 1.3× over two days). Resetting learning is real cost.
- **`change_entity_status` and `change_entity_budget` are idempotent.** Re-applying the same action / value succeeds without side effects.
- **`create_*` and `duplicate_*` are NOT idempotent.** Each call creates a new entity. If a call fails partway through a batch, inspect `errors[]` before retrying — the successful entities are real.
- **Token-expiry errors (Meta code 190)** mean the user must reconnect their Meta account via the AdAdvisor app. The MCP can't refresh tokens silently.

## Common LLM mistakes (avoid these)

- **Calling `get_performance` before reading the context resource.** You can't tell the user whether their ROAS is good without knowing their break-even.
- **Treating Subscribe / Lead campaigns by `purchases`.** That field is 0. Use `result_count`.
- **Confusing `daily_budget` with `lifetime_budget`.** They're mutually exclusive per entity. Lifetime budgets require `stop_time`/`end_time`.
- **Activating a single ad and reporting "campaign is live".** Activation doesn't cascade — check the parent ad set and campaign too.
- **Making one-day decisions on small budgets.** Meta needs 3–5 days of stable signal. 24-hour calls on $50/day budgets are noise. Defer to `adadvisor-diagnose` for the kill/scale rules.
- **Reusing image hashes from a previous session.** Image hashes are conversation-scoped — must come from `search_ad_images` or `complete_upload` in the current conversation.
- **Forgetting `conversion_domain` on `create_ad`.** Required for pixel-tracked campaigns (Meta subcode 2490408). Format: registrable second-level domain like `'example.com'`, not the full URL.
- **Calling Meta API directly.** Don't `curl https://graph.facebook.com/...`. Every interaction goes through the MCP — it handles auth, retries, currency, and audit logging.

## When to chain to another skill

| User says | Load |
|---|---|
| "audit my account", "take over this account", "what's wrong" | `adadvisor-audit` |
| "CPA went up", "ROAS dropped", "what happened", "diagnose" | `adadvisor-diagnose` |
| "launch", "create a campaign", "set up", "build me a campaign" | `adadvisor-launch` |
| "scale", "increase budget", "winner", "expand" | `adadvisor-scale` |
| "test ads", "creative", "refresh", "fatigue", "what to make next" | `adadvisor-creative` |
| "audience", "lookalike", "retargeting", "interests", "exclude" | `adadvisor-targeting` |
| "BFCM", "Black Friday", "product launch", "lead gen", "banned account", "recovery" | `adadvisor-playbooks` |

If the request spans multiple — e.g. "audit my account and tell me what to scale" — load both, then run audit first, then scale.

## References

- [`references/mcp-tool-cheatsheet.md`](references/mcp-tool-cheatsheet.md) — one-line summary of every AdAdvisor MCP tool with its typical use-case.
- [`references/economics.md`](references/economics.md) — break-even ROAS, MER, LTV:CAC, payback period — the senior buyer's math.
- [`references/kpi-decoder.md`](references/kpi-decoder.md) — Meta optimization goals → `conversion_result_name` mapping, when legacy fields lie.
- [`references/currency-and-units.md`](references/currency-and-units.md) — zero-decimal, two-decimal, three-decimal currencies; budget format gotchas.
- [`references/mutation-safety.md`](references/mutation-safety.md) — idempotency table, the 2× guardrail, how to handle partial-failure batch responses.

## Anti-patterns

- ❌ Quoting "ROAS 4.2×" with no business context. ✅ "ROAS 4.2× against your 3.3× break-even — profitable, but margin is thinner than the 5× target we'd usually scale on."
- ❌ "I'll create a campaign with daily_budget: 5000." (means $5,000/day, not $50/day). ✅ "Creating with `daily_budget: 50.0` in USD per your account currency."
- ❌ Recommending "kill this campaign" after one bad day. ✅ "Spend is ~1.2× target CPA for one day — that's noise. Check again in 72 hours; kill threshold is 3× target CPA with zero conversions."
- ❌ Calling `create_ad` without `conversion_domain` on a pixel-optimized campaign. ✅ Read the parent campaign's objective; if `OUTCOME_SALES`, pass `conversion_domain` matching the destination URL's domain.
- ❌ Telling the user "campaign is active" after resuming the campaign but not the ad set or ad. ✅ Resume from leaf upward; confirm each level via the response's `state_after`.
