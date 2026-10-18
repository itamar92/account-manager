import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts opens its file the moment it is imported, so the directory is set first and the modules
// are loaded after it — a static import would be hoisted above this line and open the real one.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-review-test-'));
const { db } = await import('./db.js');
const advisor = await import('./campaignAdvisor.js');
const tickets = await import('./ticketCheck.js');
const review = await import('./campaignReview.js');
const tasks = await import('./campaignTasks.js');

const SHOW = 'show-zappa';
const SAME_VENUE = 'show-zappa-later';
const OTHER = 'show-barby';

before(() => {
  const insert = db.prepare('INSERT INTO band_events (id, venue, date, amount_pre_vat) VALUES (?, ?, ?, ?)');
  insert.run(SHOW, 'זאפה הרצליה', '2099-11-04', 9000);
  insert.run(SAME_VENUE, 'זאפה הרצליה', '2099-12-01', 9000);
  insert.run(OTHER, 'בארבי', '2099-11-20', 7000);
});

test('a link is kept only as http(s), and a bare domain gets https', () => {
  assert.equal(tickets.cleanUrl('zappa-club.co.il/show/1'), 'https://zappa-club.co.il/show/1');
  assert.equal(tickets.cleanUrl('  '), null);
  assert.throws(() => tickets.cleanUrl('javascript:alert(1)'), { status: 400 });
  assert.throws(() => tickets.cleanUrl('ftp://example.com/x'), { status: 400 });
  assert.throws(() => tickets.cleanUrl(`https://example.com/${'a'.repeat(600)}`), { status: 400 });
});

test('the club site belongs to the venue, the ticket page to the show, and an empty value clears it', () => {
  tickets.setTicketLinks(SHOW, { venue_site: 'https://www.zappa-club.co.il', ticket_url: 'https://www.zappa-club.co.il/e/1' });
  assert.deepEqual(tickets.ticketLinks(SHOW), {
    venue_site: 'https://www.zappa-club.co.il/', ticket_url: 'https://www.zappa-club.co.il/e/1',
  });
  // Another show at the same club starts from the club's site, with no page of its own.
  assert.deepEqual(tickets.ticketLinks(SAME_VENUE), { venue_site: 'https://www.zappa-club.co.il/', ticket_url: null });
  tickets.setTicketLinks(SAME_VENUE, { ticket_url: '' });
  assert.equal(tickets.ticketLinks(SHOW).ticket_url, 'https://www.zappa-club.co.il/e/1');
  assert.throws(() => tickets.ticketLinks('missing'), { status: 404 });
});

test('a ticket answer keeps known shapes only, and one that found nothing always asks', () => {
  const found = tickets.normaliseTickets({
    found: true, availability: 'few_left', tickets_sold: 312.4, tickets_left: -3, show_url: 'javascript:x',
    venue_site: 'https://club.example', summary: ' כרטיסים אחרונים ', price: '120 ₪',
  });
  assert.equal(found.availability, 'few_left');
  assert.equal(found.tickets_sold, 312);
  assert.equal(found.tickets_left, null);
  assert.equal(found.show_url, null);
  assert.equal(found.venue_site, 'https://club.example/');
  assert.equal(found.summary, 'כרטיסים אחרונים');
  assert.equal(found.question, null);

  const missing = tickets.normaliseTickets({ found: false, availability: 'sold_out' });
  assert.equal(missing.availability, 'unknown');
  assert.match(missing.question!, /קישור/);
  assert.equal(tickets.normaliseTickets({ found: true, availability: 'maybe' }).availability, 'unknown');
});

