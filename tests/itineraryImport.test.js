import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItinerary, decodeGeohash, shortPlaceName, isShortLink } from '../js/itineraryImport.js';

const names = (r) => r.stops.map((s) => s.name ?? `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`);
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

test('Google Maps: multi-stop walking directions with coordinates from the data blob', () => {
  const url =
    'https://www.google.com/maps/dir/Eiffel+Tower,+Av.+Gustave+Eiffel,+75007+Paris,+France/Grand+Palais,+3+Av.+du+G%C3%A9n%C3%A9ral+Eisenhower,+75008+Paris,+France/Louvre+Museum,+Rue+de+Rivoli,+75001+Paris,+France/@48.8606,2.3092,14z/data=!3m1!4b1!4m20!4m19!1m5!1m1!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!2m2!1d2.2944813!2d48.8583701!1m5!1m1!1s0x47e66fd3a0c7b4b9:0x2c7a5b6a1e2e7d0!2m2!1d2.3125185!2d48.8660977!1m5!1m1!1s0x47e671d877937b0f:0xb975fcfa192f84d4!2m2!1d2.337644!2d48.8606111!3e2';
  const r = parseItinerary(url);
  assert.equal(r.source, 'google');
  assert.equal(r.mode, 'walk');
  assert.deepEqual(names(r), ['Eiffel Tower', 'Grand Palais', 'Louvre Museum']);
  assert.equal(r.stops[1].query, 'Grand Palais, 3 Av. du Général Eisenhower, 75008 Paris, France');
  assert.ok(near(r.stops[0].lat, 48.8583701) && near(r.stops[0].lon, 2.2944813));
  assert.ok(near(r.stops[2].lat, 48.8606111) && near(r.stops[2].lon, 2.337644));
});

test('Google Maps: "My Location" start is skipped, other country domains work', () => {
  const r = parseItinerary('https://www.google.fr/maps/dir/Ma+position/Mus%C3%A9e+du+Louvre,+75001+Paris/@48.86,2.33,15z/data=!4m2!4m1!3e0');
  assert.deepEqual(names(r), ['Musée du Louvre']);
  assert.equal(r.includesCurrentLocation, true);
  assert.equal(r.mode, 'drive');
});

test('Google Maps: official api=1 directions URL with waypoints', () => {
  const r = parseItinerary(
    'https://www.google.com/maps/dir/?api=1&origin=Paris%2CFrance&destination=Cherbourg%2CFrance&travelmode=driving&waypoints=Versailles%2CFrance%7CChartres%2CFrance',
  );
  assert.deepEqual(names(r), ['Paris', 'Versailles', 'Chartres', 'Cherbourg']);
  assert.equal(r.mode, 'drive');
});

test('Google Maps: legacy saddr/daddr, place links, coordinates, consent wrapper', () => {
  assert.deepEqual(names(parseItinerary('https://maps.google.com/maps?saddr=Eiffel+Tower&daddr=Louvre+to:Notre-Dame&dirflg=w')), [
    'Eiffel Tower',
    'Louvre',
    'Notre-Dame',
  ]);
  const place = parseItinerary(
    'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2919064,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813',
  );
  assert.deepEqual(names(place), ['Eiffel Tower']);
  assert.ok(near(place.stops[0].lon, 2.2944813));
  assert.deepEqual(names(parseItinerary('https://www.google.com/maps/dir/48.8583701,2.2944813/48.8606111,2.337644/')), [
    '48.8584,2.2945',
    '48.8606,2.3376',
  ]);
  const consent = `https://consent.google.com/ml?continue=${encodeURIComponent('https://www.google.com/maps/dir/Louvre/Panth%C3%A9on/')}&gl=FR`;
  assert.deepEqual(names(parseItinerary(consent)), ['Louvre', 'Panthéon']);
});

