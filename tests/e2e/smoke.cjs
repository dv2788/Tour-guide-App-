// Browser smoke test: runs the sample Paris walk in simulation mode on a phone-sized
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
  const browser = await chromium.launch();
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

  // Records everything the guide says, then runs the tour until the Louvre.
  async function runTour(shotPrefix, page = mainPage, until = 'You have arrived at Louvre Museum') {
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
        status: document.getElementById('status').textContent,
      };
    });
    console.log('Directions:', JSON.stringify(nav));
    expect(/head|turn|bear|keep|continue|just ahead/i.test(nav.sentence), `a direction is shown (${nav.sentence})`);
    expect(!/Rue du Test|Quai des Essais/.test(nav.sentence), 'directions name real streets');
    expect(nav.navLinePoints >= 6, `the way to the next stop follows the streets (${nav.navLinePoints} points)`);
    expect(!/didn't answer/.test(nav.status), 'the tour route follows the streets');
    expect(/maps/.test(nav.link), 'open-in-maps link');
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
  await page.click('#demo');
  await page.screenshot({ path: path.join(SHOTS, '1-setup.png'), fullPage: true });
  const said = await runTour('2');
  console.log('\nScenario 1, typed itinerary. The guide said:\n');
  said.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t}\n`));
  expect(said[0]?.startsWith('Welcome to Paris.'), 'starts with a welcome to Paris');
  const arrivals = arrivalsIn(said);
  expect(
    JSON.stringify(arrivals) === JSON.stringify(['Eiffel Tower', "Pont de l'Alma", 'Grand Palais', 'Place de la Concorde', 'Louvre Museum']),
    `arrives at every stop in order (got ${JSON.stringify(arrivals)})`,
  );
  expect(said.some((t) => /^(On your (left|right)|Ahead of you|Just behind you): /.test(t)), 'mentions places passed on the way');
  expect(!said.some((t) => /Great Palace|Concorde Square/.test(t)), 'uses the names the traveller typed');
  expect(!said.some((t) => /Bir-Hakeim/.test(t)), 'skips metro stations');
  expect(!said.some((t) => /\bRER\b|railway station/i.test(t)), "describes the Pont de l'Alma bridge, not the station");

  // ---- Scenario 2: paste a Google Maps walking route ----
  const g = (q) => fixtures.nominatim[q][0];
  const [eiffel, palais, louvre] = [g('Eiffel Tower'), g('Grand Palais'), g('Louvre Museum')];
  const googleLink =
    'https://www.google.com/maps/dir/Eiffel+Tower,+Av.+Gustave+Eiffel,+75007+Paris,+France/Grand+Palais,+3+Av.+du+G%C3%A9n%C3%A9ral+Eisenhower,+75008+Paris,+France/Louvre+Museum,+Rue+de+Rivoli,+75001+Paris,+France/@48.8606,2.3092,14z/data=!3m1!4b1!4m20!4m19' +
    [eiffel, palais, louvre].map((p) => `!1m5!1m1!1s0x0:0x0!2m2!1d${p.lon}!2d${p.lat}`).join('') +
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
  expect(imported.stops === 'Eiffel Tower\nGrand Palais\nLouvre Museum', `pasted link becomes stops (got ${JSON.stringify(imported.stops)})`);
  expect(imported.mode === 'walk', 'travel mode taken from the link');
  expect(imported.city === 'Paris', 'city worked out from the stops');
  await page.click('label:has(input[value=sim])');
  await page.selectOption('#sim-speed', '8');
  const said2 = await runTour();
  console.log('\nScenario 2. Arrivals:', JSON.stringify(arrivalsIn(said2)));
  expect(
    JSON.stringify(arrivalsIn(said2)) === JSON.stringify(['Eiffel Tower', 'Grand Palais', 'Louvre Museum']),
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
    geolocation: { latitude: 48.8656, longitude: 2.3212 }, // Place de la Concorde
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
  await page3.waitForFunction(() => /You're in Paris/.test(document.getElementById('locate-note').textContent), null, { timeout: 30000 });
  expect((await page3.$eval('#city', (el) => el.value)) === 'Paris', 'city filled in from the location');
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
  await page3.screenshot({ path: path.join(SHOTS, '7-suggested-route.png'), fullPage: true });
  expect(planned.items.length >= 4, `a route with several stops (${planned.items.length})`);
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
