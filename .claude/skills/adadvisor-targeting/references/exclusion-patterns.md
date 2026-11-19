## Exclusion patterns — every audience that should exclude X

Exclusions are not a feature, they're a default. Every ad set in a properly-structured account has at least one excluded audience. The patterns below cover the cases that come up every time.

The MCP exposes exclusions via the `excluded_custom_audiences` parameter on `adadvisor:create_adset` and `adadvisor:update_adset_targeting`. The parameter takes the same `TargetingEntry` shape (`{id, name}`) as `custom_audiences`.

## Prospecting exclusions (mandatory)

Every prospecting ad set excludes:

| Excluded audience | Why | Build it via |
|---|---|---|
| Purchasers 30-90 days | Prevent paying to re-acquire existing customers | `adadvisor:create_website_audience(event_name='Purchase', retention_days=90)` |
| Existing email subscribers | Email channel converts them cheaper than paid | (in-app) upload customer list |
| Active retargeting audience | Don't compete with your own retargeting in the auction | The Warm-1 audience or AddToCart audience |
| (Sometimes) Page/IG engagers 30D | Treat as warm; let engagement campaigns retarget them | (in-app) Meta engagement audience |

```
adadvisor:create_adset(
  name='Prospecting || Broad || US',
  optimization_goal='OFFSITE_CONVERSIONS',
  promoted_object={pixel_id, custom_event_type: 'PURCHASE'},
  countries=['US'], age_min=25, age_max=55,
  advantage_audience=true,
  excluded_custom_audiences=[
    {id: <purchasers_90d_id>, name: 'Purchasers 90D'},
    {id: <email_list_id>, name: 'Email Subscribers'},
    {id: <addtocart_30d_id>, name: 'AddToCart 30D'}
  ]
)
```

The minimum viable prospecting exclusion is **Purchasers 90D**. Forgetting this is the most common account audit finding (Foxwell, CTC, 2024-2025) — operators routinely pay to retarget existing customers as prospects, billing the cohort twice.

## Retargeting exclusions

Every retargeting ad set excludes:

| Excluded audience | Why |
|---|---|
| Purchasers 90D | Post-purchase users should get post-purchase messaging, not "complete your purchase" |
| Tighter retargeting layers | If you're showing the InitiateCheckout audience an ad, AddToCart users shouldn't also see it from the looser ad set |
| (For non-buyer flows) The buyers from the brand | Same logic — buyers already converted |

The chain (see [`retargeting-funnels.md`](retargeting-funnels.md) for full layout):

```
# AddToCart 30D ad set excludes Purchasers 90D + InitiateCheckout 30D
adadvisor:create_adset(
  custom_audiences=[{id: <atc_id>, name: 'AddToCart 30D'}],
  excluded_custom_audiences=[
    {id: <purchasers_id>, name: 'Purchasers 90D'},
    {id: <ic_id>, name: 'InitiateCheckout 30D'}
  ]
)

# ViewContent 60D ad set excludes Purchasers 90D + AddToCart 30D + InitiateCheckout 30D
adadvisor:create_adset(
  custom_audiences=[{id: <vc_id>, name: 'ViewContent 60D'}],
  excluded_custom_audiences=[
    {id: <purchasers_id>, name: 'Purchasers 90D'},
    {id: <atc_id>, name: 'AddToCart 30D'},
    {id: <ic_id>, name: 'InitiateCheckout 30D'}
  ]
)
```

Pattern: tighter layers go in the exclusion list of looser layers. A user always sees the tightest-intent retargeting message they qualify for, not multiple competing ones.

## ASC ↔ manual prospecting exclusions

When Advantage+ Shopping Campaign (ASC) runs alongside manual prospecting CBO, the two will cannibalize unless mutually excluded. Symmetric exclusion is mandatory.

### ASC excludes manual prospecting audience

ASC's "Existing Customer Cap" setting (typically 10-30%) caps how much of ASC's spend goes to existing customers. But this doesn't prevent overlap with manual prospecting *non-customers*. To prevent that:

- Build a custom audience representing the manual-prospecting audience (e.g. recent website visitors who weren't excluded by manual's own targeting).
- Exclude it on the ASC ad set:

```
adadvisor:update_adset_targeting(
  account_id, adset_id=<asc_adset>,
  excluded_custom_audiences=[
    {id: <manual_prospecting_audience>, name: '<name>'}
  ]
)
```

In practice, the cleaner pattern is the reverse:

### Manual prospecting excludes ASC's likely audience

Since ASC targets broadly, build a fast-decaying website audience that proxies ASC's reach (e.g. all PageView 7D) and exclude it on manual:

