import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBestResult, createGeocoder, fetchRoute } from '../js/geocode.js';

test("pickBestResult prefers the bridge over the station named after it", () => {
  const results = [
    { category: 'railway', type: 'stop', name: "Pont de l'Alma" },
    { category: 'railway', type: 'station', name: "Pont de l'Alma" },
    { category: 'highway', type: 'primary', name: "Pont de l'Alma" },
  ];
  assert.equal(pickBestResult(results, "Pont de l'Alma").category, 'highway');
  assert.equal(pickBestResult(results, "Pont de l'Alma station").category, 'railway');
  assert.equal(pickBestResult([], 'x'), null);
});

test('findPlace keeps the name the traveller typed and searches inside the city', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () => [
        { name: 'Great Palace', lat: '48.866', lon: '2.312', category: 'tourism', type: 'museum', extratags: { wikidata: 'Q457318' } },
      ],
    };
  };
  const geocoder = createGeocoder({ fetchImpl, minIntervalMs: 0 });
  const city = { name: 'Paris', lat: 48.8589, lon: 2.32, bbox: [48.8156, 48.9022, 2.2241, 2.4698] };
  const place = await geocoder.findPlace('Grand Palais', city);
  assert.equal(place.name, 'Grand Palais');
  assert.equal(place.osmName, 'Great Palace');
  assert.equal(place.wikidata, 'Q457318');
  assert.match(urls[0], /bounded=1/);
  assert.match(urls[0], /viewbox=/);
});

test('fetchRoute falls back to straight lines when routing is unavailable', async () => {
  const stops = [
    { lat: 48.8583, lon: 2.2945 },
    { lat: 48.8606, lon: 2.3376 },
  ];
  const route = await fetchRoute(stops, 'foot', async () => {
    throw new Error('offline');
  });
  assert.equal(route.routed, false);
  assert.deepEqual(route.points, stops);
});

test('finding the city you are in sends your position to ~1 km, not to the metre', async () => {
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), { ok: true, json: async () => ({ name: 'Paris', address: { city: 'Paris' }, lat: '48.85', lon: '2.29' }) });
  const geocoder = createGeocoder({ fetchImpl, minIntervalMs: 0 });
  await geocoder.reverse({ lat: 48.858370123, lon: 2.294481987 }, 10);
  assert.match(urls[0], /lat=48\.86&lon=2\.29&/);
  await geocoder.reverse({ lat: 48.858370123, lon: 2.294481987 }, 18);
  assert.match(urls[1], /lat=48\.85837&lon=2\.29448&/, 'an address needs more');
});
