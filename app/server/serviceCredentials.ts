/**
 * The «מפתחות שירותים» form behind Settings → חיבורים: what it may show about each service's keys,
 * saving new ones, and testing them against the service straight away.
 *
 * The point of the form is the day a key is revoked: the sync starts failing, the owner makes a
 * new key in the service's own UI, pastes it here, and sees in the same click whether the service
 * accepts it — no shell, no `.env`, no restart.
 *
 * Secrets go up and never come back down. The form is told whether one is saved, where it comes
 * from and its last four characters, which is enough to tell two keys apart in the service's own
 * list of keys and not enough to use one.
 */
import {
  CREDENTIAL_SERVICES, clearCredential, resolveCredential, saveCredential, serviceDef,
  type CredentialService, type CredentialServiceDef,
} from './credentials.js';
import { allHealth, recordFailure, recordSuccess, type Service } from './syncHealth.js';
import { isMorningConfigured, ping as morningPing, resetTokenCache as resetMorningToken } from './morningClient.js';
import { isCalendarConfigured, ping as calendarPing, resetTokenCache as resetCalendarToken } from './calendarClient.js';
import { isMetaConfigured, ping as metaPing } from './metaClient.js';
import { isMailConfigured, useTransport, verifyMail } from './mailer.js';

/** Rejected input — routes.ts turns the status into the response code. */
export class CredentialError extends Error {
  status = 400;
}

const CONFIGURED: Record<CredentialService, () => boolean> = {
  morning: isMorningConfigured,
  meta: isMetaConfigured,
  calendar: isCalendarConfigured,
  mail: isMailConfigured,
};

/** The services the health record (syncHealth.ts) follows. Mail is not synced, so it has none. */
const HEALTH_TRACKED: Partial<Record<CredentialService, Service>> = {
  morning: 'morning', meta: 'meta', calendar: 'calendar',
};

/** "••••wxyz" — the end of a secret, and only when there is enough of it that four say nothing. */
function hint(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : '••••';
}

function viewOf(def: CredentialServiceDef) {
  const healthKey = HEALTH_TRACKED[def.key];
  const health = healthKey ? allHealth().find((h) => h.service === healthKey) : undefined;
  const fields = def.fields.map((field) => {
    const { value, source, unreadable } = resolveCredential(field.env);
    return {
      env: field.env,
      label: field.label,
      secret: field.secret,
      placeholder: field.placeholder ?? '',
      source,
      set: Boolean(value),
      unreadable,
      // An ID is not a secret and is what somebody checking the setup wants to read in full.
      value: field.secret ? '' : value,
      hint: field.secret && value ? hint(value) : '',
    };
  });
  return {
    key: def.key,
    label: def.label,
    how_to: def.howTo,
    configured: CONFIGURED[def.key](),
    fields,
    uses_env: fields.some((f) => f.source === 'env'),
    failing_since: health?.failing_since ?? null,
    last_error: health?.last_error ?? null,
  };
}

export type ServiceCredentialsView = ReturnType<typeof viewOf>;

export function credentialsView(): ServiceCredentialsView[] {
  return CREDENTIAL_SERVICES.map(viewOf);
}

function requireDef(service: string): CredentialServiceDef {
  const def = serviceDef(service);
  if (!def) throw new CredentialError(`שירות לא מוכר: ${service}`);
  return def;
}

/** Cached logins made with the old key would otherwise outlive it by up to an hour. */
function forgetSessions(service: CredentialService) {
  if (service === 'morning') resetMorningToken();
  if (service === 'calendar') resetCalendarToken();
  if (service === 'mail') useTransport(null);
}

export interface TestResult {
  ok: boolean;
  message: string;
}

/**
 * Asks the service whether it accepts the keys now in effect, touching no data. The outcome is
 * also written to the health record, so a key that works again clears the «חיבור שבור» alert.
 */
export async function testCredentials(service: string): Promise<TestResult> {
  const def = requireDef(service);
  if (!CONFIGURED[def.key]()) return { ok: false, message: 'חסרים מפתחות — מלאו את כל השדות של השירות' };
  forgetSessions(def.key);
  try {
    let message = '';
    if (def.key === 'morning') { await morningPing(); message = 'Morning אישר את המפתח'; }
    if (def.key === 'calendar') { await calendarPing(); message = 'Google אישר את פרטי החיבור'; }
    if (def.key === 'meta') {
      const account = await metaPing();
      message = `Meta אישרה את הטוקן · ${account.name || account.id} (${account.currency})`;
    }
    if (def.key === 'mail') { await verifyMail(); message = 'שרת המייל אישר את הכניסה'; }
    const healthKey = HEALTH_TRACKED[def.key];
    if (healthKey) recordSuccess(healthKey);
    return { ok: true, message };
  } catch (err) {
    const message = describeFailure(err, def.label);
    const healthKey = HEALTH_TRACKED[def.key];
    if (healthKey) recordFailure(healthKey, message);
    return { ok: false, message };
  }
}

/**
 * Node's fetch says only "fetch failed" when the service could not be reached at all — no DNS, a
 * refused connection, a network down — which reads like a rejected key. Said in words instead, with
 * the underlying cause when there is one.
 */
function describeFailure(err: unknown, label: string): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e instanceof TypeError && /fetch failed/i.test(e.message)) {
    const cause = e.cause?.code || e.cause?.message;
    return `לא ניתן להגיע לשרת של ${label}${cause ? ` (${cause})` : ''} — בעיית רשת, לא בהכרח בעיה במפתח. נסו שוב בעוד רגע.`;
  }
  return e?.message || 'הבדיקה נכשלה';
}

export interface CredentialsPatch {
  /** env name → new value. An empty value means "unchanged", as on every password field here. */
  values?: Record<string, unknown>;
  /** env names whose saved value is to be forgotten, falling back to `.env`. */
  clear?: unknown[];
}

/**
 * Saves what was typed, forgets what was asked to be forgotten, and — when the service then has
 * everything it needs — tests it at once. A failing test does not undo the save: the owner may be
 * entering a key the service has not activated yet, and the message says what the service said.
 */
export async function saveCredentials(service: string, patch: CredentialsPatch) {
  const def = requireDef(service);
  const known = new Set(def.fields.map((f) => f.env));
  const values = patch.values && typeof patch.values === 'object' ? patch.values : {};
  const clear = Array.isArray(patch.clear) ? patch.clear.map(String) : [];

  for (const env of [...Object.keys(values), ...clear]) {
    if (!known.has(env)) throw new CredentialError(`השדה ${env} אינו שייך ל-${def.label}`);
  }
  for (const env of clear) clearCredential(env);
  let changed = clear.length > 0;
  for (const [env, raw] of Object.entries(values)) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    if (/\s/.test(value) && env !== 'SMTP_PASS')
      throw new CredentialError(`${def.fields.find((f) => f.env === env)!.label}: הערך מכיל רווחים — בדקו שהודבק במלואו`);
    saveCredential(env, value);
    changed = true;
  }
  if (!changed) throw new CredentialError('לא הוזן שום ערך חדש');

  forgetSessions(def.key);
  const test = CONFIGURED[def.key]() ? await testCredentials(def.key) : null;
  return { service: viewOf(def), test };
}
