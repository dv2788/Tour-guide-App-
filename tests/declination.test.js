import test from 'node:test';
import assert from 'node:assert/strict';
import { declination, decimalYear, trueHeading } from '../js/declination.js';

// NOAA's official test values for WMM2025 (WMM2025_TEST_VALUES.txt): year, height (km), lat, lon, declination.
const NOAA = [
  [2025.0, 0, 80, 0, 1.28], [2025.0, 0, 0, 120, -0.16], [2025.0, 0, -80, 240, 68.78],
  [2025.0, 100, 80, 0, 0.85], [2025.0, 100, 0, 120, -0.15], [2025.0, 100, -80, 240, 68.21],
  [2027.5, 0, 80, 0, 2.59], [2027.5, 0, 0, 120, -0.24], [2027.5, 0, -80, 240, 68.49],
  [2027.5, 100, 80, 0, 2.16], [2027.5, 100, 0, 120, -0.23], [2027.5, 100, -80, 240, 67.93],
];

test('magnetic declination matches the World Magnetic Model 2025 test values', () => {
  for (const [year, h, lat, lon, want] of NOAA) {
    const got = declination(lat, lon, year, h);
    assert.ok(Math.abs(got - want) < 0.01, `${lat},${lon} in ${year} at ${h} km: ${got.toFixed(3)} (NOAA: ${want})`);
  }
});

test('where it matters: a compass is ~27° off in Cape Town, ~23° in Rio, ~2° in Paris', () => {
  const at = (lat, lon) => declination(lat, lon, 2026.8);
  assert.ok(at(-33.925, 18.424) < -25 && at(-33.925, 18.424) > -29, 'Cape Town, to the west');
  assert.ok(at(-22.906, -43.173) < -21 && at(-22.906, -43.173) > -25, 'Rio de Janeiro');
  assert.ok(at(-33.87, 151.21) > 11 && at(-33.87, 151.21) < 15, 'Sydney, to the east');
  assert.ok(Math.abs(at(48.857, 2.352)) < 4, 'Paris');
});

test('a magnetic heading is turned into a true one, the short way round', () => {
  assert.equal(trueHeading(350, 20), 10);
  assert.equal(trueHeading(10, -27), 343);
  assert.equal(trueHeading(null, 5), null);
  assert.equal(trueHeading(90, undefined), 90);
  assert.ok(Math.abs(decimalYear(new Date(Date.UTC(2026, 6, 2, 12))) - 2026.5) < 0.01);
});
