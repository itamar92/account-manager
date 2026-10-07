# Account Manager

A self-hosted accounting app for a small Israeli business that also runs a side venture —
a **band**, out of the box — with its own books. One login, two sets of books, in Hebrew
(RTL), built for an עוסק מורשה who invoices through Morning (Green Invoice) and wants to
know, at any moment, what is owed, what is due, and how the year is going to end.

It started as one musician's own tool. This repository is the generic version: nothing in
it is tied to a specific person, band, domain or data set. Clone it, set a handful of
environment variables, and it is yours.

## What it does

**The business side** (owner only)

- **Clients → works → invoices.** Billable jobs are the atomic unit; an invoice is created
  from a selection of them and issued through Morning, which owns the real document numbers.
- **Expenses** pulled from Morning with their classification, input VAT and what is actually
  deductible.
- **Reports**: the bi-monthly (or monthly) מע"מ filing and the income-tax picture, computed
  from the documents every time, plus an annual-report projection with brackets, credit
  points, ביטוח לאומי and the advances already paid.
- **Fixed assets** and depreciation, a credit-points calculator, and an inbox that lists only
  what is unfinished: overdue invoices, unbilled work, unclassified expenses, shows whose
  money has not arrived.
- **Google Calendar sync** turns calendar events into billable works, by configurable rules.

**The sub-business side** (the band; its members get their own read-only login)

- **Shows**: one page per show with its income, its cost lines, who is staffed on it, how the
  profit divides between the members, and where the money has got to.
- **Cost lines are yours to define** — rename them, switch them off, add your own. The
  defaults suit a live band (lighting, sound, singer, PA, hall, wristbands, royalties,
  campaign, …).
- **Members and the division.** The roster is data: who is in the band, who manages it, what
  kind of business each one runs. A producer fee (a configurable percentage) goes to the
  managers; the rest is shared equally. A band with one owner and a few members is the plain
  case; partners are just more managers.
- **Suppliers**: who you hire for which cost line, what they are owed across shows, the
  payments made, and the invoices that should have come back for them.
- **Price quotes**: templates, a private link the client signs on their phone, and an
  «option» event held on the calendar until the show is confirmed.
- **Meta Ads**: campaign spend pulled from the Marketing API and attributed to shows, with
  cost per ticket and share of revenue; an optional **AI campaign advisor** that reads the
  figures over SSH and never touches the data.
- **General expenses** the band carries outside any show, and who fronted them.

**For AI agents**: a read-only MCP server exposes the whole dataset as tools, so Claude
Desktop (or anything that speaks MCP) can answer questions against the real numbers.

## Stack

React 19 + Vite + Tailwind 4 on the front, Express + `better-sqlite3` on the back, one
SQLite file as the database. No external services are required to run it; every integration
(Morning, Google Calendar, Meta, SMTP, the SSH agent) is optional and reports itself as
unconfigured in the UI until its credentials are set.

## Quick start (local)

Requires Node 22.

```bash
git clone https://github.com/<your-github-user>/account-manager.git
cd account-manager/app
npm install
npm run dev            # http://localhost:3000
```

The first run creates the database and a single owner account:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SEED_OWNER_EMAIL` | `owner@example.com` | the owner's login |
| `SEED_OWNER_NAME` | `בעל/ת העסק` | the owner's display name |
| `SEED_OWNER_PASSWORD` | `changeme123` | the owner's password (**required** in production) |

Log in, then open **Settings** (הגדרות):

1. **כללי** — the app's name, the band's name, the VAT rate, the default producer fee.
2. **פרטי העסק** — your business details for document previews.
3. **חיבורים** — connect Morning, Google Calendar and Meta (see below).
4. **משתמשים** — add logins for band members.

Then in the band workspace, **ספקים וחברים** — add the members, review the cost lines, name
the supplier roles you hire for.

There is no sample data: invoices and expenses come from Morning, shows from the calendar,
and everything else is typed in.

## Configuration

Copy `.env.example` to `app/.env` (or `deploy/.env` for Docker) and fill in what you use.
Every variable is documented in that file; the short version:

| Integration | Variables | What it enables |
|-------------|-----------|-----------------|
| Morning / Green Invoice | `GREEN_INVOICE_ID`, `GREEN_INVOICE_SECRET` | pulling invoices and expenses, issuing documents |
| Google Calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | drawing shows and works from calendars, holding quote dates |
| Meta Ads | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` | campaign spend per show (read-only `ads_read`) |
| Email | `SMTP_USER`, `SMTP_PASS` | campaign-task reminder emails to members |
| AI advisor | `AGENT_SSH_*` or **Settings → סוכן AI** | the campaign advisor, reached over SSH |
| Links | `PUBLIC_BASE_URL` | the base of quote links and email links |

The detailed behaviour of every screen and integration is in
[`app/README.md`](app/README.md); the quotes feature has its own design note in
[`docs/QUOTES-DESIGN.md`](docs/QUOTES-DESIGN.md).

## Deploying

[`deploy/README.md`](deploy/README.md) walks through a production setup on a free-tier VM:
Docker Compose, a Cloudflare Tunnel (no open ports), backups, optional Cloudflare Access,
and setting up the SSH-reached AI agent. `.github/workflows/deploy.yml` redeploys on every
push to `master` once the three `DEPLOY_*` secrets are set.

```bash
cd deploy
cp .env.example .env && chmod 600 .env     # TUNNEL_TOKEN + SEED_OWNER_* are required
docker compose up -d --build
```

## Making it yours

Everything that was specific to the original band is now a setting or a row:

| What | Where |
|------|-------|
| The band's name (used in the UI, quote templates, emails, the advisor prompt) | Settings → כללי |
| The default producer fee | Settings → כללי |
| Who is in the band, who manages it | הלהקה → ספקים וחברים |
| The cost lines of a show | הלהקה → ספקים וחברים → שורות עלות בהופעה |
| The supplier roles you hire for | הלהקה → ספקים וחברים → סוגי ספקים |
| Which calendar events become shows or works | Settings → כללי יומן |
| Quote templates, branding, numbering prefix | הלהקה → הצעות מחיר → הגדרות |
| Expense recognition ratios for the dashboard | Settings → `expense_recognition_rates` |

The UI is Hebrew and the tax logic is Israeli (VAT periods, income-tax brackets, ביטוח
לאומי). Making the band a different kind of sub-business — a studio, a workshop — is a matter
of renaming the cost lines and roles; the routes and tables are still called `band`.

## Repository layout

```
app/            the web app (server/ is Express + SQLite, src/ is React)
deploy/         Dockerfile, docker-compose, VM setup and the SSH agent wrapper
docs/           design notes: architecture, quotes, data schema, n8n workflows
scripts/        optional Python helpers: collect utility bills, parse receipt PDFs,
                build an accountant package ("havila") from Morning
.claude/        skills and agent definitions for working on this repo with Claude Code
```

The Python helpers read `BILLS_ROOT` (a folder of receipt PDFs, one sub-folder per year)
from `.env`; see the docstrings at the top of each script. They are independent of the web
app.

## Privacy

This repository contains no books. Receipt PDFs, parsed ledgers, accountant packages, the
tax profile and the deadline calendar are all git-ignored (`.gitignore` lists them; copy the
`*.example.json` files to start your own). The seed creates only the owner account named in
the environment. If you fork this to run your own business, keep it that way: your data
lives in the SQLite file and in your own services, not in git.

## Contributing

`npm run lint` (typecheck), `npm test` and `npm run build` are what CI runs on every pull
request. The code is written to be read — most modules open with a comment explaining the
decision they encode — so when you change a behaviour, change the comment with it.
