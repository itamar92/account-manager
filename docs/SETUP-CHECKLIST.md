# Setup Checklist (phase by phase)

## Phase 1 — Invoice intake (week 1)  — STATUS 2026-07-19
- [x] Google Sheets workbook **"Account Manager 2026"** created with all 7 tabs
      — ID `1uMnbuiN6OnX2CK20zw07G9ZaRcyOenCeSWUSe9Oo6gU`
- [x] Backfilled: Expenses (49 rows, 1 flagged needs_review — Menta fuel receipt with
      missing date), Invoices_Issued (19), Clients (10), Deadlines (16), Yearly_Report keys
- [x] n8n **WF-0 Setup Workbook** created and executed successfully (can be archived)
- [x] n8n **WF-1 Invoice Intake** created — Gmail poll (unread + PDF + חשבונית/קבלה)
      → Claude field extraction → Dropbox filing → Expenses append → mark read.
      Gmail / Google Sheets / Dropbox credentials auto-connected from existing n8n creds.
- [ ] Add **Anthropic API key** credential in n8n to the "Claude Extract Invoice" node
- [ ] Verify Dropbox base path in "Save PDF to Dropbox" node matches the real folder
      (`/Docs Itamar/Docs Itamar - Buisness/חשבוניות - קבלות/<year>/<category>/`)
- [ ] Activate (publish) WF-1, test with 5 real invoices incl. one unknown vendor
- [ ] Fill client emails + payment terms in the Clients tab (needed for Phase 4)
- [ ] Re-authorize the Gmail connector in claude.ai (token expired) so Cowork agents
      can draft reminders later
- [ ] Phase 1.5: add Green Invoice push (token → POST expense) after the Sheets append

## Phase 2 — Bank + reconciliation (week 2)  — STATUS 2026-07-19
- [x] Scraper architecture: `scripts/bank_scrape.js` (israeli-bank-scrapers) runs via
      cron on the server and POSTs transactions to an n8n webhook — no shell-exec needed
      in n8n, and bank credentials never enter n8n (they live in the git-ignored `.env`)
- [x] n8n **WF-2 Bank Sync & Reconcile** created — webhook → dedupe by txn hash →
      classify (client_payment / tax_vat / tax_bituach_leumi / tax_income / bank_fee /
      other) → match credits to open invoices (exact amount, or 94–101% for ניכוי מס
      במקור) → mark invoices paid → append Bank_Transactions → Hebrew email alert on
      client payments (reconcile merged into WF-2; no separate WF-3 needed)
- [x] n8n **WF-4 Green Invoice Mirror** created — daily 06:30, last 90 days of GI
      documents upserted into Invoices_Issued by document id
- [x] Notification channel: Gmail (existing n8n credential) → itamar92@gmail.com
- [ ] On the n8n host: `npm install israeli-bank-scrapers dotenv`, fill
      `BANK_CONNECTIONS` / `BANK_WEBHOOK_URL` / `BANK_WEBHOOK_SECRET` in `.env`,
      add the cron entry (`0 7 * * *  node scripts/bank_scrape.js`)
- [ ] In n8n: set the "Bank Webhook Secret" header-auth credential (name
      `X-Webhook-Secret`, value = BANK_WEBHOOK_SECRET) and activate WF-2
- [ ] On the n8n host: export `GREEN_INVOICE_ID` / `GREEN_INVOICE_SECRET` env vars,
      then activate WF-4 (verify the GI token/search responses in a manual run first)
- [ ] Verify dedupe: run the scraper twice, confirm no duplicate Bank_Transactions rows

## Phase 3 — Compliance (week 3)
- [ ] Add Deadlines + Yearly_Report tabs; import `deadline-calendar.json`
- [ ] Create Cowork Routine for `tax-compliance` agent: Sundays 08:00 + 10th of month
- [ ] Wire WF-5 notification path
- [ ] Sanity-check first Yearly_Report output against `expense-inventory-2026.md` P&L draft

## Phase 4 — AR/AP (week 4)
- [ ] Fill Clients tab (10 active clients: email, payment terms)
- [ ] Build WF-6 (receivables drafts) and WF-7 (payables + weekly digest)
- [ ] Review the first batch of reminder drafts carefully before any are sent

## Later / optional
- [ ] Auto-send policy for reminders (e.g. auto after 2 approved drafts for a client)
- [ ] Supabase migration + dashboard (only when Sheets actually hurts — see ARCHITECTURE.md)
- [ ] Historical backfill: 2025 data for year-over-year comparisons
