import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// A stand-in for the Graph API: objects by id, the writes it received, and the pixels' counts.
const objects: Record<string, any> = {};
const writes: Array<{ path: string; params: Record<string, string> }> = [];
let pixels: any[] = [];
let pixelStats: Record<string, any> = {};

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://stub');
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop the version
  const send = (body: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  if (req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(raw));
      delete params.access_token;
      writes.push({ path: parts.join('/'), params });
      if (parts[1] === 'adspixels') return send({ id: '777000111' });
      Object.assign(objects[parts[0]] ?? {}, params);
      send({ success: true });
    });
    return;
  }
  if (parts[1] === 'adspixels') return send({ data: pixels });
  if (parts[1] === 'stats') return send({ data: [{ data: pixelStats[`${parts[0]}:${url.searchParams.get('aggregation')}`] ?? [] }] });
  const obj = objects[parts[0]];
  if (!obj) return send({ error: { message: 'Unsupported get request', code: 100 } });
  send(obj);
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-actions-test-'));
process.env.META_GRAPH_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.META_ACCESS_TOKEN = 'read-token';
process.env.META_AD_ACCOUNT_ID = '1234567';
process.env.META_WRITE_ACCESS_TOKEN = 'write-token';

const { db } = await import('./db.js');
const actions = await import('./metaActions.js');
const pixel = await import('./metaPixel.js');
const advisor = await import('./campaignAdvisor.js');
const review = await import('./campaignReview.js');

const CAMPAIGN = '120000000001';
const ADSET = '120000000002';
const FOREIGN = '120000000099';
const PAST_CAMPAIGN = '120000000003';

before(() => {
  const show = db.prepare('INSERT INTO band_events (id, venue, date, amount_pre_vat, ticket_url) VALUES (?, ?, ?, ?, ?)');
  show.run('show-next', 'זאפה הרצליה', '2099-11-04', 9000, 'https://tickets.example-club.co.il/e/42');
  show.run('show-old', 'בארבי', '2020-01-10', 7000, null);
  const campaign = db.prepare("INSERT INTO meta_campaigns (id, account_id, name, status) VALUES (?, 'act_1234567', ?, 'ACTIVE')");
  campaign.run(CAMPAIGN, 'זאפה נובמבר');
  campaign.run(PAST_CAMPAIGN, 'בארבי ינואר');
  const map = db.prepare('INSERT INTO meta_campaign_events (id, campaign_id, event_id) VALUES (?, ?, ?)');
  map.run('m1', CAMPAIGN, 'show-next');
  map.run('m2', PAST_CAMPAIGN, 'show-old');

  Object.assign(objects, {
    [CAMPAIGN]: { id: CAMPAIGN, name: 'זאפה נובמבר', status: 'ACTIVE', effective_status: 'ACTIVE', account_id: '1234567', daily_budget: '5000' },
    [ADSET]: { id: ADSET, name: 'גברים 25-45', status: 'ACTIVE', account_id: '1234567', campaign: { id: CAMPAIGN, name: 'זאפה נובמבר', status: 'ACTIVE', daily_budget: '5000' } },
    [FOREIGN]: { id: FOREIGN, name: 'של מישהו אחר', status: 'ACTIVE', account_id: '9999999', daily_budget: '5000' },
    [PAST_CAMPAIGN]: { id: PAST_CAMPAIGN, name: 'בארבי ינואר', status: 'PAUSED', account_id: '1234567', daily_budget: '3000' },
  });
});

after(() => server.close());

test('only actions with a real type, a Meta id and a usable value are kept', () => {
  const kept = actions.cleanActions([
    { type: 'pause', level: 'campaign', id: CAMPAIGN, reason: 'ההופעה עברה' },
    { type: 'pause', level: 'campaign', id: CAMPAIGN },                        // the same one twice
    { type: 'delete', level: 'campaign', id: CAMPAIGN },                       // not an action we do
    { type: 'pause', level: 'campaign', id: 'act_1234567' },                   // not an object id
    { type: 'set_daily_budget', level: 'campaign', id: CAMPAIGN, daily_budget: -5 },
    { type: 'set_daily_budget', level: 'ad', id: CAMPAIGN, daily_budget: 80 }, // ads have no budget
    { type: 'set_end_date', level: 'adset', id: ADSET, end_date: '04/11/2099' },
    { type: 'set_daily_budget', level: 'adset', id: Number(ADSET), daily_budget: '80' },
    { type: 'create_pixel' },
  ]);
  assert.deepEqual(kept.map((a) => [a.type, a.id, a.daily_budget]), [
    ['pause', CAMPAIGN, null],
    ['set_daily_budget', ADSET, 80],
    ['create_pixel', null, null],
  ]);
  assert.equal(kept[0].reason, 'ההופעה עברה');
});

