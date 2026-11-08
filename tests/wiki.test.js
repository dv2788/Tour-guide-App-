import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikiService, WikipediaBusyError, photoPage } from '../js/wiki.js';

function mockFetch(routes) {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) return body === null ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, seen };
}

test('nearby parses geosearch results, sorts by distance and classifies places', async () => {
  const { fetchImpl, seen } = mockFetch([
    [
      'generator=geosearch',
      {
        query: {
          pages: [
            { pageid: 2, title: 'Far Museum', coordinates: [{ lat: 48.87, lon: 2.3 }], description: 'museum' },
            { pageid: 1, title: 'Bir-Hakeim', coordinates: [{ lat: 48.8601, lon: 2.3 }], description: 'Paris Métro station' },
            { pageid: 3, title: 'No coords' },
            { pageid: 4, title: 'Mercury', coordinates: [{ lat: 48.861, lon: 2.3 }], pageprops: { disambiguation: '' } },
          ],
        },
      },
    ],
  ]);
  const wiki = createWikiService({ lang: 'fr', fetchImpl });
  const pois = await wiki.nearby(48.86, 2.3, 500, 20);
  assert.match(seen[0], /^https:\/\/fr\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(seen[0], /origin=\*/);
  assert.deepEqual(
    pois.map((p) => [p.title, p.category]),
    [
      ['Bir-Hakeim', 'skip'],
      ['Mercury', 'skip'],
      ['Far Museum', null],
    ],
  );
});

test('resolveArticle follows the Wikidata link when the OSM tag is in another language', async () => {
  const { fetchImpl, seen } = mockFetch([
    ['wikidata.org', { entities: { Q243: { sitelinks: { enwiki: { title: 'Eiffel Tower' } } } } }],
    [
      '/page/summary/Eiffel_Tower',
      { pageid: 9232, title: 'Eiffel Tower', type: 'standard', extract: 'The Eiffel Tower is…', coordinates: { lat: 48.8584, lon: 2.2945 } },
    ],
  ]);
  const wiki = createWikiService({ lang: 'en', fetchImpl });
  const article = await wiki.resolveArticle({
    name: 'Tour Eiffel',
    wikipedia: 'fr:Tour Eiffel',
    wikidata: 'Q243',
    lat: 48.8583,
    lon: 2.2944,
  });
  assert.equal(article.title, 'Eiffel Tower');
  assert.ok(seen.some((u) => u.includes('sitefilter=enwiki')));
});

test('resolveArticle rejects a same-named article in another city', async () => {
  const { fetchImpl } = mockFetch([
    ['/page/summary/Eiffel_Tower', { pageid: 9232, title: 'Eiffel Tower', type: 'standard', extract: 'In Paris.', coordinates: { lat: 48.8584, lon: 2.2945 } }],
    ['generator=geosearch', { query: { pages: [] } }],
  ]);
  const wiki = createWikiService({ lang: 'en', fetchImpl });
  // The replica in Paris, Texas
  const article = await wiki.resolveArticle({ name: 'Eiffel Tower', lat: 33.6609, lon: -95.5555 });
  assert.equal(article, null);
});

test('resolveArticle asks Wikipedia\'s search last, and keeps a hit only at the spot and with the name', async () => {
  const near = { lat: 36.5725, lon: 136.6666 };
  const { fetchImpl, seen } = mockFetch([
    ['generator=geosearch', { query: { pages: [] } }],
    ['/page/summary/Higashi_Chaya_District', null], // not an article title
    ['list=search&srsearch=Higashi+Chaya+District', { query: { search: [{ title: 'Kanazawa' }, { title: 'Higashi Chaya' }] } }],
    ['/page/summary/Kanazawa', { pageid: 1, title: 'Kanazawa', type: 'standard', description: 'City in Ishikawa, Japan', extract: 'Kanazawa is…', coordinates: near }],
    ['/page/summary/Higashi_Chaya', { pageid: 2, title: 'Higashi Chaya', type: 'standard', description: 'Geisha district in Kanazawa', extract: 'Higashi Chaya is…', coordinates: near }],
    ['list=search&srsearch=Lamu+Market', { query: { search: [{ title: 'Lamu Fort' }] } }],
    ['/page/summary/Lamu_Fort', { pageid: 3, title: 'Lamu Fort', type: 'standard', description: 'Fort in Lamu', extract: 'The fort…', coordinates: near }],
  ]);
  const wiki = createWikiService({ lang: 'en', fetchImpl });
  const found = await wiki.resolveArticle({ name: 'Higashi Chaya District', ...near });
  assert.equal(found.title, 'Higashi Chaya', 'the district, not the city whose name the search put first');
  assert.ok(seen.some((u) => u.includes('list=search')));
  assert.equal(await wiki.resolveArticle({ name: 'Lamu Market', ...near }), null, 'a hit sharing one word is not the place');
});

test('exploreArea adds the most notable places in the whole radius to the nearest ones, in two requests', async () => {
  // 48.86,2.33 is the centre; 0.009° of latitude is about 1 km.
  const { fetchImpl, seen } = mockFetch([
    ['generator=geosearch', { query: { pages: [{ pageid: 1, title: 'Corner Church', length: 9000, description: 'church in Paris', coordinates: [{ lat: 48.8605, lon: 2.33 }] }] } }],
    [
      'generator=search',
      {
        query: {
          pages: [
            { pageid: 2, title: 'Famous Cathedral', length: 90000, description: 'Gothic cathedral', langlinkscount: 95, coordinates: [{ lat: 48.878, lon: 2.33, type: 'landmark' }] },
            { pageid: 1, title: 'Corner Church', length: 9000, description: 'church in Paris', coordinates: [{ lat: 48.8605, lon: 2.33 }] },
            { pageid: 3, title: 'Far Away Tower', length: 50000, description: 'tower', langlinkscount: 40, coordinates: [{ lat: 48.95, lon: 2.33 }] },
            { pageid: 4, title: 'No Coordinates', length: 50000, description: 'church' },
          ],
        },
      },
    ],
  ]);
  const wiki = createWikiService({ lang: 'en', fetchImpl });
  const pois = await wiki.exploreArea(48.86, 2.33, 3000);
  assert.equal(seen.filter((u) => u.includes('wikipedia.org')).length, 2, 'two requests, so Wikipedia never refuses for too many at once');
  assert.ok(seen.some((u) => /gsrsearch=nearcoord%3A3000m%2C48\.8600%2C2\.3300/.test(u)), 'notable places in the radius (whole meters: Wikipedia ignores "3.0km")');
  assert.ok(seen.filter((u) => u.includes('wikipedia.org')).every((u) => /prop=[^&]*langlinkscount/.test(u) && /coprop=type/.test(u)), 'with how many languages cover each, and what its coordinates mark');
  const byTitle = Object.fromEntries(pois.map((p) => [p.title, p]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['Corner Church', 'Famous Cathedral'], 'the far tower (10 km) is outside the radius');
  assert.equal(byTitle['Famous Cathedral'].langs, 95);
  assert.equal(byTitle['Famous Cathedral'].coordType, 'landmark');
  assert.equal(byTitle['Corner Church'].langs, 0, 'no language links means none');
});

test('exploreArea still answers when one of its two requests fails, and throws when both do', async () => {
  const half = mockFetch([['generator=geosearch', { query: { pages: [{ pageid: 1, title: 'Corner Church', length: 9000, coordinates: [{ lat: 48.8605, lon: 2.33 }] }] } }]]);
  assert.equal((await createWikiService({ fetchImpl: half.fetchImpl, retries: 0 }).exploreArea(48.86, 2.33, 3000)).length, 1);
  const none = mockFetch([]);
  await assert.rejects(createWikiService({ fetchImpl: none.fetchImpl, retries: 0 }).exploreArea(48.86, 2.33, 3000));
});

test('Wikipedia requests wait their turn (2 at a time) and a refused one is retried', async () => {
  let active = 0;
  let most = 0;
  let calls = 0;
  const fetchImpl = async () => {
    const n = ++calls;
    active++;
    most = Math.max(most, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (n === 1) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) };
  };
  const wiki = createWikiService({ fetchImpl, retryDelayMs: 1 });
  await Promise.all([1, 2, 3, 4, 5, 6].map((i) => wiki.nearby(48.86 + i / 1000, 2.33, 500)));
  assert.ok(most <= 2, `at most 2 at once (saw ${most})`);
  assert.equal(calls, 7, 'the refused request was asked again');
  let blocked = 0;
  const corsBlocked = async () => {
    if (blocked++ === 0) throw new TypeError('Failed to fetch'); // a 429 without CORS headers looks like this
    return { ok: true, status: 200, json: async () => ({ query: { pages: [] } }) };
  };
  await createWikiService({ fetchImpl: corsBlocked, retryDelayMs: 1 }).nearby(48.86, 2.33, 500);
  assert.equal(blocked, 2, 'a network error is retried too');
  const refused = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) });
  await assert.rejects(createWikiService({ fetchImpl: refused, retryDelayMs: 1 }).nearby(48.86, 2.33, 500), WikipediaBusyError);
});

