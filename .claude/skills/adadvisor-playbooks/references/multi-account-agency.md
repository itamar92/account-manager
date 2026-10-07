## Multi-account agency workflows — managing 5+ clients in one session

Agencies running multiple Meta ad accounts face a different operational reality than in-house operators. The mistakes that destroy agency margin aren't tactical — they're cross-account leakage: applying one client's break-even ROAS to another, copying a lookalike-seed quality assumption that doesn't hold, or running through a portfolio audit without re-reading account context between switches.

The MCP enforces per-account isolation at the tool-call level — every tool requires `account_id`, and no state bleeds across accounts. The discipline below covers how to leverage that isolation while still capturing the cross-account learning advantage that defines a good agency.

## The agency operational model

Most agencies running on AdAdvisor have a daily/weekly cadence like:

| Frequency | Activity |
|---|---|
| Daily | Quick audit across all accounts; flag any account with ROAS drop / CPA spike |
| 3× per week | Deep audit per account; per-account decisions |
| Weekly | Cross-portfolio review; budget reallocation; strategy adjustments |
| Monthly | Client reporting; strategic review |

Inside a single session, an agency operator may touch 5-15 accounts. The cardinal rule: re-read account context before every account switch.

## Re-read context per account

```
# When switching to a new account
adadvisor:list_ad_accounts()  # confirm account_id
# Read the context resource — DON'T skip
ReadMcpResourceTool('adadvisor://account/<account_id>/context')
```

The context resource returns:

- `business.break_even_roas` — different per client
- `business.average_order_value` — different per client
- `business.target_cpl` — different per client (and only set for lead-gen accounts)
- `business.geographic_scope` — local / national / international
- `business.customer_segment` — B2B vs DTC
- `business.daily_budget_cap` — hard ceiling per client
- AI research report — competitor positioning, brand differentiation

A 4× ROAS is excellent for a 25%-margin apparel brand and bleeding-money for a 15%-margin furniture brand. Without re-reading the context, the operator applies the wrong threshold.

## Standardized audit templates per industry

Build a per-industry audit template, but execute it inside per-account context. Industries that share patterns:

### Apparel / fashion DTC

| Audit check | Threshold |
|---|---|
| Break-even ROAS | Typically 2.5-3.5× (30-40% contribution margin) |
| Creative refresh cadence | 7-10 days |
| Retargeting share of spend | 20-30% |
| AddToCart audience required | Yes — apparel has high cart-abandon rate |
| Cross-sell campaigns post-purchase | Yes — repeat-purchase is the LTV play |

### Beauty / supplements

| Audit check | Threshold |
|---|---|
| Break-even ROAS | Typically 1.8-2.5× (40-50% contribution margin) |
| Subscription event tracking | Critical — optimize on Subscribe, not Purchase |
| First-month break-even vs LTV target CAC | First-month often loses money intentionally |
| Refresh cadence | 5-7 days (consumables = high frequency) |
| UGC creative weight | Heavy — 70%+ of winning concepts are UGC |

### Furniture / home goods

| Audit check | Threshold |
|---|---|
| Break-even ROAS | 3.5-5× (20-30% contribution margin, high shipping) |
| Considered-purchase retargeting | 30/60/90/180 day funnel; people take months to buy |
| Catalog + DABA campaigns | Yes — large SKU count |
| Video creative emphasis | Yes — feature demonstrations |

### B2B / SaaS

| Audit check | Threshold |
|---|---|
| CPL target | Derived from LTV × conversion rate × margin |
| Optimization event | MQL or Demo Scheduled (CRM CAPI), not on-Meta form |
| Form quality | 3-5 qualifying fields beyond email |
| Sales-cycle attribution window | 30-90 days; default 7d-click underreports |

### Local services

| Audit check | Threshold |
|---|---|
| Geo radius | 5-25 miles; rarely whole-state |
| Audience size | Often <500K; small-audience discipline applies |
| Lead-gen vs OUTCOME_TRAFFIC | Phone-call ads sometimes outperform forms |
| Frequency tolerance | Higher (5-7/week) — local audiences are small |

## Client-reporting structures

A weekly client report typically covers:

| Section | Source |
|---|---|
| Top-line MER + total spend | `adadvisor:get_performance(level='account', date_range='last_7d')` |
| ROAS by campaign | `adadvisor:get_performance(level='campaign', date_range='last_7d')` |
| Top 5 creatives by performance | `adadvisor:get_performance(level='ad', date_range='last_7d')` |
| Audience health (frequency, reach) | `adadvisor:get_timeseries(entity_type='campaign')` |
| Pixel/CAPI health | `adadvisor:get_pixel_health` |
| Decisions made this week (kills, scales, launches) | Internal log |
| Forecast next week | Internal projection |

Report at the granularity the client cares about. SaaS clients want CPL by funnel stage; DTC clients want ROAS + AOV trend. Don't apply DTC reporting to a SaaS account or vice versa.

## Spend-pacing across the portfolio

Agencies typically have a total monthly budget commitment across all clients. Track:

```
For each account in the portfolio:
  adadvisor:get_performance(level='account', date_range='month_to_date')
  → confirm month-to-date spend vs target

Sum across portfolio:
  total_mtd_spend / total_mtd_target
  → should be ~1.0× at month-end; flag >1.1× or <0.9× mid-month
```