test('Apple Maps: new directions links with repeated waypoints, legacy links and place links', () => {
  const r = parseItinerary(
    'https://maps.apple.com/directions?source=Eiffel%20Tower&waypoint=Grand%20Palais&waypoint=48.8656,2.3212&destination=Louvre%20Museum&mode=walking',
  );
  assert.equal(r.source, 'apple');
  assert.deepEqual(names(r), ['Eiffel Tower', 'Grand Palais', '48.8656,2.3212', 'Louvre Museum']);
  assert.equal(r.mode, 'walk');

  const legacy = parseItinerary('https://maps.apple.com/?saddr=Eiffel%20Tower&daddr=Louvre&dirflg=d');
  assert.deepEqual(names(legacy), ['Eiffel Tower', 'Louvre']);
  assert.equal(legacy.mode, 'drive');

  const place = parseItinerary('https://maps.apple.com/place?coordinate=48.8583,2.2944&name=Eiffel%20Tower');
  assert.deepEqual(names(place), ['Eiffel Tower']);
  assert.equal(place.stops[0].lat, 48.8583);

  assert.deepEqual(names(parseItinerary('https://maps.apple.com/?q=Louvre&ll=48.8606,2.3376')), ['Louvre']);
});

test('Waze: shared geohash links, ul links and live-map directions (always driving)', () => {
  const shared = parseItinerary('Rejoins-moi avec Waze : https://waze.com/ul/hu09tunqu9');
  assert.equal(shared.source, 'waze');
  assert.equal(shared.mode, 'drive');
  assert.ok(near(shared.stops[0].lat, 48.85837, 1e-4) && near(shared.stops[0].lon, 2.29448, 1e-4));

  const ul = parseItinerary('https://www.waze.com/ul?ll=48.85837%2C2.29448&navigate=yes&q=Tour%20Eiffel');
  assert.deepEqual(names(ul), ['Tour Eiffel']);
  assert.equal(ul.stops[0].lat, 48.85837);

  const live = parseItinerary(
    'https://www.waze.com/live-map/directions/fr/ile-de-france/paris/tour-eiffel?to=ll.48.85837%2C2.29448&from=ll.48.8606%2C2.3376',
  );
  assert.deepEqual(names(live), ['48.8606,2.3376', 'Tour Eiffel']);
});

test('OpenStreetMap, Bing, HERE and geo: links', () => {
  const osm = parseItinerary(
    'https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=48.8584%2C2.2945%3B48.8606%2C2.3376#map=15/48.8595/2.3160',
  );
  assert.deepEqual(names(osm), ['48.8584,2.2945', '48.8606,2.3376']);
  assert.equal(osm.mode, 'walk');

  const bing = parseItinerary('https://www.bing.com/maps?rtp=adr.Eiffel%20Tower%2C%20Paris~pos.48.8606_2.3376_Louvre&mode=W');
  assert.deepEqual(names(bing), ['Eiffel Tower', 'Louvre']);
  assert.equal(bing.stops[1].lat, 48.8606);
  assert.equal(bing.mode, 'walk');

  const here = parseItinerary('https://wego.here.com/directions/walk/Eiffel-Tower:48.8583,2.2944/Louvre:48.8606,2.3376');
  assert.deepEqual(names(here), ['Eiffel Tower', 'Louvre']);
  assert.equal(here.mode, 'walk');

  const geo = parseItinerary('geo:48.8583,2.2944?q=48.8583,2.2944(Eiffel+Tower)');
  assert.deepEqual(names(geo), ['Eiffel Tower']);
  assert.equal(geo.stops[0].lon, 2.2944);
  assert.deepEqual(names(parseItinerary('geo:0,0?q=Louvre+Paris')), ['Louvre Paris']);
});

test('several links pasted together are combined in order', () => {
  const r = parseItinerary(
    'Day 1: https://maps.apple.com/?q=Louvre&ll=48.8606,2.3376\nthen https://www.google.com/maps/place/Panth%C3%A9on/@48.8462,2.3464,17z',
  );
  assert.deepEqual(names(r), ['Louvre', 'Panthéon']);
});

test('short links are flagged, and place names around them are still used', () => {
  const r = parseItinerary('Directions from Eiffel Tower to Louvre Museum\nhttps://maps.app.goo.gl/AbCdEf123XyZ');
  assert.deepEqual(r.shortLinks, ['https://maps.app.goo.gl/AbCdEf123XyZ']);
  assert.deepEqual(names(r), ['Eiffel Tower', 'Louvre Museum']);
  assert.ok(isShortLink('https://maps.apple/p/x1y2'));
  assert.ok(isShortLink('https://goo.gl/maps/abc'));
  assert.ok(!isShortLink('https://goo.gl/other'));
  assert.ok(!isShortLink('https://waze.com/ul/hu09tunqu9'), 'Waze geohash links are read directly');
});