test('neighbourhoods lists the parts of town around a city centre, best known first, with plain names', async () => {
  const { fetchImpl, seen } = mockFetch([
    [
      'generator=search',
      {
        query: {
          pages: [
            { pageid: 3, index: 3, title: 'Gràcia', description: 'District of Barcelona, Spain' },
            { pageid: 1, index: 1, title: 'Eixample', description: 'District of Barcelona, Spain' },
            { pageid: 2, index: 2, title: 'Sagrada Família', description: 'Basilica in Barcelona' },
            { pageid: 4, index: 4, title: 'La Barceloneta, Barcelona', description: 'Neighbourhood in Barcelona' },
            { pageid: 5, index: 5, title: 'Les Corts (district)', description: 'District of Barcelona' },
            { pageid: 6, index: 6, title: 'Barcelona Metro line 1', description: 'Metro line in Barcelona' },
          ],
        },
      },
    ],
  ]);
  const wiki = createWikiService({ lang: 'en', fetchImpl });
  const list = await wiki.neighbourhoods(41.387, 2.17, 8000);
  assert.match(seen[0], /gsrsearch=nearcoord%3A8000m%2C41\.387%2C2\.17/);
  assert.deepEqual(list.map((n) => n.name), ['Eixample', 'Gràcia', 'La Barceloneta', 'Les Corts']);
});

