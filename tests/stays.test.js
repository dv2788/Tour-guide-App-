// Time at each stop: what the place deserves, and the time you have.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeSize, stayFor, visitFor, suggestRoute, spreadSpareTime, timeline, isPlaceToSee, interestScore } from '../js/suggest.js';

const LAT = 50.68;
const LON = 4.4;
const M_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
const at = (eastM, northM) => ({ lat: LAT + northM / 111320, lon: LON + eastM / M_LON });
const start = at(0, 0);
let id = 1;
const place = (title, description, eastM, northM, extra = {}) => ({ id: id++, title, description, length: 20000, langs: 10, thumbnail: 'x.jpg', ...at(eastM, northM), ...extra });

test('what a place is decides how long it deserves: a statue, a church, a cathedral, a viewpoint', () => {
  const statue = { title: 'Statue of a poet', description: 'Statue of an Azerbaijani poet', langs: 3 };
  const church = { title: 'Church of Saint Joseph', description: 'Church in Waterloo, Belgium', langs: 3 };
  const cathedral = { title: 'Cathedral of St. Michael', description: 'Cathedral in Brussels, Belgium', langs: 34 };
  const square = { title: 'Grand-Place', description: 'Square and UNESCO World Heritage Site in Brussels', langs: 54 };
  const park = { title: 'Parc de la Ciutadella', description: 'park in Barcelona', langs: 30 };
  const mound = { title: "Lion's Mound", description: "War memorial for the Battle of Waterloo in Braine-l'Alleud", langs: 17 };
  assert.deepEqual([statue, church, cathedral, square, park, mound].map(placeSize), ['small', 'building', 'big', 'open', 'open', 'big']);
  const walk = (p) => stayFor(p, 'walk', 240).base; // half a day: each place its due
  assert.ok(walk(statue) < walk(church) && walk(church) < walk(cathedral), `statue ${walk(statue)}, church ${walk(church)}, cathedral ${walk(cathedral)}`);
  assert.ok(walk(cathedral) >= 15 && walk(statue) <= 5);
  // Fame counts: the same kind of place, world-famous, deserves more.
  assert.ok(walk({ ...cathedral, langs: 95 }) > walk({ ...cathedral, langs: 2 }));
  // Half an hour: a quick look everywhere. Three hours: in between.
  assert.equal(stayFor(cathedral, 'walk', 30).base, 5);
  const three = stayFor(cathedral, 'walk', 180).base;
  assert.ok(three > 5 && three <= walk(cathedral), `three hours: ${three} min`);
  // By car, a statue is seen driving past; parking for a cathedral takes time. A runner doesn't linger.
  assert.ok(stayFor(statue, 'drive', 240).base < walk(statue));
  assert.ok(stayFor(cathedral, 'drive', 240).base > walk(cathedral));
  assert.equal(stayFor(cathedral, 'run', 240).base, 1);
  // On a hike, the view is what you came for.
  assert.ok(stayFor(park, 'hike', 240).max > stayFor(park, 'walk', 240).max);
  for (const p of [statue, church, cathedral, square, park, mound]) {
    const s = stayFor(p, 'walk', 240);
    assert.ok(s.max >= s.base, p.title);
  }
});

test('a great museum gets longer inside than a small one', () => {
  const louvre = { title: 'Louvre', description: 'art museum in Paris', langs: 100, length: 90000 };
  const small = { title: 'Wellington Museum', description: 'War museum in Waterloo', langs: 2, length: 2659 };
  assert.ok(visitFor(louvre, 60).base > visitFor(small, 60).base);
  assert.ok(visitFor(small, 75).base <= 45, 'a small museum never takes the whole morning');
  assert.ok(visitFor(louvre, 60).base % 5 === 0 && visitFor(louvre, 60).max <= 180);
});

