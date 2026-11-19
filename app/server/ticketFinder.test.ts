import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// As in quotes.test.ts: the directory first, then the modules that open the database in it.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-finder-test-'));
const { db, uuid } = await import('./db.js');
const t = await import('./ticketFinder.js');

const KW = ['Moonlight', 'מונלייט'];

// ---------- fixtures, cut down from the pages they imitate ----------

/** A venue's listing on a ticketing site: cards as plain links, one of them ours. */
const LISTING = `<!doctype html><html><head><title>זאפה חיפה • הופעות</title></head><body>
  <nav><a href="/">ראשי</a><a href="/concerts">הופעות</a><a href="/cities">ערים</a><a href="/dates">תאריכים</a></nav>
  <a href="https://tickets.example/shows/event/kobi?live_ref=abc">08 12.2026 ג' 21:30 קובי מימון זאפה חיפה</a>
  <a href="https://tickets.example/shows/event/moon1?live_ref=abc"><span>02 12.2026</span>
    <h3>Moonlight - המחווה ל Coldplay</h3><span>זאפה חיפה</span></a>
  <a href="https://tickets.example/shows/event/moon1?live_ref=other">Moonlight - המחווה ל Coldplay</a>
  <p>${'הופעות חיות בזאפה חיפה. '.repeat(30)}</p>
</body></html>`;

/** That show's sale page: a schema.org block, its hall given by reference. */
const SALE_PAGE = `<!doctype html><html><head>
  <title>Moonlight - המחווה ל Coldplay</title>
  <link rel="canonical" href="https://tickets.example/shows/event/moon1"/>
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Place', '@id': 'https://tickets.example/haifa#venue', name: 'זאפה חיפה',
        address: { '@type': 'PostalAddress', addressLocality: 'חיפה' } },
      { '@type': 'MusicEvent', name: 'Moonlight - המחווה ל Coldplay', startDate: '2026-12-02T21:30:00+02:00',
        url: 'https://tickets.example/artist/coldplay',
        location: { '@id': 'https://tickets.example/haifa#venue' },
        offers: { '@type': 'Offer', price: 109, priceCurrency: 'ILS', availability: 'https://schema.org/InStock' } },
    ],
  })}</script></head><body><h1>Moonlight</h1></body></html>`;

/** A sale page with no schema.org block: what it is lives in its title. */
const TITLE_ONLY = `<html><head>
  <meta property="og:title" content="מונלייט – הופעה חיה | 6.12.26 האנגר 11 | כרטיסים">
  <link rel="canonical" href="https://other.example//events/moonlight/8317">
</head><body><p>יום ראשון 6.12.26 בשעה 21:00, פתיחת דלתות 19:30</p><p>מכירה עד 1.12.26</p></body></html>`;

/** What a site that builds its page in the browser sends: nothing to read. */
const SHELL = `<!doctype html><html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>`;

/** A listing that ships its cards as data for the browser to draw, with no plain links to them. */
const DATA_LISTING = `<html><body><div id="root">${'טוען הופעות… '.repeat(60)}</div>
  <a href="/a">1</a><a href="/b">2</a><a href="/c">3</a><a href="/d">4</a><a href="/e">5</a>
  <script>self.__next_f.push([1,"{\\"title\\":\\"Moonlight - המחווה ל Coldplay\\",\\"image\\":\\"/i.webp\\",\\"url\\":\\"\\/shows\\/event\\/moon2\\"}"])</script>
</body></html>`;

// ---------- reading ----------

test('a listing yields the links that name the band, once each, without tracking', () => {
  assert.deepEqual(
    t.findCandidates(LISTING, 'https://tickets.example/zappa-haifa', KW),
    ['https://tickets.example/shows/event/moon1'],
  );
});

test('a listing that only ships data still leads to the sale page', () => {
  assert.deepEqual(
    t.findCandidates(DATA_LISTING, 'https://tickets.example/zappa-haifa', KW),
    ['https://tickets.example/shows/event/moon2'],
  );
});

