## 2026 healthy ranges by vertical

The most reliable benchmark is the **same account's trailing 14-day average**. Use these tables only when you have no account history or the user asks "is this normal." Variance by sub-vertical and geography is wider than the tables reflect.

Sources: Motion Creative Benchmarks 2026, Foxwell Insights (Q1 2026), Vaizle quarterly, AdManage 2026 (n=12,400), Coinis ad-tech. Where sources disagree, median of the three closest.

## DTC ecom — direct-to-consumer brands

| Metric | Weak (kill watch) | Healthy | Strong | Notes |
|---|---|---|---|---|
| CPM (prospecting, US) | >$30 | $12–$22 | <$12 | Q4 inflates 30-50% during BFCM |
| CPM (retargeting, US) | >$45 | $25–$40 | <$22 | Small audiences naturally higher |
| Hook Rate (3-sec / impressions) | <20% | 25–35% | >40% | Video creatives only |
| Hold Rate (15-sec / 3-sec) | <30% | 40–55% | >65% | First 3 seconds matter most |
| CTR (outbound link) | <0.8% | 1.0–1.8% | >2.0% | Outbound = leaves Meta |
| CTR (all) | <1.0% | 2.0–3.0% | >3.5% | Includes on-Meta engagement |
| LP CVR (LPV / clicks) | <20% | 30–50% | >60% | Mobile traffic skews lower |
| Purchase CVR | <0.5% | 1.0–3.0% | >4.0% | Subscriber CVR runs 4-8% |
| Frequency (prospecting) | >3.5 | 1.5–2.5 | <2.0 | Per 7-day window |
| Frequency (retargeting) | >8.0 | 4–6 | 3–5 | Per 7-day window |
| AOV | varies | $50–$120 | >$120 | Higher AOV → looser CPA target |
| ROAS (post-iOS, modeled) | <2.0× | 2.5–4.5× | >5.0× | Meta-reported, 7d/1d window |

Sub-verticals: **Apparel** — CPM 10-15% higher, frequency tolerance lower. **Beauty/supplements** — CTR 2-3.5% (curiosity), CVR is the bottleneck. **Home goods** — AOV $300+ allows looser CPA ($60-150), 28-day attribution recommended.

## B2B SaaS

ROAS is meaningless; report **CPL vs target_CPL** and lead-to-customer rate.

| Metric | Weak | Healthy | Strong |
|---|---|---|---|
| CPM | >$60 | $30–$50 | <$25 |
| Hook Rate | <15% | 20–30% | >35% |
| CTR (link) | <1.0% | 1.5–2.5% | >3.0% |
| LP CVR (form view) | <15% | 25–40% | >50% |
| Form completion | <8% | 12–25% | >30% |
| CPL (eBook / content) | >$120 | $40–$90 | <$30 |
| CPL (demo request) | >$600 | $250–$450 | <$200 |
| Lead-to-MQL | <20% | 30–50% | >60% |
| MQL-to-customer | <8% | 12–25% | >30% |
| Lead-to-customer (e2e) | <2% | 4–8% | >10% |

Target_CPL math: `target_CPL = (L2C_rate × ACV × margin) / payback_months`. B2B SaaS with $12K ACV, 80% margin, 5% L2C, 12-month payback: `(0.05 × 12000 × 0.80) / 12 = $40`.

## Lead-gen services (insurance, mortgage, solar, home services)

| Metric | Weak | Healthy | Strong |
|---|---|---|---|
| CPM | >$50 | $20–$35 | <$15 |
| CTR (link) | <1.0% | 1.5–2.5% | >3.0% |
| Form completion | <15% | 25–40% | >50% |
| CPL (insurance auto) | >$60 | $25–$45 | <$20 |
| CPL (insurance final-expense) | >$80 | $35–$60 | <$25 |
| CPL (solar) | >$80 | $40–$60 | <$35 |
| CPL (mortgage refi) | >$150 | $70–$110 | <$55 |
| CPL (home services) | >$120 | $50–$85 | <$40 |
| Lead quality (closes / leads) | <8% | 12–25% | >30% |

