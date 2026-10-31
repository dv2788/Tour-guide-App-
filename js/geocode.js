// Turning "Eiffel Tower" into coordinates (OpenStreetMap Nominatim) and stops into a route.

import { distanceMeters } from './geo.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const ROUTERS = {
  foot: 'https://routing.openstreetmap.de/routed-foot',
  bike: 'https://routing.openstreetmap.de/routed-bike',
  car: 'https://routing.openstreetmap.de/routed-car',
};
const defaultFetch = (...args) => globalThis.fetch(...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TRANSIT_CLASSES = new Set(['railway', 'public_transport']);
const TRANSIT_TYPES = new Set(['station', 'stop', 'halt', 'platform', 'stop_position', 'subway_entrance', 'bus_stop', 'tram_stop']);
const WANTS_TRANSIT = /\b(station|gare|stop|metro|m[ée]tro|subway|bahnhof|estaci[óo]n|stazione)\b/i;

/**
 * Pick the result the traveller most likely means. "Pont de l'Alma" should be the
 * bridge, not the train station named after it, unless they asked for a station.
 */
export function pickBestResult(results, query) {
  if (!Array.isArray(results) || !results.length) return null;
  if (WANTS_TRANSIT.test(query)) return results[0];
  const isTransit = (r) => TRANSIT_CLASSES.has(r.category) || TRANSIT_TYPES.has(r.type);
  return results.find((r) => !isTransit(r)) ?? results[0];
}

// The spoken name is what the traveller typed: OpenStreetMap's "English" names can be
// odd literal translations ("Grand Palais" -> "Great Palace").
function toPlace(r, typedName) {
  return {
    name: typedName || r.name || (r.display_name ?? '').split(',')[0],
    osmName: r.name || null,
    displayName: r.display_name ?? typedName,
    lat: Number(r.lat),
    lon: Number(r.lon),
    bbox: Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null, // [south, north, west, east]
    // Real outline of a building/park/square. Single map points get a made-up box, so ignore those.
    isArea: r.osm_type === 'way' || r.osm_type === 'relation',
    wikipedia: r.extratags?.wikipedia ?? null,
    wikidata: r.extratags?.wikidata ?? null,
  };
}

export function createGeocoder({ lang = 'en', fetchImpl = defaultFetch, minIntervalMs = 1100 } = {}) {
  // Nominatim's usage policy allows at most one request per second: queue requests.
  let lastAt = 0;
  let chain = Promise.resolve();
  function throttledJson(url) {
    const run = async () => {
      const wait = lastAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status})`);
      return res.json();
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  async function search(q, extra = {}) {
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '5',
      extratags: '1',
      'accept-language': lang,
      ...extra,
    });
    return pickBestResult(await throttledJson(`${NOMINATIM}?${params}`), q);
  }

  async function findCity(name) {
    const r = (await search(name, { featureType: 'city' })) ?? (await search(name));
    return r ? toPlace(r, name) : null;
  }

  /** Find a place, preferring matches inside (or near) the city you're staying in. */
  async function findPlace(query, city = null) {
    const near = (r) => !city || distanceMeters(city, { lat: Number(r.lat), lon: Number(r.lon) }) < 100000;
    if (city?.bbox) {
      const [s, n, w, e] = city.bbox;
      const padLat = (n - s) * 0.3;
      const padLon = (e - w) * 0.3;
      const viewbox = [w - padLon, n + padLat, e + padLon, s - padLat].map((v) => v.toFixed(5)).join(',');
      const r = await search(query, { viewbox, bounded: '1' });
      if (r) return toPlace(r, query);
    }
    if (city) {
      const r = await search(`${query}, ${city.osmName ?? city.name}`);
      if (r && near(r)) return toPlace(r, query);
    }
    const r = await search(query);
    return r && near(r) ? toPlace(r, query) : null;
  }

  return { findCity, findPlace };
}

/**
 * A route through the stops, following real streets when the routing service answers,
 * or straight lines between stops otherwise. Returns { points: [{lat, lon}], routed }.
 */
export async function fetchRoute(stops, profile = 'foot', fetchImpl = defaultFetch) {
  const straight = { points: stops.map(({ lat, lon }) => ({ lat, lon })), routed: false };
  if (stops.length < 2) return straight;
  const coords = stops.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${ROUTERS[profile] ?? ROUTERS.foot}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const line = data?.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(line) && line.length >= 2) {
      return { points: line.map(([lon, lat]) => ({ lat, lon })), routed: true };
    }
  } catch {
    // fall through to straight lines
  }
  return straight;
}
