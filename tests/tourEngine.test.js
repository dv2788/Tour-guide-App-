import test from 'node:test';
import assert from 'node:assert/strict';
import { TourEngine, pickNextPoi, arrivalRadiusFor } from '../js/tourEngine.js';
import { getMode } from '../js/modes.js';
import { FakeNarrator, fakeWiki, flush } from './helpers.js';

const LAT = 48.86;
const LON = 2.3;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
const east = (meters) => LON + meters / M_PER_DEG_LON;
const north = (meters) => LAT + meters / 111320;

const museum = { id: 1, title: 'Left Museum', lat: north(45), lon: east(150), thumbnail: 'm.jpg', category: null };
const church = { id: 2, title: 'Right Church', lat: north(-45), lon: east(300), thumbnail: null, category: null };
const metro = { id: 3, title: 'Some Station', lat: LAT, lon: east(220), thumbnail: null, category: 'skip' };
const summaries = {
  'Left Museum': { pageid: 1, title: 'Left Museum', extract: 'A museum. It has art. It is old. It is big. It is loved.', thumbnail: 'm.jpg' },
  'Right Church': { pageid: 2, title: 'Right Church', extract: 'A church (built 1200). It has bells.' },
};

function makeEngine({ mode = 'walk', stops, pois = [museum, church, metro] } = {}) {
  let clock = 1_000_000;
  const narrator = new FakeNarrator();
  const wiki = fakeWiki({
    pois,
    summaries,
    articles: {
      Testville: { pageid: 99, title: 'Testville', extract: 'Testville is a city. It is nice. It has a river.' },
      'Final Square': { pageid: 50, title: 'Final Square', extract: 'A grand square. Kings were crowned here.' },
    },
  });
  const engine = new TourEngine({
    mode: getMode(mode),
    lang: 'en',
    wiki,
    narrator,
    city: { name: 'Testville', lat: LAT, lon: LON },
    stops: stops ?? [{ name: 'Final Square', lat: LAT, lon: east(600) }],
    now: () => clock,
  });
  return { engine, narrator, wiki, advance: (ms) => (clock += ms) };
}

test('a walk past two places to the final stop', async (t) => {
  const { engine, narrator, advance } = makeEngine();
  t.after(() => engine.stop());
  await engine.start();
  for (let x = 0; x <= 600; x += 20) {
    engine.update({ lat: LAT, lon: east(x) });
    await flush();
    await flush();
    advance(15000);
    narrator.finishAll();
    await flush();
    await flush();
  }

  const said = narrator.spoken.map((s) => s.text);
  assert.equal(said.length, 5, said.join('\n'));
  assert.match(said[0], /^Welcome to Testville\. Testville is a city\. It is nice\.$/);
  assert.match(said[1], /^Your first stop is Final Square, 600 meters away\.$/);
  assert.match(said[2], /^On your left: Left Museum\. A museum\. It has art\. It is old\. It is big\.$/);
  assert.match(said[3], /^On your right: Right Church\. A church\. It has bells\.$/);
  assert.match(said[4], /^You have arrived at Final Square\. A grand square\. Kings were crowned here\. That was your last stop/);
  assert.ok(!said.some((s) => s.includes('Some Station')), 'metro stations are skipped');
  assert.deepEqual(
    narrator.spoken.map((s) => s.meta.kind),
    ['city', 'info', 'poi', 'poi', 'stop'],
  );
});

test('arriving at a stop cuts off a story about a passing place', async (t) => {
  const stop = { name: 'Final Square', lat: LAT, lon: east(200) };
  const nearby = { ...museum, lat: north(10), lon: east(5) };
  const { engine, narrator, advance } = makeEngine({ stops: [stop], pois: [nearby] });
  t.after(() => engine.stop());
  await engine.start();
  narrator.finishAll(); // welcome done
  engine.update({ lat: LAT, lon: LON }); // -> first stop announcement
  await flush();
  narrator.finishAll();
  advance(10000); // the quiet gap between stories has passed
  engine.tick(); // -> story about the museum starts
  await flush();
  await flush();
  assert.equal(narrator.current?.meta.kind, 'poi');

  engine.update({ lat: LAT, lon: east(195) });
  await flush();
  await flush();
  const arrival = narrator.spoken.at(-1);
  assert.equal(arrival.meta.kind, 'stop');
  assert.deepEqual(arrival.options, { priority: true, interrupt: true });
});

test('stops reached out of order are still announced, with the next one after', async (t) => {
  const stops = [
    { name: 'A', lat: LAT, lon: east(1000) },
    { name: 'B', lat: LAT, lon: east(50) },
    { name: 'C', lat: LAT, lon: east(1250) },
  ];
  const { engine, narrator } = makeEngine({ stops, pois: [] });
  t.after(() => engine.stop());
  await engine.start();
  engine.update({ lat: LAT, lon: east(50) });
  await flush();
  await flush();
  const last = narrator.spoken.at(-1).text;
  assert.match(last, /^You have arrived at B\. Next stop: C, 1\.2 kilometers away\.$/);
  assert.equal(engine.nextStopIndex, 2);
});

