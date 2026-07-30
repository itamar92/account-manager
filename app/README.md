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
  (default 90) and upserts them on the Morning document id, so re-running is safe. Local
  financial edits are preserved; only status, dates and totals are refreshed. Revenue
  documents get a work row per income line, and one placeholder work when Morning returns
  no line detail. VAT comes from the document when present, and is otherwise backed out of
  the total using the configured rate.
- **Push** — `POST /api/invoices/:id/push-to-morning` issues a local invoice as a real
  document and stores the returned id and number. An invoice that already exists in
  Morning is rejected with 409 rather than duplicated.

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
