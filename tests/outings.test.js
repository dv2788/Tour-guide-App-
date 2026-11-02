import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeThemes, isPlaceToSee, interestScore, proposeOutings, proposalTitle, breakSchedule, foodQuery, findFoodNear, museumVisits, timeline, PACE, DURATIONS } from '../js/suggest.js';
import { MODES } from '../js/modes.js';
import { mapsLink } from '../js/navigation.js';
import { cleanSaved } from '../js/saved.js';

const START = { lat: 41.3874, lon: 2.1686 };
const M_LAT = 1 / 111320;
const M_LON = 1 / (111320 * Math.cos((START.lat * Math.PI) / 180));
let nextId = 1;
/** A Wikipedia place `east` and `north` metres from the start. */
const place = (title, description, east, north, langs = 25, length = 9000) => ({
  id: nextId++,
  title,
  description,
  lat: START.lat + north * M_LAT,
  lon: START.lon + east * M_LON,
  langs,
  length,
});

test('places are sorted into history, culture, landscapes and food, in five languages', () => {
  const themes = (title, description) => [...placeThemes({ title, description })].sort();
  assert.deepEqual(themes('Park Güell', 'public park in Barcelona'), ['landscape']);
  assert.deepEqual(themes('Montjuïc', 'hill in Barcelona'), ['landscape']);
  assert.deepEqual(themes('Mercado de San Miguel', 'mercado en Madrid'), ['food', 'history']);
  assert.deepEqual(themes('Teatro Colón', 'opera house in Buenos Aires'), ['culture', 'history']);
  assert.deepEqual(themes('Fundació Joan Miró', 'art museum in Barcelona'), ['culture']);
  assert.deepEqual(themes('Lac Léman', 'lac en Suisse et en France'), ['landscape']);
  assert.deepEqual(themes('Cascata delle Marmore', 'cascata in Umbria'), ['landscape']);
  assert.deepEqual(themes('Englischer Garten', 'Park in München'), ['landscape']);
  assert.deepEqual(themes('Café de Flore', 'café in Paris'), ['food']);
  // Parks that aren't landscapes.
  for (const [title, description] of [['Parc des Princes', 'football stadium in Paris'], ['Silicon Park', 'business park in Bristol'], ['Park Hyatt', 'hotel in Tokyo'], ['PortAventura Park', 'theme park in Spain']]) {
    assert.ok(!placeThemes({ title, description }).has('landscape'), title);
  }
});

test('on a landscape outing, a lake, a bay or a mountain is a place to go', () => {
  const lake = { title: 'Lake Bled', description: 'lake in Slovenia', coordType: 'waterbody' };
  const peak = { title: 'Mount Tibidabo', description: 'mountain overlooking Barcelona', coordType: 'mountain' };
  const river = { title: 'Llobregat', description: 'river in Catalonia', coordType: 'river' };
  assert.equal(isPlaceToSee(lake), false, 'not on an ordinary walk');
  assert.equal(isPlaceToSee(lake, { nature: true }), true);
  assert.equal(isPlaceToSee(peak, { nature: true }), true);
  assert.equal(isPlaceToSee(river, { nature: true }), false, 'a river is a line, not a place');
  // Still not a city, an event or an organisation, whatever the interest.
  assert.equal(isPlaceToSee({ title: 'Barcelona', description: 'city in Spain', coordType: 'city' }, { nature: true }), false);
});

test('what you came for rises, the rest sinks', () => {
  const park = { title: 'Parc de la Ciutadella', description: 'park in Barcelona', length: 9000, langs: 30 };
  const church = { title: 'Santa Maria del Pi', description: 'church in Barcelona', length: 9000, langs: 30 };
  assert.ok(interestScore(park, { interests: ['landscape'] }) > interestScore(church, { interests: ['landscape'] }) + 2);
  assert.ok(interestScore(church, { interests: ['history'] }) > interestScore(park, { interests: ['history'] }) + 2);
  // A short article is enough for a viewpoint on a landscape outing, not otherwise.
  const viewpoint = { title: 'Mirador del Alcalde', description: 'viewpoint in Barcelona', length: 1800, langs: 3 };
  assert.equal(interestScore(viewpoint), -Infinity);
  assert.ok(Number.isFinite(interestScore(viewpoint, { interests: ['landscape'] })));
  // No interests: exactly as before.
  assert.equal(interestScore(church), interestScore(church, { interests: [] }));
});

