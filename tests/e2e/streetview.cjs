// Browser test of Street View in first person, with a stand-in for Google's script (no key, no
// Google): one viewer per tour, the photo where Google has one and the 3D map where it hasn't,
// signposts on the photo, Roamie's maps hidden while a photo shows, the credits area kept clear,
// nothing blocked by either page's security policy.
// Usage: node tests/e2e/streetview.cjs

const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork, cspBlocked } = require('./mocks.cjs');

const shots = path.join(__dirname, 'screenshots');

// What Google's script would provide, as far as Roamie uses it. Photos exist south of 41.3895
// (the first 250 metres of the walk have none: the 3D map must show there).
const GOOGLE_STUB = `
(() => {
  const S = (window.__sv = { panoramas: 0, lookups: 0, setPano: 0, povs: [] });
  class LatLng { constructor(a, b) { if (typeof a === 'object') { this._lat = a.lat; this._lng = a.lng; } else { this._lat = a; this._lng = b; } } lat() { return this._lat; } lng() { return this._lng; } }
  class OverlayView {
    setMap(m) { if (m) { this._map = m; m._overlays.push(this); this.onAdd(); this.draw(); } else if (this._map) { this._map._overlays = this._map._overlays.filter((o) => o !== this); this.onRemove(); this._map = null; } }
    getPanes() { return this._map._panes; }
    getProjection() { return this._map._projection; }
  }
  class StreetViewService {
    getPanorama(req) {
      S.lookups++;
      const { lat, lng } = req.location;
      if (lat > 41.3895) return Promise.reject(Object.assign(new Error('ZERO_RESULTS'), { code: 'ZERO_RESULTS' }));
      return Promise.resolve({ data: { location: { pano: 'pano-' + Math.round(lat * 1e4) + '-' + Math.round(lng * 1e4), latLng: new LatLng(lat, lng) } } });
    }
  }
  class StreetViewPanorama {
    constructor(el, opts) {
      S.panoramas++;
      this.el = el; this._overlays = []; this._pov = { ...(opts.pov || { heading: 0, pitch: 0 }) }; this._listeners = {};
      el.style.cssText += ';position:relative;background:linear-gradient(#b9d6ea, #8a8578 55%, #3b3a37)';
      this.label = document.createElement('div'); this.label.className = 'stub-pano'; this.label.style.cssText = 'position:absolute;left:8px;top:8px;color:#fff;font:12px sans-serif;z-index:1'; el.append(this.label);
      const panes = document.createElement('div'); panes.style.cssText = 'position:absolute;inset:0'; el.append(panes);
      this._panes = { overlayMouseTarget: panes, overlayLayer: panes };
      this._projection = { fromLatLngToDivPixel: (ll) => {
        if (!this._pos) return null;
        const dx = (ll.lng() - this._pos.lng) * 111320 * Math.cos((this._pos.lat * Math.PI) / 180);
        const dy = (ll.lat() - this._pos.lat) * 111320;
        const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
        const off = ((((bearing - this._pov.heading) % 360) + 540) % 360) - 180;
        const d = Math.hypot(dx, dy);
        return { x: el.clientWidth / 2 + (off / 45) * (el.clientWidth / 2), y: el.clientHeight * 0.55 + Math.min(80, 2000 / Math.max(d, 10)) };
      } };
    }
    setPano(id) { S.setPano++; this._pano = id; this.label.textContent = 'Street View stand-in · ' + id; const m = id.match(/pano-(-?\\d+)-(-?\\d+)/); if (m) this._pos = { lat: m[1] / 1e4, lng: m[2] / 1e4 }; this._fire('pano_changed'); this._fire('position_changed'); this._redraw(); }
    getPano() { return this._pano; }
    setPov(p) { this._pov = { ...this._pov, ...p }; S.povs.push(this._pov.heading); this._fire('pov_changed'); this._redraw(); }
    getPov() { return this._pov; }
    getPosition() { return this._pos ? new LatLng(this._pos) : null; }
    getStatus() { return 'OK'; }
    setVisible() {} setOptions() {}
    addListener(n, f) { (this._listeners[n] ||= []).push(f); return { remove() {} }; }
    _fire(n) { for (const f of this._listeners[n] || []) f(); }
    _redraw() { for (const o of this._overlays) o.draw(); }
  }
  window.google = { maps: { LatLng, OverlayView, StreetViewService, StreetViewPanorama } };
  const cb = new URL(document.currentScript.src).searchParams.get('callback');
  if (cb && window[cb]) setTimeout(() => window[cb](), 0);
})();`;

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', serviceWorkers: 'block' });
  await mockNetwork(context);
  // A key is set (in the test only), and "Google's script" is the stand-in above.
  await context.route('**/js/streetview-config.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: "export const STREET_VIEW_CONFIG = { apiKey: 'test-key', radius: 40, stepMeters: 5, freeLookSeconds: 8 };" }),
  );
  const googleRequests = [];
  await context.route('https://maps.googleapis.com/**', (route) => {
    googleRequests.push(route.request().url());
    route.fulfill({ contentType: 'text/javascript', body: GOOGLE_STUB });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const failures = [];
  const expect = (ok, msg) => ok || failures.push(msg);
  const frame = () => page.frames().find((f) => /streetview\.html/.test(f.url()));

  await page.goto(base);
  await page.click('#demo');
  await page.click('label:has(input[value=sim])');
  await page.selectOption('#sim-speed', '4');
  await page.click('#guides .guide[data-value="system:"] label');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('#journal li').length >= 1, null, { timeout: 90000 });

  // ---- The Street View page opens inside first person, with the key ----
  // (The frame stays out of sight until Google has a photo: attached, not yet visible.)
  await page.waitForSelector('iframe.street-photo-frame', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('iframe.street-photo-frame')].every((f) => f.contentWindow?.google), null, { timeout: 30000 }).catch(() => {});
  expect(googleRequests.length === 1 && /key=test-key/.test(googleRequests[0]) && /callback=/.test(googleRequests[0]), `Google's script is asked for once, with the key (${googleRequests.length})`);

  // ---- No photo at the start of the walk: the 3D map shows ----
  await page.waitForFunction(() => document.querySelector('#street canvas'), null, { timeout: 60000 });
  await frame().waitForFunction(() => window.__sv?.lookups >= 1, null, { timeout: 60000 });
  expect(!(await page.$eval('#street', (e) => e.classList.contains('photos'))), 'where Google has no photo, the 3D map shows');
  expect((await page.$eval('#map', (e) => getComputedStyle(e).visibility)) === 'visible', 'with no photo showing, the map underneath stays as it was');

  // ---- Then photos: they cover the 3D map, Roamie's maps are hidden, signposts stand on the photo ----
  await page.waitForFunction(() => document.getElementById('street').classList.contains('photos'), null, { timeout: 90000 });
  const sv = await frame().evaluate(() => window.__sv);
  console.log('Street View stand-in:', { panoramas: sv.panoramas, lookups: sv.lookups, setPano: sv.setPano, lastHeading: sv.povs.at(-1) });
  expect(sv.panoramas === 1, `one viewer (${sv.panoramas})`);
  expect(sv.setPano >= 1, 'a photo was shown');
  expect((await page.$eval('#map', (e) => getComputedStyle(e).visibility)) === 'hidden', "Roamie's map is hidden while a photo shows (Google's rule)");
  expect((await page.$eval('#street .street-map', (e) => getComputedStyle(e).visibility)) === 'hidden', 'the 3D map is hidden under the photo');
  expect((await page.$eval('.street-credit', (e) => getComputedStyle(e).visibility)) === 'hidden', "the 3D map's credit line is hidden too");
  await frame().waitForFunction(() => document.querySelectorAll('.fp-sign:not([hidden])').length >= 1, null, { timeout: 30000 });
  const signs = await frame().$$eval('.fp-sign:not([hidden])', (els) => els.map((e) => e.textContent.trim()));
  console.log('Signposts on the photo:', signs);
  expect(signs.some((t) => /^\d/.test(t)), `a numbered stop stands on the photo (${signs})`);
  const btn = await page.$eval('#view-toggle', (e) => e.getBoundingClientRect());
  expect(Math.abs(btn.x + btn.width / 2 - 195) < 20, `the "Map" button is in the middle, clear of Google's logo and credits (centre at ${Math.round(btn.x + btn.width / 2)})`);
  const label = await frame().$eval('.stub-pano', (e) => e.textContent);
  expect(/pano-/.test(label), 'the photo for where you are');
  await page.screenshot({ path: path.join(shots, 'streetview-1-photo.png'), clip: { x: 0, y: 0, width: 390, height: 640 } });
  const heading = sv.povs.at(-1);
  expect(heading != null && heading > 120 && heading < 260, `facing along the street, south-west down Passeig de Gràcia (${heading})`);

  // ---- Map and back: the same viewer, not a second one (that's what Google bills) ----
  await page.click('#view-toggle');
  await page.waitForTimeout(600);
  expect(await page.$eval('#street', (e) => e.hidden), '"Map" shows the top view');
  expect((await page.$eval('#map', (e) => getComputedStyle(e).visibility)) === 'visible', 'the map is back');
  expect(Boolean(await page.$('iframe.street-photo-frame')), 'the Street View page is kept for the tour');
  await page.click('#view-toggle');
  await page.waitForFunction(() => !document.getElementById('street').hidden && document.getElementById('street').classList.contains('photos'), null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const again = await frame().evaluate(() => window.__sv);
  expect(again.panoramas === 1, `still one viewer after switching back (${again.panoramas})`);
  expect(again.setPano > sv.setPano || again.lookups > sv.lookups, 'and it goes on following you');

  // ---- Both pages' security policies hold; ending the tour closes the page ----
  const blockedMain = await cspBlocked(page);
  const blockedFrame = await frame().evaluate(() => window.__cspBlocked ?? []);
  expect(!blockedMain.length, `nothing blocked in the app (${blockedMain})`);
  expect(!blockedFrame.length, `nothing blocked in the Street View page (${blockedFrame})`);
  await page.click('#btn-end');
  await page.waitForTimeout(500);
  expect(!(await page.$('iframe.street-photo-frame')), 'ending the tour closes the Street View page');

  // ---- Opened on its own, the page does nothing ----
  const lone = await context.newPage();
  await lone.goto(`${base}streetview.html`);
  await lone.waitForTimeout(800);
  expect(/part of Roamie/.test(await lone.textContent('#note')), 'opened directly, the page just says what it is');
  expect(googleRequests.length === 1, "and doesn't load Google's script");

  if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);
  await browser.close();
  server.close();
  if (failures.length) {
    console.error(`FAILED:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Street View: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
