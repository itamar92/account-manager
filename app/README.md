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

### Environment (optional, `.env`)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | 3000 | server port |
| `DATA_DIR` | `app/data` | where the SQLite file lives |
| `SEED_OWNER_PASSWORD` | `changeme123` | initial owner password |
| `SEED_BAND_PASSWORD` | `moonlight123` | initial band members password |

## Seeded users

| Email | Role | Access |
|-------|------|--------|
| `itamar92@gmail.com` | owner | everything |
| `amir@moonlight.band`, `yuval@moonlight.band`, `guy@moonlight.band` | band | `/moonlight` only, read-only |

**Change the default passwords** (or set the `SEED_*` env vars before first run).
First run also imports `../invoices_2026.csv` (Green Invoice export) and the Moonlight
Finance data as the initial dataset.

## Core logic

- **Works** (עבודות) are the atomic billable unit. Statuses: `unpaid → invoiced → paid`.
- **Create invoice from works**: select unpaid works of one client → an invoice is created
  atomically and the works become `invoiced`.
- **Mark invoice paid** → all its works become `paid`. Cancelling an invoice releases its
  works back to `unpaid`.
- **Moonlight private area**: `/moonlight` is visible to `band` users, but every personal
  accounting route/API is owner-only (enforced server-side, not just in the router).

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

Example — create an invoice from the Morning app flow:

```bash
curl -X POST https://<host>/api/v1/invoices \
  -H "X-API-Key: am_..." -H "Content-Type: application/json" \
  -d '{"client_name":"מופ\"א","line_items":[{"description":"הופעה","amount":10000}],"external_id":"gi_doc_id"}'
```
