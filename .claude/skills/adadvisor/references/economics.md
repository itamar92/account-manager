# Unit economics for Meta ad decisions

Every kill, scale, hold, or launch decision is a function of unit economics, not "good ROAS." Internalize these formulas — they make the decision rules in the skills brand-agnostic and parametric.

## The five numbers that matter

| Number | Where to get it | What it tells you |
|---|---|---|
| **Contribution margin %** | User OR derived | What you keep per dollar of revenue after COGS, shipping, fulfillment, payment processing, returns |
| **Break-even ROAS** | `business.break_even_roas` from the context resource | The revenue-per-dollar-spent that exactly covers ad spend — no profit, no loss |
| **Target ROAS** | Break-even × profit-margin multiple | The ROAS at which scaling makes sense |
| **AOV** | `business.average_order_value` from context | Average revenue per order; used to derive target CPA |
| **LTV** | User-provided (rare on context) | Lifetime customer value; used for subscription / repeat-purchase math |

## Formulas

```
break_even_ROAS  = 1 / contribution_margin
target_ROAS      = break_even_ROAS × (1 + desired_profit_margin)
target_CPA       = AOV × contribution_margin × (1 / target_ROAS_multiplier)
                 = AOV / target_ROAS
target_CPL       = (lead_to_customer_rate × LTV × contribution_margin) - margin_buffer
MER              = total_revenue / total_marketing_spend
LTV:CAC          = LTV / CAC; healthy ≥ 3:1, elite ≥ 5:1
CAC_payback      = CAC / monthly_contribution_per_customer
```

## Worked examples

### Ecom DTC, 30% contribution margin, $100 AOV, target 30% profit

```
break_even_ROAS = 1 / 0.30                  = 3.33×
target_ROAS     = 3.33 × 1.3                = 4.33×
target_CPA      = $100 / 4.33               = $23
```

Kill if ROAS < 0.8 × 3.33 = 2.66× for 3+ days. Scale if ROAS ≥ 4.33 × 1.2 = 5.2× for 3+ days.

### Ecom DTC, 50% contribution margin, $80 AOV, target 25% profit

```
break_even_ROAS = 1 / 0.50                  = 2.00×
target_ROAS     = 2.00 × 1.25               = 2.50×
target_CPA      = $80 / 2.50                = $32
```

### B2B SaaS, $50 MRR, 12-month gross retention, 80% margin, 6-month payback target

```
12-mo LTV       = $50 × 12 × 0.80           = $480
target CAC      = $480 / 6 × 2              = $160 (matched payback / 2 for buffer)
```

If pixel-tracked as a "Subscribe" event, `cost_per_result` from the MCP corresponds to CAC.

### Subscription, $19.99 first-month, LTV $200, 50% margin

```
break_even on first-month   = $19.99 × 0.50 = $9.99 (you lose money on month 1)
LTV gross profit            = $200 × 0.50   = $100
target CAC                  = $100 / 2      = $50 (50% payback ratio)
```

Don't look at ROAS for subscription. Look at `cost_per_result` (the Subscribe event) against the LTV-implied target CAC.

## MER vs blended ROAS

**MER (Marketing Efficiency Ratio)** = Total Revenue / Total Marketing Spend, including organic, retargeting, brand, every channel.

Most mature DTC brands target 3.0×-5.0× MER (ATTN Agency, Foxwell, MHI). MER is the company-level number; ROAS is the campaign-level number. **At scale (>$5K/day), MER tells you more than ROAS** — it captures the cannibalization between paid and organic, retargeting and brand, that per-campaign ROAS hides.

Peter Quadrel's 2026 caveat: separate **new-customer MER** from blended MER. Blended averages a $200 new CAC with $20 retargeting CPA and calls it "efficiency" — masking that you're not actually acquiring new customers efficiently.

## The iceberg

> "ROAS tells you how efficiently you're buying revenue. Contribution margin tells you how much of that revenue you actually keep." — Ciaran Finn

A 4× ROAS on 20% contribution-margin product is silently going broke. Always pair ROAS with margin in user-facing reports.

## Lead-gen flips the math

For OUTCOME_LEADS campaigns, ROAS is meaningless. Use CPL vs target_CPL:

```
target_CPL = (lead_to_customer_rate × deal_value × margin) / desired_payback_ratio
```

Example: 5% lead-to-customer rate, $5,000 deal value, 60% gross margin, 6-month payback target:

```
target_CPL = (0.05 × $5,000 × 0.60) / 6_months_of_revenue_per_customer_per_month
           ≈ $150
```

If `business.target_cpl` is set on the context resource, use it. If null, ask the user.

## Decision thresholds tied to economics

| Action | Threshold |
|---|---|
| Kill (ecom) | ROAS < 0.5 × break-even for 3+ days |
| Kill (lead-gen) | CPL > 1.5 × target_CPL for 3+ days with ≥10 leads |
| Hold (ecom) | ROAS in [0.8× break-even, 1.2× target] — within variance |
| Hold (lead-gen) | CPL in [target, 1.3 × target] — re-check in 48h |
| Scale (ecom) | ROAS ≥ 1.2 × target for 3+ consecutive days |
| Scale (lead-gen) | CPL ≤ 0.9 × target for 3+ consecutive days |

All assume the entity is past learning (≥50 conversions / 7 days). In learning, give it time before any decision.

## Cohort & new-customer rate

A "scaling winner" that's actually retargeting existing customers won't survive vertical scale. Senior buyer's check: what % of conversions are new customers vs returning?

The MCP doesn't surface new-customer rate directly. Use one of:

- Custom-event tracking ("first_purchase" event fired only on first purchase, separately from "Purchase")
- Shopify / DB-side cross-reference outside the MCP
- Proxy via creative type — retargeting creatives optimize on returning customers by definition

Curtis Howland's framing (LinkedIn 2026): "**Net New Reach**" — % of impressions delivered to people who haven't interacted with the brand. Falling Net New Reach forecasts ROAS decline before CPA moves.

## When the user has no margin number

If the user doesn't know their contribution margin, ask. If they can't give a clean answer, derive from gross margin minus reasonable fixed/variable costs:

- Apparel: 60-70% gross margin → 30-40% contribution after fulfillment / returns
- Beauty / supplements: 70-80% gross → 40-50% contribution
- Electronics: 30-50% gross → 15-30% contribution
- Subscription / SaaS: 80-90% gross → 60-80% contribution (low fulfillment)
- Furniture: 40-60% gross → 20-30% contribution (high shipping)

These are coarse — push the user to verify, but unblock the decision conversation.
