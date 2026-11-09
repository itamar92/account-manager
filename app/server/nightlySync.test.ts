import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-sync-test-'));
const nightly = await import('./nightlySync.js');
const { setSetting } = await import('./db.js');

/** An Israel-time hour on a November date (UTC+2). */
const at = (date: string, hour: number) => new Date(`${date}T${String(hour - 2).padStart(2, '0')}:20:00Z`);

function fakeJobs(log: string[], failing: string[] = []) {
  return (['morning', 'calendar', 'meta'] as const).map((service) => ({
    service,
    configured: () => service !== 'meta',
    run: async () => {
      log.push(service);
      if (failing.includes(service)) throw new Error(`${service} 401`);
      return `${service} ok`;
    },
  }));
}

test('runs once a night inside the window, only the connected services, and records the result', async () => {
  const log: string[] = [];
  assert.equal(await nightly.runNightlySync(at('2026-11-10', 2), fakeJobs(log)), null, 'before 03:00');
  assert.equal(await nightly.runNightlySync(at('2026-11-10', 8), fakeJobs(log)), null, 'after the window');

  const run = await nightly.runNightlySync(at('2026-11-10', 3), fakeJobs(log, ['calendar']));
  assert.deepEqual(log, ['morning', 'calendar'], 'meta is not connected, so it is skipped');
  assert.deepEqual(run!.services.map((s) => [s.service, s.ok]), [['morning', true], ['calendar', false]]);
  assert.match(run!.services[1].summary, /calendar 401/, 'one failure does not stop the rest, and is kept');
  assert.equal(nightly.lastNightlyRun()!.date, '2026-11-10');

  assert.equal(await nightly.runNightlySync(at('2026-11-10', 5), fakeJobs(log)), null, 'not twice in one night');
  assert.equal(log.length, 2);

  // A server that was down at 03:00 catches up before 07:00 the next night.
  const next = await nightly.runNightlySync(at('2026-11-11', 6), fakeJobs(log));
  assert.equal(next!.date, '2026-11-11');
});

test('switched off, it does nothing', async () => {
  nightly.setNightlyEnabled(false);
  try {
    const log: string[] = [];
    setSetting('nightly_sync_on', '');
    assert.equal(await nightly.runNightlySync(at('2026-11-12', 3), fakeJobs(log)), null);
    assert.equal(log.length, 0);
  } finally {
    nightly.setNightlyEnabled(true);
  }
  assert.equal(nightly.isNightlyEnabled(), true);
});
