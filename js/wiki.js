// Wikipedia: finds places around you and fetches their stories.
// Uses public, CORS-enabled endpoints, so no API key or backend is needed.

import { distanceMeters } from './geo.js';
import { classifyPlace, sharesNameToken } from './text.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const TRANSIT_RE = /\b(station|stop|gare|bahnhof|estaci[óo]n|stazione|fermata)\b/i;
// "Neighbourhood in Barcelona", "District of Paris", "Quartier de Lyon", "Barrio de Madrid"…
const NEIGHBOURHOOD_RE =
  /^(?:[\p{L}'’-]+\s+){0,3}(?:district|neighbou?rhood|quarter|borough|arrondissement|ward|barrio|quartier|bairro|stadtteil|stadtbezirk|ortsteil|quartiere|rione|sestiere)(?![\p{L}])/iu;

export function createWikiService({ lang = 'en', fetchImpl = defaultFetch } = {}) {
  const host = `https://${lang}.wikipedia.org`;
  const summaries = new Map();

  async function getJson(url) {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Wikipedia request failed (HTTP ${res.status})`);
    return res.json();
  }

  /** Articles with coordinates within `radius` meters, nearest first. */
  async function nearby(lat, lon, radius = 1000, limit = 50) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      generator: 'geosearch',
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(Math.min(10000, Math.max(10, Math.round(radius)))),
      ggslimit: String(Math.min(50, Math.max(1, limit))),
      prop: 'coordinates|description|pageimages|pageprops',
      colimit: 'max',
      piprop: 'thumbnail',
      pithumbsize: '240',
      pilimit: 'max',
      ppprop: 'disambiguation',
    });
    const data = await getJson(`${host}/w/api.php?${params}`);
    const pages = data?.query?.pages ?? [];
    return pages
      .map((p) => {
        const c = p.coordinates?.[0];
        if (!c) return null;
        const poi = {
          id: p.pageid,
          title: p.title,
          lat: c.lat,
          lon: c.lon,
          description: p.description ?? '',
          thumbnail: p.thumbnail?.source ?? null,
          disambiguation: !!p.pageprops && 'disambiguation' in p.pageprops,
        };
        poi.category = classifyPlace(poi);
        return poi;
      })
      .filter(Boolean)
      .sort((a, b) => distanceMeters({ lat, lon }, a) - distanceMeters({ lat, lon }, b));
  }

  /** Intro text, image and link for one article (cached). */
  function summary(title) {
    if (summaries.has(title)) return summaries.get(title);
    const path = encodeURIComponent(title.replace(/ /g, '_'));
    const promise = getJson(`${host}/api/rest_v1/page/summary/${path}`).then((d) => ({
      pageid: d.pageid,
      title: d.title,
      type: d.type,
      extract: d.extract ?? '',
      description: d.description ?? '',
      thumbnail: d.thumbnail?.source ?? null,
      lat: d.coordinates?.lat ?? null,
      lon: d.coordinates?.lon ?? null,
      url: d.content_urls?.mobile?.page ?? d.content_urls?.desktop?.page ?? `${host}/wiki/${path}`,
    }));
    summaries.set(title, promise);
    promise.catch(() => summaries.delete(title));
    return promise;
  }

  /** Article title in this language for a Wikidata item (e.g. Q243 -> "Eiffel Tower"). */
  async function titleFromWikidata(qid) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: qid,
      props: 'sitelinks',
      sitefilter: `${lang}wiki`,
      format: 'json',
      origin: '*',
    });
    const data = await getJson(`https://www.wikidata.org/w/api.php?${params}`);
    return data?.entities?.[qid]?.sitelinks?.[`${lang}wiki`]?.title ?? null;
  }

  /**
   * Best article for a geocoded place: OpenStreetMap's wikipedia/wikidata tags first,
   * then the place name, then the nearest article whose title matches the name.
   */
  async function resolveArticle({ name, wikipedia, wikidata, lat, lon }, { maxDistance = 5000 } = {}) {
    const titles = [];
    if (wikipedia) {
      const i = wikipedia.indexOf(':');
      if (i > 0 && wikipedia.slice(0, i) === lang) titles.push(wikipedia.slice(i + 1));
    }
    if (!titles.length && wikidata) {
      const fromWikidata = await titleFromWikidata(wikidata).catch(() => null);
      if (fromWikidata) titles.push(fromWikidata);
    }
    if (name && !titles.includes(name)) titles.push(name);

    const here = lat != null && lon != null ? { lat, lon } : null;
    const wantsTransit = TRANSIT_RE.test(name ?? '');
    for (const title of titles) {
      const s = await summary(title).catch(() => null);
      if (!s || s.type === 'disambiguation' || !s.extract) continue;
      if (here && s.lat != null && distanceMeters(here, s) > maxDistance) continue; // same name, other city
      // A map tag pointing at the station named after a bridge or square: try the next title.
      if (!wantsTransit && TRANSIT_RE.test(`${s.title} ${s.description}`)) continue;
      return s;
    }

    if (here) {
      const near = await nearby(here.lat, here.lon, 250, 15).catch(() => []);
      const match = near.find(
        (p) => p.category !== 'skip' && (distanceMeters(here, p) < 40 || sharesNameToken(name, p.title)),
      );
      if (match) {
        const s = await summary(match.title).catch(() => null);
        if (s?.extract) return s;
      }
    }
    return null;
  }

  /**
   * Many articles around a point, with how long each article is (a good sign of how much
   * there is to tell): used to suggest routes. Up to `limit` articles within `radius` m.
   */
  /**
   * Places worth a stop within `radius` meters. Two searches: the nearest articles (the
   * nearest few hundred only reach a few streets in a dense city centre) and the most notable
   * ones anywhere in the radius (Wikipedia's search ranks by how linked and read a page is).
   * Each place comes with what it takes to judge it: article length, description, how many
   * languages have an article about it, and what kind of place its coordinates mark.
   */
  async function exploreArea(lat, lon, radius = 2000, limit = 300, notable = 200) {
    const meters = Math.min(10000, Math.max(10, Math.round(radius)));
    const query = (params) => getJson(`${host}/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params })}`);
    const [near, famous] = await Promise.all([
      query({ list: 'geosearch', gscoord: `${lat}|${lon}`, gsradius: String(meters), gslimit: String(Math.min(500, limit)) }),
      notable > 0
        ? query({ list: 'search', srsearch: `nearcoord:${meters}m,${lat},${lon}`, srlimit: String(Math.min(500, notable)), srprop: '' }).catch(() => null) // whole meters: "3.0km" isn't understood
        : null,
    ]);
    const byId = new Map((near?.query?.geosearch ?? []).map((p) => [p.pageid, { id: p.pageid, title: p.title, lat: p.lat, lon: p.lon }]));
    for (const p of famous?.query?.search ?? []) if (!byId.has(p.pageid)) byId.set(p.pageid, { id: p.pageid, title: p.title, lat: null, lon: null });
    const ids = [...byId.keys()];
    const batches = [];
    for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
    await Promise.all(
      batches.map(async (batch) => {
        const pages =
          (
            await query({
              pageids: batch.join('|'),
              prop: 'info|description|pageimages|pageprops|langlinkscount|coordinates',
              piprop: 'thumbnail',
              pithumbsize: '240',
              pilimit: 'max',
              ppprop: 'disambiguation',
              coprop: 'type',
              colimit: 'max',
            })
          )?.query?.pages ?? [];
        for (const p of pages) {
          const poi = byId.get(p.pageid);
          if (!poi) continue;
          const coord = p.coordinates?.[0];
          Object.assign(poi, {
            lat: poi.lat ?? coord?.lat ?? null,
            lon: poi.lon ?? coord?.lon ?? null,
            coordType: coord?.type ?? null,
            length: p.length ?? null,
            description: p.description ?? '',
            thumbnail: p.thumbnail?.source ?? null,
            disambiguation: !!p.pageprops && 'disambiguation' in p.pageprops,
            langs: p.langlinkscount ?? 0, // left out when there are none
          });
          poi.category = classifyPlace(poi);
        }
      }),
    );
    // Search finds pages by any coordinate; keep the ones whose main location is in the radius.
    return [...byId.values()].filter((p) => p.category !== undefined && p.lat != null && distanceMeters({ lat, lon }, p) <= meters * 1.05);
  }

  /**
   * The neighbourhoods and districts around a city centre, best known first ("Eixample",
   * "Gràcia", "The Marais"), as suggestions for "which part of town are you staying in?".
   * One request: Wikipedia's search, limited to the area, with each page's short description.
   */
  async function neighbourhoods(lat, lon, radius = 8000, limit = 60) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      generator: 'search',
      gsrsearch: `nearcoord:${Math.round(Math.min(20000, radius))}m,${lat},${lon}`, // whole meters only
      gsrnamespace: '0',
      gsrlimit: '500',
      prop: 'description',
    });
    const pages = (await getJson(`${host}/w/api.php?${params}`))?.query?.pages ?? [];
    const seen = new Set();
    return pages
      .filter((p) => NEIGHBOURHOOD_RE.test(p.description ?? ''))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => ({ title: p.title, name: p.title.replace(/\s*\([^)]*\)$/, '').replace(/,\s*[^,]+$/, '') }))
      .filter((n) => !seen.has(n.name) && seen.add(n.name))
      .slice(0, limit);
  }

  return { lang, nearby, summary, titleFromWikidata, resolveArticle, exploreArea, neighbourhoods };
}
