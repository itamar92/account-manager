import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts opens its file the moment it is imported, so the directory is set first and the modules
// are loaded after it — a static import would be hoisted above this line and open the real one.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quotes-test-'));
const { db } = await import('./db.js');
const q = await import('./quotes.js');

const USER = 'test-user';

before(() => {
  db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, 'amir@test', 'אמיר', 'x', 'band')").run(USER);
});

const expectError = (fn: () => unknown, status: number) =>
  assert.throws(fn, (err: any) => err instanceof q.QuoteError && err.status === status);

test('the day a quote expires is still a day it is valid, in Israel', () => {
  // 21:30 UTC on 14 Oct is already the 15th in Israel (UTC+3 in October).
  assert.equal(q.todayInIsrael(new Date('2026-10-14T21:30:00Z')), '2026-10-15');
  const out = { status: 'sent' as const, valid_until: '2026-10-14' };
  assert.equal(q.displayStatus(out, '2026-10-14'), 'sent');
  assert.equal(q.displayStatus(out, '2026-10-15'), 'expired');
  // Only a quote a client is holding can expire; a draft or a signed one cannot.
  assert.equal(q.displayStatus({ status: 'draft', valid_until: '2020-01-01' }, '2026-10-15'), 'draft');
  assert.equal(q.displayStatus({ status: 'signed', valid_until: '2020-01-01' }, '2026-10-15'), 'signed');
});

test('the first template becomes the default, and a new one starts with a line to price', () => {
  const id = q.createTemplate({}, USER);
  assert.equal(q.quoteSettings().default_template_id, id);
  const { items, quote } = q.getQuote(id);
  assert.equal(quote.is_template, 1);
  assert.equal(quote.quote_number, null);
  assert.equal(items.length, 1);
});

test('a quote from a template takes its content and only the client, date and price change', () => {
  const templateId = q.createTemplate({
    template_name: 'חתונה רגילה',
    title: 'הופעה בחתונה של {client_name}',
    intro: 'שמחים להציע לכם הופעה ב־{event_date}.',
    terms: 'מקדמה של 30% בחתימה.',
    event_type: 'חתונה',
    prices_include_vat: true,
    items: [
      { name: 'הופעה מלאה', quantity: 1, unit_price: 1 },
      { name: 'הגברה ותאורה', quantity: 1, unit_price: 2360 },
    ],
  }, USER);

  const id = q.createFromTemplate(templateId, {
    client_name: 'דנה ורון', client_phone: '050-1234567', event_date: '2027-03-18', price: 11800,
  }, USER);
  const { quote, items } = q.getQuote(id);

  assert.match(quote.quote_number, /^ML-\d{4}-\d{3}$/);
  assert.equal(quote.is_template, 0);
  assert.equal(quote.status, 'draft');
  assert.equal(quote.title, 'הופעה בחתונה של דנה ורון');
  assert.equal(quote.intro, 'שמחים להציע לכם הופעה ב־18/03/2027.');
  assert.equal(quote.terms, 'מקדמה של 30% בחתימה.');
  assert.equal(quote.event_type, 'חתונה');
  assert.equal(quote.event_date, '2027-03-18');
  assert.deepEqual(items.map((i: any) => [i.name, i.unit_price]), [['הופעה מלאה', 11800], ['הגברה ותאורה', 2360]]);
  // VAT-inclusive, so the lines are what the client pays.
  assert.equal(quote.total, 14160);
  assert.equal(quote.net_amount, 12000);
  assert.ok(quote.valid_until > q.todayInIsrael());
  // The template itself is untouched.
  assert.equal(q.getQuote(templateId).items[0].unit_price, 1);
});

