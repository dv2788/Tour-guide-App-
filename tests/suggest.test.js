import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interestScore,
  placeKind,
  suggestRoute,
  breakSchedule,
  mealAt,
  placeBreaks,
  addBreaks,
  pickFoodPlace,
  timeline,
  searchRadiusFor,
  museumVisits,
  findFoodNear,
} from '../js/suggest.js';
import { distanceMeters } from '../js/geo.js';

const LAT = 48.86;
const LON = 2.33;
const M_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
const at = (eastM, northM) => ({ lat: LAT + northM / 111320, lon: LON + eastM / M_LON });
const start = at(0, 0);
let nextId = 1;
const place = (title, description, length, eastM, northM, extra = {}) => ({
  id: nextId++,
  title,
  description,
  length,
  thumbnail: 'x.jpg',
  category: null,
  ...at(eastM, northM),
  ...extra,
});

test('placeKind and interestScore favour history and rich articles, drop areas and filler', () => {
  assert.equal(placeKind({ title: 'Louvre', description: 'art museum in Paris' }), 'museum');
  assert.equal(placeKind({ title: 'Sainte-Chapelle', description: 'Gothic chapel in Paris' }), 'historic');
  assert.equal(placeKind({ title: 'Kölner Dom', description: 'Kathedrale in Köln' }), 'historic');
  assert.equal(placeKind({ title: 'Some Shop', description: 'shop' }), 'sight');
  const church = interestScore({ title: 'Saint-Eustache', description: 'church in Paris', length: 40000 });
  const shop = interestScore({ title: 'Some Shop', description: 'department store', length: 40000 });
  assert.ok(church > shop, 'historic kinds get a boost');
  assert.ok(interestScore({ title: 'X', description: 'church', length: 120000 }) > church, 'longer article, more to tell');
  assert.equal(interestScore({ title: '1st arrondissement of Paris', description: 'arrondissement of Paris', length: 90000 }), -Infinity);
  assert.equal(interestScore({ title: 'Seine', description: 'river in France', length: 90000 }), -Infinity);
  assert.equal(interestScore({ title: 'Station', description: 'metro station', category: 'skip' }), -Infinity);
});

test('a 70-minute walk picks the best places that fit, in an untangled loop', () => {
  const candidates = [
    place('Big Cathedral', 'cathedral', 150000, 600, 200),
    place('Old Palace', 'royal palace', 120000, -500, 300),
    place('Famous Bridge', 'bridge over the river', 60000, 300, -200),
    place('Tiny Plaque', 'memorial plaque', 2000, 50, 50),
    place('Far Castle', 'castle', 200000, 6000, 6000), // too far for an hour
    place('Old Palace Gardens', 'garden of the Old Palace', 30000, -520, 320), // near-duplicate
  ];
  const r = suggestRoute({ start, candidates, modeId: 'walk', minutes: 70, loop: true });
  const titles = r.stops.map((s) => s.title);
  assert.ok(titles.includes('Big Cathedral') && titles.includes('Old Palace') && titles.includes('Famous Bridge'), titles.join());
  assert.ok(!titles.includes('Far Castle'), 'out of reach');
  assert.ok(!titles.includes('Old Palace Gardens'), 'near-duplicates skipped');
  assert.ok(!titles.includes('Tiny Plaque'), 'stubs skipped: too little to tell');
  assert.ok(r.minutes <= 70, `fits in the time (${r.minutes} min)`);
  // Untangled: visiting in the returned order is no longer than the reverse-crossing order.
  const pts = [start, ...r.stops, start];
  for (let i = 1; i < pts.length - 2; i++) {
    for (let j = i + 1; j < pts.length - 1; j++) {
      const before = distanceMeters(pts[i - 1], pts[i]) + distanceMeters(pts[j], pts[j + 1]);
      const after = distanceMeters(pts[i - 1], pts[j]) + distanceMeters(pts[i], pts[j + 1]);
      assert.ok(before <= after + 1e-6, 'no crossing legs');
    }
  }
});

