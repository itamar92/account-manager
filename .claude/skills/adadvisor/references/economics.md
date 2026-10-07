# Show economics — what "good" means for a band's ads

Upstream's economics assume an online shop: contribution margin, break-even ROAS, AOV, LTV. None of that applies. This band sells **tickets to dated shows** and the books already say what each one earned. Every decision here is a function of these numbers.

## The numbers that matter

| Number | Where it comes from | What it tells you |
|---|---|---|
| **Ad spend (per show)** | `moonlight_ad_analysis` → `ad_spend` (from the campaign↔show mapping) | What Meta charged for the show's promotion |
| **Tickets** | `moonlight_ad_analysis` → `tickets` (from the books) | What the show sold |
| **Fee** | `revenue` (pre-VAT) | What the show earned |
| **Cost per ticket** | `cost_per_ticket` | Ad spend ÷ tickets. `null` when no ticket count — never "free" |
| **Spend share of the fee** | `spend_share_of_revenue` (%) | How much of the fee the ads consumed |
| **Show profit** | `profit` | After all of the show's expenses |
| **Runway** | show `date` − today | Days left to sell; the real constraint |

```
cost_per_ticket        = ad_spend / tickets
spend_share_of_fee     = ad_spend / fee × 100
ads_per_profit_shekel  = ad_spend / profit          (when profit > 0)
band_median_cpt        = median(cost_per_ticket over shows with ad_spend > 0 and tickets > 0)
```

## There is no break-even ROAS here — build the benchmark from the band's own history

No industry cost-per-ticket figure is worth quoting for a band of this size and genre. The benchmark is the band's own shows:

1. Take every show in the period with `ad_spend > 0` and `tickets > 0` from `moonlight_ad_analysis`.
2. Compute the **median** cost per ticket and the **median** spend share. Report how many shows the median rests on.
3. Judge a show against that: better or worse than the median, and by how much.
4. **Fewer than ~5 comparable shows → say "small sample"** and give the comparison as indicative, not a rule.

A show whose fee is a **flat guarantee** (the same whatever the ticket count) is not "earning" more per ticket sold — the ads buy a fuller room (and the venue relationship), not more fee. Ask which kind of fee the show has before treating tickets as revenue. If you cannot tell, give the cost-per-ticket view and say the revenue view depends on it.

## What counts as clearly bad (no benchmark needed)

- **Spend share of the fee ≥ 100%** — the ads cost more than the show paid. Always flag.
- **Spend with zero tickets** (`tickets` = 0, `ad_spend` > 0 on a show that already happened).
- **A campaign still spending after the show** (`spending_after_show` > 0 on a settled show) — pause it.
- **Spend on unmapped campaigns** — not "bad", but unaccounted: every per-show figure is low by that amount.

Anything between those and the band's median is a judgement; say it is one.

## Spend ≠ cause

Mapping a campaign to a show says the money was *for* that show. It does not say the ads *sold* the tickets — word of mouth, the venue's own audience, and earlier shows' fans sell tickets too. Say "spend against tickets", never "the ads sold N tickets". The signal is comparative: this show cost more or less per ticket than the others, not that ads are or are not worth it in absolute terms.

## The runway changes the decision

Upstream waits 3–5 days for signal and scales 20% at a time. With a fixed date:

| Days to the show | What it means |
|---|---|
| > 21 | Time to test: run the creative and audience tests in `adadvisor-creative` / `-targeting`; scale in steps. |
| 7–21 | Commit: the best campaign gets the budget; limited room to learn. Decide on 2–3 days of data, not 5. |
| < 7 | Last push: retargeting people who already engaged, and a hard stop on anything not converting. No new tests. |
| show passed | The campaign is history — the only action is to stop it. The numbers are for next time. |

Always state the runway before recommending anything.

## The curve says more than the total

`moonlight_campaigns` with a `campaign_id` returns daily spend. Read it against the show date:

- **Ramped early** (spend spread over weeks) → had time to reach people; a poor result is about the offer or audience.
- **Spent late** (most of the money in the final days) → a timing problem; the cost per ticket is not a fair verdict on the creative.
- **Flat and thin** → under-funded; the result says nothing either way.

## Worked example (illustrative numbers)

Band history, 9 shows with spend and tickets: median cost per ticket **₪24**, median spend share **11%**.

Show at *The Venue*, 12 March: ad spend ₪3,420, 90 tickets, fee ₪18,000.

```
cost_per_ticket    = 3,420 / 90        = ₪38     (median ₪24 → +58%)
spend_share_of_fee = 3,420 / 18,000    = 19%     (median 11%)
```

Daily curve: ₪300 in the final 4 days of an 18-day run, ₪80 over the first 14.

Read: expensive per ticket and heavy against the fee, **but** most of the money went out in the last 4 days at premium late-auction rates. This is a timing problem before it is a creative problem. Next show: start spending at least three weeks out, at a steady rate. Do not conclude that the audience or creative failed — the data cannot show that at campaign level.