test('not the same time at every stop: a castle longer than a statue on the same walk', () => {
  const candidates = [
    place('Castle of the Counts', 'medieval castle', 500, 0, { langs: 40 }),
    place('Statue of a General', 'statue of a general', 0, 500, { langs: 4 }),
    place('Saint Peter', 'church', -500, 0, { langs: 8 }),
    place('Market Square', 'square in the old town', 0, -500, { langs: 15 }),
  ];
  const r = suggestRoute({ start, candidates, modeId: 'walk', minutes: 180 });
  const stay = Object.fromEntries(r.stops.map((s) => [s.title, s.stayMinutes]));
  assert.equal(r.stops.length, 4, Object.keys(stay).join());
  assert.ok(new Set(Object.values(stay)).size > 1, `different times: ${JSON.stringify(stay)}`);
  assert.ok(stay['Castle of the Counts'] > stay['Statue of a General'], JSON.stringify(stay));
  assert.ok(stay['Market Square'] > stay['Statue of a General'], JSON.stringify(stay));
  // Few places and three hours: they get the time (up to what each deserves), and it all fits.
  assert.ok(r.minutes <= 180 && r.minutes >= 120, `uses the time: ${r.minutes} min`);
  assert.ok(stay['Statue of a General'] <= stayFor(candidates[1], 'walk', 180).max);
  for (const s of r.stops) assert.ok(s.stayMinutes < 10 || s.stayMinutes % 5 === 0, `"about ${s.stayMinutes} min": round numbers`);
  // The same places in an hour: shorter stays.
  const hour = suggestRoute({ start, candidates, modeId: 'walk', minutes: 60 });
  const castle = (route) => route.stops.find((s) => s.title === 'Castle of the Counts')?.stayMinutes ?? 0;
  assert.ok(castle(hour) < castle(r), `castle: ${castle(hour)} min in an hour, ${castle(r)} in three`);
  assert.ok(hour.minutes <= 60);
});

test('spare time goes to the best places first, never past what each deserves', () => {
  const stops = [
    { title: 'Big', score: 5.5, stayMinutes: 15, stayMax: 45, visitMinutes: null },
    { title: 'Small', score: 3.4, stayMinutes: 5, stayMax: 10, visitMinutes: null },
    { title: 'Museum', score: 4.5, stayMinutes: null, visitMinutes: 60, visitMax: 105 },
  ];
  const left = spreadSpareTime(stops, 40);
  assert.ok(stops[0].stayMinutes > 15 && stops[0].stayMinutes <= 45);
  assert.ok(stops[1].stayMinutes <= 10);
  assert.ok(stops[2].visitMinutes > 60 && stops[2].visitMinutes <= 105);
  assert.ok(stops[0].stayMinutes - 15 > stops[1].stayMinutes - 5, 'the best place gets more');
  const added = stops[0].stayMinutes - 15 + (stops[1].stayMinutes - 5) + (stops[2].visitMinutes - 60);
  assert.ok(added <= 40, `never more than the spare time (${added})`);
  assert.ok(left >= 0);
  // No room anywhere: nothing changes.
  const full = [{ title: 'x', score: 4, stayMinutes: 10, stayMax: 10, visitMinutes: null }];
  spreadSpareTime(full, 30);
  assert.equal(full[0].stayMinutes, 10);
});

test('the timeline counts each stop’s own time', () => {
  const a = { ...at(0, 300), stayMinutes: 25 };
  const b = { ...at(0, 600), stayMinutes: 5 };
  const { times } = timeline(start, [a, b], 'walk', false);
  assert.equal(times[0].leave - times[0].arrive, 25);
  assert.equal(times[1].leave - times[1].arrive, 5);
});

test('Waterloo: memorials of the battle and the Panorama are places to see (the battle itself is not)', () => {
  const mound = { title: "Lion's Mound", description: "War memorial for the Battle of Waterloo in Braine-l'Alleud, Wallonia, Belgium", length: 16487, langs: 17 };
  const gordon = { title: 'Gordon Monument', description: 'Memorial of the Battle of Waterloo', length: 5631, langs: 1 };
  const panorama = { title: 'Panorama of the Battle of Waterloo', description: 'Painting by Louis Dumoulin in a rotunda by Franz Van Ophem', length: 4004, langs: 9 };
  for (const p of [mound, gordon, panorama]) assert.ok(isPlaceToSee(p), p.title);
  assert.ok(Number.isFinite(interestScore(mound)) && interestScore(mound) > 4, 'the Lion’s Mound is a top stop');
  assert.ok(!isPlaceToSee({ title: 'Battle of Waterloo', description: '1815 battle of the Waterloo campaign', coordType: 'event' }));
  assert.ok(!isPlaceToSee({ title: 'Siege of Paris', description: 'battle of the Franco-Prussian War' }));
  assert.ok(!isPlaceToSee({ title: 'The Night Watch', description: 'Painting by Rembrandt held in the Rijksmuseum' }), 'a painting in a collection still is not');
  // Not stops: an embassy, an institution.
  assert.ok(!isPlaceToSee({ title: 'Embassy of Ukraine, Brussels', description: 'Diplomatic mission of Ukraine in Brussels, Belgium' }));
  assert.ok(!isPlaceToSee({ title: 'European Committee of the Regions', description: 'Institution of the European Union' }));
});