test('museums become visits (with time to go inside) on longer outings, never while running', () => {
  const candidates = [place('Grand Museum', 'art museum', 160000, 400, 0), place('Old Church', 'church', 50000, 0, 400)];
  const short = suggestRoute({ start, candidates, modeId: 'walk', minutes: 60 });
  assert.equal(short.stops.find((s) => s.title === 'Grand Museum')?.visitMinutes ?? null, null, 'no time to go inside in an hour');
  const half = suggestRoute({ start, candidates, modeId: 'walk', minutes: 240 });
  assert.equal(half.stops.find((s) => s.title === 'Grand Museum').visitMinutes, 60);
  assert.ok(half.minutes >= 60, 'the visit time is counted');
  assert.equal(museumVisits('run', 480).count, 0);
  assert.equal(museumVisits('walk', 480).count, 2);
});

test('museum visits come first and win over a lesser neighbour with the same name', () => {
  const candidates = [
    place('Louvre Pyramid', 'glass pyramid in the courtyard of the Louvre Palace', 40000, 900, 0),
    place('Louvre', 'art museum', 30000, 950, 50),
    place('Old Church', 'church', 60000, 0, 300),
    place('Old Bridge', 'bridge', 60000, 300, 0),
  ];
  const r = suggestRoute({ start, candidates, modeId: 'walk', minutes: 240, reservedMinutes: 80 });
  const titles = r.stops.map((s) => s.title);
  assert.ok(titles.includes('Louvre'), titles.join());
  assert.equal(r.stops.find((s) => s.title === 'Louvre').visitMinutes, 60);
  assert.ok(!titles.includes('Louvre Pyramid'), 'the museum, not its courtyard');
});

test('the museum visit is one within reach, so a half day still has time for everything else', () => {
  // Lisbon: the famous museum 2.5 km away, a cluster of sights around you, a nearer museum.
  const sights = ['Cathedral', 'Castle', 'Old Convent', 'Triumphal Arch', 'Royal Square', 'Opera House'].map((name, i) =>
    place(name, 'historic church and monument', 60000, (i % 3) * 300 - 300, Math.floor(i / 3) * 300 - 150, { langs: 50 }),
  );
  const far = place('Great Museum of Ancient Art', 'art museum', 90000, -2500, 0, { langs: 60 });
  const near = place('City Museum', 'history museum', 30000, 400, 300, { langs: 15 });
  const r = suggestRoute({ start, candidates: [...sights, far, near], modeId: 'walk', minutes: 240, reservedMinutes: 80 });
  const titles = r.stops.map((s) => s.title);
  assert.ok(!titles.includes(far.title) || r.stops.find((s) => s.title === far.title).visitMinutes == null, 'no hour inside the far museum');
  assert.equal(r.stops.find((s) => s.title === 'City Museum')?.visitMinutes, 60, 'the museum within reach is the visit');
  const hour = suggestRoute({ start, candidates: [...sights, far, near], modeId: 'walk', minutes: 60 });
  assert.ok(r.stops.length >= hour.stops.length, `a half day (${titles.join(', ')}) has at least the stops of an hour (${hour.stops.map((s) => s.title).join(', ')})`);
});

