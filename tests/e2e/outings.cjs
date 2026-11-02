// Browser test of outings by interest: pick what you'd like to see and the kind of outing, get
// up to three itineraries, choose one; a hike, a food walk, more durations and a longer range.
// Map, Wikipedia and OpenStreetMap answers come from fixtures (plus a few parks and viewpoints).
// Usage: node tests/e2e/outings.cjs

const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork, cspBlocked } = require('./mocks.cjs');

// Barcelona's green side, as Wikipedia's search would answer "park OR garden OR viewpoint…".
const NATURE = [
  { pageid: 990001, title: 'Parc de la Ciutadella', description: 'park in Barcelona', lat: 41.3881, lon: 2.1873, langs: 30, length: 14000 },
  { pageid: 990002, title: 'Park Güell', description: 'public park in Barcelona', lat: 41.4145, lon: 2.1527, langs: 60, length: 30000 },
  { pageid: 990003, title: 'Jardins de Laribal', description: 'garden in Montjuïc, Barcelona', lat: 41.3695, lon: 2.1595, langs: 6, length: 5000 },
  { pageid: 990004, title: 'Montjuïc', description: 'hill in Barcelona', lat: 41.3636, lon: 2.1586, langs: 45, length: 26000 },
  { pageid: 990005, title: 'Bunkers del Carmel', description: 'viewpoint over Barcelona', lat: 41.4192, lon: 2.1617, langs: 8, length: 4000 },
  { pageid: 990006, title: 'Barceloneta Beach', description: 'beach in Barcelona', lat: 41.3784, lon: 2.1925, langs: 12, length: 6000 },
];
const shots = path.join(__dirname, 'screenshots');

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    serviceWorkers: 'block',
    geolocation: { latitude: 41.387, longitude: 2.1701 },
    permissions: ['geolocation'],
  });
  await mockNetwork(context);
  // A Tuesday at 9:30: breaks follow the clock (a drink at 5 pm, a local taste in the morning).
  await context.clock.setFixedTime(new Date('2026-11-03T09:30:00'));
  const themed = [];
  await context.route('https://*.wikipedia.org/w/api.php?**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('gsrsearch') ?? '';
    if (/ OR /.test(q)) themed.push(q.split(' nearcoord')[0]);
    if (!/park OR garden/.test(q)) return route.fallback();
    const pages = NATURE.map((p, i) => ({
      pageid: p.pageid,
      title: p.title,
      index: i + 1,
      length: p.length,
      description: p.description,
      langlinkscount: p.langs,
      coordinates: [{ lat: p.lat, lon: p.lon, primary: true, type: 'landmark' }],
    }));
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ query: { pages } }) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const failures = [];
  const expect = (ok, msg) => ok || failures.push(msg);
  const panel = async (open) => {
    if ((await page.$eval('#suggest-panel', (el) => !el.hidden)) !== open) await page.click('#suggest-open');
  };
  const note = () => page.textContent('#import-note');

  await page.goto(base);
  await page.click('#locate-me');
  await page.waitForFunction(() => /You're in Barcelona/.test(document.getElementById('locate-note').textContent), null, { timeout: 30000 });
  await panel(true);

  // ---- More lengths and a longer range ----
  const durations = await page.$$eval('input[name=duration]', (els) => els.map((e) => Number(e.value)));
  expect(durations.join() === '30,45,60,90,120,180,240,360,480,600', `durations: ${durations}`);
  await page.click('label.chip-opt:has(input[name=outing][value=drive])');
  await page.click('label.chip-opt:has(input[name=duration][value="480"])');
  const driveRange = await page.textContent('#range-value');
  expect(/^5\d(\.\d)? km$|^6\d km$/.test(driveRange), `a day's drive looks ~60 km away (${driveRange})`);
  expect((await page.$eval('#range', (r) => r.max)) === '14' && /100 km/.test(await page.textContent('.range-scale')), 'the slider goes to 100 km');
  expect(await page.isChecked('input[name=mode][value=drive]'), '"Scenic drive" sets the travel mode to driving');

  // ---- A landscapes hike: three itineraries to choose from ----
  await page.click('label.chip-opt:has(input[name=interest][value=landscape])');
  await page.click('label.chip-opt:has(input[name=outing][value=hike])');
  await page.click('label.chip-opt:has(input[name=duration][value="240"])');
  expect(await page.isChecked('input[name=mode][value=hike]'), '"Hike" sets the travel mode (the Hike tile)');
  expect(await page.isVisible('#hike-note'), 'the hike safety note shows');
  await page.screenshot({ path: path.join(shots, 'outings-1-choices.png'), fullPage: false });
  await page.click('#suggest-go');
  await page.waitForSelector('#proposals:not([hidden]) .proposal', { timeout: 90000 });
  const cards = await page.$$eval('.proposal', (els) =>
    els.map((e) => ({ title: e.querySelector('.proposal-title').textContent, kicker: e.querySelector('.proposal-kicker').textContent, stops: e.querySelector('.proposal-stops').textContent })),
  );
  console.log('Itineraries:', JSON.stringify(cards, null, 1));
  expect(cards.length >= 2 && cards.length <= 3, `two or three itineraries (${cards.length})`);
  expect(cards[0].title === 'Parks, views and nature', `the first is about landscapes (${cards[0].title})`);
  expect(/^Hike · about /.test(cards[0].kicker), `it says it's a hike, with its length (${cards[0].kicker})`);
  expect(NATURE.some((n) => cards[0].stops.includes(n.title)), `the landscapes itinerary goes to parks and viewpoints (${cards[0].stops})`);
  expect(themed.some((q) => /park OR garden/.test(q)), 'Wikipedia was asked for parks and viewpoints');
  expect(await page.isHidden('#suggest-panel'), 'the options fold away to show the choices');
  await (await page.$('#proposals')).screenshot({ path: path.join(shots, 'outings-2-itineraries.png') });
  // Choose the first.
  await page.click('.proposal:first-of-type button');
  await page.waitForFunction(() => /✓/.test(document.getElementById('import-note').textContent), null, { timeout: 90000 });
  expect(/picked for parks, views and nature/.test(await note()), `the note names the choice (${await note()})`);
  expect(await page.isHidden('#proposals'), 'the choices close once one is chosen');
  // Not the same time everywhere: each place shows how long to stay, and the times differ.
  const stays = await page.$$eval('#plan-list li small', (els) => els.map((e) => e.textContent).filter((t) => / here( ·|$)/.test(t)).map((t) => t.split(' here')[0]));
  expect(stays.length >= 2 && new Set(stays).size >= 2, `different times at different places (${stays.join(', ')})`);
  const stops = await page.$eval('#stops', (t) => t.value);
  expect(NATURE.some((n) => stops.includes(n.title)), `the itinerary box has the chosen stops (${stops.replace(/\n/g, ' | ')})`);
  expect(!(await page.isHidden('#plan')), 'the plan shows');

  // ---- A food walk: tasting stops ----
  await panel(true);
  await page.click('label.chip-opt:has(input[name=interest][value=landscape])'); // off
  await page.click('label.chip-opt:has(input[name=interest][value=food])');
  await page.click('label.chip-opt:has(input[name=outing][value=walk])');
  await page.click('label.chip-opt:has(input[name=duration][value="180"])');
  await page.evaluate(() => (document.getElementById('import-note').textContent = '')); // not the hike's "✓"
  await page.click('#suggest-go');
  await page.waitForFunction(() => !document.getElementById('proposals').hidden || /✓|couldn't|found no|Nothing/.test(document.getElementById('import-note').textContent), null, { timeout: 90000 });
  if (!(await page.isHidden('#proposals'))) {
    const foodCards = await page.$$eval('.proposal', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    console.log('Food itineraries:', foodCards);
    expect(foodCards.some((t) => /local taste about every hour/.test(t)), 'a food itinerary promises tasting stops');
    expect(/Markets and local flavours/.test(foodCards[0]), `the first is about food (${foodCards[0]})`);
    await page.evaluate(() => (document.getElementById('import-note').textContent = ''));
    await page.click('.proposal:first-of-type button');
  }
  await page.waitForFunction(() => /✓/.test(document.getElementById('import-note').textContent), null, { timeout: 90000 });
  expect(/picked for markets and local flavours/.test(await note()), `the food walk is the one chosen (${await note()})`);
  const planText = await page.$eval('#plan-list', (l) => l.innerText);
  expect(/A local taste/.test(planText), `the food walk stops for a local taste (${planText.replace(/\s+/g, ' ').slice(0, 300)})`);
  // Remembered for next time.
  await page.reload();
  await page.waitForTimeout(800);
  expect(await page.isChecked('input[name=interest][value=food]'), 'interests are remembered');
  expect(await page.isChecked('input[name=outing][value=walk]') && (await page.isChecked('input[name=mode][value=walk]')), 'the outing is remembered');

  const blocked = await cspBlocked(page);
  expect(!blocked.length, `nothing blocked by the security policy (${blocked})`);
  if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);
  await browser.close();
  server.close();
  if (failures.length) {
    console.error(`FAILED:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Outings: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
