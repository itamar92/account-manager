import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts opens its file on import, so the directory is set before any module is loaded.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-sync-test-'));
const { missDropsRow } = await import('./calendarSync.js');
const { evaluate } = await import('./calendarRules.js');

const rule = (id: string, target: 'band' | 'personal', keywords: string, organizers = '') => ({
  id, name: id, target, calendar_id: 'primary', keywords, organizers, ignore_words: '',
  client_name: target === 'personal' ? 'Client' : null, fixed_amount: 0, skip_declined: 1,
  match_description: 0, enabled: 1, sort_order: 0,
});

const shows = rule('shows', 'personal', 'קרניבנד', 'udi@karni-band.com');
const rehearsals = rule('rehearsals', 'personal', 'חזרת', 'udi@karni-band.com');
const band = rule('band', 'band', 'קולדפליי');
const targets = new Map([shows, rehearsals, band].map((r) => [r.id, r.target]));
const targetOf = (id: string) => targets.get(id);

const event = {
  id: 'ev1', status: 'confirmed', summary: 'קרניבנד ברברה בהיכל התרבות נתניה',
  organizer: { email: 'udi@karni-band.com' }, start: { dateTime: '2027-02-20T20:30:00+02:00' },
} as any;
const include = (ruleId: string) => ({
  event_id: 'ev1', action: 'include' as const, rule_id: ruleId, summary: null, event_date: null, note: null, created_at: '',
});
const exclude = { ...include('shows'), action: 'exclude' as const, rule_id: null };

test('a show pinned to one rule is not deleted by another rule over the same calendar', () => {
  const overrides = new Map([['ev1', include('shows')]]);
  // The rehearsal rule shares the organizer, so without the pin it would have drawn this show too.
  const verdict = evaluate(rehearsals as any, event, overrides);
  assert.equal(verdict.matched, false);
  assert.equal(verdict.reason, 'manual');
  assert.equal(missDropsRow(rehearsals as any, overrides.get('ev1'), targetOf), false);
});

test('an event excluded by hand loses its row', () => {
  assert.equal(missDropsRow(shows as any, exclude, targetOf), true);
});

test('pinned to a rule of the other kind, the stale row of this kind goes', () => {
  // Moved from the band's shows to a personal rule: the band_events row is no longer wanted.
  assert.equal(missDropsRow(band as any, include('shows'), targetOf), true);
});

test('pinned to a rule that no longer exists, nothing is deleted', () => {
  assert.equal(missDropsRow(rehearsals as any, include('gone'), targetOf), false);
});

test('no override, no deletion', () => {
  assert.equal(missDropsRow(rehearsals as any, undefined, targetOf), false);
});
