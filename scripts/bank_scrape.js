#!/usr/bin/env node
/**
 * Bank scraper → n8n webhook (read-only).
 *
 * Scrapes transactions with israeli-bank-scrapers and POSTs them to the
 * WF-2 Bank Sync webhook in n8n. Run daily via cron on the machine that
 * hosts n8n (or any machine with network access to it):
 *
 *   0 7 * * * cd /path/to/account-manager && node scripts/bank_scrape.js
 *
 * Setup:
 *   npm install israeli-bank-scrapers dotenv
 *
 * .env variables (see .env.example):
 *   BANK_CONNECTIONS  JSON array of connections, e.g.
 *     [{"company":"hapoalim","credentials":{"userCode":"...","password":"..."}},
 *      {"company":"max","credentials":{"username":"...","password":"..."}}]
 *     Company IDs per israeli-bank-scrapers CompanyTypes (hapoalim, leumi,
 *     discount, mizrahi, otsarHahayal, visaCal, max, isracard, amex, ...).
 *   BANK_WEBHOOK_URL     e.g. https://n8nn.itamar-home.loan/webhook/bank-sync
 *   BANK_WEBHOOK_SECRET  shared secret, sent as X-Webhook-Secret header
 *   BANK_DAYS_BACK       how far back to scrape (default 14)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createScraper } = require('israeli-bank-scrapers');

async function main() {
  const connections = JSON.parse(process.env.BANK_CONNECTIONS || '[]');
  const webhookUrl = process.env.BANK_WEBHOOK_URL;
  const secret = process.env.BANK_WEBHOOK_SECRET || '';
  const daysBack = parseInt(process.env.BANK_DAYS_BACK || '14', 10);
  if (!connections.length || !webhookUrl) {
    console.error('Missing BANK_CONNECTIONS or BANK_WEBHOOK_URL in .env');
    process.exit(1);
  }

  const startDate = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
  const transactions = [];

  for (const conn of connections) {
    const scraper = createScraper({
      companyId: conn.company,
      startDate,
      combineInstallments: false,
      showBrowser: false,
    });
    const result = await scraper.scrape(conn.credentials);
    if (!result.success) {
      console.error(`[${conn.company}] scrape failed: ${result.errorType} ${result.errorMessage || ''}`);
      continue;
    }
    for (const account of result.accounts || []) {
      for (const txn of account.txns || []) {
        transactions.push({
          source: conn.company,
          account: account.accountNumber,
          date: (txn.date || '').slice(0, 10),
          processed_date: (txn.processedDate || '').slice(0, 10),
          description: txn.description || '',
          memo: txn.memo || '',
          amount: txn.chargedAmount ?? txn.originalAmount ?? 0,
          balance: txn.balance ?? '',
          status: txn.status || '',
          identifier: txn.identifier || '',
        });
      }
    }
    console.log(`[${conn.company}] ok — ${transactions.length} txns so far`);
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },
    body: JSON.stringify({ scraped_at: new Date().toISOString(), transactions }),
  });
  console.log(`POST ${webhookUrl} → ${res.status}`);
  if (!res.ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
