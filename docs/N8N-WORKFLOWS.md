# n8n Workflow Specs

Seven workflows. Existing templates in `.claude/skills/invoice-expert/n8n-workflow-*.json`
already cover much of WF-1's parsing stage (Gmail → Claude API → JSON); these specs extend
them to the full pipeline. Credentials (Gmail OAuth, Dropbox, Google Sheets, Green Invoice
API key, bank creds, Anthropic API key) live in n8n's credential store only.

## WF-1: Invoice Intake  (trigger: Gmail)
1. **Gmail Trigger** — label `invoices/incoming` (Gmail filter routes known vendor senders
   + any mail with PDF attachment containing "חשבונית"/"קבלה").
2. **Get attachments** → for each PDF: extract text (PDF node); if empty text → base64 →
   Claude vision (existing `n8n-workflow-pdf-vision.json` pattern).
3. **Claude API call** with the invoice-expert system prompt (see
   `.claude/skills/invoice-expert/n8n-integration.md`) → structured JSON
   `{finalName, date, invoiceType, merchant, category, description, total}`.
4. **IF confidence low / unknown vendor** → Slack/Telegram message + row in Expenses with
   `status=needs_review`; a Cowork task picks it up (agent writes new vendor parser).
5. **Dropbox node** — upload as
   `/חשבוניות - קבלות/<year>/<category>/<finalName>`.
6. **Google Sheets append** — `Expenses` row (schema in DATA-SCHEMA.md).
7. **Green Invoice API** — `POST /expenses` (or documents endpoint) to record the expense
   in Morning; write returned id to `green_invoice_doc_id`, set `status=pushed_to_gi`.
8. **Label email** `invoices/processed`.

## WF-2: Bank Sync  (trigger: cron daily 07:00)
1. **Execute node** — run `israeli-bank-scrapers` (Node script in n8n or a small container)
   with read-only credentials; fetch last 14 days for bank + credit cards.
2. **Dedupe** against `Bank_Transactions` sheet by txn hash id.
3. **Claude API classify** — batch new transactions → classification per schema enum
   (client_payment / supplier_payment / tax_* / personal / other) using client + vendor
   lists from the sheets as context.
4. **Append** to `Bank_Transactions`.
5. **IF any `client_payment`** → immediate push notification: "💰 התקבל תשלום ₪X — Y".
6. **Chain** → trigger WF-3.

## WF-3: Reconcile  (trigger: chained from WF-2, or manual)
1. Read open `Invoices_Issued` + open `Payables` + unmatched `Bank_Transactions`.
2. **Claude API match** — amount/date/name fuzzy matching (client "עיריית תל אביב" vs bank
   descriptor differences). Output: matches with confidence.
3. `exact`/`probable` → update both sides (paid_date, bank_txn_id, status=paid).
4. If a paid invoice is doc_type 305/300 (no receipt yet) → reminder: "צריך להפיק קבלה
   ב-Morning עבור #NNNNN".
5. Unmatched credits older than 3 days → notify with best guess.

## WF-4: Green Invoice Mirror  (trigger: cron daily 06:30, before bank sync)
1. Green Invoice API — search documents since last sync (issued + status changes).
2. Upsert into `Invoices_Issued`.
3. New clients → upsert `Clients`.

## WF-5: Compliance Check  (trigger: cron Sunday 08:00 + 10th of month 08:00)
1. Webhook/Task → **tax-compliance Cowork agent** (it needs multi-step reasoning:
   deadlines vs. bank evidence of payment vs. YTD projection vs. מקדמות status).
2. Agent updates `Deadlines` + `Yearly_Report`, returns a Hebrew summary.
3. n8n sends the summary (Telegram/email), with ⚠️ prefix if anything overdue.

## WF-6: Receivables  (trigger: cron Monday 09:00)
1. Compute aging from `Invoices_Issued` (open docs, days_overdue).
2. For overdue > terms: **Claude API** drafts personalized Hebrew reminder (tone by
   aging bucket: gentle at +7, firm at +30) using client history.
3. **Gmail create draft** (never send) + increment `reminder_count` + notify you:
   "3 טיוטות תזכורת מוכנות בג'ימייל".

## WF-7: Payables & Weekly Digest  (trigger: cron Sunday 08:30)
1. `Payables` due within 7 days → payment checklist (vendor, amount, due date).
2. Compose weekly digest combining WF-5 output + receivables aging + payables list +
   cash position (last bank balance) + YTD P&L one-liner → single Telegram/email message.

## Error handling (all workflows)
- Error Trigger workflow → notify with workflow name + item; never silently drop an invoice.
- All writes idempotent (check-by-id before append) so reruns are safe.
- WF-1 keeps the original email labeled until step 7 succeeds.
