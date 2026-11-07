# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The owner** — runs a small business and a band, does the band's books and promotes its shows with Meta (Facebook + Instagram) ads. Uses the app on a phone and at a desktop about equally: checking a running campaign on the way to a gig, building next month's campaign at a desk.
- **Band members** — sign in to read along. They can tick campaign tasks assigned to them and edit quotes; they never start an AI run or change anything in Meta.

## Product Purpose

One private web app for two sets of books: the business (clients → works → invoices → Israeli VAT and income tax) and the band (shows, suppliers, member division, quotes, ad spend). The campaign area exists to answer "was this show's promotion worth it, what should change, and what should the next campaign look like" — and, since this redesign, to be the one place the owner creates, edits, archives and analyses the band's Meta campaigns without opening Ads Manager.

Success: a campaign for a show can be planned, created, watched and adjusted from the app; every change in Meta is previewed and confirmed; every shekel of ad spend lands on the show it promoted.

## Positioning

Ads Manager knows campaigns; this app knows shows. Every campaign is tied to the show it promoted, so spend is read against tickets sold and the fee earned (cost per ticket, spend share of the fee), and member payouts never move after a show is settled.

## Operating Context

- Meta Marketing API through a system-user token (`META_ACCESS_TOKEN`, `ads_read` for the sync, `ads_management` for writes). Campaigns are synced into SQLite; ad sets and ads are read live.
- An AI agent reached over SSH writes analyses, plans, status reviews and chat answers; it never writes to Meta or the books. Optional Meta MCP read tools on the agent host.
- Campaign tasks per show with owners and email reminders.
- Clubs install the band's Meta pixel on their ticket pages; pixel status per club lives in the app.
- Meta bills monthly; one campaign spans several invoices. Morning (Green Invoice) holds the tax documents.

## Capabilities and Constraints

- Hebrew, right-to-left, mobile and desktop.
- **Any change in Meta follows preview → confirm**: the target is read live, laid out as «now → after» with warnings and blockers, and carried out only on the owner's explicit confirmation within 15 minutes, after re-reading the target. One change per confirmation. This holds for AI-suggested and manual changes alike.
- Create covers campaign + ad set + ad, created PAUSED. Delete means **archive** (status ARCHIVED): it stops spending and keeps the history.
- A hand-typed campaign cost on a show is never overwritten by the sync; a show marked paid-to-members is frozen.
- Amounts are in shekels; an ad account in another currency needs a stored rate.
- The data shown is campaign-level from the sync plus live reads; conversions are not available unless the agent's Meta tools provide them. Missing data is said, never guessed.

## Brand Commitments

- Two workspaces in one app: the business side in blue, the band side ("moon") in violet. The band side's accent is `#6b45d6`.
- Heebo as the single family; headings in heavy weight with tight tracking.
- The app's own voice: plain Hebrew, says what a number is and where it came from, admits gaps.

## Evidence on Hand

- No real data is committed: the repository is public. Books, receipts, campaigns, names and hostnames are git-ignored; the app seeds only an owner account from the environment. Screens and tests use synthetic data, labelled as such.

## Product Principles

1. **The show is the unit.** Campaigns are understood through the show they sell.
2. **Nothing changes in Meta unseen.** Preview the live target, then confirm; one change per yes.
3. **Say the gap.** Unmapped spend, missing ticket counts and disagreeing figures are shown, not smoothed.
4. **The AI advises, the owner decides.** Agent output is text and proposed actions, never a write.
5. **Settled is settled.** Paid shows and hand-typed figures are not rewritten.

## Accessibility & Inclusion

- WCAG AA contrast (the faint text token is set to 4.5:1 on white), visible focus rings in the workspace accent, 16px inputs on touch screens, reduced motion respected.