Lead quality is the metric. A $20 CPL with 2% close rate is worse than a $50 CPL with 20% close. Pull `adadvisor:get_performance` for CPL, compare against close-rate from CRM. If CRM number is missing, push user to instrument it first — otherwise you scale junk leads.

## App (Meta App Promotion)

iOS attribution lag is 24-72h via SKAdNetwork. Trim the most recent 2-3 days before diagnosing.

| Metric | Weak | Healthy | Strong | Notes |
|---|---|---|---|---|
| CPM | >$30 | $10–$20 | <$8 | Region-dependent |
| CTR | <1.0% | 1.5–2.5% | >3.0% | Video creatives dominate |
| Install rate (installs / clicks) | <20% | 35–55% | >65% | Tier-1 markets higher |
| CPI (Tier-1 US/UK/AU) | >$8 | $3–$5 | <$2.50 | Game CPIs lower than utility |
| CPI (Tier-2/3) | >$3 | $0.80–$1.80 | <$0.50 | Brazil, Mexico, India runs cheap |
| Install-to-D1-retention | <25% | 35–50% | >60% | First-day retention defines LTV |
| Install-to-D7-retention | <12% | 18–28% | >35% | Week-1 retention forecasts paying users |
| Install-to-purchase (in-app) | <2% | 4–8% | >12% | Game / subscription difference matters |
| Cost per in-app purchase event | varies | LTV × 0.30–0.50 | <LTV × 0.25 | Payback ratio drives ceiling |

iOS: SKAdNetwork postback values are bucketed (0-63). Your MMP (AppsFlyer / Adjust / Singular) gives more granular truth than Meta's `roas`. Diagnose on the MMP, not Meta's modeled.

## Luxury / premium ($500+ AOV)

Luxury inverts most benchmarks. Lower CTR (smaller qualified audience), higher CPM (competitive senior-demo targeting), longer consideration window — 28-day attribution is more honest than 7-day.

| Metric | Weak | Healthy | Strong | Notes |
|---|---|---|---|---|
| CPM | >$60 | $35–$55 | <$30 | HHI 200K+ targeting drives this |
| CTR (link) | <0.5% | 0.8–1.4% | >1.8% | Tight audience, lower curiosity |
| LP CVR | <10% | 18–30% | >40% | High-intent traffic post-click |
| CVR (purchase) | <0.3% | 0.6–1.2% | >2.0% | First-purchase friction high |
| AOV | $500+ | $700–$1,500 | $2,000+ | Watch out for outlier orders skewing |
| ROAS (7d-click) | <1.5× | 2.0–3.5× | >4.0× | Lower than ecom; LTV does heavy lifting |
| Frequency (prospecting) | >3.0 | 1.8–2.5 | <2.0 | Sub-1M audience is normal |
| Cost per AddToCart | <$8 | $4–$6 | <$3 | Mid-funnel optimization useful |

Luxury benchmarks are unstable below n=8 conversions/week. Use 14-day rolling averages, never daily.

## How to use these tables

1. Pull `adadvisor:get_performance(level='campaign', date_preset='last_30d')`.
2. Pick the vertical (clarify with user if unclear).
3. Compare each metric — flag anything in "weak."
4. Report by exception: "CPM and CTR healthy; LP CVR 12% weak (table 30-50%) — that's the bottleneck."
5. **Cross-check against the account's 14-day trailing average.** Account baselines outweigh industry. If the account runs at $35 CPM where industry "healthy" is $20, $35 is the right number for that account.

## Anti-patterns

- Comparing a Tier-1 brand against a $5K/mo dropshipper's "ecom" benchmarks.
- Using industry CPL benchmarks without verifying funnel stage. B2B SaaS eBook CPL ($40) and demo CPL ($400) are both "B2B SaaS."
- Flagging luxury accounts as "weak" on CTR when the AOV math makes the ROAS work. CTR floor is set by economics.

## See also

- [`./diagnostic-tree.md`](./diagnostic-tree.md) — how "weak" translates to "kill / hold / refresh."
- [`./kill-rules.md`](./kill-rules.md) — the unsentimental thresholds.
- The `adadvisor` foundation skill's `references/kpi-decoder.md` — which Meta field to read for each optimization goal.
