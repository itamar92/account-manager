/**
 * סנכרון לילי — the three syncs, run by the server every night instead of waiting for a button.
 *
 * Each sync here is the same function the Settings button calls (the routes use these too), so
 * a night run and a press can never differ in what they pull or apply. Every run goes through
 * `tracked`, which is what feeds the broken-connection notification: a token that expired
 * overnight is known by the morning, not the next time somebody happens to press sync.
 *
 * 03:00 Israel time, once per date. A server that was down at 3 catches up on its first tick
 * before 07:00; after that the day is left to the buttons rather than syncing in the middle of
 * somebody's work. It can be switched off in Settings → חיבורים.
 */
import { getSetting, setSetting } from './db.js';
import { israelDate, israelHour } from './campaignTasks.js';
import { recordFailure, recordSuccess, tracked } from './syncHealth.js';
import { isMorningConfigured } from './morningClient.js';
import { isCalendarConfigured } from './calendarClient.js';
import { isMetaConfigured } from './metaClient.js';
import { pullFromMorning } from './morningSync.js';
import { pullExpensesFromMorning } from './morningExpenses.js';
import { runMatch } from './supplierPayments.js';
import { pullShowsFromCalendar } from './calendarSync.js';
import { applyCampaignSpend, pullCampaignsFromMeta } from './metaSync.js';
import { refreshPixelSnapshot } from './metaPixel.js';

// ---------------------------------------------------------------- the syncs, shared with the routes

/**
 * Documents and expenses from Morning, then the payment matching. The expense half is reported
 * rather than fatal: an account whose plan does not expose expenses still gets its documents.
 */
export async function syncMorning(options: { days?: number } = {}) {
  const result = await tracked('morning', () => pullFromMorning(options));
  const expenses = await pullExpensesFromMorning(options).catch((err: any) => ({
    error: err.message || 'משיכת ההוצאות נכשלה',
  }));
  // A document that has just arrived is the answer to a payment already waiting for it.
  const matched = runMatch();
  return { ...result, expenses, matched: matched.linked };
}

/**
 * The calendar rules. A calendar that fails is reported on its rule's line instead of failing
 * the whole sync — but for the health record a rule that could not read its calendar is a broken
 * connection all the same, so it is recorded as one while the result still comes back.
 */
export async function syncCalendar(options: Parameters<typeof pullShowsFromCalendar>[0] = {}) {
  let result: Awaited<ReturnType<typeof pullShowsFromCalendar>>;
  try {
    result = await pullShowsFromCalendar(options);
  } catch (err) {
    recordFailure('calendar', err);
    throw err;
  }
  const failed = result.rules.filter((r) => r.error);
  if (failed.length) recordFailure('calendar', failed.map((r) => `${r.ruleName}: ${r.error}`).join(' · '));
  else recordSuccess('calendar');
  return result;
}

/** Campaigns and spend from Meta, the pixel counts beside them, then the attribution to shows. */
export async function syncMeta(options: { days?: number } = {}) {
  const result = await tracked('meta', () => pullCampaignsFromMeta(options));
  // The pixel's failure is not the sync's: the spend has landed, and the panel shows its error.
  await refreshPixelSnapshot().catch(() => null);
  return { ...result, applied: applyCampaignSpend() };
}

// ---------------------------------------------------------------- the nightly run

export const NIGHTLY_FROM_HOUR = 3;
export const NIGHTLY_UNTIL_HOUR = 7;

export const isNightlyEnabled = () => getSetting('nightly_sync_enabled', '1') !== '0';
export const setNightlyEnabled = (on: boolean) => setSetting('nightly_sync_enabled', on ? '1' : '0');

export interface NightlyRun {
  date: string;
  started_at: string;
  finished_at: string;
  services: Array<{ service: string; ok: boolean; summary: string }>;
}

export function lastNightlyRun(): NightlyRun | null {
  try {
    const raw = getSetting('nightly_sync_last', '');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

interface Job {
  service: 'morning' | 'calendar' | 'meta';
  configured: () => boolean;
  run: () => Promise<string>;
}

export const JOBS: Job[] = [
  {
    service: 'morning', configured: isMorningConfigured,
    run: async () => {
      const r = await syncMorning();
      const expenses = 'error' in r.expenses ? `הוצאות: ${r.expenses.error}` : `${r.expenses.fetched} הוצאות`;
      return `${r.fetched} מסמכים · ${expenses} · ${r.matched} שויכו לתשלומים`;
    },
  },
  {
    service: 'calendar', configured: isCalendarConfigured,
    run: async () => {
      const r = await syncCalendar();
      const failed = r.rules.filter((rule) => rule.error);
      if (failed.length) throw new Error(failed.map((rule) => `${rule.ruleName}: ${rule.error}`).join(' · '));
      return `${r.created} חדשים · ${r.updated} עודכנו · ${r.removed} הוסרו`;
    },
  },
  {
    service: 'meta', configured: isMetaConfigured,
    run: async () => {
      const r = await syncMeta();
      return `${r.campaigns} קמפיינים · ${r.days_of_spend} ימי הוצאה`;
    },
  },
];

let running = false;

/**
 * One night's run, if tonight's is owed: switched on, inside the window, not yet run today.
 * Services run one after another — they share the database, and nothing is waiting on them.
 */
export async function runNightlySync(now: Date = new Date(), jobs: Job[] = JOBS): Promise<NightlyRun | null> {
  const hour = israelHour(now);
  if (running || !isNightlyEnabled() || hour < NIGHTLY_FROM_HOUR || hour >= NIGHTLY_UNTIL_HOUR) return null;
  const today = israelDate(now);
  if (getSetting('nightly_sync_on', '') === today) return null;
  // Marked before running, so a run that crashes the process is not retried in a loop.
  setSetting('nightly_sync_on', today);
  running = true;
  const run: NightlyRun = { date: today, started_at: new Date().toISOString(), finished_at: '', services: [] };
  try {
    for (const job of jobs) {
      if (!job.configured()) continue;
      try {
        run.services.push({ service: job.service, ok: true, summary: await job.run() });
      } catch (err) {
        run.services.push({ service: job.service, ok: false, summary: String((err as Error)?.message || err).slice(0, 300) });
      }
    }
  } finally {
    running = false;
    run.finished_at = new Date().toISOString();
    setSetting('nightly_sync_last', JSON.stringify(run));
  }
  const failed = run.services.filter((s) => !s.ok);
  if (failed.length) console.warn('[nightly-sync]', failed.map((s) => `${s.service}: ${s.summary}`).join(' | '));
  return run;
}

const TICK_MS = 10 * 60_000;

export function startNightlySync(): void {
  const tick = () => {
    runNightlySync().catch((err) => console.warn('[nightly-sync] run failed:', err?.message));
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, TICK_MS).unref();
}