test('driving: ignore places behind you, announce distance ahead', () => {
  const mode = getMode('drive');
  const position = { lat: LAT, lon: LON };
  const behind = { id: 1, title: 'Behind', lat: LAT, lon: east(-50), category: null };
  const ahead = { id: 2, title: 'Ahead', lat: north(60), lon: east(300), category: null };
  const pick = pickNextPoi({ pois: [behind, ahead], position, heading: 90, narrated: new Set(), mode });
  assert.equal(pick.poi.title, 'Ahead');
  assert.equal(pick.direction, 'ahead');
});

test('pickNextPoi prefers notable places and never repeats', () => {
  const mode = getMode('walk');
  const position = { lat: LAT, lon: LON };
  const street = { id: 1, title: 'Rue X', lat: north(10), lon: LON, category: 'minor' };
  const palace = { id: 2, title: 'Palace', lat: north(50), lon: LON, thumbnail: 'p.jpg', category: null };
  const narrated = new Set();
  assert.equal(pickNextPoi({ pois: [street, palace], position, heading: 0, narrated, mode }).poi.title, 'Palace');
  narrated.add(2);
  assert.equal(pickNextPoi({ pois: [street, palace], position, heading: 0, narrated, mode }), null, 'streets wait');
  assert.equal(
    pickNextPoi({ pois: [street, palace], position, heading: 0, narrated, mode, allowMinor: true }).poi.title,
    'Rue X',
    'after a long silence, a street is better than nothing',
  );
  narrated.add(1);
  assert.equal(pickNextPoi({ pois: [street, palace], position, heading: 0, narrated, mode, allowMinor: true }), null);
});

test('drive mode says how far ahead things are', async (t) => {
  const ahead = { id: 7, title: 'Big Tower', lat: north(80), lon: east(320), thumbnail: null, category: null };
  const { engine, narrator, advance } = makeEngine({ mode: 'drive', stops: [], pois: [ahead] });
  summaries['Big Tower'] = { pageid: 7, title: 'Big Tower', extract: 'A tall tower. Very tall. Really.' };
  t.after(() => engine.stop());
  await engine.start();
  narrator.finishAll();
  advance(10000);
  engine.update({ lat: LAT, lon: east(0) });
  engine.update({ lat: LAT, lon: east(30) }); // establishes heading east
  await flush();
  await flush();
  await flush();
  const story = narrator.spoken.find((s) => s.meta.kind === 'poi');
  assert.ok(story, narrator.spoken.map((s) => s.text).join('\n'));
  assert.match(story.text, /^Ahead of you, in 300 meters: Big Tower\. A tall tower\. Very tall\.$/);
});

test('a stop passed between two far-apart GPS fixes still counts as reached', async (t) => {
  const stops = [
    { name: 'Middle', lat: LAT, lon: east(500) },
    { name: 'End', lat: LAT, lon: east(900) },
  ];
  const { engine, narrator } = makeEngine({ stops, pois: [] });
  t.after(() => engine.stop());
  await engine.start();
  engine.update({ lat: LAT, lon: east(0) });
  engine.update({ lat: LAT, lon: east(1000) }); // jumped past both stops in one fix
  await flush();
  await flush();
  const arrivals = narrator.spoken.filter((s) => s.meta.kind === 'stop').map((s) => s.meta.title);
  assert.deepEqual(arrivals, ['Middle', 'End'], 'both announced, in order');
});

test('arriving before the welcome is ready still announces the stop, after the welcome', async (t) => {
  const stops = [{ name: 'Final Square', lat: LAT, lon: LON }];
  const { engine, narrator } = makeEngine({ stops, pois: [] });
  t.after(() => engine.stop());
  const started = engine.start();
  engine.update({ lat: LAT, lon: LON }); // first fix lands right on the first stop
  await started;
  await flush();
  await flush();
  assert.deepEqual(
    narrator.spoken.map((s) => s.meta.kind),
    ['city', 'stop'],
  );
});

test('big places count as reached from their edge, not their centre point', () => {
  const walk = getMode('walk');
  const louvre = { isArea: true, bbox: [48.8594, 48.8629, 2.3317, 2.34] }; // ~390 m x 610 m
  const kiosk = { isArea: true, bbox: [48.86, 48.8601, 2.33, 2.3301] };
  const mapPoint = { isArea: false, bbox: [48.855, 48.865, 2.29, 2.31] }; // made-up box around a point
  assert.equal(arrivalRadiusFor(louvre, walk), walk.arrivalRadius + 200, 'capped');
  assert.equal(arrivalRadiusFor(kiosk, walk), walk.arrivalRadius, 'never smaller than the default');
  assert.equal(arrivalRadiusFor(mapPoint, walk), walk.arrivalRadius);
  const eiffel = { isArea: true, bbox: [48.8574753, 48.8590453, 2.2933119, 2.2956897] };
  const r = arrivalRadiusFor(eiffel, walk);
  assert.ok(r > 90 && r < 110, `got ${r}`);
});
