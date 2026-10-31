import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHours, openDuring, formatClock } from '../js/openingHours.js';

// 2026-11-02 is a Monday.
const at = (day, h, m = 0) => new Date(2026, 10, 2 + day, h, m); // day 0 = Monday

test('common opening hours are understood', () => {
  const spec = 'Mo-Fr 08:00-19:00; Sa 09:00-14:00; Su off';
  assert.deepEqual(openDuring(spec, at(0, 10), 20), { open: true, closes: 19 * 60 });
  assert.equal(openDuring(spec, at(0, 18, 50), 20).open, false, 'closes during the break');
  assert.equal(openDuring(spec, at(5, 13), 30).open, true);
  assert.equal(openDuring(spec, at(6, 12), 30).open, false, 'closed on Sunday');
  assert.deepEqual(openDuring('24/7', at(3, 3), 60), { open: true, closes: null }, 'no closing time to show');
});

test('lunch and dinner services, overnight bars, later rules overriding earlier ones', () => {
  const restaurant = 'Mo-Su 12:00-14:30,19:00-23:00; Tu off';
  assert.equal(openDuring(restaurant, at(0, 12, 30), 60).open, true);
  assert.equal(openDuring(restaurant, at(0, 15, 30), 60).open, false, 'between services');
  assert.equal(openDuring(restaurant, at(1, 12, 30), 60).open, false, 'Tuesday off');
  const bar = 'Mo-Sa 18:00-02:00';
  assert.equal(openDuring(bar, at(2, 23, 30), 30).open, true);
  assert.equal(openDuring(bar, at(3, 1, 0), 30).open, true, 'still open after midnight');
  assert.equal(openDuring(bar, at(6, 1, 0), 30).open, true, "Saturday night's late opening reaches into Sunday");
  assert.equal(openDuring(bar, at(0, 1, 0), 30).open, false, 'Sunday night: closed');
  assert.equal(formatClock(openDuring(bar, at(2, 23), 30).closes), '02:00');
});

test('anything unusual is "unknown", never a wrong "closed"', () => {
  assert.deepEqual(openDuring('Mo-Fr 09:00-18:00; PH off', at(0, 10), 30), { open: true, closes: 18 * 60 });
  assert.equal(openDuring('sunrise-sunset', at(0, 10), 30).open, null);
  assert.equal(openDuring('Jan-Mar Mo-Fr 10:00-16:00', at(0, 10), 30).open, null);
  assert.equal(openDuring(undefined, at(0, 10), 30).open, null);
  assert.equal(parseOpeningHours('Mo-Fr 10:00+'), null);
});
