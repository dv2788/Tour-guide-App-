// Street View in first person: the messages between the app and its Street View page are
// checked both ways, and photos are looked up as you move, not on every GPS tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseReport, needsLookup } from '../js/photoView.js';

test('commands from the app pass only when well-formed, with text as text and numbers as numbers', () => {
  assert.deepEqual(parseCommand({ type: 'move', lat: 41.39, lon: 2.16, heading: 30 }), { type: 'move', lat: 41.39, lon: 2.16, heading: 30 });
  assert.deepEqual(parseCommand({ type: 'move', lat: 41.39, lon: 2.16 }), { type: 'move', lat: 41.39, lon: 2.16, heading: null });
  assert.equal(parseCommand({ type: 'move', lat: '41', lon: 2.16 }), null, 'a string is not a position');
  assert.equal(parseCommand({ type: 'move', lat: 91, lon: 2.16 }), null, 'off the earth');
  assert.equal(parseCommand({ type: 'move', lat: NaN, lon: 2.16 }), null);
  const stops = parseCommand({ type: 'stops', stops: [{ lat: 1, lon: 2, name: 'Casa Batlló' }, { lat: 'x', lon: 2 }, { lat: 3, lon: 4, name: { evil: true } }] });
  assert.deepEqual(stops.stops, [
    { lat: 1, lon: 2, name: 'Casa Batlló' },
    { lat: 3, lon: 4, name: '' },
  ]);
  assert.equal(parseCommand({ type: 'stops', stops: Array.from({ length: 200 }, (_, i) => ({ lat: i / 10, lon: 1 })) }).stops.length, 60, 'at most 60 stops');
  const places = parseCommand({ type: 'places', places: [{ id: 9, lat: 1, lon: 2, title: 'Park' }, { id: { x: 1 }, lat: 1, lon: 2 }, { id: 'a'.repeat(100), lat: 1, lon: 2 }] });
  assert.deepEqual(places.places, [{ id: 9, lat: 1, lon: 2, title: 'Park' }]);
  assert.equal(parseCommand({ type: 'stops', stops: [{ lat: 1, lon: 2, name: 'x'.repeat(1000) }] }).stops[0].name.length, 300);
  assert.deepEqual(parseCommand({ type: 'highlight', id: 9 }), { type: 'highlight', id: 9 });
  assert.deepEqual(parseCommand({ type: 'highlight', id: null }), { type: 'highlight', id: null });
  assert.deepEqual(parseCommand({ type: 'highlight', id: { x: 1 } }), { type: 'highlight', id: null });
  assert.deepEqual(parseCommand({ type: 'reached', index: 2 }), { type: 'reached', index: 2 });
  assert.equal(parseCommand({ type: 'reached', index: -1 }), null);
  assert.equal(parseCommand({ type: 'reached', index: 1.5 }), null);
  assert.deepEqual(parseCommand({ type: 'config', signs: 2500 }), { type: 'config', signs: 2500 });
  assert.deepEqual(parseCommand({ type: 'config', signs: 1e9 }), { type: 'config', signs: 10000 });
  assert.equal(parseCommand({ type: 'eval', code: '1' }), null, 'unknown commands are dropped');
  assert.equal(parseCommand('move'), null);
  assert.equal(parseCommand(null), null);
});

test('reports from the Street View page: ready, whether there are photos here, or a failure', () => {
  assert.deepEqual(parseReport({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(parseReport({ type: 'coverage', here: true }), { type: 'coverage', here: true });
  assert.deepEqual(parseReport({ type: 'coverage', here: 'yes' }), { type: 'coverage', here: false }, 'only a real true counts');
  assert.deepEqual(parseReport({ type: 'failed', reason: 'key refused' }), { type: 'failed', reason: 'key refused' });
  assert.equal(parseReport({ type: 'failed', reason: 'x'.repeat(500) }).reason.length, 200);
  assert.equal(parseReport({ type: 'other' }), null);
  assert.equal(parseReport(undefined), null);
});

test('a new photo is looked up once you have moved on, not on every GPS tick', () => {
  const here = { lat: 41.3917, lon: 2.1649 };
  assert.ok(needsLookup(null, here, 5), 'the first time');
  assert.ok(!needsLookup(here, { lat: 41.39171, lon: 2.16491 }, 5), 'a metre of GPS jitter: no');
  assert.ok(needsLookup(here, { lat: 41.3918, lon: 2.1649 }, 5), 'eleven metres on: yes');
});
