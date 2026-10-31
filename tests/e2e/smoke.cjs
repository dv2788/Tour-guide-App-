// Browser smoke test: runs the sample Barcelona walk in simulation mode on a phone-sized
// screen and checks what the guide says and the way it shows. Place search and Wikipedia
// are answered from fixtures.json (recorded by build-fixtures.mjs); routes always come from
// the real routing service, or its recording when offline (see mocks.cjs). LIVE=1 uses
// every real service.
// Needs Playwright with Chromium: `npm i -D playwright && npx playwright install chromium`.

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork, saveRouteCaches, fixtures } = require('./mocks.cjs');

const SHOTS = path.join(__dirname, 'screenshots');
const LIVE = process.env.LIVE === '1';

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  // Software WebGL, so the vector map is drawn as on a phone.
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  const mainPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/tile|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  const failures = [];
  const expect = (ok, msg) => ok || failures.push(msg);

  // Records everything the guide says, then runs the tour until the last stop.
  async function runTour(shotPrefix, page = mainPage, until = 'You have arrived at Santa Maria del Mar') {
    await page.evaluate(() => {
      window.__said = [];
      new MutationObserver(() => {
        const text = document.getElementById('now-text').textContent;
        if (text && window.__said.at(-1) !== text) window.__said.push(text);
      }).observe(document.getElementById('now-text'), { childList: true, characterData: true, subtree: true });
    });
    // The phone's voice (headless Chromium has none, so the text is paced instead).
    await page.click('#guides .guide[data-value="system:"] label');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#journal li').length >= 3, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    // Directions to the next stop: card, gold line, a spoken turn.
    await page.waitForFunction(() => /min/.test(document.getElementById('nav-target').textContent) && document.querySelector('.nav-line'), null, { timeout: 30000 });
    // (Right after a wrong turn the card says "Finding a new way…" for a moment.)
    await page.waitForFunction(() => !/Finding/.test(document.getElementById('nav-sentence').textContent), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500); // let the map tiles load
    const nav = await page.evaluate(() => {
      const vertices = (el) => (el?.getAttribute('d')?.match(/[ML]/g) ?? []).length;
      return {
        sentence: document.getElementById('nav-sentence').textContent,
        target: document.getElementById('nav-target').textContent,
        link: document.getElementById('nav-open').href,
        navLinePoints: vertices(document.querySelector('.nav-line')),
        vectorMap: document.getElementById('map').classList.contains('vector-map'),
        status: document.getElementById('status').textContent,
      };
    });
    console.log('Directions:', JSON.stringify(nav));
    expect(/head|turn|bear|keep|continue|just ahead/i.test(nav.sentence), `a direction is shown (${nav.sentence})`);
    expect(!/Rue du Test|Quai des Essais/.test(nav.sentence), 'directions name real streets');
    expect(nav.navLinePoints >= 6, `the way to the next stop follows the streets (${nav.navLinePoints} points)`);
    expect(!/didn't answer/.test(nav.status), 'the tour route follows the streets');
    expect(/maps/.test(nav.link), 'open-in-maps link');
    expect(nav.vectorMap, 'the sharp vector map is used');
    if (shotPrefix) await page.screenshot({ path: path.join(SHOTS, `${shotPrefix}-on-tour.png`) });
    await page.waitForFunction((u) => (window.__said ?? []).some((t) => t.startsWith(u)), until, {
      timeout: 240000,
    });
    await page.waitForTimeout(1000);
    const said = await page.evaluate(() => window.__said);
    const spoken = await page.$eval('#next-stop', (el) => el.dataset.spoken ?? '');
    console.log('Last spoken direction:', spoken);
    expect(/^(In \d|Head|Turn|Bear|Keep|Continue)/i.test(spoken), `directions are spoken too (${spoken})`);
    await page.click('#btn-end');
    return said;
  }
  const arrivalsIn = (said) => said.filter((t) => t.startsWith('You have arrived at')).map((t) => t.match(/^You have arrived at (.+?)\./)[1]);

  // ---- Scenario 1: the sample walk, typed stops ----
  await page.goto(base);
  const samples = await page.$$eval('.sample .sample-city', (els) => els.map((e) => e.textContent));
  console.log('Sample tours:', samples.join(', '));
  expect(['Barcelona', 'Brussels', 'Cape Town', 'Kinshasa', 'Miami Beach', 'San Francisco', 'Shenzhen'].every((c) => samples.includes(c)), 'sample tours from several cities');
  await page.click('.sample[data-id="cape-town"]');
  expect((await page.$eval('#city', (el) => el.value)) === 'Cape Town', 'a sample tour fills in its city');
  await page.click('#demo');
  expect((await page.$eval('#city', (el) => el.value)) === 'Barcelona', 'the default sample is Barcelona');
  await page.screenshot({ path: path.join(SHOTS, '1-setup.png'), fullPage: true });
  const said = await runTour('2');
  console.log('\nScenario 1, typed itinerary. The guide said:\n');
  said.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t}\n`));
  expect(said[0]?.startsWith('Welcome to Barcelona.'), 'starts with a welcome to Barcelona');
  const arrivals = arrivalsIn(said);
  expect(
    JSON.stringify(arrivals) === JSON.stringify(fixtures.stops),
    `arrives at every stop in order (got ${JSON.stringify(arrivals)})`,
  );
  expect(said.some((t) => /^(On your (left|right)|Ahead of you|Just behind you): /.test(t)), 'mentions places passed on the way');
  // OpenStreetMap's English names are "Batlló House", "Royal Square", "Cathedral of Santa Eulalia".
  expect(!said.some((t) => /(^You have arrived at|Next stop:) (Batlló House|Royal Square|Cathedral of Santa Eulalia)/.test(t)), 'uses the names the traveller typed');
  expect(!said.some((t) => /^(On your (left|right)|Ahead of you|Just behind you): [^.]*station/.test(t)), 'skips metro and railway stations');
  const square = said.find((t) => t.startsWith('You have arrived at Plaça de Catalunya')) ?? '';
  expect(/square/i.test(square) && !/metro|railway/i.test(square), `describes the Plaça de Catalunya square, not the station under it (${square.slice(0, 120)})`);

  // ---- Scenario 2: paste a Google Maps walking route ----
  const g = (q) => fixtures.nominatim[q][0];
  const [sagrada, mila, batllo] = [g('Sagrada Família'), g('Casa Milà'), g('Casa Batlló')];
  const googleLink =
    'https://www.google.com/maps/dir/Sagrada+Fam%C3%ADlia,+C%2F+de+Mallorca,+401,+L%27Eixample,+08013+Barcelona,+Spain/Casa+Mil%C3%A0,+Pg.+de+Gr%C3%A0cia,+92,+L%27Eixample,+08008+Barcelona,+Spain/Casa+Batll%C3%B3,+Pg.+de+Gr%C3%A0cia,+43,+L%27Eixample,+08007+Barcelona,+Spain/@41.3966,2.1652,15z/data=!3m1!4b1!4m20!4m19' +
    [sagrada, mila, batllo].map((p) => `!1m5!1m1!1s0x0:0x0!2m2!1d${p.lon}!2d${p.lat}`).join('') +
    '!3e2';
  await page.evaluate(() => localStorage.clear());
  await page.goto(base);
  await page.click('label:has(input[value=drive])'); // the link should switch this to walking
  await page.evaluate((text) => navigator.clipboard.writeText(text), googleLink);
  await page.click('#paste-route');
  await page.waitForFunction(() => /✓/.test(document.getElementById('import-note').textContent), null, { timeout: 30000 });
  const imported = await page.evaluate(() => ({
    stops: document.getElementById('stops').value,
    city: document.getElementById('city').value,
    mode: document.querySelector('input[name=mode]:checked').value,
    note: document.getElementById('import-note').textContent,
  }));
  console.log('Scenario 2, pasted Google Maps link:', JSON.stringify(imported));
  await page.screenshot({ path: path.join(SHOTS, '4-imported.png'), fullPage: true });
  expect(imported.stops === 'Sagrada Família\nCasa Milà\nCasa Batlló', `pasted link becomes stops (got ${JSON.stringify(imported.stops)})`);
  expect(imported.mode === 'walk', 'travel mode taken from the link');
  expect(imported.city === 'Barcelona', 'city worked out from the stops');
  await page.click('label:has(input[value=sim])');
  await page.selectOption('#sim-speed', '8');
  const said2 = await runTour(null, page, 'You have arrived at Casa Batlló');
  console.log('\nScenario 2. Arrivals:', JSON.stringify(arrivalsIn(said2)));
  expect(
    JSON.stringify(arrivalsIn(said2)) === JSON.stringify(['Sagrada Família', 'Casa Milà', 'Casa Batlló']),
    `tour from a pasted link visits its stops (got ${JSON.stringify(arrivalsIn(said2))})`,
  );

  // ---- Scenario 3: "Use my location", then "Suggest a route for me" (half a day) ----
  const context3 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    serviceWorkers: 'block',
    geolocation: { latitude: 41.387, longitude: 2.1701 }, // Plaça de Catalunya
    permissions: ['geolocation'],
  });
  if (!LIVE) await mockNetwork(context3);
  await context3.addInitScript((factor) => {
    const realNow = Date.now.bind(Date);
    const t0 = realNow();
    Date.now = () => t0 + (realNow() - t0) * factor;
    const setT = window.setTimeout.bind(window);
    const setI = window.setInterval.bind(window);
    window.setTimeout = (fn, ms = 0, ...args) => setT(fn, ms / factor, ...args);
    window.setInterval = (fn, ms = 0, ...args) => setI(fn, ms / factor, ...args);
  }, 10);
  const page3 = await context3.newPage();
  page3.on('pageerror', (e) => errors.push(e.message));
  await page3.goto(base);
  await page3.click('#locate-me');
  await page3.waitForFunction(() => /You're in Barcelona/.test(document.getElementById('locate-note').textContent), null, { timeout: 30000 });
  expect((await page3.$eval('#city', (el) => el.value)) === 'Barcelona', 'city filled in from the location');
  // A tester saw the small map of where you are drawn on top of the "Begin the tour" bar when scrolled behind it.
  await page3.waitForSelector('#plan-map:not([hidden])');
  const mapUnderBar = await page3.evaluate(() => {
    const map = document.getElementById('plan-map');
    const btn = document.querySelector('.cta-bar .btn-primary');
    const b = btn.getBoundingClientRect();
    window.scrollBy(0, map.getBoundingClientRect().top - (b.top + b.height / 2) + 30);
    const m = map.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const el = document.elementFromPoint(x, y);
    window.scrollTo(0, 0);
    return { behind: m.top < y && m.bottom > y && m.left < x && m.right > x, covered: map.contains(el), what: String(el?.className?.baseVal ?? el?.className) };
  });
  expect(mapUnderBar.behind, 'the map was scrolled behind the "Begin the tour" bar');
  expect(!mapUnderBar.covered, `the map stays under the "Begin the tour" bar (on top: ${mapUnderBar.what})`);
  // A tester typed another city after sharing their location, and the route was still planned around them.
  await page3.route('https://nominatim.openstreetmap.org/search?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'Paris') return route.fallback();
    const paris = { lat: '48.8566', lon: '2.3522', name: 'Paris', display_name: 'Paris, Île-de-France, France', category: 'boundary', type: 'administrative', addresstype: 'city', importance: 0.9, boundingbox: ['48.8156', '48.9022', '2.2241', '2.4698'] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([paris]) });
  });
  // Where the route search looked: "lat|lon|radius" of each "explore this area" request.
  const explored = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const isWiki = (r) => /wikipedia\.org/.test(r.url());
  page3.on('request', (r) => {
    if (isWiki(r)) mostInFlight = Math.max(mostInFlight, ++inFlight);
    const u = new URL(r.url());
    if (u.hostname.endsWith('wikipedia.org') && u.searchParams.get('generator') === 'geosearch' && /langlinkscount/.test(u.searchParams.get('prop') ?? '')) {
      explored.push(`${u.searchParams.get('ggscoord')}|${u.searchParams.get('ggsradius')}`);
    }
  });
  const settled = (r) => isWiki(r) && inFlight--;
  page3.on('requestfinished', settled);
  page3.on('requestfailed', settled);
  await page3.fill('#city', 'Paris');
  await page3.dispatchEvent('#city', 'change');
  const typedNote = await page3.textContent('#locate-note');
  expect(/plan around Paris/.test(typedNote), `the note says it will plan around the typed city (${typedNote})`);
  await page3.click('#suggest-open');
  await page3.click('#suggest-go');
  await page3.waitForFunction(() => /✓|couldn't find|found no|Nothing worth|didn't answer/.test(document.getElementById('import-note').textContent), null, { timeout: 60000 });
  expect(explored.length > 0 && explored.every((c) => Math.abs(Number(c.split('|')[0]) - 48.8566) < 0.01), `planned around Paris, not where the phone is (${explored.join(' ')})`);
  await page3.click('#suggest-open'); // fold the panel again
  await page3.fill('#city', 'Barcelona');
  await page3.dispatchEvent('#city', 'change');
  expect(/plan around where you are/.test(await page3.textContent('#locate-note')), 'back to planning around you');
  // "Which part of town are you staying in?": suggestions, found in the city, and routes start there.
  const BORN = { lat: 41.3851, lon: 2.1823 };
  await page3.route('https://nominatim.openstreetmap.org/search?**', (route) => {
    if (!/^El Born\b/.test(new URL(route.request().url()).searchParams.get('q'))) return route.fallback();
    const born = { lat: String(BORN.lat), lon: String(BORN.lon), name: 'El Born', display_name: 'El Born, Ciutat Vella, Barcelona, Spain', category: 'place', type: 'neighbourhood', addresstype: 'neighbourhood', importance: 0.5, boundingbox: ['41.383', '41.387', '2.179', '2.185'] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([born]) });
  });
  await page3.focus('#area');
  await page3.waitForFunction(() => document.querySelectorAll('#area-options option').length > 0, null, { timeout: 15000 }).catch(() => {});
  const areaOptions = await page3.$$eval('#area-options option', (os) => os.map((o) => o.value));
  expect(['Eixample', 'El Born', 'Gràcia'].every((n) => areaOptions.includes(n)) && !areaOptions.includes('Casa Batlló'), `neighbourhoods suggested, not sights (${areaOptions.join(', ')})`);
  await page3.fill('#area', 'El Born');
  await page3.dispatchEvent('#area', 'change');
  await page3.waitForFunction(() => /start your routes/.test(document.getElementById('locate-note').textContent), null, { timeout: 15000 }).catch(() => {});
  const areaNote = await page3.textContent('#locate-note');
  expect(/El Born, Barcelona: I'll start your routes from there/.test(areaNote), `the part of town is confirmed (${areaNote})`);
  explored.length = 0;
  await page3.click('#suggest-open');
  await page3.click('#suggest-go');
  await page3.waitForFunction(() => /✓|couldn't find|found no|Nothing worth|didn't answer/.test(document.getElementById('import-note').textContent), null, { timeout: 60000 });
  expect(explored.length > 0 && explored.every((c) => Math.abs(Number(c.split('|')[0]) - BORN.lat) < 0.001 && Math.abs(Number(c.split('|')[1]) - BORN.lon) < 0.001), `planned from El Born (${explored.join(' ')})`);
  await page3.click('#suggest-open'); // fold the panel again
  await page3.fill('#area', '');
  await page3.dispatchEvent('#area', 'change');
  // When Wikipedia refuses (it did, for too many requests at once), say so: not "nothing nearby".
  const refuse = (route) => (new URL(route.request().url()).searchParams.get('generator') ? route.fulfill({ status: 429, body: 'Too Many Requests' }) : route.fallback());
  await page3.route('https://*.wikipedia.org/w/api.php?**', refuse);
  await page3.click('#suggest-open');
  await page3.click('#suggest-go');
  await page3.waitForFunction(() => /didn't answer|couldn't find/.test(document.getElementById('import-note').textContent), null, { timeout: 60000 });
  const busyNote = await page3.textContent('#import-note');
  expect(/Wikipedia didn't answer/.test(busyNote), `a busy Wikipedia is reported as such (${busyNote})`);
  await page3.unroute('https://*.wikipedia.org/w/api.php?**', refuse);
  // "How far should I look?": the range chosen is the search radius.
  await page3.click('.chip-opt:has(input[name=range][value="1000"])');
  explored.length = 0;
  await page3.click('#suggest-go');
  await page3.waitForFunction(() => /✓|couldn't find|found no|Nothing worth/.test(document.getElementById('import-note').textContent), null, { timeout: 60000 });
  expect(explored.length > 0 && explored.every((c) => c.endsWith('|1000')), `searched within 1 km (${explored.join(' ')})`);
  await page3.click('.chip-opt:has(input[name=range][value="auto"])');
  await page3.click('#suggest-open'); // fold the panel again
  await page3.click('#suggest-open');
  await page3.click('.chip-opt:has(input[value="240"])');
  await page3.click('#suggest-go');
  await page3.waitForFunction(() => /✓/.test(document.getElementById('import-note').textContent), null, { timeout: 60000 });
  const planned = await page3.evaluate(() => ({
    note: document.getElementById('import-note').textContent,
    summary: document.getElementById('plan-summary').textContent,
    items: [...document.querySelectorAll('#plan-list li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
    stops: document.getElementById('stops').value.split('\n'),
  }));
  console.log('\nScenario 3, suggested half-day route:', planned.note, '|', planned.summary);
  planned.items.forEach((it) => console.log('   ', it));
  expect(mostInFlight <= 2, `at most 2 Wikipedia requests at once (Wikipedia refuses more than 3; saw ${mostInFlight})`);
  await page3.screenshot({ path: path.join(SHOTS, '7-suggested-route.png'), fullPage: true });
  expect(planned.items.length >= 4, `a route with several stops (${planned.items.length})`);
  expect(!planned.items.some((t) => /\((Barcelona|Paris)\)/.test(t)), 'stop names without Wikipedia\'s "(Barcelona)"');
  expect(!/ h 60/.test(planned.summary), `durations read naturally (${planned.summary})`);
  expect(planned.items.length === planned.stops.length, 'the plan and the itinerary box match');
  expect(planned.items.some((t) => /Museum visit/.test(t)), 'a museum visit is on the route');
  expect(planned.items.some((t) => /Coffee break|Lunch|Dinner|A drink/.test(t)), 'a food or drink break is on the route');
  // Food breaks: alternatives you can switch between, and a link to reviews.
  const foodItem = page3.locator('#plan-list li', { has: page3.locator('button.text-btn') }).first();
  expect((await foodItem.count()) === 1, 'a break offers another place');
  if (await foodItem.count()) {
    const before = (await foodItem.locator('strong').textContent()).trim();
    await foodItem.locator('button.text-btn').click();
    const after = (await page3.locator('#plan-list li', { has: page3.locator('button.text-btn') }).first().locator('strong').textContent()).trim();
    const lines = await page3.$eval('#stops', (el) => el.value.split('\n'));
    console.log(`Scenario 3, "Another place": ${before} → ${after}`);
    expect(before !== after && lines.includes(after) && !lines.includes(before), 'swapping a break updates the plan and the itinerary');
    expect(!/\(2\)$/.test(after), 'never swaps to a place already in the plan');
    expect(!/Burger Chain/.test(after) || /^La Petite Table/.test(before), 'chains come last');
  }
  expect((await page3.locator('#plan-list a.text-btn').count()) >= 1, 'breaks link to reviews');
  planned.stops = await page3.$eval('#stops', (el) => el.value.split('\n'));
  await page3.click('label:has(input[value=sim])');
  await page3.selectOption('#sim-speed', '16');
  const said3 = await runTour(null, page3, planned.items.length > 1 ? 'You have arrived at' : 'Welcome');
  const first = said3.find((t) => t.startsWith('You have arrived at'));
  console.log('Scenario 3, first arrival:', first?.slice(0, 90));
  expect(first?.includes(planned.stops[0]), `the tour starts with the first suggested stop (${planned.stops[0]})`);

  expect(errors.length === 0, `no page errors (got ${errors.join(' | ')})`);

  await browser.close();
  server.close();
  console.log('Routes (real / recorded answers):', JSON.stringify(saveRouteCaches()));
  if (failures.length) {
    console.error('\nFAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log(`All checks passed. Screenshots in ${SHOTS}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