test('exploreArea looks further than 10 km with the notable-places search (driving)', async () => {
  const { fetchImpl, seen } = mockFetch([['generator=', { query: { pages: [] } }]]);
  await createWikiService({ fetchImpl }).exploreArea(41.387, 2.17, 30000);
  assert.ok(seen.some((u) => /ggsradius=10000/.test(u)), 'nearest articles: Wikipedia stops at 10 km');
  assert.ok(seen.some((u) => /nearcoord%3A30000m/.test(u)), 'notable places: the whole 30 km');
});

test('photoPage finds the page that names a photo’s author and licence', () => {
  assert.equal(
    photoPage('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Casa_Batll%C3%B3.jpg/320px-Casa_Batll%C3%B3.jpg'),
    'https://commons.wikimedia.org/wiki/File:Casa_Batll%C3%B3.jpg',
  );
  assert.equal(photoPage('https://upload.wikimedia.org/wikipedia/en/c/c4/Poster.png'), 'https://en.wikipedia.org/wiki/File:Poster.png');
  assert.equal(photoPage('https://example.org/x.jpg'), null);
  assert.equal(photoPage(null), null);
});

test('no more precision than needed is sent: ~11 m for nearby places', async () => {
  const { fetchImpl, seen } = mockFetch([['generator=geosearch', { query: { pages: [] } }]]);
  await createWikiService({ fetchImpl }).nearby(48.858370123456, 2.294481987654, 500);
  assert.match(seen[0], /ggscoord=48\.8584%7C2\.2945&/);
});

