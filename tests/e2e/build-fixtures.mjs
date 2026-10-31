// Records real answers from OpenStreetMap and Wikipedia for the sample Paris walk,
// so the browser smoke test runs offline and deterministically.
// Usage: node tests/e2e/build-fixtures.mjs
import { writeFile } from 'node:fs/promises';
import { pickBestResult } from '../../js/geocode.js';

const UA = 'TourGuideApp-tests/0.1 (https://github.com/dv2788/Tour-guide-App-)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const CITY = 'Paris';
const STOPS = ['Eiffel Tower', "Pont de l'Alma", 'Grand Palais', 'Place de la Concorde', 'Louvre Museum'];
// Real articles along the route, used to fake Wikipedia's "what's nearby" search.
const PLACES = [
  'Musée du quai Branly – Jacques Chirac', 'Champ de Mars', 'Bir-Hakeim station', 'Flame of Liberty',
  'Avenue Montaigne', 'Palais de Tokyo', 'Pont des Invalides', 'Pont Alexandre III', 'Petit Palais',
  'Avenue Winston-Churchill', 'Hôtel des Invalides', 'Palais Bourbon', 'Luxor Obelisk', 'Fontaine des Mers',
  'Hôtel de la Marine', "Musée de l'Orangerie", 'Jeu de Paume', 'Tuileries Garden', 'Musée d\'Orsay',
  'Arc de Triomphe du Carrousel', 'Louvre Pyramid', 'Pont Royal', 'Pont de la Concorde', 'Hôtel de Crillon',
  "Pont de l'Alma station", 'Grand Palais (Paris)',
];

const nominatim = {};
for (const q of [CITY, ...STOPS]) {
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', extratags: '1', 'accept-language': 'en' });
  if (q === CITY) params.set('featureType', 'city');
  nominatim[q] = await json(`https://nominatim.openstreetmap.org/search?${params}`);
  await sleep(1100);
}

const stopCoords = STOPS.map((q) => pickBestResult(nominatim[q], q)).map((r) => `${(+r.lon).toFixed(6)},${(+r.lat).toFixed(6)}`);
const route = await json(
  `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${stopCoords.join(';')}?overview=full&geometries=geojson&steps=false`,
);

const summaries = {};
for (const title of [CITY, ...STOPS, ...PLACES]) {
  try {
    summaries[title] = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  } catch (e) {
    console.warn('skip', title, e.message);
  }
  await sleep(250);
}
// The app asks for an article by its exact title (after OSM tags/redirects); index by canonical title too.
for (const s of Object.values(summaries)) summaries[s.title] = s;

const geosearch = Object.values(summaries)
  .filter((s, i, all) => s.coordinates && all.findIndex((o) => o.pageid === s.pageid) === i && s.title !== 'Paris')
  .map((s) => ({
    pageid: s.pageid,
    title: s.title,
    coordinates: [{ lat: s.coordinates.lat, lon: s.coordinates.lon, primary: true, globe: 'earth' }],
    description: s.description,
    thumbnail: s.thumbnail ? { source: s.thumbnail.source, width: s.thumbnail.width, height: s.thumbnail.height } : undefined,
  }));

await writeFile(
  new URL('./fixtures.json', import.meta.url),
  JSON.stringify({ nominatim, route, summaries, geosearch }, null, 1),
);
console.log(`saved ${Object.keys(nominatim).length} places, a ${Math.round(route.routes[0].distance)} m route, ${Object.keys(summaries).length} summaries, ${geosearch.length} nearby articles`);
