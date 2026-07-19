# Setup Checklist (phase by phase)

## Phase 1 — Invoice intake (week 1)
- [ ] Create Google Sheets workbook "Account Manager 2026" with tabs per `DATA-SCHEMA.md`
      (start with Expenses, Payables, Clients; add the rest in later phases)
- [ ] Backfill Expenses tab from `expenses_2026.json` (one-off script or manual import)
- [ ] n8n instance running (cloud or self-hosted) with credentials configured:
      Gmail OAuth, Dropbox, Google Sheets, Anthropic API key, Green Invoice ID/secret
- [ ] Gmail: create labels `invoices/incoming`, `invoices/processed` + filters routing
      known vendor senders (see `vendor-mapping.json` emailPatterns) and PDF attachments
- [ ] Build WF-1 (start from `.claude/skills/invoice-expert/n8n-workflow-folder-monitor.json`
      / `n8n-workflow-pdf-vision.json` templates; add Dropbox + Sheets + GI steps)
- [ ] Test with 5 real invoices incl. one unknown vendor (needs_review path)

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
- [ ] Sanity-check first Yearly_Report output against `expense-inventory-2026.md` P&L draft

## Phase 4 — AR/AP (week 4)
- [ ] Fill Clients tab (10 active clients: email, payment terms)
- [ ] Build WF-6 (receivables drafts) and WF-7 (payables + weekly digest)
- [ ] Review the first batch of reminder drafts carefully before any are sent

## Later / optional
- [ ] Auto-send policy for reminders (e.g. auto after 2 approved drafts for a client)
- [ ] Supabase migration + dashboard (only when Sheets actually hurts — see ARCHITECTURE.md)
- [ ] Historical backfill: 2025 data for year-over-year comparisons