```
adadvisor:create_website_audience(
  name='Site Visitors 7D', retention_days=7, ...
)
# wait for populate
adadvisor:update_adset_targeting(
  account_id, adset_id=<manual_prospecting>,
  excluded_custom_audiences=[
    {id: <visitors_7d>, name: 'Site Visitors 7D'},
    {id: <purchasers_id>, name: 'Purchasers 90D'}
  ]
)
```

This concentrates manual prospecting on truly cold users while ASC handles the warm-leaning broad layer.

Without this exclusion, accounts running ASC + manual see 30-50% audience overlap and 15-25% CPM inflation.

## Brand-awareness campaign exclusions

Brand campaigns (objective `OUTCOME_AWARENESS` or `REACH`) reach *everyone*. They don't exclude purchasers, don't exclude retargeting, don't exclude email lists. The whole point is top-of-funnel reach.

```
adadvisor:create_adset(
  name='Brand || Awareness || US',
  optimization_goal='REACH',
  countries=['US'],
  # No exclusions. None.
)
```

The exception: if the brand campaign is on a tight budget for a specific cohort (e.g. lapsed-customer reactivation), exclude *current* customers via a "Purchasers 30D" audience.

## Lead-gen exclusions

Lead-gen ad sets exclude:

| Excluded audience | Why |
|---|---|
| Existing leads in CRM (uploaded list) | Don't pay to re-acquire leads you already have |
| Existing customers | Different funnel for upsell |
| Lead form openers (last 30d, no submit) | Optional — sometimes useful to exclude to focus on net-new traffic |

```
adadvisor:create_adset(
  optimization_goal='LEAD_GENERATION',
  destination_type='ON_AD',
  excluded_custom_audiences=[
    {id: <existing_leads>, name: 'Existing Leads'},
    {id: <existing_customers>, name: 'Existing Customers'}
  ]
)
```

The MCP doesn't restrict exclusions by objective — all `excluded_custom_audiences` are valid on `OUTCOME_LEADS` ad sets too.

## Geo + audience combined exclusions

When running multi-geo, exclude the audiences from one geo on the other to prevent the rare cross-geo overlap from logged-in mobile users:

```
# US ad set
adadvisor:create_adset(
  countries=['US'],
  excluded_custom_audiences=[{id: <ca_purchasers>, name: 'CA Purchasers'}]
)

# CA ad set
adadvisor:create_adset(
  countries=['CA'],
  excluded_custom_audiences=[{id: <us_purchasers>, name: 'US Purchasers'}]
)
```

This is paranoia-level discipline for most accounts but matters at scale ($10K+/day, multi-geo, where 1-2% cross-leakage is real money).

## What can be excluded

The `excluded_custom_audiences` parameter accepts:

- WEBSITE audiences (from `adadvisor:create_website_audience`)
- LOOKALIKE audiences (from `adadvisor:create_lookalike_audience`)
- CUSTOM audiences (uploaded customer lists)
- ENGAGEMENT audiences (Meta page/post/IG engagers, built in-app)
- IG_BUSINESS audiences (in-app)

It does NOT accept:

- Interest IDs (use `interests` field with empty array or rely on Advantage+ Audience)
- Demographic targeting (use `age_min`, `age_max`, `genders` to constrain)
- Geo (use `countries` to constrain — excluding a geo is via not including it)

## Verification

After updating exclusions, verify with `adadvisor:list_adsets` and inspect the returned `targeting.excluded_custom_audiences`:

```
adadvisor:list_adsets(account_id, fields=['name', 'targeting'])
```

The MCP echoes back `targeting_summary` with the resolved exclusion list — confirm the audiences you expect to exclude are present and that `delivery_status` on those audiences is "ready" (excluding a still-populating audience won't fully exclude until it's ready).

## Anti-patterns

- Excluding interests instead of audiences. Interest exclusions exist in Meta's UI but are deprecated for performance — Advantage+ Audience overrides them anyway. Use audience exclusions.
- Forgetting Purchasers 90D on prospecting. The single most common audit finding.
- Symmetric ASC ↔ manual exclusions missing. One side excludes, the other doesn't. Overlap continues.
- Excluding a purchaser audience that's only 14 days deep — too short. Some users buy on day 30. Standard is 90 days; tighter is OK for fast-cycle products (consumables) but not for considered purchases.
- Excluding everything: a list of 10 audiences as exclusions on a prospecting ad set. Each exclusion narrows the deliverable audience; over-excluding can leave Meta nothing to deliver to.
- Building the exclusion audience but not waiting for populate. A still-populating exclusion audience excludes nothing.

## References cited

- Andrew Foxwell, account-audit prose on "Purchasers 90D exclusion" as the universal default.
- Common Thread Collective on ASC ↔ manual exclusion patterns.
- Meta documentation on `excluded_custom_audiences` API parameter.
- Triple Whale (Maxwell Sinclair) on overlap-cost quantification, 2025.