test('a preview reads the live state and says now → after; nothing is written', async () => {
  const preview = await actions.previewAction({ type: 'set_daily_budget', level: 'campaign', id: CAMPAIGN, daily_budget: 55 });
  assert.equal(preview.target.name, 'זאפה נובמבר');
  assert.deepEqual(preview.changes, [{ label: 'תקציב יומי', from: '₪50 ליום', to: '₪55 ליום' }]);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.can_execute, true);
  assert.deepEqual(preview.shows.map((s) => s.event_id), ['show-next']);
  assert.equal(writes.length, 0);
});

test('a target outside the band account, a past show or a no-op cannot be carried out', async () => {
  const foreign = await actions.previewAction({ type: 'pause', level: 'campaign', id: FOREIGN });
  assert.equal(foreign.can_execute, false);
  assert.match(foreign.blockers.join(' '), /לא שייך לחשבון/);

  const past = await actions.previewAction({ type: 'activate', level: 'campaign', id: PAST_CAMPAIGN });
  assert.match(past.blockers.join(' '), /כבר היו/);

  const same = await actions.previewAction({ type: 'activate', level: 'campaign', id: CAMPAIGN });
  assert.match(same.blockers.join(' '), /כבר פעיל/);

  // The budget of a CBO campaign lives on the campaign, not on its ad set.
  const cbo = await actions.previewAction({ type: 'set_daily_budget', level: 'adset', id: ADSET, daily_budget: 60 });
  assert.match(cbo.blockers.join(' '), /ברמת הקמפיין/);

  await assert.rejects(actions.executeAction(foreign.id), { status: 409 });
  assert.equal(writes.length, 0);
});

test('a big raise warns about the learning phase; an absurd one is refused', async () => {
  const raise = await actions.previewAction({ type: 'set_daily_budget', level: 'campaign', id: CAMPAIGN, daily_budget: 80 });
  assert.match(raise.warnings.join(' '), /שלב הלמידה/);
  assert.equal(raise.can_execute, true);
  const typo = await actions.previewAction({ type: 'set_daily_budget', level: 'campaign', id: CAMPAIGN, daily_budget: 800 });
  assert.equal(typo.can_execute, false);
});

test('confirm carries out exactly the preview, once', async () => {
  const preview = await actions.previewAction({ type: 'pause', level: 'campaign', id: CAMPAIGN }, { source: 'review', event_id: 'show-next' });
  const done = await actions.executeAction(preview.id);
  assert.equal(done.status, 'done');
  assert.deepEqual(writes.at(-1), { path: CAMPAIGN, params: { status: 'PAUSED' } });
  assert.equal((db.prepare('SELECT status FROM meta_campaigns WHERE id = ?').get(CAMPAIGN) as any).status, 'PAUSED');
  await assert.rejects(actions.executeAction(preview.id), { status: 409 });
  assert.equal(writes.length, 1);
  assert.equal(actions.listActions()[0].id, preview.id);
});

test('if Meta changed since the preview, nothing is sent and the owner is asked to look again', async () => {
  const preview = await actions.previewAction({ type: 'set_daily_budget', level: 'campaign', id: CAMPAIGN, daily_budget: 52 });
  objects[CAMPAIGN].daily_budget = '7000'; // somebody changed it in Ads Manager meanwhile
  const before = writes.length;
  await assert.rejects(actions.executeAction(preview.id), { status: 409, message: /השתנה/ });
  assert.equal(writes.length, before);
  assert.equal(actions.getAction(preview.id).status, 'cancelled');
});

test('an end date is the last minute of that day in Israel, with that day\'s offset', async () => {
  assert.equal(actions.israelEndOfDay('2099-07-01'), '2099-07-01T23:59:00+03:00');
  assert.equal(actions.israelEndOfDay('2099-12-01'), '2099-12-01T23:59:00+02:00');
  const preview = await actions.previewAction({ type: 'set_end_date', level: 'campaign', id: CAMPAIGN, end_date: '2099-11-04' });
  await actions.executeAction(preview.id);
  assert.deepEqual(writes.at(-1), { path: CAMPAIGN, params: { stop_time: '2099-11-04T23:59:00+02:00' } });
});