test('breaks follow the clock: coffee, lunch, a drink, dinner', () => {
  const d = (h, m = 0) => new Date(2026, 9, 31, h, m);
  assert.equal(mealAt(d(10)), 'coffee');
  assert.equal(mealAt(d(12, 30)), 'lunch');
  assert.equal(mealAt(d(15)), 'coffee');
  assert.equal(mealAt(d(18)), 'drink');
  assert.equal(mealAt(d(20)), 'dinner');
  assert.deepEqual(breakSchedule(d(10), 60), [], 'no break in a short outing');
  assert.deepEqual(breakSchedule(d(10), 120).map((b) => b.meal), ['coffee']);
  const half = breakSchedule(d(10, 30), 240);
  assert.deepEqual(half.map((b) => b.meal), ['coffee', 'lunch']);
  assert.equal(half[1].atMinute, 120, 'lunch at 12:30');
  const day = breakSchedule(d(10), 480);
  assert.deepEqual(day.map((b) => b.meal), ['coffee', 'lunch', 'coffee']);
  assert.deepEqual(day.map((b) => b.minutes), [20, 60, 20]);
  const evening = breakSchedule(d(16), 300);
  assert.deepEqual(evening.map((b) => b.meal), ['drink', 'dinner']);
  assert.equal(evening[1].atMinute, 225, 'dinner at 19:45');
  // Setting off just after noon: lunch half an hour in, not skipped.
  const noon = breakSchedule(d(12, 2), 240);
  assert.equal(noon[0].meal, 'lunch');
  assert.equal(noon[0].atMinute, 30);
  assert.deepEqual(breakSchedule(d(13), 180).map((b) => [b.meal, b.atMinute])[0], ['lunch', 30], 'lunch at 13:30');
  assert.ok(!breakSchedule(d(14, 30), 180).some((b) => b.meal === 'lunch'), 'too late for lunch');
  // An hour's walk at lunch or dinner time is a walk: a meal would leave no time to see anything.
  assert.deepEqual(breakSchedule(d(12), 60), [], 'no lunch in a one-hour outing');
  assert.deepEqual(breakSchedule(d(20), 60), [], 'no dinner in a one-hour outing');
  assert.ok(!breakSchedule(d(19, 30), 120).some((b) => b.meal === 'dinner'), 'no 75-minute dinner in a two-hour outing');
  assert.deepEqual(breakSchedule(d(12), 120).map((b) => b.meal), ['lunch'], 'lunch fits in two hours, with an hour to see things');
});

test('an hour out at dinner time still finds places to see', () => {
  const candidates = [place('Old Church', 'church', 60000, 200, 100), place('Old Bridge', 'bridge', 60000, -300, 100)];
  const evening = new Date(2026, 9, 31, 20, 0);
  const reserved = breakSchedule(evening, 60).reduce((n, b) => n + b.minutes, 0);
  const r = suggestRoute({ start, candidates, modeId: 'walk', minutes: 60, loop: true, reservedMinutes: reserved });
  assert.ok(r.stops.length >= 2, r.stops.map((s) => s.title).join());
});

test('food places: the right kind, close by, notable ones first', () => {
  const here = at(0, 0);
  const places = [
    { name: 'Chain Coffee', amenity: 'cafe', ...at(20, 0), tags: {} },
    { name: 'Historic Tea Room', amenity: 'cafe', ...at(150, 0), tags: { wikidata: 'Q1', website: 'x', opening_hours: 'x' } },
    { name: 'Far Café', amenity: 'cafe', ...at(2000, 0), tags: { wikidata: 'Q2' } },
    { name: 'Bistro', amenity: 'restaurant', ...at(60, 0), tags: { cuisine: 'french', opening_hours: 'x' } },
    { name: 'Pub', amenity: 'pub', ...at(30, 0), tags: {} },
  ];
  assert.equal(pickFoodPlace(places, 'coffee', here).name, 'Historic Tea Room');
  assert.equal(pickFoodPlace(places, 'lunch', here).name, 'Bistro', 'a restaurant for lunch');
  assert.equal(pickFoodPlace(places, 'drink', here).name, 'Pub');
  assert.equal(pickFoodPlace(places, 'dinner', here, { avoid: ['Bistro'] }), null);
});

