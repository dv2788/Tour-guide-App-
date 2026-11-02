// Wikipedia: finds places around you and fetches their stories.
// Uses public, CORS-enabled endpoints, so no API key or backend is needed.

import { distanceMeters } from './geo.js';
import { classifyPlace, sharesNameToken } from './text.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TRANSIT_RE = /\b(station|stop|gare|bahnhof|estaci[óo]n|stazione|fermata)\b/i;
// "Neighbourhood in Barcelona", "District of Paris", "Quartier de Lyon", "Barrio de Madrid"…
const NEIGHBOURHOOD_RE =
  /^(?:[\p{L}'’-]+\s+){0,3}(?:district|neighbou?rhood|quarter|borough|arrondissement|ward|barrio|quartier|bairro|stadtteil|stadtbezirk|ortsteil|quartiere|rione|sestiere)(?![\p{L}])/iu;

// Wikipedia allows a browser app at most 3 requests at a time (and 200 a minute); more and it
// answers "429 Too Many Requests". So every request in the page waits its turn here, two at a
// time, and a refused one is retried after the pause Wikipedia asks for.
const MAX_AT_ONCE = 2;
const line = { active: 0, waiting: [] };
function inTurn(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      line.active++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          line.active--;
          line.waiting.shift()?.();
        });
    };
    if (line.active < MAX_AT_ONCE) run();
    else line.waiting.push(run);
  });
}

export class WikipediaBusyError extends Error {}
// Error codes that mean "too busy right now, ask again in a moment".
const BUSY_CODE_RE = /^(?:cirrussearch-too-busy-error|cirrussearch-backend-error|ratelimited|maxlag|readonly|internal_api_error)/;

// Wikidata marks the buildings that no longer stand ("destroyed building or structure",
// "destroyed church"): Paris's Tuileries Palace, Bruges's St Donatian's Cathedral. Their
// articles keep coordinates and often read as if the place were there, so they're looked up
// to be left out of routes.
const GONE_STATEMENTS = 'P31=Q19860854|P31=Q57644089';

// Wikipedia's categories say it where Wikidata doesn't ("Buildings and structures demolished in
// 1747", "Destroyed churches in France", "Bâtiment détruit à Paris", "Abgegangenes Bauwerk",
// "Edificios demolidos", "Architetture scomparse"), unless it was rebuilt (Dresden's Frauenkirche).
const DEMOLISHED_CATEGORY_RE =
  /(?:^|[^\p{L}])(?:demolished|destroyed|détruite?s?|démolie?s?|disparue?s?|abgegangene\w*|abgerissene\w*|zerstörte\w*|demolid[oa]s?|destruid[oa]s?|desaparecid[oa]s?|demolit[eoia]|distrutt[eoia]|scompars[eoia])(?![\p{L}])/iu;
const REBUILT_CATEGORY_RE = /rebuilt|reconstructed|reconstruit|wiederaufgebaut|rekonstruiert|reconstruid|ricostruit/iu;

/** The promise's answer, or `fallback` if it takes longer than `ms`. */
function atMost(ms, promise, fallback) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), late]);
}

/**
 * The page of a Wikipedia photo, which names its author and licence (credit for showing it):
 * ".../wikipedia/commons/thumb/a/ab/Casa_Batlló.jpg/320px-Casa_Batlló.jpg" ->
 * "https://commons.wikimedia.org/wiki/File:Casa_Batlló.jpg". Null if it isn't one.
 */
/** A link or picture address from an answer, only if it's a plain https:// one (never javascript: or data:). */
export function httpsOnly(url) {
  return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}

