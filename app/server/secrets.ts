/**
 * Encryption for the credentials that are typed into the app rather than into a file.
 *
 * The settings table is a plain key/value store that half the app reads, and an SSH private key
 * is not a setting — anything that can read the database file gets it. So the values written by
 * the agent settings form go in sealed: AES-256-GCM, with the key held outside the database.
 *
 * That key comes from `APP_SECRET_KEY` when it is set, and otherwise from `secret.key` beside the
 * database, generated on first use with mode 600. The file is the default because the point of
 * moving this configuration into the UI is that setting the app up should not require editing an
 * environment file — but it means the file belongs in the same backup as the database, and
 * losing one without the other leaves the stored key unreadable. That case is reported (the
 * settings form says the stored key cannot be read and asks for it again) rather than guessed at.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './db.js';

/** Marks a value this module wrote. Anything without it is read back as-is — see decryptSecret. */
const PREFIX = 'enc.v1:';
const KEY_FILE = 'secret.key';

let cached: Buffer | null = null;

function secretKey(): Buffer {
  if (cached) return cached;
  const fromEnv = (process.env.APP_SECRET_KEY || '').trim();
  const material = fromEnv || keyFileMaterial();
  // scrypt rather than the passphrase itself: APP_SECRET_KEY is written by a human and is not
  // 32 bytes of anything.
  cached = scryptSync(material, 'account-manager/secrets', 32);
  return cached;
}

function keyFileMaterial(): string {
  const file = path.join(DATA_DIR, KEY_FILE);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // Falls through to writing a new one.
  }
  const generated = randomBytes(32).toString('hex');
  // wx: two workers starting together must not both write. Whoever loses re-reads the winner's.
  try {
    fs.writeFileSync(file, `${generated}\n`, { mode: 0o600, flag: 'wx' });
    return generated;
  } catch {
    return fs.readFileSync(file, 'utf8').trim();
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.');
}

/**
 * The plaintext, or null when the stored value cannot be opened with the key we have.
 *
 * Null rather than a throw: every caller here is either rendering a status line or building an
 * SSH config, and both would rather say "the stored key is unreadable, enter it again" than fail
 * a page load.
 */
export function decryptSecret(stored: string): string | null {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.slice(PREFIX.length).split('.');
  if (parts.length !== 3) return null;
  const [iv, tag, body] = parts.map((part) => Buffer.from(part, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
