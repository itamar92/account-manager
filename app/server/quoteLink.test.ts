import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// As in quotes.test.ts: the directory first, then the modules that open the database in it.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-link-test-'));
const { db, sha256 } = await import('./db.js');
const q = await import('./quotes.js');
const link = await import('./quoteLink.js');
const share = await import('./quoteShare.js');

const USER = 'link-user';
const BASE = 'https://im-tools.org';
const META = { ip: '203.0.113.7', userAgent: 'test' };
// A real, tiny PNG: the server checks the bytes, not just the prefix.
const PNG = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(120, 1),
]).toString('base64');

before(() => {
  db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, 'link@test', 'בדיקה', 'x', 'band')").run(USER);
});

const expectError = (fn: () => unknown, status: number) =>
  assert.throws(fn, (err: any) => err instanceof q.QuoteError && err.status === status);

/** A quote ready to go to a client. */
function readyQuote(extra: Record<string, unknown> = {}) {
  const id = q.createBlankQuote({
    client_name: 'דנה', client_phone: '050-1234567', client_email: 'dana@example.com',
    event_date: '2030-06-01', internal_note: 'לא ללקוח', title: 'הופעה', ...extra,
  }, USER);
  q.updateQuote(id, { items: [{ name: 'הופעה', quantity: 1, unit_price: 10000 }] }, USER);
  return id;
}

const tokenOf = (id: string) => (db.prepare('SELECT public_token FROM band_quotes WHERE id = ?').get(id) as any).public_token as string;

test('a quote is sent only once it has a client, a date, a line and a validity still running', () => {
  expectError(() => link.sendQuote(q.createBlankQuote({ event_date: '2030-01-01' }, USER), USER, BASE), 400);
  const noLines = q.createBlankQuote({ client_name: 'x', event_date: '2030-01-01' }, USER);
  expectError(() => link.sendQuote(noLines, USER, BASE), 400);
  const expired = readyQuote();
  q.updateQuote(expired, { valid_until: '2020-01-01' }, USER);
  expectError(() => link.sendQuote(expired, USER, BASE), 400);
  expectError(() => link.sendQuote(q.createTemplate({}, USER), USER, BASE), 400);
});

test('sending gives the quote its link and marks it sent; sending again changes nothing', () => {
  const id = readyQuote();
  const first = link.sendQuote(id, USER, BASE);
  assert.match(first.url, /^https:\/\/im-tools\.org\/q\/[A-Za-z0-9_-]{40,}$/);
  assert.equal(first.phone, '972501234567');
  assert.equal(first.email, 'dana@example.com');
  assert.match(first.message, /שלום דנה,/);
  assert.ok(first.message.includes(first.url));
  assert.equal(q.getQuote(id).quote.status, 'sent');

  const again = link.sendQuote(id, USER, BASE);
  assert.equal(again.url, first.url);
  assert.equal(q.getQuote(id).quote.status, 'sent');
});

test('the link shows the client their quote, and nothing that is only the band\'s', () => {
  const id = readyQuote();
  link.sendQuote(id, USER, BASE);
  const view = link.publicQuote(tokenOf(id));
  assert.equal(view.state, 'open');
  assert.equal(view.quote!.client_name, 'דנה');
  assert.equal(view.totals!.net_amount, 10000);
  for (const hidden of ['internal_note', 'client_phone', 'client_email', 'created_by', 'id', 'public_token']) {
    assert.ok(!(hidden in view.quote!), `${hidden} must not reach the client`);
  }
  expectError(() => link.publicQuote('x'.repeat(43)), 404);
});

test('the first visit marks the quote viewed, and every visit is counted', () => {
  const id = readyQuote();
  link.sendQuote(id, USER, BASE);
  link.markViewed(tokenOf(id));
  link.markViewed(tokenOf(id));
  const { quote } = q.getQuote(id);
  assert.equal(quote.status, 'viewed');
  assert.equal(quote.view_count, 2);
  assert.ok(quote.first_viewed_at);
});

test('signing needs a name, consent, a real PNG and the version on screen', () => {
  const id = readyQuote();
  link.sendQuote(id, USER, BASE);
  const token = tokenOf(id);
  const version = link.publicQuote(token).version;
  const ok = { signer_name: 'דנה כהן', signature_png: PNG, consent: true, version };
  expectError(() => link.signQuote(token, { ...ok, signer_name: ' ' }, META), 400);
  expectError(() => link.signQuote(token, { ...ok, consent: false }, META), 400);
  expectError(() => link.signQuote(token, { ...ok, signature_png: 'data:image/png;base64,AAAA' }, META), 400);
  expectError(() => link.signQuote(token, { ...ok, version: '2000-01-01 00:00:00' }, META), 409);
});

