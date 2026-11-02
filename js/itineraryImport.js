// Paste anything: a route shared from Google Maps, Apple Maps, Waze, OpenStreetMap, Bing,
// HERE WeGo, a geo: link, coordinates, or a plain list typed or copied from a note.
// Out come the stops (names and/or coordinates) and, when the link says, how you travel.

const URL_RE = /(?:https?:\/\/|geo:)[^\s<>"'`]+/gi;
const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
// "Your location" in the languages we support, plus what apps put in links.
const CURRENT_LOCATION_RE =
  /^(?:my[ -]location|your location|current location|ma position|votre position|position actuelle|mi ubicaci[óo]n|tu ubicaci[óo]n|ubicaci[óo]n actual|mein standort|dein standort|ihr standort|aktueller standort|la mia posizione|la tua posizione|posizione attuale|mylocation|my-location|here)$/i;

const SHORT_LINK_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.apple', 'share.here.com', 'bit.ly', 'tinyurl.com'];

/** Map app name for messages. */
export const SOURCE_LABELS = {
  google: 'Google Maps',
  apple: 'Apple Maps',
  waze: 'Waze',
  osm: 'OpenStreetMap',
  bing: 'Bing Maps',
  here: 'HERE WeGo',
  geo: 'a map link',
  text: 'your list',
};

/** "Eiffel Tower, Av. Gustave Eiffel, 75007 Paris, France" -> "Eiffel Tower" */
export function shortPlaceName(text) {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return text.trim();
  // "12, Rue de Rivoli" style: a bare house number isn't a name.
  if (parts.length > 1 && !/\p{L}{3,}/u.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

/** One stop from a value found in a link or a list: a string, or { text, lat, lon }. */
function toStop(raw) {
  if (raw && typeof raw === 'object') {
    const stop = toStop(raw.text);
    if (stop && !stop.current && stop.name && Number.isFinite(raw.lat)) Object.assign(stop, { lat: raw.lat, lon: raw.lon });
    return stop;
  }
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (CURRENT_LOCATION_RE.test(text)) return { current: true };
  const c = text.match(COORD_RE);
  if (c) {
    const lat = Number(c[1]);
    const lon = Number(c[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) return { name: null, query: null, lat, lon };
    return null;
  }
  return { name: shortPlaceName(text), query: text, lat: null, lon: null };
}

function coord(text) {
  const m = String(text ?? '').match(COORD_RE);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

const decodePathSegment = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s.replace(/\+/g, ' ');
  }
};

function modeFromWord(word) {
  const w = String(word ?? '').toLowerCase();
  if (/^(walk|walking|foot|w|pedestrian|wa)$/.test(w)) return 'walk';
  if (/^(bicycl|bicycling|cycling|bike|bicycle|b|c)$/.test(w) || w.startsWith('bicycl')) return 'cycle';
  if (/^(drive|driving|car|d|two-wheeler|motorcycle)$/.test(w)) return 'drive';
  return null; // transit and unknown: keep the traveller's own choice
}

// ---------- Google Maps ----------

function parseGoogle(u) {
  const p = u.searchParams;
  const parts = u.pathname.split('/').filter(Boolean);
  const data = decodePathSegment(u.pathname.match(/\/data=([^/?]*)/)?.[1] ?? ''); // a broken %-code mustn't throw
  const result = { source: 'google', values: [], coords: [], mode: null };

  // Travel mode: official URLs, data blob (!3e0 drive, !3e1 bike, !3e2 walk, !3e3 transit), legacy.
  const travel = p.get('travelmode') ?? p.get('dirflg');
  if (travel) result.mode = modeFromWord(travel);
  const e = [...data.matchAll(/!3e(\d)/g)].at(-1)?.[1];
  if (e) result.mode = { 0: 'drive', 1: 'cycle', 2: 'walk' }[e] ?? null;

  if (p.has('destination') || p.has('origin')) {
    // https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b
    result.values.push(p.get('origin'), ...(p.get('waypoints')?.split('|') ?? []), p.get('destination'));
  } else if (p.has('daddr')) {
    // Legacy: maps.google.com/maps?saddr=A&daddr=B+to:C
    result.values.push(p.get('saddr'), ...p.get('daddr').split(/\s+to:/));
  } else if (parts[1] === 'dir') {
    // /maps/dir/Eiffel+Tower,+Paris/Louvre/@48.86,2.31,14z/data=…
    for (const seg of parts.slice(2)) {
      if (seg.startsWith('@') || seg.startsWith('data=')) break;
      result.values.push(decodePathSegment(seg));
    }
    // The data blob lists each named stop's coordinates as !1d<lon>!2d<lat>.
    result.coords = [...data.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].map((m) => ({ lat: Number(m[2]), lon: Number(m[1]) }));
  } else if (parts[1] === 'place' && parts[2]) {
    // /maps/place/Eiffel+Tower/@48.85,2.29,17z/data=…!3d48.8583701!4d2.2944813
    const lat = data.match(/!3d(-?\d+\.\d+)/)?.[1];
    const lon = data.match(/!4d(-?\d+\.\d+)/)?.[1];
    result.values.push({ text: decodePathSegment(parts[2]), ...(lat && lon ? { lat: Number(lat), lon: Number(lon) } : {}) });
  } else if (parts[1] === 'search' && parts[2] && !parts[2].startsWith('@')) {
    result.values.push(decodePathSegment(parts[2]));
  } else {
    result.values.push(p.get('query') ?? p.get('q') ?? p.get('ll'));
  }
  return result;
}

// ---------- Apple Maps ----------

function parseApple(u) {
  const p = u.searchParams;
  const result = { source: 'apple', values: [], coords: [], mode: null };
  if (u.pathname.startsWith('/directions')) {
    // https://maps.apple.com/directions?source=…&waypoint=…&destination=…&mode=walking
    result.values.push(p.get('source'), ...p.getAll('waypoint'), p.get('destination'));
    result.mode = modeFromWord(p.get('mode'));
  } else if (p.has('daddr')) {
    // Legacy: https://maps.apple.com/?saddr=…&daddr=…&dirflg=w
    result.values.push(p.get('saddr'), ...p.get('daddr').split(/\s+to:/));
    result.mode = modeFromWord(p.get('dirflg'));
  } else {
    // A single place: /place?name=…&coordinate=…&address=…, legacy ?q=…&ll=…&address=…
    const name = p.get('name') ?? p.get('q') ?? p.get('query');
    const address = p.get('address');
    const at = coord(p.get('coordinate') ?? p.get('ll') ?? p.get('center'));
    if (name || address) result.values.push({ text: [name, address].filter(Boolean).join(', '), ...at });
    else if (at) result.values.push(`${at.lat},${at.lon}`);
  }
  return result;
}

// ---------- Waze ----------

const GEOHASH = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Decode a geohash ("u09tunq…") to its centre point. */
export function decodeGeohash(hash) {
  const lat = [-90, 90];
  const lon = [-180, 180];
  let even = true;
  for (const ch of hash.toLowerCase()) {
    const v = GEOHASH.indexOf(ch);
    if (v < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const range = even ? lon : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((v >> bit) & 1) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}

function slugToName(slug) {
  return decodePathSegment(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function parseWaze(u) {
  const p = u.searchParams;
  const result = { source: 'waze', values: [], coords: [], mode: 'drive' };
  const hash = u.pathname.match(/\/ul\/h([0-9a-z]+)/i)?.[1];
  if (hash) {
    // https://waze.com/ul/hu09tunqu5 (what the app shares)
    const at = decodeGeohash(hash);
    if (at) result.values.push(`${at.lat},${at.lon}`);
    return result;
  }
  if (u.pathname.includes('/directions')) {
    // https://www.waze.com/live-map/directions/fr/idf/paris/tour-eiffel?to=ll.48.858,2.294&from=…
    const name = u.pathname.split('/').filter(Boolean).at(-1);
    for (const key of ['from', 'to']) {
      const v = p.get(key);
      if (!v) continue;
      const at = v.startsWith('ll.') ? coord(v.slice(3)) : null;
      if (key === 'to' && name && name !== 'directions') {
        result.values.push({ text: slugToName(name), ...at });
      } else if (at) {
        result.values.push(`${at.lat},${at.lon}`);
      }
    }
    return result;
  }
  // https://waze.com/ul?ll=48.858,2.294&navigate=yes&q=Tour%20Eiffel
  const at = coord(p.get('ll'));
  const q = p.get('q');
  if (q) {
    result.values.push({ text: q, ...at });
  } else if (at) {
    result.values.push(`${at.lat},${at.lon}`);
  }
  return result;
}

// ---------- OpenStreetMap, Bing, HERE, geo: ----------

function parseOsm(u) {
  const p = u.searchParams;
  const result = { source: 'osm', values: [], coords: [], mode: null };
  const engine = p.get('engine') ?? '';
  result.mode = /car/.test(engine) ? 'drive' : /bike|bicycle/.test(engine) ? 'cycle' : /foot/.test(engine) ? 'walk' : null;
  if (p.get('route')) result.values.push(...p.get('route').split(';'));
  else if (p.get('mlat') && p.get('mlon')) result.values.push(`${p.get('mlat')},${p.get('mlon')}`);
  return result;
}

function parseBing(u) {
  const p = u.searchParams;
  const result = { source: 'bing', values: [], coords: [], mode: null };
  result.mode = { w: 'walk', d: 'drive' }[(p.get('mode') ?? '').toLowerCase()] ?? null;
  for (const point of (p.get('rtp') ?? '').split('~')) {
    if (point.startsWith('adr.')) result.values.push(point.slice(4));
    else if (point.startsWith('pos.')) {
      const [lat, lon, ...name] = point.slice(4).split('_');
      if (name.length && name.join(' ').trim()) {
        result.values.push({ text: name.join(' '), lat: Number(lat), lon: Number(lon) });
      } else {
        result.values.push(`${lat},${lon}`);
      }
    }
  }
  if (!result.values.length && (p.get('q') || p.get('where1'))) result.values.push(p.get('q') ?? p.get('where1'));
  return result;
}

function parseHere(u) {
  // https://wego.here.com/directions/walk/Eiffel-Tower:48.8583,2.2944/Louvre:48.8606,2.3376
  const parts = u.pathname.split('/').filter(Boolean);
  const result = { source: 'here', values: [], coords: [], mode: null };
  if (parts[0] !== 'directions') return result;
  result.mode = modeFromWord({ walk: 'walk', drive: 'drive', bicycle: 'bike' }[parts[1]]);
  for (const seg of parts.slice(2)) {
    const [rawName, at] = decodePathSegment(seg).split(':');
    const c = coord(at);
    const name = rawName && !/^(start|end|mylocation)$/i.test(rawName) ? rawName.replace(/-/g, ' ') : null;
    if (name) {
      result.values.push({ text: name, ...c });
    } else if (c) {
      result.values.push(`${c.lat},${c.lon}`);
    }
  }
  return result;
}

function parseGeo(text) {
  // geo:48.8583,2.2944?q=48.8583,2.2944(Eiffel Tower)  or  geo:0,0?q=Eiffel+Tower+Paris
  const result = { source: 'geo', values: [], coords: [], mode: null };
  const [, where = '', query = ''] = text.match(/^geo:([^?]*)\??(.*)$/i) ?? [];
  const q = new URLSearchParams(query).get('q');
  const at = coord(where.split(';')[0]);
  const labelled = q?.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\((.+)\)$/);
  if (labelled) {
    result.values.push({ text: labelled[3], lat: Number(labelled[1]), lon: Number(labelled[2]) });
  } else if (q) {
    result.values.push(q);
  } else if (at && !(at.lat === 0 && at.lon === 0)) {
    result.values.push(`${at.lat},${at.lon}`);
  }
  return result;
}

/** Is this a short link that has to be expanded before it can be read? */
export function isShortLink(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'goo.gl') return u.pathname.startsWith('/maps');
    if (host === 'g.co') return u.pathname.startsWith('/kgs');
    return SHORT_LINK_HOSTS.includes(host);
  } catch {
    return false;
  }
}

/** Parse one map link. Returns { source, values, coords, mode } or null if not a map link. */
export function parseMapLink(text) {
  if (/^geo:/i.test(text)) return parseGeo(text);
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'consent.google.com' && u.searchParams.get('continue')) return parseMapLink(u.searchParams.get('continue'));
  if (/(^|\.)google\.[a-z.]+$/.test(host) && (u.pathname.startsWith('/maps') || host.startsWith('maps.'))) return parseGoogle(u);
  if (host === 'maps.apple.com') return parseApple(u);
  if (host === 'waze.com' || host.endsWith('.waze.com')) return parseWaze(u);
  if (host.endsWith('openstreetmap.org')) return parseOsm(u);
  if (host.endsWith('bing.com') && u.pathname.startsWith('/maps')) return parseBing(u);
  if (host.endsWith('here.com')) return parseHere(u);
  return null;
}

/** Turn parsed values into stops. `coords` (Google directions) are matched to named stops by position. */
function buildStops({ values, coords }) {
  const stops = [];
  let includesCurrentLocation = false;
  for (const v of values) {
    const stop = toStop(v);
    if (!stop) continue;
    if (stop.current) includesCurrentLocation = true;
    else stops.push(stop);
  }
  // Coordinates belong to named stops, in order, when the counts line up.
  const named = stops.filter((s) => s.name && s.lat == null);
  if (coords?.length && coords.length === named.length) {
    named.forEach((s, i) => Object.assign(s, coords[i]));
  }
  return { stops, includesCurrentLocation };
}

const LEADING_MARKER = /^\s*(?:[-*•·▪◦‣–—]|\d{1,2}[.)]|\(\d{1,2}\)|[A-Z][.)])\s+/;
const ARROWS = /\s*(?:→|➔|➜|⟶|->|=>|»|>)\s*/;
// Turn-by-turn steps copied along with a route: a verb first AND a direction word.
const INSTRUCTION =
  /^(?:head|turn|continue|take|keep|slight|walk|drive|cycle|merge|exit|use the|at the roundabout|destination will|prenez|tournez|continuez|gire|siga|biegen|weiter|svolta|prosegui)\b/i;
const DIRECTION_WORD =
  /\b(?:north|south|east|west|northeast|northwest|southeast|southwest|left|right|onto|toward|towards|straight|roundabout|exit|nord|sud|est|ouest|gauche|droite|izquierda|derecha|links|rechts|sinistra|destra|on the)\b/i;
const DURATION = /^\(?\d+(?:[.,]\d+)?\s*(?:min|mins|minutes|h|hr|hrs|km|m|mi|miles|ft|s)\b/i;
const DIRECTIONS_FROM_TO =
  /^(?:directions|route|itin[ée]raire|ruta|c[óo]mo llegar|route planen|percorso|indicazioni)?\s*(?:from|de|depuis|desde|von|da)\s+(.+?)\s+(?:to|à|a|hasta|nach|zu|per)\s+(.+)$/i;
const DIRECTIONS_TO = /^(?:directions|route|itin[ée]raire|ruta|percorso|indicazioni)\s+(?:to|vers|pour|a|hacia|nach|zu|per)\s+(.+)$/i;

/** Stops from plain text: one per line, numbered or bulleted lists, "A → B → C". */
export function parseTextList(text) {
  const values = [];
  for (const rawLine of text.replace(URL_RE, '\n').split(/\r?\n|;|\s\|\s/)) {
    // One space between words and a sane length first: pasted text can hide long runs of tabs or
    // no-break spaces, which would make the patterns below crawl (and freeze the phone).
    const line = rawLine.replace(/\s+/g, ' ').slice(0, 2000).replace(LEADING_MARKER, '').trim();
    if (!line || (INSTRUCTION.test(line) && DIRECTION_WORD.test(line)) || DURATION.test(line) || /^via\b/i.test(line)) continue;
    const fromTo = line.match(DIRECTIONS_FROM_TO);
    const to = line.match(DIRECTIONS_TO);
    if (fromTo && /^(?:directions|route|itin|ruta|c[óo]mo|percorso|indicazioni|from|de|depuis|desde|von|da)\b/i.test(line)) {
      values.push(fromTo[1], fromTo[2]);
    } else if (to) {
      values.push(to[1]);
    } else {
      values.push(...line.split(ARROWS));
    }
  }
  const { stops, includesCurrentLocation } = buildStops({ values: values.map((v) => v.replace(/[.:]$/, '')), coords: [] });
  // Drop exact repeats in a row ("Louvre" then "Louvre").
  const deduped = stops.filter((s, i) => i === 0 || (s.query ?? `${s.lat},${s.lon}`) !== (stops[i - 1].query ?? `${stops[i - 1].lat},${stops[i - 1].lon}`));
  return { source: 'text', stops: deduped, mode: null, includesCurrentLocation, shortLinks: [] };
}

/**
 * Read whatever was pasted. Map links win over surrounding text; if the only links are
 * short links (which need expanding first), any place names in the text are used.
 */
export function parseItinerary(input) {
  const text = String(input ?? '').trim();
  const links = text.match(URL_RE) ?? [];
  const shortLinks = links.filter(isShortLink);
  const parsed = links.filter((l) => !isShortLink(l)).map(parseMapLink).filter(Boolean);

  const withStops = parsed.map((r) => ({ r, ...buildStops(r) })).filter((x) => x.stops.length);
  if (withStops.length) {
    return {
      source: withStops[0].r.source,
      stops: withStops.flatMap((x) => x.stops),
      mode: withStops.find((x) => x.r.mode)?.r.mode ?? null,
      includesCurrentLocation: withStops.some((x) => x.includesCurrentLocation),
      shortLinks,
    };
  }
  const fromText = parseTextList(text);
  return { ...fromText, shortLinks };
}
