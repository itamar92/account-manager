## Lead-gen account setup — end to end

Meta lead-gen is a different operational beast from ecom: the optimization event isn't Purchase, the form quality is the main lever for ROI, and the platform's on-Meta lead forms are notoriously lower-quality than CRM-fired CAPI events. This playbook covers the full setup, the form-quality discipline, and the campaign-structure consensus that emerged on Reddit's /r/FacebookAds and from senior B2B buyers in 2025.

## The setup sequence

Seven steps, all routed through the MCP.

### Step 1 — Verify Page permissions

The Page running the ad must have both `ADVERTISE` and `MANAGE_LEADS` tasks. Missing `MANAGE_LEADS` is the most common pre-flight failure.

```
adadvisor:list_pages(account_id)
```

Look for each Page in the response with the `tasks` array — confirm `ADVERTISE` and `MANAGE_LEADS` are both listed. If `MANAGE_LEADS` is missing, the Page admin needs to grant it in Business Manager. The MCP cannot grant Page permissions.

### Step 2 — Build the lead form

```
adadvisor:create_lead_form(
  account_id,
  page_id=<from list_pages>,
  name='Internal form name',
  questions=[
    {type: 'EMAIL'},
    {type: 'FULL_NAME'},
    {type: 'PHONE'},
    {type: 'CUSTOM', label: 'Company name', key: 'company'},
    {type: 'CUSTOM', label: 'Team size', key: 'team_size', options: ['1-10', '11-50', '51-200', '200+']}
  ],
  privacy_policy_url='https://yourdomain.com/privacy',  # MANDATORY
  follow_up_action_url='https://yourdomain.com/thanks', # REQUIRED — see note
  intro_headline='Get the demo',
  intro_description='See how it works in 15 minutes.',
  thank_you_screen={...}
)
```

**Critical undocumented requirement:** `follow_up_action_url` is required. Meta returns subcode `1892085` ("missing required parameter") if it's omitted, even though the official documentation lists it as optional. Always set it.

Privacy policy URL is officially mandatory — Meta will reject the form without it. Use the user's actual privacy policy URL; do not invent one.

### Step 3 — Create the campaign

```
adadvisor:create_campaign(
  account_id,
  name='Lead Gen || Demo || US',
  objective='OUTCOME_LEADS',
  status='PAUSED'
)
```

`OUTCOME_LEADS` is the only correct objective for on-Meta lead forms. Other objectives won't accept `lead_gen_form_id` on the creative.

### Step 4 — Create the ad set

```
adadvisor:create_adset(
  account_id,
  campaign_id=<from step 3>,
  name='LeadGen || Broad || US',
  optimization_goal='LEAD_GENERATION',
  destination_type='ON_AD',  # critical — keeps the form on Meta
  countries=['US'],
  age_min=25, age_max=55,
  advantage_audience=true,
  daily_budget=50.0
)
```

`destination_type='ON_AD'` ensures the form opens on Meta (instant form). The alternative `'WEBSITE'` would route to a landing page — different campaign type.

`optimization_goal='LEAD_GENERATION'` optimizes on form completions. If you have CRM-fired CAPI optimized for `Lead Submitted` or `MQL`, use `optimization_goal='OFFSITE_CONVERSIONS'` with the appropriate `promoted_object` instead — see Step 8 below.

### Step 5 — Create the creative

```
adadvisor:create_creative(
  account_id,
  page_id=<from list_pages>,
  format='image_link',  # or 'video'
  name='LeadGen creative — demo offer',
  body='See how it works in 15 minutes.',
  message='Get a personalized demo of the platform.',
  link='http://fb.me/',  # MCP auto-overrides; form lives on Meta
  lead_gen_form_id=<from step 2>,
  call_to_action_type='SIGN_UP',  # or 'LEARN_MORE', 'GET_QUOTE'
  image_hash=<from upload_ad_image>  # or video_id for format='video'
)
```

The MCP auto-overrides `link` to `http://fb.me/` for lead-gen creatives — the form opens on Meta, not at a URL. Trying to set a real URL will produce a confusing creative.

`call_to_action_type='SIGN_UP'` is the standard. Alternatives: `'LEARN_MORE'` (softer), `'GET_QUOTE'` (B2B), `'APPLY_NOW'` (recruiting), `'SUBSCRIBE'` (newsletter).

### Step 6 — Create the ad

```
adadvisor:create_ad(
  account_id,
  adset_id=<from step 4>,
  name='LeadGen ad — demo offer v1',
  creative={creative_id: <from step 5>}
)
```

No `conversion_domain` needed — the form is on Meta, not on the advertiser's domain.

### Step 7 — Activate from leaf up

```
adadvisor:change_entity_status(entity_type='ad', entity_id=<ad>, action='resume')
adadvisor:change_entity_status(entity_type='adset', entity_id=<adset>, action='resume')
adadvisor:change_entity_status(entity_type='campaign', entity_id=<campaign>, action='resume')
```

Status invariant: all `create_*` calls return PAUSED. You must resume each level.

## Form quality — the main ROI lever

Meta lead forms are infamous for low-quality leads when forms are too easy. The senior B2B buyer's discipline:

