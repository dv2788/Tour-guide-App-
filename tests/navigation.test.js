import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoute, progressOn, upcomingManeuver, stepInstruction, maneuverSentence, maneuverIcon, mapsLink, Navigator } from '../js/navigation.js';
import { pointAlongPath, distanceMeters, bearingDegrees, angleDiff } from '../js/geo.js';

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const flush = () => new Promise((r) => setImmediate(r));

// A real walking route: Place de la Concorde -> Grand Palais (routing.openstreetmap.de).
const osrm = load('./fixtures/route-steps.json');
const route = parseRoute(osrm);
// Real walking routes in 8 cities, recorded from the same service (see fixtures/routes/index.json).
const cities = load('./fixtures/routes/index.json').walks.map((w) => ({ ...w, osrm: load(`./fixtures/routes/${w.file}`) }));

// A made-up route in local meters (x east, y north) around Paris, with OSRM-style steps.
function synth(points, steps) {
  const at = ([x, y]) => [2.35 + x / (111320 * Math.cos((48.85 * Math.PI) / 180)), 48.85 + y / 111320];
  const coords = points.map(at);
  const dist = (i, j) => {
    let d = 0;
    for (let k = i + 1; k <= j; k++) d += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    return d;
  };
  return {
    routes: [
      {
        geometry: { type: 'LineString', coordinates: coords },
        legs: [
          {
            steps: steps.map((s, n) => ({
              distance: n + 1 < steps.length ? dist(s.i, steps[n + 1].i) : 0,
              name: s.name ?? '',
              maneuver: { type: s.type, modifier: s.modifier, location: coords[s.i] },
            })),
          },
        ],
      },
    ],
  };
}

test('parseRoute: the line, its length and the maneuvers placed on it', () => {
  assert.ok(Math.abs(route.length - 876) < 40, `length ${route.length}`);
  assert.equal(route.steps[0].type, 'depart');
  assert.equal(route.steps.at(-1).type, 'arrive');
  assert.equal(route.steps.at(-1).along, route.length);
  // Every maneuver sits exactly on the drawn line.
  for (const s of route.rawSteps) assert.ok(progressOn(route, s).off < 1, `${s.type} off the line`);
  const left = route.steps.find((s) => s.type === 'turn' && s.modifier === 'left');
  assert.ok(left.along > 380 && left.along < 400, `first left turn after ~390 m (${left.along})`);
});

test('a zig-zag across a street (left, 12 m, right) is not an instruction', () => {
  const r = parseRoute(
    synth(
      [[0, 0], [100, 0], [100, 12], [200, 12], [200, -80]],
      [
        { i: 0, type: 'depart', name: 'Rue A' },
        { i: 1, type: 'turn', modifier: 'left' }, // onto the crossing
        { i: 2, type: 'turn', modifier: 'right', name: 'Rue A' }, // onto the far pavement
        { i: 3, type: 'turn', modifier: 'right', name: 'Rue B' },
        { i: 4, type: 'arrive' },
      ],
    ),
  );
  assert.deepEqual(
    r.steps.map((s) => [s.type, s.modifier ?? null, s.name]),
    [
      ['depart', null, 'Rue A'],
      ['turn', 'right', 'Rue B'],
      ['arrive', null, ''],
    ],
  );
  assert.equal(stepInstruction('en', r.steps[0]), 'Head east onto Rue A');
});

test('two lefts round a corner are said as two turns, not "turn around"', () => {
  const r = parseRoute(
    synth(
      [[0, 0], [100, 0], [100, 15], [0, 15]],
      [
        { i: 0, type: 'depart' },
        { i: 1, type: 'turn', modifier: 'left' },
        { i: 2, type: 'turn', modifier: 'left', name: 'Rue C' },
        { i: 3, type: 'arrive' },
      ],
    ),
  );
  const m = upcomingManeuver(r, 60);
  assert.equal(maneuverSentence('en', m, 'X'), 'In 40 meters, turn left, then turn left onto Rue C');
});