test('a quote from a template needs the three things that change', () => {
  const templateId = q.createTemplate({}, USER);
  expectError(() => q.createFromTemplate(templateId, { event_date: '2027-01-01', price: 1 }, USER), 400);
  expectError(() => q.createFromTemplate(templateId, { client_name: 'x', price: 1 }, USER), 400);
  expectError(() => q.createFromTemplate(templateId, { client_name: 'x', event_date: '2027-02-30', price: 1 }, USER), 400);
  expectError(() => q.createFromTemplate(templateId, { client_name: 'x', event_date: '2027-01-01' }, USER), 400);
});

test('quote numbers run in sequence within the year', () => {
  const a = q.getQuote(q.createBlankQuote({}, USER)).quote.quote_number;
  const b = q.getQuote(q.createBlankQuote({}, USER)).quote.quote_number;
  assert.equal(parseInt(b.slice(-3), 10), parseInt(a.slice(-3), 10) + 1);
});

test('saving recomputes the totals and ignores any the caller sent', () => {
  const id = q.createBlankQuote({}, USER);
  const { quote } = q.updateQuote(id, {
    total: 1, discount: 500, prices_include_vat: false,
    items: [{ name: 'הופעה', quantity: 1, unit_price: 10000 }, { name: '', unit_price: 0 }],
  }, USER);
  assert.equal(quote.net_amount, 9500);
  assert.equal(quote.total, 11210);
  assert.equal(q.getQuote(id).items.length, 1);
});

test('a template saves with no client and an emptied title, exactly as the editor sends it', () => {
  const id = q.createTemplate({}, USER);
  const { quote } = q.updateQuote(id, { client_name: '', title: '  ', event_date: '', valid_until: '2027-01-01' }, USER);
  assert.equal(quote.client_name, '');
  assert.equal(quote.title, '');
  // A template has no validity of its own, whatever the form sent.
  assert.equal(quote.valid_until, null);
});

test('a priced line with no name is refused', () => {
  const id = q.createBlankQuote({}, USER);
  expectError(() => q.updateQuote(id, { items: [{ name: ' ', unit_price: 100 }] }, USER), 400);
});

test('a cancelled quote is closed to edits and can then be deleted; a sent one cannot be deleted', () => {
  const id = q.createBlankQuote({}, USER);
  q.cancelQuote(id, USER);
  expectError(() => q.updateQuote(id, { title: 'x' }, USER), 409);
  q.deleteQuote(id);
  expectError(() => q.getQuote(id), 404);

  const sent = q.createBlankQuote({}, USER);
  db.prepare("UPDATE band_quotes SET status = 'sent' WHERE id = ?").run(sent);
  expectError(() => q.deleteQuote(sent), 409);
});

test('a signed quote cannot be edited or cancelled, but can be copied into a fresh draft', () => {
  const id = q.createBlankQuote({ client_name: 'לקוח' }, USER);
  q.updateQuote(id, { items: [{ name: 'הופעה', quantity: 1, unit_price: 5000 }] }, USER);
  db.prepare("UPDATE band_quotes SET status = 'signed', signer_name = 'לקוח', signed_at = datetime('now') WHERE id = ?").run(id);
  expectError(() => q.updateQuote(id, { title: 'x' }, USER), 409);
  expectError(() => q.cancelQuote(id, USER), 409);

  const copy = q.getQuote(q.duplicateQuote(id, USER));
  assert.equal(copy.quote.status, 'draft');
  assert.equal(copy.quote.signer_name, null);
  assert.notEqual(copy.quote.quote_number, q.getQuote(id).quote.quote_number);
  assert.equal(copy.quote.client_name, 'לקוח');
  assert.equal(copy.items[0].unit_price, 5000);
});

test('saving a quote as a template leaves the client and the date behind', () => {
  const id = q.createBlankQuote({ client_name: 'לקוח', event_date: '2027-05-01', title: 'הצעה' }, USER);
  const t = q.getQuote(q.saveAsTemplate(id, 'מהצעה', USER)).quote;
  assert.equal(t.is_template, 1);
  assert.equal(t.template_name, 'מהצעה');
  assert.equal(t.client_name, '');
  assert.equal(t.event_date, null);
  assert.equal(t.valid_until, null);
  assert.equal(t.quote_number, null);
});

