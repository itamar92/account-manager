import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

/**
 * Google Calendar, faked: a small server that keeps events in memory and records every request.
 * The calendar client reads its addresses from the environment when it loads, so the fake is up
 * and pointed at before anything is imported — no test ever reaches Google or invites anyone.
 */
const events = new Map<string, any>();
const requests: Array<{ method: string; path: string; query: Record<string, string>; body: any }> = [];

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url!, 'http://fake');
    requests.push({ method: req.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), body: null });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/token') return send(200, { access_token: 'token', expires_in: 3600 });
    // The token may only read: the app must never try anything else.
    if (req.method !== 'GET') return send(403, { error: { message: 'Request had insufficient authentication scopes.' } });
    const m = url.pathname.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (!m) return send(404, {});
    const id = m[2] && decodeURIComponent(m[2]);
    if (!id) return send(200, { items: [...events.values()] });
    const event = events.get(id);
    if (!event) return send(404, { error: { message: 'Not Found' } });
    send(200, event);
  });
});
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
const port = (fake.address() as any).port;
Object.assign(process.env, {
  DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'quote-calendar-test-')),
  GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh',
  GOOGLE_OAUTH_TOKEN_URL: `http://127.0.0.1:${port}/token`,
  GOOGLE_CALENDAR_API_URL: `http://127.0.0.1:${port}`,
});

const { db } = await import('./db.js');
const q = await import('./quotes.js');
const link = await import('./quoteLink.js');
const cal = await import('./quoteCalendar.js');
const shows = await import('./quoteShow.js');
const sync = await import('./calendarSync.js');

const USER = 'cal-user';
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(120, 1)]).toString('base64');
const MEMBERS = ['noa@example.com', 'dana@example.com'];

before(() => {
  db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, 'cal@test', 'בדיקה', 'x', 'band')").run(USER);
  const member = db.prepare('INSERT INTO band_members (id, member_key, name, email, active) VALUES (?, ?, ?, ?, 1)');
  member.run('m1', 'm_noa', 'נועה', MEMBERS[0]);
  member.run('m2', 'm_dana', 'דנה', MEMBERS[1]);
  db.prepare("INSERT INTO band_suppliers (id, name, email, role) VALUES ('s1', 'דני סאונד', 'dani@sound.test', 'soundman')").run();
});
// fetch keeps its connections open for reuse; the fake drops them so the test process can end.
after(() => { fake.closeAllConnections(); fake.close(); });

function quoteFor(date: string) {
  const id = q.createBlankQuote({
    client_name: 'אינטל', event_type: 'אירוע חברה', event_location: 'קיסריה', event_date: date,
  }, USER);
  q.updateQuote(id, { prices_include_vat: false, items: [{ name: 'הופעה', quantity: 1, unit_price: 20000 }] }, USER);
  return id;
}

const showOf = (quoteId: string) => {
  const { quote } = q.getQuote(quoteId);
  return quote.show_id ? db.prepare('SELECT * FROM band_events WHERE id = ?').get(quote.show_id) as any : null;
};

test('a new event starts as the band writes them, with every member invited', async () => {
  const draft = await cal.calendarDraft(quoteFor('2032-01-10'));
  assert.equal(draft.configured, true);
  assert.equal(draft.form.title, 'אופציה - הופעה הלהקה אירוע חברה קיסריה');
  assert.equal(draft.form.location, 'קיסריה');
  assert.deepEqual([...draft.form.attendees].sort(), [...MEMBERS].sort());
  assert.ok(draft.suppliers.some((s) => s.email === 'dani@sound.test' && s.role_name));
});

/** What Google's «new event» page would save from the link — the person pressing «שמירה». */
function saveFromLink(link: string, extra: Record<string, unknown> = {}) {
  const p = new URL(link).searchParams;
  const [from, to] = p.get('dates')!.split('/');
  const when = (v: string) => v.includes('T')
    ? { dateTime: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:00+02:00` }
    : { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` };
  const id = `evt${events.size + 1}`;
  const event = {
    id, status: 'confirmed', htmlLink: `https://calendar.test/${id}`,
    summary: p.get('text'), description: p.get('details'), location: p.get('location') ?? undefined,
    start: when(from), end: when(to),
    attendees: (p.get('add') ?? '').split(',').filter(Boolean).map((email) => ({ email, responseStatus: 'needsAction' })),
    ...extra,
  };
  events.set(id, event);
  return event;
}