test('the ticket prompt carries the show and the band, and nothing of the books', () => {
  const prompt = tickets.buildTicketPrompt({
    label: 'זאפה הרצליה - 04/11/2099', venue: 'זאפה הרצליה', date: '2099-11-04', location: 'הרצליה', capacity: 400,
    ticket_url: null, venue_site: 'https://club.example/',
  }, 'ההופעה מופיעה תחת שם אחר', '2099-10-18');
  assert.match(prompt, /זאפה הרצליה/);
  assert.match(prompt, /https:\/\/club\.example\//);
  assert.match(prompt, /ההופעה מופיעה תחת שם אחר/);
  assert.match(prompt, /אל תקנה/);
  assert.doesNotMatch(prompt, /9000|amount_pre_vat|revenue|ad_spend/);
});

test('the web command names the web tools the wrapper matches on', () => {
  assert.match(tickets.webCommand(), /--tools WebSearch,WebFetch/);
});

test('the last ticket check of an upcoming show is in every advisor context', () => {
  advisor.saveReport({
    kind: 'tickets', range: {}, eventId: SHOW, request: {},
    response: tickets.normaliseTickets({ found: true, availability: 'sold_out', tickets_sold: 400 }), durationMs: 1,
  });
  const show = advisor.buildContext({}).upcoming_shows.find((s) => s.id === SHOW)!;
  assert.equal(show.ticket_status?.availability, 'sold_out');
  assert.equal(show.ticket_status?.tickets_sold, 400);
  assert.equal(show.venue_site, 'https://www.zappa-club.co.il/');
  assert.equal(advisor.buildContext({}).upcoming_shows.find((s) => s.id === OTHER)!.ticket_status, null);
});

test('every prompt names the Meta options worth considering', () => {
  const prompt = advisor.buildPrompt('המשימה', '{}', {});
  assert.ok(prompt.indexOf(advisor.META_CAPABILITIES) > prompt.indexOf(advisor.LIVE_META_TOOLS));
  assert.ok(prompt.indexOf(advisor.META_CAPABILITIES) < prompt.indexOf('המשימה'));
  assert.match(advisor.META_CAPABILITIES, /LANDING_PAGE_VIEWS/);
});

test('a review keeps known statuses and actions, real rows, and saveable tasks', () => {
  const data = review.normaliseReview({
    status: 'at_risk', headline: ' הוצאה מעל התוכנית ', days_left: 16.6,
    progress: [{ label: 'הוצאה', planned: '700 ₪', actual: '950 ₪', ok: false }, { planned: 'בלי שם' }],
    decision: { action: 'raise_budget', title: 'להעלות ל-80 ₪ ליום', detail: 'בקמפיין התנועה' },
    alternatives: [{ title: 'לעצור את המעורבות', when: 'אם אין קליקים' }, { detail: 'בלי כותרת' }],
    tasks: [{ title: 'לבדוק מכירות', due_date: '2099-10-25' }, { title: 'בלי תאריך' }],
    questions: ['כמה כרטיסים המקום דיווח?', '', 7],
  });
  assert.equal(data.status, 'at_risk');
  assert.equal(data.headline, 'הוצאה מעל התוכנית');
  assert.equal(data.days_left, 17);
  assert.equal(data.progress.length, 1);
  assert.equal(data.decision?.action, 'raise_budget');
  assert.equal(data.alternatives.length, 1);
  assert.deepEqual(data.tasks, [{ title: 'לבדוק מכירות', detail: '', due_date: '2099-10-25' }]);
  assert.deepEqual(data.questions, ['כמה כרטיסים המקום דיווח?']);

  const odd = review.normaliseReview({ status: 'great', decision: { action: 'buy_more', title: 'משהו' } });
  assert.equal(odd.status, null);
  assert.equal(odd.decision?.action, null);
  assert.equal(review.normaliseReview({ decision: { action: 'stop' } }).decision, null);
});

test('starting a show over forgets its plans and reviews, keeps its ticket checks and other shows', () => {
  const save = (kind: string, eventId: string) =>
    advisor.saveReport({ kind, range: {}, eventId, request: {}, response: {}, durationMs: 1 });
  save('draft', SHOW);
  save('draft', SHOW);
  save('review', SHOW);
  save('draft', OTHER);

  assert.deepEqual(advisor.clearShowAdvice(SHOW), { deleted: 3 });
  assert.equal(advisor.lastReport('draft', {}, SHOW), null);
  assert.equal(advisor.lastReport('review', {}, SHOW), null);
  assert.ok(advisor.lastReport('tickets', {}, SHOW));
  assert.ok(advisor.lastReport('draft', {}, OTHER));
});

test('a show is not started over while the agent is working on it', async () => {
  let finish!: () => void;
  const running = advisor.trackJob('review', { event_id: OTHER }, () => new Promise<void>((r) => { finish = r; }));
  assert.throws(() => advisor.clearShowAdvice(OTHER), { status: 409 });
  // Another show is not held by it.
  assert.deepEqual(advisor.clearShowAdvice(SHOW), { deleted: 0 });
  finish();
  await running;
  assert.deepEqual(advisor.clearShowAdvice(OTHER), { deleted: 1 });
});

test('clearing the general advice forgets only that period', () => {
  const save = (from: string, to: string) =>
    advisor.saveReport({ kind: 'analysis', range: { from, to }, request: {}, response: { verdict: 'ok' }, durationMs: 1 });
  save('2099-01-01', '2099-12-31');
  save('2099-01-01', '2099-12-31');
  save('2098-01-01', '2098-12-31');
  assert.deepEqual(advisor.clearAnalysis({ from: '2099-01-01', to: '2099-12-31' }), { deleted: 2 });
  assert.equal(advisor.lastReport('analysis', { from: '2099-01-01', to: '2099-12-31' }), null);
  assert.ok(advisor.lastReport('analysis', { from: '2098-01-01', to: '2098-12-31' }));
});

test("a show's tasks can be cleared, all or the open ones, and its owner stays", () => {
  db.prepare("INSERT OR IGNORE INTO band_members (id, member_key, name) VALUES ('m1', 'm_dana', 'דנה')").run();
  tasks.setTaskOwner(SHOW, 'm_dana');
  const [done] = tasks.createTasks(SHOW, [
    { title: 'בוצעה', due_date: '2099-10-20' },
    { title: 'פתוחה', due_date: '2099-10-25' },
    { title: 'עוד פתוחה', due_date: '2099-10-30' },
  ]);
  tasks.createTasks(OTHER, [{ title: 'של הופעה אחרת', due_date: '2099-10-25' }]);
  tasks.updateTask(done.id, { done: true });

  assert.deepEqual(tasks.deleteShowTasks(SHOW, { openOnly: true }), { deleted: 2 });
  const left = () => tasks.listTaskShows({ all: true }).find((s) => s.event_id === SHOW)!;
  assert.deepEqual(left().tasks.map((t) => t.title), ['בוצעה']);
  assert.deepEqual(tasks.deleteShowTasks(SHOW), { deleted: 1 });
  assert.equal(left().owner, 'm_dana');
  assert.equal(left().tasks.length, 0);
  assert.equal(tasks.listTaskShows({ all: true }).find((s) => s.event_id === OTHER)!.tasks.length, 1);
  assert.throws(() => tasks.deleteShowTasks('missing'), { status: 404 });
});
