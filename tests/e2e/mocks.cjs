// Shared by the browser tests: a static server for the app, recorded answers from
// OpenStreetMap search and Wikipedia (fixtures.json, real data), and real routes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const fixtures = require('./fixtures.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function distance(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}


// ---------- Routes: always real ----------
// Routes and street names come from the real routing service (routing.openstreetmap.de),
// so the map and the directions show real streets. Every answer is also recorded in
// routes-<name>.json, which answers instead when the service can't be reached (or with
// OFFLINE=1): the exact request if it was recorded, else the closest recorded one.
const OFFLINE = process.env.OFFLINE === '1';
const caches = {};
function routeCache(name) {
  if (!caches[name]) {
    const file = path.join(__dirname, `routes-${name}.json`);
    caches[name] = { file, entries: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}, used: new Set(), live: 0, recorded: 0 };
  }
  return caches[name];
}

/** Drop what the app never reads (intersections, hints), so recordings stay small. */
function trimOsrm(data) {
  if (data.routes) {
    return {
      code: data.code,
      waypoints: (data.waypoints ?? []).map((w) => ({ name: w.name, distance: w.distance, location: w.location })),
      routes: data.routes.slice(0, 1).map((r) => ({
        distance: r.distance,
        duration: r.duration,
        geometry: { type: 'LineString', coordinates: r.geometry.coordinates.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]) },
        legs: r.legs.map((l) => ({
          distance: l.distance,
          duration: l.duration,
          steps: (l.steps ?? []).map((st) => ({ distance: st.distance, name: st.name, ...(st.ref ? { ref: st.ref } : {}), maneuver: { type: st.maneuver.type, modifier: st.maneuver.modifier, exit: st.maneuver.exit, bearing_after: st.maneuver.bearing_after, location: st.maneuver.location } })),
        })),
      })),
    };
  }
  if (data.waypoints) return { code: data.code, waypoints: data.waypoints.map((w) => ({ name: w.name, distance: w.distance, location: w.location })) };
  return data;
}

function parseRoutingUrl(url) {
  const u = new URL(url);
  const [prefix, coords = ''] = u.pathname.split('/driving/');
  const pts = coords.split(';').filter(Boolean).map((c) => c.split(',').map(Number));
  const kind = `${prefix}|steps=${u.searchParams.get('steps')}|bearings=${u.searchParams.has('bearings')}`;
  return { kind, pts, key: `${kind}|${pts.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(';')}` };
}

async function answerRouting(route, json, name) {
  const cache = routeCache(name);
  const url = route.request().url();
  const { kind, pts, key } = parseRoutingUrl(url);
  if (!OFFLINE) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Roamie-tests/0.2 (+https://github.com/dv2788/Tour-guide-App-)' }, signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        cache.entries[key] = trimOsrm(await res.json());
        cache.used.add(key);
        cache.live++;
        return json(route, cache.entries[key]);
      }
    } catch {
      // unreachable: use the recording
    }
  }
  let best = cache.entries[key] ? key : null;
  if (!best) {
    let bestD = kind.includes('/nearest/') ? 25 : 150;
    for (const k of Object.keys(cache.entries)) {
      if (!k.startsWith(`${kind}|`)) continue;
      const c = k.slice(kind.length + 1).split(';').map((p) => p.split(',').map(Number));
      if (c.length !== pts.length) continue;
      const d = Math.max(...c.map(([x, y], i) => distance({ lat: y, lon: x }, { lat: pts[i][1], lon: pts[i][0] })));
      if (d < bestD) [bestD, best] = [d, k];
    }
  }
  if (!best) return json(route, { code: 'NoRoute', message: 'Not recorded' }, 503);
  cache.used.add(best);
  cache.recorded++;
  return json(route, cache.entries[best]);
}

/** Keep the recordings this run used (so the file doesn't grow run after run). */
function saveRouteCaches() {
  for (const cache of Object.values(caches)) {
    if (!cache.live) continue; // offline run: keep the recordings as they were
    const kept = Object.fromEntries([...cache.used].sort().map((k) => [k, cache.entries[k]]));
    fs.writeFileSync(cache.file, JSON.stringify(kept));
  }
  return Object.fromEntries(Object.entries(caches).map(([n, c]) => [n, { live: c.live, recorded: c.recorded }]));
}