test('a sale page is read from its schema.org block, hall and all', () => {
  const [ev, ...rest] = t.parseEventPage(SALE_PAGE, 'https://tickets.example/shows/event/moon1?live_ref=x', KW);
  assert.equal(rest.length, 0);
  assert.deepEqual(ev, {
    // The page's canonical address, not the performer page the block names.
    url: 'https://tickets.example/shows/event/moon1',
    title: 'Moonlight - המחווה ל Coldplay',
    date: '2026-12-02',
    time: '21:30',
    venue: 'זאפה חיפה',
    price: 109,
    availability: 'available',
  });
});

test('a sale page without a block is read from its title', () => {
  const [ev] = t.parseEventPage(TITLE_ONLY, 'https://other.example/events/moonlight/8317', KW);
  assert.equal(ev.url, 'https://other.example/events/moonlight/8317');
  assert.equal(ev.date, '2026-12-06');
  assert.equal(ev.time, '21:00');
});

test("a sale page for somebody else's show is not ours", () => {
  assert.deepEqual(t.parseEventPage(SALE_PAGE, 'https://tickets.example/x', ['Queen']), []);
  assert.deepEqual(t.parseEventPage(TITLE_ONLY, 'https://other.example/x', ['Queen']), []);
});

test('a UTC start time is moved to Israel time before its date is taken', () => {
  assert.deepEqual(t.splitStartDate('2026-12-02T22:30:00Z'), { date: '2026-12-03', time: '00:30' });
  assert.deepEqual(t.splitStartDate('2026-12-02T21:30:00+02:00'), { date: '2026-12-02', time: '21:30' });
  assert.deepEqual(t.splitStartDate('2026-12-02'), { date: '2026-12-02', time: null });
});

test('sold out and limited are told apart', () => {
  const page = (availability: string) => SALE_PAGE.replace('https://schema.org/InStock', availability);
  assert.equal(t.parseEventPage(page('https://schema.org/SoldOut'), 'https://x.example/', KW)[0].availability, 'sold_out');
  assert.equal(t.parseEventPage(page('LimitedAvailability'), 'https://x.example/', KW)[0].availability, 'limited');
});

test('addresses inside the server network are refused', () => {
  for (const bad of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/',
    'http://[::1]/', 'file:///etc/passwd', 'ftp://example.com/']) {
    assert.throws(() => t.assertPublicUrl(bad), t.TicketError, bad);
  }
  assert.equal(t.assertPublicUrl('https://live.tickchak.co.il/zappa-haifa').hostname, 'live.tickchak.co.il');
});

test('a search source asks once per search word', () => {
  assert.deepEqual(t.sourcePages('https://s.example/search?q={q}', ['Moonlight', 'מונלייט']), [
    'https://s.example/search?q=Moonlight',
    `https://s.example/search?q=${encodeURIComponent('מונלייט')}`,
  ]);
  assert.deepEqual(t.sourcePages('https://s.example/haifa', KW), ['https://s.example/haifa']);
});

// ---------- one source, end to end, against pages served from memory ----------

const serve = (pages: Record<string, string>): import('./ticketFinder.js').Fetcher => async (url) =>
  pages[url] !== undefined ? { status: 200, url, html: pages[url] } : { status: 404, url, html: '' };

test('a listing is followed to its sale page', async () => {
  const r = await t.searchSource('https://tickets.example/zappa-haifa', KW, serve({
    'https://tickets.example/zappa-haifa': LISTING,
    'https://tickets.example/shows/event/moon1': SALE_PAGE,
  }));
  assert.equal(r.status, 'ok');
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].price, 109);
});

test('each kind of failure says what it is', async () => {
  const shell = await t.searchSource('https://spa.example/', KW, serve({ 'https://spa.example/': SHELL }));
  assert.equal(shell.status, 'unreadable');

  const none = await t.searchSource('https://tickets.example/haifa', KW, serve({
    'https://tickets.example/haifa': LISTING.replace(/Moonlight/g, 'Queen'),
  }));
  assert.equal(none.status, 'empty');

  const gone = await t.searchSource('https://tickets.example/nope', KW, serve({}));
  assert.equal(gone.status, 'error');
  assert.match(gone.message, /404/);
});

