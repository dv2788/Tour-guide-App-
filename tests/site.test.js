import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SAMPLES, REGIONS } from '../js/samples.js';

// The pages search engines read must match the sample tours (run `npm run build:site` after editing them).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
// Tours whose page waits for Wikipedia (it was too busy at the last build): in the app, no page yet.
const WAITING = existsSync(new URL('../tours/waiting.json', import.meta.url)) ? JSON.parse(read('tours/waiting.json')) : [];
const PAGES = SAMPLES.filter((s) => !WAITING.includes(s.id));
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

test('every sample tour has its own page, in the sitemap and linked from the home page', () => {
  const sitemap = read('sitemap.xml');
  const index = read('index.html');
  for (const sample of PAGES) {
    const file = `tours/${sample.id}/index.html`;
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} exists`);
    const page = read(file);
    assert.match(page, new RegExp(`<link rel="canonical" href="[^"]+/tours/${sample.id}/"`), `${sample.id}: canonical address`);
    assert.match(page, new RegExp(`href="\\.\\./\\.\\./\\?tour=${sample.id}"`), `${sample.id}: starts the tour in the app`);
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(ld['@type'], 'TouristTrip');
    assert.deepEqual(ld.itinerary.itemListElement.map((i) => i.item.name), sample.stops, `${sample.id}: every stop, in order`);
    for (const stop of sample.stops) assert.ok(unescape(page).includes(stop), `${sample.id}: mentions ${stop}`);
    assert.match(sitemap, new RegExp(`/tours/${sample.id}/</loc>`), `${sample.id}: in the sitemap`);
    assert.ok(index.includes(`href="tours/${sample.id}/"`), `${sample.id}: linked from the home page`);
  }
});

test('every sample tour has a part of the world, a unique id, and stops to walk', () => {
  const regions = new Set(REGIONS.map(([id]) => id).filter(Boolean));
  const ids = new Set();
  for (const sample of PAGES) {
    assert.ok(regions.has(sample.region), `${sample.id}: region "${sample.region}" is one of ${[...regions].join(', ')}`);
    assert.ok(!ids.has(sample.id), `${sample.id}: unique`);
    ids.add(sample.id);
    assert.ok(sample.stops.length >= 4 && sample.stops.length <= 8, `${sample.id}: 4 to 8 stops`);
    assert.equal(new Set(sample.stops).size, sample.stops.length, `${sample.id}: no stop twice`);
    assert.ok(['walk', 'drive'].includes(sample.mode) && sample.km > 0 && sample.blurb && sample.city, `${sample.id}: mode, distance, blurb, city`);
  }
});

test('the home page tells search engines what Roamie is', () => {
  const index = read('index.html');
  const ld = JSON.parse(index.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld['@type'], 'WebApplication');
  assert.equal(ld.offers.price, '0');
  assert.match(index, /<link rel="canonical" href="https:\/\/[^"]+\/" \/>/);
  assert.match(index, /<meta name="description" content="[^"]{80,}"/);
});

test('robots.txt points to the sitemap; a missing page gets a Roamie page that leads back', () => {
  const site = read('index.html').match(/<link rel="canonical" href="([^"]+)"/)[1];
  assert.match(read('robots.txt'), new RegExp(`^Sitemap: ${site.replace(/[.?]/g, '\\$&')}sitemap\\.xml$`, 'm'));
  const notFound = read('404.html');
  assert.match(notFound, /<meta name="robots" content="noindex"/, 'not indexed');
  assert.ok(notFound.includes(`href="${site}"`), 'a way back to the app');
  for (const sample of PAGES) assert.ok(notFound.includes(`${site}tours/${sample.id}/`), `links ${sample.id}`);
});

test('keyboard users can skip straight to the form; no JavaScript is explained', () => {
  const index = read('index.html');
  assert.match(index, /<body>\s*<a class="skip-link" href="#setup-form">/);
  assert.match(index, /<noscript>/);
});

test('privacy, terms and credits pages exist and are linked from the app and every tour page', () => {
  for (const page of ['privacy.html', 'terms.html', 'credits.html']) {
    assert.ok(existsSync(new URL(`../${page}`, import.meta.url)), `${page} exists`);
    assert.ok(read('index.html').includes(`href="${page}"`), `${page} linked from the app`);
    for (const sample of PAGES) assert.ok(read(`tours/${sample.id}/index.html`).includes(`href="../../${page}"`), `${page} linked from ${sample.id}`);
  }
});

