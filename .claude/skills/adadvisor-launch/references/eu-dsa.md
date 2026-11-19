## EU DSA — `dsa_beneficiary` and `dsa_payor`

The EU Digital Services Act (DSA) requires every ad targeting EU users to disclose **who benefits** from the ad and **who pays** for it. Meta enforces this at the ad-set level. Missing either field on an EU-targeted ad set triggers rejection with subcode **3858079** (missing beneficiary) or **3858081** (missing payor).

This reference encodes the geographic scope detection, the auto-population behavior, the format requirements, and worked examples of valid strings.

## The two fields

| Field | What it means | Format | Max length |
|---|---|---|---|
| `dsa_beneficiary` | The brand / business that benefits from the ad (typically the advertiser) | Free-form string | 512 chars |
| `dsa_payor` | The legal entity paying Meta for the ad spend (often the same as beneficiary, sometimes an agency) | Free-form string | 512 chars |

Both are mandatory on EU-targeted ad sets. Both are passed at the **ad-set level**, not campaign or ad level.

## Geographic scope — when DSA applies

An ad set is "EU-targeted" if the `targeting.countries` array contains any of these ISO codes:

```
AT — Austria        IT — Italy
BE — Belgium        LV — Latvia
BG — Bulgaria       LT — Lithuania
HR — Croatia        LU — Luxembourg
CY — Cyprus         MT — Malta
CZ — Czech Republic NL — Netherlands
DK — Denmark        PL — Poland
EE — Estonia        PT — Portugal
FI — Finland        RO — Romania
FR — France         SK — Slovakia
DE — Germany        SI — Slovenia
GR — Greece         ES — Spain
HU — Hungary        SE — Sweden
IE — Ireland
```

EEA/EFTA (Iceland `IS`, Norway `NO`, Liechtenstein `LI`) — Meta sometimes applies DSA-like rules; set fields anyway.

Regional sub-targets (`regions`, `cities`) that resolve to an EU country also trigger the requirement. The MCP checks both `countries` and regional country codes.

UK (`GB`) is NOT in scope for the EU DSA, but the UK Online Safety Act has comparable disclosure rules. Setting `dsa_*` for UK is harmless and forward-compatible.

## How the MCP populates these

The AdAdvisor MCP server **auto-populates** `dsa_beneficiary` and `dsa_payor` from the ad account's defaults when:

