# Expense Inventory 2026 (as of 2026-04-16)

Source: `/Volumes/Data/Dropbox/Docs Itamar/Docs Itamar - Buisness/חשבוניות - קבלות/2026/`

## Summary by Category

| Category | Files | Total NIS | Deduct % | Deductible NIS |
|----------|------:|----------:|---------:|---------------:|
| קבלנות משנה - נגנים | 11 | 37,987 | 100% | 37,987 |
| אחזקה ותיקונים | 4 | 15,689 | 100% | 15,689 |
| חזרות (equipment + lessons) | 3 | 10,114 | 100% | 10,114 |
| הנהלת חשבונות (ACUM + Meta ads) | 6 | 8,844 | 100% | 8,844 |
| תחזוקה רכב | 4 | 3,261 | 45% | 1,467 |
| דלק | 7 | 3,221 | 45% | 1,450 |
| ארנונה | 2 | 2,747 | 15% | 412 |
| חשבון חשמל | 3 | 1,737 | 15% | 261 |
| ציוד קבוע - מחשבים | 1 | 399 | 100%* | 399 |
| ציוד משרדי | 1 | 300 | 100% | 300 |
| אינטרנט + HOT Mobile | 5 | 238 | 80% | 190 |
| תוכנות | 2 | 102 | 100% | 102 |
| **TOTAL** | **49** | **84,638** | — | **77,215** |

*depreciation applies over useful life for מחשבים >500 NIS; 399 full-deduct ok

## Gaps to Fill

| Category | Issue |
|----------|-------|
| Partner internet | March bill missing (have Jan 89, Feb 89, expect Mar ~89) |
| מים (water) | Only 1 file (אישור for Q1), no amount in filename — read PDF for amount |
| חשבון גז | Folder empty — no gas service, or missing bills? |
| ועד בית | Folder empty — no building fee, or missing? |
| הוצאות רפואיות | Folder empty — personal anyway, non-deductible |
| תרומות | Folder empty — if donated, capture for sec 46 deduction |
| Electricity | 2 "אישור" files have no amount in filename — may be payment confirmations |
| HOT Mobile April | Expected ~Apr 15, not yet arrived |

## P&L Draft (YTD 2026)

```
Revenue (closed 320+305):  90,857 NIS
Deductible expenses:       77,215 NIS
---------------------------------
Net taxable income:        13,642 NIS (Q1 approx)
```

Note: excludes open receivables (#50095, #40221). Expense deductibility assumes 15% home office ratio + 45% car + 80% phone/internet per tax norms.

## VAT Input (mas tsumos) Check — Mar-Apr period

Input VAT (18%) reclaimable on deductible business expenses only.
**Next filing deadline:** 2026-05-15 for Mar-Apr.

Expenses to include in Mar-Apr VAT report (per invoice date):
- Run: `python3 -c "import json; rows=json.load(open('expenses_2026.json')); [print(r) for r in rows if r['date'] and '2026-03' <= r['date'] <= '2026-04']"`
