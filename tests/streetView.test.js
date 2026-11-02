// First person: the camera stands where you are, looks where you're going, and the map stands up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eyeCamera, offsetPoint, routeHeading, signpost, firstPersonStyle, EYE, PITCH, FOV } from '../js/streetView.js';
import { distanceMeters, bearingDegrees, buildPath } from '../js/geo.js';

const here = { lat: 41.3917, lon: 2.1649 }; // Passeig de Gràcia
const EARTH = 2 * Math.PI * 6378137;

test('the camera stands at your eyes, the set height above the street, looking the way you go', () => {
  for (const [mode, { height }] of Object.entries(EYE)) {
    const heading = 135;
    const view = 800;
    const cam = eyeCamera({ eye: here, heading, height, viewHeightPx: view });
    assert.equal(cam.bearing, heading);
    assert.equal(cam.pitch, PITCH);
    // The point looked at is ahead, in the direction of travel…
    const ahead = distanceMeters(here, cam.center);
    assert.ok(Math.abs(ahead - height * Math.tan((PITCH * Math.PI) / 180)) < 0.5, `${mode}: ${ahead} m ahead`);
    assert.ok(Math.abs(bearingDegrees(here, cam.center) - heading) < 1);
    // …and from that zoom, the map's camera is `height` metres up (its own formula, run backwards).
    const metersPerPx = (EARTH * Math.cos((cam.center.lat * Math.PI) / 180)) / (512 * 2 ** cam.zoom);
    const cameraToCenterPx = (0.5 * view) / Math.tan(((FOV / 2) * Math.PI) / 180);
    const altitude = cameraToCenterPx * metersPerPx * Math.cos((PITCH * Math.PI) / 180);
    assert.ok(Math.abs(altitude - height) < 0.05, `${mode}: eye at ${altitude.toFixed(2)} m`);
  }
  // A hike looks out from higher up (the landscape); a walk from just above your head.
  assert.ok(EYE.hike.height > 4 * EYE.walk.height);
  assert.ok(eyeCamera({ eye: here, heading: 0, height: 5, viewHeightPx: 800 }).zoom <= 22);
});

test('offsetPoint goes the right way and distance', () => {
  for (const b of [0, 90, 200, 315]) {
    const p = offsetPoint(here, b, 100);
    assert.ok(Math.abs(distanceMeters(here, p) - 100) < 0.5);
    assert.ok(Math.abs(((bearingDegrees(here, p) - b + 540) % 360) - 180) < 0.5);
  }
});

test('the view turns with the street ahead, not with every wobble; off the route, it has no say', () => {
  // A street going north, then turning east.
  const north = (m) => offsetPoint(here, 0, m);
  const corner = north(100);
  const path = buildPath([here, north(50), corner, offsetPoint(corner, 90, 100)]);
  const wobble = offsetPoint(north(20), 90, 3); // a little to the side of the street
  assert.ok(Math.abs(routeHeading(path, wobble)) < 12 || Math.abs(routeHeading(path, wobble) - 360) < 12, `${routeHeading(path, wobble)}`);
  // Near the corner, it already looks round it.
  const turning = routeHeading(path, north(90));
  assert.ok(turning > 20 && turning < 90, `at the corner: ${turning}`);
  assert.equal(routeHeading(path, offsetPoint(here, 270, 200)), null, 'far off the route');
  assert.equal(routeHeading(null, here), null);
});

test('signposts: ahead and near enough show, nearer ones bigger; behind you, they go', () => {
  const near = offsetPoint(here, 10, 80);
  const far = offsetPoint(here, 0, 600);
  const behind = offsetPoint(here, 180, 100);
  const tooFar = offsetPoint(here, 0, 2000);
  assert.ok(signpost(here, 0, near, 700).visible);
  assert.ok(signpost(here, 0, near, 700).scale > signpost(here, 0, far, 700).scale);
  assert.ok(!signpost(here, 0, behind, 700).visible);
  assert.ok(!signpost(here, 0, tooFar, 700).visible);
  assert.ok(signpost(here, 0, offsetPoint(here, 180, 10), 700).visible, 'just walked past it: still there');
});

test('the style: buildings stand up, the route lies on the street under them, labels on top, a sky', () => {
  const base = {
    version: 8,
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
      { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
      { id: 'building-top', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
      { id: 'road-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name' },
    ],
  };
  const style = firstPersonStyle(base);
  const ids = style.layers.map((l) => l.id);
  assert.ok(!ids.includes('building') && !ids.includes('building-top'), 'flat buildings gone');
  const extrusion = style.layers.find((l) => l.id === 'fp-buildings');
  assert.equal(extrusion.type, 'fill-extrusion');
  assert.equal(extrusion.source, 'openmaptiles');
  assert.ok(ids.indexOf('fp-route') < ids.indexOf('fp-buildings'), 'the route under the buildings');
  assert.ok(ids.indexOf('fp-buildings') < ids.indexOf('road-label'), 'labels on top');
  assert.ok(style.sources['fp-route'] && style.sky && style.light);
  assert.equal(base.layers.length, 5, 'the base style is left as it was');
  assert.notDeepEqual(firstPersonStyle(base, { dark: true }).sky, style.sky, 'a night sky in the dark style');
});