// Around the start: history to the north, landscapes to the south, culture east, food west.
const CANDIDATES = [
  place('Cathedral', 'cathedral in the city', 0, 700),
  place('Old Castle', 'castle in the city', 300, 1100),
  place('Royal Palace', 'palace in the city', -300, 1200),
  place('Roman Walls', 'Roman ruins in the city', 200, 1500),
  place('Old Bridge', 'medieval bridge over the river', -100, 1700),
  place('City Park', 'public park in the city', 0, -700),
  place('Botanical Garden', 'botanical garden in the city', 300, -1100),
  place('Sunset Viewpoint', 'viewpoint over the city', -300, -1200),
  place('Hill of the Winds', 'hill in the city', 200, -1500),
  place('Sea Beach', 'beach in the city', -100, -1700),
  place('Art Museum', 'art museum in the city', 800, 0),
  place('Opera House', 'opera house in the city', 1100, 300),
  place('Modern Gallery', 'gallery of modern art', 1200, -300),
  place('Central Market', 'covered market in the city', -800, 0),
  place('Old Café', 'historic café in the city', -1100, 300),
  // More nature further out, for a second landscapes route.
  place('Pine Forest', 'forest above the city', 1600, -1600),
  place('Lighthouse Cliffs', 'cliffs on the coast', 1900, -1300),
  place('Lagoon', 'lagoon by the sea', -1700, -1500),
  place('Rose Garden', 'rose garden in the city', -1900, -1100),
  place('North Hill', 'hill above the city', 1700, 1900),
];

test('no interest picked: one route through the best-known places, as before', () => {
  const proposals = proposeOutings({ start: START, candidates: CANDIDATES, minutes: 60, startedAt: new Date(2026, 10, 2, 10) });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].title, 'The best-known places');
  assert.ok(proposals[0].route.stops.length >= 1);
});

test('one interest: its best route, another through different places, and one with a companion', () => {
  const proposals = proposeOutings({ start: START, candidates: CANDIDATES, minutes: 120, startedAt: new Date(2026, 10, 2, 10), interests: ['landscape'] });
  assert.deepEqual(proposals.map((p) => p.title), ['Parks, views and nature', 'More nature, other views', 'History and landscapes']);
  const [first, second, third] = proposals;
  const themesOf = (p) => p.route.stops.map((s) => [...placeThemes(s)]);
  assert.ok(themesOf(first).every((t) => t.includes('landscape')), JSON.stringify(themesOf(first)));
  const firstIds = new Set(first.route.stops.map((s) => s.id));
  assert.ok(second.route.stops.every((s) => !firstIds.has(s.id)), 'the second goes to other places');
  assert.ok(second.alternative);
  // The companion route has both.
  const mixed = new Set(themesOf(third).flat());
  assert.ok(mixed.has('history') && mixed.has('landscape'), JSON.stringify(themesOf(third)));
});

test('several interests: all of them together first, then each on its own; never two near-copies', () => {
  const proposals = proposeOutings({ start: START, candidates: CANDIDATES, minutes: 180, startedAt: new Date(2026, 10, 2, 10), interests: ['landscape', 'history'] });
  assert.equal(proposals[0].title, 'History and landscapes');
  assert.deepEqual(proposals.slice(1).map((p) => p.title), ['History and monuments', 'Parks, views and nature']);
  // Together means both.
  const together = new Set(proposals[0].route.stops.flatMap((s) => [...placeThemes(s)]));
  assert.ok(together.has('history') && together.has('landscape'));
  for (let i = 0; i < proposals.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = new Set(proposals[i].route.stops.map((s) => s.id));
      const b = proposals[j].route.stops.map((s) => s.id);
      const shared = b.filter((id) => a.has(id)).length / Math.max(a.size, b.length);
      assert.ok(shared < 0.7, `${proposals[i].title} vs ${proposals[j].title}: ${shared}`);
    }
  }
  assert.equal(proposalTitle(['history', 'culture', 'food']), 'History, culture and food');
  // An itinerary named after an interest is mostly about it: once the food places are used,
  // "More flavours" isn't offered with a famous cathedral instead.
  const famous = [...CANDIDATES.filter((c) => !placeThemes(c).has('food')), { ...place('Grand Basilica', 'basilica, the city landmark', 400, 400), langs: 120, length: 90000 }];
  const foodOnly = proposeOutings({ start: START, candidates: [...famous, place('Night Market', 'market in the city', -300, 0)], minutes: 120, startedAt: new Date(2026, 10, 2, 10), interests: ['food'] });
  assert.ok(!foodOnly.some((p) => p.alternative), JSON.stringify(foodOnly.map((p) => [p.title, p.route.stops.map((s) => s.title)])));
  // Nothing of the kind around: no empty itinerary is offered.
  const none = proposeOutings({ start: START, candidates: CANDIDATES.filter((c) => !placeThemes(c).has('landscape')), minutes: 60, interests: ['landscape'] });
  assert.ok(none.every((p) => p.route.stops.length > 0));
});

