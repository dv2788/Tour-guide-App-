import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedSource } from '../js/location.js';
import { distanceMeters, distanceToSegmentMeters } from '../js/geo.js';

const P = (x, y) => ({ lat: 48.85 + y / 111320, lon: 2.35 + x / (111320 * Math.cos((48.85 * Math.PI) / 180)) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the simulated traveller follows the directions once there are some', async () => {
  const seen = [];
  let ended = false;
  // Planned line: due east. Directions: north first, then east (a parallel street).
  const source = new SimulatedSource({ points: [P(0, 0), P(400, 0)], speedMps: 10, intervalMs: 2, onPosition: (p) => seen.push(p), onEnd: () => (ended = true), patience: 3 });
  source.start();
  await sleep(10);
  const here = seen.at(-1);
  const turnAt = P(distanceMeters(P(0, 0), here), 40);
  source.follow([here, turnAt, P(400, 40)]);
  const from = seen.length;
  while (!ended) await sleep(5);
  const after = seen.slice(from);
  assert.ok(after.length > 5);
  for (const p of after) {
    const onDirections = Math.min(distanceToSegmentMeters(p, here, turnAt), distanceToSegmentMeters(p, turnAt, P(400, 40)));
    assert.ok(onDirections < 1, `walks the directions (${onDirections.toFixed(1)} m off)`);
  }
  assert.ok(distanceMeters(after.at(-1), P(400, 40)) < 1, 'ends where the directions end');
});
