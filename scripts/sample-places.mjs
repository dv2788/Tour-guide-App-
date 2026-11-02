// Looks up every sample tour's city and stops on the map once, with the app's own geocoder, and
// stores the answers in js/sample-places.js. The app then starts a sample tour without asking the
// map search (OpenStreetMap's Nominatim allows one request a second for the whole app, all users
// together). Run it after adding or changing a sample: `npm run sample-places` (about a minute
// per city; answers already stored are kept unless you pass --all).
import { writeFile } from 'node:fs/promises';
import { SAMPLES } from '../js/samples.js';
import { SAMPLE_PLACES } from '../js/sample-places.js';
import { createGeocoder } from '../js/geocode.js';

const UA = 'Roamie-site-build/1.0 (https://github.com/dv2788/Tour-guide-App-)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Patient with "too many requests": wait and ask again, never take it for "not found".
async function politeFetch(url, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers ?? {}), 'User-Agent': UA } });
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= 6) throw new Error(`The map search kept refusing (${res.status})`);
    await sleep(20000 * (attempt + 1));
  }
}
const geocoder = createGeocoder({ lang: 'en', fetchImpl: politeFetch, minIntervalMs: 1500 });

const all = process.argv.includes('--all');
const round = (v) => (v == null ? v : Math.round(v * 1e6) / 1e6);
// What the app needs of a place, nothing more (the display name is long and unused here).
const keep = (p) => ({
  osmName: p.osmName,
  lat: round(p.lat),
  lon: round(p.lon),
  bbox: p.bbox?.map(round) ?? null,
  isArea: p.isArea,
  wikipedia: p.wikipedia,
  wikidata: p.wikidata,
});

const out = {};
for (const sample of SAMPLES) {
  const before = all ? null : SAMPLE_PLACES[sample.city];
  const city = before?.city ? { name: sample.city, ...before.city } : await geocoder.findCity(sample.city);
  if (!city) throw new Error(`${sample.city} not found on the map`);
  const stops = {};
  for (const stop of sample.stops) {
    const known = before?.stops?.[stop];
    const place = known ? { name: stop, ...known } : await geocoder.findPlace(stop, city, stop);
    if (!place) throw new Error(`${stop} (${sample.label}) not found on the map`);
    stops[stop] = keep(place);
  }
  out[sample.city] = { city: keep(city), stops };
  console.log(`${sample.label}: ${sample.stops.length} stops`);
}

// One city per line, so a change shows up as one line in the history.
const lines = Object.entries(out).map(([city, places]) => `  ${JSON.stringify(city)}: ${JSON.stringify(places)},`);
await writeFile(
  new URL('../js/sample-places.js', import.meta.url),
  `// Where each sample tour's city and stops are on the map, as OpenStreetMap's search answered
// (scripts/sample-places.mjs, ${new Date().toISOString().slice(0, 10)}). A sample tour starts without asking the
// map search: it allows one request a second for the whole app. Generated: don't edit by hand.

export const SAMPLE_PLACES = {
${lines.join('\n')}
};

/** The stored answers for a city as the sample tours write it ("Cartagena, Colombia"), if any. */
export function storedPlaces(city) {
  const found = SAMPLE_PLACES[String(city ?? '').trim()];
  if (!found) return null;
  return {
    city: { name: String(city).trim(), ...found.city },
    stop: (name) => (found.stops[name] ? { name, ...found.stops[name] } : null),
  };
}
`,
);
console.log(`Stored ${Object.keys(out).length} cities in js/sample-places.js`);
