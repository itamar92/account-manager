# account-manager

Personal accounting and invoicing automation for an Israeli sole proprietor (עוסק מורשה) — collects utility bills, parses expense receipts, and builds accountant handoff packages ("havila") from Green Invoice.

## Automation design

The full business-automation design (n8n workflows + Cowork agents + Google Sheets data
layer) lives in `docs/`:

- `docs/ARCHITECTURE.md` — overall design, the six agents, build order, Sheets-vs-DB decision
- `docs/DATA-SCHEMA.md` — the Google Sheets workbook schema (DB-migration-ready)
- `docs/N8N-WORKFLOWS.md` — specs for the seven n8n workflows
- `docs/SETUP-CHECKLIST.md` — phase-by-phase setup steps
- `.claude/agents/` — runnable Cowork agent definitions (invoice-intake, bank-reconciler,
  tax-compliance, receivables, payables)

## Structure

- `scripts/` — automation scripts (see Usage below)
- `bills/` — downloaded utility bill PDFs, organized by month/provider
- `havila/<period>/` — generated accountant packages (issued invoices, received expenses, cover sheet)
- `.claude/skills/` — Claude Code skills used to drive this repo (invoice parsing, bank transaction categorization)
- `expenses_2026.json`, `invoices_2026.csv`, `docs_2026*.json` — parsed/cached data files
- `utilities-config.json` — provider portal URLs used by `collect_bills.py`

## Setup

1. **Python**: requires Python 3.11+.
2. **Install dependencies**:
   ```
   pip install -r requirements.txt
   playwright install chromium
   ```
3. **Configure credentials**: copy `.env.example` to `.env` and fill in the values you need:
   ```
   cp .env.example .env
   ```
   - `GREEN_INVOICE_ID` / `GREEN_INVOICE_SECRET` — Green Invoice (Morning) API credentials, used by `build_havila.py`
   - `IEC_ID` / `IEC_PASSWORD`, `PARTNER_PHONE` / `PARTNER_PASSWORD`, `HOTMOBILE_PHONE` / `HOTMOBILE_PASSWORD`, `WATER_ACCOUNT` / `WATER_ID`, `ARNONA_ID` / `ARNONA_PROPERTY` — utility provider logins, used by `collect_bills.py`

   `.env` is git-ignored — never commit real credentials.

4. **Adjust hardcoded paths**: `scripts/build_havila.py` and `scripts/parse_expenses.py` currently hardcode `BILLS_ROOT` to a specific machine's Dropbox path. Update that constant to match your local path before running them.

## Usage

- **Collect utility bills** (opens a browser per provider for login/2FA):
  ```
  python scripts/collect_bills.py --provider all
  ```
- **Parse expense receipts** from `bills/` into `expenses_2026.json`:
  ```
  python scripts/parse_expenses.py
  ```
- **Build an accountant package** for a date range (downloads Green Invoice docs, matches expenses, writes a cover sheet):
  ```
  python scripts/build_havila.py 2026-01-01 2026-04-30
  ```
