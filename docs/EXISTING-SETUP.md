# Existing n8n Setup — reconciliation notes (2026-07-20)

Discovered mid-build that a mature production n8n system already exists. This file records
the **real** architecture so future work integrates with it instead of duplicating it.
The earlier `ARCHITECTURE.md` / `DATA-SCHEMA.md` describe a parallel greenfield design that
we are **not** building on.

## Real data model (Google Sheets, Hebrew columns)

| Domain | Spreadsheet ID | Tab | Key columns |
|---|---|---|---|
| Expenses | `1tBVUqPIuZTA-v3YhiNIf0pGJ0i93OrxTNbKJBCxHTn4` ("2025 פירוט הוצאות עסק") | `דוח הוצאות` (gid 651318262) | ספק, חשבון הוצאה ראשי, סכום כולל מע״מ, מע״מ, סכום לא כולל מע״מ, מס חודש, שם המסמך |
| Monthly summary | same file | `סיכום חודשי` | חודש, שנה, income/expenses/VAT/open-invoices — written by the package builder |
| Payables (NEW) | same file | `ספקים לתשלום` | ספק, תיאור, סכום, תאריך חשבונית, תאריך לתשלום, סטטוס, תאריך תשלום, הערות |
| Solo income | `1we3damBJ-bJ57DbOlQBHn89VP71ckQoSLuvrAkgfoPI` | `Master_Data` | לקוח, סכום, סכום כולל מעמ, תאריך, חודש לשיוך, **סטטוס (לא שולם)** |
| Band income | `18kp7-kCJwQ4E6pqaMiXhY0dhsqMc2Nr5moNu_02XsL0` | `הכנסות` | מקום, תאריך, כולל מע״מ, איתמר (his share), **חשבונית (yes/לא)** |

Notifications: **Telegram** chat `5564386206` (bot @itamarN8n_bot). Expense push to Morning:
**by email** to `exp+81f6992b5358b560c893a315d00fbfd4@expenses.morning.co`.
Dropbox root: `/Docs Itamar/Docs Itamar - Buisness/חשבוניות - קבלות/<year>/`.

## Already solved (do NOT rebuild)

- **Invoice intake** — "Process Invoice to Dropbox and Google Sheet" + variants call sub-workflows
  `Claude-Code Parser Invoice` → `Parsing Invoices` → validate → Dropbox → Morning (email) →
  expenses sheet → Telegram. Also link/attachment/SSH/Cowork variants and "unparsed → Dropbox" fallbacks.
- **Bank** — "Bank Scraper Service", "Bank-to-Invoice Reconciliation" (NOT MCP-readable), plus
  "Israeli Bank — Scheduled Transaction Fetch (skeleton)" and "Bank Events → Google Sheet (Demo)".
- **Monthly accountant package** — "Monthly Accountant Package Builder": income (solo+band),
  expenses by category, full VAT position (עסקאות/תשומות/נטו + direction), net profit,
  VAT period-end nudge, and it already lists open debts (`סטטוס=לא שולם`).
- **Service sub-workflows** — Google Sheets Service, Morning Service, Bank Scraper Service,
  Telegram Router / Callback Router / Approval Service.

## Genuine gaps (where new work goes)

1. **Payables / ספקים** — money owed to musicians/subcontractors. → BUILT (see below).
2. **Active receivables / גבייה** — chasing unpaid solo invoices + band gigs missing חשבונית.
3. **Tax-deadline monitor** — ביטוח לאומי (monthly 15th), מקדמות מס, annual report, verified
   against bank payments. (Monthly builder only nudges VAT period-end.)
4. **Annual projection** — year-end run-rate for revenue/expenses/income-tax/ביטוח לאומי.

## Built this session (on the REAL setup)

- **Payables Reminder (ספקים)** `VwXrCOcTpz67Awmf` — weekly Sun 08:30 (+ Run Now). Reads TWO
  sources, buckets open items by due date (באיחור / השבוע / עד-30 / בהמשך), and sends a Telegram
  checklist to 5564386206. Read-only, never pays. Tested — reconciles exactly to `סיכום מקוצר`.
- **SETUP Payables Tab (run once)** `mUTbbzYAa1AgxReV` — created the manual `ספקים לתשלום` tab
  (RTL, Hebrew headers, one example row) for non-band suppliers. Already executed.

### Primary source: the band sheet (Moonlight 2026)
File `18kp7-…`, tab **`הוצאות לפי אירוע`**. Important quirks discovered:
- Row 1 is a merged "הוצאות" title → the real header row is **row 2**, data from **row 3**.
  The Google Sheets read node is configured with `headerRow: 2, firstDataRow: 3`.
- Each supplier is a **checkbox column immediately followed by an amount column** (before VAT):
  `chekbox singer`→זמר, `chekbox soundman`→סאונדמן, `chekbox lightman`→תאורן,
  `chekbox soundCompany`→חברת הגברה, `chekbox braclet`→חברת צמידים.
- The show date is embedded in the `אירוע` cell ("מקום - DD/MM/YYYY").
- **Payable rule:** a (event × supplier) cell with amount > 0 whose checkbox is not TRUE.
  **Due = שוטף+30** = last day of the show's month + 30 days.
- Verified: summing unpaid per supplier reproduces the `סיכום מקוצר` A4:B8 totals exactly
  (זמר 8,000 / תאורן 4,800 / סאונדמן 6,100 / חברת צמידים 8,100 / חברת הגברה 6,000 = 33,000).
- To mark paid: tick the supplier's checkbox in the sheet — it drops off the next reminder.

### Secondary source: manual `ספקים לתשלום` tab (non-band suppliers)
Columns: ספק, תיאור, סכום, תאריך חשבונית, תאריך לתשלום, סטטוס (לתשלום/שולם), תאריך תשלום, הערות.

### Future
- Bank reconciler could tick paid automatically when a matching debit clears.
- אקום / שכר אולם columns exist too (usually prepaid) — easy to add to the SUP map if wanted.

## Parallel greenfield artifacts (left as-is, NOT in use)

Created earlier this session before the existing setup was known; kept per user instruction,
but not the backbone: Google Sheet "Account Manager 2026" (`1uMnbuiN6OnX2CK20zw07G9ZaRcyOenCeSWUSe9Oo6gU`)
and n8n workflows WF-0/1/2/4/5 + the FIX workflow.