test('without the write token everything still previews, and nothing can be confirmed', async () => {
  delete process.env.META_WRITE_ACCESS_TOKEN;
  try {
    const preview = await actions.previewAction({ type: 'set_daily_budget', level: 'campaign', id: CAMPAIGN, daily_budget: 75 });
    assert.equal(preview.write_configured, false);
    assert.equal(preview.can_execute, false);
    assert.match(preview.blockers.join(' '), /META_WRITE_ACCESS_TOKEN/);
    await assert.rejects(actions.executeAction(preview.id), { status: 409 });
  } finally {
    process.env.META_WRITE_ACCESS_TOKEN = 'write-token';
  }
});

test('the pixel is verified per club by the sites it fired on, not by anyone\'s word', async () => {
  pixels = [{ id: '555000', name: 'Band pixel', last_fired_time: '2099-10-01T10:00:00+0000' }];
  pixelStats = {
    '555000:event': [{ value: 'PageView', count: 40 }, { value: 'Purchase', count: 3 }],
    '555000:host': [{ value: 'example-club.co.il', count: 25 }, { value: 'band.example', count: 15 }],
  };
  const snapshot = await pixel.refreshPixelSnapshot();
  assert.deepEqual(snapshot.pixels[0].events, { PageView: 40, Purchase: 3 });

  const zappa = pixel.venuePixels().find((v) => v.venue === 'זאפה הרצליה')!;
  assert.deepEqual(zappa.hosts, ['tickets.example-club.co.il']);
  assert.equal(zappa.events_on_site, 25);
  assert.equal(zappa.verified, true);
  assert.equal(zappa.status, 'none'); // the club said nothing yet; the pixel speaks for itself

  const context = advisor.buildContext({}).tracking;
  assert.equal(context.pixel?.id, '555000');
  assert.equal(context.venues.find((v) => v.venue === 'זאפה הרצליה')?.fires_on_ticket_site, true);
});

test('what the owner records about a club is validated, and asking stamps the date', () => {
  assert.throws(() => pixel.setVenuePixel('זאפה הרצליה', { contact_email: 'not an email' }), { status: 400 });
  assert.throws(() => pixel.setVenuePixel('זאפה הרצליה', { status: 'maybe' }), { status: 400 });
  const venue = pixel.setVenuePixel('זאפה הרצליה', { status: 'requested', contact_email: 'box@example-club.co.il', platform: 'Eventer' })!;
  assert.equal(venue.status, 'requested');
  assert.ok(venue.requested_at);
  assert.equal(venue.contact_email, 'box@example-club.co.il');
});

test('the email to the club carries the pixel id, the ticket page and the four events', () => {
  const email = pixel.pixelEmail('זאפה הרצליה');
  assert.equal(email.to, 'box@example-club.co.il');
  assert.equal(email.pixel_id, '555000');
  assert.match(email.body, /Pixel ID\): 555000/);
  assert.match(email.body, /https:\/\/tickets\.example-club\.co\.il\/e\/42/);
  assert.match(email.body, /Eventer/);
  for (const event of ['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase']) assert.match(email.body, new RegExp(event));
  assert.deepEqual(email.warnings, []);
  // Plain hyphens only: an em dash in a message to a club reads as machine-written.
  assert.doesNotMatch(`${email.subject}\n${email.body}`, /[—–]/);
  assert.throws(() => pixel.pixelEmail('מקום שלא קיים'), { status: 404 });
});

test('creating a pixel previews what exists and sends one write to the ad account', async () => {
  const preview = await actions.previewAction({ type: 'create_pixel', pixel_name: 'Tickets' });
  assert.match(preview.warnings.join(' '), /כבר יש בחשבון פיקסל/);
  assert.equal(preview.can_execute, true);
  await actions.executeAction(preview.id);
  assert.deepEqual(writes.at(-1), { path: 'act_1234567/adspixels', params: { name: 'Tickets' } });
});

test('advisor answers keep their actions, and a plan keeps its tracking block', () => {
  const r = review.normaliseReview({ decision: { title: 'לעצור' }, actions: [{ type: 'pause', level: 'campaign', id: CAMPAIGN }, { type: 'nuke' }] });
  assert.equal(r.actions.length, 1);
  const a = advisor.normaliseAnalysis({ findings: [], suggestions: [], actions: [{ type: 'create_pixel' }] });
  assert.equal(a.actions[0].type, 'create_pixel');
  assert.equal(advisor.cleanTracking({ pixel_ready: 'yes', optimization: '' }), null);
  assert.deepEqual(advisor.cleanTracking({ pixel_ready: true, optimization: 'Purchase' }), {
    pixel_ready: true, optimization: 'Purchase', retargeting: null, club_request: null,
  });
});
