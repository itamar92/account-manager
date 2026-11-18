import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'show-board-test-'));
const { db, uuid } = await import('./db.js');
const board = await import('./showBoard.js');
const { refreshPrivate } = await import('./showPrivacy.js');

before(() => {
  db.prepare("INSERT INTO band_members (id, member_key, name, email, role, active) VALUES (?, 'm1', 'נגן א', 'a@test', 'גיטרה', 1)").run(uuid());
  db.prepare("INSERT INTO band_members (id, member_key, name, email, role, active) VALUES (?, 'm2', 'נגן ב', 'b@test', 'תופים', 1)").run(uuid());
});

function addShow(fields: Record<string, unknown>) {
  const id = uuid();
  const row = { id, venue: 'מקום', date: '2099-01-01', ...fields };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO band_events (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(row));
  refreshPrivate(id);
  return id;
}

test('the public name drops «הופעה» off the front and nothing else', () => {
  assert.equal(board.publicTitle('הופעה קולדפליי זאפה תל אביב'), 'קולדפליי זאפה תל אביב');
  assert.equal(board.publicTitle('הופעה - קולדפליי זאפה'), 'קולדפליי זאפה');
  assert.equal(board.publicTitle("קרניבנד אלטון ג'ון בהיכל התרבות אייר פורט סיטי"), "קרניבנד אלטון ג'ון בהיכל התרבות אייר פורט סיטי");
  assert.equal(board.publicTitle('הופעתו של'), 'הופעתו של');
  assert.equal(board.publicTitle('הופעה'), 'הופעה');
});

test('a Google location splits into the place and its address', () => {
  const place = board.splitLocation('Zappa Tel Aviv, Raoul Wallenberg St 24, Tel Aviv-Yafo, Israel')!;
  assert.equal(place.name, 'Zappa Tel Aviv');
  assert.equal(place.address, 'Raoul Wallenberg St 24, Tel Aviv-Yafo');
  assert.match(place.waze_url, /^https:\/\/waze\.com\/ul\?q=/);
  assert.equal(board.splitLocation('  ')?.name, undefined);
  assert.equal(board.splitLocation('הרצל 5, חולון')!.name, 'הרצל 5, חולון');
});

test('arrival, sound check, stage and parking are read out of the description', () => {
  const parsed = board.parseLogistics(
    '<b>שכר: 5000</b><br>הגעה 17:30, בלאנס ב-18.15<br>עלייה לבמה 21:00<br>חניה: חניון הבימה, כניסה מדיזנגוף'
  );
  assert.deepEqual(parsed, {
    call_time: '17:30', soundcheck_time: '18:15', stage_time: '21:00', parking: 'חניון הבימה, כניסה מדיזנגוף',
  });
  assert.deepEqual(board.parseLogistics(null), { call_time: null, soundcheck_time: null, stage_time: null, parking: null });
  assert.equal(board.parseLogistics("סאונד צ'ק 19:00").soundcheck_time, '19:00');
});

test('venue reminders fire on the club name', () => {
  const reminders = [{ keywords: 'זאפה, Gray', text: 'מיקרופון אלחוטי' }];
  assert.deepEqual(board.remindersFor(reminders, 'קולדפליי זאפה הרצליה'), ['מיקרופון אלחוטי']);
  assert.deepEqual(board.remindersFor(reminders, 'x', 'Gray Club, Tel Aviv'), ['מיקרופון אלחוטי']);
  assert.deepEqual(board.remindersFor(reminders, 'בארבי'), []);
});

test('the public board hides private shows and needs its token', () => {
  const open = addShow({ venue: 'זאפה תל אביב', calendar_summary: 'הופעה קולדפליי זאפה תל אביב', calendar_event_id: 'e1', date: '2099-02-01', start_time: '21:00' });
  addShow({ venue: 'חתונה פרטית', date: '2099-02-02' });
  addShow({ venue: 'עבר', date: '2000-01-01' });
  assert.throws(() => board.publicBoard('nope'), /לא פעיל/);
  const token = board.setBoardEnabled('public', true);
  const view = board.publicBoard(token);
  assert.deepEqual(view.shows.map((s) => s.title), ['קולדפליי זאפה תל אביב']);
  assert.equal(view.shows[0].time, '21:00');

  board.updateBoardItem(`show:${open}`, { ticket_url: 'tickets.example.com/x', public_title: 'קולדפליי — זאפה' });
  assert.equal(board.publicBoard(token).shows[0].ticket_url, 'https://tickets.example.com/x');
  assert.equal(board.publicBoard(token).shows[0].title, 'קולדפליי — זאפה');
  assert.throws(() => board.updateBoardItem(`show:${open}`, { ticket_url: 'javascript:alert(1)' }), /קישור/);

  board.updateBoardItem(`show:${open}`, { hidden: true });
  assert.equal(board.publicBoard(token).shows.length, 0);
  board.setBoardEnabled('public', false);
  assert.throws(() => board.publicBoard(token));
});

