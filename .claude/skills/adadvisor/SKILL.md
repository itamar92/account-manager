---
name: adadvisor
description: |
  Foundation for advice on the band's Meta (Facebook + Instagram) ad campaigns, grounded in this app's own data — the account-manager MCP server, which reads the Meta Marketing API with a read-only `ads_read` token and ties every campaign to the show it promotes. Loads the read-only rules, the show-economics model (cost per ticket, spend share of the fee) and the data limits every other adadvisor-* skill assumes. Use when: "campaign", "campaigns", "ad campaign", "AI campaign", "meta ads", "facebook ads", "instagram ads", "ads for the show", "promotion", "ad spend", "קמפיין", "קמפיינים", "פרסום", "יועץ קמפיינים", or whenever a band_campaigns / band_ad_analysis tool is about to be called. Chain with: adadvisor-audit for a full review, adadvisor-diagnose for a campaign that is not working, adadvisor-launch for planning a new one, adadvisor-scale for a campaign that is working, adadvisor-creative for copy and creative, adadvisor-targeting for audiences, adadvisor-playbooks for multi-week plans. NOT for: Google Ads / TikTok / other platforms (Meta only). NOT for: changing anything in the ad account — this connection cannot write.
license: Apache-2.0
version: 0.1.0-account-manager
---

# Campaign advice — Foundation

This skill is the floor. It loads whenever the user asks for advice about their ad campaigns, and it sets the conventions every `adadvisor-*` skill builds on. Read it once; the chained skills assume you have.

