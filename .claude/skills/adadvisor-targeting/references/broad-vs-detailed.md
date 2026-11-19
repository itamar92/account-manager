## The case for broad-first

For most of Meta's history, the buyer's craft was *targeting* — stacking interests, building lookalike combinations, layering geo and behaviors. That era is over. As of 2026, broad + Advantage+ Audience is the default for prospecting, and the burden of qualification has shifted to creative.

This isn't a stylistic preference. It's a forced response to platform changes that took the signal away from manual targeting and gave it to the algorithm.

## Why broad won (and when it happened)

### iOS 14 / ATT (April 2021)

When Apple's App Tracking Transparency rolled out, ~70-80% of iOS users opted out of third-party tracking. Meta lost direct conversion signals for a huge portion of US traffic. Detailed-interest targeting — which had always been a *layered signal* on top of behavioral data — became unreliable because the behavioral feed got thinner.

### Andromeda (2024)

Meta's Andromeda model is a generational upgrade to the recommendation system. It's roughly 1,000× more compute-intensive than its predecessor, designed to extract conversion signal from a broader feature set with sparser per-user data. The practical effect: Andromeda finds buyers *outside* whatever interest cluster you give it. The narrower your targeting, the more you're handcuffing the model.

### June 2025 detailed-interest consolidation

Meta consolidated its detailed-interest taxonomy in June 2025 — collapsing thousands of granular interests into broader buckets and removing many altogether. Pre-existing ad sets using deprecated interests started auto-falling-back to broader categories or losing the interest entirely. The signal was: stop relying on this layer.

The `adadvisor:update_adset_targeting` tool has auto-fix logic for deprecated interests (3 retry attempts) precisely because this churn is ongoing.

## The Lebesgue 2025 data

Lebesgue's 2025 benchmark (~6,000 ecom ad accounts, $2B+ in tracked spend) compared three prospecting strategies across budget tiers:

| Strategy | Median ROAS, <$5K/day | Median ROAS, $5K-$25K/day | Median ROAS, >$25K/day |
|---|---|---|---|
| Broad + Advantage+ | 2.8× | 2.4× | 2.1× |
| 1% LAL (high-value seed) | 2.6× | 2.3× | 2.0× |
| Stacked interests (3-5 stacked) | 2.1× | 1.7× | 1.4× |
| Single narrow interest | 1.9× | 1.5× | 1.2× |

Broad wins at every tier. The gap widens at scale because the algorithm has more room to find buyers Meta would never have surfaced through a manual interest pick.

Replicated in Meta's own published case studies (2024-2025), in the Common Thread Collective podcast (Taylor Holiday, multiple 2025 episodes), and in Foxwell's account audits.

## Sarah Levinger's framing: "creative does the targeting"

Sarah Levinger's frame, broadly cited in Motion / CTC content: **the creative is the audience.**

When you target broad, every ad is an implicit qualification filter. The hook qualifies for the problem. The visual qualifies for the demographic. The offer qualifies for the budget band. A 30-second skin-care UGC video targeting US 18-65 will *deliver* to women 25-45 not because you told Meta to, but because that's who watches the ad to the end and clicks.

Implication for the buyer: time previously spent in the audience-builder belongs in creative production. The 5-8 concepts in [`product-launch.md`](../../adadvisor-playbooks/references/product-launch.md), the 7-10-day refresh cadence at $1K+/day, the systematic concept-angle matrix — these are all downstream of the broad-first thesis.

## When detailed targeting still wins

Broad isn't universal. There are real exceptions.

| Situation | Why detailed wins |
|---|---|
| Very specific niche (<500K reachable buyers) | Broad has no signal at this size; you need to *find* the audience, not let creative qualify it |
| Regulated industries (CBD, gambling, alcohol, weapons) | Meta restricts delivery; you must stay inside policy-safe audiences |
| Geo-locked B2B (e.g. dentists in Texas) | The category is so narrow that detailed-interest + work-position targeting + small geo radii outperform broad |
| B2B with explicit job-title gating | Use `search_type='work_positions'` and `'industries'` — broad will leak to consumers |
| Local services (single ZIP / 10-mile radius) | Geo is doing all the work; broad inside that geo is correct, but the geo itself is "detailed" by Meta's terms |
| Premium / luxury (e.g. >$10K AOV) | Income + life-events + behaviors filter signal-to-noise where broad would burn budget on tire-kickers |

In these cases, lean on `adadvisor:search_targeting` aggressively. Use the `audience_size_lower_bound` and `audience_size_upper_bound` returned per interest to keep the combined audience in the 100K-2M reachable range — too narrow and Meta can't deliver; too broad defeats the point.

## Decision flowchart

```
Is this a prospecting ad set (not retargeting)?
├── No → Skip this doc; use retargeting funnels reference.
└── Yes
    ├── Is the user's geographic_scope local (single city / ZIP)?
    │   └── Yes → Use geo + broad. Skip interests.
    ├── Is the user in a regulated category (CBD, gambling, alcohol, financial)?
    │   └── Yes → Detailed targeting REQUIRED by policy. Use approved audiences only.
    ├── Is the reachable audience <500K after geo + age filtering?
    │   └── Yes → Use detailed-interest stacks to find pockets. Validate with estimate_audience_size.
    ├── Is this B2B with explicit job-title gating (e.g. selling to dentists, lawyers)?
    │   └── Yes → search_targeting(search_type='work_positions' | 'industries'). Pair with broad demographics.
    ├── Is this a brand new account with no historical conversion data?
    │   └── Yes → Broad + Advantage+ Audience. Let Meta find the audience; trust creative.
    └── Default (most cases)
        └── Broad + Advantage+ Audience. age_min=25, age_max=55, country only.
            advantage_audience=true. No interests. No lookalikes for the first 7 days.
            Once you have a seed, layer in a 1% LAL ad set IN PARALLEL.
```

## What the MCP enforces

`adadvisor:update_adset_targeting` and `adadvisor:create_adset` default `advantage_audience=true`. This is the deliberate platform stance — disabling it requires an explicit override, and the MCP's anti-pattern logs flag it for review. Detailed-interest entries are validated against Meta's live taxonomy via `/reachestimate`; deprecated IDs are auto-replaced where possible, and unfixable specs return `validation_error` with the offending entry surfaced.

`adadvisor:search_targeting` is the only legitimate way to obtain valid interest IDs. Never paste IDs from another account or another ad platform — IDs are not portable across Meta accounts in the way creative assets are.

## Anti-patterns

- Stacking 6+ interests as a "tight audience" — broad with Advantage+ Audience nearly always outperforms.
- Disabling Advantage+ Audience to "keep control" — Meta will hold delivery inside your spec only when the spec is unique enough; otherwise you're paying for the privilege of being narrow.
- Building a "winning audience" by trial-and-error in the audience builder, then assuming it transfers to a new account.
- Treating broad as "no targeting." Broad is geo + age + Advantage+ — still a real audience, just one where creative is the primary qualifier.
- Ignoring the June 2025 detailed-interest consolidation. Any prose, course, or playbook predating mid-2025 that stacks 8 interests is outdated.

## References cited

- Lebesgue 2025 ecom benchmark (~6,000 accounts, $2B+ tracked spend).
- Meta published case studies on Advantage+ Audience (2024-2025).
- Sarah Levinger, "Creative is the audience" (Motion, CTC podcast appearances).
- Common Thread Collective, multiple 2025 episodes on broad-first prospecting (Taylor Holiday).
- Andrew Foxwell, account-audit threads on detailed-interest decay (2025).