Per-account, the daily budget cap from the context resource (`business.daily_budget_cap`) is the hard ceiling. The MCP's `change_entity_budget` checks against the cap by default; pass `force=True` to override (with documentation in the client account).

## The agency edge — cross-account learning

The agency advantage that justifies the fee:

| Cross-account learning | Example |
|---|---|
| Creative concepts that worked elsewhere | A UGC angle that won for apparel client → test on beauty client |
| Bid-strategy switches that improved CPA | Tichenor's Cost Cap pattern, validated across 5 ecom accounts |
| Audience insights | LAL on top-25%-LTV seed outperforms all-purchaser seed (consistent across 8 clients) |
| Creative production cadence by vertical | Beauty needs 5-7 day refresh; furniture needs 14-day |
| Bid strategy by spend tier | Lowest Cost below $1K/day; Cost Cap diversification above $5K/day |

The discipline: validate the learning *in the new account's context*, don't transplant blindly. A bid strategy that works for a high-margin client may bankrupt a low-margin one.

## Common pitfalls (and what causes them)

| Pitfall | Cause | Fix |
|---|---|---|
| Applying one client's playbook to another | Forgot to re-read context | Always read context on account switch |
| Mismatched break-even ROAS assumptions | Assumed all DTC = 2.5× break-even | Read `business.break_even_roas` per client |
| Copying lookalike-seed quality | Client A has 50K LTV-tier customers; Client B has 200 | Check seed size before transferring strategy |
| Scaling Client B at Client A's velocity | Different audience sizes, different fatigue thresholds | Scale by audience capacity, not calendar pace |
| Running same creative across multiple client accounts | Cross-account attribution confusion + brand-confusion | One creative library per client |
| Mixing decision logs across accounts | Hard to remember which client did what | Per-account decision log in your CRM / Notion |

## The MCP's per-account isolation

Every tool call is scoped to one `account_id`. There's no implicit cross-account state. Concretely:

- `list_campaigns(account_id)` returns campaigns only for that account.
- A pixel from Account A cannot accidentally be referenced from Account B (the `pixel_id` is account-scoped via `list_ad_accounts`).
- Custom audiences belong to one account; sharing across accounts requires Business Manager-level Audience Sharing (in-app, not via MCP).
- Performance data is per-account; aggregating requires multiple `get_performance` calls and external rollup.

This isolation is a feature, not a limitation. It prevents the leakage that ruins multi-account work.

## A typical agency session

```
# Account 1: SaaS lead-gen
adadvisor:list_ad_accounts()
ReadMcpResourceTool('adadvisor://account/123/context')   # SaaS, target_cpl=$150
adadvisor:get_performance(level='campaign', date_range='last_7d')
# ... decisions ...

# Switch to Account 2: apparel DTC
ReadMcpResourceTool('adadvisor://account/456/context')   # DTC, break_even_roas=3.0
adadvisor:get_performance(level='campaign', date_range='last_7d')
# ... decisions ...

# Switch to Account 3: beauty subscription
ReadMcpResourceTool('adadvisor://account/789/context')   # Subscription, optimize for Subscribe event
adadvisor:get_performance(level='campaign', date_range='last_7d')
# Look at result_count + cost_per_result, NOT revenue/roas (subscription events)
# ... decisions ...
```

Every account switch starts with reading context. The 5 seconds spent re-reading is the difference between competent agency work and embarrassing cross-client mistakes.

## Reporting cadence — weekly + monthly

| Cadence | Output |
|---|---|
| Daily | Internal flag list (which accounts need attention) |
| Weekly | Per-client report (top-line + decisions) |
| Bi-weekly | Portfolio review (cross-account learning, MER trends) |
| Monthly | Strategic review with each client (forecast, budget, creative pipeline) |
| Quarterly | Win/loss postmortem; which playbooks worked; which accounts are profitable for the agency |

The MCP's data freshness (`data_synced` flag on `list_ad_accounts`, 30-min sync lag for read tools) is fine for weekly reporting. For real-time decisions during launches or BFCM, expect lag and decide whether to wait for the sync or accept brief uncertainty.

## Anti-patterns

- Switching accounts without re-reading context. Universal source of cross-client errors.
- Copying a playbook (e.g. ASC + manual structure) from one client to another without validating it fits.
- Running the same creative library across clients without per-client adaptation. Brand confusion + attribution mess.
- Treating MER targets as universal. A 3× MER is good for DTC; a 1.5× MER may be good for a low-margin furniture brand and bad for a high-margin beauty brand.
- Mixing client decision logs. Per-account log is non-negotiable.
- Skipping pixel-health checks per account in weekly audits. The most common silent failure across portfolios.
- Bulk-applying budget changes across multiple accounts without per-account validation against `business.daily_budget_cap`.

## References cited

- AdAdvisor MCP server: per-account isolation enforced via `account_id` on every tool call.
- Common Thread Collective on portfolio-management cadence (Taylor Holiday).
- Andrew Foxwell on cross-account learning discipline.
- Pilothouse on per-vertical playbook adaptation.
- AdAdvisor context resource: `business.break_even_roas`, `business.daily_budget_cap`, etc. as the per-account ground truth.
