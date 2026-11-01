import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraHeading, smoothHeading, placesInView, placesAround, whereItIs } from '../js/lens.js';

// The Block of Discord on Passeig de Gràcia (which runs south-east to north-west): three famous
// houses side by side, Casa Amatller and Casa Lleó Morera further down the avenue.
const BATLLO = { lat: 41.39158, lon: 2.16492 };
const M_LON = 111320 * Math.cos((BATLLO.lat * Math.PI) / 180);
const from = (p, bearing, meters) => ({
  lat: p.lat + (Math.cos((bearing * Math.PI) / 180) * meters) / 111320,
  lon: p.lon + (Math.sin((bearing * Math.PI) / 180) * meters) / M_LON,
});
const places = [
  { title: 'Casa Batlló', ...BATLLO, langs: 60 },
  { title: 'Casa Amatller', ...from(BATLLO, 135, 12), langs: 25 },
  { title: 'Casa Lleó Morera', ...from(BATLLO, 135, 60), langs: 20 },
  { title: 'Passeig de Gràcia station', ...from(BATLLO, 45, 50), langs: 10, category: 'skip' },
  { title: 'Eixample', description: 'District of Barcelona, Spain', ...from(BATLLO, 225, 30), langs: 30 },
];
// Across the avenue from Casa Batlló (north-east of it), facing it: south-west.
const across = from(BATLLO, 45, 40);

test('the camera heading comes from the compass (iPhone) or the phone’s rotation (Android)', () => {
  assert.equal(cameraHeading({ webkitCompassHeading: 123 }), 123);
  const upright = (alpha) => Math.round(cameraHeading({ absolute: true, alpha, beta: 90, gamma: 0 }));
  assert.equal(upright(0), 0, 'held upright, top to the sky, alpha 0: facing north');
  assert.equal(upright(90), 270, 'turned left a quarter: facing west');
  assert.equal(upright(270), 90, 'turned right a quarter: facing east');
  assert.equal(Math.round(cameraHeading({ absolute: true, alpha: 0, beta: 60, gamma: 0 })), 0, 'tilted back a little: same direction');
  assert.equal(cameraHeading({ absolute: true, alpha: 0, beta: 0, gamma: 0 }), null, 'lying flat: the camera faces the ground');
  assert.equal(cameraHeading({ absolute: false, alpha: 30, beta: 90, gamma: 0 }), null, 'not tied to north: no heading');
});

test('a jittery compass is smoothed the short way round', () => {
  assert.equal(smoothHeading(350, 10, 0.5), 0);
  assert.equal(smoothHeading(null, 42), 42);
  assert.equal(smoothHeading(42, null), 42);
});

test('pointing at Casa Batlló picks Casa Batlló; turning to the house next door picks that one', () => {
  const aimed = placesInView(across, 225, places);
  assert.equal(aimed[0].title, 'Casa Batlló');
  assert.ok(aimed.some((p) => p.title === 'Casa Amatller'), 'the neighbour is offered too, in case');
  assert.ok(!aimed.some((p) => p.title === 'Passeig de Gràcia station'), 'metro stations are not sights');
  assert.ok(!aimed.some((p) => p.title === 'Eixample'), 'a whole district is not something you point at');
  assert.ok(aimed[0].x > 0.4 && aimed[0].x < 0.6, 'drawn in the middle of the view');
  const next = placesInView(across, 208, places);
  assert.equal(next[0].title, 'Casa Amatller');
  assert.ok(next[0].off > -8 && next[0].off < 8);
});

test('places behind you are not in view; places you stand at always are', () => {
  assert.deepEqual(placesInView(across, 45, places).map((p) => p.title), []);
  const at = placesInView(from(BATLLO, 45, 5), 45, places);
  assert.equal(at[0].title, 'Casa Batlló');
  assert.equal(at[0].here, true);
  assert.equal(whereItIs(at[0]), "You're here");
});

test('without a compass, what’s around you, nearest first, and how far', () => {
  const around = placesAround(across, places);
  assert.deepEqual(around.map((p) => p.title), ['Casa Batlló', 'Casa Amatller', 'Casa Lleó Morera']);
  assert.equal(whereItIs(around[0]), '40 m away');
  assert.equal(whereItIs({ distance: 42, off: -20 }), '40 m, a little to the left');
  assert.equal(whereItIs({ distance: 133, off: 2 }), '130 m, ahead');
});
