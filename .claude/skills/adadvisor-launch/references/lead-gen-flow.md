## Lead-gen launch — the full sequence

Lead-gen launches differ structurally from sales launches: they require a Meta Lead Form, a Page with the right permissions, specific destination type on the ad set, and a `lead_gen_form_id` on the creative. This reference encodes the seven-step sequence, the lead form schema, and the quality-filter pattern that separates real leads from spam.

## The seven-step sequence

```
1. list_pages         → confirm ADVERTISE + MANAGE_LEADS tasks
2. create_lead_form   → get lead_gen_form_id
3. create_campaign    → OUTCOME_LEADS objective
4. create_adset       → LEAD_GENERATION optimization, ON_AD destination
5. create_creative    → lead_gen_form_id attached, SIGN_UP CTA
6. create_ad          → creative_id, conversion_domain omitted
7. change_entity_status × 3 → activate campaign → adset → ad
```

Each step has a gate. Skip a gate and Meta rejects (subcode 1892085 for missing follow-up URL, generic errors for missing tasks on Page).

## Step 1 — `list_pages`

Lead forms attach to Pages. The Page must have two permissions the user (or their token) holds:

- **ADVERTISE** — required to run ads from the Page.
- **MANAGE_LEADS** — required to access submitted leads.

```
adadvisor:list_pages(account_id=<id>)
```

Response includes per-Page `tasks` array. Filter to Pages where `tasks` includes both. If the user's Page lacks `MANAGE_LEADS`, the form will create but submitted leads will be inaccessible. Surface this before proceeding:

> "The Page 'Example Cosmetics' has ADVERTISE but not MANAGE_LEADS. You'll be able to run lead-gen ads but won't be able to read submitted leads via the API. Want me to continue anyway, or fix permissions in Meta Business Manager first?"

## Step 2 — `create_lead_form`

Build the form. Required fields:

- `name` — internal form name.
- `page_id` — from step 1.
- `locale` — `'en_US'`, `'en_GB'`, `'de_DE'`, etc.
- `privacy_policy` — `{url, link_text}`. URL mandatory.
- **`follow_up_action_url`** — mandatory but undocumented. Meta subcode **1892085** if omitted. Redirect URL post-submit.
- `questions` — array (see below).
- `thank_you_page` — optional, recommended.

```
adadvisor:create_lead_form(account_id, lead_forms=[{
  page_id: '<page_id>',
  name: 'Q2 Demo Request - Enterprise',
  locale: 'en_US',
  privacy_policy: {
    url: 'https://example.com/privacy',
    link_text: 'Privacy Policy'
  },
  follow_up_action_url: 'https://example.com/thank-you',
  questions: [...]
}])
```

The response includes `lead_gen_form_id` — capture for step 5.

## Lead form question schema

| `type` | Captures | Pre-fills? |
|---|---|---|
| `FULL_NAME` / `FIRST_NAME` / `LAST_NAME` | Name | Yes |
| `EMAIL` | Email | Yes |
| `PHONE` | Phone with country code | Yes |
| `CUSTOM` | Free-text or multi-choice; requires `key` | No |
| `DATE_TIME` | Date/time picker | No |
| `STORE_LOOKUP` | Nearest store | No |
| `ID_CPR`, `ID_AR_ID`, etc. | Country-specific IDs (DK, UAE, etc.) | No |

Pre-filled = high completion (25-45%), lower quality. Custom = lower completion, higher quality.

## The quality filter — 2-3 fields beyond email

Pre-filled email-only forms hit 25-45% completion but close rates of 5-12% (high-volume spam). Adding 2-3 custom questions drops completion to 8-15% but raises close rates to 18-35%. Net: similar revenue, far fewer junk leads.

Canonical quality filter:

```json
"questions": [
  {"type": "FULL_NAME"},
  {"type": "EMAIL"},
  {"type": "PHONE"},
  {"type": "CUSTOM", "key": "company_size", "label": "Company size",
   "options": [{"value": "1-10"},{"value": "11-50"},{"value": "51-200"},{"value": "201+"}]},
  {"type": "CUSTOM", "key": "timeline", "label": "When are you looking to start?",
   "options": [{"value": "Immediately"},{"value": "1-3 months"},{"value": "3-6 months"},{"value": "Researching"}]}
]
```

Each custom question reduces volume ~30% but lifts close rate ~2×. Recommend quality forms unless the user explicitly wants pre-filled volume.

## Step 3 — `create_campaign`

Standard create with `objective: 'OUTCOME_LEADS'`. No special params.

```
adadvisor:create_campaign(account_id, campaigns=[{
  objective: 'OUTCOME_LEADS',
  name: 'Enterprise Demo - Q2 - LeadGen',
  buying_type: 'AUCTION',
  spend_cap: 5000.0
}])
```

## Step 4 — `create_adset`

The lead-gen ad set has two distinguishing fields:

- `optimization_goal: 'LEAD_GENERATION'` — optimize for form submits.
- `destination_type: 'ON_AD'` — the form opens inside Meta, not on the advertiser's site.

