// Turning "Eiffel Tower" into coordinates (OpenStreetMap Nominatim) and stops into a route.

import { distanceMeters } from './geo.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
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

// Nominatim's usage policy allows at most one request per second. The queue is shared by
// every geocoder on the page (importing a link and starting a tour can overlap).
const queue = { lastAt: 0, chain: Promise.resolve() };

export function createGeocoder({ lang = 'en', fetchImpl = defaultFetch, minIntervalMs = 1100 } = {}) {
  function throttledJson(url) {
    const run = async () => {
      const wait = queue.lastAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      queue.lastAt = Date.now();
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status})`);
      return res.json();
    };
    const p = queue.chain.then(run, run);
    queue.chain = p.catch(() => {});
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
    return pickBestResult(await throttledJson(`${NOMINATIM}/search?${params}`), q);
  }

  async function findCity(name) {
    const r = (await search(name, { featureType: 'city' })) ?? (await search(name));
    return r ? toPlace(r, name) : null;
  }

  /** Find a place, preferring matches inside (or near) the city you're staying in. */
  async function findPlace(query, city = null, name = query) {
    const near = (r) => !city || distanceMeters(city, { lat: Number(r.lat), lon: Number(r.lon) }) < 100000;
    if (city?.bbox) {
      const [s, n, w, e] = city.bbox;
      const padLat = (n - s) * 0.3;
      const padLon = (e - w) * 0.3;
      const viewbox = [w - padLon, n + padLat, e + padLon, s - padLat].map((v) => v.toFixed(5)).join(',');
      const r = await search(query, { viewbox, bounded: '1' });
      if (r) return toPlace(r, name);
    }
    if (city) {
      const r = await search(`${query}, ${city.osmName ?? city.name}`);
      if (r && near(r)) return toPlace(r, name);
    }
    const r = await search(query);
    return r && near(r) ? toPlace(r, name) : null;
  }

  /**
   * A stop we already have coordinates for (from a map link): look it up by name right
   * there, to learn its outline and Wikipedia link. Falls back to the coordinates alone.
   */
  async function findPlaceNear(query, { lat, lon }, name = query) {
    const d = 0.01; // ~1 km box
    const viewbox = [lon - d, lat + d, lon + d, lat - d].map((v) => v.toFixed(5)).join(',');
    const r = await search(query, { viewbox, bounded: '1' }).catch(() => null);
    if (r && distanceMeters({ lat, lon }, { lat: Number(r.lat), lon: Number(r.lon) }) < 1500) return toPlace(r, name);
    return { name, osmName: null, displayName: query, lat, lon, bbox: null, isArea: false, wikipedia: null, wikidata: null };
  }

  /** What's at these coordinates? zoom 18 = a building or address, 10 = the city. */
  async function reverse({ lat, lon }, zoom = 18) {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      zoom: String(zoom),
      format: 'jsonv2',
      extratags: '1',
      'accept-language': lang,
    });
    const r = await throttledJson(`${NOMINATIM}/reverse?${params}`);
    if (!r || r.error) return null;
    const a = r.address ?? {};
    const name =
      zoom <= 10
        ? a.city ?? a.town ?? a.village ?? a.municipality ?? r.name
        : r.name || [a.road && a.house_number ? `${a.house_number} ${a.road}` : a.road, a.suburb].find(Boolean);
    return { ...toPlace(r, name || (r.display_name ?? '').split(',')[0]), lat, lon };
  }

  /** Places of one kind (e.g. 'cafe') within `radius` meters: name, position, OSM tags. */
  async function searchNearby(kind, { lat, lon }, radius = 400) {
    const dLat = radius / 111320;
    const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
    const params = new URLSearchParams({
      q: kind,
      format: 'jsonv2',
      limit: '25',
      extratags: '1',
      bounded: '1',
      viewbox: [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map((v) => v.toFixed(5)).join(','),
      'accept-language': lang,
    });
    const results = await throttledJson(`${NOMINATIM}/search?${params}`);
    return (Array.isArray(results) ? results : [])
      .filter((r) => r.name && r.category === 'amenity')
      .map((r) => ({ name: r.name, lat: Number(r.lat), lon: Number(r.lon), amenity: r.type, tags: r.extratags ?? {} }));
  }

  return { findCity, findPlace, findPlaceNear, reverse, searchNearby };
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
