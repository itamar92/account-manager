# Currency and units

## Everything you read is shekels

`band_campaigns` and `band_ad_analysis` report money in **ILS**. The Meta account may bill in another currency; the app converts each campaign's `spend` at the rate stored in its settings and keeps the original beside it.

| Field | Currency |
|---|---|
| `spend`, `ad_spend`, `attributed`, `revenue`, `profit` | ILS |
| `spend_original` | the ad account's currency |
| `currency` | which currency `spend_original` is in |

If the user quotes a number from Ads Manager and it does not match `spend`, check `currency` and `spend_original` first — it is usually the exchange rate, not a data error. The stored rate is a single flat rate, so converted spend will differ slightly from what the card was actually charged.

## Money you recommend

You cannot set budgets (read-only), but you will recommend them. Write every figure as **₪ per day** for a daily budget or **₪ total** for a lifetime budget, and say which — they are mutually exclusive in Meta, and a lifetime budget needs an end date. When the ad account is not in ILS, Ads Manager shows the account currency: give the figure in ILS and, if the user needs it, convert at the stored rate (`currency_rate` is on the app's integrations status, not in MCP) or ask them.

Meta's own API takes budgets in minor units (agorot for ILS). That is irrelevant to you — never write a minor-unit number in advice. `₪50` means fifty shekels.

## Dates

All dates are `YYYY-MM-DD`. The app reasons in **Israel time**; campaign day boundaries follow the ad account's timezone. A "yesterday" figure can shift if those differ.
