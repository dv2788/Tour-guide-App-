// Browser smoke test: runs the sample Paris walk in simulation mode on a phone-sized
// screen and checks what the guide says. External services are answered from
// fixtures.json (recorded by build-fixtures.mjs); set LIVE=1 to use the real ones.
// Needs Playwright with Chromium: `npm i -D playwright && npx playwright install chromium`.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(__dirname, 'screenshots');
const LIVE = process.env.LIVE === '1';
const fixtures = require('./fixtures.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

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

  await context.route('https://nominatim.openstreetmap.org/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q').replace(/, Paris$/, '');
    json(route, fixtures.nominatim[q] ?? []);
  });
  await context.route('https://routing.openstreetmap.de/**', (route) => json(route, fixtures.route));
  await context.route('https://*.wikipedia.org/w/api.php?**', (route) => {
    const p = new URL(route.request().url()).searchParams;
    const [lat, lon] = p.get('ggscoord').split('|').map(Number);
    const radius = Number(p.get('ggsradius'));
    const pages = fixtures.geosearch
      .map((page) => ({ page, d: distance({ lat, lon }, page.coordinates[0]) }))
      .filter(({ d }) => d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, Number(p.get('ggslimit')))
      .map(({ page }) => page);
    json(route, { batchcomplete: true, query: { pages } });
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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  if (!LIVE) await mockNetwork(context);
  // Fast-forward time 10x (timers and Date.now), so the 8x simulated walk with its
  // narration plays out in under a minute while keeping their relative timing.
  await context.addInitScript((factor) => {
    const realNow = Date.now.bind(Date);
    const t0 = realNow();
    Date.now = () => t0 + (realNow() - t0) * factor;
    const setT = window.setTimeout.bind(window);
    const setI = window.setInterval.bind(window);
    window.setTimeout = (fn, ms = 0, ...args) => setT(fn, ms / factor, ...args);
    window.setInterval = (fn, ms = 0, ...args) => setI(fn, ms / factor, ...args);
  }, 10);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/tile|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto(base);
  await page.click('#demo');
  await page.screenshot({ path: path.join(SHOTS, '1-setup.png'), fullPage: true });

  await page.evaluate(() => {
    window.__said = [];
    new MutationObserver(() => {
      const text = document.getElementById('now-text').textContent;
      if (text && window.__said.at(-1) !== text) window.__said.push(text);
    }).observe(document.getElementById('now-text'), { childList: true, characterData: true, subtree: true });
  });
  await page.click('button[type=submit]');

  await page.waitForFunction(() => document.querySelectorAll('#journal li').length >= 3, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, '2-on-tour.png') });

  // Wait for the last stop.
  await page.waitForFunction(() => (window.__said ?? []).some((t) => t.startsWith('You have arrived at Louvre Museum')), null, {
    timeout: 240000,
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, '3-journal.png'), fullPage: true });

  const said = await page.evaluate(() => window.__said);
  console.log('\nThe guide said:\n');
  said.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t}\n`));

  const failures = [];
  const expect = (ok, msg) => ok || failures.push(msg);
  expect(said[0]?.startsWith('Welcome to Paris.'), 'starts with a welcome to Paris');
  const arrivals = said.filter((t) => t.startsWith('You have arrived at')).map((t) => t.match(/^You have arrived at (.+?)\./)[1]);
  expect(
    JSON.stringify(arrivals) === JSON.stringify(['Eiffel Tower', "Pont de l'Alma", 'Grand Palais', 'Place de la Concorde', 'Louvre Museum']),
    `arrives at every stop in order (got ${JSON.stringify(arrivals)})`,
  );
  expect(said.some((t) => /^(On your (left|right)|Ahead of you|Just behind you): /.test(t)), 'mentions places passed on the way');
  expect(!said.some((t) => /Great Palace|Concorde Square/.test(t)), 'uses the names the traveller typed');
  expect(!said.some((t) => /Bir-Hakeim/.test(t)), 'skips metro stations');
  expect(!said.some((t) => /\bRER\b|railway station/i.test(t)), "describes the Pont de l'Alma bridge, not the station");
  expect(errors.length === 0, `no page errors (got ${errors.join(' | ')})`);

  await browser.close();
  server.close();
  if (failures.length) {
    console.error('\nFAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log(`All checks passed. Screenshots in ${SHOTS}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