test('the privacy page names every outside service the app contacts', async () => {
  const { readdirSync } = await import('node:fs');
  const privacy = read('privacy.html').toLowerCase();
  const code = readdirSync(new URL('../js/', import.meta.url)).map((f) => read(`js/${f}`)).join('\n') + read('index.html');
  // Hosts the app sends requests to (links the user taps, like Google Maps, are listed too).
  const NAMES = {
    'nominatim.openstreetmap.org': 'nominatim',
    'wikipedia.org': 'wikipedia',
    'www.wikidata.org': 'wikidata',
    'routing.openstreetmap.de': 'routing service',
    'tiles.openfreemap.org': 'openfreemap',
    'tile.openstreetmap.org': "openstreetmap's map tiles",
    'overpass-api.de': 'overpass',
    'cdnjs.cloudflare.com': 'cdnjs',
    'cdn.jsdelivr.net': 'jsdelivr',
    'huggingface.co': 'hugging face',
    'www.google.com': 'google maps',
    'maps.apple.com': 'apple maps',
  };
  for (const [host, name] of Object.entries(NAMES)) {
    if (code.includes(host)) assert.ok(privacy.includes(name), `the privacy page mentions ${name} (${host})`);
  }
  const contacted = new Set([...code.matchAll(/fetch[A-Za-z]*\(\s*`https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]));
  for (const host of contacted) assert.ok(Object.keys(NAMES).some((h) => host.endsWith(h)), `a new service (${host}) must be added to the privacy page`);
});

test('no Google Fonts: the fonts are served from the site', () => {
  for (const page of ['index.html', 'privacy.html', 'terms.html', 'credits.html', '404.html', ...PAGES.map((s) => `tours/${s.id}/index.html`)]) {
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(read(page)), `${page} doesn't load Google Fonts`);
  }
  for (const m of read('css/fonts.css').matchAll(/url\(\.\.\/(fonts\/[^)]+)\)/g)) assert.ok(existsSync(new URL(`../${m[1]}`, import.meta.url)), `${m[1]} exists`);
});

test('credits include what the licences ask for', () => {
  const credits = read('credits.html');
  assert.ok(credits.includes('Jenny (Dioco)'), 'the Jenny voice is credited as its licence asks');
  assert.ok(credits.includes('openstreetmap.org/fixthemap'), '"Fix the map", as the routing service asks');
  assert.ok(read('index.html').includes('openstreetmap.org/fixthemap'), 'and next to the directions');
  assert.ok(credits.includes('creativecommons.org/licenses/by-sa/4.0'), "Wikipedia's licence");
});

test('a tour waiting for its page is a real sample, and nothing links to a page it does not have yet', () => {
  const ids = SAMPLES.map((s) => s.id);
  for (const id of WAITING) {
    assert.ok(ids.includes(id), `${id} is a sample tour`);
    assert.ok(!read('index.html').includes(`tours/${id}/`), `the home page doesn't link ${id} yet`);
    assert.ok(!read('sitemap.xml').includes(`tours/${id}/`), `the sitemap doesn't list ${id} yet`);
  }
  assert.ok(PAGES.length >= 9, 'the tours that had pages keep them');
});

test('the app page has a content security policy that covers every service it uses, and nothing loose', async () => {
  const { readdirSync } = await import('node:fs');
  const index = read('index.html');
  const csp = index.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'index.html has a Content-Security-Policy');
  const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  // A whole host ("https://x"), a subdomain wildcard ("https://*.x") or a folder ("https://x/some/path/").
  const allows = (directive, target) => {
    const u = new URL(target.includes('://') ? target : `https://${target}/`);
    return (directives[directive] ?? []).some(
      (v) => v === `https://${u.host}` || (v.startsWith('https://*.') && u.host.endsWith(v.slice('https://*'.length))) || (v.endsWith('/') && u.href.startsWith(v)),
    );
  };
  // Every host the code fetches from (the same scan as the privacy-page test, plus the language-dependent Wikipedia).
  const code = readdirSync(new URL('../js/', import.meta.url)).map((f) => read(`js/${f}`)).join('\n');
  const contacted = new Set([...code.matchAll(/fetch[A-Za-z]*\(\s*`https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]));
  for (const host of [...contacted, 'en.wikipedia.org', 'www.wikidata.org', 'tiles.openfreemap.org', 'huggingface.co']) assert.ok(allows('connect-src', host), `connect-src allows ${host}`);
  // Every outside script the page loads.
  for (const m of index.matchAll(/<script[^>]*src="(https:\/\/[^"]+)"/g)) assert.ok(allows('script-src', m[1]), `script-src allows ${m[1]}`);
  // The voice engine's scripts and files (loaded by js/neuralVoice.js).
  const voice = read('js/neuralVoice.js');
  const ortBase = voice.match(/ORT_BASE = '([^']+)'/)[1];
  const piperBase = voice.match(/PHONEMIZER_BASE = '([^']+)'/)[1];
  for (const url of [`${ortBase}ort.wasm.min.js`, `${piperBase}.js`]) assert.ok(allows('script-src', url), `script-src allows ${url}`);
  for (const url of [`${ortBase}ort-wasm-simd.wasm`, `${piperBase}.wasm`, `${piperBase}.data`]) assert.ok(allows('connect-src', url), `connect-src allows ${url}`);
  // Only the exact library folders on the shared CDNs, not everything they serve.
  for (const directive of ['script-src', 'style-src', 'connect-src', 'img-src']) {
    for (const cdn of ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net']) assert.ok(!directives[directive]?.includes(cdn), `${directive}: not all of ${cdn}`);
  }
  assert.ok(!directives['style-src'].includes("'unsafe-inline'"), 'no inline styles either');
  for (const [directive, values] of Object.entries(directives)) {
    assert.ok(!values.includes("'unsafe-eval'") && !values.includes('*') && !values.includes('https:'), `${directive} has nothing loose`);
  }
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"), 'no inline scripts can run');
});

test('the Cloudflare headers give the app page the same policy as its <meta>, plus no framing', () => {
  const index = read('index.html');
  const meta = index.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const headers = read('_headers');
  const policies = [...headers.matchAll(/^\s+Content-Security-Policy: (.+)$/gm)].map((m) => m[1]);
  assert.equal(policies.length, 2, 'for / and /index.html');
  for (const p of policies) assert.equal(p, `${meta}; frame-ancestors 'none'`);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Permissions-Policy: geolocation=\(self\), camera=\(self\)/);
});
