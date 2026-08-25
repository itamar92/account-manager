/**
 * Prints what Morning actually says about an expense's דווח/טרם דווח status.
 *
 * Run it when the הוצאות list disagrees with Morning about what has been reported:
 *
 *   cd app && npx tsx bin/expense-status-probe.ts
 *
 * The field carrying that fact is the one thing about an expense this app has never been
 * able to confirm from the outside, and it has been guessed at more than once — each guess
 * costing a list in which every expense reads טרם דווח. So this asks the account instead of
 * the documentation. It reads the payloads the sync kept in `expenses.raw` and prints:
 *
 *  1. how the stored rows are split between דווח / טרם דווח / לא ידוע;
 *  2. every top-level key Morning's expense payloads carry — the field being looked for is
 *     in this list, under whatever name it really has;
 *  3. the values held by the keys whose names suggest they carry it.
 *
 * Then, if credentials are set, it fetches one expense in full: Morning's search returns a
 * lighter row than the record behind it, so a field absent from the list may still be there.
 * Any key the full record has and the search result does not is printed on its own.
 *
 * Output is field names and their values — supplier names, amounts and descriptions are not
 * printed, so it can be pasted into an issue as it stands. `--full` prints the whole fetched
 * payload instead, for when the answer is not in a key that names itself.
 */
import 'dotenv/config';
import { expenseStatusAudit } from '../server/morningExpenses.js';
import { getExpense, isMorningConfigured } from '../server/morningClient.js';

const full = process.argv.includes('--full');
const audit = expenseStatusAudit();

console.log('\n=== סטטוס ההוצאות בבסיס הנתונים ===');
const total = Object.values(audit.counts).reduce((n, c) => n + c, 0);
if (!total) {
  console.log('אין הוצאות מסונכרנות. הריצו סנכרון מ-Morning ואז את הסקריפט הזה שוב.');
  process.exit(0);
}
for (const [status, count] of Object.entries(audit.counts)) {
  console.log(`  ${status.padEnd(9)} ${String(count).padStart(5)}`);
}
console.log(`  payloads kept (raw): ${audit.withRaw}`);

if (!audit.withRaw) {
  console.log(
    '\nאף שורה לא שמרה את ה-payload של Morning — הן סונכרנו לפני שהעמודה `raw` נוספה.\n' +
    'הריצו סנכרון מ-Morning (הכפתור בעמוד הוצאות) ואז את הסקריפט הזה שוב.'
  );
  process.exit(0);
}

console.log('\n=== keys Morning sends on an expense (key × how many payloads have it) ===');
for (const { key, count } of audit.keys) console.log(`  ${key.padEnd(28)} ${count}`);

console.log('\n=== the status-like keys, and the values they hold ===');
if (!audit.statusKeys.length) {
  console.log('  — none. No key in these payloads is named after a status or a report at all,');
  console.log('    which is why every row reads לא ידוע. The answer is either in the full');
  console.log('    record fetched below, or in a key from the list above that does not say so');
  console.log('    in its name.');
}
for (const { key, values } of audit.statusKeys) {
  console.log(`  ${key}:`);
  for (const { value, count } of values.slice(0, 12)) console.log(`      ${String(value).padEnd(24)} × ${count}`);
}

if (!isMorningConfigured()) {
  console.log('\nMorning לא מוגדר (GREEN_INVOICE_ID / GREEN_INVOICE_SECRET) — מדלג על השליפה המלאה.');
  process.exit(0);
}
if (!audit.sampleId) {
  console.log('\nאין external_id לשליפה מלאה.');
  process.exit(0);
}

console.log(`\n=== the same expense fetched in full (GET /expenses/${audit.sampleId}) ===`);
try {
  const detail = (await getExpense(audit.sampleId)) as Record<string, unknown>;
  if (full) {
    console.log(JSON.stringify(detail, null, 2));
  } else {
    const searched = new Set(audit.keys.map((k) => k.key));
    const extra = Object.keys(detail).filter((key) => !searched.has(key));
    console.log(extra.length
      ? `  keys the full record has and the search result does not: ${extra.join(', ')}`
      : '  the full record carries no key the search result was missing.');
    for (const [key, value] of Object.entries(detail)) {
      if (!/report|status|closed|lock|period|approv/i.test(key)) continue;
      console.log(`  ${key.padEnd(28)} ${JSON.stringify(value)?.slice(0, 160)}`);
    }
  }
  console.log('\nהשוו את הערכים כאן למה שמופיע ב-Morning עצמו עבור אותה הוצאה: השדה שמשתנה');
  console.log('בין הוצאה שדווחה לאחת שלא — הוא זה שהמיפוי צריך לקרוא.');
} catch (err: any) {
  console.log(`  השליפה נכשלה: ${err?.message ?? err}`);
}
