import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SAMPLES } from '../js/samples.js';

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

test('the home page tells search engines what Roamie is', () => {
  const index = read('index.html');
  const ld = JSON.parse(index.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld['@type'], 'WebApplication');
  assert.equal(ld.offers.price, '0');
  assert.match(index, /<link rel="canonical" href="https:\/\/[^"]+\/" \/>/);
  assert.match(index, /<meta name="description" content="[^"]{80,}"/);
});