async function mockNetwork(context, { routeCacheName = 'smoke' } = {}) {
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

  await context.route('https://nominatim.openstreetmap.org/search?**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q').replace(new RegExp(`, ${fixtures.city}$`), '');
    // Full addresses from pasted links ("Casa Milà, Pg. de Gràcia, 92…"): match on the place name.
    json(route, fixtures.nominatim[q] ?? fixtures.nominatim[q.split(',')[0]] ?? []);
  });
  await context.route('https://nominatim.openstreetmap.org/reverse?**', (route) => {
    const p = new URL(route.request().url()).searchParams;
    const recorded = fixtures.nominatim[fixtures.city][0];
    const city = { ...recorded, lat: p.get('lat'), lon: p.get('lon'), address: { city: fixtures.city } };
    json(route, Number(p.get('zoom')) <= 10 ? city : { name: 'Somewhere', lat: p.get('lat'), lon: p.get('lon'), address: {} });
  });
  await context.route('https://routing.openstreetmap.de/**', (route) => answerRouting(route, json, routeCacheName));
  // Article sizes aren't in the recorded summaries: derive a stable stand-in from the intro.
  const articleLength = (title) => (fixtures.summaries[title]?.extract?.length ?? 300) * 40;
  await context.route('https://*.wikipedia.org/w/api.php?**', (route) => {
    const p = new URL(route.request().url()).searchParams;
    const near = (lat, lon, radius, limit) =>
      fixtures.geosearch
        .map((page) => ({ page, d: distance({ lat, lon }, page.coordinates[0]) }))
        .filter(({ d }) => d <= radius)
        .sort((a, b) => a.d - b.d)
        .slice(0, limit);
    if (p.get('list') === 'geosearch') {
      // "Explore this area" step 1: titles and positions.
      const [lat, lon] = p.get('gscoord').split('|').map(Number);
      const found = near(lat, lon, Number(p.get('gsradius')), Number(p.get('gslimit')));
      json(route, { query: { geosearch: found.map(({ page, d }) => ({ pageid: page.pageid, title: page.title, lat: page.coordinates[0].lat, lon: page.coordinates[0].lon, dist: d })) } });
    } else if (p.get('list') === 'search') {
      // "Explore this area" step 1b: the most notable places in the radius ("nearcoord:3000m,lat,lon").
      const [, meters, lat, lon] = (p.get('srsearch').match(/nearcoord:(\d+)m,(-?[\d.]+),(-?[\d.]+)/) ?? []).map(Number);
      const found = near(lat, lon, meters, Infinity)
        .sort((a, b) => articleLength(b.page.title) - articleLength(a.page.title))
        .slice(0, Number(p.get('srlimit')));
      json(route, { query: { search: found.map(({ page }) => ({ ns: 0, title: page.title, pageid: page.pageid })) } });
    } else if (p.get('pageids')) {
      // Step 2: details, including article length, how many languages cover it (a stand-in) and its position.
      const ids = new Set(p.get('pageids').split('|').map(Number));
      const pages = fixtures.geosearch
        .filter((page) => ids.has(page.pageid))
        .map((page) => ({
          pageid: page.pageid,
          title: page.title,
          length: articleLength(page.title),
          description: page.description,
          thumbnail: page.thumbnail,
          langlinkscount: Math.round(articleLength(page.title) / 1500),
          coordinates: page.coordinates.map((c) => ({ lat: c.lat, lon: c.lon, primary: true })),
        }));
      json(route, { query: { pages } });
    } else if (p.get('generator') === 'search') {
      // Suggestions for "which part of town": the recorded places plus a few neighbourhoods.
      const quarters = [
        { title: 'Eixample', description: 'District of Barcelona, Spain' },
        { title: 'El Born', description: 'Neighbourhood in Barcelona, Spain' },
        { title: 'Gràcia', description: 'District of Barcelona, Spain' },
      ];
      const pages = [...quarters, ...fixtures.geosearch.map((page) => ({ title: page.title, description: page.description }))].map((page, i) => ({ pageid: 900000 + i, index: i + 1, ...page }));
      json(route, { query: { pages } });
    } else {
      const [lat, lon] = p.get('ggscoord').split('|').map(Number);
      const pages = near(lat, lon, Number(p.get('ggsradius')), Number(p.get('ggslimit'))).map(({ page }) => page);
      json(route, { batchcomplete: true, query: { pages } });
    }
  });
  // OpenStreetMap cafés, restaurants and bars around the requested point.
  let overpassCalls = 0;
  await context.route('https://overpass-api.de/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('data') ?? '';
    const [, , lat, lon] = (q.match(/around:(\d+),(-?[\d.]+),(-?[\d.]+)/) ?? []).map(Number);
    const at = (dLat, dLon) => ({ lat: lat + dLat, lon: lon + dLon });
    // Each search finds its own places (" II", " III"… after the first), like real streets do.
    overpassCalls++;
    const n = (name) => (overpassCalls > 1 ? `${name} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][overpassCalls - 2] ?? overpassCalls}` : name);
    json(route, {
      // Hours are 24/7 or unknown so the test doesn't depend on the time it runs.
      elements: [
        { type: 'node', ...at(0.0006, 0.0002), tags: { name: n('Salon de Thé Historique'), amenity: 'cafe', wikidata: 'Q1', opening_hours: '24/7' } },
        { type: 'node', ...at(-0.0007, -0.0002), tags: { name: n('Café des Artistes'), amenity: 'cafe', outdoor_seating: 'yes' } },
        { type: 'node', ...at(-0.0004, 0.0005), tags: { name: n('Bistrot du Coin'), amenity: 'restaurant', cuisine: 'french', opening_hours: '24/7' } },
        { type: 'node', ...at(0.0005, 0.0006), tags: { name: n('La Petite Table'), amenity: 'restaurant', cuisine: 'french' } },
        { type: 'node', ...at(0.0002, -0.0003), tags: { name: n('Burger Chain'), amenity: 'restaurant', brand: 'Burger Chain', opening_hours: '24/7' } },
        { type: 'node', ...at(0.0003, -0.0006), tags: { name: n('Le Bar à Vins'), amenity: 'bar', website: 'https://example.org', opening_hours: '24/7' } },
        { type: 'node', ...at(-0.0003, -0.0006), tags: { name: n('The Old Pub'), amenity: 'pub' } },
      ],
    });
  });
  await context.route('https://*.wikipedia.org/api/rest_v1/page/summary/**', (route) => {
    const title = decodeURIComponent(new URL(route.request().url()).pathname.split('/summary/')[1]).replace(/_/g, ' ');
    const s = fixtures.summaries[title];
    s ? json(route, s) : json(route, { type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' }, 404);
  });
  await context.route('https://www.wikidata.org/**', (route) => {
    const qid = new URL(route.request().url()).searchParams.get('ids');
    const s = Object.values(fixtures.summaries).find((x) => x.wikibase_item === qid);
    json(route, { entities: { [qid]: { sitelinks: s ? { enwiki: { title: s.title } } : {} } } });
  });
}

module.exports = { serve, mockNetwork, saveRouteCaches, fixtures, ROOT };
