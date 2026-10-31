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
