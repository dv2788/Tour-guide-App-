// Wikipedia: finds places around you and fetches their stories.
// Uses public, CORS-enabled endpoints, so no API key or backend is needed.

import { distanceMeters } from './geo.js';
import { classifyPlace, sharesNameToken } from './text.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const TRANSIT_RE = /\b(station|stop|gare|bahnhof|estaci[óo]n|stazione|fermata)\b/i;

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

  return { lang, nearby, summary, titleFromWikidata, resolveArticle };
}