export function photoPage(imageUrl) {
  const m = /upload\.wikimedia\.org\/wikipedia\/([a-z-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(imageUrl ?? '');
  if (!m) return null;
  const host = m[1] === 'commons' ? 'commons.wikimedia.org' : `${m[1]}.wikipedia.org`;
  return `https://${host}/wiki/File:${m[2]}`;
}

export function createWikiService({ lang = 'en', fetchImpl = defaultFetch, retryDelayMs = 2000, retries = 2 } = {}) {
  const host = `https://${lang}.wikipedia.org`;
  const summaries = new Map();

  async function getJson(url) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await inTurn(() => fetchImpl(url, { headers: { Accept: 'application/json' } }));
      } catch (err) {
        // A refusal can also arrive as a network error (no CORS headers on the "429"): same treatment.
        if (attempt >= retries) throw new WikipediaBusyError(`Wikipedia didn't answer (${err?.message ?? err})`);
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        // Some refusals arrive as a normal answer (HTTP 200) with an error inside:
        // {"error": {"code": "cirrussearch-too-busy-error"}}. Read as "no places", they told
        // people there was nothing to see in central Vienna.
        const code = data?.error?.code;
        if (!code) return data;
        const busyCode = BUSY_CODE_RE.test(code);
        if (!busyCode || attempt >= retries) {
          throw busyCode ? new WikipediaBusyError(`Wikipedia is busy (${code})`) : new Error(`Wikipedia request failed (${code})`);
        }
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      const busy = res.status === 429 || res.status === 503;
      if (!busy || attempt >= retries) {
        throw busy ? new WikipediaBusyError(`Wikipedia is busy (HTTP ${res.status})`) : new Error(`Wikipedia request failed (HTTP ${res.status})`);
      }
      // Wait as long as asked (Retry-After, in seconds), else a little longer each time.
      const asked = Number(res.headers?.get?.('Retry-After'));
      const wait = Number.isFinite(asked) && asked > 0 ? Math.min(8000, asked * 1000) : retryDelayMs * 2 ** attempt;
      await sleep(wait);
    }
  }

  /**
   * Articles with coordinates within `radius` meters, nearest first. With `markGone`, each says
   * whether the building still stands (one more small request, to Wikidata).
   */
  async function nearby(lat, lon, radius = 1000, limit = 50, { markGone = false } = {}) {
    const goneSoon = markGone ? atMost(8000, goneAround(lat, lon, Math.round(radius)).catch(() => new Set()), new Set()) : null;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      generator: 'geosearch',
      ggscoord: `${lat.toFixed(4)}|${lon.toFixed(4)}`, // ~11 m is plenty for a search this wide
      ggsradius: String(Math.min(10000, Math.max(10, Math.round(radius)))),
      ggslimit: String(Math.min(50, Math.max(1, limit))),
      prop: 'coordinates|description|pageimages|pageprops|langlinkscount',
      colimit: 'max',
      coprop: 'type|dim', // what the point marks (a city's centre isn't a landmark) and how big it is
      piprop: 'thumbnail',
      pithumbsize: '240',
      pilimit: 'max',
      ppprop: 'disambiguation|wikibase_item',
    });
    const data = await getJson(`${host}/w/api.php?${params}`);
    const pages = data?.query?.pages ?? [];
    const gone = (await goneSoon) ?? new Set();
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
          langs: p.langlinkscount ?? 0, // how well known (left out when there are none)
          coordType: c.type ?? null,
          dim: c.dim ?? null, // metres across (a default by kind when the article gives none)
          gone: gone.has(p.pageprops?.wikibase_item),
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
      thumbnail: httpsOnly(d.thumbnail?.source),
      lat: d.coordinates?.lat ?? null,
      lon: d.coordinates?.lon ?? null,
      url: httpsOnly(d.content_urls?.mobile?.page) ?? httpsOnly(d.content_urls?.desktop?.page) ?? `${host}/wiki/${path}`,
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
   * Places worth a stop within `radius` meters, in two requests: the nearest articles, and the
   * most notable ones anywhere in the radius (in a dense centre the nearest few hundred only
   * reach a few streets; Wikipedia's search ranks by how linked and read a page is). Each
   * place comes with what it takes to judge it: article length, description, how many
   * languages have an article about it, and what kind of place its coordinates mark, and
   * whether it's still standing (one more, small request to Wikidata: `gone`).
   * Throws only if both Wikipedia requests fail.
   */
  async function exploreArea(lat, lon, radius = 2000, limit = 200, notable = 200) {
    // The nearest-articles search stops at 10 km; the notable-places search goes further (driving).
    const meters = Math.min(50000, Math.max(10, Math.round(radius)));
    const details = { prop: 'info|description|pageprops|langlinkscount|coordinates', ppprop: 'disambiguation|wikibase_item', coprop: 'type', colimit: 'max' };
    const query = (params) =>
      getJson(`${host}/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...details, ...params })}`);
    const [nearest, notables, goneAnswer] = await Promise.allSettled([
      query({ generator: 'geosearch', ggscoord: `${lat.toFixed(4)}|${lon.toFixed(4)}`, ggsradius: String(Math.min(10000, meters)), ggslimit: String(Math.min(500, limit)) }),
      notable > 0
        ? query({ generator: 'search', gsrsearch: `nearcoord:${meters}m,${lat.toFixed(4)},${lon.toFixed(4)}`, gsrnamespace: '0', gsrlimit: String(Math.min(500, notable)) }) // whole meters: "3.0km" isn't understood
        : Promise.resolve(null),
      // Optional: without an answer in time, plan anyway.
      atMost(8000, goneAround(lat, lon, meters).catch(() => new Set()), new Set()),
    ]);
    const answers = [nearest, notables];
    if (answers.every((a) => a.status === 'rejected')) throw answers[0].reason;
    const gone = goneAnswer.value ?? new Set();
    const byId = new Map();
    for (const answer of answers) {
      for (const p of answer.value?.query?.pages ?? []) {
        const coord = p.coordinates?.[0];
        if (!coord || byId.has(p.pageid)) continue;
        const poi = {
          id: p.pageid,
          title: p.title,
          lat: coord.lat,
          lon: coord.lon,
          coordType: coord.type ?? null,
          length: p.length ?? null,
          description: p.description ?? '',
          thumbnail: null,
          disambiguation: !!p.pageprops && 'disambiguation' in p.pageprops,
          langs: p.langlinkscount ?? 0, // left out when there are none
          gone: gone.has(p.pageprops?.wikibase_item), // demolished: not a stop
        };
        poi.category = classifyPlace(poi);
        byId.set(p.pageid, poi);
      }
    }
    // Search finds pages by any coordinate; keep the ones whose main location is in the radius.
    return [...byId.values()].filter((p) => distanceMeters({ lat, lon }, p) <= meters * 1.05);
  }

  /**
   * Mark the places whose Wikipedia categories say they were demolished or destroyed (`gone`),
   * for the few that matter: the stops of a route, the places in front of the camera. One
   * request per 20 places; any that can't be checked are left as they are.
   */
  async function markDemolished(places) {
    const todo = places.filter((p) => p?.title && !p.gone);
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        origin: '*',
        prop: 'categories',
        clshow: '!hidden',
        cllimit: 'max',
        titles: batch.map((p) => p.title).join('|'),
      });
      const data = await getJson(`${host}/w/api.php?${params}`).catch(() => null);
      const byTitle = new Map((data?.query?.pages ?? []).map((pg) => [pg.title, (pg.categories ?? []).map((c) => c.title)]));
      for (const p of batch) {
        const cats = byTitle.get(p.title) ?? [];
        if (cats.some((c) => DEMOLISHED_CATEGORY_RE.test(c)) && !cats.some((c) => REBUILT_CATEGORY_RE.test(c))) p.gone = true;
      }
    }
    return places;
  }

  /** Wikidata ids of the buildings within `meters` that no longer stand (one search, ~15 KB in central Paris). */
  async function goneAround(lat, lon, meters) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      list: 'search',
      srsearch: `haswbstatement:${GONE_STATEMENTS} nearcoord:${meters}m,${lat.toFixed(4)},${lon.toFixed(4)}`,
      srnamespace: '0',
      srlimit: '500',
      srprop: '',
    });
    const data = await getJson(`https://www.wikidata.org/w/api.php?${params}`);
    return new Set((data?.query?.search ?? []).map((hit) => hit.title));
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
      gsrsearch: `nearcoord:${Math.round(Math.min(20000, radius))}m,${lat.toFixed(3)},${lon.toFixed(3)}`, // whole meters only; ~100 m is plenty
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

  return { lang, nearby, summary, titleFromWikidata, resolveArticle, exploreArea, neighbourhoods, markDemolished };
}
