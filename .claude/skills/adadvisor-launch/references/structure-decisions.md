## Structure decisions — ASC vs Advantage+ vs Manual, CBO vs ABO

The structure decision precedes any tool call. Wrong structure compounds — every downstream choice (audience, budget, learning, scaling) inherits the structure's constraints. This reference encodes the canonical decision logic with Lebesgue 2024 data, four worked structure examples, and the cannibalization rules when running multiple campaign types in parallel.

## The three structure patterns

| Pattern | Meta's name | When to pick |
|---|---|---|
| **ASC** | Advantage+ Shopping Campaign (legacy name) | Pure ecom with proven creatives and ≥ 30 weekly purchases. Pre-Andromeda terminology. |
| **Advantage+ Sales Campaign** | Current Meta term (post Andromeda update, 2025) | Replaces ASC. Same purpose: AI-driven ecom campaign with consolidated structure. Default for mature DTC. |
| **Manual prospecting + retargeting** | Sales objective with manual audiences | New accounts, lead-gen, app, low pixel volume, or when creative-level kill control matters. |

The ASC and Advantage+ Sales Campaign distinction matters mostly for naming in older docs and the AI research playbooks. In MCP terms, you're picking objective and toggling `is_advantage_plus`-style fields on the campaign. The decision logic is the same.

## When to pick each

### Advantage+ Sales Campaign (default for mature ecom)

Pick if: ≥ 30 weekly Purchase events; ≥ 5 working creatives; user wants Meta to allocate; account has ≥ 60 days Purchase history.

Why: Tinuiti 2024 showed ~22% ROAS lift over manual for established DTC. Meta's algorithm benefits from consolidated learning. Advantage+ Audience works when creative does the targeting.

Risks: minimal creative kill control. You can pause ads but can't isolate which audience produced which result. For granular attribution, prefer Manual.

### Manual prospecting + retargeting

Pick if: brand-new account (< 60 days, < 100 lifetime purchases); lead-gen (Advantage+ is sales-only); app promotion; low pixel volume (< 25 Purchase/week); user wants to test specific audience hypotheses; new product launch where audience signals matter.

Why: Manual separates prospecting (broad / LAL) from retargeting (custom audiences) into distinct ad sets. Creative-level performance is interpretable; kill rules apply cleanly because each ad set's audience is identifiable.

### Run both (with exclusions)

Mature accounts often run Advantage+ alongside a Manual testing campaign. Works only with exclusions: Manual excludes Advantage+ behaviors (or vice versa); both exclude purchasers. Without exclusions, the two bid against each other, inflating CPM 15-30% and providing no learning. If user requests "run both" without exclusions, surface the cannibalization risk.

## CBO vs ABO

| Pattern | What Meta optimizes | When to pick |
|---|---|---|
| **CBO** (campaign budget optimization) | Allocates campaign-level budget across child ad sets based on performance | Scaling proven ad sets; retargeting; mature campaigns |
| **ABO** (ad-set budget optimization) | Each ad set has its own budget, no cross-ad-set arbitrage | Testing; lead-gen; learning-phase isolation |

### The Lebesgue 2024 data

Lebesgue's 2024 study (n ≈ 4,800 accounts): ABO prospecting delivered **94% of target ROAS** vs CBO prospecting at **81%**. CBO retargeting hit **109%** (tight audiences benefit from allocation); ABO retargeting **102%** (no meaningful gap).

Interpretation: on prospecting (wide audiences, exploration), ABO outperforms because each ad set gets a clean learning signal. CBO's allocation shifts during testing starve some ad sets before they hit the 50-event threshold. On retargeting, CBO wins by a small margin — tight audiences allocate well.

### Decision

- **Manual prospecting, testing phase (week 1-2):** ABO. 3-5 ad sets, equal budgets.
- **Manual prospecting, scaling phase:** ABO if you want per-audience control, CBO if you want Meta to allocate among proven ad sets.
- **Retargeting:** CBO.
- **Advantage+ Sales Campaign:** functionally CBO — Meta handles allocation internally.

## Ad-set count

