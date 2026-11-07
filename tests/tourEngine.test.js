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
  assert.match(said[0], /^Welcome to Testville, a city\. It is nice\. It has a river\.$/);
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

test('a later stop you start next to waits for you; coming back to it out of order is announced, with the next one after', async (t) => {
  const stops = [
    { name: 'A', lat: LAT, lon: east(1000) },
    { name: 'B', lat: LAT, lon: east(50) },
    { name: 'C', lat: LAT, lon: east(1250) },
  ];
  const { engine, narrator } = makeEngine({ stops, pois: [] });
  t.after(() => engine.stop());
  await engine.start();
  // Standing by B (a round trip starts and ends near the same place): the tour begins with A.
  engine.update({ lat: LAT, lon: east(50) });
  engine.update({ lat: LAT, lon: east(60) }); // a wobble at the same spot
  await flush();
  await flush();
  assert.equal(narrator.spoken.filter((s) => s.meta.kind === 'stop').length, 0, 'B not announced at the start');
  assert.match(narrator.spoken.at(-1).text, /^Your first stop is A, 950 meters away\.$/);
  assert.equal(engine.nextStopIndex, 0);
  // Off towards A, then back to B before reaching A: B is reached, A is skipped.
  engine.update({ lat: LAT, lon: east(300) });
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

test('a stop set back from every path counts as reached from as close as the path gets', async (t) => {
  // A café 90 m inside a garden: the walking route passes 90 m from it at best.
  const stops = [{ name: 'Garden Café', lat: north(90), lon: east(300) }, { name: 'End', lat: LAT, lon: east(900) }];
  const { engine, narrator } = makeEngine({ stops, pois: [] });
  t.after(() => engine.stop());
  await engine.start();
  engine.approachLimit(0, 88); // what the route service says
  engine.approachLimit(1, Number.NaN); // unknown: unchanged
  assert.equal(engine.stops[0].arrivalRadius, 113);
  assert.equal(engine.stops[1].arrivalRadius, 60);
  engine.update({ lat: LAT, lon: east(250) });
  engine.update({ lat: LAT, lon: east(350) });
  await flush();
  await flush();
  assert.deepEqual(narrator.spoken.filter((s) => s.meta.kind === 'stop').map((s) => s.meta.title), ['Garden Café']);
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

test('the documentary narrator phrases the tour its own way', async (t) => {
  const stops = [{ name: 'Final Square', lat: LAT, lon: east(150) }];
  let clock = 1_000_000;
  const narrator = new FakeNarrator();
  const engine = new TourEngine({
    mode: getMode('walk'),
    lang: 'en',
    style: 'documentary',
    wiki: fakeWiki({ articles: { 'Final Square': { pageid: 50, title: 'Final Square', extract: 'A grand square.' } } }),
    narrator,
    city: { name: 'Testville', lat: LAT, lon: LON },
    stops,
    now: () => clock,
  });
  t.after(() => engine.stop());
  await engine.start();
  engine.update({ lat: LAT, lon: LON });
  narrator.finishAll();
  engine.update({ lat: LAT, lon: east(150) });
  await flush();
  await flush();
  const said = narrator.spoken.map((s) => s.text);
  assert.match(said[0], /^Welcome to Testville\. Let us take a closer look\./);
  assert.match(said[1], /^Our first stop is Final Square, some 150 meters away\.$/);
  assert.match(said.at(-1), /^And so, we arrive at Final Square\. A grand square\. And that brings our journey to its end\./);
});

test('museum visits and meals: the guide says so, then stays quiet until you leave', async (t) => {
  const stops = [
    { name: 'Grand Museum', lat: LAT, lon: east(100), visitMinutes: 60 },
    { name: 'Le Café', lat: LAT, lon: east(400), kind: 'food', meal: 'coffee', breakMinutes: 20 },
  ];
  const nearMuseum = { id: 9, title: 'Museum Garden', lat: north(30), lon: east(140), thumbnail: null, category: null };
  let clock = 1_000_000;
  const narrator = new FakeNarrator();
  const wiki = fakeWiki({
    pois: [nearMuseum],
    summaries: { 'Museum Garden': { pageid: 9, title: 'Museum Garden', extract: 'A garden.' } },
    articles: { 'Grand Museum': { pageid: 50, title: 'Grand Museum', extract: 'A great museum.' } },
  });
  const engine = new TourEngine({ mode: getMode('walk'), lang: 'en', wiki, narrator, stops, now: () => clock });
  t.after(() => engine.stop());
  await engine.start();
  engine.update({ lat: LAT, lon: east(100) }); // at the museum
  await flush();
  await flush();
  assert.match(narrator.spoken.at(-1).text, /You have arrived at the Grand Museum\. A great museum\. It's well worth going inside: allow about 60 minutes/);
  narrator.finishAll();
  clock += 60000;
  engine.update({ lat: LAT, lon: east(105) }); // wandering inside: the garden is close, but no story
  await flush();
  await flush();
  assert.ok(!narrator.spoken.some((s) => s.meta.title === 'Museum Garden'), 'quiet during the visit');
  engine.update({ lat: LAT, lon: east(400) }); // left, and reached the café
  await flush();
  await flush();
  const cafe = narrator.spoken.at(-1).text;
  assert.match(cafe, /^Time for a coffee break\. Le Café is right here\./);
  assert.ok(!/A great museum|garden/i.test(cafe));
});

test('a long stay (a castle, a viewpoint): the guide says how long, and lets you explore; a short one: on you go', async (t) => {
  const stops = [
    { name: 'Old Castle', lat: LAT, lon: east(100), stayMinutes: 30 },
    { name: 'Small Statue', lat: LAT, lon: east(400), stayMinutes: 5 },
  ];
  const nearCastle = { id: 9, title: 'Castle Well', lat: north(30), lon: east(140), thumbnail: null, category: null };
  let clock = 1_000_000;
  const narrator = new FakeNarrator();
  const wiki = fakeWiki({
    pois: [nearCastle],
    summaries: { 'Castle Well': { pageid: 9, title: 'Castle Well', extract: 'A well.' } },
    articles: { 'Old Castle': { pageid: 50, title: 'Old Castle', extract: 'A castle.' }, 'Small Statue': { pageid: 51, title: 'Small Statue', extract: 'A statue.' } },
  });
  const engine = new TourEngine({ mode: getMode('walk'), lang: 'en', wiki, narrator, stops, now: () => clock });
  t.after(() => engine.stop());
  await engine.start();
  engine.update({ lat: LAT, lon: east(100) });
  await flush();
  await flush();
  assert.match(narrator.spoken.at(-1).text, /You have arrived at Old Castle\. A castle\. Take your time here: about 30 minutes\./);
  narrator.finishAll();
  clock += 60000;
  engine.update({ lat: LAT, lon: east(105) }); // looking around
  await flush();
  await flush();
  assert.ok(!narrator.spoken.some((s) => s.meta.title === 'Castle Well'), 'quiet while you explore');
  engine.update({ lat: LAT, lon: east(400) });
  await flush();
  await flush();
  const statue = narrator.spoken.at(-1).text;
  assert.match(statue, /You have arrived at the Small Statue\./);
  assert.ok(!/Take your time/.test(statue), 'five minutes: nothing to announce');
});

test('directions to the first stop start at once, even while Wikipedia is slow to answer', async () => {
  const narrator = new FakeNarrator();
  const targets = [];
  const never = new Promise(() => {}); // Wikipedia busy: no answer
  const wiki = { ...fakeWiki({ pois: [], summaries: {} }), resolveArticle: () => never, nearby: () => never, summary: () => never };
  const engine = new TourEngine({
    mode: getMode('walk'),
    lang: 'en',
    wiki,
    narrator,
    city: { name: 'Testville', lat: LAT, lon: LON },
    stops: [{ name: 'Final Square', lat: LAT, lon: east(600) }],
    onEvent: (type, data) => type === 'next-stop' && targets.push(data.stop.name),
    now: () => 1_000_000,
  });
  engine.start(); // still waiting for the city's article
  engine.update({ lat: LAT, lon: LON, accuracy: 10 });
  await flush();
  assert.deepEqual([...new Set(targets)], ['Final Square'], 'the guide knows where to go before the welcome');
  assert.equal(engine.ready, false, 'the welcome is still waiting');
  engine.stop();
});

test('approaching a stop, the arrival line is composed and the voice primed before you get there', async (t) => {
  const { engine, narrator, advance } = makeEngine({ pois: [] });
  t.after(() => engine.stop());
  await engine.start();
  narrator.finishAll();
  // 400 m out: nothing primed yet (a story about the way could still come).
  engine.update({ lat: LAT, lon: east(200) });
  await flush();
  await flush();
  advance(15000);
  narrator.finishAll();
  await flush();
  assert.deepEqual(narrator.primed, []);
  // 120 m out, inside the quiet zone before a stop: the line is ready and the voice warms up.
  engine.update({ lat: LAT, lon: east(480) });
  await flush();
  await flush();
  assert.equal(narrator.primed.length, 1);
  assert.match(narrator.primed[0], /^You have arrived at Final Square\. A grand square\. Kings were crowned here\. That was your last stop/);
  // Arriving says exactly the primed line (what was synthesized), once.
  engine.update({ lat: LAT, lon: east(600) });
  await flush();
  await flush();
  await flush();
  const arrival = narrator.spoken.filter((s) => s.meta.kind === 'stop');
  assert.equal(arrival.length, 1);
  assert.equal(arrival[0].text, narrator.primed[0]);
  assert.equal(narrator.primed.length, 1);
});
