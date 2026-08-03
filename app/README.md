# Account Manager — Web App

Unified accounting dashboard replacing the Google Sheets workbook: personal freelance
accounting (clients → works → invoices) + Moonlight Finance (band) in one app, with an
external API for the Morning app / client management system.

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS 4 + React Router (Hebrew, RTL, mobile & desktop)
- **Backend**: Express (tsx), session-cookie auth
- **DB**: SQLite (`better-sqlite3`) at `app/data/account-manager.db` — created and seeded on first run

## Run

```bash
cd app
npm install
npm run dev        # http://localhost:3000
```

Production: `npm run build && npm start`.

`npm run lint` (`tsc --noEmit`) and `npm run build` are what CI runs on every pull request
and every push to `master` — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml),
which uses the same Node 22 the container ships.

To deploy it on a server, see [`../deploy/README.md`](../deploy/README.md) —
Docker + Cloudflare Tunnel on an Oracle Always Free VM.

### Environment (optional, `.env`)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | 3000 | server port |
| `DATA_DIR` | `app/data` | where the SQLite file lives |
| `SEED_OWNER_PASSWORD` | `changeme123` | initial owner password |
| `SEED_BAND_PASSWORD` | `moonlight123` | initial band members password |
| `GREEN_INVOICE_ID` / `GREEN_INVOICE_SECRET` | — | Morning API credentials; without them the Morning sync is disabled |
| `GREEN_INVOICE_BASE_URL` | production API | point at `https://sandbox.d.greeninvoice.co.il/api/v1` to test the write path |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | — | OAuth credentials for the calendar sync; without them it is disabled |
| `GOOGLE_CALENDAR_ID` | `primary` | calendar holding the shows (also settable in the UI) |

## Seeded users

| Email | Role | Access |
|-------|------|--------|
| `itamar92@gmail.com` | owner | everything |
| `amir@moonlight.band`, `yuval@moonlight.band`, `guy@moonlight.band` | band | `/moonlight` only, read-only |

**Change the default passwords** (or set the `SEED_*` env vars before first run).
First run also imports `../invoices_2026.csv` (Green Invoice export) and the Moonlight
Finance data as the initial dataset.

Members are editable in **Settings → משתמשים**: name, email, role, and a new password —
left blank, the existing password stands, so details can be corrected without resetting
anyone's access. Setting a password ends that user's other sessions but not the one making
the change. Two guards keep the app reachable: the last owner cannot be demoted, and you
cannot demote yourself.

## Core logic

- **Works** (עבודות) are the atomic billable unit. Statuses: `unpaid → invoiced → paid`.
- **Create invoice from works**: select unpaid works of one client → an invoice is created
  atomically and the works become `invoiced`.
- **Bulk actions on the selection**: the same tick boxes also delete the selected works or
  move them to another client. The action bar sticks to the top of the window, so it stays
  reachable however far down the table you have scrolled. Only unpaid works can be deleted
  or moved — anything already on an invoice is reported back as skipped rather than
  silently changed. Deleting works the calendar created offers to pin their events out too,
  since otherwise the next sync would simply draw them again.
- **Mark invoice paid** → all its works become `paid`. Cancelling an invoice releases its
  works back to `unpaid`.
- **Delete a client** (`DELETE /api/clients/:id`) with three guards: a client holding
  invoices is refused outright — that is billing history, and the invoices would be left
  pointing at nothing; a client an *enabled* calendar rule feeds is refused too, since the
  next sync would recreate both it and its works; and uninvoiced works are only deleted
  along with it when the caller asks (`?delete_works=1`), which the UI does after saying
  how many.
- **Moonlight private area**: `/moonlight` is visible to `band` users, but every personal
  accounting route/API is owner-only (enforced server-side, not just in the router).
- **Deleting an expense row** (`DELETE /api/moonlight/event-expenses/:id`) means two
  different things, because every show owns exactly one row. A row assigned to a show is
  **emptied** — its amounts go, the empty row stays behind to type into, and the show's
  totals are recomputed (`{deleted: 0, cleared: 1}`). A row assigned to nothing — a leftover
  from before the two tables were linked — is **deleted** (`{deleted: 1, cleared: 0}`). The
  expenses tab labels the button accordingly (ניקוי / מחיקה) and says which it is doing
  before it does it. General expenses are plain rows and delete outright.