| Phase | Ad sets per campaign | Why |
|---|---|---|
| Testing (week 1-2 of a manual launch) | 3-5 | Each ad set tests a distinct audience hypothesis (broad / 1% LAL / 3% LAL / interest-stack / behavior-stack) |
| Validated structure | 1-2 prospecting + 1 retargeting | Consolidation aids learning; fewer ad sets compete for budget |
| Retargeting | 1 (with multiple custom audiences combined) | Don't split retargeting into 30/60/90 separate ad sets unless volume justifies — combine and let Meta sort |

Anti-pattern: testing 8 ad sets at $30/day each because "we want to test everything." Each starves at sub-learning budget. Better: 4 ad sets at $60/day, or 2 at $120/day, with a clean A/B hypothesis.

## Ads per ad set (post-Andromeda)

Meta's Andromeda model (rolled 2024-2025) handles **3-6 distinct concepts** per ad set well. Older guidance ("3 ads max") is obsolete. Current canonical:

- **Testing**: 4-6 distinct creative concepts in one ad set. Let Meta find the winner.
- **Scaling**: 3-5 ads, top performers preserved, refresh fatigued ones at 7-14 day cadence.
- **Dynamic Creative ad set**: 1 ad with multi-variant arrays (5 messages × 5 headlines × 5 descriptions).

"Distinct" means different angle/hook/format — not the same ad with three different headlines. Meta's signal works on visual + first-frame variety, not on copy permutation.

## Worked structure examples

### Example 1 — DTC bootstrap ($3K/mo, no purchase history)

1 campaign: OUTCOME_SALES, manual. 1 ad set: $50/day, broad (US, 25-55, Advantage+ Audience ON), optimization `LANDING_PAGE_VIEWS` (Purchase volume too low), 4 ads. Switch to Purchase once events hit 25/week.

### Example 2 — $40K/mo ecom testing new product

2 campaigns. Campaign A (testing, OUTCOME_SALES, manual, ABO): 3 ad sets at $150/day — broad+AdvAudience, 1% LAL purchasers, 3% LAL all-events. Same 5 ads each. Campaign B (retargeting, CBO $80/day): 30-day site + 180-day video viewers combined, excluding purchasers. Run 14 days, kill worst, scale winner.

### Example 3 — $250K/mo mature DTC

3 campaigns. **A** (Advantage+ Sales, $2,500/day, 5-8 ads). **B** (Manual prospecting, ABO $1,200/day): 1% LAL, 3% LAL, broad-with-seed — 4 ads each. **C** (retargeting, CBO $400/day, 30/90/180-day combined). Exclusions: A and B both exclude C; A excludes B's behavior cluster; B excludes A's prior 7-day exposed.

### Example 4 — B2B SaaS lead-gen

1 campaign, OUTCOME_LEADS, manual ABO. Ad set 1: Job-title (Director/VP/C-level) + target industries, $200/day, LEAD_GENERATION + ON_AD + lead_gen_form_id, 3 ads. Ad set 2: Company-size 200+ + industries, same form, $200/day. No Meta retargeting initially — use CRM email. Add Meta retargeting month 2.

### Example 5 — App promotion, iOS

OUTCOME_APP_PROMOTION, ABO. Campaign-level `promoted_object` with `application_id`, `object_store_url`, `is_skadnetwork_attribution: true`. 2 ad sets: broad iOS US $300/day; 2% LAL paying users $300/day. 3-4 vertical 9:16 video ads ≤ 15s. Wait 7+ days before diagnosing — SKAN postback lag is 24-72h.

## Cannibalization checks

Before activating two campaigns targeting overlapping audiences, run:

1. `adadvisor:estimate_audience_size(adset_id=...)` on each ad set in Campaign A and Campaign B.
2. Confirm `excluded_custom_audiences` is set on both to exclude the other's primary audience (or purchasers).
3. If audiences are inherently overlapping (e.g., two ad sets both targeting "US, 25-45, broad"), surface the auction-overlap risk and either consolidate or differentiate further.

## See also

- [`./launch-checklist.md`](./launch-checklist.md) — the pre-flight before any campaign create.
- [`./bid-strategies.md`](./bid-strategies.md) — which bid strategy pairs with which structure.
- [`./duplicate-vs-create.md`](./duplicate-vs-create.md) — when to clone a working structure vs build fresh.
