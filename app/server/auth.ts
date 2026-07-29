import type { Request, Response, NextFunction } from 'express';
import { db, verifyPassword, sha256, uuid } from './db.js';
import { randomBytes } from 'crypto';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'band';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      apiKeyName?: string;
    }
  }
}

const SESSION_COOKIE = 'am_session';
const SESSION_DAYS = 30;

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const idx = part.indexOf('=');
      return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())];
    })
  );
}

export function createSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
  );
}

export function destroySession(req: Request, res: Response) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
}

export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > datetime('now')`
      )
      .get(token) as SessionUser | undefined;
    if (row) req.user = row;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Owner-only: personal accounting data is never visible to band members.
export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'forbidden' });
  next();
}

// External integrations (Morning app / client management system) authenticate with an API key.
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string' || !key) return res.status(401).json({ error: 'missing X-API-Key header' });
  const row = db.prepare('SELECT id, name FROM api_keys WHERE key_hash = ?').get(sha256(key)) as
    | { id: string; name: string }
    | undefined;
  if (!row) return res.status(401).json({ error: 'invalid API key' });
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  req.apiKeyName = row.name;
  next();
}

export function login(email: string, password: string): SessionUser | null {
  const row = db.prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = ?').get(email) as
    | (SessionUser & { password_hash: string })
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export { uuid };
