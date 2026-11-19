import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts opens its file on import, so the directory is set before any module is loaded.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'works-test-'));
const { db } = await import('./db.js');
const { listWorks, listClients, workToday, chargeableWorkSql } = await import('./queries.js');

const shift = (days: number) => {
  const d = new Date(`${workToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

before(() => {
  db.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Client')").run();
  const add = db.prepare(
    `INSERT INTO works (id, client_id, date, description, amount, vat_amount, total, status)
     VALUES (?, 'c1', ?, ?, 100, 18, 118, ?)`
  );
  add.run('past', shift(-3), 'past gig', 'unpaid');
  add.run('today', shift(0), 'tonight', 'unpaid');
  add.run('future', shift(10), 'next month', 'unpaid');
  add.run('billed', shift(-20), 'billed elsewhere', 'invoiced');
});

test('a future job is upcoming, not waiting to be billed', () => {
  const byId = Object.fromEntries((listWorks() as any[]).map((w) => [w.id, w]));
  assert.equal(byId.future.upcoming, 1);
  assert.equal(byId.past.upcoming, 0);
  assert.equal(byId.today.upcoming, 0);

  assert.deepEqual((listWorks({ status: 'unpaid' }) as any[]).map((w) => w.id).sort(), ['past', 'today']);
  assert.deepEqual((listWorks({ status: 'upcoming' }) as any[]).map((w) => w.id), ['future']);
});

test('the to-bill figures count only jobs whose date has arrived', () => {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM works WHERE ${chargeableWorkSql()}`).get(workToday()) as any;
  assert.equal(row.n, 2);
  const client = (listClients() as any[])[0];
  assert.equal(client.unpaid_count, 2);
  assert.equal(client.unpaid_total, 236);
  assert.equal(client.upcoming_count, 1);
});
