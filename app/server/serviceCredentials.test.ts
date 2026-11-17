import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// A stand-in for Morning's identity service, which issues tokens since its 2026 update: the OAuth
// client-credentials shape is required, and only the "new" key pair is accepted. The retired
// `/account/token` answers 404 to everything, as the real one now does.
const GOOD = { id: 'new-key-id', secret: 'new-secret-0123456789' };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const sent = JSON.parse(body || '{}');
    if (req.url !== '/idp/v1/oauth/token') {
      res.writeHead(404);
      res.end();
    } else if (
      sent.grant_type === 'client_credentials' && sent.client_id === GOOD.id && sent.client_secret === GOOD.secret
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accessToken: 't', expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errorCode: 401, errorMessage: 'Invalid API key' }));
    }
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());

// db.ts opens its file on import, so everything is set before any module is loaded.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'credentials-test-'));
const stub = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.GREEN_INVOICE_BASE_URL = `${stub}/api/v1`;
process.env.GREEN_INVOICE_TOKEN_URL = `${stub}/idp/v1/oauth/token`;
process.env.GREEN_INVOICE_ID = 'env-key-id';
process.env.GREEN_INVOICE_SECRET = 'env-secret-revoked';
delete process.env.META_ACCESS_TOKEN;
delete process.env.META_AD_ACCOUNT_ID;

const { db } = await import('./db.js');
const { credential } = await import('./credentials.js');
const svc = await import('./serviceCredentials.js');
const { isMorningConfigured, parseTokenResponse } = await import('./morningClient.js');

const morningView = () => svc.credentialsView().find((s) => s.key === 'morning')!;

test('with nothing saved, the keys come from .env', () => {
  assert.equal(credential('GREEN_INVOICE_ID'), 'env-key-id');
  const view = morningView();
  assert.equal(view.configured, true);
  assert.deepEqual(view.fields.map((f) => f.source), ['env', 'env']);
  assert.equal(view.uses_env, true);
});

test('a revoked key fails its test and is recorded as a broken connection', async () => {
  const result = await svc.testCredentials('morning');
  assert.equal(result.ok, false);
  assert.match(result.message, /דחה את מפתח ה-API \(401\)/);
  assert.ok(morningView().last_error);
});

test('a saved key wins over .env, is encrypted at rest, and is tested on save', async () => {
  const { service, test: result } = await svc.saveCredentials('morning', {
    values: { GREEN_INVOICE_ID: GOOD.id, GREEN_INVOICE_SECRET: ` ${GOOD.secret} ` },
  });
  assert.equal(credential('GREEN_INVOICE_SECRET'), GOOD.secret);
  assert.deepEqual(result, { ok: true, message: 'Morning אישר את המפתח' });
  // A working key clears the broken-connection record.
  assert.equal(service.last_error, null);

  const raw = db.prepare("SELECT value FROM settings WHERE key = 'credential_GREEN_INVOICE_SECRET'").get() as { value: string };
  assert.ok(raw.value.startsWith('enc.v1:'));
  assert.ok(!raw.value.includes(GOOD.secret));
});

test('the view shows an ID in full and a secret only by its last four characters', () => {
  const [id, secret] = morningView().fields;
  assert.equal(id.value, GOOD.id);
  assert.equal(secret.value, '');
  assert.equal(secret.hint, '••••6789');
  assert.ok(!JSON.stringify(svc.credentialsView()).includes(GOOD.secret));
});

test('an empty field leaves the saved key alone', async () => {
  await svc.saveCredentials('morning', { values: { GREEN_INVOICE_ID: 'new-key-id', GREEN_INVOICE_SECRET: '' } });
  assert.equal(credential('GREEN_INVOICE_SECRET'), GOOD.secret);
});

test('clearing a saved key falls back to .env', async () => {
  await svc.saveCredentials('morning', { clear: ['GREEN_INVOICE_SECRET'] });
  assert.equal(credential('GREEN_INVOICE_SECRET'), 'env-secret-revoked');
  assert.equal(morningView().fields[1].source, 'env');
});

test('a field of another service, or nothing at all, is refused', async () => {
  await assert.rejects(svc.saveCredentials('morning', { values: { META_ACCESS_TOKEN: 'x' } }), svc.CredentialError);
  await assert.rejects(svc.saveCredentials('morning', { values: {} }), /לא הוזן/);
  await assert.rejects(svc.saveCredentials('nope', { values: {} }), /שירות לא מוכר/);
});

test('a service with keys only partly entered is saved but not tested', async () => {
  const { service, test: result } = await svc.saveCredentials('meta', { values: { META_AD_ACCOUNT_ID: '1234567' } });
  assert.equal(result, null);
  assert.equal(service.configured, false);
  assert.equal(isMorningConfigured(), true);
});

test('the token is read from every shape Morning has answered in', () => {
  const now = 1_000_000_000_000;
  assert.deepEqual(parseTokenResponse({ accessToken: 'a', expiresAt: 2_000_000_000 }, now),
    { token: 'a', expiresAt: 2_000_000_000_000 });
  assert.deepEqual(parseTokenResponse({ access_token: 'b', expires_in: 3600 }, now),
    { token: 'b', expiresAt: now + 3_600_000 });
  assert.deepEqual(parseTokenResponse({ token: 'c', expires: 2_000_000_000 }, now),
    { token: 'c', expiresAt: 2_000_000_000_000 });
  assert.equal(parseTokenResponse({ accessToken: 'd' }, now).expiresAt, now + 50 * 60_000);
  assert.throws(() => parseTokenResponse({}, now), /לא החזיר טוקן/);
});
