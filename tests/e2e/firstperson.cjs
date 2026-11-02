// Browser test of first-person tours: a trip simulated from the sofa opens in first person (the
// streets in 3D, facing the way you go, signposts for the stops and places), the "Map" button
// switches to the top view and back, and the choice is remembered.
// Usage: node tests/e2e/firstperson.cjs

const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork, cspBlocked } = require('./mocks.cjs');

const shots = path.join(__dirname, 'screenshots');

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', serviceWorkers: 'block' });
  await mockNetwork(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const failures = [];
  const expect = (ok, msg) => ok || failures.push(msg);

  await page.goto(base);
  await page.click('#demo');
  await page.click('label:has(input[value=sim])');
  await page.selectOption('#sim-speed', '4');
  await page.click('#guides .guide[data-value="system:"] label');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('#journal li').length >= 1, null, { timeout: 90000 });

  // ---- A simulated trip opens in first person ----
  expect(!(await page.$eval('#street', (e) => e.hidden)), 'a simulated trip opens in first person');
  expect(/Map/.test(await page.textContent('#view-label')), 'the button offers the top map');
  await page.waitForSelector('#street canvas', { timeout: 30000 });
  // Walking: the camera follows, and the stops and places ahead stand as signposts.
  await page.waitForFunction(() => document.querySelectorAll('.fp-sign:not([hidden])').length >= 2, null, { timeout: 60000 });
  const signs = await page.$$eval('.fp-sign:not([hidden])', (els) => els.map((e) => e.textContent.trim()));
  console.log('Signposts ahead:', signs);
  expect(signs.some((t) => /^\d/.test(t)), `a numbered stop ahead (${signs})`);
  const pitch = await page.evaluate(() => document.querySelector('#street .maplibregl-canvas') && true);
  expect(pitch, 'the 3D view is drawn');
  const before = await page.$eval('#street', (e) => e.querySelector('.fp-sign:not([hidden])')?.getBoundingClientRect().top ?? null);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(shots, 'firstperson-1-street.png'), clip: { x: 0, y: 0, width: 390, height: 640 } });
  const after = await page.$eval('#street', (e) => e.querySelector('.fp-sign:not([hidden])')?.getBoundingClientRect().top ?? null);
  expect(before !== after, 'the view moves as you go');
  // Its own map credits, as plain text links.
  expect(/OpenStreetMap/.test(await page.textContent('.street-credit')), 'map credits show in first person');

  // ---- Switch to the top map, and back ----
  await page.click('#view-toggle');
  await page.waitForTimeout(800);
  expect(await page.$eval('#street', (e) => e.hidden), '"Map" shows the top view');
  expect(!(await page.$('#street canvas')), 'the 3D view is not kept drawing in the background');
  expect(/First person/.test(await page.textContent('#view-label')), 'the button offers first person again');
  expect((await page.evaluate(() => localStorage.getItem('roamie:view'))) === 'map', 'the choice is remembered');
  await page.click('#view-toggle');
  await page.waitForSelector('#street canvas', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.fp-sign:not([hidden])').length >= 1, null, { timeout: 30000 });
  expect(true, 'back in first person, mid-tour, with the signposts');
  await page.click('#btn-end');
  expect(await page.$eval('#street', (e) => e.hidden) && !(await page.$('#street canvas')), 'ending the tour closes the 3D view');

  const blocked = await cspBlocked(page);
  expect(!blocked.length, `nothing blocked by the security policy (${blocked})`);
  if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);
  await browser.close();
  server.close();
  if (failures.length) {
    console.error(`FAILED:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('First person: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