test('exploreArea marks the buildings Wikidata says no longer stand, and plans anyway without Wikidata', async () => {
  const pages = [
    { pageid: 1, title: 'Tuileries Palace', length: 70000, langlinkscount: 55, description: 'former royal palace in Paris', pageprops: { wikibase_item: 'Q234364' }, coordinates: [{ lat: 48.8625, lon: 2.3311 }] },
    { pageid: 2, title: 'Louvre', length: 90000, langlinkscount: 150, description: 'art museum in Paris', pageprops: { wikibase_item: 'Q19675' }, coordinates: [{ lat: 48.8611, lon: 2.3358 }] },
  ];
  const { fetchImpl, seen } = mockFetch([
    ['www.wikidata.org', { query: { search: [{ title: 'Q234364' }, { title: 'Q1865480' }] } }],
    ['generator=', { query: { pages } }],
  ]);
  const pois = await createWikiService({ fetchImpl }).exploreArea(48.86, 2.33, 3000);
  const byTitle = Object.fromEntries(pois.map((p) => [p.title, p]));
  assert.equal(byTitle['Tuileries Palace'].gone, true, 'demolished in 1883');
  assert.equal(byTitle.Louvre.gone, false);
  const wd = seen.find((u) => u.includes('www.wikidata.org'));
  assert.equal(new URL(wd).searchParams.get('srsearch'), 'haswbstatement:P31=Q19860854|P31=Q57644089 nearcoord:3000m,48.8600,2.3300', 'one search for destroyed buildings in the same radius');
  assert.ok(seen.every((u) => !u.includes('generator=') || /ppprop=disambiguation%7Cwikibase_item/.test(u)), 'each page comes with its Wikidata id');

  // Wikidata busy or down: the places are all there, none marked.
  const noWikidata = mockFetch([['generator=', { query: { pages } }]]);
  const plain = await createWikiService({ fetchImpl: noWikidata.fetchImpl, retries: 0 }).exploreArea(48.86, 2.33, 3000);
  assert.equal(plain.length, 2);
  assert.ok(plain.every((p) => p.gone === false));
});

test('an error inside a normal answer ("Search is currently too busy") is retried, never read as "no places"', async () => {
  const tooBusy = { error: { code: 'cirrussearch-too-busy-error', info: 'Search is currently too busy. Please try again later.' } };
  const pages = { query: { pages: [{ pageid: 1, title: 'Stephansdom', length: 60000, langlinkscount: 70, description: 'Kathedrale in Wien', coordinates: [{ lat: 48.2085, lon: 16.3731 }] }] } };
  let calls = 0;
  const flaky = async (url) => {
    if (url.includes('wikidata')) return { ok: true, status: 200, json: async () => ({ query: { search: [] } }) };
    calls++;
    return { ok: true, status: 200, json: async () => (calls <= 2 ? tooBusy : pages) };
  };
  const pois = await createWikiService({ fetchImpl: flaky, retryDelayMs: 1 }).exploreArea(48.2084, 16.3725, 6000);
  assert.deepEqual(pois.map((p) => p.title), ['Stephansdom'], 'asked again until it answered');
  // Still too busy after the retries: say so (the app then asks to try again), don't answer "nothing here".
  const alwaysBusy = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('wikidata') ? { query: { search: [] } } : tooBusy) });
  await assert.rejects(createWikiService({ fetchImpl: alwaysBusy, retryDelayMs: 1 }).exploreArea(48.2084, 16.3725, 6000), WikipediaBusyError);
  // Other errors aren't retried.
  let asked = 0;
  const bad = async () => (asked++, { ok: true, status: 200, json: async () => ({ error: { code: 'badvalue' } }) });
  await assert.rejects(createWikiService({ fetchImpl: bad, retryDelayMs: 1 }).nearby(48.2, 16.37, 500), /badvalue/);
  assert.equal(asked, 1);
});

test('nearby can say which buildings are gone (for the camera), and works without Wikidata', async () => {
  const pages = [
    { pageid: 1, title: 'Notre-Dame de Paris', description: 'cathedral', langlinkscount: 90, pageprops: { wikibase_item: 'Q2981' }, coordinates: [{ lat: 48.853, lon: 2.3499, type: 'landmark' }] },
    { pageid: 2, title: 'Archbishop’s Palace of Paris', description: 'former palace', langlinkscount: 12, pageprops: { wikibase_item: 'Q2860541' }, coordinates: [{ lat: 48.8527, lon: 2.3503 }] },
  ];
  const { fetchImpl, seen } = mockFetch([
    ['www.wikidata.org', { query: { search: [{ title: 'Q2860541' }] } }],
    ['generator=geosearch', { query: { pages } }],
  ]);
  const wiki = createWikiService({ fetchImpl });
  const marked = await wiki.nearby(48.8531, 2.3488, 400, 50, { markGone: true });
  assert.deepEqual(marked.map((p) => [p.title, p.gone]), [['Notre-Dame de Paris', false], ['Archbishop’s Palace of Paris', true]]);
  assert.equal(marked[0].coordType, 'landmark', 'what the point marks');
  assert.match(new URL(seen.find((u) => u.includes('wikidata'))).searchParams.get('srsearch'), /nearcoord:400m,48\.8531,2\.3488$/);
  const before = seen.length;
  await wiki.nearby(48.8531, 2.3488, 400);
  assert.equal(seen.length, before + 1, 'without markGone, one request as before');
  const noWikidata = mockFetch([['generator=geosearch', { query: { pages } }]]);
  const plain = await createWikiService({ fetchImpl: noWikidata.fetchImpl, retries: 0 }).nearby(48.8531, 2.3488, 400, 50, { markGone: true });
  assert.equal(plain.length, 2);
});