test('real routes: pavement zig-zags merged, street names kept', () => {
  const bcn = parseRoute(cities.find((c) => c.city === 'Barcelona').osrm);
  assert.ok(bcn.rawSteps.length >= 40, `raw steps ${bcn.rawSteps.length}`);
  assert.ok(bcn.steps.length <= 14, `simplified to ${bcn.steps.length}: ${bcn.steps.map((s) => `${s.modifier} ${s.name}`).join(' | ')}`);
  const names = bcn.steps.map((s) => s.name);
  assert.ok(names.includes('Carrer de Mallorca') && names.includes('Avinguda Diagonal'), names.join(' | '));
  for (const c of cities) {
    const r = parseRoute(c.osrm);
    // No left-then-right pairs a few meters apart left over.
    for (let i = 2; i < r.steps.length - 1; i++) {
      const [a, b] = [r.steps[i - 1], r.steps[i]];
      const jog = /left/.test(a.modifier) !== /left/.test(b.modifier) && b.along - a.along < 20 && a.type !== 'depart';
      assert.ok(!jog, `${c.city}: zig-zag at ${Math.round(a.along)} m left in`);
    }
  }
});

test('real routes: every clear change of direction at a junction gets an instruction', () => {
  for (const c of cities) {
    const r = parseRoute(c.osrm);
    const heading = (a, b) => bearingDegrees(pointAlongPath(r, a), pointAlongPath(r, b));
    for (let x = 30; x < r.length - 30; x += 5) {
      if (Math.abs(angleDiff(heading(x - 25, x), heading(x, x + 25))) < 60) continue; // no bend here
      const junction = r.rawSteps.filter((s) => Math.abs(s.along - x) <= 40 && s.type !== 'depart' && s.type !== 'arrive');
      if (!junction.length) continue; // the street itself bends: nothing to do
      const from = Math.min(x, ...junction.map((s) => s.along));
      const to = Math.max(x, ...junction.map((s) => s.along));
      const net = angleDiff(heading(Math.max(0, from - 40), from - 10), heading(to + 10, Math.min(r.length, to + 40)));
      if (Math.abs(net) < 35) continue; // a zig-zag: you end up going the same way
      const said = r.steps.some((s) => s.type !== 'depart' && s.type !== 'arrive' && s.along >= x - 45 && s.along <= x + 40);
      assert.ok(said, `${c.city}, ${c.from.name}: the ${Math.round(net)}° turn at ${x} m has no instruction`);
    }
  }
  // After the Pont de l'Alma the path curves right into Cours Albert-Ier before the junction.
  const alma = parseRoute(cities.find((c) => /on the bridge/.test(c.from.name)).osrm);
  assert.ok(alma.steps.some((s) => s.modifier === 'right' && s.along > 250 && s.along < 300), 'turn right at the end of the bridge');
});

test('progress stays on the right part of a route that doubles back', () => {
  const r = parseRoute(synth([[0, 0], [200, 0], [200, 4], [0, 4]], [{ i: 0, type: 'depart' }, { i: 1, type: 'turn', modifier: 'uturn' }, { i: 3, type: 'arrive' }]));
  const p = pointAlongPath(r, 300); // on the way back, at x = 104
  const prog = progressOn(r, { lat: p.lat - 1.5 / 111320, lon: p.lon }, 290);
  assert.ok(Math.abs(prog.along - 300) < 3, `along ${prog.along}`);
});