// ---------- matching and recording ----------

function addShow(venue: string, date: string): string {
  const id = uuid();
  db.prepare('INSERT INTO band_events (id, venue, date) VALUES (?, ?, ?)').run(id, venue, date);
  return id;
}

const found = (extra: Partial<import('./ticketFinder.js').FoundEvent> = {}) => ({
  url: `https://tickets.example/shows/event/${uuid()}`, title: 'Moonlight - המחווה ל Coldplay',
  date: '2027-03-04', time: '21:30', venue: 'זאפה חיפה', price: 109, availability: 'available' as const, ...extra,
});

test('the show on that date at that hall is taken; the hall saying nothing only suggests it', () => {
  const shows = [{ id: 'a', venue: 'זאפה חיפה', location: null, date: '2027-03-04' }];
  assert.deepEqual(t.matchShow(found(), shows), { event_id: 'a', status: 'confirmed' });
  assert.deepEqual(t.matchShow(found({ venue: null }), shows), { event_id: 'a', status: 'suggested' });
  // The source's name speaks for the hall when the page does not.
  assert.deepEqual(t.matchShow(found({ venue: null }), shows, 'זאפה חיפה'), { event_id: 'a', status: 'confirmed' });
  assert.deepEqual(t.matchShow(found({ date: '2027-03-05' }), shows), { event_id: null, status: 'suggested' });
});

test('two shows on one date go to the one whose hall matches', () => {
  const shows = [
    { id: 'tlv', venue: 'גריי תל אביב', location: null, date: '2027-03-04' },
    { id: 'hfa', venue: 'זאפה חיפה', location: null, date: '2027-03-04' },
  ];
  assert.deepEqual(t.matchShow(found(), shows), { event_id: 'hfa', status: 'confirmed' });
});

test('a run records once, refreshes after, and remembers a rejection', () => {
  const showId = addShow('זאפה חיפה', '2027-05-01');
  const ev = found({ date: '2027-05-01' });

  assert.deepEqual(t.recordFound(null, [ev]), { added: 1, matched: 1 });
  const [link] = t.linksForShow(showId) as any[];
  assert.equal(link.status, 'confirmed');

  // Seen again with a new price: the same row, refreshed.
  assert.deepEqual(t.recordFound(null, [{ ...ev, price: 129, availability: 'sold_out' }]), { added: 0, matched: 0 });
  const [again] = t.linksForShow(showId) as any[];
  assert.equal(again.id, link.id);
  assert.equal(again.price, 129);
  assert.equal(again.availability, 'sold_out');

  t.updateLink(link.id, { status: 'rejected' });
  t.recordFound(null, [ev]);
  assert.equal(t.linksForShow(showId).length, 0);
});

test('a date with no show waits, and is matched once the show exists', () => {
  const ev = found({ date: '2099-06-01' });
  t.recordFound(null, [ev]);
  assert.ok((t.unassignedLinks() as any[]).some((l) => l.url === ev.url));

  const showId = addShow('זאפה חיפה', '2099-06-01');
  assert.deepEqual(t.recordFound(null, [ev]), { added: 0, matched: 1 });
  assert.equal((t.linksForShow(showId) as any[])[0].url, ev.url);
  assert.ok(!(t.unassignedLinks() as any[]).some((l) => l.url === ev.url));
});

test('a link pasted by hand is confirmed and read for its details', async () => {
  const showId = addShow('זאפה חיפה', '2026-12-02');
  const link = await t.addLinkByHand(showId, 'https://tickets.example/shows/event/moon1?utm_source=wa',
    serve({ 'https://tickets.example/shows/event/moon1': SALE_PAGE })) as any;
  assert.equal(link.status, 'confirmed');
  assert.equal(link.url, 'https://tickets.example/shows/event/moon1');
  assert.equal(link.price, 109);

  // A later search finding the same page fills the same row.
  assert.deepEqual(t.recordFound(null, t.parseEventPage(SALE_PAGE, link.url, KW)), { added: 0, matched: 0 });
  assert.equal(t.linksForShow(showId).length, 1);
});