test('breaks are slotted after the stop closest to the planned time', () => {
  const stops = [place('A', 'church', 9000, 300, 0), place('B', 'church', 9000, 600, 0), place('C', 'church', 9000, 900, 0)];
  const { times } = timeline(start, stops, 'walk', true);
  const placed = placeBreaks(start, stops, [{ atMinute: times[1].leave, meal: 'coffee', minutes: 20 }], 'walk', true);
  assert.equal(placed[0].afterIndex, 1);
  const withBreak = addBreaks(stops, [{ ...placed[0], place: { name: 'Café X', lat: LAT, lon: LON, amenity: 'cafe', tags: {} } }]);
  assert.deepEqual(withBreak.map((s) => s.title), ['A', 'B', 'Café X', 'C']);
  assert.equal(withBreak[2].kind, 'food');
  assert.equal(withBreak[2].breakMinutes, 20);
  assert.ok(searchRadiusFor('walk', 60) >= 1000 && searchRadiusFor('drive', 480) === 10000);
});

test('findFoodNear uses Overpass, and the place search when Overpass is down', async () => {
  const overpass = async () => ({ ok: true, json: async () => ({ elements: [{ type: 'node', lat: LAT, lon: LON, tags: { name: 'Angelina', amenity: 'cafe', wikidata: 'Q2851097' } }] }) });
  const found = await findFoodNear(start, 'coffee', { fetchImpl: overpass });
  assert.deepEqual(found.map((p) => p.name), ['Angelina']);
  const down = async () => {
    throw new Error('offline');
  };
  const geocoder = { searchNearby: async (kind) => (kind === 'cafe' ? [{ name: 'Fallback Café', lat: LAT, lon: LON, amenity: 'cafe', tags: {} }] : []) };
  const fallback = await findFoodNear(start, 'coffee', { fetchImpl: down, geocoder });
  assert.deepEqual(fallback.map((p) => p.name), ['Fallback Café']);
});

test('fame comes first: places many languages write about beat long articles about lesser ones', () => {
  const famous = interestScore({ title: 'Empire State Building', description: 'Office skyscraper in Manhattan', length: 250000, langs: 117 });
  const tower = interestScore({ title: 'One Astor Plaza', description: 'Office skyscraper in Manhattan', length: 170000, langs: 20 });
  const church = interestScore({ title: 'Corner Church', description: 'church in Paris', length: 6000, langs: 4 });
  assert.ok(famous > tower + 0.5 && tower > church + 1, `${famous} > ${tower} > ${church}`);
});

test('organisations, events, places that are gone and objects in a collection are not stops', () => {
  const ok = (description, extra = {}) => Number.isFinite(interestScore({ title: 'X', description, length: 50000, langs: 40, ...extra }));
  assert.ok(!ok('British intelligence agency'), 'an agency');
  assert.ok(!ok('Multi-sport event in Barcelona, Spain'), 'an event');
  assert.ok(!ok('Storming of the Tuileries Palace in Paris during the French Revolution'), 'a historic event');
  assert.ok(!ok('Assault conducted by Spanish officers'), 'an incident');
  // Descriptions come in the reader's language.
  assert.ok(!ok('attentat terroriste à Paris en 2015') && !ok('bataille de la Seconde Guerre mondiale') && !ok('épisode de la Seconde Guerre mondiale du 19 au 25 août 1944'), 'French events');
  assert.ok(!ok('ancienne ville gallo-romaine') && !ok('cité gallo-romaine, actuelle Paris') && !ok('barrio de Madrid'), 'French and Spanish areas');
  assert.ok(!ok('Universität in Berlin') && !ok('partito politico italiano') && !ok('agence gouvernementale française'), 'organisations in other languages');
  assert.ok(!ok('région fédérale de Belgique incluant la ville de Bruxelles'), 'a region');
  assert.ok(ok('cathédrale gothique à Paris') && ok('museo de arte en Madrid') && ok('Kirche in Berlin') && ok('basilica di Roma'), 'real places in other languages stay');
  assert.ok(!ok('Royal and imperial palace in Paris (1564–1883)'), 'demolished');
  assert.ok(!ok('Roman Catholic cathedral in Bruges, Belgium', { gone: true }), 'demolished, as Wikidata says, though the description doesn\'t');
  assert.ok(!ok('Government of France from 1792 to 1804'), 'a former government');
  assert.ok(!ok('Ancient Greek sculptures held in London'), 'inside a museum');
  assert.ok(!ok('Capital of England and the United Kingdom'), 'a whole city');
  assert.ok(!ok('Area of central London') && !ok('Human settlement in England'), 'areas');
  assert.ok(!ok('Medieval state', { title: 'Principality of Catalonia' }), 'a former state');
  assert.ok(!ok('', { title: 'Parliament of the United Kingdom' }), 'an institution');
  assert.ok(!ok('Railway station in Paris', { coordType: 'railwaystation', langs: 10 }), 'an ordinary station');
  assert.ok(ok('Railway terminal in Manhattan, New York', { coordType: 'railwaystation', langs: 50 }), 'a landmark station');
  assert.ok(ok('State opera house in Vienna') && ok('War memorial in London') && ok('Office skyscraper in Manhattan'), 'real places stay');
});

