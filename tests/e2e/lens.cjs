// Browser test for "Point your camera": a fake camera, GPS across the avenue from Casa Batlló,
// and the compass turned by hand. Checks the labels, the card, the story pop-up, guiding to a
// place (arrow, then the pop-up once it's in front of you) and the camera button during a tour.
// Run: node tests/e2e/lens.cjs   (OFFLINE=1 replays recorded routes)
const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork, saveRouteCaches } = require('./mocks.cjs');
const fixtures = require('./fixtures.json');

const SHOTS = path.join(__dirname, 'screenshots');
const failures = [];
const expect = (ok, msg) => ok || failures.push(msg);
const at = (title) => fixtures.geosearch.find((p) => p.title === title).coordinates[0];

(async () => {
  const { bearingDegrees } = await import('../../js/geo.js');
  const { declination } = await import('../../js/declination.js');
  const BATLLO = at('Casa Batlló');
  const MORERA = at('Casa Lleó Morera');
  // Passeig de Gràcia runs south-east to north-west; the three houses stand side by side on its
  // south-west side (Casa Lleó Morera 60 m down from Casa Batlló). Stand across the avenue,
  // 40 m north-east of Casa Batlló, facing it.
  const M_LON = 111320 * Math.cos((BATLLO.lat * Math.PI) / 180);
  const across = {
    latitude: BATLLO.lat + (Math.cos((45 * Math.PI) / 180) * 40) / 111320,
    longitude: BATLLO.lon + (Math.sin((45 * Math.PI) / 180) * 40) / M_LON,
  };
  const here = { lat: across.latitude, lon: across.longitude };
  const toBatllo = bearingDegrees(here, BATLLO);

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    serviceWorkers: 'block',
    permissions: ['geolocation', 'camera'],
    geolocation: { ...across, accuracy: 8 },
  });
  await mockNetwork(context, { routeCacheName: 'lens' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Turn the phone (held upright) to face a heading: an Android "absolute" orientation event,
  // which, like a real compass, is relative to magnetic north (the app turns it to true north).
  const DECLINATION = declination(BATLLO.lat, BATLLO.lon);
  const face = (heading) =>
    page.evaluate((alpha) => {
      for (let i = 0; i < 3; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha, beta: 90, gamma: 0, absolute: true }));
    }, (((360 - (heading - DECLINATION)) % 360) + 360) % 360);
  const text = (sel) => page.$eval(sel, (el) => el.textContent).catch(() => '');

  await page.goto(base);
  await page.click('#lens-open');
  await face(toBatllo);
  await page.waitForFunction(() => /Casa Batlló/.test(document.getElementById('lens-card')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  await face(toBatllo);
  await page.waitForTimeout(400);
  const view = await page.evaluate(() => ({
    card: document.getElementById('lens-card').textContent,
    labels: [...document.querySelectorAll('.lens-label strong')].map((s) => s.textContent),
    camera: Boolean(document.getElementById('lens-video').srcObject?.active),
  }));
  console.log('Pointing at Casa Batlló:', JSON.stringify(view));
  expect(view.camera, 'the camera is on');
  expect(/Casa Batlló/.test(view.card), `the card names what's in the middle (${view.card})`);
  expect(view.labels.includes('Casa Amatller'), `the house next door is labelled too (${view.labels.join(', ')})`);
  expect(!view.labels.some((l) => /station/i.test(l)), 'no metro stations');
  await page.screenshot({ path: path.join(SHOTS, 'lens-1-pointing.png') });

  // "Read more": the little window with its story.
  await page.click('#lens-card button:has-text("Read more")');
  await page.waitForFunction(() => /building in the center of Barcelona/.test(document.getElementById('lens-popup')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const popup = await page.evaluate(() => ({
    text: document.getElementById('lens-popup').textContent,
    link: document.querySelector('#lens-popup a')?.href ?? null,
    hear: Boolean([...document.querySelectorAll('#lens-popup button')].find((b) => /Hear its story/.test(b.textContent))),
  }));
  expect(/Casa Batlló is a building/.test(popup.text) && popup.hear && /wikipedia\.org/.test(popup.link ?? ''), `the window tells its story, with "Hear" and "Read more" (${popup.text.slice(0, 80)} | ${popup.link})`);
  expect(/From Wikipedia · CC BY-SA 4\.0/.test(popup.text), "the window credits Wikipedia, as its licence asks");
  await page.screenshot({ path: path.join(SHOTS, 'lens-2-story.png') });
  // Keyboard: the story window has the focus; Escape closes it (and only it).
  expect(await page.evaluate(() => document.activeElement?.id === 'lens-popup'), 'the story window takes the focus');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.getElementById('lens-popup').hidden && !document.getElementById('lens').hidden), 'Escape closes the story window, not the camera');

  // Guide me to Casa Lleó Morera: face it, ask to be guided, turn away, follow the arrow back.
  const toMorera = bearingDegrees(here, MORERA);
  await face(toMorera);
  await page.waitForFunction(() => /Lleó Morera/.test(document.getElementById('lens-card')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  await page.click('#lens-card button:has-text("Guide me there")');
  await face(toBatllo);
  await page.waitForTimeout(400);
  const guiding = { looking: await text('#lens-target-name'), where: await text('#lens-target-where'), popupOpen: await page.$eval('#lens-popup', (el) => !el.hidden) };
  console.log(`Looking for Casa Lleó Morera (at ${Math.round(toMorera)}°), facing Casa Batlló (${Math.round(toBatllo)}°):`, JSON.stringify(guiding));
  expect(guiding.looking === 'Casa Lleó Morera' && /^Turn left/.test(guiding.where), `the arrow says which way to turn (${guiding.where})`);
  expect(!guiding.popupOpen, 'nothing pops up before it is found');
  await page.screenshot({ path: path.join(SHOTS, 'lens-3-guiding.png') });
  await face(toMorera);
  await page.waitForTimeout(800);
  await face(toMorera);
  await page.waitForFunction(() => /Lleó Morera is a building/.test(document.getElementById('lens-popup')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const found = { where: await text('#lens-target-where'), popup: await text('#lens-popup'), status: await text('#lens-status') };
  console.log('Facing it:', JSON.stringify({ ...found, popup: found.popup.slice(0, 70) }));
  expect(/^Ahead/.test(found.where) && /Lleó Morera is a building/.test(found.popup), `found: the window pops up by itself (${found.where})`);
  await page.screenshot({ path: path.join(SHOTS, 'lens-4-found.png') });
  await page.keyboard.press('Escape'); // the story window
  await page.keyboard.press('Escape'); // the camera view
  expect(await page.$eval('#lens', (el) => el.hidden), 'closing the camera view with Escape');
  expect(await page.evaluate(() => document.activeElement?.id === 'lens-open'), 'the focus goes back to the button that opened it');
  expect(!(await page.evaluate(() => Boolean(document.getElementById('lens-video').srcObject))), 'the camera is turned off when closed');

  // During a tour: the camera button looks for the next stop.
  await page.click('#demo');
  await page.click('#guides .guide[data-value="system:"] label');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => /min/.test(document.getElementById('nav-target')?.textContent ?? ''), null, { timeout: 90000 }).catch(() => {});
  const nextStop = (await text('#nav-target')).split(' · ')[0];
  await page.click('#nav-lens');
  await page.waitForTimeout(500);
  const fromTour = await text('#lens-target-name');
  console.log(`From the tour: next stop "${nextStop}", camera looking for "${fromTour}"`);
  expect(fromTour && fromTour === nextStop, `the camera looks for the tour's next stop (${fromTour} / ${nextStop})`);
  expect(errors.length === 0, `no page errors (${errors.join(' | ')})`);

  await browser.close();
  server.close();
  console.log('Routes (real / recorded answers):', JSON.stringify(saveRouteCaches()));
  if (failures.length) {
    console.error('\nFAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('All camera checks passed.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
