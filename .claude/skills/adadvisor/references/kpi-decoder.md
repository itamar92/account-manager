# KPI decoder — which numbers exist here and what they can say

Upstream's decoder is about Meta's "Results" columns (`result_count`, `cost_per_result`, `purchases`, `roas`…). **None of those are in this data.** The sync pulls five fields per campaign per day (`app/server/metaClient.ts` → `fetchDailyCampaignInsights`): `spend`, `impressions`, `clicks`, `reach`, plus the campaign's `status` and `objective`. This file says what each can and cannot support.

## The fields

| Field | Level | Meaning | Caution |
|---|---|---|---|
| `spend` | campaign / day | Money spent, **already converted to ILS** | `spend_original` + `currency` are the untouched figures |
| `impressions` | campaign / day | Times the ads were shown | |
| `clicks` | campaign / day | **All** clicks (reactions, expands, profile, link) — not link clicks | Overstates the click to the ticket page |
| `reach` | campaign, lifetime | Unique people reached | Not additive across days or campaigns |
| `status` | campaign | `ACTIVE`, `PAUSED`, `ARCHIVED`… | Says what it is now, not what it was |
| `objective` | campaign | Meta's campaign objective | Tells you what Meta optimised for — which sets what the other numbers mean |

## Derived metrics

| Metric | Formula | Fair for |
|---|---|---|
| CPM | spend ÷ impressions × 1000 | Comparing campaigns' cost of attention; rises as the show nears and in competitive weeks |
| CTR (all clicks) | clicks ÷ impressions | Ranking campaigns against each other — **not** against published CTR benchmarks, which use link clicks |
| CPC (all clicks) | spend ÷ clicks | Same |
| Frequency (lifetime) | impressions ÷ reach | A rough read on saturation. ≳ 4–5 over a short run is a prompt to look, not a verdict; it is not daily |
| Cost per ticket | spend ÷ tickets *(tickets from the books)* | The headline. Not an attributed conversion cost |

## The objective sets the meaning

Because there are no results columns, **read `objective`** before judging a campaign's clicks and reach:

| `objective` | What Meta was buying | So judge by |
|---|---|---|
| `OUTCOME_AWARENESS` | Reach / impressions | CPM and reach. Clicks are incidental; a low CTR is expected, not a failure. |
| `OUTCOME_TRAFFIC` | Link clicks / landing page views | CPC and CTR. Whether those clicks became tickets is a question for the books and the ticket page, not for this data. |
| `OUTCOME_ENGAGEMENT` | Reactions, shares, event responses | Engagement is not visible here; CPM and reach only. |
| `OUTCOME_LEADS` / `OUTCOME_SALES` | Leads / purchases | Meta optimised for conversions this data does not contain. Cost per ticket against the books is the only verdict available — and cannot say which ad set drove it. |
| older `LINK_CLICKS`, `REACH`, `CONVERSIONS` | Same ideas, old names | As above |

Mismatch to flag: an awareness campaign judged on clicks, or a traffic campaign judged on reach.

## What this data cannot say — say so, do not guess

- **Whether a click became a ticket.** No conversion tracking comes through. Tickets are in the books only.
- **Which ad set, audience, placement or creative did well.** Campaign level only.
- **Hook rate, hold rate, creative fatigue.** Not computable.
- **Learning-phase status** and **attribution window.** Not in the data. The upstream references `learning-phase.md` and `attribution-windows.md` describe how Meta behaves; use them as background on what the user will see in Ads Manager, not as something you can verify here.
- **ROAS.** Never compute one from the fee: the fee is not revenue attributed to ads.

When a skill step needs one of these, ask the user to paste it from Ads Manager (columns: Results, Cost per result, Frequency, Link clicks; breakdown by ad set / ad) and say which step you are unblocking.