> **Adapted from [AdAdvisor/skills](https://github.com/AdAdvisor/skills) (Apache-2.0).** The upstream skills drive the adadvisor.ai MCP server, which can read *and change* a Meta ad account. This project does not use that server. It uses the connection this app already has to the Meta account, so the method (diagnostic stack, kill/scale rules, creative testing, targeting strategy) is kept and the tool layer and the economics are replaced. Wherever a chained skill says `adadvisor:<tool>`, translate it with [`references/mcp-tool-cheatsheet.md`](references/mcp-tool-cheatsheet.md).

## What the connection is

The app syncs the Meta ad account with a **System User token, scope `ads_read`** (`app/server/metaClient.ts`) into its own database, and exposes that to you through the app's **`account-manager` MCP server** (`app/server/mcpTools.ts`, documented in `app/README.md` under "MCP server"; connected with an API key created in Settings → מפתחות API). If its tools are not in your tool list, the server is not connected in this session — say so, give advice from the skill references only, and do not invent campaign figures. The pieces you can call:

| Tool | Gives you |
|---|---|
| `band_campaigns` | Every campaign: name, status, objective, spend, impressions, clicks, reach, first/last spend date, the shows it is mapped to, and suggested shows when unmapped. With `campaign_id`: that campaign's **day-by-day** spend, impressions, clicks. |
| `band_ad_analysis` | Per show: tickets, fee, ad spend, `cost_per_ticket`, `spend_share_of_revenue`, clicks, which months it was billed in, whether a campaign kept spending after the show. Plus totals and unmapped spend. |
| `band_shows` | The shows themselves: venue, date, tickets, fee, expenses, profit. |
| `band_campaign_advice` | The last verdict the in-app advisor (יועץ קמפיינים) stored for a period. Returns a stored report; never starts a new analysis. |
| `get_overview` | Orientation and business-level context. |

All money is **shekels (ILS)**. Campaign figures were converted from the ad account's currency at the app's stored rate; `spend_original` and `currency` give the untouched numbers.

## It is read-only — say so, do not pretend otherwise

**Nothing here can create, pause, resume, re-budget, duplicate or retarget anything.** There is no tool for it and no write scope on the token. Do not suggest you can, do not call Meta's Graph API directly, and do not ask for a broader token to "just do it".

So every recommendation ends as **an instruction for the person to carry out in Ads Manager**: name the entity, the exact setting, the value, and the order. Write it so it can be followed without reading the rest of your answer. See [`references/mutation-safety.md`](references/mutation-safety.md) for how to phrase these and what to say to keep a human in the loop.

## The data limits — know what you cannot see

The connection is **campaign-level**. You can see how much was spent, when, and how many people were reached and clicked. You **cannot** see:

| Not available | Consequence |
|---|---|
| Conversions / results / purchases / ROAS | Meta does not tell you tickets sold. **Tickets come from the books** (`band_shows`), not from the pixel. There is no ROAS here; there is cost per ticket. |
| Ad set and ad level | You cannot say which audience or which creative did it. Say "campaign level" and stop there, or ask for an Ads Manager export. |
| Daily frequency, CPM/CPC trends by placement, hook/hold rate | Frequency exists only as lifetime `impressions ÷ reach` per campaign. Hook rate, hold rate and creative fatigue curves are not computable. |
| Pixel health, audiences, targeting, placements | The audit's pixel and structure checks cannot be run from data. Ask the user to check, or to paste a screenshot. |
| Ad copy | Synced for the in-app advisor but not exposed through MCP. Ask the user to paste the copy. |
| Data freshness | The tools do not return the last sync time. Use the **latest date in `campaign_id`'s daily curve** and say how stale it is before drawing a conclusion from "recent" days. |

When a skill step needs something on this list, **do not fill the gap with a plausible guess.** Say what is missing, say what it would have told you, and offer the two ways forward: the user pastes it from Ads Manager, or the app's Meta client is extended to read it (see "Extending the connection" below).

## Workflow — the first minutes of every session

Do these in order before any analysis:

1. **`get_overview`** if you have not seen this business yet — it says what the app holds and gives the band totals.
2. **`band_ad_analysis`** for the period being asked about (`from`/`to`, `YYYY-MM-DD`; omit for all). This is the ground truth for "is advertising paying for itself", and it carries `unmapped_spend`.
3. **Check what is unmapped.** `totals.unmapped_spend` is money spent on campaigns no show claims. If it is a meaningful share of total spend, every per-show number understates the true cost, so say that first. `band_campaigns` with `unmapped_only: true` lists them, with suggested shows.
4. **Check freshness** via the latest date on the daily curve of the biggest campaign. If it is more than a few days old, tell the user to run the sync in the app before trusting recent days.
5. **Check the shows' side.** `band_shows` gives dates. A campaign for a show that already happened is history; a campaign for a show in three weeks is live and time-boxed.
6. **Look for the stored verdict** — `band_campaign_advice` for the period. If the in-app advisor already said something, build on it and say where you agree or disagree, rather than re-deriving a different answer without noticing.

Then route to the specific workflow skill.

## Show economics — the operating model

A show is a one-off event with a **fixed date** and a **fee**. There is no repeat-purchase LTV and no storefront margin. Think in:

- **Cost per ticket** = ad spend ÷ tickets sold (`cost_per_ticket`; `null` when no ticket count exists — never read `null` as free).
- **Spend share of the fee** = ad spend ÷ fee (`spend_share_of_revenue`, a percentage).
- **Show profit after ads** — `profit` on the show already nets expenses; check it includes the ad spend (`campaign_on_row` vs `ad_spend`; a gap means someone typed a different figure by hand).
- **The band's own history is the benchmark.** There is no industry number worth quoting for a band of this size. Rank this show against the band's other shows (`band_ad_analysis` rows), and say how many shows the comparison rests on. With few shows, say "small sample".

Full formulas, what to do when the fee is not ticket-driven, and worked examples: [`references/economics.md`](references/economics.md).

When you report a number, **pair it with the comparison**. "Cost per ticket ₪38" means nothing; "₪38 per ticket against the band's median of ₪24 over 9 shows — this one cost 58% more per ticket" is the conversation.

## What the fixed date changes

Upstream's rules assume an always-on account that can wait 3–5 days for signal and scale 20% at a time. A show has a deadline, so:

- **The runway is the constraint.** Always compute days until the show first. A decision that is right for an evergreen campaign (wait a week, scale slowly) can be wrong with ten days left.
- **Late spend sells fewer tickets.** The daily curve (`band_campaigns` with `campaign_id`) says whether money went out early enough. A campaign that spent most of its budget in the last 3 days reads very differently from one that ramped over three weeks.
- **A campaign still spending after the show** (`spending_after_show`) is money with no event to sell. Flag it as an action: pause it in Ads Manager.

Still true: do not kill or scale on one day of data, and small budgets are noisy. Defer to `adadvisor-diagnose` for the kill and scale rules and apply them with the runway in mind.

## Common mistakes (avoid these)

- **Quoting ROAS, CPA, CPL or `result_count`.** None of them exist in this data. Do not compute a ROAS from the fee — the fee is not revenue attributed to ads.
- **Attributing tickets to ads.** Mapping a campaign to a show says the money was *for* that show, not that it *caused* the tickets. Say "spend against tickets", not "ads sold N tickets".
- **Trusting per-show numbers with unmapped spend outstanding.** Check `unmapped_spend` first.
- **Claiming you paused, changed or created something.** You cannot.
- **Calling Meta's Graph API directly** or asking for the token. Everything goes through the MCP tools; the token never leaves the app.
- **Reading `spend` as the account currency.** It is already ILS; `spend_original` is in `currency`.
- **Judging a live campaign by its show's profit.** The show has not happened; its tickets and fee are incomplete.

## When to chain to another skill

| User says | Load |
|---|---|
| "review my campaigns", "how are the ads doing overall", "what's wrong" | `adadvisor-audit` |
| "cost per ticket went up", "this campaign isn't working", "should I stop this" | `adadvisor-diagnose` |
| "plan a campaign for the show on…", "set up ads for…" | `adadvisor-launch` |
| "this one is working, should I put more in" | `adadvisor-scale` |
| "what should the ad say", "new creative", "the ads are stale" | `adadvisor-creative` |
| "who should I target", "lookalike", "retargeting" | `adadvisor-targeting` |
| "plan the weeks before the show", "festival run", "account got restricted" | `adadvisor-playbooks` |

If the request spans several — "review the campaigns and tell me what to put more money into" — load both, audit first, then scale.

## Extending the connection

If advice keeps stopping at a limit above, the right fix is in the app, not a different server: `app/server/metaClient.ts` already pages the Graph API and can read ad sets (`/adsets`), ad-level insights, and results (`actions`, `cost_per_action_type`) under the same `ads_read` scope, still read-only. That is a code change in this repo — propose it to the user with what it would unlock; do not make it as part of answering a campaign question.

## References

- [`references/mcp-tool-cheatsheet.md`](references/mcp-tool-cheatsheet.md) — every `adadvisor:<tool>` the other skills mention, mapped to what this connection offers (or "not available").
- [`references/economics.md`](references/economics.md) — cost per ticket, spend share, the runway, worked examples.
- [`references/kpi-decoder.md`](references/kpi-decoder.md) — which numbers exist in this data and what each one can and cannot say.
- [`references/currency-and-units.md`](references/currency-and-units.md) — ILS conversion and the `spend` / `spend_original` pair.
- [`references/mutation-safety.md`](references/mutation-safety.md) — the read-only rule and how to write an instruction for Ads Manager.

## Anti-patterns

- ❌ "Cost per ticket is ₪38." ✅ "₪38 per ticket against the band's median of ₪24 across 9 shows — the most expensive show this year."
- ❌ "I'll pause that campaign now." ✅ "In Ads Manager, pause campaign *<name>* — it is still spending ₪40/day and the show was on 12 March."
- ❌ "Your ROAS is 3.1×." ✅ "Meta's data here has no conversions, so no ROAS. Against the books: ₪6,200 of ads for 140 tickets."
- ❌ Judging an ad set or a creative. ✅ "I can only see campaign level. Paste the ad-set breakdown from Ads Manager, or I can propose reading it into the app."
- ❌ Ranking the shows when a third of the spend is unmapped. ✅ "₪4,100 of ₪11,800 is on campaigns no show claims. Map those first, otherwise every figure below is low."
