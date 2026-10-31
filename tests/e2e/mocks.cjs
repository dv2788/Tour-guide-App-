// Shared by the browser tests: a static server for the app, and fake versions of
// OpenStreetMap / Wikipedia answering from fixtures.json (recorded real data).
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

async function mockNetwork(context) {
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

  await context.route('https://nominatim.openstreetmap.org/search?**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q').replace(/, Paris$/, '');
    // Full addresses from pasted links ("Grand Palais, 3 Av. du …"): match on the place name.
    json(route, fixtures.nominatim[q] ?? fixtures.nominatim[q.split(',')[0]] ?? []);
  });
  await context.route('https://nominatim.openstreetmap.org/reverse?**', (route) => {
    const p = new URL(route.request().url()).searchParams;
    const paris = fixtures.nominatim.Paris[0];
    const city = { ...paris, lat: p.get('lat'), lon: p.get('lon'), address: { city: 'Paris' } };
    json(route, Number(p.get('zoom')) <= 10 ? city : { name: 'Somewhere', lat: p.get('lat'), lon: p.get('lon'), address: {} });
  });
  await context.route('https://routing.openstreetmap.de/**', (route) => {
    const coords = decodeURIComponent(new URL(route.request().url()).pathname.split('/driving/')[1] ?? '')
      .split(';')
      .map((c) => c.split(',').map(Number));
    const recorded = fixtures.route.waypoints.map((w) => w.location);
    const same = coords.length === recorded.length && coords.every(([lon, lat], i) => distance({ lat, lon }, { lat: recorded[i][1], lon: recorded[i][0] }) < 50);
    // The recorded real route for the sample walk; straight lines between any other stops.
    json(route, same ? fixtures.route : { routes: [{ geometry: { type: 'LineString', coordinates: coords } }] });
  });
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
    } else if (p.get('pageids')) {
      // Step 2: details, including article length.
      const ids = new Set(p.get('pageids').split('|').map(Number));
      const pages = fixtures.geosearch
        .filter((page) => ids.has(page.pageid))
        .map((page) => ({ pageid: page.pageid, title: page.title, length: articleLength(page.title), description: page.description, thumbnail: page.thumbnail }));
      json(route, { query: { pages } });
    } else {
      const [lat, lon] = p.get('ggscoord').split('|').map(Number);
      const pages = near(lat, lon, Number(p.get('ggsradius')), Number(p.get('ggslimit'))).map(({ page }) => page);
      json(route, { batchcomplete: true, query: { pages } });
    }
  });
  // OpenStreetMap cafés, restaurants and bars around the requested point.
  await context.route('https://overpass-api.de/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('data') ?? '';
    const [, , lat, lon] = (q.match(/around:(\d+),(-?[\d.]+),(-?[\d.]+)/) ?? []).map(Number);
    const at = (dLat, dLon) => ({ lat: lat + dLat, lon: lon + dLon });
    json(route, {
      elements: [
        { type: 'node', ...at(0.0006, 0.0002), tags: { name: 'Salon de Thé Historique', amenity: 'cafe', wikidata: 'Q1', opening_hours: 'Mo-Su 09:00-19:00' } },
        { type: 'node', ...at(-0.0004, 0.0005), tags: { name: 'Bistrot du Coin', amenity: 'restaurant', cuisine: 'french', opening_hours: 'Mo-Su 12:00-23:00' } },
        { type: 'node', ...at(0.0003, -0.0006), tags: { name: 'Le Bar à Vins', amenity: 'bar', website: 'https://example.org' } },
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

module.exports = { serve, mockNetwork, fixtures, ROOT };
