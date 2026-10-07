## Currency and units — the one-line rule

**Every budget parameter you pass to the AdAdvisor MCP is in major units of the account's currency.** Every budget you receive back is in major units. The server converts to and from Meta's API minor units internally via `currency_offset()`. You — the agent — never touch minor units.

The trap: Meta's Marketing API itself takes budgets in **minor units** (cents for USD, no fractional unit for JPY, thousandths for KWD). LLMs trained on Meta's raw API examples will reach for `daily_budget: 5000` thinking "$50". That's $5,000/day through this MCP. The currency table below tells you why.

## Three buckets, every Meta-supported currency

### Zero-decimal currencies — 1 major unit = 1 API unit

These currencies have no fractional sub-unit. There is no "yen and sen" anymore — 1 JPY is the smallest billable amount.

| Code | Currency | Smallest billable |
|---|---|---|
| BIF | Burundian Franc | ฿1 |
| CLP | Chilean Peso | $1 CLP |
| DJF | Djiboutian Franc | Fdj 1 |
| GNF | Guinean Franc | FG 1 |
| ISK | Icelandic Króna | kr 1 |
| JPY | Japanese Yen | ¥1 |
| KMF | Comorian Franc | CF 1 |
| KRW | South Korean Won | ₩1 |
| MGA | Malagasy Ariary | Ar 1 |
| PYG | Paraguayan Guaraní | ₲1 |
| RWF | Rwandan Franc | FRw 1 |
| UGX | Ugandan Shilling | USh 1 |
| VND | Vietnamese Đồng | ₫1 |
| VUV | Vanuatu Vatu | VT 1 |
| XAF | Central African CFA | FCFA 1 |
| XOF | West African CFA | CFA 1 |
| XPF | CFP Franc | ₣1 |

In MCP calls: `daily_budget: 5000` for a JPY account means **¥5,000/day** (≈$32 USD). Same number for a USD account means **$5,000/day**. The currency of the account changes the order of magnitude — always check `currency` from `list_ad_accounts` before writing a budget literal.

### Three-decimal currencies — 1 major unit = 1,000 API units

These currencies use a thousandths sub-unit (the dinar / rial family).

| Code | Currency | Smallest billable |
|---|---|---|
| BHD | Bahraini Dinar | 0.001 BHD |
| IQD | Iraqi Dinar | 0.001 IQD |
| JOD | Jordanian Dinar | 0.001 JOD |
| KWD | Kuwaiti Dinar | 0.001 KWD |
| LYD | Libyan Dinar | 0.001 LYD |
| OMR | Omani Rial | 0.001 OMR |
| TND | Tunisian Dinar | 0.001 TND |

In MCP calls: `daily_budget: 50.0` for a KWD account is **KWD 50.000/day** (≈$163 USD). The MCP rounds to three decimals; pass `daily_budget: 50.123` and Meta's API receives `50123` minor units.

### Two-decimal currencies — the default

Everything else — USD, EUR, GBP, CAD, AUD, MXN, BRL, INR, AED, SAR, ZAR, SGD, HKD, NZD, CHF, SEK, NOK, DKK, PLN, CZK, HUF, RON, TRY, ILS, EGP, NGN, KES, GHS, PHP, IDR, MYR, THB, PKR, ARS, COP, PEN, UYU, BOB, etc.

`daily_budget: 50.0` is **$50.00/day** in USD. The server multiplies by 100 to send `5000` minor units to Meta.

## The `$5,000 = $50/day vs $5,000/day` gotcha

The single most common LLM mistake on Meta's API:

```
# WRONG — thinking in cents
adadvisor:create_campaign(daily_budget=5000)   # → $5,000/day in USD, ¥5,000/day in JPY

# RIGHT — major units
adadvisor:create_campaign(daily_budget=50.0)   # → $50/day in USD, ¥50/day in JPY
```

Two failure modes, both bad:

1. **USD account, intended $50/day, sent `5000`.** Meta accepts. The MCP doesn't reject — it's a valid budget. You just spent 100× what the user asked for in the first 24 hours. Check the `state_after` budget in the mutation response *every time* and compare to the user's stated number before activating.

2. **JPY account, intended ¥50/day, sent `50.0` thinking USD.** The server treats `50.0` as ¥50 — fine, but the user thinks "I set $50/day." When you report progress next session and quote "spend ¥350 over 7 days," they're confused because they expected dollars. **Always echo currency in user-facing reports**: "spent ¥350 (≈$2.30 USD)" or "spent $50 USD."

`list_ad_accounts` returns `currency` per account. The first time you reference a budget to the user, name the currency. Subsequent references can omit it if it's been stated and only one account is in play.

## Why budgets below 1 minor unit reject

Meta's minimum daily budget is **1 minor unit × Meta's account-tier floor**, never below the currency's smallest billable unit. The MCP server validates before forwarding.

Examples that reject at the MCP layer:

- JPY account, `daily_budget: 0.5` → rounds to ¥0 minor units → reject with "budget below currency floor."
- USD account, `daily_budget: 0.001` → rounds to 0 cents → reject.
- KWD account, `daily_budget: 0.0005` → rounds to 0 minor units → reject.

Meta's true floor is higher (typically $1 USD-equivalent for daily budgets, $5 USD-equivalent for some objectives) — the MCP returns Meta's error verbatim when it hits that. The `< 1 minor unit` reject is the MCP's local validation that fires *before* the Meta call, so you save a round trip.

The practical floor table (Meta 2026 daily-budget minimums, varies by objective):

| Currency | Practical daily floor |
|---|---|
| USD | $1.00 |
| EUR | €1.00 |
| GBP | £1.00 |
| JPY | ¥100 |
| INR | ₹70 |
| KWD | KWD 0.300 |
| BIF | ฿2,500 |

When in doubt, propose budgets at or above $10 USD-equivalent — well clear of any floor, well into a tier where Meta's optimizer has signal to work with. The economics reference covers the *why*: see [`economics.md`](economics.md) for the `target_CPA × 50 / 7` exit-learning math.

## What `_units` and `currency` in responses tell you

Every list/performance/mutation response from the MCP includes:

```
{
  "currency": "USD",
  "_units": "All budget and spend values are in major units (USD).",
  ...
}
```

Trust those. Don't infer currency from the account name or business locale — the account's billing currency is what Meta uses for budgets and reporting. A US-based business with a JPY-billed account *will* see all numbers in JPY.

When you sum or compare numbers across multiple accounts, **never sum mixed currencies**. Surface each account's currency separately, or convert to a single reporting currency using a user-confirmed FX rate.

## Quick reference

1. `list_ad_accounts` → note `currency` per account.
2. All budget params: major units in that currency. Two decimals default, three for dinar/rial, zero for JPY/KRW/etc.
3. All budget responses: same major units. The `_units` field reminds you.
4. Sub-floor budgets reject locally. Meta floors apply above that.
5. When reporting to user, always state currency once per session per account.

See [`mcp-tool-cheatsheet.md`](mcp-tool-cheatsheet.md) for the tools that take budget params; see [`mutation-safety.md`](mutation-safety.md) for the 2× / 0.5× budget-change guardrail that's enforced regardless of currency.
