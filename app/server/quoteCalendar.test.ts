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
let readOnly = false;

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url!, 'http://fake');
    // The token request is a form, everything else JSON.
    const body = raw && String(req.headers['content-type']).includes('json') ? JSON.parse(raw) : null;
    requests.push({ method: req.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/token') return send(200, { access_token: 'token', expires_in: 3600 });
    if (readOnly && req.method !== 'GET') return send(403, { error: { message: 'Request had insufficient authentication scopes.' } });
    const m = url.pathname.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (!m) return send(404, {});
    const id = m[2] && decodeURIComponent(m[2]);
    if (req.method === 'POST' && !id) {
      const event = { ...body, id: `evt${events.size + 1}`, status: 'confirmed', htmlLink: `https://calendar.test/evt${events.size + 1}` };
      events.set(event.id, event);
      return send(200, event);
    }
    const event = id && events.get(id);
    if (!event) return send(404, { error: { message: 'Not Found' } });
    if (req.method === 'GET') return send(200, event);
    if (req.method === 'PATCH') return send(200, Object.assign(event, body));
    send(405, {});
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

const USER = 'cal-user';
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(120, 1)]).toString('base64');
const MEMBERS = ['amir@moonlight.band', 'itamar@moonlight.band'];

before(() => {
  db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, 'cal@test', 'בדיקה', 'x', 'band')").run(USER);
  const member = db.prepare('INSERT INTO band_members (id, member_key, name, email, active) VALUES (?, ?, ?, ?, 1)');
  member.run('m1', 'amir', 'אמיר', MEMBERS[0]);
  member.run('m2', 'itamar', 'איתמר', MEMBERS[1]);
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
  assert.equal(draft.form.title, 'אופציה - הופעה קולדפליי אירוע חברה קיסריה');
  assert.equal(draft.form.location, 'קיסריה');
  assert.deepEqual([...draft.form.attendees].sort(), [...MEMBERS].sort());
  assert.ok(draft.suppliers.some((s) => s.email === 'dani@sound.test' && s.role_name));
});

test('the option goes on the calendar, invites go out, and the show comes from the calendar', async () => {
  const id = quoteFor('2032-02-10');
  const made = await cal.createQuoteEvent(id, {
    title: 'אופציה - הופעה קולדפליי אירוע חברה קיסריה', location: 'אמפי קיסריה',
    start_time: '20:30', attendees: [...MEMBERS, 'dani@sound.test'],
  });
  const insert = requests.filter((r) => r.method === 'POST' && r.path.endsWith('/events')).at(-1)!;
  assert.equal(insert.query.sendUpdates, 'all');
  assert.equal(insert.path, '/calendars/primary/events');
  assert.deepEqual(insert.body.attendees.map((a: any) => a.email), [...MEMBERS, 'dani@sound.test']);
  assert.deepEqual(insert.body.start, { dateTime: '2032-02-10T20:30:00', timeZone: 'Asia/Jerusalem' });
  assert.deepEqual(insert.body.end, { dateTime: '2032-02-10T22:30:00', timeZone: 'Asia/Jerusalem' });
  assert.equal(made.calendar_matched, true);

  // The sync's own path: «הופעה» comes out of the name, the option stays in it.
  const show = showOf(id);
  assert.equal(show.venue, 'אופציה - קולדפליי אירוע חברה קיסריה');
  assert.equal(show.location, 'אמפי קיסריה');
  assert.equal(show.amount_pre_vat, 0);
  await assert.rejects(cal.createQuoteEvent(id, { title: 'x', attendees: [] }), (e: any) => e.status === 409);
});

test('once signed, the event drops «אופציה» and the show follows it', async () => {
  const id = quoteFor('2032-03-10');
  await cal.createQuoteEvent(id, { title: 'אופציה - הופעה קולדפליי אירוע חברה', attendees: MEMBERS });
  const eventId = q.getQuote(id).quote.calendar_event_id;
  // Amir has answered the invitation; changing the title must not lose that.
  events.get(eventId).attendees[0].responseStatus = 'accepted';

  link.sendQuote(id, USER, 'https://im-tools.org');
  const token = (db.prepare('SELECT public_token FROM band_quotes WHERE id = ?').get(id) as any).public_token;
  link.signQuote(token, { signer_name: 'אינטל', signature_png: PNG, consent: true, version: link.publicQuote(token).version }, { ip: '1', userAgent: 't' });
  assert.equal(showOf(id).amount_pre_vat, 20000);
  assert.ok(shows.quoteFollowUps().stillOption.some((m) => m.id === id));

  const draft = await cal.calendarDraft(id);
  assert.equal(draft.event!.is_option, true);
  assert.equal(draft.form.title, 'הופעה קולדפליי אירוע חברה');

  await cal.updateQuoteEvent(id, draft.form);
  const patch = requests.filter((r) => r.method === 'PATCH').at(-1)!;
  assert.equal(patch.query.sendUpdates, 'all');
  assert.equal(patch.body.summary, 'הופעה קולדפליי אירוע חברה');
  assert.equal(patch.body.attendees.find((a: any) => a.email === MEMBERS[0]).responseStatus, 'accepted');
  assert.equal(showOf(id).venue, 'קולדפליי אירוע חברה');
  assert.ok(!shows.quoteFollowUps().stillOption.some((m) => m.id === id));
});

test('a title the band rule does not recognise makes an event but no show, and says so', async () => {
  const id = quoteFor('2032-04-10');
  const made = await cal.createQuoteEvent(id, { title: 'אופציה - אינטל', attendees: [] });
  assert.equal(made.calendar_matched, false);
  assert.ok(made.quote.calendar_event_id);
  assert.equal(showOf(id), null);
});

test('a token that may only read is answered with what to do about it', async () => {
  readOnly = true;
  try {
    await assert.rejects(
      cal.createQuoteEvent(quoteFor('2032-05-10'), { title: 'אופציה - הופעה', attendees: [] }),
      (e: any) => e.status === 403 && /calendar\.events/.test(e.message)
    );
  } finally { readOnly = false; }
});

test('bad input is refused before anything reaches Google', async () => {
  const id = quoteFor('2032-06-10');
  const before = requests.length;
  await assert.rejects(cal.createQuoteEvent(id, { title: ' ', attendees: [] }), (e: any) => e.status === 400);
  await assert.rejects(cal.createQuoteEvent(id, { title: 'הופעה', start_time: '25:00', attendees: [] }), (e: any) => e.status === 400);
  await assert.rejects(cal.createQuoteEvent(id, { title: 'הופעה', attendees: ['not-an-email'] }), (e: any) => e.status === 400);
  assert.ok(requests.slice(before).every((r) => r.method === 'GET' || r.path === '/token'));
});
