import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-show-test-'));
const { db, uuid } = await import('./db.js');
const q = await import('./quotes.js');
const link = await import('./quoteLink.js');
const shows = await import('./quoteShow.js');

const USER = 'show-user';
const META = { ip: '203.0.113.9', userAgent: 'test' };
const PNG = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(120, 1),
]).toString('base64');

before(() => {
  db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, 'show@test', 'בדיקה', 'x', 'band')").run(USER);
});

const expectError = (fn: () => unknown, status: number) =>
  assert.throws(fn, (err: any) => err instanceof q.QuoteError && err.status === status);

/** A quote for 10,000 ₪ before VAT on the date given, sent and ready to sign. */
function sentQuote(date: string, extra: Record<string, unknown> = {}) {
  const id = q.createBlankQuote({ client_name: 'עדן', event_date: date, event_location: 'קיסריה', ...extra }, USER);
  q.updateQuote(id, { prices_include_vat: false, items: [{ name: 'הופעה', quantity: 1, unit_price: 10000 }] }, USER);
  link.sendQuote(id, USER, 'https://im-tools.org');
  return id;
}

function sign(id: string) {
  const token = (db.prepare('SELECT public_token FROM band_quotes WHERE id = ?').get(id) as any).public_token;
  link.signQuote(token, { signer_name: 'עדן', signature_png: PNG, consent: true, version: link.publicQuote(token).version }, META);
  return q.getQuote(id);
}

