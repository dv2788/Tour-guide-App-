import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SAMPLES, REGIONS } from '../js/samples.js';

// The pages search engines read must match the sample tours (run `npm run build:site` after editing them).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

test('every sample tour has its own page, in the sitemap and linked from the home page', () => {
  const sitemap = read('sitemap.xml');
  const index = read('index.html');
  for (const sample of SAMPLES) {
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
  for (const sample of SAMPLES) {
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
  for (const sample of SAMPLES) assert.ok(notFound.includes(`${site}tours/${sample.id}/`), `links ${sample.id}`);
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
    for (const sample of SAMPLES) assert.ok(read(`tours/${sample.id}/index.html`).includes(`href="../../${page}"`), `${page} linked from ${sample.id}`);
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
  for (const page of ['index.html', 'privacy.html', 'terms.html', 'credits.html', '404.html', ...SAMPLES.map((s) => `tours/${s.id}/index.html`)]) {
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