```
adadvisor:create_adset(account_id, adsets=[{
  campaign_id: <id>,
  name: 'Enterprise - LAL3 - LeadGen',
  daily_budget: 200,
  countries: ['US'],
  age_min: 25, age_max: 65,
  optimization_goal: 'LEAD_GENERATION',
  destination_type: 'ON_AD',
  billing_event: 'IMPRESSIONS',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  promoted_object: {page_id: '<page_id>'},
  custom_audiences: [<lal_id>]
}])
```

Notes:

- `promoted_object` for lead-gen takes `page_id`, not pixel.
- DSA fields apply if targeting EU. See [`./eu-dsa.md`](./eu-dsa.md).
- Minimum daily budget formula still applies: `(target_CPL × 50) / 7`.

## Step 5 — `create_creative`

The lead-gen creative attaches the `lead_gen_form_id` and uses `SIGN_UP` (or `APPLY_NOW`, `LEARN_MORE`) as CTA.

```
adadvisor:create_creative(account_id, creatives=[{
  page_id: '<page_id>',
  format: 'image_link',
  image_hash: '<hash>',
  message: 'See how our platform helps enterprise teams reduce CAC by 40%.',
  headline: 'Book a 15-min demo',
  description: 'No credit card required',
  call_to_action_type: 'SIGN_UP',
  lead_gen_form_id: '<from_step_2>',
  link: 'https://example.com/demo'  // shown but tap opens form
}])
```

The `link` field is required even though the lead form opens in-Meta. Meta uses it for click-through fallback and for users who tap the headline rather than the CTA button.

## Step 6 — `create_ad`

The ad is straightforward. **`conversion_domain` is NOT required** for lead-gen with on-ad form — the conversion happens on Meta's surface.

```
adadvisor:create_ad(account_id, ads=[{
  adset_id: <id>,
  creative_id: <from_step_5>,
  name: 'Enterprise - Hook A - LAL3'
  // conversion_domain omitted — lead-gen on-ad form
}])
```

## Step 7 — Activate

Standard three-level activation:

```
adadvisor:change_entity_status(entity_type='campaign', entity_ids=[<id>], action='resume')
adadvisor:change_entity_status(entity_type='adset', entity_ids=[<id>], action='resume')
adadvisor:change_entity_status(entity_type='ad', entity_ids=[<id>], action='resume')
```

## Post-launch — CAPI for the real optimization

Meta optimizes by default on form-submit, which spammers can flood. The fix: fire a CRM-side qualified-lead event via Conversions API (CAPI). Examples: "Lead qualified" (sales marks), "Demo scheduled" (booking made), "Opportunity created" (CRM stage).

Setup is outside MCP (CRM webhook → CAPI mapping). After 30 days on form-submit optimization, switch the ad set to the CRM-fired event. Typical shift: halves volume, doubles close rate, +50-100% customer revenue per dollar. Plan for 5-10 day re-learning when switching.

## Lead retrieval

Submitted leads flow into the AdAdvisor app or user's CRM (Zapier/Make/native integration) outside the MCP. The MCP doesn't expose a `get_leads` tool.

For "how many leads," use `adadvisor:get_performance(level='adset')` → `result_count`. For lead detail (names, contact info), point at their CRM or the AdAdvisor app UI.

## Worked example — B2B SaaS demo-request launch

```
1. list_pages → Page has [ADVERTISE, MANAGE_LEADS] ✓
2. create_lead_form(page_id, name='Acme - Demo - Q2', locale='en_US',
     privacy_policy={url, link_text},
     follow_up_action_url='https://acme.com/thank-you',
     questions=[FULL_NAME, EMAIL, CUSTOM(company_size), CUSTOM(role)])
   → lead_gen_form_id
3. create_campaign(OUTCOME_LEADS) → campaign_id
4. create_adset(LEAD_GENERATION, ON_AD, page_id) → adset_id
5. create_creative(lead_gen_form_id, SIGN_UP) → creative_id
6. create_ad(creative_id) → ad_id
7. Activate campaign → adset → ad.
```

## Anti-patterns

- Skipping `follow_up_action_url` because docs don't mention it — Meta subcode 1892085. Always set.
- Pre-filled-only forms (just FULL_NAME + EMAIL) optimizing on form-submit — junk leads volume, low close rate.
- Optimizing on form-submit forever — switch to CRM-fired CAPI event after 30 days.
- Forgetting `destination_type: 'ON_AD'` — the form won't open inside Meta; ad goes to a useless link.
- Passing `conversion_domain` on lead-gen-on-ad ads — Meta accepts but ignores; no harm but no point.
- Asking the user "what's your lead form ID" instead of creating one — most users have never used the API; create on their behalf.

## See also

- [`./launch-checklist.md`](./launch-checklist.md) — includes lead-gen branch boxes.
- [`./bid-strategies.md`](./bid-strategies.md) — COST_CAP works well for lead-gen target_CPL enforcement.
- [`./eu-dsa.md`](./eu-dsa.md) — required if targeting EU.
- The `adadvisor` foundation skill's `references/economics.md` — target_CPL math for lead-gen.
