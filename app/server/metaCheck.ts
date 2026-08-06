/**
 * `npm run meta:check` — the Meta permission chain, from the command line.
 *
 * Same diagnosis the Settings panel shows, without needing the server up, a login, or a browser:
 * this is the first thing to run after putting a token in `.env`, because Meta's own #200 blames
 * the ad account for what is almost always a missing asset assignment.
 *
 * Imports only the Graph client, so it touches no database and creates nothing.
 */
import './env.js';
import { diagnose } from './metaClient.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

const result = await diagnose();

console.log('');
console.log(`Meta connection check${result.account_id ? ` — ${result.account_id}` : ''}`);
console.log('');

for (const step of result.steps) {
  console.log(`  ${step.ok ? `${GREEN}✓` : `${RED}✗`}${OFF} ${step.name}`);
  console.log(`      ${DIM}${step.detail}${OFF}`);
  if (step.fix) console.log(`      ${YELLOW}→ ${step.fix}${OFF}`);
}

console.log('');
console.log(result.ok
  ? `${GREEN}All checks passed${OFF} — run the sync from Settings → חיבורים, or POST /api/integrations/meta/sync`
  : `${RED}Something is not set up yet${OFF} — the → lines above say what to change`);
console.log('');

// Non-zero on failure so this is usable in a script or a healthcheck.
process.exit(result.ok ? 0 : 1);
