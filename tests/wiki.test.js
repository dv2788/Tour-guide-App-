import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikiService } from '../js/wiki.js';

function mockFetch(routes) {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) return { ok: true, status: 200, json: async () => body };
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

test('exploreArea adds the most notable places in the whole radius to the nearest ones', async () => {
  // 48.86,2.33 is the centre; 0.009° of latitude is about 1 km.
  const { fetchImpl, seen } = mockFetch([
    ['list=geosearch', { query: { geosearch: [{ pageid: 1, title: 'Corner Church', lat: 48.8605, lon: 2.33 }] } }],
    ['list=search', { query: { search: [{ pageid: 2, title: 'Famous Cathedral' }, { pageid: 1, title: 'Corner Church' }, { pageid: 3, title: 'Far Away Tower' }] } }],
    [
      'pageids=',
      {
        query: {
          pages: [
            { pageid: 1, title: 'Corner Church', length: 9000, description: 'church in Paris' },
            { pageid: 2, title: 'Famous Cathedral', length: 90000, description: 'Gothic cathedral', langlinkscount: 95, coordinates: [{ lat: 48.878, lon: 2.33, type: 'landmark' }] },
            { pageid: 3, title: 'Far Away Tower', length: 50000, description: 'tower', langlinkscount: 40, coordinates: [{ lat: 48.95, lon: 2.33 }] },
          ],
        },
      },
    ],
  ]);
  const wiki = createWikiService({ lang: 'en', fetchImpl });
  const pois = await wiki.exploreArea(48.86, 2.33, 3000);
  assert.ok(seen.some((u) => /srsearch=nearcoord%3A3000m%2C48\.86%2C2\.33/.test(u)), 'asks for notable places in the radius (in whole meters: Wikipedia ignores "3.0km")');
  assert.ok(seen.some((u) => /prop=[^&]*langlinkscount/.test(u) && /coprop=type/.test(u)), 'with how many languages cover each, and what its coordinates mark');
  const byTitle = Object.fromEntries(pois.map((p) => [p.title, p]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['Corner Church', 'Famous Cathedral'], 'the far tower (10 km) is outside the radius');
  assert.equal(byTitle['Famous Cathedral'].langs, 95);
  assert.equal(byTitle['Famous Cathedral'].coordType, 'landmark');
  assert.ok(Math.abs(byTitle['Famous Cathedral'].lat - 48.878) < 1e-9, 'position from its coordinates');
  assert.equal(byTitle['Corner Church'].langs, 0, 'no language links means none');
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
