## 2026 Meta structure rules by vertical

The right account structure is the second-largest performance lever after creative — and the most underrated. A well-structured account with mediocre creative outperforms a chaotic account with great creative because Meta's optimizer needs **conversion concentration** to learn. This reference codifies the 2026 consensus from Foxwell, Tichenor, Faris, Common Thread Collective, Motion, and Pilothouse on how to structure by vertical.

## The universal rules (apply to every vertical)

1. **Fewer, bigger ad sets > many small ones.** Meta needs 50 conversions per 7 days per ad set to exit learning. Each undersized ad set is a permanent noise floor.
2. **CBO (Campaign Budget Optimization) at scale; ABO (Ad Set Budget Optimization) for testing.** CBO lets Meta reallocate across ad sets in-flight — better for proven structures. ABO gives each ad set a fixed budget — better when you're isolating learnings.
3. **One ad set per audience type per campaign.** Splitting "broad" into three identical broad ad sets fragments learning and inflates internal competition.
4. **3-6 distinct creative concepts per ad set.** Below 3, no rotation testing. Above 6, no one ad gets enough impressions to read.
5. **Always exclude purchasers from prospecting.** All-time purchaser custom audience in every prospecting ad set's `excluded_custom_audiences`.
6. **Naming convention enforced from day one.** Pattern: `{client} || {budget_type} || {funnel} || {strategy} || {geo} || {date}`. Grepable, sortable, auditable.

## DTC ecom (e.g. apparel, skincare, supplements, food, household)

The most common vertical; the templates below are battle-tested.

### Account skeleton

```
Campaign 1: PROSPECTING (CBO) — $X/day
  ├─ Ad set 1: Broad / Advantage+ audience
  ├─ Ad set 2: Lookalike 1-5%
  └─ (Optional) Ad set 3: Interest stack

Campaign 2: PROSPECTING — ASC (Advantage+ Sales Campaign)
  └─ (no ad sets — ASC manages internally)
       Excludes: prospecting audience from Campaign 1

Campaign 3: RETARGETING (CBO) — $Y/day
  ├─ Ad set 1: ViewContent 30d / 60d / 90d (warmer)
  └─ Ad set 2: AddToCart / Initiate Checkout (warmest)
       Excludes: 180-day purchasers

Campaign 4: TESTING (ABO) — small budget per ad set
  └─ Ad set 1: New creative concept #1
  └─ Ad set 2: New creative concept #2
       (Promote winners to Campaign 1)
```

- 1-2 prospecting campaigns + 1 retargeting + 1 testing
- 1-3 ad sets per prospecting campaign
- 2-4 ad sets per retargeting campaign
- 3-6 distinct creative concepts per ad set

### Budget math

Per Andrew Foxwell's 2026 framework: each ad set's daily budget must cover the **exit-learning threshold**:

```
min_daily_budget = (target_CPA × 50) / 7
```

Worked: target CPA $30 → $30 × 50 / 7 = **$214/day minimum per ad set** to exit learning within a week. Below that, learning never finishes, performance fluctuates wildly, decisions are noise-based.

If account budget can't support 3 ad sets at $214/day = $642/day prospecting, **collapse to fewer ad sets**, not smaller ones. Two ad sets at $300/day each beats four at $150/day each.

### Naming

```
{CLIENT} || PRO || TOF || BROAD || US-CA || 2026-05-12
{CLIENT} || PRO || TOF || LAL1-5 || US || 2026-05-12
{CLIENT} || PRO || MOF || VC30 || US || 2026-05-12   (retargeting view-content 30d)
{CLIENT} || PRO || BOF || ATC60 || US || 2026-05-12  (retargeting add-to-cart 60d)
```

Abbreviations: `TOF` = top of funnel (prospecting), `MOF` = middle (warm retargeting), `BOF` = bottom (hot retargeting). `LAL` = lookalike. `VC` / `ATC` / `IC` = ViewContent / AddToCart / InitiateCheckout audience.

## Lead-gen (e.g. real estate, financial services, education, B2B services with mid-AOV)

Lead-gen flips the math from ROAS to CPL. Structure follows similar principles but with on-platform lead forms preferred for iOS / Safari signal capture.

### Account skeleton

