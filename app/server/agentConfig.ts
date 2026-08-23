/**
 * Where the agent's SSH connection details come from, and what happens when they are typed into
 * the app instead of an environment file.
 *
 * Originally this was `AGENT_SSH_*` in `.env` and nothing else, which meant that connecting the
 * campaign advisor to a machine required a shell on the server, an editor and a restart — for a
 * setting whose whole job is to be changed when the agent moves. So each field now has two
 * possible sources, and the resolution is one rule: **what the settings form saved wins, and the
 * environment is the fallback.** An existing deployment keeps working untouched, a field cleared
 * in the form falls back to the environment rather than to nothing, and there is exactly one
 * place to look when the two disagree — `source` on every field of the view below.
 *
 * The two secrets (the private key and its passphrase) are held encrypted; see secrets.ts. They
 * are never read back out to the browser: the form shows what kind of key is stored and its
 * fingerprint, which is what somebody checking the configuration actually needs, and a key that
 * cannot be identified from its fingerprint can be replaced by pasting a new one.
 */
import ssh2 from 'ssh2';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { getSetting, setSetting } from './db.js';
import { decryptSecret, encryptSecret } from './secrets.js';

const { utils } = ssh2;

export const DEFAULT_COMMAND = 'claude -p --output-format json';
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_PORT = 22;

/** Rejected input, not a broken server: routes.ts turns the status into the response code. */
export class AgentConfigError extends Error {
  status = 400;
}

/** Which of the two places a resolved value came from — reported for every field. */
export type Source = 'ui' | 'env' | 'default';

const KEYS = {
  host: 'agent_ssh_host',
  port: 'agent_ssh_port',
  user: 'agent_ssh_user',
  privateKey: 'agent_ssh_key',
  passphrase: 'agent_ssh_passphrase',
  hostKey: 'agent_ssh_host_key',
  command: 'agent_command',
  timeoutMs: 'agent_timeout_ms',
} as const;

type Field = keyof typeof KEYS;

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function stored(field: Field): string {
  return getSetting(KEYS[field], '').trim();
}

/** The stored value if there is one, otherwise the environment's — with which one it was. */
function resolve(field: Field, envName: string): { value: string; source: Source } {
  const ui = stored(field);
  if (ui) return { value: ui, source: 'ui' };
  const fromEnv = env(envName);
  return fromEnv ? { value: fromEnv, source: 'env' } : { value: '', source: 'default' };
}

/**
 * A PEM as it survives the trip through a `.env` (or a textarea that ate the line breaks).
 *
 * `AGENT_SSH_KEY` has to write its newlines as `\n` because a PEM cannot go on one line any
 * other way, so those are turned back. A key that still has no line breaks after that is a
 * truncated paste, and every caller wants to say so rather than hand ssh2 something it will
 * reject with a parser error.
 */
export function normalizeKey(raw: string): string {
  const key = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  return key.trim() ? `${key.trim()}\n` : '';
}

export interface ParsedKeyInfo {
  type: string;
  fingerprint: string;
  comment: string;
}

/**
 * Reads a private key the way ssh2 will read it at connect time, so a bad paste is caught by the
 * form rather than two minutes later by a failed analysis.
 *
 * An encrypted key with no passphrase is its own answer — ssh2 says so plainly, and repeating
 * that is more useful than "invalid key".
 */
export function inspectKey(key: string, passphrase: string): ParsedKeyInfo {
  const parsed = utils.parseKey(key, passphrase || undefined);
  if (parsed instanceof Error) {
    if (/encrypted/i.test(parsed.message) && !passphrase) {
      throw new AgentConfigError('המפתח מוגן בסיסמה — יש למלא גם את שדה «סיסמת המפתח»');
    }
    if (/decrypt|passphrase|bad pass/i.test(parsed.message)) {
      throw new AgentConfigError('סיסמת המפתח שגויה — לא ניתן לפענח את המפתח הפרטי');
    }
    throw new AgentConfigError(`המפתח הפרטי לא נקרא: ${parsed.message}`);
  }
  const key0 = Array.isArray(parsed) ? parsed[0] : parsed;
  return {
    type: key0.type,
    fingerprint: `SHA256:${createHash('sha256').update(key0.getPublicSSH()).digest('base64').replace(/=+$/, '')}`,
    comment: (key0.comment || '').slice(0, 100),
  };
}

/**
 * The base64 bodies of the host keys we are willing to talk to.
 *
 * `ssh-keyscan` prints one line per key as `host ssh-ed25519 AAAA…`, and pasting its whole output
 * in is the obvious thing to do — so every line of it is accepted, and the host part and the
 * algorithm name are dropped. Comparing bodies rather than whole lines means the same pin works
 * whether it was copied with the host prefix or without.
 */