| Lever | Trade-off |
|---|---|
| Fields beyond email/name (2-3 minimum) | Reduces volume 30-50%, doubles quality |
| Custom qualifying questions with options | Filters tire-kickers; sales team only sees real prospects |
| Higher-intent CTA (`'GET_QUOTE'` vs `'LEARN_MORE'`) | Lower form-open rate, higher submit-to-MQL rate |
| Review screen before submit | Reduces accidental submits by ~15% |
| Real privacy policy + business explanation in intro | Slows down impulse submits; quality up |

The volume-vs-quality trade-off is real. Most accounts start with too-easy forms ("just email") and discover their SDR team is burning hours on garbage leads. The fix: add 2-3 qualifying fields and accept the 30% volume drop.

## The Reddit /r/FacebookAds consolidated playbook (August 2025)

A late-2025 consensus emerged on r/FacebookAds for inbound B2B lead-gen:

| Element | Setting |
|---|---|
| Campaigns | 1 consolidated campaign per offer (not per audience) |
| Ad sets | 1 broad ad set (Advantage+ Audience on) |
| Creatives | 5-8 distinct concept angles |
| Targeting | Broad — let creative qualify |
| Optimization | Optimize for deepest CRM event firing >25 times/week |
| Bid strategy | Lowest Cost for first 14 days |
| Budget | $100+ /day per ad set (below this, learning is unreliable) |
| Exclusions | Existing leads (CRM list), existing customers |

This converges with the broad-first DTC consensus — see [`adadvisor-targeting/references/broad-vs-detailed.md`](../../adadvisor-targeting/references/broad-vs-detailed.md). The targeting and structural mechanics are the same; what differs is the optimization event.

## CRM-fired CAPI — the discipline gate

The single biggest quality lever for lead-gen accounts is *what event you optimize for*.

| Optimization event | What Meta learns | Lead quality |
|---|---|---|
| `LEAD_GENERATION` (on-Meta form submit) | Who submits forms | Low-medium (form-fillers) |
| `Lead Submitted` (CRM CAPI, all submits) | Same as above, with CRM data | Same |
| `MQL` (CRM CAPI, after qualification) | Who passes SDR screen | Medium-high |
| `Demo Scheduled` (CRM CAPI) | Who actually books a demo | High |
| `SQL` / `Opportunity Created` (CRM CAPI) | Who converts to sales process | Very high |
| `Won Deal` (CRM CAPI) | Who actually pays | Highest — but rarely fires >25/wk |

The constraint: Meta needs ≥25 events/week to optimize cleanly. If `Won Deal` fires only 5/week, optimize on the next-deepest event that fires ≥25/week (often `MQL` or `Demo Scheduled`).

CRM-fired CAPI requires server-side integration outside the MCP — HubSpot, Salesforce, etc. Confirm CAPI is firing via `adadvisor:get_pixel_health` (look for non-Meta source breakdown).

```
adadvisor:get_pixel_health(account_id, pixel_id=<from list_ad_accounts>)
# Inspect 'source_breakdown': browser/server/system_generated counts
# Healthy lead-gen: server source ≥ 50% of qualifying events
```

If CAPI isn't firing, the lead-gen campaign will optimize on the on-Meta form submit — which is the lowest-quality event. Many "high-volume low-quality" complaints trace to this gap.

## Cost-per-lead math

```
target_CPL = (lead_to_customer_rate × deal_value × gross_margin) / desired_payback_months
```

Example: 5% lead-to-customer rate, $5,000 deal value, 60% margin, 6-month payback:

```
target_CPL = (0.05 × $5000 × 0.60) / 6 ≈ $150 over 6 months of revenue per customer per month
            ≈ $150 per lead acceptable
```

If `business.target_cpl` is set on the AdAdvisor context resource, use it. Otherwise ask the user.

Kill thresholds: kill at 1.5× target CPL over 3 days with ≥10 leads. Hold at target × 1.0-1.3. Scale at ≤0.9× target over 3 days.

## Anti-patterns

- Lead forms with only email and name. High volume, terrible quality, SDR team burns out.
- Optimizing for on-Meta `LEAD_GENERATION` without CAPI. Volume comes; quality doesn't.
- Per-audience ad sets in lead-gen. Lead-gen is a "1 broad ad set + creative diversity" game like ecom.
- Forgetting `follow_up_action_url`. Subcode 1892085 will block form creation.
- Using a real landing-page URL on the creative `link` parameter for an on-Meta form. The form short-circuits the URL; user lands on Meta.
- Missing `MANAGE_LEADS` permission on the Page. Form creation fails or leads can't be downloaded.
- Skipping CRM/CAPI integration. The biggest single quality lift in lead-gen lives in optimizing for the right downstream event.
- Treating Meta's `leads` count as the KPI when the campaign optimizes for an off-Meta CAPI event. Use `result_count` from `adadvisor:get_performance` — see [`/kpi-decoder.md`](../../adadvisor/references/kpi-decoder.md).

## References cited

- /r/FacebookAds consolidated B2B lead-gen playbook (August 2025).
- Meta documentation on Lead Ads (objectives, `destination_type`, `lead_gen_form_id`).
- Common Thread Collective on B2B lead-gen optimization events.
- HubSpot + Salesforce CAPI integration guides (2024-2025).
- AdAdvisor MCP server: `create_lead_form` subcode-1892085 handling.