test('instructions in words, with distance and "then"', () => {
  const turn = { type: 'turn', modifier: 'left', name: 'Rue de Rivoli' };
  assert.equal(stepInstruction('en', turn), 'Turn left onto Rue de Rivoli');
  assert.equal(stepInstruction('fr', turn), 'Tournez à gauche sur Rue de Rivoli');
  assert.equal(stepInstruction('en', { type: 'depart', bearing: 92 }), 'Head east');
  assert.equal(stepInstruction('en', { type: 'roundabout', exit: 2 }), 'At the roundabout, take exit 2');
  assert.equal(stepInstruction('en', { type: 'fork', modifier: 'slight right', name: 'Birdcage Walk' }), 'Keep right onto Birdcage Walk');
  assert.equal(stepInstruction('en', { type: 'arrive' }, 'Grand Palais'), 'Grand Palais is just ahead');
  assert.equal(maneuverSentence('en', { step: { type: 'arrive' }, distance: 100, then: null }, 'Plaça de Catalunya'), 'Plaça de Catalunya is 100 meters ahead');
  assert.equal(maneuverSentence('fr', { step: { type: 'arrive' }, distance: 100, then: null }, 'Plaça de Catalunya'), 'Plaça de Catalunya est à 100 mètres devant vous');
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

/** Walk a route, one position per second, and collect what the Navigator says. */
async function walk(osrmJson, target, { offsets = () => null, step = 1.4, streetName = null, reroute = null } = {}) {
  let clock = 1_000_000;
  const spoken = [];
  let fetches = 0;
  const nav = new Navigator({
    lang: 'en',
    modeId: 'walk',
    getDirections: async (from, to) => {
      fetches++;
      return fetches > 1 && reroute ? reroute(from, to) : osrmJson;
    },
    streetName,
    narrator: { interject: (text, meta, opts) => spoken.push({ text, along: current, urgent: opts.urgent, step: nav.route && upcomingManeuver(nav.route, nav.progress?.along ?? 0)?.step }) },
    now: () => clock,
  });
  const r = parseRoute(osrmJson);
  let current = 0;
  nav.update(pointAlongPath(r, 0));
  nav.setTarget(target);
  await flush();
  for (current = 0; current <= r.length; current += step) {
    clock += 1000;
    const p = pointAlongPath(r, current);
    nav.update(offsets(current) ? { ...p, ...offsets(current) } : p);
    await flush();
  }
  return { nav, spoken, fetches: () => fetches, route: r };
}

test('real routes in 8 cities: every turn announced once, before you reach it', async () => {
  for (const c of cities) {
    const { nav, spoken, fetches, route: r } = await walk(c.osrm, c.to);
    assert.equal(fetches(), 1, `${c.city}: no re-routing while on the route`);
    const turns = r.steps.filter((s) => s.type !== 'depart' && s.type !== 'arrive');
    for (const t of turns) assert.ok(nav.announced.has(t.id), `${c.city} ${c.from.name}: turn at ${Math.round(t.along)} m never announced`);
    for (const s of spoken.slice(1)) {
      assert.ok(s.step.along - s.along >= 0 && s.step.along - s.along <= 32, `${c.city}: "${s.text}" said ${Math.round(s.step.along - s.along)} m before the turn`);
    }
    assert.equal(spoken[0].urgent, false, 'the first "head this way" waits for the story');
  }
});

test('Navigator: a GPS jump is not a wrong turn; staying off the route is', async () => {
  const target = { name: 'Grand Palais', lat: 48.866704, lon: 2.312009 };
  // One wild fix 100 m off at 200 m: ignored.
  const once = await walk(osrm, target, { offsets: (d) => (d > 200 && d < 201.5 ? { lat: pointAlongPath(route, d).lat - 0.0009 } : null) });
  assert.equal(once.fetches(), 1);
  // Off by 50 m, but the phone says it's only accurate to 45 m: not sure enough to re-route.
  const fuzzy = await walk(osrm, target, { offsets: (d) => (d > 200 && d < 240 ? { lat: pointAlongPath(route, d).lat - 0.00045, accuracy: 45 } : null) });
  assert.equal(fuzzy.fetches(), 1);
  // 120 m off for ten seconds: a new route, announced at once.
  // (The new route goes straight from where you are to the stop.)
  const straight = (from, to) => ({
    routes: [{ geometry: { coordinates: [[from.lon, from.lat], [to.lon, to.lat]] }, legs: [{ steps: [{ distance: 1, name: 'Avenue Y', maneuver: { type: 'depart', location: [from.lon, from.lat] } }, { distance: 0, maneuver: { type: 'arrive', location: [to.lon, to.lat] } }] }] }],
  });
  const off = await walk(osrm, target, { reroute: straight, offsets: (d) => (d > 200 && d < 214 ? { lat: pointAlongPath(route, d).lat - 0.0011 } : null) });
  assert.ok(off.fetches() >= 2, 're-routed');
  const after = off.spoken.find((s) => s.along > 200 && /^Head/.test(s.text));
  assert.ok(after?.urgent, 'the new direction cuts in');
});

test('Navigator: your dot is drawn on the route while you follow it', async () => {
  const target = { name: 'Grand Palais', lat: 48.866704, lon: 2.312009 };
  const { nav } = await walk(osrm, target, { offsets: () => null });
  const p = pointAlongPath(nav.route, 300);
  const wobbly = { lat: p.lat + 8 / 111320, lon: p.lon, accuracy: 10 }; // GPS 8 m into a building
  nav.update(wobbly);
  const drawn = nav.snap(wobbly);
  assert.ok(drawn.snapped && progressOn(nav.route, drawn).off < 0.5, 'on the route');
  const far = { lat: p.lat + 60 / 111320, lon: p.lon, accuracy: 10 };
  nav.update(far);
  assert.equal(nav.snap(far), far, 'left where it is when you are clearly elsewhere');
});

test('Navigator: at the end of the way, or already there, the place is "just ahead" (not "Finding the way…")', async () => {
  const target = { name: 'Grand Palais', lat: 48.866704, lon: 2.312009 };
  const { nav, route: r } = await walk(osrm, target);
  let state;
  nav.onUpdate = (s) => (state = s);
  nav.update(pointAlongPath(r, r.length));
  assert.equal(state.sentence, 'Grand Palais is just ahead');
  assert.equal(state.icon, 'flag');
  // Back at the start of a round trip: the route service has no way to give (you're there), nothing to wait for.
  let home;
  const back = new Navigator({ lang: 'en', modeId: 'walk', getDirections: async () => { throw new Error('No route'); }, onUpdate: (s) => (home = s), now: () => 0 });
  back.update({ lat: 41.387, lon: 2.1701 });
  back.setTarget({ name: 'your starting point', lat: 41.38705, lon: 2.17012 });
  await flush();
  assert.equal(home.sentence, 'Your starting point is just ahead');
  assert.equal(home.icon, 'flag');
  // Still 200 m away with no route yet: that is when it is finding the way.
  back.setTarget({ name: 'Plaça Reial', lat: 41.3888, lon: 2.1701 });
  await flush();
  assert.equal(home.sentence, null);
});

test('Navigator: names an unnamed street before announcing the turn', async () => {
  const unnamed = synth(
    [[0, 0], [150, 0], [150, 120]],
    [{ i: 0, type: 'depart', name: 'Quai X' }, { i: 1, type: 'turn', modifier: 'left' }, { i: 2, type: 'arrive' }],
  );
  const asked = [];
  const { spoken } = await walk(unnamed, { name: 'Musée', lat: 48.851, lon: 2.352 }, { streetName: async (p) => (asked.push(p), 'Rue Nommée') });
  assert.equal(asked.length, 1, 'asked once');
  assert.ok(distanceMeters(asked[0], { lat: 48.85 + 10 / 111320, lon: 2.35 + 150 / (111320 * Math.cos((48.85 * Math.PI) / 180)) }) < 15, 'asked a little way into the new street');
  assert.ok(spoken.some((s) => s.text === 'In 30 meters, turn left onto Rue Nommée' || /turn left onto Rue Nommée$/.test(s.text)), spoken.map((s) => s.text).join(' | '));
});

test('Navigator: a failing route service is retried with growing pauses', async () => {
  let clock = 0;
  let fetches = 0;
  const nav = new Navigator({
    getDirections: async () => {
      fetches++;
      throw new Error('offline');
    },
    now: () => clock,
  });
  nav.update({ lat: 48.8656, lon: 2.3212 });
  nav.setTarget({ name: 'Grand Palais', lat: 48.8667, lon: 2.312 });
  for (let s = 0; s < 30; s++) {
    await flush();
    clock += 1000;
    nav.update({ lat: 48.8656, lon: 2.3212 });
  }
  await flush();
  assert.ok(fetches >= 3 && fetches <= 5, `${fetches} tries in 30 s (not one per second)`);
});
