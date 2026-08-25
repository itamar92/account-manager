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
| `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID` | — | Meta Ads system-user token (`ads_read`) and the ad account; without them the Meta sync is disabled |
| `META_API_VERSION` | `v25.0` | Graph API version |
| `META_GRAPH_URL` | `https://graph.facebook.com` | base URL override, for pointing the sync at a stub |
| `APP_SECRET_KEY` | a generated `secret.key` beside the database | encrypts the secrets saved from the UI (the agent's SSH key). See below |

The `AGENT_SSH_*` variables below are now the **fallback** for **Settings → סוכן AI**, which is
where the agent's connection details are normally entered. Anything saved in that form wins;
a field left empty there falls back to these, so an existing deployment keeps working untouched.

| Variable | Default | Meaning |
|----------|---------|---------|
| `AGENT_SSH_HOST` / `AGENT_SSH_PORT` / `AGENT_SSH_USER` | — / `22` / — | the machine the AI agent runs on; without them (and without the form) the יועץ קמפיינים tab is disabled |
| `AGENT_SSH_KEY` or `AGENT_SSH_KEY_PATH` | — | the private key, inline (`\n` for newlines) or as a file |
| `AGENT_SSH_PASSPHRASE` | — | the key's passphrase, if it has one |
| `AGENT_SSH_HOST_KEY` | — | the agent host's public key, from `ssh-keyscan`. **Required in production** |
| `AGENT_COMMAND` | `claude -p --output-format json` | the fixed command run on that machine; the prompt goes to its stdin |
| `AGENT_TIMEOUT_MS` | `120000` | how long a single run may take before the connection is dropped |

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
- **A show is one page** (`/moonlight/shows/:id`). Its income, its twelve cost lines, who is
  staffed on it, and how its profit divides all live there and are edited in place —
  `GET /api/moonlight/events/:id` returns the lot in one request. The three tables this
  replaced (הכנסות / הוצאות הופעות / שיבוצים) meant one gig's numbers had to be assembled by
  reading across three tabs. What stayed at list level is what genuinely spans shows: the
  summary, the supplier ledger, costs belonging to no show, and ad spend.
- **Deleting an expense row** (`DELETE /api/moonlight/event-expenses/:id`) means two
  different things, because every show owns exactly one row. A row assigned to a show is
  **emptied** — its amounts go, the empty row stays behind to type into, and the show's
  totals are recomputed (`{deleted: 0, cleared: 1}`). A row assigned to nothing — a leftover
  from before the two tables were linked — is **deleted** (`{deleted: 1, cleared: 0}`). The
  unattached rows are listed on the shows page, where each can be pointed at the show it
  belongs to. General expenses are plain rows and delete outright.
- **הוצאות** (`/expenses`) is the business's spending as Morning holds it: the year's
  expense documents with their supplier, classification and status, the totals for whatever
  the filters select — before VAT, input VAT (מע"מ תשומות) and what was actually paid — and
  a breakdown by classification whose rows double as a filter. It is read-only: an expense
  is entered and classified in Morning, and shown here beside the income it has to be set
  against. Rows Morning has not classified are filterable in their own right (ללא סיווג),
  since those are the ones a filing has to chase.

  A row's status is דווח, טרם דווח, or **סטטוס לא ידוע** — the last meaning Morning's payload
  carried no field this app recognises as saying which. Note that a live account sends
  `status: 10` on every expense and no reported flag at all, so what 10 and 20 mean is still
  unconfirmed and the דווח/טרם דווח label on them is not yet something to trust.
  `reportingDate`, stored as `reporting_date` and shown under the date when it falls in another
  month, is the one field in the payload unambiguously about reporting: the מע"מ period Morning
  files the expense under. The מע"מ report still groups expenses by their document date, so an
  expense Morning reports in another period is counted here in a different one than in Morning.

  **Spent and deductible are two different figures**, and both are kept. Morning applies the
  deduction percentage on an expense's classification and states what is left as
  `deductibleAmount` / `deductibleVat` — for a phone bill at 66% they are two thirds of the
  document's. Anything that claims money back counts the deductible ones: מע"מ תשומות here and
  on דוחות, and the expenses the P&L deducts. Anything about money that actually left the
  business counts the full ones: the סה"כ הוצאות card and the dashboard's כולל מע"מ view. Where
  the two differ the page shows both, since the gap is real money that cannot be reclaimed. An
  expense whose payload states no deduction is stored null and counts in full, which is what
  this app did before it read the field; rows synced before the columns existed are backfilled
  on boot from the payload in `raw` rather than left half-corrected until the next sync. It is a real third state rather than a
  tidier default, because the alternative is what the list used to do: read a payload it could
  not understand and show the account's every filed expense as טרם דווח, which is both wrong
  and invisible. `GET /api/expenses/status-audit` (owner) and `npm run expenses:probe` both
  report, from the payloads the sync kept in `expenses.raw`, which keys Morning actually sends
  and what the ones carrying a code hold — the way to settle which field carries the fact for a
  given account, instead of guessing at a name that sounds right. They look for the shape of an
  enum rather than for a promising name, because the names have already misled: the same
  payloads put values outside the issued-document enum (405, 20) in the key read as
  `documentType`, so the מסמך column is blank for them and an expense evidently does not use an
  issued document's fields or codes. The probe additionally fetches one expense in full, since
  Morning's search returns a lighter row than the record behind it.

- **דוחות** (`/reports`) turns the same books into the two filings they have to produce —
  see [Reports](#reports-דוחות) below.

### The shell — two workspaces, one app

The app is split into a **business** side and a **Moonlight** side, switched from the pill in
the header. They are separate books, so they get separate navigation and separate accent
colours: the switch sets `data-ws` on `<html>`, and every accent, canvas and border in
`src/index.css` hangs off that one attribute — no component knows which workspace it is being
shown in. Band members only ever see the Moonlight side, enforced server-side as before.

Colours are named for what they are for rather than what they are (`bg-surface`, `text-muted`,
`border-line`, `text-pos` / `text-warn` / `text-neg`), so a page never hard-codes a palette.
The one dark slab per screen (`InkPanel`) is reserved for the single figure that page exists
to report.

### מה דורש טיפול (`/`)

The landing page is not a summary of the year but a list of what is unfinished: invoices past
their due date, works not yet billed, expenses with no classification (input VAT that will not
make it into a return), shows whose money has not arrived, and shows with a role unstaffed.
Every item is **derived** — `GET /api/inbox` recomputes them from the books on each load — so
an item disappears by being dealt with, never by being dismissed, and the count on the sidebar
badge is the same number the page shows because the server counts it once.

The one VAT period with a deadline in front of it gets the dark slab; the year's figures moved
one click over, to **סקירה** (`/overview`).

### Dashboard (סקירה)

The page opens on one panel (`GET /api/dashboard/overview`, `app/server/overview.ts`) holding
three figures — **סה"כ הכנסות**, **סה"כ הוצאות מוכרות**, **סה"כ מע"מ לתשלום** — the months
behind them, and where the money that came in came from. Each figure carries a badge saying
how it moved against the same window one unit earlier, so "this year to 25 August" is measured
against last year to 25 August rather than against a full twelve months it was never going to
match.

Two controls decide what the panel counts:

- **לתקופה** — שנה נוכחית, שנה קודמת, רבעון נוכחי, חודש נוכחי, חודש קודם, or 12 החודשים
  האחרונים. A period still running ends *today* rather than at its calendar end: drawing this
  year to December would put four empty months on the chart and make every comparison look
  like a collapse. The chosen window's year also scopes the cards below the panel, so the page
  never asks the same question twice in two places.
- **חישוב הוצאות** — `מוכר למס הכנסה` weights every expense by the share its category is
  deductible at (45% on the car, 15% on the household bills a home office sits behind, 80% on
  communications — the ratios `expense-inventory-2026.md` already books by), and scales the
  input VAT on it the same way. `סכום מלא` turns that off and shows the money as it actually
  left the bank. The ratios are defaults, not a rule: `expense_recognition_rates` in settings
  overrides any of them by category name (`GET`/`PUT /api/settings/expense-recognition`).

The chart stacks each side's VAT on top of it rather than drawing four competing bars — the
VAT is the part of that bar that was never the business's money, not a quantity of its own.
Beside it, **פילוח תקבולים לפי לקוחות עיקריים** rings the period's *receipts* by client: money
that has actually come in, so a large invoice still sitting open does not colour a slice it has
not paid for yet.

Income comes from the same monthly series the דוחות page reports, so the dashboard and the
reports can never tell different stories. The two outstanding-balance cards below the panel
(open invoices, uninvoiced works) are deliberately *not* year-scoped: an invoice issued last
December and still unpaid is money owed now, whichever period is on screen.

## Reports (דוחות)

Nothing on this page is entered by hand. Both reports are computed, every time they are
opened, from the documents Morning syncs in on the income side and the supplier documents it
syncs in on the outgoing one, so a report cannot drift from the lists it was built from.
Everything is on an **accrual basis** (מצטבר), which is what an Israeli מע"מ filing reports: a
document belongs to the period it was issued in, whether or not the money has arrived.

The two reports differ on one point, deliberately. **מע"מ counts an expense in the period
Morning reports it in** (`reporting_date`, falling back to the document date) — a filing has to
agree with Morning about which period reports which expense, or the input VAT claimed for a
period is not the input VAT Morning reported for it, and an expense dated in December but
reported in January belongs to January's filing. **מס הכנסה and the dashboard count it in the
month it is dated**, which is the year the expense was incurred and the year a return covers.
So a period on דוחות need not match the same months on הוצאות, which lists by document date;
the מע"מ page says how many expenses in the year are shifted that way.

`monthlyPnl(from, to, basis)` is where this lives — one query, one `ExpenseBasis` argument, so
neither report can drift from the other on anything except the date it is asked to use.
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

### Filtering by period

Every dated list — works, invoices, expenses and all four Moonlight tabs — filters by year and,
within it, by a single month. A month is only meaningful inside a year, so the month select is
disabled while the year is "כל השנים" and the server ignores a month sent without one: "March"
of no particular year is not a period. Both selects go through one `dateRange` on the server, so
every list narrows the same way and there is one place where a period is turned into dates.

### Moonlight — how the division is worked out

The band's summary shows what each member is owed **and how that figure was reached**, laid out
in the three steps their spreadsheet has always used, because the point is that the total can be
checked rather than trusted:

1. every show not yet marked «שולם לנגנים» contributes its per-member share of the profit;
2. **plus** a general expense a member paid out of their own pocket, added back to them in full —
   that is a refund, not a share of anything;
3. **minus** an equal part of what the band's float (קופה) covered, since everybody bore it.

`paid` on a general expense is what settled means here — the moonlight migration set it from the
sheet's «הוחזר» columns — so a row already squared takes no further part. `GET /api/moonlight/division`
returns each step with the rows behind it.

The card always shows two figures per member: **חלק ברווח**, their share once the shared costs
are off but before any refund, and **סה״כ לתשלום**, the same plus what they fronted. They are
separate because a refund is the band handing someone their own money back rather than a share of
anything — counted in, one member looks like they earned more than the rest, and the line that
says how the shows actually went for everybody disappears.

**איך זה מחושב?** opens the whole working — every show with its shares, each adjustment, and the
list of exactly which expenses were refunded and which the float paid — so no figure is
unaccounted for. The shared costs come off before the refunds go back on, so both of the figures
on the card appear in the working as lines of it.

### Moonlight — the producer fee

`computeDivision` splits a show's profit: `commission_percent` of it is the producer fee, going to
איתמר and אמיר in equal halves, and the rest is shared equally by all four. The percentage is the
**whole** fee, so 20% nets 30/30/20/20 and 40% nets 35/35/15/15. It is stored per show, because
what the fee is worth is a decision about that show, and it is set with the stepper on the show
page beside the tick that turns it on. With the fee off (or at 0%) it is a plain
quarter each; a row set to manual keeps whatever was typed on it.

The default is **20% (30/30/20/20)**. It was a fixed 40% before, so a one-time migration stamps
`commission_percent = 40` on shows already marked «שולם לנגנים» — their profit has changed hands
under the old figure, and the boot recompute would otherwise silently re-divide it while leaving
the percentage on the row unable to explain the shares beside it. Every show still open takes the
new default, which is the point of changing it.

### Document types and revenue

A single sale usually produces two documents in Morning: a **חשבון עסקה (300)** when the
work is agreed, then a **חשבונית מס (320)** when it is billed. Both carry the full amount,
so totalling every document counts the sale twice.

`server/docTypes.ts` is the single place that decides what counts. Only **305** (חשבונית מס
קבלה) and **320** (חשבונית מס) are revenue — the same rule `scripts/build_havila.py` uses.
Non-revenue documents are still imported and listed (flagged in amber in the invoices
table) but are excluded from every total and never generate works.

### Invoice numbering, and when an invoice comes into existence

Morning owns the real, sequential document numbers. Numbering locally from `MAX(number)+1`
would hand out numbers Morning is going to issue itself, so an invoice that exists only here
carries a prefixed `AM-1`, `AM-2`, … until it is issued, at which point it adopts the number
Morning assigns.

**Billing works does not create one of those rows.** Ticking works and pressing
**צור חשבונית** — from the works list or from the חשבונית תקופתית dialog — opens the issue
dialog directly, and the invoice is created from the document Morning returns, carrying
Morning's own number and id from the moment it exists. Creating the local row first meant
every abandoned or refused issue left behind an `AM-*` invoice that looked, in a list of
invoices, exactly like a document that had really been issued.

`AM-*` rows still arise — from the API, from a push that has not happened yet, and from the
one fallback the dialog offers when Morning is unconfigured — and they can be **deleted**
(`DELETE /api/invoices/:id`), which puts their works back in the unpaid pool to be billed
again. Deletion is refused the moment `external_id` is set: that document is in the state's
books and can only be credited.

## Integrations

Both are owner-only, run on demand from **Settings → חיבורים** (the calendar sync also has
a button on the Moonlight shows page), and report their configuration status in the UI so
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

- **Push** — two endpoints reach the same `createDocument` call, from the two things that
  can become a document:

  - `POST /api/invoices/issue-to-morning` takes a client and a set of unbilled works, issues
    the document, and **then** creates the local invoice from what Morning returned. This is
    the path the צור חשבונית button takes. Every work is validated — it exists, it is the
    client's, it is unbilled — before Morning is called, since a document Morning has issued
    cannot be withdrawn. If the local write fails after the document exists, the error says
    so with the document's number rather than reporting a failure to issue, which would
    invite issuing it twice.
  - `POST /api/invoices/:id/push-to-morning` issues an invoice that is already here — an
    `AM-*` row from the API or the offline fallback — and stores the returned id and number.
    An invoice that already exists in Morning is rejected with 409 rather than duplicated.

  A Morning document line is a description and a price; there is **no date column**. So each
  work's date is folded into its own line text — `הופעה בהאנגר (14/03/2026)` — which is the
  only place the date can survive onto the issued document. The preview renders the joined
  line rather than a date column of its own, since a column the document does not have is a
  lie about it.

  Issuing goes through a two-step dialog rather than a bare confirm, because the document
  it produces cannot be deleted — only credited. `GET /api/invoices/:id/morning-draft` (or
  `POST /api/invoices/morning-draft` with `client_id` and `work_ids`, for works that have no
  invoice yet) pre-fills the first step with the document's own fields, in the order they appear on the
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

  With Morning unconfigured there would otherwise be no way to bill at all, so the dialog
  offers one way out for works that have no invoice: keep the selection as a local `AM-*`
  invoice, to be issued once Morning is configured.

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
locked on adoption for the same reason. A locked show carries a «מהיומן» badge on its page,
and renaming it there is what sets the lock.

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

### Meta Ads → what a show's promotion cost

Ad spend per show, pulled from the Meta Marketing API. It fills a column the band's books
already had: **קמפיין** on each show's expense row, typed by hand until now. **Moonlight →
פרסום** is where the result is read and where the mapping is done.

Setup is a system-user token, described in [`.env.example`](../.env.example) — reading your own
ad account with `ads_read` needs no App Review, so it is about fifteen minutes of Business
Settings and nothing else.

**Which campaign paid for which show is decided by hand.** A campaign name is written for
people ("זאפה חיפה 7.1 - הופעה"), and a campaign that promoted a whole run of shows cannot be
divided by any rule the data supports — so the sync proposes and a person confirms. Each
unmapped campaign is offered up to three suggestions, scored on the venue's name appearing in
the campaign's name, a date in the campaign name matching the show's, and the spend having
happened in the three weeks before it. The reason behind each score is shown next to it, so a
suggestion can be judged rather than trusted. Nothing is written until one is accepted.

A campaign mapped to several shows is **split by weight** — 1 everywhere (the default) is an
equal split. Weights are summed per campaign when they are read rather than stored as
fractions, so mapping a fourth show to a campaign that had three re-divides it correctly
instead of leaving three thirds and an orphan.

**A hand-typed קמפיין figure is never overwritten.** Editing the cell locks it, the same
bargain a renamed show strikes with the calendar sync, and each sync reports how many rows it
held back. Every figure that predates this integration is locked on migration too: those
numbers are history, not a blank to fill, and silently rewriting them would move what the band
is owed on shows already divided up. **לסנכרון** on the פרסום tab hands a row over
deliberately, and asks first.

The analysis reports Meta's figure and the books' figure side by side, and flags where they
disagree — the gap is worth seeing rather than smoothing. Two more things it does not hide:
spend on campaigns no show claims is totalled separately (**פרסום לא משויך**), so a total can
always be read against the account's real spend; and `cost_per_ticket` is null rather than 0
for a show with no ticket count, since dividing by nothing is not a cost of zero.

#### Monthly invoices vs. per-show cost — two different partitions

Ads are billed **monthly**, but a campaign started at the end of a month keeps running into the
next two. So one campaign lands on two or three invoices, and any one invoice is a slice of
several campaigns rather than the cost of anything in particular. A campaign spending ₪1,000 in
October, ₪6,000 in November and ₪6,000 in December cost ₪13,000 and promoted one show.

The page answers both questions separately, because they are not the same partition of the money:

- **עלות פרסום לפי הופעה** — a show's promotion costs what its campaigns cost, whichever months
  those landed in. This is the figure that says whether a show was worth advertising, and it is
  what goes in the show's books. Rows show how many monthly invoices the spend spans.
- **חיוב חודשי מ-Meta** — one row per month, i.e. per invoice, expandable into the campaigns
  behind it. Each campaign is marked `2/3` for the month you are looking at, with its full cost
  beside it, so an invoice in hand can be reconciled and it is obvious when more is still coming.

**A show already marked «שולם לנגנים» is frozen**, and this matters precisely because campaigns
outlive shows. Without it, a campaign still spending in January would raise a December show's
costs, re-divide its profit, and change what each member is owed for a night whose money has
already changed hands. Growth after the payout still appears in the monthly breakdown and the
unattributed totals — it just never rewrites a settled division. Each sync reports how many shows
it froze and how many of those have in fact moved on (`settled_stale`), and the show's row flags
it, so this is visible rather than silent.

**Two caveats worth knowing.** Meta's reported `spend` is management reporting, not a tax
document — the deductible expense stays the Meta invoice that Morning syncs in, and the two
will differ slightly. And spend arrives in the ad account's own currency: an account not billed
in shekels needs a rate in **Settings → חיבורים**, and until it has one the sync writes nothing
at all rather than putting dollars in a shekel column.

| Endpoint | Description |
|----------|-------------|
| `POST /api/integrations/meta/sync` | pull campaigns + daily spend, then apply to mapped shows |
| `GET /api/integrations/meta/campaigns` | campaigns with mappings, shares and suggestions (`?unmapped=1`) |
| `GET /api/integrations/meta/campaigns/:id/daily` | one campaign's daily spend curve |
| `POST /api/integrations/meta/campaigns/:id/mappings` | map to a show `{event_id, weight?}` |
| `DELETE /api/integrations/meta/campaigns/:id/mappings/:eventId` | unmap (the show keeps its figure) |
| `GET /api/moonlight/ad-analysis?year=&month=` | cost per show: spend, cost per ticket, share of revenue |
| `GET /api/moonlight/ad-monthly?year=&month=` | spend per calendar month (per invoice), with the campaigns and shows behind each |

## יועץ קמפיינים — the AI advisor (Moonlight → יועץ קמפיינים)

The פרסום tab says what a show's promotion **cost**. This one asks whether it was worth it:
a verdict on the period, findings tied to specific shows and campaigns, ranked suggestions, a
drafted plan for a show that has not happened yet, and a box for follow-up questions.

**It reaches the AI over SSH, not over an API.** The agent runs as a command-line tool on another
machine where it is already logged in; the app opens an SSH session, writes the prompt to that
command's **stdin** and reads the answer back. What this buys is the credential: the app holds a
key to one fixed command on somebody else's box, and no AI API key exists in this container, in
the database, or in any error that reaches a browser.

Three properties are deliberate and worth keeping:

- **The prompt never touches a command line.** The command is fixed by the server's
  configuration and is never assembled from a request, so no text — typed, or arriving from
  Meta — can extend it. The command is settable in Settings, and the shell metacharacters that
  would turn one command into two are refused there.
- **The host key is pinned.** Without a pin, whoever answers the address gets the key; unset,
  the app refuses to connect in production.
- **Nothing the agent says takes effect.** It reads a JSON extract — shows, tickets, revenue,
  campaigns, spend curves — and returns text. It gets no database handle, no Meta token and no
  write path, and the member division is deliberately not in the extract it is sent.

Reports are stored, so opening the tab paints the last one instead of spending a minute on a page
load; a run happens only when the owner presses the button. Band members read along.

| Endpoint | Description |
|----------|-------------|
| `GET /api/moonlight/campaign-analysis?year=&month=` | the last stored report for the period — no SSH |
| `POST /api/moonlight/campaign-analysis?year=&month=` | spend a run: analyse the period afresh (owner) |
| `GET /api/moonlight/campaign-draft/:eventId` | the last campaign plan drafted for a show |
| `POST /api/moonlight/campaign-draft` | draft a plan `{event_id, brief?}` (owner) |
| `GET /api/moonlight/campaign-chat` | the follow-up thread |
| `POST /api/moonlight/campaign-chat` | ask a follow-up `{message}` (owner) |
| `DELETE /api/moonlight/campaign-chat` | clear the thread (owner) |
| `POST /api/integrations/agent/ping` | connectivity test: opens the session, asks the agent its version |
| `GET /api/settings/agent` | the stored connection details, minus the secrets (owner) |
| `POST /api/settings/agent` | save them (owner) |

### Where the connection details live

**Settings → סוכן AI** holds host, port, user, private key, passphrase, pinned host key, command
and timeout. Each field falls back to its `AGENT_SSH_*` variable when the form leaves it empty,
and the form says beside every field when the value it is showing came from the environment —
so there is one place to look when the two disagree.

The private key and its passphrase are stored **encrypted** (AES-256-GCM, `secrets.ts`) with a
key held outside the database: `APP_SECRET_KEY` if it is set, otherwise `secret.key` next to the
SQLite file, generated on first use with mode 600. That file belongs in the same backup as the
database — restoring one without the other leaves the stored key unreadable, which the settings
page reports and fixes by pasting the key again.

Neither secret is ever sent back to the browser. The form identifies the stored key by its type
and SHA256 fingerprint, and a key is validated with ssh2's own parser on save, so a truncated
paste or a missing passphrase is caught there rather than by a failed analysis a minute later.

Setting the agent host up is in [`../deploy/README.md`](../deploy/README.md).

## MCP server (`/mcp`) — read-only access for AI agents

Lets an outside AI agent — Claude Desktop, claude.ai, anything that speaks
[MCP](https://modelcontextprotocol.io) — read this app's data and answer questions against it,
the way the in-app advisor does for campaigns but across the whole dataset.

**Everything it exposes is a read.** There is no write path: not a guarded one, not a "safe"
subset. An assistant that can tell you a client is overdue is useful; an assistant that can issue
an invoice because a web page it read told it to is a liability, and the app's own UI is three
clicks away. The tool list in `server/mcpTools.ts` is the entire authorization surface — a tool
that is not in that file does not exist.

Every tool calls the same reader the browser's own screens call (`queries.ts`, `reports.ts`,
`metaSync.ts`, …), so the agent and the screen can never disagree about what a number is.

| Tool | Returns |
|------|---------|
| `get_overview` | Orientation: what the app holds, P&L by month, money owed, band totals |
| `list_clients` | Clients with uninvoiced work and unpaid invoices |
| `list_works` | Billable jobs, filterable by status, client and date |
| `list_invoices` | Issued documents, with document type and whether each counts as revenue |
| `list_expenses` | Expenses with categories and the input-VAT summary |
| `get_tax_report` | מע"מ and income tax for a year |
| `moonlight_shows` | The band's shows: tickets, fee, expenses, profit, division |
| `moonlight_summary` | Band totals, what each member is owed, and the follow-up lists |
| `moonlight_assignments` | Staffing per show, suppliers, and what each is owed |
| `moonlight_ad_analysis` | Ad spend per show against tickets and revenue |
| `moonlight_campaigns` | Meta campaigns, their mappings, and daily spend curves |
| `moonlight_campaign_advice` | The last stored verdict from the in-app advisor |

Results are capped at 500 rows per call (`truncated: true` says when the cap bit), so one broad
question cannot pull the whole database into a context window.

### Authentication

The endpoint uses the same `X-API-Key` mechanism as `/api/v1` — create a key in
**Settings → מפתחות API**, where it is shown exactly once. Revoking the key cuts the agent off
like any other client.

### Connecting Claude Desktop

Claude Desktop launches local MCP servers as a child process and passes secrets through `env`;
its remote-connector flow takes a URL and expects OAuth. `bin/mcp-bridge.mjs` is the short path
between the two — a dependency-free relay that pipes JSON-RPC frames to `/mcp` with the key
attached. Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "account-manager": {
      "command": "node",
      "args": ["/absolute/path/to/account-manager/app/bin/mcp-bridge.mjs"],
      "env": {
        "AM_URL": "https://im-tools.org/mcp",
        "AM_API_KEY": "am_…"
      }
    }
  }
}
```

Restart Claude Desktop; the tools appear in the connector list. Point `AM_URL` at
`http://127.0.0.1:3000/mcp` to develop against a local server. The bridge understands no MCP
whatsoever — every protocol decision lives in `server/mcpServer.ts`, so adding a tool changes the
server and the bridge keeps working untouched.

Any client that can send a header can skip the bridge and POST straight to `https://im-tools.org/mcp`.

### Protocol notes

Streamable HTTP, **stateless**: every POST is a complete exchange answered with plain JSON, so
there is no session table, no stream to reconnect, and nothing to clean up when a client
disappears. `GET /mcp` returns 405 — this server never initiates messages. Protocol revisions
`2024-11-05` through `2025-11-25` are accepted.

The protocol is implemented directly rather than via the official SDK: that SDK would pull Hono,
Express 5, jose, ajv, cors and an OAuth client into an app that runs Express 4 with fifteen
hand-picked dependencies, and a stateless tools-only server is a couple hundred lines of
well-specified JSON-RPC. That trade would look different the day this needs sessions or OAuth.

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
