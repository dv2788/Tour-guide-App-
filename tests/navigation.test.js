import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoute, progressOn, upcomingManeuver, stepInstruction, maneuverSentence, maneuverIcon, mapsLink, Navigator } from '../js/navigation.js';
import { pointAlongPath } from '../js/geo.js';

// A real walking route: Place de la Concorde -> Grand Palais (routing.openstreetmap.de).
const osrm = JSON.parse(readFileSync(new URL('./fixtures/route-steps.json', import.meta.url)));
const route = parseRoute(osrm);

test('parseRoute: the line, its length and the maneuvers along it', () => {
  assert.ok(Math.abs(route.length - 876) < 40, `length ${route.length}`);
  assert.equal(route.steps[0].type, 'depart');
  assert.equal(route.steps.at(-1).type, 'arrive');
  assert.equal(route.steps[2].type, 'turn');
  assert.ok(route.steps[2].along > 380 && route.steps[2].along < 400, 'third maneuver after ~390 m');
});

test('progress: how far along, how far off', () => {
  const p = pointAlongPath(route, 200);
  const prog = progressOn(route, p);
  assert.ok(Math.abs(prog.along - 200) < 2, `along ${prog.along}`);
  assert.ok(prog.off < 1);
  const off = progressOn(route, { lat: p.lat + 0.001, lon: p.lon }); // ~110 m north
  assert.ok(off.off > 60, `off ${off.off}`);
});

test('the next real maneuver skips "carry straight on" and merges turns a few meters apart', () => {
  const start = upcomingManeuver(route, 0);
  assert.equal(start.step.type, 'depart');
  const m = upcomingManeuver(route, 150);
  assert.equal(m.step.type, 'turn', 'the "new name, straight" step is skipped');
  assert.equal(m.step.modifier, 'left');
  assert.equal(m.then, null, 'the next turn is 46 m further: announced on its own');
  // A sharp right followed 10 m later by a left: said together.
  const sharp = route.steps.find((st) => st.modifier === 'sharp right');
  const pair = upcomingManeuver(route, sharp.along - 20);
  assert.equal(pair.step.id, sharp.id);
  assert.equal(pair.then?.modifier, 'left');
});

test('instructions in words, with distance and "then"', () => {
  const turn = { type: 'turn', modifier: 'left', name: 'Rue de Rivoli' };
  assert.equal(stepInstruction('en', turn), 'Turn left onto Rue de Rivoli');
  assert.equal(stepInstruction('fr', turn), 'Tournez à gauche sur Rue de Rivoli');
  assert.equal(stepInstruction('en', { type: 'depart', bearing: 92 }), 'Head east');
  assert.equal(stepInstruction('en', { type: 'roundabout', exit: 2 }), 'At the roundabout, take exit 2');
  assert.equal(stepInstruction('en', { type: 'arrive' }, 'Grand Palais'), 'Grand Palais is just ahead');
  const m = { step: turn, distance: 80, then: { type: 'turn', modifier: 'right', name: '' } };
  assert.equal(maneuverSentence('en', m, 'X'), 'In 80 meters, turn left onto Rue de Rivoli, then turn right');
  assert.equal(maneuverSentence('fr', m, 'X'), 'Dans 80 mètres, tournez à gauche sur Rue de Rivoli, puis tournez à droite');
  assert.equal(maneuverIcon(turn), 'turn-left');
  assert.equal(maneuverIcon({ type: 'arrive' }), 'flag');
});

test('maps links hand the next stop to the phone’s navigation app', () => {
  const stop = { lat: 48.8661, lon: 2.3125 };
  assert.equal(mapsLink(stop, 'walk'), 'https://www.google.com/maps/dir/?api=1&destination=48.866100,2.312500&travelmode=walking');
  assert.equal(mapsLink(stop, 'drive', { apple: true }), 'https://maps.apple.com/?daddr=48.866100,2.312500&dirflg=d');
});

test('Navigator: fetches the route, speaks each turn once, re-routes when you stray', async () => {
  let clock = 1_000_000;
  const spoken = [];
  const updates = [];
  let fetches = 0;
  const nav = new Navigator({
    lang: 'en',
    modeId: 'walk',
    getDirections: async () => {
      fetches++;
      return osrm;
    },
    narrator: { interject: (text) => spoken.push(text) },
    onUpdate: (s) => updates.push(s),
    now: () => clock,
  });
  const target = { name: 'Grand Palais', lat: 48.866704, lon: 2.312009 };
  nav.update(pointAlongPath(route, 0));
  nav.setTarget(target);
  await new Promise((r) => setImmediate(r));
  assert.equal(fetches, 1);
  assert.match(spoken[0], /^Head (west|northwest) onto Place de la Concorde$/);
  // Walk along: one announcement ~30 m before the first left turn.
  for (let d = 10; d <= 380; d += 10) {
    clock += 8000;
    nav.update(pointAlongPath(route, d));
  }
  const turnPrompts = spoken.filter((t) => /turn left/i.test(t));
  assert.equal(turnPrompts.length, 1, spoken.join(' | '));
  assert.match(turnPrompts[0], /^(In \d+ meters, turn left|Turn left)/);
  const last = updates.at(-1);
  assert.ok(last.remaining > 400 && last.remaining < 520, `remaining ${last.remaining}`);
  assert.ok(last.minutes >= 6 && last.minutes <= 7);
  // Stray 150 m off the route: a new route is fetched.
  clock += 20000;
  const p = pointAlongPath(route, 380);
  nav.update({ lat: p.lat - 0.0014, lon: p.lon });
  await new Promise((r) => setImmediate(r));
  assert.equal(fetches, 2);
});