test('plain text: numbered and bulleted lists, arrows, "from … to …", instructions dropped', () => {
  assert.deepEqual(names(parseItinerary('1. Eiffel Tower\n2. Grand Palais\n3) Louvre')), ['Eiffel Tower', 'Grand Palais', 'Louvre']);
  assert.deepEqual(names(parseItinerary('• Sacré-Cœur\n- Moulin Rouge\n* Opéra Garnier')), ['Sacré-Cœur', 'Moulin Rouge', 'Opéra Garnier']);
  assert.deepEqual(names(parseItinerary("Eiffel Tower → Pont de l'Alma -> Louvre")), ['Eiffel Tower', "Pont de l'Alma", 'Louvre']);
  assert.deepEqual(names(parseItinerary('Itinéraire de Tour Eiffel à Musée du Louvre')), ['Tour Eiffel', 'Musée du Louvre']);
  assert.deepEqual(
    names(parseItinerary('Eiffel Tower\nHead northeast on Av. Gustave Eiffel\n15 min (1.2 km)\nTurn right onto Quai Branly\nLouvre Museum')),
    ['Eiffel Tower', 'Louvre Museum'],
  );
  const mine = parseItinerary('My location\nLouvre');
  assert.deepEqual(names(mine), ['Louvre']);
  assert.equal(mine.includesCurrentLocation, true);
  assert.deepEqual(names(parseItinerary('48.8584, 2.2945\nLouvre')), ['48.8584,2.2945', 'Louvre']);
  assert.deepEqual(names(parseItinerary('Saint-Germain-des-Prés\nSaint-Germain-des-Prés\nPanthéon')), ['Saint-Germain-des-Prés', 'Panthéon']);
});

test('helpers', () => {
  assert.equal(shortPlaceName('Eiffel Tower, Av. Gustave Eiffel, 75007 Paris, France'), 'Eiffel Tower');
  assert.equal(shortPlaceName('12, Rue de Rivoli, Paris'), '12 Rue de Rivoli');
  const p = decodeGeohash('u09tunqu9');
  assert.ok(near(p.lat, 48.85837, 1e-4) && near(p.lon, 2.29448, 1e-4));
  assert.equal(decodeGeohash('not!valid'), null);
});

test('real places that start like a driving instruction are kept', () => {
  assert.deepEqual(names(parseItinerary('Walk of Fame\nDrive-in Cinema\nTurn right onto Rue de Rivoli\nTake Five Jazz Club')), [
    'Walk of Fame',
    'Drive-in Cinema',
    'Take Five Jazz Club',
  ]);
});

test('pasted text with hidden runs of spaces or tabs, or a broken link, is read at once', async () => {
  const { parseItinerary, parseTextList } = await import('../js/itineraryImport.js');
  const t0 = performance.now();
  parseTextList(`from${' '.repeat(2500)}!`);
  parseTextList(`de${' '.repeat(20000)}x`);
  parseItinerary(`https://example.com/x\nfrom${'\t'.repeat(20000)}.`);
  parseTextList(`from ${'x '.repeat(1000)}`);
  parseTextList(`from ${'a '.repeat(1000)}to b`);
  assert.ok(performance.now() - t0 < 300, `took ${Math.round(performance.now() - t0)} ms`);
  assert.deepEqual(parseTextList('Directions from   Louvre\t\tto  Eiffel Tower').stops.map((s) => s.name), ['Louvre', 'Eiffel Tower']);
  // A Google link with a broken %-code in its data part: no crash, the stops are still read.
  const broken = parseItinerary('https://www.google.com/maps/dir/Louvre/Eiffel+Tower/data=%E0%A4%A');
  assert.deepEqual(broken.stops.map((s) => s.name), ['Louvre', 'Eiffel Tower']);
});