test('the link is Google’s own new-event page, filled in, and nothing is written', () => {
  const id = quoteFor('2032-02-01');
  const before = requests.length;
  const { url } = cal.quoteEventLink(id, {
    title: 'אופציה - הופעה הלהקה', location: 'אמפי קיסריה', start_time: '20:30',
    attendees: [...MEMBERS, 'dani@sound.test'],
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  const p = u.searchParams;
  assert.equal(p.get('action'), 'TEMPLATE');
  assert.equal(p.get('text'), 'אופציה - הופעה הלהקה');
  assert.equal(p.get('dates'), '20320201T203000/20320201T223000');
  assert.equal(p.get('ctz'), 'Asia/Jerusalem');
  assert.equal(p.get('location'), 'אמפי קיסריה');
  assert.equal(p.get('add'), [...MEMBERS, 'dani@sound.test'].join(','));
  assert.match(p.get('details')!, new RegExp(`am-quote:${id}`));
  assert.equal(requests.length, before);

  const allDay = new URL(cal.quoteEventLink(id, { title: 'הופעה', attendees: [] }).url).searchParams;
  assert.equal(allDay.get('dates'), '20320201/20320202');
  assert.equal(allDay.get('add'), null);
});

test('once saved in Google, «בדיקה ביומן» ties the event to the quote and the show comes from it', async () => {
  const id = quoteFor('2032-02-10');
  const before = await cal.refreshQuoteEvent(id);
  assert.equal(before.calendar_found, false);

  const { url } = cal.quoteEventLink(id, {
    title: 'אופציה - הופעה הלהקה אירוע חברה קיסריה', location: 'אמפי קיסריה',
    start_time: '20:30', attendees: MEMBERS,
  });
  const event = saveFromLink(url);
  const found = await cal.refreshQuoteEvent(id);
  assert.equal(found.calendar_found, true);
  assert.equal(found.calendar_matched, true);
  assert.equal(found.quote.calendar_event_id, event.id);
  assert.equal(found.quote.calendar_event_link, event.htmlLink);

  // The sync's own path: «הופעה» comes out of the name, the option stays in it.
  const show = showOf(id);
  assert.equal(show.venue, 'אופציה - הלהקה אירוע חברה קיסריה');
  assert.equal(show.location, 'אמפי קיסריה');
  assert.equal(show.amount_pre_vat, 0);

  // Saved twice by mistake: the second event does not take the quote over.
  saveFromLink(url);
  await cal.refreshQuoteEvent(id);
  assert.equal(q.getQuote(id).quote.calendar_event_id, event.id);
  assert.ok(requests.every((r) => r.method === 'GET' || r.path === '/token'));
});

test('once signed, «אופציה» is taken off in Google and the show follows it', async () => {
  const id = quoteFor('2032-03-10');
  const event = saveFromLink(cal.quoteEventLink(id, { title: 'אופציה - הופעה הלהקה אירוע חברה', attendees: MEMBERS }).url);
  await cal.refreshQuoteEvent(id);

  link.sendQuote(id, USER, 'https://example.com');
  const token = (db.prepare('SELECT public_token FROM band_quotes WHERE id = ?').get(id) as any).public_token;
  link.signQuote(token, { signer_name: 'אינטל', signature_png: PNG, consent: true, version: link.publicQuote(token).version }, { ip: '1', userAgent: 't' });
  assert.equal(showOf(id).amount_pre_vat, 20000);
  assert.ok(shows.quoteFollowUps().stillOption.some((m) => m.id === id));

  const draft = await cal.calendarDraft(id);
  assert.equal(draft.event!.is_option, true);
  assert.equal(draft.event!.link, event.htmlLink);

  event.summary = 'הופעה הלהקה אירוע חברה';
  await cal.refreshQuoteEvent(id);
  assert.equal(showOf(id).venue, 'הלהקה אירוע חברה');
  assert.ok(!shows.quoteFollowUps().stillOption.some((m) => m.id === id));
});

test('an event deleted in Google gives way to a new one saved from the link', async () => {
  const id = quoteFor('2032-03-20');
  const url = cal.quoteEventLink(id, { title: 'אופציה - הופעה', attendees: [] }).url;
  const first = saveFromLink(url);
  await cal.refreshQuoteEvent(id);
  first.status = 'cancelled';
  assert.equal(((await cal.calendarDraft(id)) as { gone?: boolean }).gone, true);
  const second = saveFromLink(url);
  const again = await cal.refreshQuoteEvent(id);
  assert.equal(again.quote.calendar_event_id, second.id);
});

test('the full calendar sync ties a saved event to its quote as well', async () => {
  const id = quoteFor('2032-07-10');
  const event = saveFromLink(cal.quoteEventLink(id, { title: 'אופציה - הופעה הלהקה', attendees: [] }).url);
  await sync.pullShowsFromCalendar();
  const { quote } = q.getQuote(id);
  assert.equal(quote.calendar_event_id, event.id);
  assert.ok(showOf(id));
});

test('a title the band rule does not recognise is found but makes no show, and says so', async () => {
  const id = quoteFor('2032-04-10');
  saveFromLink(cal.quoteEventLink(id, { title: 'אופציה - אינטל', attendees: [] }).url);
  const made = await cal.refreshQuoteEvent(id);
  assert.equal(made.calendar_found, true);
  assert.equal(made.calendar_matched, false);
  assert.ok(made.quote.calendar_event_id);
  assert.equal(showOf(id), null);
});

test('bad input is refused', () => {
  const id = quoteFor('2032-06-10');
  assert.throws(() => cal.quoteEventLink(id, { title: ' ', attendees: [] }), (e: any) => e.status === 400);
  assert.throws(() => cal.quoteEventLink(id, { title: 'הופעה', start_time: '25:00', attendees: [] }), (e: any) => e.status === 400);
  assert.throws(() => cal.quoteEventLink(id, { title: 'הופעה', attendees: ['not-an-email'] }), (e: any) => e.status === 400);
});