test('deleting the default template falls back to the next one', () => {
  const current = q.quoteSettings().default_template_id!;
  q.deleteQuote(current);
  const next = q.quoteSettings().default_template_id;
  assert.ok(next && next !== current);
});

test('templates are not quotes: they are listed apart', () => {
  assert.ok(q.listQuotes().every((row: any) => row.is_template === 0));
  assert.ok(q.listTemplates().length > 0);
});

test('the built-in template is Moonlight\'s own quote, with the show priced per quote and sound included', () => {
  const id = q.createBuiltinTemplate(USER);
  const { quote, items } = q.getQuote(id);
  assert.equal(quote.is_template, 1);
  assert.equal(quote.prices_include_vat, 0);
  assert.match(quote.terms, /7,000 ₪/);
  assert.match(quote.terms, /שוטף \+ 30/);
  assert.match(quote.terms, /30% ממחיר ההופעה/);
  assert.deepEqual(items.map((i: any) => [i.name, i.unit_price]), [['הופעה חיה — הרכב מלא', 0], ['הגברה ותאורה', 0]]);

  const quoteId = q.createFromTemplate(id, {
    client_name: 'עדן', event_date: '2027-04-28', price: 16000,
    event_location: 'קיסריה', show_duration: 'כ־40 דקות',
  }, USER);
  const made = q.getQuote(quoteId);
  assert.equal(made.quote.event_location, 'קיסריה');
  assert.equal(made.quote.show_duration, 'כ־40 דקות');
  assert.match(made.quote.intro, /ב־28\/04\/2027/);
  assert.deepEqual(made.items.map((i: any) => i.unit_price), [16000, 0]);
  // 16,000 ₪ + מע"מ, as the Doc quoted it.
  assert.equal(made.quote.net_amount, 16000);
  assert.ok(made.quote.total > 16000);
});

test('a quote made from a template keeps the template\'s place and length unless the form sends its own', () => {
  const templateId = q.createTemplate({ show_duration: 'כשעה', event_location: 'זאפה' }, USER);
  const kept = q.getQuote(q.createFromTemplate(templateId, { client_name: 'x', event_date: '2027-01-01', price: 1 }, USER));
  assert.equal(kept.quote.show_duration, 'כשעה');
  assert.equal(kept.quote.event_location, 'זאפה');
  const cleared = q.getQuote(q.createFromTemplate(templateId, {
    client_name: 'x', event_date: '2027-01-01', price: 1, show_duration: '', event_location: 'גריי',
  }, USER));
  assert.equal(cleared.quote.show_duration, null);
  assert.equal(cleared.quote.event_location, 'גריי');
  expectError(() => q.updateQuote(kept.quote.id, { show_duration: 'x'.repeat(81) }, USER), 400);
});

test('the built-in template is put in place once, and deleting it does not bring it back', () => {
  const defaultBefore = q.quoteSettings().default_template_id;
  const id = q.seedBuiltinTemplate();
  assert.ok(id);
  // There were templates already, so the one somebody chose stays the default.
  assert.equal(q.quoteSettings().default_template_id, defaultBefore);
  q.deleteQuote(id!);
  assert.equal(q.seedBuiltinTemplate(), null);
});

test('the logo sits in the middle until the settings move it, and only to a side that exists', () => {
  assert.equal(q.quoteSettings().logo_position, 'center');
  assert.equal(q.saveQuoteSettings({ logo_position: 'left' }).logo_position, 'left');
  expectError(() => q.saveQuoteSettings({ logo_position: 'top', brand_name: 'Not saved' }), 400);
  // The refusal leaves the whole form as it was, not just the field it refused.
  assert.equal(q.quoteSettings().logo_position, 'left');
  assert.notEqual(q.quoteSettings().brand_name, 'Not saved');
  q.saveQuoteSettings({ logo_position: 'center' });
});
