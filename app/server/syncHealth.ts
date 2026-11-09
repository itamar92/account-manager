/**
 * בריאות החיבורים — whether Morning, Google Calendar, Meta and the AI agent still answer.
 *
 * Every sync here runs when somebody presses its button, so a token that expires or an access
 * that is revoked shows up only on the next press, possibly weeks later, by which time the inbox
 * and the reports have been quietly working from old data. This module keeps one record per
 * service of when it started failing and why, fed from two places: the sync routes (a real sync
 * that fails or succeeds) and a cheap daily probe run by the notification scheduler, which uses
 * each client's own `ping` and touches no data.
 *
 * The notifications read it (server/notifications.ts → `sync_health`): a failing service, and a
 * connected one nobody has synced for a while.
 */
import { db, getSetting, setSetting } from './db.js';
import { israelDate } from './campaignTasks.js';
import { isMorningConfigured, ping as morningPing, resetTokenCache as resetMorningToken } from './morningClient.js';
import { isCalendarConfigured, ping as calendarPing, resetTokenCache as resetCalendarToken } from './calendarClient.js';
import { isMetaConfigured, ping as metaPing } from './metaClient.js';
import { isAgentBusy, isAgentConfigured, ping as agentPing } from './agentClient.js';

export type Service = 'morning' | 'calendar' | 'meta' | 'agent';

interface ServiceDef {
  key: Service;
  label: string;
  configured: () => boolean;
  probe: () => Promise<unknown>;
  /** The setting holding the last successful sync, for the staleness check. Null: no sync. */
  lastSyncSetting: string | null;
  /** A connected service not synced for this many days earns a reminder. */
  staleDays: number | null;
  /** Whether staleness matters right now — Meta only does while campaigns are running. */
  staleRelevant?: () => boolean;
}

export const SERVICES: ServiceDef[] = [
  {
    key: 'morning', label: 'Morning (חשבונית ירוקה)', configured: isMorningConfigured,
    // A fresh token, not one cached from before the credentials were revoked.
    probe: () => { resetMorningToken(); return morningPing(); },
    lastSyncSetting: 'morning_last_sync', staleDays: 7,
  },
  {
    key: 'calendar', label: 'Google Calendar', configured: isCalendarConfigured,
    probe: () => { resetCalendarToken(); return calendarPing(); },
    lastSyncSetting: 'calendar_last_sync', staleDays: 7,
  },
  {
    key: 'meta', label: 'Meta Ads', configured: isMetaConfigured,
    probe: () => metaPing(),
    lastSyncSetting: 'meta_last_sync', staleDays: 3,
    staleRelevant: () => (db.prepare(
      "SELECT COUNT(*) AS n FROM meta_campaigns WHERE UPPER(COALESCE(status, '')) = 'ACTIVE'"
    ).get() as { n: number }).n > 0,
  },
  {
    key: 'agent', label: 'סוכן ה-AI', configured: isAgentConfigured,
    probe: () => agentPing(),
    lastSyncSetting: null, staleDays: null,
  },
];

export interface Health {
  service: Service;
  label: string;
  configured: boolean;
  /** ISO time of the first failure in the current run of failures; null while healthy. */
  failing_since: string | null;
  last_error: string | null;
  last_sync: string | null;
}

const key = (service: Service) => `health_${service}`;

function stored(service: Service): { failing_since: string; last_error: string } | null {
  try {
    const raw = getSetting(key(service), '');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const tidy = (message: unknown) => String(message || 'שגיאה לא ידועה').replace(/\s+/g, ' ').trim().slice(0, 240);

/** A failure keeps the date it started; only the message moves on. */
export function recordFailure(service: Service, error: unknown, now: Date = new Date()) {
  const message = tidy((error as any)?.message ?? error);
  const previous = stored(service);
  setSetting(key(service), JSON.stringify({ failing_since: previous?.failing_since ?? now.toISOString(), last_error: message }));
}

export function recordSuccess(service: Service) {
  if (getSetting(key(service), '')) setSetting(key(service), '');
}

/** Runs one sync, recording how it went. The result or the error passes through unchanged. */
export async function tracked<T>(service: Service, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    recordSuccess(service);
    return result;
  } catch (err) {
    recordFailure(service, err);
    throw err;
  }
}

export function healthOf(def: ServiceDef): Health {
  const s = stored(def.key);
  return {
    service: def.key,
    label: def.label,
    configured: def.configured(),
    failing_since: s?.failing_since ?? null,
    last_error: s?.last_error ?? null,
    last_sync: def.lastSyncSetting ? getSetting(def.lastSyncSetting, '') || null : null,
  };
}

export const allHealth = (): Health[] => SERVICES.map(healthOf);

/**
 * The daily probe: once per Israel date per service, only for the connected ones. A service that
 * is no longer configured has its record cleared, since there is nothing left to fail.
 */
export async function runHealthChecks(
  now: Date = new Date(),
  services: ServiceDef[] = SERVICES,
  retryAfterMs = 30_000,
): Promise<void> {
  const today = israelDate(now);
  for (const def of services) {
    if (!def.configured()) { recordSuccess(def.key); continue; }
    const checkedKey = `health_checked_on_${def.key}`;
    if (getSetting(checkedKey, '') === today) continue;
    // An analysis already running holds the SSH session; tomorrow's probe will do.
    if (def.key === 'agent' && isAgentBusy()) continue;
    // Synced successfully today already (the nightly run, usually): that was the real test.
    const lastSync = def.lastSyncSetting ? getSetting(def.lastSyncSetting, '') : '';
    if (lastSync && !stored(def.key) && israelDate(new Date(lastSync)) === today) continue;
    setSetting(checkedKey, today);
    // Tried twice, half a minute apart: a network blip at the moment of the probe is not a
    // broken connection, and an alert for one teaches the owner to ignore the real thing.
    try {
      await def.probe();
      recordSuccess(def.key);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      try {
        await def.probe();
        recordSuccess(def.key);
      } catch (err) {
        recordFailure(def.key, err, now);
      }
    }
  }
}
