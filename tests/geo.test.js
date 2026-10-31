import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, bearingDegrees, angleDiff, relativeDirection, buildPath, pointAlongPath } from '../js/geo.js';

const eiffel = { lat: 48.8584, lon: 2.2945 };
const louvre = { lat: 48.8606, lon: 2.3376 };

test('distanceMeters: Eiffel Tower to the Louvre is about 3.2 km', () => {
  const d = distanceMeters(eiffel, louvre);
  assert.ok(d > 3100 && d < 3300, `got ${d}`);
  assert.equal(distanceMeters(eiffel, eiffel), 0);
});

test('bearingDegrees: cardinal directions', () => {
  const o = { lat: 0, lon: 0 };
  assert.ok(Math.abs(bearingDegrees(o, { lat: 1, lon: 0 }) - 0) < 1e-9);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 0, lon: 1 }) - 90) < 1e-9);
  assert.ok(Math.abs(bearingDegrees(o, { lat: -1, lon: 0 }) - 180) < 1e-9);
  assert.ok(Math.abs(bearingDegrees(o, { lat: 0, lon: -1 }) - 270) < 1e-9);
});

test('angleDiff wraps around north', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), -20);
  assert.equal(angleDiff(90, 270), -180);
});

test('relativeDirection: left / right / ahead / behind', () => {
  assert.equal(relativeDirection(0, 5), 'ahead');
  assert.equal(relativeDirection(0, 90), 'right');
  assert.equal(relativeDirection(0, 270), 'left');
  assert.equal(relativeDirection(0, 180), 'behind');
  assert.equal(relativeDirection(350, 80), 'right'); // across north
  assert.equal(relativeDirection(null, 80), 'nearby');
});

test('pointAlongPath interpolates and clamps', () => {
  const path = buildPath([
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.01 },
    { lat: 0.01, lon: 0.01 },
  ]);
  const seg = distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 });
  const mid = pointAlongPath(path, seg / 2);
  assert.ok(Math.abs(mid.lon - 0.005) < 1e-6);
  assert.ok(Math.abs(mid.heading - 90) < 1e-6);
  const turn = pointAlongPath(path, seg + 10);
  assert.ok(Math.abs(turn.heading - 0) < 1e-6, 'heading north on second segment');
  assert.deepEqual(pointAlongPath(path, -5), { lat: 0, lon: 0, heading: 90 });
  const end = pointAlongPath(path, 1e9);
  assert.ok(Math.abs(end.lat - 0.01) < 1e-9 && Math.abs(end.lon - 0.01) < 1e-9);
});

test('distanceToSegmentMeters: closest approach along a path', async () => {
  const { distanceToSegmentMeters } = await import('../js/geo.js');
  const a = { lat: 48.86, lon: 2.3 };
  const b = { lat: 48.86, lon: 2.31 }; // ~730 m east
  const beside = { lat: 48.8605, lon: 2.305 }; // ~55 m north of the middle
  const d = distanceToSegmentMeters(beside, a, b);
  assert.ok(d > 50 && d < 60, `got ${d}`);
  const pastEnd = { lat: 48.86, lon: 2.312 };
  assert.ok(Math.abs(distanceToSegmentMeters(pastEnd, a, b) - distanceMeters(pastEnd, b)) < 1);
});