```
Campaign 1: LEAD-GEN (CBO, objective=OUTCOME_LEADS)
  ├─ Ad set 1: Broad / Advantage+ — lead form preferred over offsite redirect
  ├─ Ad set 2: Lookalike from past leads (1-3%)
  └─ Ad set 3: Interest stack relevant to the offer

Campaign 2: RETARGETING (CBO)
  ├─ Ad set 1: Website 30d retargeting
  └─ Ad set 2: Engagement (page, IG) 90d
       Excludes: existing customers / disqualified leads

Campaign 3: TESTING (ABO) — creative + offer testing
```

### Budget math

```
min_daily_budget = (target_CPL × 50) / 7
```

Worked: target CPL $40 → $40 × 50 / 7 = **$286/day per ad set minimum**. Lead-gen typically has higher target CPL than ecom CPA, so the budget threshold runs higher.

### Key differences from ecom

- **On-platform Lead Forms** (via `adadvisor:create_lead_form`) outperform offsite landing pages on iOS by 30-50% (Tichenor 2026) because they don't lose tracking signal at the redirect.
- **Lead quality varies** — high-volume lead-gen with low form friction can produce unqualified leads. Add 2-3 qualifying questions to the form, or pair with a CRM-based "qualified lead" Custom Conversion.
- **No retargeting purchase exclusion** — instead, exclude existing customers and disqualified leads (uploaded as Custom Audience).
- Lead-form audiences (people who opened, submitted, didn't submit) become high-quality retargeting seeds.

### Naming

```
{CLIENT} || LEAD || TOF || BROAD-LF || US || 2026-05-12   (LF = on-platform Lead Form)
{CLIENT} || LEAD || TOF || LAL1-3 || US || 2026-05-12
{CLIENT} || LEAD || MOF || WEB30 || US || 2026-05-12
```

## B2B (enterprise software, services with high AOV / long sales cycle)

B2B inverts several DTC assumptions: smaller addressable audiences, longer attribution windows, retargeting weighted more heavily than prospecting.

### Account skeleton

```
Campaign 1: PROSPECTING — Job titles / industries / company size
  ├─ Ad set 1: Decision-makers in target industries (LinkedIn-style targeting via Meta)
  ├─ Ad set 2: Lookalike from customer list (1-3%)

Campaign 2: RETARGETING TIER 1 — High intent (pricing page, demo request page visits)
  ├─ Ad set 1: Pricing page visitors 30d
  └─ Ad set 2: Demo request abandoners 90d

Campaign 3: RETARGETING TIER 2 — Mid intent (blog, content downloads)
  └─ Ad set 1: Blog visitors / content downloaders 180d

Campaign 4: ABM (Account-Based Marketing) — Upload list of target companies via custom audience
  └─ Ad set 1: Named accounts only
```

- 1 prospecting + 2-3 retargeting tiers + 1 ABM is normal for B2B
- Audiences are smaller (often 200K-2M) — frequency caps matter; refresh creative every 14 days
- Attribution windows: extend to 28-day click if Meta exposes it; B2B sales cycles run 60-180 days, Meta default 7-day under-attributes

### Budget math

CPL targets often $100-500 for B2B. At $300 CPL × 50 / 7 = **$2,143/day per ad set** to exit learning. Most B2B accounts can't fund that across multiple ad sets, so:

- Consolidate to 1-2 prospecting ad sets per campaign
- Use ABO at $500-1000/day per ad set, accept extended learning phase
- Lean on retargeting (smaller audiences, lower CPL, faster learning)

### Naming

```
{CLIENT} || B2B || PRO || TITLES-SAAS || NA || 2026-05-12
{CLIENT} || B2B || RET-T1 || PRICING30 || NA || 2026-05-12
{CLIENT} || B2B || ABM || FORTUNE500 || NA || 2026-05-12
```

## App promotion (iOS + Android)

App campaigns require **separate iOS and Android campaigns** due to platform differences and SKAdNetwork constraints.

### Account skeleton

```
Campaign 1: APP-IOS — objective=APP_PROMOTION, SKAdNetwork enabled
  ├─ Ad set 1: Broad / Advantage+ — install optimization
  └─ Ad set 2: Lookalike from app users 1-3%

Campaign 2: APP-ANDROID — objective=APP_PROMOTION
  ├─ Ad set 1: Broad
  └─ Ad set 2: Lookalike

Campaign 3: APP-RETARGETING (Android only — iOS retargeting is constrained)
  └─ Ad set 1: Web visitors who didn't install
```

### iOS / SKAdNetwork specifics

- Apple's SKAdNetwork limits Meta to **conversion values 0-63** per install. Map these in Events Manager carefully (level achievement, in-app purchase tiers).
- Retargeting on iOS is severely limited — most retargeting effort goes to Android.
- View-through attribution is replaced by "engaged-view" on iOS (1-day).

### Budget math

App installs typically have lower target CPA than ecom — $5-30. At $15 × 50 / 7 = **$107/day per ad set minimum**, much more achievable.

### Naming

```
{CLIENT} || APP-IOS || INSTALL || BROAD || US || 2026-05-12
{CLIENT} || APP-ANDROID || INSTALL || LAL1-3 || US || 2026-05-12
```

## Cross-vertical: CBO vs ABO decision

| Use CBO when | Use ABO when |
|---|---|
| Ad sets target distinct audiences with comparable value | You're testing audiences against each other |
| Campaign has been live > 14 days with stable structure | New campaign, first 14 days |
| You want Meta to reallocate budget within the campaign | You want guaranteed delivery on each ad set |
| Total daily budget > $500 | Total daily budget < $500 |
| You're scaling proven structure | You're isolating learnings |

Pilothouse rule of thumb (2026): **CBO once proven, ABO while proving.** Convert ABO winners to CBO by duplicating into a CBO campaign once an ad set has 14+ days of stable performance.

## The 50/week threshold — what "exit learning" actually means

Meta's documented and empirically-confirmed threshold: **50 optimization-goal events per 7 days per ad set** moves the ad set out of "Learning" delivery status into stable optimization. Below 50/week, the optimizer is making decisions on too few samples — variance dominates.

Budget calculation:
```
required_weekly_events = 50
required_daily_events  = 50 / 7 ≈ 7
required_daily_budget  = target_CPA × required_daily_events = target_CPA × 7

... wait, that's the lower bound. The full exit-learning budget:

required_daily_budget = target_CPA × 50 / 7
                      = target_CPA × 7.14
```

The discrepancy: the 7-event-per-day floor is the conversion floor; the budget formula assumes spending up to that floor takes a full day at target CPA. In practice, the optimizer needs a budget cushion above the floor to deliver consistently, so `target_CPA × 50 / 7` ≈ **7× target CPA per day** is the working number.

| Target CPA | Min daily budget per ad set |
|---|---|
| $20 | $143 |
| $30 | $214 |
| $50 | $357 |
| $100 | $714 |
| $200 | $1,429 |

If the account can't support this per-ad-set budget across the desired structure, consolidate. Fewer ad sets at threshold beats more ad sets in permanent learning. See [`red-flags.md`](red-flags.md) pattern #17 (Learning-limited ad sets) for detection.

## What good structure looks like in `list_campaigns` output

A well-structured DTC account:

```
- ACME || PRO || TOF || BROAD || US || 2025-12-15 (active, $500/day, CBO, 1 ad set)
- ACME || PRO || TOF || ASC || US || 2026-01-10 (active, $400/day, ASC)
- ACME || PRO || MOF || VC30 || US || 2025-12-15 (active, $200/day, CBO, 2 ad sets)
- ACME || PRO || BOF || ATC90 || US || 2025-12-15 (active, $150/day, CBO, 2 ad sets)
- ACME || PRO || TEST || NEW-HOOK-A || US || 2026-05-08 (active, $80/day, ABO, 1 ad set)
- ACME || PRO || TEST || NEW-HOOK-B || US || 2026-05-08 (active, $80/day, ABO, 1 ad set)
```

Six campaigns, four-tier funnel + testing, total $1410/day, predictable names. Audit this in 90 seconds.

A poorly-structured account:

```
- New Campaign 2024-11-03 (active, $20/day, 7 ad sets)
- TOF (active, $15/day, 4 ad sets)
- Copy of Copy of Black Friday (active, $50/day, 1 ad set)
- (no name) (active, $30/day, 3 ad sets)
- Acme - Sales - V2 - Final (active, $35/day, 12 ad sets)
- Re-targeting (active, $25/day, 6 ad sets)
```

Six campaigns, $175/day total, ~33 ad sets — every single one starved of conversions. Most common failure mode in audits.

See [`audit-checklist.md`](audit-checklist.md) Phase 2 for the structure-check ticks; see [`report-template.md`](report-template.md) for the report format.
