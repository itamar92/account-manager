#!/usr/bin/env python3
"""Build accountant havila package.

- Downloads Green Invoice issued-document PDFs
- Builds manifests for issued invoices + received expenses
- Generates cover sheet CSV

Usage: python3 scripts/build_havila.py <from_date> <to_date>
Example: python3 scripts/build_havila.py 2026-01-01 2026-04-30
"""
import os, sys, json, csv, urllib.request, urllib.parse
from pathlib import Path
from datetime import date
from collections import defaultdict

try:
    from dotenv import load_dotenv
except ImportError:
    print("Install deps: pip install python-dotenv")
    sys.exit(1)

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
BILLS_ROOT = Path("/Volumes/Data/Dropbox/Docs Itamar/Docs Itamar - Buisness/חשבוניות - קבלות")
VAT_RATE = 0.18

def get_token():
    gi_id, gi_secret = os.getenv("GREEN_INVOICE_ID"), os.getenv("GREEN_INVOICE_SECRET")
    if not gi_id or not gi_secret:
        print("Missing GREEN_INVOICE_ID/GREEN_INVOICE_SECRET in .env"); sys.exit(1)
    req = urllib.request.Request(
        "https://api.greeninvoice.co.il/api/v1/account/token",
        data=json.dumps({
            "id": gi_id,
            "secret": gi_secret,
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req).read())["token"]

def search_docs(token, from_date, to_date):
    req = urllib.request.Request(
        "https://api.greeninvoice.co.il/api/v1/documents/search",
        data=json.dumps({
            "page": 1, "pageSize": 50,
            "type": [300, 305, 320, 400, 330],
            "fromDate": from_date, "toDate": to_date,
            "sort": "documentDate",
        }).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req).read())["items"]

def download_pdf(token, doc_id, out_path):
    req = urllib.request.Request(
        f"https://api.greeninvoice.co.il/api/v1/documents/{doc_id}/download/links",
        headers={"Authorization": f"Bearer {token}"},
    )
    links = json.loads(urllib.request.urlopen(req).read())
    url = links.get("he") or links.get("origin")
    urllib.request.urlretrieve(url, out_path)

def main():
    if len(sys.argv) != 3:
        print("Usage: build_havila.py <from_date> <to_date>"); sys.exit(1)
    from_date, to_date = sys.argv[1], sys.argv[2]
    period_label = f"{from_date[:7]}-to-{to_date[:7]}"
    out = ROOT / "havila" / period_label
    (out / "invoices-issued").mkdir(parents=True, exist_ok=True)
    (out / "invoices-received").mkdir(parents=True, exist_ok=True)

    # 1. Green Invoice issued docs
    token = get_token()
    docs = search_docs(token, from_date, to_date)
    print(f"Found {len(docs)} issued docs")
    issued_manifest = []
    for d in docs:
        fn = f"{d['documentDate']}_type{d['type']}_num{d['number']}_{d['client']['name'][:30]}_{int(d['amount'])}nis.pdf"
        fn = fn.replace("/", "_").replace(" ", "_")
        target = out / "invoices-issued" / fn
        if not target.exists():
            try:
                download_pdf(token, d['id'], target)
            except Exception as e:
                print(f"  download fail #{d['number']}: {e}")
                continue
        issued_manifest.append({
            "number": d['number'], "type": d['type'],
            "date": d['documentDate'], "status": d['status'],
            "client": d['client']['name'], "amount_ils": d['amount'],
            "due": d.get('dueDate'), "file": fn,
        })
    with open(out / "invoices-issued" / "_manifest.csv", "w", newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(issued_manifest[0].keys()))
        w.writeheader(); w.writerows(issued_manifest)

    # 2. Received (expenses) — reference from bills folder
    received_manifest = []
    year = from_date[:4]
    year_dir = BILLS_ROOT / year
    for cat_dir in year_dir.iterdir():
        if not cat_dir.is_dir(): continue
        for f in cat_dir.iterdir():
            if f.suffix.lower() != ".pdf": continue
            # parse date from filename
            import re
            m = re.search(r"(\d{4}-\d{2}-\d{2})", f.name)
            if not m: continue
            fdate = m.group(1)
            if not (from_date <= fdate <= to_date): continue
            received_manifest.append({
                "date": fdate, "category": cat_dir.name,
                "filename": f.name, "path": str(f),
            })
    received_manifest.sort(key=lambda r: r["date"])
    with open(out / "invoices-received" / "_manifest.csv", "w", newline='') as f:
        w = csv.DictWriter(f, fieldnames=["date","category","filename","path"])
        w.writeheader(); w.writerows(received_manifest)

    # 3. Cover sheet
    # Revenue from closed 305+320
    rev_recognized = sum(d['amount'] for d in docs if d['status']==1 and d['type'] in (305,320))
    rev_open = sum(d['amount'] for d in docs if d['status']==0 and d['type'] in (300,305,320))
    rev_issued_total = sum(d['amount'] for d in docs if d['type'] in (305,320))
    # Rough VAT output: assume most docs are with VAT (18%). amount usually includes VAT.
    vat_output = rev_issued_total * VAT_RATE / (1 + VAT_RATE)
    rev_net = rev_issued_total - vat_output

    # Expenses from parsed JSON (if exists) filtered by period
    exp_path = ROOT / "expenses_2026.json"
    exp_total = exp_deduct = vat_input = 0
    exp_in_period = []
    if exp_path.exists():
        all_exp = json.loads(exp_path.read_text())
        for r in all_exp:
            if r['date'] and from_date <= r['date'] <= to_date:
                exp_in_period.append(r)
                exp_total += r['nis']
                exp_deduct += r['deductible_nis']
                # VAT input roughly 18%/118% of deductible expenses (assume VAT invoices)
                vat_input += r['deductible_nis'] * VAT_RATE / (1 + VAT_RATE)

    cover = {
        "period": f"{from_date} → {to_date}",
        "business_type": "osek_murshe",
        "accountant": "Itamar Miron",
        "issued_docs_count": len(docs),
        "issued_docs_closed": len([d for d in docs if d['status']==1]),
        "issued_docs_open": len([d for d in docs if d['status']==0]),
        "revenue_issued_total_nis": round(rev_issued_total, 2),
        "revenue_net_of_vat_nis": round(rev_net, 2),
        "vat_output_nis": round(vat_output, 2),
        "revenue_recognized_closed_nis": round(rev_recognized, 2),
        "revenue_open_receivable_nis": round(rev_open, 2),
        "expense_count": len(exp_in_period),
        "expense_gross_nis": round(exp_total, 2),
        "expense_deductible_nis": round(exp_deduct, 2),
        "vat_input_estimated_nis": round(vat_input, 2),
        "net_vat_payable_nis": round(vat_output - vat_input, 2),
        "net_income_before_tax_nis": round(rev_net - exp_deduct, 2),
    }
    (out / "cover-sheet.json").write_text(json.dumps(cover, ensure_ascii=False, indent=2))
    # readable text
    lines = [f"{k}: {v}" for k,v in cover.items()]
    (out / "cover-sheet.txt").write_text("\n".join(lines))

    print(f"\n=== Havila built: {out} ===\n")
    for k,v in cover.items():
        print(f"  {k}: {v}")

if __name__ == "__main__":
    main()