test('markDemolished reads Wikipedia categories (where Wikidata says nothing), in any language, and keeps rebuilt ones', async () => {
  const cats = {
    'Church of Saint-Pierre-aux-Bœufs, Paris': ['Category:Buildings and structures demolished in 1812', 'Category:Former Roman Catholic church buildings in France'],
    'Église Saint-Barthélemy': ['Catégorie:Église détruite à Paris'],
    'Frauenkirche, Dresden': ['Category:Churches destroyed during World War II', 'Category:Rebuilt buildings and structures in Germany'],
    'Notre-Dame de Paris': ['Category:Cathedrals in Paris'],
  };
  const { fetchImpl, seen } = mockFetch([['prop=categories', { query: { pages: Object.entries(cats).map(([title, c]) => ({ title, categories: c.map((t) => ({ title: t })) })) } }]]);
  const places = Object.keys(cats).map((title) => ({ title }));
  await createWikiService({ fetchImpl }).markDemolished(places);
  assert.deepEqual(places.filter((p) => p.gone).map((p) => p.title), ['Church of Saint-Pierre-aux-Bœufs, Paris', 'Église Saint-Barthélemy']);
  assert.equal(seen.length, 1, 'one request for up to 20 places');
  assert.match(seen[0], /clshow=!hidden|clshow=%21hidden/);
  // Wikipedia busy: nothing marked, nothing thrown.
  const down = mockFetch([]);
  const same = [{ title: 'Notre-Dame de Paris' }];
  await createWikiService({ fetchImpl: down.fetchImpl, retries: 0 }).markDemolished(same);
  assert.equal(same[0].gone, undefined);
});

test('links and pictures from Wikipedia answers are used only if they are plain https:// addresses', async () => {
  const { httpsOnly } = await import('../js/wiki.js');
  assert.equal(httpsOnly('https://en.m.wikipedia.org/wiki/Casa_Batll%C3%B3'), 'https://en.m.wikipedia.org/wiki/Casa_Batll%C3%B3');
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'http://en.wikipedia.org/wiki/X', 'https://x.org/"onmouseover=', null, undefined, 42]) {
    assert.equal(httpsOnly(bad), null, String(bad));
  }
});

test('a themed search Wikipedia refuses in the burst is asked once more; one still refused is reported, not read as "nothing"', async () => {
  const page = (pageid, title, description, lat) => ({ pageid, title, length: 9000, description, langlinkscount: 5, coordinates: [{ lat, lon: 2.33 }] });
  let parkAsked = 0;
  const fetchImpl = async (url) => {
    const q = decodeURIComponent(url.replace(/\+/g, ' ')); // spaces come as '+'
    if (/gsrsearch=park OR garden/.test(q)) {
      parkAsked++;
      if (parkAsked === 1) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }; // the burst
      return { ok: true, status: 200, json: async () => ({ query: { pages: [page(7, 'Quiet Park', 'public park in Paris', 48.862)] } }) };
    }
    if (/gsrsearch=market OR/.test(q)) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }; // never answers
    if (/generator=geosearch|generator=search/.test(q)) return { ok: true, status: 200, json: async () => ({ query: { pages: [page(1, 'Corner Church', 'church in Paris', 48.8605)] } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const wiki = createWikiService({ lang: 'en', fetchImpl, retries: 0 });
  const pois = await wiki.exploreArea(48.86, 2.33, 3000, 200, 200, { themes: ['landscape', 'food'] });
  assert.ok(pois.some((p) => p.title === 'Quiet Park'), 'the park search was asked again and answered');
  assert.equal(parkAsked, 2);
  assert.deepEqual(pois.incomplete, ['food'], 'the food search is reported as unanswered');
});
