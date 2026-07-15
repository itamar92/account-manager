#!/usr/bin/env python3
"""
Utility bill collector for Israeli providers.
Uses Playwright. Run: python3 scripts/collect_bills.py [--provider <name>]

Providers: iec, partner, hotmobile, water, arnona, all (default)

Flow per provider:
1. Launch browser (non-headless for 2FA)
2. Navigate to login page
3. Fill credentials from .env
4. If SMS OTP required, pause for user input
5. Navigate to bills/invoices page
6. Download latest PDF
7. Save to bills/YYYY-MM/<provider>/<provider>_<YYYY-MM>.pdf
8. Extract: period, amount, due date, paid status -> bills/<YYYY-MM>/manifest.json

Requires: pip install playwright python-dotenv && playwright install chromium
"""
import os, sys, json, argparse
from datetime import date
from pathlib import Path

try:
    from dotenv import load_dotenv
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Install deps: pip install playwright python-dotenv && playwright install chromium")
    sys.exit(1)

BASE_DIR = Path(__file__).parent.parent
load_dotenv(BASE_DIR / ".env")
CONFIG = json.load(open(BASE_DIR / "utilities-config.json"))

def ensure_dir(provider: str) -> Path:
    month = date.today().strftime("%Y-%m")
    d = BASE_DIR / "bills" / month / provider
    d.mkdir(parents=True, exist_ok=True)
    return d

def prompt_otp(label: str) -> str:
    return input(f"[{label}] Enter SMS OTP: ").strip()

def collect_iec(pw):
    cfg = CONFIG["providers"]["electricity"]
    uid = os.getenv("IEC_ID"); pw_ = os.getenv("IEC_PASSWORD")
    if not uid: print("IEC: missing creds in .env"); return
    browser = pw.chromium.launch(headless=False)
    page = browser.new_page()
    page.goto(cfg["portal"])
    # TODO: map login selectors after first manual inspection
    print("IEC: login flow not yet scripted. Inspect portal and add selectors.")
    input("Press Enter after manual login + navigate to bills...")
    # save PDF manually or via page.pdf() / link click
    browser.close()

def collect_partner(pw):
    cfg = CONFIG["providers"]["internet"]
    print(f"Partner: stub. portal={cfg['portal']}")

def collect_hotmobile(pw):
    cfg = CONFIG["providers"]["mobile"]
    print(f"HOT Mobile: stub. portal={cfg['portal']}")

def collect_water(pw):
    cfg = CONFIG["providers"]["water"]
    print(f"Water (Mei HH): stub. portal={cfg['portal']} — verify URL manually first.")

def collect_arnona(pw):
    cfg = CONFIG["providers"]["arnona"]
    print(f"Arnona (Hod Hasharon): stub. portal={cfg['portal']}")

COLLECTORS = {
    "iec": collect_iec,
    "partner": collect_partner,
    "hotmobile": collect_hotmobile,
    "water": collect_water,
    "arnona": collect_arnona,
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="all", choices=list(COLLECTORS.keys()) + ["all"])
    args = ap.parse_args()
    targets = list(COLLECTORS.keys()) if args.provider == "all" else [args.provider]
    with sync_playwright() as pw:
        for t in targets:
            print(f"\n=== {t} ===")
            try:
                COLLECTORS[t](pw)
            except Exception as e:
                print(f"[{t}] error: {e}")

if __name__ == "__main__":
    main()
