/**
 * The keys the app uses to reach the services it syncs with — Morning, Meta, Google Calendar
 * and the mail account — and where each one is read from.
 *
 * They used to live only in `.env`, so replacing a revoked key meant a shell on the server, an
 * editor and a restart, usually discovered at the moment a sync failed. Now each key has two
 * possible sources and one rule, the same one the agent settings follow (agentConfig.ts): **what
 * was saved in Settings → חיבורים wins, and the environment is the fallback.** A deployment that
 * only ever set `.env` keeps working untouched, and a key removed in the form falls back to the
 * environment rather than to nothing.
 *
 * Every value saved here is encrypted (secrets.ts) — the IDs too, since the cost is nothing and
 * the settings table is read by half the app. Only this module and the clients read them.
 *
 * This file deliberately imports nothing but the database and the cipher, because every client
 * imports it; testing a key against its service lives in serviceCredentials.ts.
 */
import { db, getSetting, setSetting } from './db.js';
import { decryptSecret, encryptSecret } from './secrets.js';

export type CredentialService = 'morning' | 'meta' | 'calendar' | 'mail';

export interface CredentialField {
  /** The environment variable this key falls back to — also its name in storage. */
  env: string;
  label: string;
  /** Secrets never leave the server once saved; only their last characters are shown. */
  secret: boolean;
  placeholder?: string;
}

export interface CredentialServiceDef {
  key: CredentialService;
  label: string;
  /** Where in the service's own UI a new key is made — shown beside the form. */
  howTo: string;
  fields: CredentialField[];
}

export const CREDENTIAL_SERVICES: CredentialServiceDef[] = [
  {
    key: 'morning',
    label: 'Morning (חשבונית ירוקה)',
    howTo: 'ב-Morning: הגדרות → כלים למפתחים → מפתחות API → יצירת מפתח. מזהה המפתח והסוד מוצגים פעם אחת בלבד.',
    fields: [
      { env: 'GREEN_INVOICE_ID', label: 'מזהה מפתח (API Key ID)', secret: false },
      { env: 'GREEN_INVOICE_SECRET', label: 'סוד (API Secret)', secret: true },
    ],
  },
  {
    key: 'meta',
    label: 'Meta Ads',
    howTo: 'בהגדרות העסק של Meta, תחת «משתמשי מערכת»: יצירת טוקן חדש עם ההרשאות ads_read ו-ads_management.',
    fields: [
      { env: 'META_ACCESS_TOKEN', label: 'טוקן גישה (System User Token)', secret: true },
      { env: 'META_AD_ACCOUNT_ID', label: 'מזהה חשבון הפרסום', secret: false, placeholder: 'act_1234567890' },
    ],
  },
  {
    key: 'calendar',
    label: 'Google Calendar',
    howTo: 'במסוף Google Cloud, במסך «Credentials» של הפרויקט: פרטי לקוח ה-OAuth. את ה-Refresh Token מפיקים פעם אחת מול חשבון היומן.',
    fields: [
      { env: 'GOOGLE_CLIENT_ID', label: 'Client ID', secret: false, placeholder: '…apps.googleusercontent.com' },
      { env: 'GOOGLE_CLIENT_SECRET', label: 'Client Secret', secret: true },
      { env: 'GOOGLE_REFRESH_TOKEN', label: 'Refresh Token', secret: true },
    ],
  },
  {
    key: 'mail',
    label: 'מייל (Gmail SMTP)',
    howTo: 'בחשבון Google: אבטחה → אימות דו-שלבי → סיסמאות לאפליקציות → יצירת סיסמה.',
    fields: [
      { env: 'SMTP_USER', label: 'כתובת Gmail', secret: false, placeholder: 'band@gmail.com' },
      { env: 'SMTP_PASS', label: 'סיסמת אפליקציה', secret: true, placeholder: 'abcd efgh ijkl mnop' },
    ],
  },
];

export type CredentialSource = 'ui' | 'env' | 'none';

const storageKey = (env: string) => `credential_${env}`;

/** The stored ciphertext for a key, or '' when nothing was saved in the form. */
function stored(env: string): string {
  return getSetting(storageKey(env), '').trim();
}

/**
 * A key's value and where it came from.
 *
 * A saved value that no longer decrypts (APP_SECRET_KEY or secret.key changed) is reported as
 * unreadable rather than silently replaced by the environment's: the form says so and asks for
 * the key again, instead of the app quietly using an older key nobody meant to use.
 */
export function resolveCredential(env: string): { value: string; source: CredentialSource; unreadable: boolean } {
  const saved = stored(env);
  if (saved) {
    const plain = decryptSecret(saved);
    return plain === null
      ? { value: '', source: 'ui', unreadable: true }
      : { value: plain.trim(), source: 'ui', unreadable: false };
  }
  const fromEnv = (process.env[env] || '').trim();
  return { value: fromEnv, source: fromEnv ? 'env' : 'none', unreadable: false };
}

/** The value a client should use: the saved one, else the environment's, else ''. */
export function credential(env: string): string {
  return resolveCredential(env).value;
}

/** Saves a key, encrypted. An empty value is not a save — `clearCredential` removes one. */
export function saveCredential(env: string, value: string) {
  const clean = value.trim();
  if (clean) setSetting(storageKey(env), encryptSecret(clean));
}

/** Forgets the saved key, so the environment's (if any) is used again. */
export function clearCredential(env: string) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(storageKey(env));
}

export function serviceDef(key: string): CredentialServiceDef | undefined {
  return CREDENTIAL_SERVICES.find((s) => s.key === key);
}
