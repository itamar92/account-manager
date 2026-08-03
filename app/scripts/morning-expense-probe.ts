/**
 * Prints what Morning actually returns for expenses.
 *
 * The public documentation for `/expenses/search` says little about its response, and
 * accounts differ — which is why the mapper reads several field names for the same value.
 * This shows the shape of *your* account's payload so the mapping can be pinned to it
 * instead of guessed at.
 *
 *   cd app && npx tsx scripts/morning-expense-probe.ts [days]
 *
 * Reads GREEN_INVOICE_ID / GREEN_INVOICE_SECRET from the environment or `app/.env`, and
 * writes nothing — neither to Morning nor to the database. Output includes supplier names
 * and amounts, so treat it as you would any other page of your books.
 */
import 'dotenv/config';
import { expenseClassifications, isMorningConfigured, searchAllExpenses } from '../server/morningClient.js';

const days = parseInt(process.argv[2] || '', 10) || 90;

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

/** Distinct values of one field across every expense, with the type each arrived as. */
function distinct(rows: any[], field: string): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = row?.[field];
    if (value === undefined) continue;
    const key = JSON.stringify(value);
    if (!seen.has(key)) seen.set(key, `${key} (${describe(value)})`);
  }
  return [...seen.values()].slice(0, 12);
}

async function main() {
  if (!isMorningConfigured()) {
    console.error('Morning לא מוגדר — חסרים GREEN_INVOICE_ID / GREEN_INVOICE_SECRET');
    process.exit(1);
  }

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = (await searchAllExpenses({ fromDate: from, toDate: to })) as any[];
  console.log(`\n${rows.length} expenses between ${from} and ${to}\n`);
  if (!rows.length) return;

  console.log('--- first expense, verbatim ---');
  console.log(JSON.stringify(rows[0], null, 2));

  const keys = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))].sort();
  console.log('\n--- every key seen, and the types it arrived as ---');
  for (const key of keys) {
    const types = [...new Set(rows.map((row) => row?.[key]).filter((v) => v !== undefined).map(describe))];
    console.log(`  ${key}: ${types.join(' | ')}`);
  }

  // The two fields the app currently has to guess at.
  for (const field of ['status', 'type', 'category', 'accountingClassification', 'currency', 'currencyRate']) {
    const values = distinct(rows, field);
    if (values.length) console.log(`\n--- ${field} values ---\n  ${values.join('\n  ')}`);
  }

  console.log('\n--- accounting classifications map ---');
  try {
    const map = await expenseClassifications();
    console.log(map.size ? [...map].slice(0, 20).map(([id, name]) => `  ${id} → ${name}`).join('\n') : '  (empty)');
  } catch (err: any) {
    console.log(`  unavailable: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