test('a source run writes what happened onto the source', async () => {
  const source = t.createSource({ name: 'זאפה חיפה', url: 'https://tickets.example/zappa-haifa' }) as any;
  const summary = await t.runTicketSearch({
    sourceId: source.id,
    fetcher: serve({
      'https://tickets.example/zappa-haifa': LISTING,
      'https://tickets.example/shows/event/moon1': SALE_PAGE,
    }),
  });
  assert.equal(summary.sources[0].status, 'ok');
  const row = db.prepare('SELECT * FROM ticket_sources WHERE id = ?').get(source.id) as any;
  assert.equal(row.last_status, 'ok');
  assert.equal(row.last_found, 1);
  assert.ok(row.last_run_at);
});

test('search words: the default until set, and never empty', () => {
  assert.deepEqual(t.getKeywords(), t.DEFAULT_KEYWORDS);
  assert.deepEqual(t.setKeywords('Moonlight, מונלייט ,  Coldplay Tribute'), ['Moonlight', 'מונלייט', 'Coldplay Tribute']);
  assert.deepEqual(t.getKeywords(), ['Moonlight', 'מונלייט', 'Coldplay Tribute']);
  assert.throws(() => t.setKeywords(' , '), t.TicketError);
});

// ---------- another band's own site, kept to the owner's calendar ----------

/** A band's list of shows, laid out as karni-band.com lays it out: one row of blocks per show. */
const row = (city: string, show: string, date: string, hall: string, buy: string) => `
  <div class="row"><div class="col"><p><span>${city}<br/></span></p></div>
    <div class="col"><a href="default.asp" class="btn"><span>&nbsp;${show}&nbsp;</span></a></div>
    <div class="col"><p><span>מוצ"ש, ${date}</span></p><p><span>20:30</span></p></div>
    <div class="col"><p><span>${hall}</span></p></div>
    <div class="col"><a class="btn" href="${buy}"><span>רכישת כרטיסים</span></a></div></div>`;

const BAND_SITE = `<!doctype html><html><head><title>Karni Band</title></head><body>
  <nav><a href="page1.asp">אודות</a><a href="page2.asp">גלריה</a><a href="page3.asp">סרטונים</a><a href="page4.asp">צור קשר</a></nav>
  <div class="gallery"><a href="page2.asp">קווין ברחובות 22.08.2024</a></div>
  <h2>לוח ההופעות</h2>
  ${row('נתניה', 'QUEEN', '12.12.2026', 'היכל תרבות נתניה', 'https://www.leaan.co.il/events/karni-queen/6118')}
  ${row('בת ים', 'JULIO IGLESIAS', '17.12.2026', 'היכל תרבות בת ים', 'https://friends-hist.co.il/show/karni-julio/')}
  ${row('עומר', 'ABBA', '19.12.2026', 'אמפיתאטרון עומר', '#')}
  ${row('רחובות', 'ELTON JOHN', '01.11.2026', 'בית העם רחובות', 'https://www.leaan.co.il/events/karni-elton/6000')}
  <p>${'להקת קרניבנד במופעי מחווה. '.repeat(20)}</p>
</body></html>`;

const TODAY = '2026-11-19';

test("a band's own site yields one show per row: its date, its ticket link, and what the row says", () => {
  const shows = t.findListedShows(BAND_SITE, 'https://karni-band.com/', TODAY);
  assert.deepEqual(shows.map((s) => [s.date, s.time, s.title, s.url]), [
    ['2026-12-12', '20:30', 'נתניה · QUEEN · היכל תרבות נתניה', 'https://www.leaan.co.il/events/karni-queen/6118'],
    ['2026-12-17', '20:30', 'בת ים · JULIO IGLESIAS · היכל תרבות בת ים', 'https://friends-hist.co.il/show/karni-julio/'],
  ]);
  // Not the row whose ticket button is still a placeholder, not a date already past, not the gallery.
});

