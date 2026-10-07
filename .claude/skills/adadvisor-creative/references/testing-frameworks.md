## Creative testing frameworks

Three named frameworks dominate senior buyer practice. Each has a different goal — validation, milking an angle, or initial mapping — and the wrong framework for the wrong moment wastes test budget. This reference is the picker.

The meta-framework underneath all three: every ad is `hook → body → CTA`. The frameworks differ in which layer they vary, and how much.

## 3-2-2 (Tichenor)

| Dimension | Count | Notes |
|---|---|---|
| Creatives (visuals/videos) | 3 | Distinct concepts, same product/angle |
| Primary texts | 2 | Differ in body length / argument structure |
| Headlines | 2 | Differ in punchline / proof point |

3 × 2 × 2 = 12 dynamic-creative combinations in a single ad set.

### When to use

- You've identified an angle that works (e.g., "founder POV on saving money") and want a rigorous validation read.
- Account spend is high enough to feed 12 combinations with statistical signal — ~$300+/day per testing ad set.
- You're not exploring; you're confirming.

### Structure

Run as a single ad set with `is_dynamic_creative: true`. One ad object with multi-variant arrays. Meta auto-combines and surfaces winners at the combination level — see [`dynamic-creative.md`](dynamic-creative.md) for the operational details.

### Example brief

Product: $89/mo budgeting SaaS, founder-POV angle confirmed by prior data.

```
Creatives:
  1. Founder talking head, kitchen background, 12s
  2. Founder talking head, office background, 14s
  3. Animated explainer with founder voiceover, 10s

Primary texts:
  A. Short — 60 chars, one benefit + one CTA
  B. Long — 250 chars, problem + benefit + social proof + CTA

Headlines:
  X. "Save $200/mo automatically"
  Y. "The budgeting app accountants recommend"
```

### Statistical sanity

Minimum spend to call a winner: ~50 conversions per combination. With 12 combinations, that's ~600 conversions across the ad set. At a $30 CPA, ~$18K total before declaring. Real-world buyers settle for less — often 30 conversions per leading combination — and accept higher variance.

### Tichenor's 2025 caveat

"I was wrong about 3:2:2 — Meta's Andromeda update changed it. Top advertisers are ramping up creative production, testing multiple concepts and variations of those concepts per segment." Treat 3-2-2 as a floor, not a ceiling, in 2026. It's still useful for rigorous reads on a confirmed angle, but it's no longer the only protocol.

## 5-3-1 (Ben & Vic / Motion)

| Dimension | Count | Notes |
|---|---|---|
| Hooks | 5 | Different opening 1-3 seconds |
| Bodies | 3 | Different value-prop arcs |
| CTAs | 1 | The known-winning call to action |

5 × 3 × 1 = 15 ads.

### When to use

- An angle is winning; you want to milk it. Specifically, find the highest-leverage hook + body pair.
- Spend tier $1K-$5K/day. Enough volume to feed 15 ads, not so much that you should be running multiple frameworks in parallel.
- You have a single proven CTA — don't burn variance there.

### Structure

Often run as 15 separate ads in a single ad set (not Dynamic Creative). Each ad pairs one hook + one body + the CTA. Why separate ads: per-ad reporting is cleaner than Dynamic Creative's combination-level reporting; you'll learn faster which hook+body pair to expand on.

### Example brief

Product: skincare DTC, winning angle = "30-day before/after with real customer."

```
Hooks (3-5s each):
  H1. Pattern interrupt: customer holding mirror with "before" photo
  H2. Claim: "I tried this for 30 days. Here's what happened."
  H3. Demonstration: side-by-side before/after at the 3-second mark
  H4. Founder POV: "Most skincare lies about results. Watch what ours does."
  H5. Social proof: "Why 8,000 women switched to this..."

Bodies (the next 8-12s):
  B1. Product mechanism + ingredient name
  B2. Time-to-result + price comparison vs alternatives
  B3. Customer testimonial montage with text overlays

CTA (all 15):
  "Try risk-free for 30 days. Free shipping over $50."
```

### Statistical sanity

Aim for 30+ conversions per ad before declaring a winner — that's 450 conversions across the 15-ad pool. At a $25 CPA, ~$11K total. Most buyers will move on after 75-100 total conversions per ad set if a 2-3 ad winner emerges clearly.

## 3-3-3 (Pilothouse)

| Dimension | Count | Notes |
|---|---|---|
| Concepts | 3 | Distinct value-prop angles (problem-solution, social proof, demonstration, etc.) |
| Formats | 3 | Static, video, UGC — or vertical, square, story |
| Hooks | 3 | Different openers per concept × format |

