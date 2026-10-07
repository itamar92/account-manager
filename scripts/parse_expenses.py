#!/usr/bin/env python3
"""Parse expense PDFs from bills folder.
Filename convention: YYYY-MM-DD_doctype_vendor_description_amount_currency.pdf
"""
import re, json, sys
from pathlib import Path
from collections import defaultdict

import os

# The folder holding one sub-folder per year of receipt PDFs. Set BILLS_ROOT in .env or the
# environment; it is a path on your own machine (a Dropbox folder, a NAS, anywhere).
BILLS_ROOT = Path(os.getenv("BILLS_ROOT", str(Path(__file__).parent.parent / "bills")))
YEAR = os.getenv("EXPENSES_YEAR", "2026")

# deduction % per category (business use)
DEDUCT = {
    "אינטרנט": 0.80,           # split: internet vs mobile handled below
    "חשבון חשמל": 0.15,
    "מים": 0.15,
    "ארנונה": 0.15,
    "חשבון גז": 0.15,
    "ועד בית": 0.15,
    "הוצאות רפואיות": 0.00,    # personal, non-deductible
    "תרומות": 1.00,             # donations — under sec 46
    "אחזקה ותיקונים": 1.00,
    "הנהלת חשבונות": 1.00,
    "חזרות": 1.00,
    "ציוד משרדי": 1.00,
    "ציוד קבוע - מחשבים": 1.00, # depreciation applies, but 100% eligible basis
    "קבלנות משנה -נגנים": 1.00,
    "תוכנות": 1.00,
    "דלק": 0.45,                # car — 45% per tax rules
    "תחזוקה רכב": 0.45,
}

FX = {"שח":1, "₪":1, "ש\"ח":1, "שׄח":1, "EUR":3.9, "$":3.7, "דולר":3.7}

def parse_amount(s):
    s = s.replace(",","").strip()
    try: return float(s)
    except: return None

def parse_filename(fn):
    # normalize leading underscore glitch
    base = fn.replace(".pdf","")
    # split by underscore
    parts = base.split("_")
    date = None
    amount = None
    currency = 1
    for p in parts:
        if not date and re.match(r"\d{4}-\d{2}-\d{2}$", p):
            date = p
    # amount is usually second-to-last or last
    for p in reversed(parts):
        if p in FX:
            currency = FX[p]; continue
        a = parse_amount(p)
        if a is not None:
            amount = a
            break
    vendor = parts[2] if len(parts) > 2 else ""
    return date, vendor, amount, currency

def main():
    year_dir = BILLS_ROOT / YEAR
    rows = []
    for cat_dir in sorted(year_dir.iterdir()):
        if not cat_dir.is_dir(): continue
        cat = cat_dir.name
        for f in sorted(cat_dir.iterdir()):
            if not f.suffix.lower() == ".pdf": continue
            date, vendor, amount, fx = parse_filename(f.name)
            if amount is None: continue
            nis = amount * fx
            deduct_pct = DEDUCT.get(cat, 1.0)
            # special: mobile (HOT) 80% handled in aggregator
            rows.append({
                "date": date,
                "category": cat,
                "vendor": vendor,
                "amount_raw": amount,
                "nis": round(nis, 2),
                "deduct_pct": deduct_pct,
                "deductible_nis": round(nis * deduct_pct, 2),
                "file": f.name,
            })
    # write CSV + JSON
    out = Path(__file__).parent.parent / f"expenses_{YEAR}.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    # summary
    by_cat = defaultdict(lambda: {"count":0, "nis":0.0, "ded":0.0})
    for r in rows:
        c = r["category"]
        by_cat[c]["count"] += 1
        by_cat[c]["nis"] += r["nis"]
        by_cat[c]["ded"] += r["deductible_nis"]
    print(f"{'Category':<30} {'#':>4} {'Total NIS':>12} {'Deductible':>12}")
    print("-"*62)
    tot_nis = tot_ded = 0
    for c, v in sorted(by_cat.items(), key=lambda x: -x[1]["nis"]):
        print(f"{c:<30} {v['count']:>4} {v['nis']:>12,.2f} {v['ded']:>12,.2f}")
        tot_nis += v["nis"]; tot_ded += v["ded"]
    print("-"*62)
    print(f"{'TOTAL':<30} {sum(v['count'] for v in by_cat.values()):>4} {tot_nis:>12,.2f} {tot_ded:>12,.2f}")
    print(f"\nRows saved: {out}")

if __name__ == "__main__":
    main()
