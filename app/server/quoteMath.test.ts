import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals } from './quoteMath.js';

const show = { name: 'הופעה', quantity: 1, unit_price: 10000 };

test('VAT is added on top of prices quoted before VAT', () => {
  const t = computeTotals([show], 0, 18, false);
  assert.equal(t.subtotal, 10000);
  assert.equal(t.net_amount, 10000);
  assert.equal(t.vat_amount, 1800);
  assert.equal(t.total, 11800);
});

test('VAT is taken back out of prices that already include it', () => {
  const t = computeTotals([{ ...show, unit_price: 11800 }], 0, 18, true);
  assert.equal(t.total, 11800);
  assert.equal(t.net_amount, 10000);
  assert.equal(t.vat_amount, 1800);
});

test('the discount comes off before VAT, in the terms the lines are priced in', () => {
  const excl = computeTotals([show], 1000, 18, false);
  assert.equal(excl.net_amount, 9000);
  assert.equal(excl.total, 10620);

  const incl = computeTotals([{ ...show, unit_price: 11800 }], 1180, 18, true);
  assert.equal(incl.total, 10620);
  assert.equal(incl.net_amount, 9000);
});

test('a discount larger than the lines stops at zero', () => {
  const t = computeTotals([show], 25000, 18, false);
  assert.equal(t.discount, 10000);
  assert.equal(t.total, 0);
});

test('lines multiply out and round to agorot', () => {
  const t = computeTotals([
    { name: 'שעה נוספת', quantity: 1.5, unit_price: 333.333 },
    { name: 'הגברה', quantity: 2, unit_price: 1250 },
  ], 0, 18, false);
  assert.deepEqual(t.lines.map((l) => l.total), [500, 2500]);
  assert.equal(t.subtotal, 3000);
  assert.equal(t.vat_amount, 540);
});

test('an unreadable or negative figure counts as nothing rather than as a credit', () => {
  const t = computeTotals([
    { name: 'א', quantity: Number.NaN, unit_price: 100 },
    { name: 'ב', quantity: 1, unit_price: -500 },
  ], -50, 18, false);
  assert.equal(t.subtotal, 0);
  assert.equal(t.discount, 0);
  assert.equal(t.total, 0);
});

test('0% VAT stays 0%', () => {
  const t = computeTotals([show], 0, 0, false);
  assert.equal(t.vat_amount, 0);
  assert.equal(t.total, 10000);
});
