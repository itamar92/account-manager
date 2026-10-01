import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Loaded after the directory is set, for the same reason as in quotes.test.ts.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-files-test-'));
const { db } = await import('./db.js');
const f = await import('./quoteFiles.js');
const q = await import('./quotes.js');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a png')]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

const refused = (fn: () => unknown, status: number) =>
  assert.throws(fn, (err: any) => err instanceof f.FileError && err.status === status);

test('an image is recognised by its bytes, not by what it claims to be', () => {
  assert.equal(f.sniffImage(png), 'image/png');
  assert.equal(f.sniffImage(jpeg), 'image/jpeg');
  assert.equal(f.sniffImage(webp), 'image/webp');
  // An SVG is a document that can carry script; it is not accepted as a logo.
  assert.equal(f.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(f.sniffImage(Buffer.from('%PDF-1.7')), null);
});

test('anything that is not a raster image is refused, and so is an empty or oversized one', () => {
  refused(() => f.saveBrandingImage('logo', Buffer.from('<svg/>'), null), 415);
  refused(() => f.saveBrandingImage('logo', Buffer.alloc(0), null), 415);
  refused(() => f.saveBrandingImage('logo', 'not a buffer', null), 415);
  refused(() => f.saveBrandingImage('logo', Buffer.concat([png, Buffer.alloc(f.MAX_IMAGE_BYTES)]), null), 413);
  assert.equal(f.brandingUrl('logo'), null);
});

test('replacing the logo keeps exactly one, at a new address', () => {
  const first = f.saveBrandingImage('logo', png, null);
  const firstUrl = f.brandingUrl('logo');
  assert.match(firstUrl!, new RegExp(`v=${first}$`));

  const second = f.saveBrandingImage('logo', jpeg, null);
  assert.notEqual(f.brandingUrl('logo'), firstUrl);
  assert.equal(f.brandingImage('logo')!.mime, 'image/jpeg');
  const rows = db.prepare("SELECT id FROM band_quote_files WHERE kind = 'logo'").all() as any[];
  assert.deepEqual(rows.map((r) => r.id), [second]);
});

test('the logo and the signature are separate, and removing one leaves the other', () => {
  f.saveBrandingImage('signature', png, null);
  f.removeBrandingImage('logo');
  assert.equal(f.brandingUrl('logo'), null);
  assert.ok(f.brandingUrl('signature'));
  // The settings carry both addresses, so every screen knows what to show.
  const s = q.quoteSettings();
  assert.equal(s.logo_url, null);
  assert.equal(s.signature_url, f.brandingUrl('signature'));
});

test('colours are stored as hex, and a bad one saves nothing at all', () => {
  const before = q.quoteSettings();
  assert.equal(before.color_primary, q.DEFAULT_COLORS.primary);

  const saved = q.saveQuoteSettings({ color_primary: '#1F3A2E', color_accent: '#2f9e6e' });
  assert.equal(saved.color_primary, '#1f3a2e');
  assert.equal(saved.color_accent, '#2f9e6e');

  assert.throws(() => q.saveQuoteSettings({ brand_name: 'שם אחר', color_accent: 'red' }),
    (err: any) => err instanceof q.QuoteError && err.status === 400);
  // The transaction took the brand name back with it.
  assert.equal(q.quoteSettings().brand_name, before.brand_name);
});
