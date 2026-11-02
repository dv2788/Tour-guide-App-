// What the app remembers between visits (localStorage "roamie:setup"), checked on the way in.
// Anything on the same address could have written it, or an old version, or a full disk: keep
// only well-formed values, so a damaged save can never break the app or reach the page as code.

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const optStr = (v, max) => (v == null ? null : str(v, max) ?? null);
const optNum = (v) => (v == null ? null : num(v) ?? null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const onEarth = (p) => isObj(p) && num(p.lat) !== undefined && num(p.lon) !== undefined && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** A point { lat, lon, name?, … } with its text fields as text, or null. */
function cleanPoint(p) {
  if (!onEarth(p)) return null;
  const out = { lat: p.lat, lon: p.lon };
  for (const key of ['name', 'label', 'query', 'city']) if (p[key] != null) out[key] = optStr(p[key], 300);
  return out;
}

function cleanImported(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list.slice(0, 200)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isObj(entry[1])) continue;
    const v = entry[1];
    const hasPoint = v.lat != null || v.lon != null;
    if (hasPoint && !onEarth(v)) continue;
    out.push([
      entry[0].slice(0, 300),
      {
        ...(hasPoint ? { lat: v.lat, lon: v.lon } : {}),
        query: optStr(v.query, 300),
        kind: optStr(v.kind, 20),
        visitMinutes: optNum(v.visitMinutes),
        stayMinutes: optNum(v.stayMinutes),
        meal: optStr(v.meal, 20),
        breakMinutes: optNum(v.breakMinutes),
        wikipedia: optStr(v.wikipedia, 300),
        wikidata: optStr(v.wikidata, 30),
      },
    ]);
  }
  return out;
}

function cleanOption(o) {
  if (!onEarth(o) || typeof o.name !== 'string') return null;
  return {
    name: o.name.slice(0, 300),
    lat: o.lat,
    lon: o.lon,
    amenity: optStr(o.amenity, 40),
    open: typeof o.open === 'boolean' ? o.open : null,
    closes: optNum(o.closes),
    wikipedia: optStr(o.wikipedia, 300),
    wikidata: optStr(o.wikidata, 30),
  };
}

function cleanPlan(plan) {
  if (!isObj(plan) || !Array.isArray(plan.items)) return null;
  if (num(plan.minutes) === undefined || num(plan.meters) === undefined) return null;
  if (typeof plan.startedAt !== 'string' || Number.isNaN(Date.parse(plan.startedAt))) return null;
  const items = [];
  for (const it of plan.items.slice(0, 60)) {
    if (!onEarth(it) || typeof it.name !== 'string' || num(it.arrive) === undefined) return null;
    const item = {
      name: it.name.slice(0, 300),
      kind: optStr(it.kind, 20),
      meal: optStr(it.meal, 20),
      visitMinutes: optNum(it.visitMinutes),
      stayMinutes: optNum(it.stayMinutes),
      breakMinutes: optNum(it.breakMinutes),
      description: str(it.description, 500) ?? '',
      arrive: it.arrive,
      lat: it.lat,
      lon: it.lon,
    };
    if (it.kind === 'food') {
      const options = Array.isArray(it.options) ? it.options.slice(0, 20).map(cleanOption).filter(Boolean) : [];
      item.open = typeof it.open === 'boolean' ? it.open : null;
      item.closes = optNum(it.closes);
      item.options = options;
      item.optionIndex = Number.isInteger(it.optionIndex) && it.optionIndex >= 0 && it.optionIndex < options.length ? it.optionIndex : 0;
    }
    items.push(item);
  }
  if (!items.length) return null;
  return { start: cleanPoint(plan.start), loop: plan.loop === true, minutes: plan.minutes, meters: plan.meters, startedAt: plan.startedAt, items };
}

/**
 * The saved setup, cleaned: text fields as text, places with real coordinates, choices among
 * the ones the form offers. choices: { lang: ['en', …], mode: […], source: […], rate: […], simSpeed: […] }.
 */
export function cleanSaved(raw, choices = {}) {
  if (!isObj(raw)) return null;
  const out = {};
  for (const key of ['city', 'area']) if (str(raw[key]) !== undefined) out[key] = str(raw[key], 300);
  if (str(raw.stops) !== undefined) out.stops = str(raw.stops, 20000);
  if (str(raw.range) !== undefined && /^\d{1,2}$/.test(raw.range)) out.range = raw.range;
  if (typeof raw.rangeAuto === 'boolean') out.rangeAuto = raw.rangeAuto;
  for (const [key, allowed] of Object.entries(choices)) {
    // Interests are several at once ("history" and "landscape"): only the ones offered, once each.
    if (key === 'interests') {
      if (Array.isArray(raw.interests)) out.interests = [...new Set(raw.interests.filter((v) => allowed.includes(v)))];
      continue;
    }
    if (typeof raw[key] === 'string' && allowed.includes(raw[key])) out[key] = raw[key];
  }
  if (typeof raw.voice === 'string' && /^(neural:[\w-]{1,80}:\d{1,3}|system:[^<>]{0,120})$/.test(raw.voice)) out.voice = raw.voice;
  out.imported = cleanImported(raw.imported);
  out.start = cleanPoint(raw.start);
  out.areaPoint = cleanPoint(raw.areaPoint);
  out.plan = cleanPlan(raw.plan);
  return out;
}
