import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, uuid, hashPassword, getSetting, setSetting } from './db.js';
import { DOC_TYPE, DOC_TYPE_LABELS, isRevenueDoc } from './docTypes.js';
import { MOONLIGHT_INCOME, MOONLIGHT_EVENT_EXPENSES, MOONLIGHT_GENERAL_EXPENSES } from './moonlightSeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal CSV parser that handles quoted fields (including escaped quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  return rows;
}

/**
 * The built-in defaults are a convenience for a laptop, not for a host on the
 * public internet. In production the seed refuses to run rather than create an
 * owner account whose password is published in this repository.
 */
function seedPassword(envVar: 'SEED_OWNER_PASSWORD' | 'SEED_BAND_PASSWORD', fallback: string): string {
  const value = process.env[envVar];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${envVar} must be set on first run in production — refusing to seed the default password.`
    );
  }
  return fallback;
}

export function runSeed() {
  if (getSetting('seeded', '') === 'true') return;

  const tx = db.transaction(() => {
    setSetting('vat_percent', '18');
    setSetting('app_name', 'Account Manager');

    // --- users ---
    const ownerPassword = seedPassword('SEED_OWNER_PASSWORD', 'changeme123');
    const bandPassword = seedPassword('SEED_BAND_PASSWORD', 'moonlight123');
    const insertUser = db.prepare(
      'INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)'
    );
    insertUser.run(uuid(), 'itamar92@gmail.com', 'איתמר', hashPassword(ownerPassword), 'owner');
    for (const [email, name] of [
      ['amir@moonlight.band', 'אמיר'],
      ['yuval@moonlight.band', 'יובל'],
      ['guy@moonlight.band', 'גיא'],
    ]) {
      insertUser.run(uuid(), email, name, hashPassword(bandPassword), 'band');
    }

    // --- personal invoices from invoices_2026.csv (Green Invoice / Morning export) ---
    const csvPath = path.join(__dirname, '..', '..', 'invoices_2026.csv');
    if (fs.existsSync(csvPath)) {
      const rows = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
      const header = rows[0];
      const col = (name: string) => header.indexOf(name);
      const clientCache = new Map<string, string>();
      const getClient = (name: string) => {
        const key = name.trim();
        if (!clientCache.has(key)) {
          const id = uuid();
          db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, key);
          clientCache.set(key, id);
        }
        return clientCache.get(key)!;
      };
      const insertInvoice = db.prepare(
        `INSERT INTO invoices (id, number, doc_type, client_id, date, due_date, subtotal, vat_amount, total, status, external_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'green_invoice_import')`
      );
      // Every invoice line is a work row, including imported history — the CSV carries no
      // line detail, so each imported document gets a single work covering its full amount.
      const insertWork = db.prepare(
        `INSERT INTO works (id, client_id, date, description, amount, vat_amount, total, status, invoice_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'green_invoice_import')`
      );
      for (const r of rows.slice(1)) {
        const total = parseFloat(r[col('amount_ils')]) || 0;
        const subtotal = Math.round((total / 1.18) * 100) / 100;
        const vat = Math.round((total - subtotal) * 100) / 100;
        const docType = parseInt(r[col('type')]) || DOC_TYPE.TAX_INVOICE;
        const clientId = getClient(r[col('client')]);
        const status = r[col('status')] === '1' ? 'paid' : 'issued';
        const date = r[col('date')];
        const invoiceId = uuid();

        insertInvoice.run(
          invoiceId, r[col('number')], docType, clientId, date, r[col('due')] || null,
          subtotal, vat, total, status, r[col('id')] || null
        );

        // Proformas (חשבון עסקה) mirror a sale that a tax invoice also records. Giving them
        // works too would double-count the sale in every works-based total.
        if (isRevenueDoc(docType)) {
          insertWork.run(
            uuid(), clientId, date, `${DOC_TYPE_LABELS[docType] ?? 'מסמך'} #${r[col('number')]}`,
            subtotal, vat, total, status === 'paid' ? 'paid' : 'invoiced', invoiceId
          );
        }
      }
    }

    // --- moonlight finance data ---
    const insEvent = db.prepare(
      `INSERT INTO band_events (id, venue, date, tickets, amount_pre_vat, amount_with_vat, expenses, expenses_paid, profit,
        receiver, invoice, has_commission, commission_amount, paid_to_musicians, amir, itamar, yuval, guy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of MOONLIGHT_INCOME) {
      insEvent.run(
        uuid(), e.venue, e.date, e.tickets, e.amountPreVat, e.amountWithVat, e.expenses, e.expensesPaid, e.profit,
        e.receiver, e.invoice, e.hasCommission ? 1 : 0, e.commissionAmount, e.paidToMusicians ? 1 : 0,
        e.amir, e.itamar, e.yuval, e.guy
      );
    }
    const insExp = db.prepare(
      `INSERT INTO band_event_expenses (id, event, status, tickets, campaign, refreshments, design, other, expense_amount, paid_by,
        akom, akom_paid, hall_fee, hall_fee_paid, sound_company, sound_company_paid, bracelets, bracelets_paid,
        lightman, lightman_paid, soundman, soundman_paid, singer, singer_paid, vat_summary, total_paid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of MOONLIGHT_EVENT_EXPENSES) {
      insExp.run(
        uuid(), e.event, e.status, e.tickets, e.campaign, e.refreshments, e.design, e.other, e.expenseAmount, e.paidBy,
        e.akom, e.akomPaid ? 1 : 0, e.hallFee, e.hallFeePaid ? 1 : 0, e.soundCompany, e.soundCompanyPaid ? 1 : 0,
        e.bracelets, e.braceletsPaid ? 1 : 0, e.lightman, e.lightmanPaid ? 1 : 0, e.soundman, e.soundmanPaid ? 1 : 0,
        e.singer, e.singerPaid ? 1 : 0, e.vatSummary, e.totalPaid
      );
    }
    const insGen = db.prepare(
      `INSERT INTO band_general_expenses (id, date, description, event, paid_by, amount,
        amir, amir_returned, itamar, itamar_returned, yuval, yuval_returned, fund, fund_returned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const g of MOONLIGHT_GENERAL_EXPENSES) {
      insGen.run(
        uuid(), g.date, g.description, g.event, g.paidBy, g.amount,
        g.amir, g.amirReturned, g.itamar, g.itamarReturned, g.yuval, g.yuvalReturned, g.fund, g.fundReturned
      );
    }

    setSetting('seeded', 'true');
  });

  tx();
  console.log('[seed] database seeded (owner: itamar92@gmail.com)');
}
