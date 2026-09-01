# Data Schema — Google Sheets workbook (DB-migration-ready)

One workbook: **"Account Manager 2026"**. Each tab is a flat table: header row, stable
`id` first column, no merged cells, no formulas in data columns (formulas live only in
the `Yearly_Report` tab and dedicated dashboard tabs). This maps 1:1 to Postgres tables
if/when we migrate (tab = table, column = column).

Conventions: dates `YYYY-MM-DD`, amounts in NIS with 2 decimals, `source` records which
automation wrote the row, `updated_at` ISO timestamp.

## Tab: Expenses  (fed by invoice-intake)
| Column | Type | Notes |
|--------|------|-------|
| id | text | `exp_<yyyymmdd>_<seq>` |
| date | date | invoice date |
| vendor | text | canonical Hebrew name (from vendor-mapping.json) |
| invoice_type | text | חשבונית מס / חשבונית מס קבלה / קבלה |
| category | text | from the 21-category list in invoice-expert skill |
| description | text | |
| total | number | incl. VAT |
| vat_amount | number | 18% component if חשבונית מס |
| deduct_pct | number | business-use ratio (1.0 / 0.8 / 0.45 / 0.15 per parse_expenses.py) |
| deductible_nis | number | total × deduct_pct (computed at write time, stored) |
| dropbox_path | text | final renamed file location |
| green_invoice_doc_id | text | id after pushing to Morning, empty if not pushed |
| source | text | gmail-auto / manual / scan |
| status | text | new / filed / pushed_to_gi / needs_review |
| updated_at | datetime | |

## Tab: Invoices_Issued  (synced from Green Invoice API — read-only mirror)
| Column | Type | Notes |
|--------|------|-------|
| id | text | Green Invoice document id |
| doc_number | text | e.g. 40222 |
| doc_type | number | 300 חשבון עסקה / 305 חשבונית מס / 320 חשבונית מס קבלה (Green Invoice codes) |
| date | date | |
| client_name | text | |
| client_id | text | GI client id |
| amount | number | incl. VAT |
| vat_amount | number | |
| status | text | open / paid / closed / cancelled |
| paid_date | date | set by reconciler |
| bank_txn_id | text | link to Bank_Transactions.id |
| days_overdue | number | maintained by receivables agent |
| reminder_count | number | how many reminders drafted |
| updated_at | datetime | |

## Tab: Bank_Transactions  (fed by bank-monitor, read-only source data)
| Column | Type | Notes |
|--------|------|-------|
| id | text | `<bank>_<account>_<txn_hash>` — dedupe key |
| date | date | |
| description | text | raw bank description |
| amount | number | positive = credit, negative = debit |
| balance | number | |
| classification | text | client_payment / supplier_payment / tax_vat / tax_bituach_leumi / tax_income / bank_fee / personal / other |
| matched_doc_id | text | Invoices_Issued.id or Payables.id |
| match_confidence | text | exact / probable / manual / unmatched |
| updated_at | datetime | |

## Tab: Payables  (fed by invoice-intake for docs with payment terms; managed by payables agent)
| Column | Type | Notes |
|--------|------|-------|
| id | text | `pay_<yyyymmdd>_<seq>` |
| vendor | text | |
| description | text | |
| amount | number | |
| invoice_date | date | |
| due_date | date | from payment terms (שוטף+30 etc.) |
| status | text | open / scheduled / paid |
| paid_date | date | set by reconciler |
| bank_txn_id | text | |
| expense_id | text | link to Expenses.id |
| updated_at | datetime | |

## Tab: Clients  (light CRM)
| Column | Type | Notes |
|--------|------|-------|
| id | text | GI client id |
| name | text | |
| email | text | for reminder drafts |
| payment_terms_days | number | default 30 |
| typical_payment_method | text | transfer / check / masav |
| notes | text | |

## Tab: Deadlines  (mirror of deadline-calendar.json, statuses maintained by tax-compliance)
| Column | Type | Notes |
|--------|------|-------|
| id | text | `<type>_<period>` |
| date | date | |
| type | text | vat_bimonthly / bituach_leumi_monthly / doch_shnati / mkdamot_mas |
| period | text | |
| status | text | upcoming / due_this_week / overdue / paid / verified_paid |
| paid_bank_txn_id | text | reconciler links the actual payment |
| updated_at | datetime | |

## Tab: Yearly_Report  (computed by tax-compliance — the "how will my year look" file)
Small key-value + monthly breakdown layout:
- YTD revenue (ex-VAT), YTD deductible expenses, YTD net taxable income
- Projection method: run-rate + seasonality (music business — flag known busy months)
- Projected annual: revenue / expenses / taxable income
- Estimated income tax (per current brackets + נקודות זיכוי), estimated ביטוח לאומי
- VAT position for current bi-monthly period (output VAT − input VAT)
- Threshold watch: ₪500K (874 report), allocation-number thresholds
- `last_updated` + one-line Hebrew summary the agent rewrites each run

## Migration note (Phase 3 → Supabase)
`Expenses`, `Invoices_Issued`, `Bank_Transactions`, `Payables`, `Clients`, `Deadlines`
become tables with the same columns; `Yearly_Report` becomes a SQL view/materialized
view instead of stored values. n8n swaps Google Sheets nodes for Postgres nodes; agent
prompts unchanged.
