import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../js/samples.js';
import { SAMPLE_PLACES, storedPlaces } from '../js/sample-places.js';
import { distanceMeters } from '../js/geo.js';

// A sample tour starts without the map search (one request a second for the whole app): every
// city and stop must be stored, near its city. After changing a sample: npm run sample-places.
test('every sample tour’s city and stops are stored, so starting it asks the map search nothing', () => {
  for (const sample of SAMPLES) {
    const stored = storedPlaces(sample.city);
    assert.ok(stored, `${sample.city} is stored (npm run sample-places)`);
    assert.equal(stored.city.name, sample.city);
    for (const name of sample.stops) {
      const stop = stored.stop(name);
      assert.ok(stop, `${sample.label}: ${name} is stored (npm run sample-places)`);
      assert.equal(stop.name, name, 'spoken as the tour writes it');
      assert.ok(Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
      const km = distanceMeters(stored.city, stop) / 1000;
      assert.ok(km < 30, `${sample.label}: ${name} is ${km.toFixed(1)} km from the city centre`);
    }
  }
});

test('nothing stored for tours that are gone, and other cities still use the map search', () => {
  const cities = new Set(SAMPLES.map((s) => s.city));
  for (const city of Object.keys(SAMPLE_PLACES)) assert.ok(cities.has(city), `${city} is still a sample tour`);
  assert.equal(storedPlaces('Lyon'), null);
  assert.equal(storedPlaces('Barcelona').stop('Somewhere else'), null);
});
