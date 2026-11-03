// Browser test of Roamie Plus, with Plus switched on (a test Polar organisation) and Polar's
// licence API answered here: Plus voices, the free city, unlocking with a key, removing it,
// coming back from the checkout, and nothing locked while Plus is off (the shipped settings).
// Map and Wikipedia answers come from fixtures. Usage: node tests/e2e/plus.cjs

const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork, cspBlocked } = require('./mocks.cjs');

const BARCELONA = { latitude: 41.387, longitude: 2.1701 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const KEY = 'ROAMIE-2CA57A34-E191-4290-A394-ADC2ABC48A7C';
const ON = `export const PLUS_CONFIG = {
  organizationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  checkoutUrl: 'https://buy.polar.sh/polar_cl_test',
  portalUrl: 'https://polar.sh/roamie/portal',
  price: '€9.99', freeCities: 1, sameCityKm: 25, recheckDays: 7,
};`;
const shots = path.join(__dirname, 'screenshots');

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const failures = [];
  const errors = [];
  const expect = (ok, msg) => ok || failures.push(msg);

  const newContext = async ({ plusOn = true, geolocation = BARCELONA } = {}) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      serviceWorkers: 'block',
      geolocation,
      permissions: ['geolocation'],
    });
    await mockNetwork(context);
    if (plusOn) await context.route('**/js/plus-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: ON }));
    // Polar's public licence API: KEY is a real purchase with one phone used so far.
    context.polar = [];
    await context.route('https://api.polar.sh/**', async (route) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const what = new URL(route.request().url()).pathname.split('/').pop();
      const body = JSON.parse(route.request().postData() ?? '{}');
      context.polar.push({ what, body });
      const reply = (status, json) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: json == null ? '' : JSON.stringify(json) });
      if (body.key !== KEY) return reply(404, { error: 'ResourceNotFound', detail: 'Not found' });
      if (what === 'activate') return reply(200, { id: 'act-1', label: body.label, license_key: { status: 'granted', limit_activations: 3 } });
      if (what === 'validate') return reply(200, { status: 'granted' });
      if (what === 'deactivate') return route.fulfill({ status: 204, headers: cors });
      return reply(404, { error: 'ResourceNotFound' });
    });
    return context;
  };
  const openPage = async (context, url = base) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept()); // "Remove Plus from this phone?"
    await page.goto(url);
    return page;
  };
  const dialogOpen = (page) => page.$eval('#plus', (d) => d.open);
  const reason = (page) => page.$eval('#plus-reason', (el) => (el.hidden ? '' : el.textContent));
  const beginRealTour = async (page) => {
    await page.click('#demo'); // the Barcelona sample…
    await page.click('label.tile:has(input[name=source][value=gps])'); // …walked for real
    await page.click('.cta-bar button[type=submit]');
  };

  // ---- 1. Plus voices: listed with a badge, free to hear, a tour offers Plus or the free voice ----
  const context = await newContext();
  const page = await openPage(context);
  expect(await page.isVisible('#plus-open'), 'the Plus button shows in the top bar');
  const badges = await page.$$eval('.guide', (cards) => cards.filter((c) => c.querySelector('.badge-plus')).map((c) => c.dataset.value));
  expect(!badges.includes('neural:supertonic-3:F1'), 'Nora (the free voice) has no Plus badge');
  expect(badges.includes('neural:supertonic-3:M2') && badges.includes('neural:en_GB-jenny_dioco-medium:0'), `Victor and Jenny are Plus voices (${badges})`);
  expect(!badges.some((v) => v.startsWith('system:')), "the phone's voices are free");
  await (await page.$('#guides')).screenshot({ path: path.join(shots, 'plus-0-voices.png') });
  await page.click('#demo');
  await page.click('.guide[data-value="neural:supertonic-3:M2"] label');
  await page.click('.cta-bar button[type=submit]');
  await page.waitForSelector('#plus[open]');
  expect(/Victor is one of the Plus voices\. Nora reads every tour for free/.test(await reason(page)), `reason: ${await reason(page)}`);
  expect(await page.isHidden('#tour'), "the tour didn't start");
  expect((await page.$eval('#plus-buy', (a) => a.href)) === 'https://buy.polar.sh/polar_cl_test', 'Get Plus leads to the Polar checkout');
  expect(/€9\.99/.test(await page.textContent('#plus-buy')), 'the price is on the button');
  await page.screenshot({ path: path.join(shots, 'plus-1-voice.png') });
  await page.click('#plus-alt'); // "Use Nora instead"
  expect(!(await dialogOpen(page)), 'the Plus screen closes');
  expect((await page.$eval('input[name=voice]:checked', (el) => el.value)) === 'neural:supertonic-3:F1', 'Nora is chosen instead');

  // ---- 2. The first city is free: a real tour in Barcelona starts, and Barcelona is remembered ----
  await beginRealTour(page);
  await page.waitForFunction(() => /Tour running/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  const walked = await page.evaluate(() => JSON.parse(localStorage.getItem('roamie:cities')));
  expect(walked?.length === 1 && walked[0].name === 'Barcelona' && walked[0].lat === 41.39, `the free city is Barcelona, roughly (${JSON.stringify(walked)})`);
  await page.click('#btn-end');

  // ---- 3. Another city: the tour stops at the first GPS fix and offers Plus (or the couch) ----
  await context.setGeolocation(PARIS);
  await beginRealTour(page);
  await page.waitForSelector('#plus[open]', { timeout: 30000 });
  expect(/Your free city is Barcelona/.test(await reason(page)), `reason: ${await reason(page)}`);
  expect(await page.isHidden('#tour'), 'back to the planning screen');
  await page.screenshot({ path: path.join(shots, 'plus-2-city.png') });
  await page.click('#plus-alt'); // "Or hear this tour from the couch, free"
  expect((await page.$eval('input[name=source]:checked', (el) => el.value)) === 'sim', '"from the couch" is chosen instead');

  // Located in Paris before tapping: the Plus screen comes straight away, no tour screen at all.
  const page2 = await openPage(context);
  await page2.waitForFunction(() => /You're in/.test(document.getElementById('locate-note').textContent), null, { timeout: 30000 });
  let tourShown = false;
  await page2.exposeFunction('__tourShown', () => (tourShown = true));
  await page2.evaluate(() => new MutationObserver(() => !document.getElementById('tour').hidden && window.__tourShown()).observe(document.getElementById('tour'), { attributes: true }));
  await beginRealTour(page2);
  await page2.waitForSelector('#plus[open]');
  expect(!tourShown, 'located in another city: the tour screen never opens');
  // From the couch, any city is free.
  await page2.click('#plus-close');
  await page2.click('label.tile:has(input[name=source][value=sim])');
  await page2.click('.cta-bar button[type=submit]');
  await page2.waitForFunction(() => /Simulating/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  expect(!(await dialogOpen(page2)), 'a tour from the couch needs no Plus');
  await page2.close();

  // ---- 4. Unlock with a key ----
  await page.click('#plus-open');
  await page.click('#plus-key-box summary');
  await page.fill('#plus-key', 'ROAMIE-0000-WRONG');
  await page.click('#plus-unlock');
  await page.waitForFunction(() => /recognise this key/.test(document.getElementById('plus-note').textContent));
  await page.fill('#plus-key', `${KEY.slice(0, 22)} ${KEY.slice(22)}\n`); // pasted with a stray space
  await page.click('#plus-unlock');
  await page.waitForSelector('#plus-owned:not([hidden])');
  expect(/…8A7C/.test(await page.textContent('#plus-key-hint')), 'shows which key this phone uses');
  expect((await page.textContent('#plus-pill-label')) === 'Plus ✓', 'the top bar shows Plus is on');
  expect(context.polar.some((c) => c.what === 'activate' && c.body.key === KEY && /^Roamie, added \d{4}-\d\d-\d\d$/.test(c.body.label)), 'this phone was counted on the key');
  expect((await page.$$('.badge-plus')).length === 0, 'no more Plus badges on the voices');
  await page.screenshot({ path: path.join(shots, 'plus-3-unlocked.png') });
  await page.click('#plus-close');
  // Now Paris, for real, with Victor.
  await page.click('.guide[data-value="neural:supertonic-3:M2"] label');
  await beginRealTour(page);
  // (The Barcelona walk, from Paris: the guide warns you're far away, and carries on.)
  await page.waitForFunction(() => /Tour running|far from Barcelona/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  expect(!(await dialogOpen(page)) && (await page.isVisible('#tour')), 'with Plus, any city and any voice');
  await page.click('#btn-end');

  // ---- 5. Remove Plus from this phone: its place on the key is freed ----
  await page.click('#plus-open');
  await page.click('#plus-forget');
  await page.waitForSelector('#plus-offer:not([hidden])');
  expect(context.polar.some((c) => c.what === 'deactivate' && c.body.activation_id === 'act-1'), 'the phone was freed on Polar');
  expect(/free again/.test(await page.textContent('#plus-note')), 'says the place is free again');
  await page.click('#plus-close');

  // ---- 6. Back from the checkout: asks for the key; the address is tidied ----
  const page3 = await openPage(context, `${base}?plus=thanks&tour=paris`);
  await page3.waitForSelector('#plus[open]');
  expect(await page3.$eval('#plus-key-box', (d) => d.open), 'the key box is open');
  expect(/Thank you/.test(await page3.textContent('#plus-note')), 'thanks the buyer');
  expect(new URL(page3.url()).search === '?tour=paris', `?plus=thanks is removed, the rest kept (${page3.url()})`);
  const blocked = [...(await cspBlocked(page)), ...(await cspBlocked(page3))];
  expect(!blocked.length, `nothing blocked by the security policy (${blocked})`);
  await context.close();

  // ---- 7. Plus switched off (as shipped): nothing shown, nothing locked, nothing remembered ----
  const off = await newContext({ plusOn: false, geolocation: PARIS });
  const page4 = await openPage(off);
  expect(await page4.isHidden('#plus-open'), 'no Plus button while Plus is off');
  expect((await page4.$$('.badge-plus')).length === 0, 'no Plus badges while Plus is off');
  await page4.click('#demo');
  await page4.click('.guide[data-value="neural:supertonic-3:M2"] label');
  await page4.click('label.tile:has(input[name=source][value=gps])');
  await page4.click('.cta-bar button[type=submit]');
  await page4.waitForFunction(() => /Tour running|far from Barcelona/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  expect(!(await dialogOpen(page4)), 'every voice and city is free while Plus is off');
  expect((await page4.evaluate(() => localStorage.getItem('roamie:cities'))) === null, 'no city history while Plus is off');
  expect(off.polar.length === 0, 'Polar is never contacted while Plus is off');
  await off.close();

  await browser.close();
  server.close();
  if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);
  if (failures.length) {
    console.error(`FAILED:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Plus: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