/** A show as the calendar sync leaves one: from an event, with nothing typed into it. */
function addShow(date: string, venue: string, pre = 0, calendarEventId: string | null = null) {
  const id = uuid();
  db.prepare('INSERT INTO band_events (id, venue, date, amount_pre_vat, amount_with_vat, calendar_event_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, venue, date, pre, pre ? pre * 1.18 : 0, calendarEventId);
  return id;
}

const show = (id: string) => db.prepare('SELECT * FROM band_events WHERE id = ?').get(id) as any;
const showCount = () => (db.prepare('SELECT COUNT(*) AS n FROM band_events').get() as any).n;

test('signing never makes a show: with none on the date, the quote waits for the calendar', () => {
  const before = showCount();
  const { quote } = sign(sentQuote('2031-01-10'));
  assert.equal(showCount(), before);
  assert.equal(quote.show_id, null);
  assert.equal(quote.show_link_status, 'no_show');
  assert.ok(shows.quoteFollowUps().needsShow.some((m) => m.id === quote.id));
});

test('a show arriving from the quote\'s own calendar event after the signature still gets the price', () => {
  const id = sentQuote('2031-01-20');
  db.prepare("UPDATE band_quotes SET calendar_event_id = 'evt-late', calendar_event_title = 'אופציה - הופעה' WHERE id = ?").run(id);
  sign(id);
  const showId = addShow('2031-01-20', 'אופציה - קולדפליי', 0, 'evt-late');
  shows.linkQuotesByCalendar();
  const { quote } = q.getQuote(id);
  assert.equal(quote.show_id, showId);
  assert.equal(quote.show_link_status, 'linked');
  assert.equal(show(showId).amount_pre_vat, 10000);
  assert.equal(show(showId).profit, 10000);
});

test('a draft is pointed at the show its event became, and the show is not touched until signing', () => {
  const id = sentQuote('2031-01-30');
  db.prepare("UPDATE band_quotes SET calendar_event_id = 'evt-draft' WHERE id = ?").run(id);
  const showId = addShow('2031-01-30', 'אופציה - חתונה', 0, 'evt-draft');
  shows.linkQuotesByCalendar();
  assert.equal(q.getQuote(id).quote.show_id, showId);
  assert.equal(show(showId).amount_pre_vat, 0);
  sign(id);
  assert.equal(show(showId).amount_pre_vat, 10000);
});

test('the one show on the date is the show, and an empty amount is filled from the quote', () => {
  const showId = addShow('2031-02-10', 'מהיומן');
  const { quote } = sign(sentQuote('2031-02-10'));
  assert.equal(quote.show_id, showId);
  assert.equal(show(showId).amount_pre_vat, 10000);
  assert.equal(show(showId).venue, 'מהיומן');
});

test('a show with its own price keeps it, and the difference is raised', () => {
  const showId = addShow('2031-03-10', 'חתונה', 9000);
  const { quote } = sign(sentQuote('2031-03-10'));
  assert.equal(show(showId).amount_pre_vat, 9000);
  assert.ok(shows.quoteFollowUps().amountMismatch.some((m) => m.id === quote.id));
  shows.settleShowAmount(quote.id, 'show');
  assert.ok(!shows.quoteFollowUps().amountMismatch.some((m) => m.id === quote.id));
  assert.equal(show(showId).amount_pre_vat, 9000);
});

test('taking the quote\'s figure writes it into the show', () => {
  const showId = addShow('2031-04-10', 'מסיבה', 7000);
  const { quote } = sign(sentQuote('2031-04-10'));
  shows.settleShowAmount(quote.id, 'quote');
  assert.equal(show(showId).amount_pre_vat, 10000);
  assert.equal(show(showId).profit, 10000);
});

test('with several shows on the date nothing is guessed, and the band chooses', () => {
  const a = addShow('2031-05-10', 'צהריים');
  addShow('2031-05-10', 'ערב');
  const { quote } = sign(sentQuote('2031-05-10'));
  assert.equal(quote.show_id, null);
  assert.equal(quote.show_link_status, 'choose');
  shows.linkQuoteToShow(quote.id, a);
  assert.equal(q.getQuote(quote.id).quote.show_id, a);
  assert.equal(show(a).amount_pre_vat, 10000);
  expectError(() => shows.linkQuoteToShow(quote.id, null), 409);
});

test('another client\'s option on the same date is not this quote\'s show', () => {
  const other = sentQuote('2031-06-10', { client_name: 'אחר' });
  db.prepare("UPDATE band_quotes SET calendar_event_id = 'evt-other' WHERE id = ?").run(other);
  const theirs = addShow('2031-06-10', 'אופציה - אחר', 0, 'evt-other');
  const { quote } = sign(sentQuote('2031-06-10', { client_name: 'שני' }));
  assert.equal(quote.show_id, null);
  assert.equal(quote.show_link_status, 'no_show');
  assert.equal(show(theirs).amount_pre_vat, 0);
  expectError(() => shows.linkQuoteToShow(quote.id, theirs), 409);
});

test('a signature is news until the band opens it', () => {
  const { quote } = sign(sentQuote('2031-08-10'));
  assert.ok(shows.quoteFollowUps().newlySigned.some((m) => m.id === quote.id));
  shows.markSignedSeen(quote.id);
  assert.ok(!shows.quoteFollowUps().newlySigned.some((m) => m.id === quote.id));
});

test('a signed quote whose event still says «אופציה» is raised until the title is changed', () => {
  const id = sentQuote('2031-09-10');
  db.prepare("UPDATE band_quotes SET calendar_event_id = 'evt-opt', calendar_event_title = 'אופציה - הופעה קולדפליי' WHERE id = ?").run(id);
  sign(id);
  assert.ok(shows.quoteFollowUps().stillOption.some((m) => m.id === id));
  db.prepare("UPDATE band_quotes SET calendar_event_title = 'הופעה קולדפליי' WHERE id = ?").run(id);
  assert.ok(!shows.quoteFollowUps().stillOption.some((m) => m.id === id));
});

test('«אופציה» comes off a title with whatever dash followed it', () => {
  assert.ok(shows.isOptionTitle('אופציה - הופעה קולדפליי אירוע חברה קיסריה'));
  assert.ok(!shows.isOptionTitle('הופעה קולדפליי'));
  assert.equal(shows.withoutOption('אופציה - הופעה קולדפליי אירוע חברה קיסריה'), 'הופעה קולדפליי אירוע חברה קיסריה');
  assert.equal(shows.withoutOption('אופציה: הופעה'), 'הופעה');
  assert.equal(shows.withoutOption('אופציה הופעה'), 'הופעה');
});
