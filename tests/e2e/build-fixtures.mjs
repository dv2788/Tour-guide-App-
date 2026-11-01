// Records real answers from OpenStreetMap (place search) and Wikipedia for the sample
// Barcelona walk, so the browser tests run offline and deterministically. (Routes are not
// recorded here: the tests use the real routing service, see mocks.cjs.)
// Usage: node tests/e2e/build-fixtures.mjs
import { writeFile } from 'node:fs/promises';

const UA = 'TourGuideApp-tests/0.1 (https://github.com/dv2788/Tour-guide-App-)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt >= 6) throw new Error(`${res.status} ${url}`);
    await sleep(3000 * 2 ** attempt); // rate limited: wait and try again
  }
}

const CITY = 'Barcelona';
// The sample walk: from Gaudí's Casa Batlló down through the old town.
const STOPS = ['Casa Batlló', 'Plaça de Catalunya', 'La Boqueria', 'Plaça Reial', 'Barcelona Cathedral', 'Santa Maria del Mar'];
// The stops of the Google Maps link pasted in the second test.
const LINK_STOPS = ['Sagrada Família', 'Casa Milà'];
// Real articles around the old town, used to fake Wikipedia's "what's nearby" search.
const PLACES = [
  'Casa Amatller', 'Casa Lleó Morera', 'Passeig de Gràcia', 'Passeig de Gràcia station', 'Catalunya station',
  'La Rambla, Barcelona', 'Palau de la Virreina', 'Gran Teatre del Liceu', 'Liceu station', 'Palau Güell',
  'Santa Maria del Pi, Barcelona', 'Plaça de Sant Jaume', 'Palau de la Generalitat de Catalunya', 'Barcelona City Hall',
  'Temple of Augustus, Barcelona', 'Plaça del Rei', 'Barcelona City History Museum', 'Frederic Marès Museum',
  'Palau de la Música Catalana', 'Museu Picasso', 'El Born Centre de Cultura i Memòria', 'Fossar de les Moreres',
  'Jaume I station', 'Museu d\'Art Contemporani de Barcelona', 'Columbus Monument, Barcelona', 'Basílica de la Mercè',
  'Arc de Triomf', 'Parc de la Ciutadella', 'Santa Maria del Mar, Barcelona',
];

const nominatim = {};
for (const q of [CITY, ...STOPS, ...LINK_STOPS]) {
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', extratags: '1', 'accept-language': 'en' });
  if (q === CITY) params.set('featureType', 'city');
  nominatim[q] = await json(`https://nominatim.openstreetmap.org/search?${params}`);
  await sleep(1100);
}

const summaries = {};
for (const title of [CITY, ...STOPS, ...LINK_STOPS, ...PLACES]) {
  try {
    summaries[title] = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  } catch (e) {
    console.warn('skip', title, e.message);
  }
  await sleep(1200);
}
// The app asks for an article by its exact title (after OSM tags/redirects); index by canonical title too.
for (const s of Object.values(summaries)) summaries[s.title] = s;

const geosearch = Object.values(summaries)
  .filter((s, i, all) => s.coordinates && all.findIndex((o) => o.pageid === s.pageid) === i && s.title !== CITY)
  .map((s) => ({
    pageid: s.pageid,
    title: s.title,
    coordinates: [{ lat: s.coordinates.lat, lon: s.coordinates.lon, primary: true, globe: 'earth' }],
    description: s.description,
    thumbnail: s.thumbnail ? { source: s.thumbnail.source, width: s.thumbnail.width, height: s.thumbnail.height } : undefined,
  }));

// How many languages have an article about each place (how well known it is).
for (let i = 0; i < geosearch.length; i += 50) {
  const ids = geosearch.slice(i, i + 50).map((p) => p.pageid).join('|');
  const data = await json(`https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=langlinkscount&pageids=${ids}`);
  for (const page of data.query.pages) geosearch.find((p) => p.pageid === page.pageid).langlinkscount = page.langlinkscount ?? 0;
  await sleep(1200);
}

await writeFile(new URL('./fixtures.json', import.meta.url), JSON.stringify({ city: CITY, stops: STOPS, linkStops: LINK_STOPS, nominatim, summaries, geosearch }, null, 1));
console.log(`saved ${Object.keys(nominatim).length} places, ${Object.keys(summaries).length} summaries, ${geosearch.length} nearby articles`);