- **הוצאות** (`/expenses`) is the business's spending as Morning holds it: the year's
  expense documents with their supplier, classification and status, the totals for whatever
  the filters select — before VAT, input VAT (מע"מ תשומות) and what was actually paid — and
  a breakdown by classification whose rows double as a filter. It is read-only: an expense
  is entered and classified in Morning, and shown here beside the income it has to be set
  against. Rows Morning has not classified are filterable in their own right (ללא סיווג),
  since those are the ones a filing has to chase.

- **דוחות** (`/reports`) turns the same books into the two filings they have to produce —
  see [Reports](#reports-דוחות) below.

### Dashboard

The overview chart is income **and** expenses month by month, with profit drawn over them as
a line — it is the difference between the two, not a third quantity competing for the same
space. A year picker scopes the whole page, and a לפני מע"מ / כולל מע"מ switch decides
whether the figures count VAT: profit before VAT is the real one, since neither VAT figure is
the business's money, while the totals with VAT are what actually moved through the bank.

The money row above it — הכנסות, הוצאות, רווח for the year and רווח for the current month —
and the מע"מ card below both read the same monthly series the דוחות page reports, so the
dashboard and the reports can never tell different stories. The two outstanding-balance cards
(open invoices, uninvoiced works) are deliberately *not* year-scoped: an invoice issued last
December and still unpaid is money owed now, whichever year is on screen.

## Reports (דוחות)

Nothing on this page is entered by hand. Both reports are computed, every time they are
opened, from the documents Morning syncs in on the income side and the supplier documents it
syncs in on the outgoing one, so a report cannot drift from the lists it was built from.
Everything is on an **accrual basis** (מצטבר), which is what an Israeli מע"מ filing reports: a
document belongs to the period it was issued in, whether or not the money has arrived.
Credit invoices (330) are counted here and offset, since a period's turnover has to be net of
what was credited back — they arrive from Morning with negative amounts, so summing the set
does that netting for free.

### דוח מע"מ

One row per reporting period, bi-monthly by default and switchable to monthly in
**Settings → דוחות מס**: turnover and מע"מ עסקאות against expenses and מע"מ תשומות, and what
the period owes or is owed. The deadline is the 15th of the month after the period ends,
moved to Sunday when that falls on a Saturday — deferrals for חגים move every year and are
*not* computed, so a holiday deadline is one to check against the real calendar.

A period's status follows from the dates (תקופה פתוחה → להגשה → באיחור) until it is ticked
off. The **דווח** and **שולם** ticks are the one thing stored (`tax_filings`), because the
books cannot know it; unticking one leaves the reference typed against the other alone. The
page also counts expense documents Morning still holds as unreported in each period — their
input VAT is included in the figures either way, but they are worth chasing before filing.

### מס הכנסה

The year's profit and loss: monthly income, expenses and profit, expenses by classification
(before VAT — the deductible figure), and an estimate of what the profit will cost.

The estimate follows the real order — ביטוח לאומי is charged on the profit, 52% of it comes
off the income the brackets are applied to, and נקודות זיכוי come off the tax itself — and
for a year still running it is also projected to a full year from the months that have
closed. **It is an estimate**: the rates live in `TAX_RATES` in `server/reports.ts`, pinned to
the year they were published for and reported next to the figures so a table left behind by a
new tax year is visible rather than silently wrong, and the calculation knows nothing about
other income, pension deposits, personal reliefs or advances already paid. נקודות זיכוי are
set in **Settings → דוחות מס** (2.25 by default).

| Endpoint | Description |
|----------|-------------|
| `GET /api/reports/vat?year=` | periods with turnover, VAT both ways, balance, deadline and status |
| `GET /api/reports/income-tax?year=` | monthly P&L, expenses by classification, tax estimate and projection |
| `PUT /api/reports/filings/:kind/:periodKey` | tick a period `{filed?, paid?, amount?, reference?, notes?}` — `:kind` is `vat` or `income_tax` |

### Document types and revenue

A single sale usually produces two documents in Morning: a **חשבון עסקה (300)** when the
work is agreed, then a **חשבונית מס (320)** when it is billed. Both carry the full amount,
so totalling every document counts the sale twice.

`server/docTypes.ts` is the single place that decides what counts. Only **305** (חשבונית מס
קבלה) and **320** (חשבונית מס) are revenue — the same rule `scripts/build_havila.py` uses.
Non-revenue documents are still imported and listed (flagged in amber in the invoices
table) but are excluded from every total and never generate works.

### Invoice numbering

Morning owns the real, sequential document numbers. An invoice created in the app is
therefore numbered `AM-1`, `AM-2`, … until it is issued to Morning, at which point it
adopts the number Morning assigns. Numbering locally from `MAX(number)+1` would hand out
numbers Morning is going to issue itself.

## Integrations

Both are owner-only, run on demand from **Settings → חיבורים** (the calendar sync also has
a button on the Moonlight income tab), and report their configuration status in the UI so
a missing credential is visible rather than silent.

### Morning (Green Invoice)

- **Pull** — `POST /api/integrations/morning/sync` fetches documents from the last N days
  and upserts them on the Morning document id, so re-running is safe. N is
  **טווח סנכרון מ-Morning (ימים)** in Settings → כללי, 90 by default and bounded to 1–1825:
  a zero or negative window would ask Morning for a range that ends before it starts and
  quietly sync nothing. Because a sync refreshes every row it finds in full, widening the
  range and re-syncing is how rows pulled by an earlier version get corrected. Local
  financial edits are preserved; only status, dates and totals are refreshed. Revenue
  documents get a work row per income line, and one placeholder work when Morning returns
  no line detail. VAT comes from the document when present, and is otherwise backed out of
  the total using the configured rate.
- **Expenses** — the same sync also pulls the expense documents suppliers issued to the
  business (`POST /api/integrations/morning/expenses-sync` pulls only those, which is what
  the הוצאות page's own button calls). They are upserted on the Morning expense id into
  the `expenses` table and refreshed in full on every run: nothing about an expense is
  edited here, so a category or amount corrected in Morning is meant to arrive.

  **An expense does not have quite the shape of an issued document**, and two fields are
  easy to get wrong — both did, and both showed up in the table:

  | Field | Expense | Issued document |
  |-------|---------|-----------------|
  | document type | `documentType` | `type` |
  | סיווג / expense type | `accountingClassification`, an **object** named by `title` | — |
  | reported | `status` — 10 open, 20 reported (some payloads say `reported: true`) | `status` — 0 open, 1 closed |

  Reading the classification as a scalar is what wrote **`[object Object]`** into every
  category; reading the document type from `type` left the מסמך column without its label.
  The classification's own `title` is preferred, a bare id is resolved through the
  account's classifications map, and anything that names itself nowhere is left null so the
  row lands under **ללא סיווג** — findable — rather than under a number that means nothing.
  The reported flag is read from either spelling, and the status is compared after numeric
  coercion, so a payload sending `"20"` as a string does not silently mark everything open.

  Existing rows carrying `[object Object]` are cleared on boot rather than left to the next
  sync, which only refreshes its own window and would leave older rows with a category that
  is not a category — in the list and in the filter.

  Each synced row also keeps the Morning payload it was mapped from, in `expenses.raw`
  (server-side only; it is stripped before the list is sent to the browser). It is there so
  a field Morning spells differently than expected can be *seen* rather than guessed at.
  The sync result reports how many expenses came back reported, so the mapping is checkable
  from the UI: if Morning shows them filed and the count is 0, the flag is arriving
  somewhere `raw` will show.

  Their money is read the other way round from revenue. Morning reports the total in
  `amount` with VAT included, or — on accounts that send `amountTotal` — the total there
  and the pre-VAT figure in `amount`; both are read. A missing VAT figure is **not** backed
  out of the total the way an invoice's is, since suppliers who are עוסק פטור and expenses
  billed abroad carry no input VAT, and inventing some would overstate what may be
  reclaimed. Foreign-currency expenses are converted with the rate Morning sends and keep
  their original currency for display.

  If the expense half of the sync fails — an account whose plan does not expose expenses —
  the documents still land, and the reason is reported next to the result.

- **Push** — `POST /api/invoices/:id/push-to-morning` issues a local invoice as a real
  document and stores the returned id and number. An invoice that already exists in
  Morning is rejected with 409 rather than duplicated.

  Issuing goes through a two-step dialog rather than a bare confirm, because the document
  it produces cannot be deleted — only credited. `GET /api/invoices/:id/morning-draft`
  pre-fills the first step with the document's own fields, in the order they appear on the
  document: type (חשבון עסקה / חשבונית מס / חשבונית מס קבלה), client and email, document
  date, due date, subject (שם המסמך) and remarks. The second step renders the document as
  it will be issued, and only its final button calls the push. Confirming the dialog
  untouched issues exactly what the plain push would have.

  The preview's letterhead comes from **Settings → פרטי העסק** (`POST /api/settings/business`):
  name, business type, ח.פ / ע.מ, address, contact details and a logo URL, stored as
  `business_*` settings. They are local only — Morning holds the authoritative copy and
  renders the issued document from its own template, so nothing here is sent to it. With
  the details unset the preview says so rather than drawing an empty letterhead.

  The due date defaults to **שוטף + N** — end of the document's month plus the client's
  `payment_terms_days` (30 unless the client says otherwise) — and follows the document
  date until it is edited by hand. Whatever the dialog changed is written back to the local
  invoice too, and an email typed for a client that had none is saved to the client card so
  the next document fills it in. The document is only emailed to the client on an explicit
  tick.

### Google Calendar → shows and personal work

Which events get drawn is configured in **Settings → אילו אירועים למשוך מהיומן** as a list
of rules. Each rule reads one calendar and sends what it matches to one target, so band
shows and personal freelance work can be filtered completely differently — and a second
freelance client is another rule, not a code change.

| Field | Meaning |
|-------|---------|
| יומן | which calendar to read — a dropdown of the account's calendars, falling back to a free-text id when Google is not configured |
| מילות מפתח | drawn if any term appears in the title or description |
| מיילים של מארגנים | drawn if the organiser is one of these — for events you were **invited** to |
| מילות התעלמות | never drawn if any term appears; **overrides both include rules** |
| דלג על אירועים שסירבת להם | skip events you declined in the calendar |
| חפש גם בתיאור האירוע | search the description too, not just the title (off by default) |
| לקוח | personal rules only: which client the created works belong to — a dropdown of existing clients, with a free-text escape hatch for one that does not exist yet (the sync creates it on first use) |
| מחיר קבוע לאירוע | personal rules only: the agreed price per event for that client, before VAT. 0 (the default) leaves each work unpriced |

**Matching is title-only unless you opt in**, because descriptions carry running orders —
`17:30-19:30 בלנס / 20:30 הופעה` — that contain the keyword while saying nothing about
whose show it is. Against the real calendar, searching descriptions pulled four Karni Band
gigs into the band rule.

An event is included when a keyword matches **or** the organiser is listed. The organiser
path exists because an invitation you didn't create often doesn't carry the keyword at
all — a gig from `udi@karni-band.com` is just titled `קרניבנד חוליו איגלסיאס בפרדסיה`.
Because that same organiser also sends rehearsals, ignore words are checked first and beat
both include rules.

**Terms are matched as substrings, so a shorter stem catches more word forms.** `חזר`
matches both `חזרה` and `חזרת`; the full word `חזרה` would miss `חזרת אלטון`. The seeded
defaults use stems for this reason.

**Targets**

- `band` → upserts into `band_events`. **Financial columns are never written by the sync**
  — only venue, date and location. A show entered by hand is adopted rather than
  duplicated: same date and same name first, then any hand-entered show on that date.
- `personal` → creates an unpaid **work** under the rule's client, priced at the rule's
  fixed amount or left at 0 for you to price. A work already on the table for that client,
  date and name is adopted instead of duplicated. An amount you entered is never
  overwritten — a fixed price only fills a work still sitting at 0, so adding one to a rule
  prices everything it drew that you have not touched. Once the work has been invoiced the
  sync stops touching it entirely, and a rule with no client creates nothing and reports the
  events as skipped.

**The name a synced row is stored under is not the calendar title.** Two things come off it:

1. **Show words, always**: `הופעה`, `הופעות`, `מופע`, `מופעים`, `גיג`, `גיגים`, `show`,
   `shows`, `gig`, `gigs`. They mark an entry as a show without naming it, so they are noise
   in the venue column wherever they stand and are removed from every synced title along
   with any separator they leave dangling. Whole words only — `הופעת בכורה` and `גיגית` are
   untouched.
2. **The rule's own keywords, off the front**: the word naming the act is noise in that
   column too. Only leading occurrences go, since a keyword in the middle of a name is
   usually part of it.

So a rule keyed on `קולדפליי` stores `הופעה קולדפליי גריי תל אביב` as **`גריי תל אביב`**. A
title made entirely of these words keeps its original text rather than being stored blank,
and the preview shows the name each row would actually be stored under.

**A name you type by hand wins from then on.** Renaming a synced show (or a synced work's
description) sets `venue_locked` / `description_locked`, and the next sync updates that
row's date and location while leaving the name alone — so a correction is not undone by
re-syncing. A show adopted by date whose hand-typed name differs from the calendar title is
locked on adoption for the same reason. The lock is shown as a ✎ next to the name in the
income tab; clicking it hands the name back to the calendar, and the next sync renames the
row to the cleaned title again.

**Nothing is drawn twice.** The event id is the primary link, and a row that predates it is
matched on date + name (compared ignoring case and spacing), so connecting the calendar to
a table you had been keeping by hand links the rows instead of doubling them.

A cancelled calendar event is removed only while its row holds no money of your own — an
untouched 0, or exactly the fixed price the sync itself wrote.

**Preview before you trust it.** `POST /api/calendar-rules/:id/preview` (the
**תצוגה מקדימה** button) is a dry run that writes nothing and lists every event in the
window with the reason it was let in or left out — matched keyword, matched organiser,
which ignore word caught it, or declined. Pass `:id` as `draft` with a `rule` body to try
a rule that hasn't been saved yet.

Everything about a rule is editable while the app runs, and a change takes effect on the
next preview or sync. Deciding that Karni Band rehearsals are billable after all is just
clearing `חזר` out of that rule's ignore words — no redeploy, no migration.

### Manual overrides — when a rule gets one wrong

Rules are patterns, so they will always be slightly wrong at the edges. Any single event
can be pinned by hand, and **a manual decision beats every rule**:

- **אל תמשוך / לא הופעה / לא עבודה** — never draw this event again. Available on a preview
  row, on a synced show in Moonlight, and on a synced work in the works list.
- **משוך בכל זאת** — always draw this event for this rule, whatever the keywords say. Pinned
  to one rule, so it cannot leak into another.

Excluding also deletes the row the event already produced — **unless that row holds money**,
in which case the row is kept and the UI says so. An exclusion is a filtering decision, not
a licence to delete bookkeeping.

Overrides survive re-syncs (that is the point) and are listed under **החלטות ידניות** in
Settings, each with an undo.

| Endpoint | Description |
|----------|-------------|
| `GET /api/integrations/calendar/calendars` | the account's calendars, for the picker |
| `GET /api/calendar-overrides` | list manual decisions |
| `POST /api/calendar-overrides` | pin an event `{event_id, action: exclude\|include, rule_id?}` |
| `DELETE /api/calendar-overrides/:eventId` | undo a manual decision |

| Endpoint | Description |
|----------|-------------|
| `GET /api/calendar-rules` | list rules |
| `POST /api/calendar-rules` | create a rule |
| `PUT /api/calendar-rules/:id` | update a rule |
| `DELETE /api/calendar-rules/:id` | delete a rule |
| `POST /api/calendar-rules/:id/preview` | dry run — what it would draw, and why |
| `POST /api/integrations/calendar/sync` | run all enabled rules, or one via `rule_id` |

## External API (`/api/v1`)

Create an API key in **Settings → מפתחות API**, then send it as the `X-API-Key` header.
Intended for the Morning app integration / client management system.

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/clients` | list clients |
| `GET /api/v1/works?client_name=&status=unpaid` | list works |
| `POST /api/v1/works` | push a work `{client_name, date, description, amount}` (client auto-created) |
| `POST /api/v1/invoices` | create invoice `{client_name?, client_id?, work_ids?, line_items?, external_id?}` |
| `POST /api/v1/invoices/:id/paid` | mark paid — `:id` matches internal id, invoice number, or `external_id` (Morning doc id) |

Note this API is *inbound* — it is how an external system pushes into the app. The app's
own outbound calls to Morning are the integration described above.

Example — create an invoice from the Morning app flow:

```bash
curl -X POST https://<host>/api/v1/invoices \
  -H "X-API-Key: am_..." -H "Content-Type: application/json" \
  -d '{"client_name":"מופ\"א","line_items":[{"description":"הופעה","amount":10000}],"external_id":"gi_doc_id"}'
```