export function parseHostKeys(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .flatMap((line) => line.trim().split(/\s+/))
    .filter((token) => token.length > 20 && /^[A-Za-z0-9+/]+=*$/.test(token));
}

export interface AgentConfig {
  host: string;
  port: number;
  user: string;
  /** '' when nothing is configured, and null when a stored key exists but cannot be decrypted. */
  privateKey: string | null;
  passphrase: string;
  hostKey: string;
  hostKeys: string[];
  command: string;
  timeoutMs: number;
  sources: Record<Field, Source>;
}

/** The private key from the settings form, from `AGENT_SSH_KEY`, or from a mounted file. */
function resolvePrivateKey(): { value: string | null; source: Source } {
  const ui = stored('privateKey');
  if (ui) {
    const plain = decryptSecret(ui);
    return { value: plain === null ? null : normalizeKey(plain), source: 'ui' };
  }
  const path = env('AGENT_SSH_KEY_PATH');
  if (path) {
    try {
      return { value: normalizeKey(readFileSync(path, 'utf8')), source: 'env' };
    } catch {
      return { value: null, source: 'env' };
    }
  }
  const raw = env('AGENT_SSH_KEY');
  return raw ? { value: normalizeKey(raw), source: 'env' } : { value: '', source: 'default' };
}

function resolvePassphrase(): { value: string; source: Source } {
  const ui = stored('passphrase');
  if (ui) return { value: decryptSecret(ui) || '', source: 'ui' };
  const fromEnv = env('AGENT_SSH_PASSPHRASE');
  return fromEnv ? { value: fromEnv, source: 'env' } : { value: '', source: 'default' };
}

export function agentConfig(): AgentConfig {
  const host = resolve('host', 'AGENT_SSH_HOST');
  const user = resolve('user', 'AGENT_SSH_USER');
  const port = resolve('port', 'AGENT_SSH_PORT');
  const hostKey = resolve('hostKey', 'AGENT_SSH_HOST_KEY');
  const command = resolve('command', 'AGENT_COMMAND');
  const timeout = resolve('timeoutMs', 'AGENT_TIMEOUT_MS');
  const key = resolvePrivateKey();
  const passphrase = resolvePassphrase();

  const parsedPort = parseInt(port.value, 10);
  const parsedTimeout = parseInt(timeout.value, 10);

  return {
    host: host.value,
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT,
    user: user.value,
    privateKey: key.value,
    passphrase: passphrase.value,
    hostKey: hostKey.value,
    hostKeys: parseHostKeys(hostKey.value),
    command: command.value || DEFAULT_COMMAND,
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS,
    sources: {
      host: host.source, port: port.source, user: user.source, privateKey: key.source,
      passphrase: passphrase.source, hostKey: hostKey.source, command: command.source,
      timeoutMs: timeout.source,
    },
  };
}

/** Host, user and a readable key: everything the connection cannot be attempted without. */
export function isAgentConfigured(): boolean {
  const config = agentConfig();
  return Boolean(config.host && config.user && config.privateKey);
}

/**
 * What the settings form is allowed to see.
 *
 * The key and the passphrase go out as facts about themselves — stored or not, what type, which
 * fingerprint — and never as values. Sending back a key that the browser then has to hold, only
 * for it to be posted again on the next save, would put it in a place it does not need to be.
 */
export function agentConfigView() {
  const config = agentConfig();
  let keyInfo: ParsedKeyInfo | null = null;
  let keyError = '';
  if (config.privateKey === null) {
    keyError = 'המפתח השמור לא ניתן לפענוח — ייתכן ש-APP_SECRET_KEY או קובץ secret.key השתנו. הדביקו את המפתח שוב.';
  } else if (config.privateKey) {
    try {
      keyInfo = inspectKey(config.privateKey, config.passphrase);
    } catch (err) {
      keyError = (err as Error).message;
    }
  }

  return {
    host: config.host,
    port: config.port,
    user: config.user,
    host_key: config.hostKey,
    host_key_pinned: config.hostKeys.length > 0,
    command: config.command,
    timeout_ms: config.timeoutMs,
    key_set: config.privateKey !== '',
    key_type: keyInfo?.type || '',
    key_fingerprint: keyInfo?.fingerprint || '',
    key_comment: keyInfo?.comment || '',
    key_error: keyError,
    passphrase_set: Boolean(config.passphrase),
    configured: Boolean(config.host && config.user && config.privateKey),
    sources: config.sources,
    /** True when anything still comes from `.env` — the form says so rather than looking empty. */
    uses_env: Object.values(config.sources).includes('env'),
    defaults: { port: DEFAULT_PORT, command: DEFAULT_COMMAND, timeout_ms: DEFAULT_TIMEOUT_MS },
  };
}