1. The user has set DSA defaults in Meta Business Manager (or in the AdAdvisor app's account settings).
2. The agent omits the fields on `create_adset`.

If the account has no DSA defaults set AND the agent omits the fields AND the ad set targets the EU, the MCP rejects the call with a clear error message before contacting Meta. The agent should then either:

- Ask the user to set DSA defaults in the AdAdvisor app, OR
- Ask the user for the beneficiary and payor strings to pass explicitly.

Asking the user once and reusing is the right pattern — DSA strings are usually account-level constants, not per-campaign.

## Valid beneficiary / payor strings

The strings are free-form but should clearly identify the legal entity. Examples:

| Scenario | `dsa_beneficiary` | `dsa_payor` |
|---|---|---|
| DTC brand running its own ads | `Example Cosmetics Ltd.` | `Example Cosmetics Ltd.` |
| Brand using an agency to manage spend | `Example Cosmetics Ltd.` | `Acme Performance Marketing GmbH` |
| Multi-brand parent paying for one of its brands | `Example Cosmetics (a Parent Holdings Co. brand)` | `Parent Holdings Co.` |
| White-label / dropshipper | `Example Shop` | `Example Shop, owned by Founder Name` |
| Charity / non-profit | `Example Foundation, registered charity #12345` | `Example Foundation` |
| Public listing — need clarity | `Example PLC (Ticker: EXMPL)` | `Example PLC` |

The strings appear in Meta's Ad Library when EU users click "Why am I seeing this ad?" — they should be readable, not just legal boilerplate.

## What NOT to put in these fields

- Empty strings — Meta rejects.
- Generic placeholders like `"Brand"` or `"Advertiser"` — technically accepted but defeats the purpose; DSA inspectors flag.
- URLs — these are name fields, not link fields. URLs go in the ad's `link`.
- More than 512 chars — Meta truncates and may reject.
- Different languages mid-string unnecessarily — pick one (typically the legal-entity registration language).

## Worked launch example

Agent is launching a campaign for "Example Cosmetics" targeting Germany, France, Netherlands. Account context shows:

```
business.name = "Example Cosmetics Ltd."
business.dsa_beneficiary = "Example Cosmetics Ltd."  # from account defaults
business.dsa_payor = "Example Cosmetics Ltd."
```

The MCP will auto-populate. The agent's `create_adset` call can omit the fields:

```
adadvisor:create_adset(account_id, adsets=[{
  campaign_id: <id>,
  countries: ['DE', 'FR', 'NL'],
  daily_budget: 200,
  ...
  // dsa_beneficiary and dsa_payor omitted → server fills from defaults
}])
```

If the account has no defaults, the agent must pass them:

```
adadvisor:create_adset(account_id, adsets=[{
  campaign_id: <id>,
  countries: ['DE', 'FR', 'NL'],
  daily_budget: 200,
  dsa_beneficiary: "Example Cosmetics Ltd.",
  dsa_payor: "Acme Performance Marketing GmbH",
  ...
}])
```

## Detecting EU targeting in the launch flow

In the launch checklist, after assembling targeting, run:

```
EU_COUNTRIES = {'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'}

if set(targeting.countries or []) & EU_COUNTRIES:
    require_dsa_fields()
```

If EU targeting is detected, branch the launch flow to confirm DSA defaults exist OR collect from user.

## The errors you'll see

| Subcode | Message | Fix |
|---|---|---|
| 3858079 | DSA Beneficiary is required | Pass `dsa_beneficiary` (or set account default) |
| 3858081 | DSA Payor is required | Pass `dsa_payor` (or set account default) |

These typically come together. If you see one, the other is also missing — pass both at once.

## Updating DSA fields on a live ad set

`adadvisor:update_entity` accepts `dsa_beneficiary` and `dsa_payor` for updates. Unlike most ad-set edits, DSA field changes do NOT reset learning — they're metadata, not auction parameters. Useful when:

- Agency relationship changes mid-campaign (payor changes).
- Brand renames or restructures (beneficiary changes).
- Account-level DSA defaults change and you want to align live ad sets.

## Anti-patterns

- Hardcoding DSA strings into agent prompts instead of reading from the user's account defaults — leads to stale values when the user's legal entity changes.
- Targeting EU + omitting DSA + assuming the error will be helpful — Meta's error message is generic; subcodes are the diagnostic signal.
- Setting `dsa_beneficiary = dsa_payor` when an agency is paying — incorrect legally; the payor is the entity issuing payment to Meta.
- Setting DSA on UK-only ad sets — currently unnecessary, though forward-compatible. The UK has its own framework.
- Using emoji or special Unicode in DSA strings — Meta sometimes rejects on character validation; stick to printable ASCII unless the legal name requires accents.

## Cross-references with creative

DSA fields apply at the ad set level and persist across all ads in that ad set. You don't need to set them on creatives or ads. If an ad set's geo targeting changes from US-only to EU-inclusive via `update_adset_targeting`, the DSA requirement activates retroactively — pre-empt this by always setting DSA fields up front for any account that might target the EU.

## See also

- [`./launch-checklist.md`](./launch-checklist.md) — includes the EU detection step.
- [`./conversion-domain.md`](./conversion-domain.md) — another Meta-mandatory field with subcode rejections.
- [`./structure-decisions.md`](./structure-decisions.md) — EU-only campaigns sometimes get their own structure for clean DSA accounting.