const gig = (id: string, date: string, title: string) => ({ id, date, title, text: title });

test('a listed show is on the calendar when an entry that day names its city, hall or show', () => {
  const [queen] = t.findListedShows(BAND_SITE, 'https://karni-band.com/', TODAY);
  assert.equal(t.matchCalendar(queen, [gig('a', '2026-12-12', 'הופעה נתניה')], [])?.id, 'a');
  assert.equal(t.matchCalendar(queen, [gig('a', '2026-12-12', 'Queen')], [])?.id, 'a');
  // Same evening, another band's show elsewhere: not it.
  assert.equal(t.matchCalendar(queen, [gig('m', '2026-12-12', 'Moonlight זאפה חיפה')], []), null);
  // The hall's generic words are not enough on their own.
  assert.equal(t.matchCalendar(queen, [gig('h', '2026-12-12', 'היכל התרבות')], []), null);
  // An entry that only says the band's name counts once that name is given.
  assert.equal(t.matchCalendar(queen, [gig('k', '2026-12-12', 'קרני')], []), null);
  assert.equal(t.matchCalendar(queen, [gig('k', '2026-12-12', 'קרני')], ['קרני'])?.id, 'k');
  assert.equal(t.matchCalendar(queen, [gig('a', '2026-12-13', 'נתניה')], []), null);
});

test('a calendar source keeps only the gigs on the calendar, and lets go of one that leaves it', async () => {
  const source = t.createSource({ name: 'קרניבנד', url: 'https://karni-band.com/', match_to: 'calendar' }) as any;
  assert.equal(source.all_shows, 1);
  const site = serve({ 'https://karni-band.com/': BAND_SITE });
  const mine = () => (t.calendarLinks() as any[]).filter((l) => l.source_id === source.id);

  let calendar = [gig('cal-1', '2026-12-17', 'קרני - בת ים')];
  const runIt = () => t.runTicketSearch({ sourceId: source.id, fetcher: site, loadGigs: async () => calendar, today: TODAY });

  const first = await runIt();
  assert.equal(first.sources[0].status, 'ok');
  assert.equal(first.sources[0].message, '2 הופעות באתר · 1 מהן ביומן שלך');
  assert.deepEqual(mine().map((l) => [l.event_date, l.calendar_title, l.status]), [['2026-12-17', 'קרני - בת ים', 'confirmed']]);
  // A calendar gig is not a date "with no show" waiting to be assigned.
  assert.ok(!(t.unassignedLinks() as any[]).some((l) => l.source_id === source.id));

  calendar = [gig('cal-2', '2026-12-12', 'קרני'), gig('cal-1', '2026-12-17', 'קרני - בת ים')];
  t.updateSource(source.id, { calendar_words: 'קרני' });
  await runIt();
  assert.deepEqual(mine().map((l) => l.event_date), ['2026-12-12', '2026-12-17']);

  calendar = [gig('cal-2', '2026-12-12', 'קרני')];
  await runIt();
  assert.deepEqual(mine().map((l) => l.event_date), ['2026-12-12']);

  // Turned down by the owner, it stays down.
  t.updateLink(mine()[0].id, { status: 'rejected' });
  await runIt();
  assert.deepEqual(mine(), []);
});

test("a calendar source whose calendar can't be read says so", async () => {
  const source = t.createSource({ name: 'להקה', url: 'https://band.example/', match_to: 'calendar' }) as any;
  const r = await t.runTicketSearch({
    sourceId: source.id,
    fetcher: serve({ 'https://band.example/': BAND_SITE }),
    loadGigs: async () => { throw new Error('Google Calendar לא מוגדר'); },
    today: TODAY,
  });
  assert.equal(r.sources[0].status, 'error');
  assert.match(r.sources[0].message, /היומן לא נקרא/);
});