export interface AgentConfigPatch {
  host?: string;
  port?: string | number;
  user?: string;
  private_key?: string;
  passphrase?: string;
  host_key?: string;
  command?: string;
  timeout_ms?: string | number;
  clear_private_key?: boolean;
  clear_passphrase?: boolean;
}

/**
 * Writes the form back.
 *
 * Every field is optional and only what is present is touched, so the form can save one line
 * without resending the key. An empty string is a real instruction — it clears the stored value
 * and lets the environment (or the default) take over again — which is why the two secrets are
 * the exception: an empty key field means "leave it alone", since that is what an untouched
 * password box looks like, and removing a stored key is asked for explicitly with `clear_*`.
 */
export function saveAgentConfig(patch: AgentConfigPatch) {
  if (patch.host !== undefined) {
    const host = String(patch.host).trim();
    if (host && /[\s/]/.test(host)) {
      throw new AgentConfigError('כתובת השרת אינה תקינה — יש להזין שם מארח או כתובת IP בלבד');
    }
    setSetting(KEYS.host, host);
  }

  if (patch.user !== undefined) {
    const user = String(patch.user).trim();
    if (user && /\s/.test(user)) throw new AgentConfigError('שם המשתמש אינו תקין');
    setSetting(KEYS.user, user);
  }

  if (patch.port !== undefined) {
    const raw = String(patch.port).trim();
    if (raw === '') setSetting(KEYS.port, '');
    else {
      const port = parseInt(raw, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new AgentConfigError('הפורט חייב להיות מספר בין 1 ל-65535');
      }
      setSetting(KEYS.port, String(port));
    }
  }

  if (patch.timeout_ms !== undefined) {
    const raw = String(patch.timeout_ms).trim();
    if (raw === '') setSetting(KEYS.timeoutMs, '');
    else {
      const ms = parseInt(raw, 10);
      // The floor is a second because anything under it cannot survive a handshake; the ceiling
      // is ten minutes because the request holding the connection open has to end some time.
      if (!Number.isFinite(ms) || ms < 1000 || ms > 600_000) {
        throw new AgentConfigError('הזמן הקצוב חייב להיות בין 1000 ל-600000 מילישניות');
      }
      setSetting(KEYS.timeoutMs, String(ms));
    }
  }

  if (patch.command !== undefined) {
    const command = String(patch.command).trim();
    // The command is run on the agent host and is never assembled from a request — but it is
    // typed here now, so the shell metacharacters that would turn one command into two are
    // refused rather than passed on.
    if (command && /[;&|`$><\n]/.test(command)) {
      throw new AgentConfigError('הפקודה מכילה תווים לא מותרים (; & | ` $ < >) — יש להזין פקודה אחת בלבד');
    }
    setSetting(KEYS.command, command);
  }

  if (patch.host_key !== undefined) {
    const raw = String(patch.host_key).trim();
    if (raw && parseHostKeys(raw).length === 0) {
      throw new AgentConfigError('מפתח המארח לא זוהה — הדביקו את הפלט של ssh-keyscan -t ed25519 <שרת>');
    }
    setSetting(KEYS.hostKey, raw);
  }

  if (patch.clear_passphrase) setSetting(KEYS.passphrase, '');
  else if (patch.passphrase) setSetting(KEYS.passphrase, encryptSecret(String(patch.passphrase)));

  if (patch.clear_private_key) {
    setSetting(KEYS.privateKey, '');
    setSetting(KEYS.passphrase, '');
  } else if (patch.private_key && String(patch.private_key).trim()) {
    const key = normalizeKey(String(patch.private_key));
    if (!key.includes('\n', key.indexOf('\n') + 1)) {
      throw new AgentConfigError('מפתח ה-SSH נראה חסר — הודבק בשורה אחת ללא מעברי שורה');
    }
    // Validated against the passphrase as it will stand after this save, so pasting a key and
    // its passphrase together works and neither order of the two fields matters.
    const passphrase = patch.clear_passphrase
      ? ''
      : (patch.passphrase ? String(patch.passphrase) : resolvePassphrase().value);
    inspectKey(key, passphrase);
    setSetting(KEYS.privateKey, encryptSecret(key));
  }

  return agentConfigView();
}