test('a food outing tastes something about every hour', () => {
  const day = new Date(2026, 10, 2, 9, 30);
  const usual = breakSchedule(day, 360);
  const food = breakSchedule(day, 360, { food: true });
  assert.ok(food.length > usual.length, `${food.length} > ${usual.length}`);
  assert.ok(food.some((b) => b.meal === 'taste'));
  assert.ok(food.some((b) => b.meal === 'lunch'), 'lunch stays lunch');
  const proposals = proposeOutings({ start: START, candidates: CANDIDATES, minutes: 240, startedAt: day, interests: ['food'] });
  assert.ok(proposals[0].schedule.some((b) => b.meal === 'taste'));
});

test('tasting stops look for bakeries and pastry shops as well as markets and ice cream', async () => {
  const query = foodQuery(['marketplace', 'bakery', 'pastry', 'ice_cream', 'cafe'], START, 400);
  assert.match(query, /nwr\["amenity"~"\^\(marketplace\|ice_cream\|cafe\)\$"\]/);
  assert.match(query, /nwr\["shop"~"\^\(bakery\|pastry\)\$"\]/);
  assert.match(foodQuery(['cafe'], START, 400), /^\[out:json\]\[timeout:10\];\(nwr\["amenity"~"\^\(cafe\)\$"\]\["name"\]\(around:400,41\.38740,2\.16860\);\);out center tags 60;$/);
  const fetchImpl = async () => ({ ok: true, json: async () => ({ elements: [{ type: 'node', lat: START.lat, lon: START.lon, tags: { name: 'Forn Baluard', shop: 'bakery' } }] }) });
  const found = await findFoodNear(START, 'taste', { fetchImpl });
  assert.deepEqual(found.map((p) => [p.name, p.amenity]), [['Forn Baluard', 'bakery']]);
});

test('a hike: slower on the paths, no museum visits, walking directions', () => {
  assert.equal(MODES.hike.routeProfile, 'foot');
  assert.ok(PACE.hike.kmh < PACE.walk.kmh);
  const stops = [place('A', 'hill', 0, 2000), place('B', 'lake', 1500, 2000)];
  assert.ok(timeline(START, stops, 'hike').minutes > timeline(START, stops, 'walk').minutes);
  assert.equal(museumVisits('hike', 480).count, 0);
  assert.equal(museumVisits('walk', 480, ['landscape']).count, 0, 'no museum on a landscapes-only walk');
  assert.ok(museumVisits('walk', 480, ['culture']).count > 0);
  assert.match(mapsLink({ lat: 1, lon: 2 }, 'hike'), /travelmode=walking/);
});

test('more lengths of outing, and interests are remembered (only the ones offered)', () => {
  assert.deepEqual(DURATIONS.map((d) => d.minutes), [30, 45, 60, 90, 120, 180, 240, 360, 480, 600]);
  const saved = cleanSaved({ interests: ['landscape', 'food', 'landscape', '<b>', 7], mode: 'hike' }, { interests: ['history', 'culture', 'landscape', 'food'], mode: Object.keys(MODES) });
  assert.deepEqual(saved.interests, ['landscape', 'food']);
  assert.equal(saved.mode, 'hike');
});
