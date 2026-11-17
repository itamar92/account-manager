import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'show-privacy-test-'));
const { db, uuid } = await import('./db.js');
const q = await import('./quotes.js');
const shows = await import('./quoteShow.js');
const privacy = await import('./showPrivacy.js');
const { missingRoles } = await import('./assignments.js');

const USER = 'privacy-user';

before(() => {
  db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, 'privacy@test', 'בדיקה', 'x', 'band')").run(USER);
});

function addShow(date: string, venue: string, calendarPrivate = 0) {
  const id = uuid();
  db.prepare('INSERT INTO band_events (id, venue, date, calendar_private) VALUES (?, ?, ?, ?)').run(id, venue, date, calendarPrivate);
  privacy.refreshPrivate(id);
  return id;
}

const isPrivate = (id: string) => !!(db.prepare('SELECT is_private FROM band_events WHERE id = ?').get(id) as any).is_private;

test('«פרטי» in its forms reads as private; «פרטים» (details) does not', () => {
  for (const text of ['אירוע פרטי', 'הופעה פרטית בקיסריה', 'אירועים פרטיים', 'חתונה (פרטי)', 'Private party']) {
    assert.ok(privacy.looksPrivate(text), text);
  }
  for (const text of ['פרטים נוספים בטלפון', 'הופעה בבארבי', 'ספרטיקוס', '', null]) {
    assert.ok(!privacy.looksPrivate(text), String(text));
  }
});

test('a show is private when the calendar or its name says so', () => {
  assert.ok(isPrivate(addShow('2031-03-01', 'הופעה פרטית - חתונה')));
  assert.ok(isPrivate(addShow('2031-03-02', 'חתונה', 1)));
  assert.ok(!isPrivate(addShow('2031-03-03', 'הופעה בזאפה')));
});

test('linking a quote to an existing show makes it private, and unlinking hands it back', () => {
  const showId = addShow('2031-04-10', 'אולם האירועים');
  assert.ok(!isPrivate(showId));
  const quoteId = q.createBlankQuote({ client_name: 'נועה', event_date: '2031-04-12' }, USER);
  // A different date than the show's: the picker offers every show, not only the same day.
  assert.ok(shows.showsForPicker(quoteId, '2031-04-12').some((s) => s.id === showId));
  shows.linkQuoteToShow(quoteId, showId);
  assert.ok(isPrivate(showId));
  shows.linkQuoteToShow(quoteId, null);
  assert.ok(!isPrivate(showId));
});

test('a decision by hand outranks the detection', () => {
  const showId = addShow('2031-05-01', 'הופעה פרטית');
  privacy.setPrivate(showId, false);
  privacy.refreshPrivate(showId);
  assert.ok(!isPrivate(showId));
  privacy.setPrivate(showId, null);
  assert.ok(isPrivate(showId));
});

test('a private show is not asked for אקו"ם', () => {
  db.prepare("UPDATE band_supplier_roles SET required = 1, active = 1 WHERE key = 'akom'").run();
  const pub = addShow('2031-06-01', 'מועדון');
  const priv = addShow('2031-06-02', 'אירוע פרטי');
  assert.ok(missingRoles(pub).includes('akom'));
  assert.ok(!missingRoles(priv).includes('akom'));
});