3 × 3 × 3 = 27 ads. Heavy production lift; commensurate breadth of read.

### When to use

- Brand-new product, brand-new offer, or brand-new audience — you don't know which angle works.
- You want a wide initial map of what resonates before committing creative production to a single angle.
- Spend tier $500-$3K/day. Below that, 27 ads can't all get enough data; above that, you should be running multiple parallel 3-3-3s.

### Structure

Typically run as a single ABO ad set with 27 ads, or as a CBO campaign with 3 ad sets (one per concept). The CBO variant lets Meta find the winning concept fastest; the ABO variant gives you cleaner per-format reads.

### Example brief

Product: new D2C meal kit, no validated angle.

```
Concept 1 — Time savings:
  Format A — Static: "30 minutes from box to dinner" infographic
  Format B — Video: founder unboxing + cooking in real time
  Format C — UGC: customer cooking with kids while talking to camera

Concept 2 — Cost savings:
  Format A — Static: side-by-side grocery receipt vs meal-kit cost
  Format B — Video: animated breakdown of cost per meal
  Format C — UGC: customer doing the math on camera

Concept 3 — Quality / chef-driven:
  Format A — Static: chef holding ingredients, restaurant-style plating
  Format B — Video: chef demonstrating technique in 15s
  Format C — UGC: customer reacting to taste

Hooks per cell:
  Problem hook ("Tired of cooking dinner at 9pm?")
  Claim hook ("Meals you'd pay $30 for at a restaurant — for $12.")
  Demonstration hook (action in first frame)
```

### Statistical sanity

You're not looking for per-ad winners — you're looking for which 3 of 27 cells dominate. After 100-200 total conversions across the ad set, the top 3-5 cells will be obvious. Cut the rest; rebuild around the winners using 5-3-1 or 3-2-2.

## The hook → body → CTA hierarchy (meta-framework)

When in doubt, the underlying logic is:

1. **Hook drives hook rate** (3-sec views / impressions). Without a good hook, body and CTA don't matter.
2. **Body drives hold rate** (15-sec views / 3-sec views) and CTR.
3. **CTA drives conversion rate** (purchases / clicks).

Diagnostic flow for an underperforming creative (from `adadvisor-diagnose`):

| Symptom | Likely failure | Test next |
|---|---|---|
| Low hook rate (<20%) | Hook isn't stopping the scroll | Test 5 new hooks, same body+CTA |
| Healthy hook rate, low hold rate (<30%) | Hook overpromised; body bores | Test 3 body variations under the winning hook |
| Healthy hook + hold, low CTR (<0.8%) | Click motivation weak | Test stronger value props and CTAs |
| Healthy CTR, low CVR | Landing page or offer issue, not creative | Stop testing creative — fix the funnel |

## Picking the right framework

| Situation | Framework |
|---|---|
| New product, no validated angle | **3-3-3** (Pilothouse) — broad mapping |
| Angle validated, want to identify load-bearing element | **Hook → body → CTA hierarchy** — surgical |
| Winning angle, want to scale via volume of variants | **5-3-1** (Ben & Vic / Motion) — milk it |
| Want a rigorous read on a confirmed angle | **3-2-2** (Tichenor via Dynamic Creative) — validate |
| Spend tier $10K+/day | **Run 2-3 frameworks in parallel** across different angles |

## Anti-patterns

- Running a 3-3-3 at $100/day. 27 ads on micro-budget = each ad gets 4 impressions. Zero signal.
- Running a 5-3-1 with 5 hooks that are basically the same thing. Distinct = different angle of attack, not different word choice.
- Declaring winners on day 1. Hook rate is the only metric stable on day 1; CPA and ROAS need 3+ days.
- Holding 27 ads live "to see which wins" without a kill rule. Set a kill threshold up front (e.g., kill any ad at 3× target CPA / 0 conversions after $50 spend).
- Treating 3-2-2 as the One True Framework in 2026. Tichenor himself moved on. Match framework to situation.

## Cross-references

- [`hook-library.md`](hook-library.md) — proven hook patterns to populate 5-3-1 and 3-3-3 briefs.
- [`dynamic-creative.md`](dynamic-creative.md) — how 3-2-2 is operationally deployed.
- [`refresh-cadence.md`](refresh-cadence.md) — how often to run the next testing cycle.
- [`format-rules.md`](format-rules.md) — aspect ratios and length constraints inside each cell.