test('the crew board has private shows, the lineup, the logistics and the reminder', () => {
  const id = addShow({
    venue: 'אירוע פרטי בזאפה', date: '2099-03-01', attendees: JSON.stringify(['a@test']),
    calendar_description: 'הגעה 18:00\nבלאנס 19:00\nחניה ברחוב',
  });
  const supplier = uuid();
  db.prepare("INSERT INTO band_suppliers (id, name, role) VALUES (?, 'הגברה בע\"מ', 'sound_company')").run(supplier);
  db.prepare("INSERT INTO band_event_assignments (id, event_id, role, supplier_id) VALUES (?, ?, 'sound_company', ?)").run(uuid(), id, supplier);
  board.updateBoardItem(`show:${id}`, { call_time: '17:45', notes: 'לבוש שחור' });

  const token = board.setBoardEnabled('crew', true);
  const show = board.crewBoard(token).shows.find((s) => s.date === '2099-03-01')!;
  assert.ok(show.is_private);
  assert.equal(show.call_time, '17:45');
  assert.equal(show.soundcheck_time, '19:00');
  assert.equal(show.parking, 'חניה ברחוב');
  assert.equal(show.sound_company, 'הגברה בע"מ');
  assert.deepEqual(show.members, [{ name: 'נגן א', role: 'גיטרה' }]);
  assert.deepEqual(show.reminders, ['להביא מיקרופון אלחוטי']);
  assert.equal(show.notes, 'לבוש שחור');
});

test('a show is filed under the region of its town', () => {
  assert.equal(board.regionFor('Zappa Tel Aviv, Raoul Wallenberg St 24, Tel Aviv-Yafo, Israel'), 'מרכז');
  assert.equal(board.regionFor('היכל התרבות, קריית אונו'), 'מרכז');
  assert.equal(board.regionFor('קריית ביאליק'), 'צפון');
  assert.equal(board.regionFor(null, 'זאפה הרצליה'), 'שרון');
  assert.equal(board.regionFor('Eilat'), 'אילת');
  assert.equal(board.regionFor('בארבי'), null);
  const id = addShow({ venue: 'בארבי', date: '2099-05-01', location: 'Haifa' });
  assert.equal(board.boardItems().find((i) => i.key === `show:${id}`)!.region, 'צפון');
  board.updateBoardItem(`show:${id}`, { region: 'דרום' });
  assert.equal(board.boardItems().find((i) => i.key === `show:${id}`)!.region, 'דרום');
});

test('a show is badged with its act: typed by hand first, then the calendar rules', () => {
  db.prepare("INSERT INTO calendar_rules (id, name, target, keywords) VALUES (?, 'Coldplay', 'personal', 'קולדפליי, הופעה')").run(uuid());
  const find = board.actFinder([{ name: 'Disco Train', keywords: 'דיסקו טריין' }]);
  assert.equal(find('הופעה קולדפליי זאפה'), 'קולדפליי');
  assert.equal(find('דיסקו טריין בגריי'), 'Disco Train');
  assert.equal(find('Disco Train Gray'), 'Disco Train');
  assert.equal(find('הופעה בבארבי'), null);
  board.updateBoardSettings({ acts: [{ name: 'Disco Train', keywords: 'דיסקו' }] });
  const id = addShow({ venue: 'גריי', calendar_summary: 'דיסקו גריי', date: '2099-06-01' });
  const item = () => board.boardItems().find((i) => i.key === `show:${id}`)!;
  assert.equal(item().act, 'Disco Train');
  board.updateBoardItem(`show:${id}`, { act: 'אחר' });
  assert.equal(item().act, 'אחר');
  assert.equal(item().auto_act, 'Disco Train');
});
