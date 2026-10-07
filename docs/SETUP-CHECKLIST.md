# Setup Checklist (phase by phase)

## Phase 1 — Invoice intake (week 1)
- [ ] Google Sheets workbook **"Account Manager <year>"** created with all 7 tabs
      (schema in `DATA-SCHEMA.md`); note its ID for the n8n nodes
- [ ] Backfill the year so far: Expenses, Invoices_Issued, Clients, Deadlines, Yearly_Report keys
- [ ] n8n **WF-0 Setup Workbook** created and executed (can be archived afterwards)
- [ ] n8n **WF-1 Invoice Intake** created — Gmail poll (unread + PDF + חשבונית/קבלה)
      → Claude field extraction → Dropbox filing → Expenses append → mark read.
      Connect the Gmail / Google Sheets / Dropbox credentials in n8n.
- [ ] Add **Anthropic API key** credential in n8n to the "Claude Extract Invoice" node
- [ ] Verify the Dropbox base path in "Save PDF to Dropbox" node matches your real folder
      (`<your invoices folder>/<year>/<category>/`)
- [ ] Activate (publish) WF-1, test with 5 real invoices incl. one unknown vendor
- [ ] Fill client emails + payment terms in the Clients tab (needed for Phase 4)
- [ ] Re-authorize the Gmail connector in claude.ai (token expired) so Cowork agents
      can draft reminders later
- [ ] Phase 1.5: add Green Invoice push (token → POST expense) after the Sheets append

## Phase 2 — Bank + reconciliation (week 2)
- [ ] Choose bank scraper runtime: n8n Execute node with `israeli-bank-scrapers`, or
      israeli-bank-mcp for interactive use in Cowork
- [ ] Bank + credit card credentials into n8n credential store ONLY (verify `.env` is
      git-ignored; never commit)
- [ ] Add Bank_Transactions + Invoices_Issued tabs; build WF-4 (GI mirror), WF-2 (bank
      sync), WF-3 (reconcile)
- [ ] Set up notification channel (Telegram bot is easiest in n8n; or email)
- [ ] Verify dedupe: run WF-2 twice, confirm no duplicate rows

## Phase 3 — Compliance (week 3)
- [ ] Add Deadlines + Yearly_Report tabs; import `deadline-calendar.json`
- [ ] Create Cowork Routine for `tax-compliance` agent: Sundays 08:00 + 10th of month
- [ ] Wire WF-5 notification path
- [ ] Sanity-check first Yearly_Report output against last year's P&L

## Phase 4 — AR/AP (week 4)
- [ ] Fill Clients tab (10 active clients: email, payment terms)
- [ ] Build WF-6 (receivables drafts) and WF-7 (payables + weekly digest)
- [ ] Review the first batch of reminder drafts carefully before any are sent

## Later / optional
- [ ] Auto-send policy for reminders (e.g. auto after 2 approved drafts for a client)
- [ ] Supabase migration + dashboard (only when Sheets actually hurts — see ARCHITECTURE.md)
- [ ] Historical backfill: 2025 data for year-over-year comparisons
