import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSaved } from '../js/saved.js';

const CHOICES = { lang: ['en', 'fr'], mode: ['walk', 'bike', 'drive'], source: ['gps', 'sim'], rate: ['0.9', '1', '1.15'], simSpeed: ['1', '4', '8', '16'] };

// What the app saves after "Suggest a route" (shape as written by app.js).
const GOOD = {
  city: 'Barcelona',
  area: 'El Born',
  range: '4',
  rangeAuto: true,
  stops: 'Casa Batlló\nCafé Zurich',
  mode: 'walk',
  lang: 'fr',
  rate: '1',
  source: 'gps',
  simSpeed: '8',
  voice: 'neural:fr_FR-siwis-medium:0',
  imported: [
    ['Casa Batlló', { query: 'Casa Batlló', lat: 41.3916, lon: 2.1649, kind: 'sight', visitMinutes: null, meal: null, breakMinutes: null, wikipedia: 'en:Casa Batlló', wikidata: 'Q461371' }],
    ['Typed only', { query: 'Typed only', kind: null, visitMinutes: null, meal: null, breakMinutes: null, wikipedia: null, wikidata: null }],
  ],
  start: { lat: 41.387, lon: 2.1701, name: 'Barcelona' },
  areaPoint: { lat: 41.3851, lon: 2.1823, name: 'El Born', label: 'El Born, Barcelona', query: 'El Born', city: 'Barcelona' },
  plan: {
    start: { lat: 41.387, lon: 2.1701, name: 'Barcelona' },
    loop: true,
    minutes: 180,
    meters: 4200,
    startedAt: '2026-11-02T10:00:00.000Z',
    items: [
      { name: 'Casa Batlló', kind: 'sight', meal: null, visitMinutes: null, breakMinutes: null, description: 'Building by Gaudí', arrive: 12, lat: 41.3916, lon: 2.1649 },
      {
        name: 'Café Zurich', kind: 'food', meal: 'coffee', visitMinutes: null, breakMinutes: 20, description: '', arrive: 40, lat: 41.386, lon: 2.17,
        open: true, closes: 1260, optionIndex: 1,
        options: [
          { name: 'Café Zurich', lat: 41.386, lon: 2.17, amenity: 'cafe', open: true, closes: 1260, wikipedia: null, wikidata: null },
          { name: 'Granja Viader', lat: 41.382, lon: 2.171, amenity: 'cafe', open: null, closes: null, wikipedia: null, wikidata: 'Q1' },
        ],
      },
    ],
  },
};

test('a save written by the app comes back unchanged', () => {
  assert.deepEqual(cleanSaved(structuredClone(GOOD), CHOICES), GOOD);
});

test('wrong types and unknown choices are dropped, never passed on', () => {
  const out = cleanSaved({ city: 5, stops: ['x'], lang: '<img src=x>', mode: 'teleport', source: 'gps', rate: 2, voice: '<script>', range: '99999', rangeAuto: 'yes' }, CHOICES);
  assert.deepEqual(out, { source: 'gps', imported: [], start: null, areaPoint: null, plan: null });
});

test('places without real coordinates are dropped (they would crash the map and links)', () => {
  const out = cleanSaved({
    start: { lat: 'x', lon: 2 },
    areaPoint: { lat: 91, lon: 0, name: 'Nowhere' },
    imported: 'nope',
    plan: { items: [{ name: 5, lat: 'x', lon: null, arrive: 'y' }], startedAt: 'z', minutes: 1, meters: 1 },
  }, CHOICES);
  assert.equal(out.start, null);
  assert.equal(out.areaPoint, null);
  assert.deepEqual(out.imported, []);
  assert.equal(out.plan, null);
  // One bad stop spoils the whole plan (its times are computed together): start afresh.
  const plan = structuredClone(GOOD.plan);
  plan.items[1].lat = 'north';
  assert.equal(cleanSaved({ plan }, CHOICES).plan, null);
  // A bad alternative café is dropped, the rest kept.
  const plan2 = structuredClone(GOOD.plan);
  plan2.items[1].options.push({ name: { evil: true }, lat: 1, lon: 1 }, null, 'x');
  plan2.items[1].optionIndex = 7;
  const food = cleanSaved({ plan: plan2 }, CHOICES).plan.items[1];
  assert.equal(food.options.length, 2);
  assert.equal(food.optionIndex, 0, 'an impossible choice falls back to the first');
  // Imported entries: bad ones skipped, good ones kept.
  const imported = cleanSaved({ imported: [[1, {}], ['A', { lat: 'x', lon: 1 }], ['B', null], ['C', { lat: 1, lon: 2, query: 7 }]] }, CHOICES).imported;
  assert.deepEqual(imported.map(([k, v]) => [k, v.lat, v.query]), [['C', 1, null]]);
});

test('text is kept as text (it is shown with textContent), only trimmed to a sane length', () => {
  const html = '"><img src=x onerror=alert(1)>';
  const out = cleanSaved({ city: html, start: { lat: 1, lon: 2, name: html, extra: html } }, CHOICES);
  assert.equal(out.city, html);
  assert.deepEqual(out.start, { lat: 1, lon: 2, name: html }, 'unknown fields are not carried over');
  assert.equal(cleanSaved({ city: 'x'.repeat(10000) }, CHOICES).city.length, 300);
  assert.equal(cleanSaved(null, CHOICES), null);
  assert.equal(cleanSaved([1, 2], CHOICES), null);
  assert.equal(cleanSaved('{"city":"x"}', CHOICES), null);
});