test('a must-see a little further away beats a cluster of minor places, and the walk still fills up', () => {
  // Different names, or they would count as one place ("Little Church 1" and "Little Church 2").
  const names = ['Annunziata', 'Blasius', 'Cyriacus', 'Dionysius', 'Eligius', 'Fiacrius', 'Gilles', 'Hilarius'];
  const minor = names.map((name, i) => place(name, 'church', 6000, 150 + 60 * i, 120 * (i % 2), { langs: 3 }));
  const candidates = [...minor, place('Great Cathedral', 'Gothic cathedral', 120000, 0, 1100, { langs: 90 })];
  const r = suggestRoute({ start, candidates, modeId: 'walk', minutes: 90, loop: true });
  const titles = r.stops.map((s) => s.title);
  assert.ok(titles.includes('Great Cathedral'), titles.join());
  assert.ok(titles.filter((t) => names.includes(t)).length >= 3, `and nearby places too: ${titles.join()}`);
  assert.ok(r.minutes <= 90, `fits (${r.minutes} min)`);
});

test('areas are recognised by what they are, not by words further on', () => {
  assert.equal(interestScore({ title: 'Seine', description: 'major river in France', length: 90000 }), -Infinity);
  assert.equal(interestScore({ title: 'Champs-Élysées', description: 'avenue in Paris', length: 90000 }), -Infinity);
  assert.ok(Number.isFinite(interestScore({ title: 'Pont Neuf', description: 'bridge over the Seine river in Paris', length: 40000 })));
  assert.ok(Number.isFinite(interestScore({ title: 'Place des Vosges', description: 'public square in Paris', length: 40000 })));
});

test('food picks skip places closed during the break, prefer independents, and offer alternatives', async () => {
  const { pickFoodPlaces } = await import('../js/suggest.js');
  const here = at(0, 0);
  const monday1pm = new Date(2026, 10, 2, 13, 0);
  const places = [
    { name: 'Closed Bistro', amenity: 'restaurant', ...at(30, 0), tags: { opening_hours: 'Mo off; Tu-Su 12:00-22:00' } },
    { name: 'Burger Chain', amenity: 'restaurant', ...at(20, 0), tags: { brand: 'Burger Chain', opening_hours: '24/7' } },
    { name: 'Chez Marie', amenity: 'restaurant', ...at(120, 0), tags: { opening_hours: 'Mo-Su 12:00-15:00', cuisine: 'french' } },
    { name: 'La Table', amenity: 'restaurant', ...at(200, 0), tags: {} },
  ];
  const picks = pickFoodPlaces(places, 'lunch', here, { when: monday1pm, minutes: 60 });
  assert.deepEqual(picks.map((p) => p.name), ['Chez Marie', 'La Table', 'Burger Chain']);
  assert.equal(picks[0].open, true);
  assert.equal(picks[0].closes, 15 * 60);
  assert.equal(picks[1].open, null, 'hours unknown, but kept as an alternative');
  assert.ok(!picks.some((p) => p.name === 'Closed Bistro'));
});