test('an edit saved after the client opened the quote cannot be signed unseen', () => {
  const id = readyQuote();
  link.sendQuote(id, USER, BASE);
  const token = tokenOf(id);
  const seen = link.publicQuote(token).version;
  db.prepare("UPDATE band_quotes SET updated_at = '2099-01-01 00:00:00' WHERE id = ?").run(id);
  expectError(() => link.signQuote(token, { signer_name: 'דנה', signature_png: PNG, consent: true, version: seen }, META), 409);
});

test('a signature closes the quote and freezes exactly what was signed', () => {
  const id = readyQuote();
  link.sendQuote(id, USER, BASE);
  const token = tokenOf(id);
  const version = link.publicQuote(token).version;
  const signed = link.signQuote(token, { signer_name: 'דנה כהן', signature_png: PNG, consent: true, version }, META);
  assert.equal(signed.state, 'signed');
  assert.equal(signed.signature!.signer_name, 'דנה כהן');

  const row = db.prepare('SELECT * FROM band_quotes WHERE id = ?').get(id) as any;
  assert.equal(row.status, 'signed');
  assert.equal(row.signer_ip, META.ip);
  assert.equal(row.signed_snapshot_sha256, sha256(row.signed_snapshot));

  // Signed is final: not again, not edited, and the snapshot is what the link keeps showing.
  expectError(() => link.signQuote(token, { signer_name: 'x', signature_png: PNG, consent: true, version: row.updated_at }, META), 409);
  expectError(() => q.updateQuote(id, { title: 'שונה' }, USER), 409);
  db.prepare("UPDATE band_quote_items SET unit_price = 1 WHERE quote_id = ?").run(id);
  assert.equal(link.publicQuote(token).totals!.net_amount, 10000);
  expectError(() => link.regenerateLink(id, BASE), 409);
});

test('a cancelled or expired quote can be seen but not signed, and a new link retires the old one', () => {
  const cancelled = readyQuote();
  link.sendQuote(cancelled, USER, BASE);
  q.cancelQuote(cancelled, USER);
  assert.equal(link.publicQuote(tokenOf(cancelled)).state, 'cancelled');
  assert.equal(link.publicQuote(tokenOf(cancelled)).totals, null);

  const expired = readyQuote();
  link.sendQuote(expired, USER, BASE);
  db.prepare("UPDATE band_quotes SET valid_until = '2020-01-01' WHERE id = ?").run(expired);
  const token = tokenOf(expired);
  const view = link.publicQuote(token);
  assert.equal(view.state, 'expired');
  expectError(() => link.signQuote(token, { signer_name: 'x', signature_png: PNG, consent: true, version: view.version }, META), 409);

  const renewed = link.regenerateLink(expired, BASE);
  assert.ok(!renewed.url.endsWith(token));
  expectError(() => link.publicQuote(token), 404);
});

test('the message fills its placeholders and drops what had nothing to fill', () => {
  const text = share.fillMessage('שלום {client_name},\nקישור: {link}\nתודה, {contact_name}', {
    client_name: 'דנה', title: '', event_date: '', valid_until: '', link: 'https://x/q/abc', contact_name: '', quote_number: '',
  });
  assert.equal(text, 'שלום דנה,\nקישור: https://x/q/abc\nתודה');
});

test('phone numbers are read however they were typed', () => {
  assert.equal(share.whatsappNumber('050-123-4567'), '972501234567');
  assert.equal(share.whatsappNumber('+972 50 123 4567'), '972501234567');
  assert.equal(share.whatsappNumber('03-1234567'), '97231234567');
  assert.equal(share.whatsappNumber('+44 20 7946 0958'), '442079460958');
  assert.equal(share.whatsappNumber('1234'), null);
  assert.equal(share.whatsappUrl(null, 'שלום'), 'https://wa.me/?text=%D7%A9%D7%9C%D7%95%D7%9D');
  assert.match(share.mailtoUrl('dana@example.com', 'נושא', 'א\nב'), /^mailto:dana@example\.com\?subject=.+&body=%D7%90%0D%0A%D7%91$/);
  assert.match(share.mailtoUrl('not an address', 's', 'b'), /^mailto:\?/);
});
