// Screen wiring: the setup form, the map, the "now playing" card and the controls.

import { getMode, MODES } from './modes.js';
import { SAMPLES, DEFAULT_SAMPLE, sampleById } from './samples.js';
import { LANGUAGES, speechLocale } from './i18n.js';
import { createWikiService } from './wiki.js';
import { createGeocoder, fetchRoute, fetchDirections, fetchStreetName } from './geocode.js';
import { Navigator, mapsLink } from './navigation.js';
import { Narrator } from './narrator.js';
import { GpsSource, SimulatedSource } from './location.js';
import { TourEngine } from './tourEngine.js';
import { distanceMeters } from './geo.js';
import { parseItinerary, parseTextList, SOURCE_LABELS } from './itineraryImport.js';
import { NEURAL_VOICES, neuralVoiceKey, parseVoiceKey, rankSystemVoices, PREVIEW_TEXT, PREVIEW_TEXT_DOCUMENTARY, voiceProfile } from './voices.js';
import { isVoiceDownloaded, neuralVoicesSupported } from './neuralVoice.js';
import { formatClock } from './openingHours.js';
import {
  suggestRoute,
  searchRadiusFor,
  breakSchedule,
  placeBreaks,
  addBreaks,
  pickFoodPlaces,
  findFoodNear,
  timeline,
} from './suggest.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'roamie:setup';
const OLD_STORAGE_KEY = 'tour-guide:setup'; // before the app was called Roamie

// ---------- Setup form ----------

const form = $('setup-form');

// A concierge's greeting.
const hour = new Date().getHours();
$('greeting').textContent = hour < 5 ? 'Good evening.' : hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';

for (const { code, label } of LANGUAGES) {
  $('lang').append(new Option(label, code));
}
const browserLang = (navigator.language || 'en').slice(0, 2);
if (LANGUAGES.some((l) => l.code === browserLang)) $('lang').value = browserLang;

function readForm() {
  const data = new FormData(form);
  return {
    city: (data.get('city') ?? '').toString().trim(),
    stops: (data.get('stops') ?? '').toString(),
    mode: data.get('mode') ?? 'walk',
    lang: data.get('lang') ?? 'en',
    rate: data.get('rate') ?? '1',
    source: data.get('source') ?? 'gps',
    simSpeed: data.get('simSpeed') ?? '8',
    voice: selectedVoiceKey(),
    imported: [...imported.entries()],
    start: startPoint,
    plan,
  };
}

function fillForm(values) {
  if (Array.isArray(values.imported)) imported = new Map(values.imported);
  if ('start' in values) startPoint = values.start ?? null;
  if ('plan' in values) plan = values.plan ?? null;
  for (const [key, value] of Object.entries(values)) {
    if (['imported', 'voice', 'start', 'plan'].includes(key)) continue;
    const el = form.elements[key];
    if (!el || value == null) continue;
    if (el instanceof RadioNodeList) {
      for (const radio of el) radio.checked = radio.value === value;
    } else {
      el.value = value;
    }
  }
  syncFormHints();
}

function syncFormHints() {
  const { mode, source } = readForm();
  $('drive-note').hidden = mode !== 'drive';
  $('sim-speed-row').hidden = source !== 'sim';
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function save(values) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // private mode or storage blocked: not essential
  }
}

form.addEventListener('change', syncFormHints);
// ---------- Sample tours ----------

function loadSample(id) {
  const sample = sampleById(id);
  imported = new Map();
  plan = null;
  renderPlan();
  showPlanMap();
  // Start from the first stop (not from wherever you are now), simulated from the sofa.
  fillForm({ city: sample.city, stops: sample.stops.join('\n'), mode: sample.mode, source: 'sim', simSpeed: '8', start: null, lang: $('lang').value });
  for (const el of document.querySelectorAll('.sample')) el.setAttribute('aria-pressed', String(el.dataset.id === sample.id));
  showImportNote(`✓ Sample tour of ${sample.label}: ${sample.stops.length} stops. Tap “Begin the tour” to try it from your sofa.`);
  $('setup-error').textContent = '';
}

$('samples').replaceChildren(
  ...SAMPLES.map((sample) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample';
    button.dataset.id = sample.id;
    button.setAttribute('aria-pressed', 'false');
    const how = sample.mode === 'drive' ? 'by car' : 'on foot';
    button.innerHTML = `<span class="sample-city"></span><span class="sample-blurb"></span><span class="sample-meta"><svg class="icon" role="img" aria-label="${how}"><use href="#i-${sample.mode === 'drive' ? 'car' : 'walk'}" /></svg>${sample.stops.length} stops · ${sample.km} km</span>`;
    button.querySelector('.sample-city').textContent = sample.label;
    button.querySelector('.sample-blurb').textContent = sample.blurb;
    button.addEventListener('click', () => loadSample(sample.id));
    return button;
  }),
);
$('demo').addEventListener('click', () => loadSample(DEFAULT_SAMPLE));

// ---------- Importing a route from a maps app ----------

// Stops we already know precisely (from a pasted link), by the name shown in the box.
let imported = new Map();
let importRun = 0;

function showImportNote(text, tone = '') {
  const note = $('import-note');
  note.hidden = !text;
  note.textContent = text;
  note.dataset.tone = tone;
}

/** Ask our tiny server function to expand a short link (only exists on Cloudflare Pages). */
async function expandShortLink(url) {
  try {
    const res = await fetch(`api/resolve-link?url=${encodeURIComponent(url)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok || !(res.headers.get('Content-Type') ?? '').includes('json')) return null;
    return (await res.json()).url ?? null;
  } catch {
    return null;
  }
}

async function importRoute(text, { replace = true } = {}) {
  const run = ++importRun;
  const lang = $('lang').value;
  let result = parseItinerary(text);

  if (result.shortLinks.length) {
    showImportNote('Opening the short link…');
    const expanded = (await Promise.all(result.shortLinks.map(expandShortLink))).filter(Boolean);
    if (run !== importRun) return;
    if (expanded.length) {
      const fromLinks = parseItinerary(expanded.join('\n'));
      if (fromLinks.stops.length) result = fromLinks;
    }
  }

  if (!result.stops.length) {
    showImportNote(
      result.shortLinks.length
        ? "That's a short link, which I can't open from here. Open it in your browser and copy the long address from the address bar, or type your stops (one per line)."
        : "I couldn't find any places in that. Try copying the route again, or type your stops (one per line).",
      'warn',
    );
    return;
  }

  const geocoder = createGeocoder({ lang });
  // Stops given only as coordinates (Waze, OpenStreetMap…): find out what's there.
  const unnamed = result.stops.filter((s) => !s.name);
  for (const [i, stop] of unnamed.entries()) {
    showImportNote(`Looking up place names… ${i + 1}/${unnamed.length}`);
    const place = await geocoder.reverse(stop).catch(() => null);
    if (run !== importRun) return;
    stop.name = place?.name ?? `${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`;
    stop.query = place?.displayName ?? stop.name;
  }

  // Make names unique: the box shows one line per stop and we look them up by name.
  const seen = new Map();
  for (const stop of result.stops) {
    const n = (seen.get(stop.name) ?? 0) + 1;
    seen.set(stop.name, n);
    if (n > 1) stop.name = `${stop.name} (${n})`;
  }

  const box = $('stops');
  const keep = replace || !box.value.trim() ? '' : `${box.value.trim()}\n`;
  if (!keep) imported = new Map();
  for (const stop of result.stops) imported.set(stop.name, { query: stop.query ?? stop.name, lat: stop.lat, lon: stop.lon });
  box.value = keep + result.stops.map((s) => s.name).join('\n');

  const parts = [`✓ ${result.stops.length} stop${result.stops.length > 1 ? 's' : ''} from ${SOURCE_LABELS[result.source]}`];
  if (result.mode && MODES[result.mode]) {
    fillForm({ mode: result.mode });
    parts.push(`set to ${MODES[result.mode].label.toLowerCase()}`);
  }
  if (result.includesCurrentLocation) parts.push('starting from where you are');

  // No city typed yet? Work it out from the first stop.
  const first = result.stops.find((s) => s.lat != null);
  if (!$('city').value.trim() && first) {
    const city = await geocoder.reverse(first, 10).catch(() => null);
    if (run !== importRun) return;
    if (city?.name) {
      $('city').value = city.name;
      parts.push(`in ${city.name}`);
    }
  }
  showImportNote(parts.join(' · '));
  save(readForm());
}

$('stops').addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text') ?? '';
  if (!/(?:https?:\/\/|geo:)/i.test(text)) return; // plain text: normal paste
  event.preventDefault();
  const box = $('stops');
  const replace = !box.value.trim() || (box.selectionStart === 0 && box.selectionEnd === box.value.length);
  importRoute(text, { replace });
});

// Typing a stop by hand: forget precise coordinates for lines that no longer match.
$('stops').addEventListener('input', () => {
  const lines = new Set($('stops').value.split('\n').map((l) => l.trim()));
  for (const name of imported.keys()) if (!lines.has(name)) imported.delete(name);
  if (plan) {
    plan = null; // it's the traveller's own list now
    renderPlan();
  }
  showPlanMap();
});

if (!navigator.clipboard?.readText) $('paste-route').hidden = true;
$('paste-route').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showImportNote('Your clipboard is empty. Copy a route in your maps app first (Share → Copy).', 'warn');
      return;
    }
    if (/(?:https?:\/\/|geo:)/i.test(text)) await importRoute(text);
    else {
      const list = parseTextList(text);
      imported = new Map();
      $('stops').value = list.stops.map((s) => s.name ?? `${s.lat}, ${s.lon}`).join('\n');
      showImportNote(`✓ ${list.stops.length} stops from your clipboard`);
    }
  } catch {
    $('stops').focus();
    showImportNote('Long-press the box and choose Paste.', 'warn');
  }
});

// ---------- Where you are, and suggested routes ----------

let startPoint = null; // { lat, lon, name } from "Use my location"
let plan = null; // the suggested route: { start, loop, minutes, meters, startedAt, items: [...] }

function showLocateNote(text, tone = '') {
  const note = $('locate-note');
  note.hidden = !text;
  note.textContent = text;
  note.dataset.tone = tone;
}

/** Ask the browser where we are, name the city, and centre the plan around it. */
async function locateMe({ silent = false } = {}) {
  if (!('geolocation' in navigator)) {
    if (!silent) showLocateNote("This browser can't share your location. Type your city instead.", 'warn');
    return null;
  }
  if (!silent) showLocateNote('Finding where you are…');
  let pos;
  try {
    pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }),
    );
  } catch (err) {
    if (!silent) {
      showLocateNote(
        err?.code === 1
          ? 'Location is turned off for this site. Allow it in your browser settings, or type your city.'
          : "I couldn't find your location just now. Type your city, or try again outside.",
        'warn',
      );
    }
    return null;
  }
  const here = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: null };
  const city = await createGeocoder({ lang: $('lang').value })
    .reverse(here, 10)
    .catch(() => null);
  here.name = city?.name ?? null;
  startPoint = here;
  if (here.name && !$('city').value.trim()) $('city').value = here.name;
  showLocateNote(here.name ? `✓ You're in ${here.name}. I'll plan around where you are.` : "✓ Got your location. I'll plan around where you are.");
  showPlanMap();
  save(readForm());
  return here;
}

$('locate-me').addEventListener('click', () => locateMe());
// Already allowed before? Then just do it.
navigator.permissions
  ?.query({ name: 'geolocation' })
  .then((p) => {
    if (p.state === 'granted' && !startPoint) locateMe({ silent: true });
  })
  .catch(() => {});

$('suggest-open').addEventListener('click', () => {
  const panel = $('suggest-panel');
  panel.hidden = !panel.hidden;
  $('suggest-open').setAttribute('aria-expanded', String(!panel.hidden));
});

const MEAL_LABEL = { coffee: 'Coffee break', lunch: 'Lunch', dinner: 'Dinner', drink: 'A drink' };
const MEAL_ICON = { coffee: 'cafe', lunch: 'restaurant', dinner: 'restaurant', drink: 'bar' };

function formatMinutes(min) {
  if (min < 60) return `${min} min`;
  const rounded = Math.round(min / 5) * 5; // 3 h 58 -> "4 h", never "3 h 60"
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function planRoute() {
  const button = $('suggest-go');
  const { mode: modeId, lang } = readForm();
  const minutes = Number(form.querySelector('input[name=duration]:checked')?.value ?? 60);
  const loop = $('loop').checked;
  button.disabled = true;
  try {
    let origin = startPoint ?? (await locateMe());
    if (!origin && $('city').value.trim()) {
      showImportNote(`Finding ${$('city').value.trim()}…`);
      const city = await createGeocoder({ lang }).findCity($('city').value.trim()).catch(() => null);
      if (city) origin = { lat: city.lat, lon: city.lon, name: city.name };
    }
    if (!origin) {
      showImportNote('Tell me where you are first: tap "Use my location" or type your city.', 'warn');
      return;
    }

    showImportNote('Looking for the places with the most history around you…');
    const candidates = await createWikiService({ lang })
      .exploreArea(origin.lat, origin.lon, searchRadiusFor(modeId, minutes), 300)
      .catch(() => []);
    const startedAt = new Date();
    const schedule = breakSchedule(startedAt, minutes);
    const route = suggestRoute({
      start: origin,
      candidates,
      modeId,
      minutes,
      loop,
      reservedMinutes: schedule.reduce((n, b) => n + b.minutes, 0),
    });
    if (!route.stops.length) {
      showImportNote("I couldn't find enough interesting places nearby. Try a longer outing, or another way of getting around.", 'warn');
      return;
    }

    // Food and drink, at the right moments.
    const placed = placeBreaks(origin, route.stops, schedule, modeId, loop);
    const geocoder = createGeocoder({ lang });
    const radius = modeId === 'drive' ? 1500 : modeId === 'cycle' ? 700 : 400;
    const { times: baseTimes } = timeline(origin, route.stops, modeId, loop);
    const used = [];
    let shift = 0; // earlier breaks push later ones back
    for (const b of [...placed].sort((x, y) => x.afterIndex - y.afterIndex)) {
      showImportNote(`Finding a good spot for ${MEAL_LABEL[b.meal].toLowerCase()}…`);
      const near = route.stops[b.afterIndex];
      const when = new Date(startedAt.getTime() + (baseTimes[b.afterIndex].leave + shift) * 60000);
      const places = await findFoodNear(near, b.meal, { radius, geocoder });
      // Open when you'd get there, local rather than chains, with alternatives to choose from.
      b.options = pickFoodPlaces(places, b.meal, near, { radius, avoid: used, when, minutes: b.minutes });
      b.place = b.options[0] ?? null;
      if (b.place) {
        used.push(b.place.name);
        shift += b.minutes;
      }
    }
    const stops = addBreaks(route.stops, placed);
    const { times, minutes: total, meters } = timeline(origin, stops, modeId, loop);

    // Fill the itinerary box (still editable) and remember what we know about each stop.
    imported = new Map();
    const seen = new Map();
    const items = stops.map((stop, i) => {
      // "Royal Square (Barcelona)" is Wikipedia's way to tell places apart: say "Royal Square".
      let name = stop.kind === 'food' ? stop.title : stop.title.replace(/\s+\([^)]*\)$/, '');
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      if (n > 1) name = `${name} (${n})`;
      imported.set(name, {
        query: stop.title,
        lat: stop.lat,
        lon: stop.lon,
        kind: stop.kind,
        visitMinutes: stop.visitMinutes ?? null,
        meal: stop.meal ?? null,
        breakMinutes: stop.breakMinutes ?? null,
        wikipedia: stop.tags?.wikipedia ?? (stop.kind !== 'food' && stop.id ? `${lang}:${stop.title}` : null), // the very article it was picked from
        wikidata: stop.tags?.wikidata ?? null,
      });
      const item = { name, kind: stop.kind, meal: stop.meal ?? null, visitMinutes: stop.visitMinutes ?? null, breakMinutes: stop.breakMinutes ?? null, description: stop.description ?? '', arrive: times[i].arrive, lat: stop.lat, lon: stop.lon };
      if (stop.kind === 'food') {
        item.open = stop.open ?? null;
        item.closes = stop.closes ?? null;
        item.optionIndex = 0;
        item.options = (stop.options ?? [stop]).map((o) => ({
          name: o.name,
          lat: o.lat,
          lon: o.lon,
          amenity: o.amenity,
          open: o.open ?? null,
          closes: o.closes ?? null,
          wikipedia: o.tags?.wikipedia ?? null,
          wikidata: o.tags?.wikidata ?? null,
        }));
      }
      return item;
    });
    $('stops').value = items.map((it) => it.name).join('\n');
    plan = { start: origin, loop, minutes: total, meters, startedAt: startedAt.toISOString(), items };
    renderPlan();
    showPlanMap();
    // Fold the options away so the plan is right there.
    $('suggest-panel').hidden = true;
    $('suggest-open').setAttribute('aria-expanded', 'false');

    const sights = items.filter((it) => it.kind !== 'food').length;
    const breaks = items.length - sights;
    showImportNote(
      `✓ ${sights} place${sights > 1 ? 's' : ''} picked for their history` +
        (breaks ? ` and ${breaks} break${breaks > 1 ? 's' : ''}` : '') +
        `. Edit the list below if you like.`,
    );
    save(readForm());
  } finally {
    button.disabled = false;
  }
}
$('suggest-go').addEventListener('click', planRoute);

function renderPlan() {
  const box = $('plan');
  box.hidden = !plan;
  if (!plan) return;
  const start = new Date(plan.startedAt);
  $('plan-summary').textContent = `About ${formatMinutes(plan.minutes)} · ${(plan.meters / 1000).toFixed(1)} km${plan.loop ? ' round trip' : ''}`;
  $('plan-list').replaceChildren(
    ...plan.items.map((it, index) => {
      const kindClass = it.kind === 'food' ? 'food' : it.kind === 'museum' ? 'museum' : '';
      const iconName = it.kind === 'food' ? MEAL_ICON[it.meal] ?? 'cafe' : it.kind === 'museum' ? 'museum' : 'historic';
      const hours =
        it.open === true ? (it.closes != null ? ` · open until ${formatClock(it.closes)}` : ' · open') : it.open === null ? ' · check opening hours' : '';
      const sub =
        it.kind === 'food'
          ? `${MEAL_LABEL[it.meal] ?? 'Break'} · ${formatMinutes(it.breakMinutes)}${hours}`
          : it.visitMinutes
            ? `Museum visit · about ${formatMinutes(it.visitMinutes)} inside`
            : it.description || (it.kind === 'museum' ? 'Museum' : 'Historic place');
      const text = el('span', { className: 'plan-text' }, [el('strong', {}, [it.name]), el('small', {}, [sub])]);
      if (it.kind === 'food') text.append(foodActions(it, index));
      return el('li', {}, [
        el('span', { className: 'plan-time' }, [clock(new Date(start.getTime() + it.arrive * 60000))]),
        el('span', { className: `plan-icon ${kindClass}` }, [icon(iconName)]),
        text,
      ]);
    }),
  );
}

/** "Another place" (cycle through the alternatives) and "Reviews" (ratings, photos, hours in Google Maps). */
function foodActions(it, index) {
  const row = el('span', { className: 'plan-actions' });
  if ((it.options?.length ?? 0) > 1) {
    const swap = el('button', { type: 'button', className: 'text-btn' }, [`Another place (${it.optionIndex + 1}/${it.options.length})`]);
    swap.addEventListener('click', () => swapFood(index));
    row.append(swap);
  }
  const reviews = el('a', {
    className: 'text-btn',
    href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${it.name} ${it.lat.toFixed(5)},${it.lon.toFixed(5)}`)}`,
    target: '_blank',
    rel: 'noopener',
  }, ['Reviews ↗']);
  row.append(reviews);
  return row;
}

function swapFood(index) {
  const it = plan?.items[index];
  if (!it?.options?.length) return;
  const oldName = it.name;
  const old = imported.get(oldName) ?? {};
  // Next alternative that isn't already elsewhere in the plan.
  const taken = new Set(plan.items.filter((_, i) => i !== index).map((x) => x.name));
  let tries = 0;
  do {
    it.optionIndex = (it.optionIndex + 1) % it.options.length;
  } while (taken.has(it.options[it.optionIndex].name) && ++tries < it.options.length);
  const next = it.options[it.optionIndex];
  if (taken.has(next.name)) return;
  it.name = next.name;
  Object.assign(it, { lat: next.lat, lon: next.lon, open: next.open, closes: next.closes });
  imported.delete(oldName);
  imported.set(it.name, { ...old, query: next.name, lat: next.lat, lon: next.lon, wikipedia: next.wikipedia, wikidata: next.wikidata });
  const lines = $('stops').value.split('\n');
  const at = lines.findIndex((l) => l.trim() === oldName);
  if (at >= 0) lines[at] = it.name;
  $('stops').value = lines.join('\n');
  renderPlan();
  showPlanMap();
  save(readForm());
}

// A small map of the plan: where you are, the stops, and the way round.
let planMap = null;
let planLayer = null;
function showPlanMap() {
  const L = window.L;
  const box = $('plan-map');
  const lines = $('stops').value.split('\n').map((l) => l.trim()).filter(Boolean);
  const stops = lines.map((name) => ({ name, ...imported.get(name) })).filter((s) => s.lat != null);
  const origin = plan?.start ?? startPoint;
  if (!L || (!origin && !stops.length)) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (!planMap) {
    planMap = L.map(box, { zoomControl: false, attributionControl: true, dragging: true, scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 20 });
    addBaseMap(planMap);
    planLayer = L.layerGroup().addTo(planMap);
  }
  planMap.invalidateSize();
  planLayer.clearLayers();
  const points = [];
  if (origin) {
    L.marker([origin.lat, origin.lon], { icon: L.divIcon({ className: 'start-dot', iconSize: [18, 18] }), title: 'You' }).addTo(planLayer);
    points.push(origin);
  }
  stops.forEach((s, i) => {
    const icon = L.divIcon({ className: `stop-pin ${s.kind === 'food' ? 'food' : ''}`, html: `<span>${i + 1}</span>`, iconSize: [26, 26] });
    L.marker([s.lat, s.lon], { icon, title: s.name }).addTo(planLayer).bindTooltip(label(s.name));
    points.push(s);
  });
  if (plan?.loop && origin && stops.length) points.push(origin);
  if (points.length > 1) {
    // Dotted straight lines at first, replaced by the real way through the streets once it arrives.
    const direct = L.polyline(points.map((p) => [p.lat, p.lon]), { color: '#c9a55c', weight: 2, opacity: 0.8, dashArray: '2 7', lineCap: 'round' }).addTo(planLayer);
    const token = (showPlanMap.token = (showPlanMap.token ?? 0) + 1);
    const profile = getMode(readForm().mode).routeProfile;
    fetchRoute(points, profile).then((route) => {
      if (token !== showPlanMap.token || !route.routed) return;
      planLayer.removeLayer(direct);
      L.polyline(route.points.map((p) => [p.lat, p.lon]), { color: '#c9a55c', weight: 4, opacity: 0.95, lineCap: 'round', className: 'plan-route' }).addTo(planLayer);
    });
  }
  // Measure again once the layout has settled (the panel above may just have folded).
  const frame = () => {
    planMap.invalidateSize();
    if (points.length > 1) planMap.fitBounds(points.map((p) => [p.lat, p.lon]), { padding: [24, 24] });
    else planMap.setView([points[0].lat, points[0].lon], 14);
  };
  frame();
  requestAnimationFrame(() => requestAnimationFrame(frame));
}

// ---------- Choosing a guide (voice) ----------

function neuralVoiceInfo(lang, key) {
  return (NEURAL_VOICES[lang] ?? []).find((v) => v.id === key.id && (v.speaker ?? 0) === key.speaker);
}

/** The voice picked in the form, e.g. "neural:en_GB-jenny_dioco-medium:0" or "system:Samantha". */
function selectedVoiceKey() {
  const value = form.querySelector('input[name=voice]:checked')?.value ?? '';
  return value === 'system:' ? `system:${$('system-voice')?.value ?? ''}` : value;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** One selectable guide card: avatar, name, description, ▶ listen, status line. */
function guideCard({ value, name, note, avatar, avatarClass, badge }) {
  const id = `voice-${value.replace(/[^a-z0-9]+/gi, '-')}`;
  const card = el('div', { className: 'guide' });
  card.dataset.value = value;
  const radio = el('input', { type: 'radio', name: 'voice', value, id });
  const nameEl = el('strong', {}, [name]);
  if (badge) nameEl.append(el('span', { className: 'badge-doc' }, [badge]));
  const label = el('label', { className: 'guide-main', htmlFor: id }, [
    el('span', { className: `avatar ${avatarClass ?? ''}`, ariaHidden: 'true' }, [avatar]),
    el('span', { className: 'guide-text' }, [nameEl, el('small', {}, [note])]),
  ]);
  const listen = el('button', { type: 'button', className: 'listen', ariaLabel: `Listen to ${name}` }, [icon('play')]);
  listen.addEventListener('click', () => {
    radio.checked = true;
    previewVoice(card);
  });
  card.append(radio, label, listen, el('div', { className: 'progress', hidden: true }, [el('span')]), el('small', { className: 'guide-status' }));
  return card;
}

function populateGuides(selectedKey) {
  const lang = $('lang').value;
  const box = $('guides');
  box.replaceChildren();
  if (neuralVoicesSupported()) {
    for (const v of NEURAL_VOICES[lang] ?? []) {
      const documentary = v.profile === 'documentary';
      box.append(
        guideCard({
          value: neuralVoiceKey(v),
          name: v.label,
          note: v.note,
          avatar: v.label[0],
          avatarClass: documentary ? 'documentary' : '',
          badge: documentary ? 'Narrator' : null,
        }),
      );
    }
  }
  // The phone's own voices: one card, with a choice of voice when there are several.
  const systemCard = guideCard({ value: 'system:', name: "Your phone's voice", note: 'Instant, no download', avatar: icon('phone'), avatarClass: 'system' });
  const voices = rankSystemVoices(globalThis.speechSynthesis?.getVoices() ?? [], lang, speechLocale(lang)).slice(0, 8);
  if (voices.length > 1) {
    const select = el('select', { id: 'system-voice', ariaLabel: 'Phone voice' }, voices.map((v) => new Option(v.name, v.name)));
    select.addEventListener('change', () => {
      systemCard.querySelector('input').checked = true;
      refreshGuideStatus();
    });
    systemCard.append(select);
  } else if (voices.length === 1) {
    systemCard.append(el('input', { type: 'hidden', id: 'system-voice', value: voices[0].name }));
  }
  box.append(systemCard);

  const parsed = parseVoiceKey(selectedKey);
  const wanted = parsed?.kind === 'system' ? 'system:' : selectedKey;
  const radios = [...box.querySelectorAll('input[name=voice]')];
  (radios.find((r) => r.value === wanted) ?? radios[0]).checked = true;
  if (parsed?.kind === 'system' && parsed.name && $('system-voice')) $('system-voice').value = parsed.name;
  refreshGuideStatus();
}

/** "80 MB download, once" / "✓ On your phone, works offline" under each AI voice. */
async function refreshGuideStatus() {
  for (const card of $('guides').querySelectorAll('.guide')) {
    const key = parseVoiceKey(card.dataset.value);
    const status = card.querySelector('.guide-status');
    if (card.classList.contains('busy')) continue;
    if (key?.kind === 'neural') {
      const downloaded = await isVoiceDownloaded(key.id);
      status.textContent = downloaded ? '✓ On your phone, works offline' : 'Free · 80 MB download, once';
      status.classList.toggle('ready', downloaded);
    } else {
      status.textContent = '';
    }
  }
}

$('lang').addEventListener('change', () => populateGuides(null));
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => populateGuides(selectedVoiceKey()));

let previewNarrator = null;
async function previewVoice(card) {
  previewNarrator?.stop();
  for (const b of $('guides').querySelectorAll('.listen')) b.classList.remove('playing');
  const lang = $('lang').value;
  const key = parseVoiceKey(selectedVoiceKey());
  const narrator = new Narrator({ lang, rate: Number(readForm().rate), systemVoiceName: key?.kind === 'system' ? key.name : null });
  previewNarrator = narrator;
  narrator.unlock(); // inside the tap
  const listen = card.querySelector('.listen');
  const status = card.querySelector('.guide-status');
  const info = key?.kind === 'neural' ? neuralVoiceInfo(lang, key) : null;
  if (info) {
    const progress = card.querySelector('.progress');
    card.classList.add('busy');
    listen.disabled = true;
    try {
      await narrator.useNeuralVoice({ ...key, label: info.label, profile: info.profile, tweak: info.tweak }, (p) => {
        progress.hidden = p >= 1;
        progress.firstChild.style.width = `${Math.round(p * 100)}%`;
        status.textContent = p < 1 ? `Downloading… ${Math.round(p * 100)}%` : 'Getting ready…';
      });
    } catch {
      status.textContent = "Couldn't download this voice. Check your connection; your phone's voice will be used meanwhile.";
    } finally {
      progress.hidden = true;
      card.classList.remove('busy');
      listen.disabled = false;
      refreshGuideStatus();
    }
  }
  if (previewNarrator !== narrator) return;
  const text = info?.profile === 'documentary' ? PREVIEW_TEXT_DOCUMENTARY[lang] : PREVIEW_TEXT[lang];
  narrator.on('start', () => listen.classList.add('playing'));
  narrator.on('idle', () => listen.classList.remove('playing'));
  narrator.speak(text ?? PREVIEW_TEXT.en);
}

const saved = loadSaved();
if (saved) fillForm(saved);
populateGuides(saved?.voice ?? null);
syncFormHints();
renderPlan();
if (startPoint?.name) showLocateNote(`✓ You're in ${startPoint.name}.`);
window.addEventListener('load', () => showPlanMap());

// ---------- Map ----------

// Map labels as plain text (Leaflet would otherwise read a string as HTML).
function label(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

// ---------- The base map ----------
// Sharp vector maps (OpenFreeMap, built from OpenStreetMap data) drawn on the phone: crisp at
// any zoom and on any screen, with every pavement, crossing and building. Plain OpenStreetMap
// map images when the phone can't draw vector maps or the vector service doesn't answer.

const VECTOR_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/fiord',
};
const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const RASTER_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function canDrawVectorMaps() {
  if (!window.maplibregl || !window.L?.maplibreGL) return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function addRasterMap(target) {
  const box = target.getContainer();
  box.classList.remove('vector-map');
  box.classList.add('raster-map');
  return window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: RASTER_ATTRIBUTION }).addTo(target);
}

// Bus stops, shops and road numbers crowd out what a walker needs: streets and their names,
// water, parks, buildings, and the gold route on top. (Our own markers show the sights.)
const CLUTTER = /^(poi|highway-shield|road_shield|highway_ref|airport)/;
const styleCache = new Map();
function quietStyle(url) {
  if (!styleCache.has(url)) {
    styleCache.set(
      url,
      fetch(url)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((style) => ({ ...style, layers: style.layers.filter((layer) => !CLUTTER.test(layer.id)) }))
        .catch((err) => {
          styleCache.delete(url);
          throw err;
        }),
    );
  }
  return styleCache.get(url);
}

function addBaseMap(target) {
  if (!canDrawVectorMaps()) return addRasterMap(target);
  target.getContainer().classList.add('vector-map');
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  quietStyle(VECTOR_STYLES[dark ? 'dark' : 'light'])
    .then((style) => {
      const layer = window.L.maplibreGL({ style, attribution: VECTOR_ATTRIBUTION, maxZoom: 22 }).addTo(target);
      const gl = layer.getMaplibreMap?.();
      let loaded = false;
      gl?.on('load', () => (loaded = true));
      // The vector service didn't answer: switch to map images rather than show nothing.
      gl?.on('error', () => {
        if (loaded || !target.hasLayer(layer)) return;
        target.removeLayer(layer);
        addRasterMap(target);
      });
    })
    .catch(() => addRasterMap(target));
}

let map = null;
let layers = null;
let userMarker = null;
let accuracyCircle = null;
let follow = true;
const poiMarkers = new Map();
const stopMarkers = new Map();

function initMap() {
  const L = window.L;
  if (!L) {
    $('map').hidden = true; // map library didn't load (offline?): the tour still works
    return;
  }
  if (!map) {
    const centre = startPoint ? [[startPoint.lat, startPoint.lon], 14] : [[20, 0], 2];
    map = L.map('map', { zoomControl: false, zoomSnap: 0.25, maxZoom: 20 }).setView(...centre);
    addBaseMap(map);
    // You are always drawn on top, even standing on a stop's pin.
    map.createPane('you').style.zIndex = 650;
    layers = {
      route: L.layerGroup().addTo(map),
      nav: L.layerGroup().addTo(map),
      pois: L.layerGroup().addTo(map),
      stops: L.layerGroup().addTo(map),
      user: L.layerGroup().addTo(map),
    };
    map.on('dragstart', () => {
      follow = false;
      $('recenter').hidden = false;
    });
  }
  Object.values(layers).forEach((layer) => layer.clearLayers());
  navRouteDrawn = null;
  navFittedTarget = null;
  poiMarkers.clear();
  stopMarkers.clear();
  userMarker = null;
  accuracyCircle = null;
  follow = true;
  $('recenter').hidden = true;
  setTimeout(() => map.invalidateSize(), 0);
}

$('recenter').addEventListener('click', () => {
  follow = true;
  $('recenter').hidden = true;
  if (userMarker) map.panTo(userMarker.getLatLng());
});

function drawStops(stops) {
  if (!map) return;
  for (const [i, stop] of stops.entries()) {
    const icon = window.L.divIcon({ className: 'stop-pin', html: `<span>${i + 1}</span>`, iconSize: [30, 30] });
    const marker = window.L.marker([stop.lat, stop.lon], { icon, title: stop.name }).addTo(layers.stops);
    marker.bindTooltip(label(stop.name));
    stopMarkers.set(i, marker);
  }
}

function fitTo(points) {
  if (!map || !points.length) return;
  if (points.length === 1) map.setView([points[0].lat, points[0].lon], 15);
  else map.fitBounds(points.map((p) => [p.lat, p.lon]), { padding: [30, 30] });
}

// The way to the next stop: a bold gold line; the rest of the tour route fades back.
let navRouteDrawn = null;
let navFittedTarget = null;

/** Zoom to the way ahead (clear of the directions card), once per stop. */
function fitNavRoute(route, target) {
  if (!map || !follow || navFittedTarget === target) return;
  navFittedTarget = target;
  const card = $('next-stop');
  const top = (card.hidden ? 0 : card.offsetHeight + 12) + 16;
  // Street level: you and the next few hundred meters (the map then follows you along).
  const near = route.points.filter((p, i) => route.cumulative[i] <= 350);
  const points = near.length >= 2 ? near : route.points;
  map.fitBounds(points.map((p) => [p.lat, p.lon]), { paddingTopLeft: [24, top], paddingBottomRight: [24, 36], maxZoom: 17.5 });
}
function drawNavRoute(route) {
  if (!map || route === navRouteDrawn) return;
  navRouteDrawn = route;
  layers.nav.clearLayers();
  layers.route.eachLayer((l) => l.setStyle?.({ opacity: route ? 0.35 : 0.9 }));
  if (!route) return;
  window.L.polyline(route.points.map((p) => [p.lat, p.lon]), { color: '#c9a55c', weight: 7, opacity: 1, className: 'nav-line', lineCap: 'round' }).addTo(layers.nav);
  window.L.polyline(route.points.map((p) => [p.lat, p.lon]), { color: '#fffdf8', weight: 2, opacity: 0.9, dashArray: '1 9', lineCap: 'round' }).addTo(layers.nav);
}

const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;

function showDirections(state, modeId) {
  const card = $('next-stop');
  if (!state.target) {
    card.hidden = true;
    drawNavRoute(null);
    return;
  }
  card.hidden = false;
  $('nav-icon').setAttribute('href', `#i-${state.icon ?? 'navigation'}`);
  $('nav-sentence').textContent = state.sentence ?? (state.offRoute ? 'Finding a new way…' : 'Finding the way…');
  const parts = [state.target.name];
  if (state.remaining != null) parts.push(formatMeters(state.remaining));
  if (state.minutes != null) parts.push(`${state.minutes} min`);
  $('nav-target').textContent = parts.join(' · ');
  $('nav-open').href = mapsLink(state.target, modeId, { apple: isApple });
  drawNavRoute(state.route);
  if (state.route) fitNavRoute(state.route, state.target);
}

function drawRoute(points, { routed = true } = {}) {
  if (!map) return;
  // A real route follows the streets. Without one, a faint dotted line just joins the stops,
  // so it never looks like a path through buildings.
  window.L.polyline(
    points.map((p) => [p.lat, p.lon]),
    routed ? { color: '#c9a55c', weight: 4, opacity: 0.9 } : { color: '#c9a55c', weight: 2, opacity: 0.7, dashArray: '2 8' },
  ).addTo(layers.route);
}

function drawPois(pois) {
  if (!map) return;
  for (const poi of pois) {
    if (poi.category === 'skip' || poiMarkers.has(poi.id)) continue;
    const marker = window.L.circleMarker([poi.lat, poi.lon], {
      radius: poi.category === 'minor' ? 4 : 6,
      color: '#9c7a3c',
      weight: 2,
      fillColor: '#e9d29a',
      fillOpacity: 0.8,
    }).addTo(layers.pois);
    marker.bindTooltip(label(poi.title));
    poiMarkers.set(poi.id, marker);
  }
}

function markPoiHeard(id) {
  poiMarkers.get(id)?.setStyle({ color: '#8a8578', fillColor: '#bdb6a6', fillOpacity: 0.5 });
}

function moveUser({ lat, lon, accuracy }) {
  if (!map) return;
  const L = window.L;
  if (!userMarker) {
    accuracyCircle = L.circle([lat, lon], { radius: accuracy ?? 0, stroke: false, fillColor: '#c9a55c', fillOpacity: 0.12 }).addTo(layers.user);
    userMarker = L.circleMarker([lat, lon], { pane: 'you', radius: 8, color: '#c9a55c', weight: 4, fillColor: '#fffdf8', fillOpacity: 1 }).addTo(layers.user);
  } else {
    userMarker.setLatLng([lat, lon]);
    accuracyCircle.setLatLng([lat, lon]).setRadius(accuracy ?? 0);
  }
  if (follow) map.panTo([lat, lon], { animate: true, duration: 0.5 });
}

// ---------- Tour screen ----------

let session = null; // everything belonging to the running tour

function setStatus(text, tone = '') {
  const el = $('status');
  el.textContent = text;
  el.dataset.tone = tone;
}

function formatMeters(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

function showNowPlaying(item, voiceName) {
  const { meta, text } = item;
  const who = voiceName ?? 'Roamie';
  $('now').hidden = false;
  $('now').classList.remove('idle');
  $('now-avatar').textContent = who[0];
  $('now-label').textContent = meta.kind === 'stop' ? 'You have arrived' : meta.kind === 'poi' ? `${who} · now narrating` : `${who} · your guide`;
  $('now-title').textContent = meta.title ?? '';
  const body = $('now-text');
  body.textContent = text;
  body.classList.add('clamp');
  requestAnimationFrame(() => ($('now-more').hidden = body.scrollHeight <= body.clientHeight + 2));
  $('now-more').textContent = 'Show more';
  const img = $('now-img');
  img.onerror = () => (img.hidden = true);
  if (meta.thumbnail) {
    img.src = meta.thumbnail;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }
}

function addToJournal(meta) {
  if (!['poi', 'stop', 'city'].includes(meta.kind) || !meta.title) return;
  const li = document.createElement('li');
  li.className = `journal-${meta.kind}`;
  if (meta.thumbnail) {
    const img = document.createElement('img');
    img.src = meta.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => img.remove();
    li.append(img);
  }
  const body = document.createElement('div');
  const title = document.createElement(meta.url ? 'a' : 'span');
  title.textContent = meta.title;
  if (meta.url) {
    title.href = meta.url;
    title.target = '_blank';
    title.rel = 'noopener';
  }
  const when = document.createElement('small');
  const label = meta.kind === 'stop' ? 'Your stop' : meta.kind === 'city' ? 'City' : 'Passed by';
  when.textContent = `${label} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  body.append(title, when);
  li.append(body);
  $('journal').prepend(li);
  $('journal-count').textContent = String($('journal').children.length);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && session) session.wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // not supported or refused: the tour still works while the screen is on
  }
}
document.addEventListener('visibilitychange', () => {
  // The browser drops the wake lock when the page is hidden; take it back when we return.
  if (document.visibilityState === 'visible' && session && (!session.wakeLock || session.wakeLock.released)) {
    requestWakeLock();
  }
});

$('now-more').addEventListener('click', () => {
  const clamped = $('now-text').classList.toggle('clamp');
  $('now-more').textContent = clamped ? 'Show more' : 'Show less';
});

function endTour() {
  if (!session) return;
  session.ended = true;
  session.source?.stop();
  session.engine?.stop();
  session.navigator?.stop();
  session.narrator.stop();
  session.wakeLock?.release?.().catch(() => {});
  session = null;
  $('tour').hidden = true;
  $('btn-end').hidden = true;
  $('setup').hidden = false;
  window.scrollTo(0, 0);
}

$('btn-end').addEventListener('click', endTour);
$('btn-skip').addEventListener('click', () => session?.narrator.skip());
$('btn-repeat').addEventListener('click', () => session?.narrator.repeat());
$('btn-pause').addEventListener('click', () => {
  if (!session) return;
  if (session.narrator.paused) session.narrator.resume();
  else session.narrator.pause();
});

function setPauseButton(paused) {
  const button = $('btn-pause');
  button.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  button.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  $('now').classList.toggle('paused', paused);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const cfg = readForm();
  // Each line: a stop we imported with coordinates, typed coordinates, or a name to look up.
  const stopEntries = parseTextList(cfg.stops).stops.map((s) => {
    const line = s.name ?? `${s.lat}, ${s.lon}`;
    const known = imported.get(line) ?? imported.get(s.query);
    if (known) return { name: line, ...known };
    return { name: line, query: s.query ?? line, lat: s.lat, lon: s.lon, coordsOnly: !s.name };
  });
  const stopNames = stopEntries.map((s) => s.name);
  const error = $('setup-error');
  error.textContent = '';

  // A suggested route starts where you are, so one stop is enough to simulate it.
  const minStops = plan?.start ? 1 : 2;
  if (cfg.source === 'sim' && stopNames.length < minStops) {
    error.textContent = 'To simulate a trip, add at least two stops to your itinerary.';
    return;
  }
  if (cfg.source === 'gps' && !('geolocation' in navigator)) {
    error.textContent = "This browser can't share your location. Try the simulation instead.";
    return;
  }
  save(cfg);

  const mode = getMode(cfg.mode);
  const voiceKey = parseVoiceKey(cfg.voice);
  const voiceInfo = voiceKey?.kind === 'neural' ? neuralVoiceInfo(cfg.lang, voiceKey) : null;
  // Narrator voices phrase the tour like a nature documentary.
  const style = voiceProfile(voiceInfo?.profile).style;
  previewNarrator?.stop();
  const narrator = new Narrator({
    lang: cfg.lang,
    rate: Number(cfg.rate),
    systemVoiceName: voiceKey?.kind === 'system' ? voiceKey.name : null,
  });
  narrator.unlock(); // must happen inside the tap, before any await
  const current = (session = { narrator, ended: false });
  const alive = () => session === current && !current.ended;

  // The soothing AI voice: ready in a few seconds if already downloaded; otherwise it
  // downloads in the background while the phone's voice starts the tour.
  let voiceReady = Promise.resolve(false);
  const voiceLine = $('voice-line');
  voiceLine.hidden = true;
  if (voiceKey?.kind === 'neural') {
    voiceReady = narrator
      .useNeuralVoice({ ...voiceKey, label: voiceInfo?.label, profile: voiceInfo?.profile, tweak: voiceInfo?.tweak }, (p) => {
        if (!alive() || p >= 1) return;
        voiceLine.hidden = false;
        voiceLine.textContent = `Downloading the soothing voice… ${Math.round(p * 100)}% (your phone's voice speaks meanwhile)`;
      })
      .then(
        (ok) => {
          if (alive() && ok) voiceLine.hidden = true;
          return ok;
        },
        () => {
          if (!alive()) return false;
          voiceLine.hidden = false;
          voiceLine.textContent = "Couldn't load the soothing voice, so your phone's voice is reading the tour.";
          return false;
        },
      );
  }
  narrator.on('voice', ({ kind, error }) => {
    if (alive() && kind === 'system' && error) {
      voiceLine.hidden = false;
      voiceLine.textContent = "The soothing voice stopped working, so your phone's voice took over.";
    }
  });

  $('setup').hidden = true;
  $('btn-end').hidden = false;
  window.scrollTo(0, 0);
  $('tour').hidden = false;
  $('now').hidden = true;
  $('next-stop').hidden = true;
  $('journal').replaceChildren();
  $('journal-count').textContent = '0';
  setPauseButton(false);
  initMap();
  requestWakeLock();

  narrator.on('start', (item) => {
    if (item.meta?.interjection) {
      // A spoken direction: highlight the direction card, leave the story card alone.
      const card = $('next-stop');
      card.dataset.spoken = item.text;
      card.classList.add('speaking');
      setTimeout(() => card.classList.remove('speaking'), 2500);
      return;
    }
    const neural = narrator.backend.kind === 'neural';
    showNowPlaying(item, neural ? narrator.voiceLabel?.replace(/\s*\(.*\)$/, '') : null);
    if (!item.repeated && !item.resumed) addToJournal(item.meta);
  });
  narrator.on('idle', () => {
    $('now').classList.add('idle');
    $('now-label').textContent = 'Listening for what comes next…';
  });
  narrator.on('state', ({ paused }) => setPauseButton(paused));

  try {
    const geocoder = createGeocoder({ lang: cfg.lang });
    let city = null;
    if (cfg.city) {
      setStatus(`Finding ${cfg.city}…`);
      city = await geocoder.findCity(cfg.city);
      if (!alive()) return;
      if (city) fitTo([city]);
    }

    const stops = [];
    const missing = [];
    for (const [i, entry] of stopEntries.entries()) {
      setStatus(`Finding stop ${i + 1} of ${stopEntries.length}: ${entry.name}…`);
      let place;
      if (entry.kind === 'food') {
        // A café or restaurant from the suggestion: we already know exactly where it is.
        place = { ...entry, osmName: entry.name, isArea: false, bbox: null };
      } else if (entry.coordsOnly) {
        // Typed coordinates: name the stop after what's there.
        place = await geocoder.reverse(entry).catch(() => ({ ...entry }));
      } else if (entry.lat != null) {
        // From a map link or typed coordinates: we know where it is; learn the rest.
        place = await geocoder.findPlaceNear(entry.query ?? entry.name, entry, entry.name).catch(() => ({ ...entry }));
      } else {
        place = await geocoder.findPlace(entry.query ?? entry.name, city, entry.name).catch(() => null);
      }
      if (!alive()) return;
      if (place) {
        // Keep what the suggestion knows: museum visits, meal breaks, article links.
        const { kind, visitMinutes, meal, breakMinutes, wikipedia, wikidata } = entry;
        stops.push({ ...place, kind, visitMinutes, meal, breakMinutes, wikipedia: place.wikipedia ?? wikipedia, wikidata: place.wikidata ?? wikidata });
      } else missing.push(entry.name);
    }
    drawStops(stops);
    if (stops.length) fitTo(stops);

    if (!city && stops.length) {
      // No city given (e.g. only a pasted link): work it out from the first stop.
      setStatus('Finding which city you are in…');
      city = await geocoder.reverse(stops[0], 10).catch(() => null);
      if (!alive()) return;
    }

    if (cfg.source === 'sim' && stops.length < minStops) {
      setStatus("I couldn't find enough of your stops on the map to simulate a trip. Check the spelling?", 'error');
      return;
    }

    const wiki = createWikiService({ lang: cfg.lang });
    const engine = new TourEngine({
      mode,
      lang: cfg.lang,
      style,
      wiki,
      narrator,
      city,
      stops,
      onEvent: (type, data) => {
        if (!alive()) return;
        if (type === 'position') moveUser(current.navigator?.snap(data) ?? data);
        else if (type === 'pois') drawPois(data.added);
        else if (type === 'narrated') markPoiHeard(data.poi.id);
        else if (type === 'stop-reached') {
          stopMarkers.get(data.stop.index)?.getElement()?.classList.add('reached');
          if (data.stop.index === stops.length - 1) {
            // Last stop: guide back to the start of a round trip, or stop guiding.
            const home = plan?.loop && plan.start ? { name: 'your starting point', lat: plan.start.lat, lon: plan.start.lon } : null;
            current.navigator?.setTarget(home);
          }
        }
        else if (type === 'next-stop') current.navigator?.setTarget(data.stop);
        else if (type === 'error') setStatus(data.message, 'warn');
      },
    });
    current.engine = engine;
    // Directions to the next stop: on the map, on screen, and spoken before each turn.
    current.navigator = new Navigator({
      lang: cfg.lang,
      modeId: mode.id,
      getDirections: (from, to) => fetchDirections(from, to, mode.routeProfile),
      streetName: (point) => fetchStreetName(point),
      narrator,
      onUpdate: (state) => {
        if (!alive()) return;
        if (state.route?.targetSnap != null && state.target?.index != null) engine.approachLimit(state.target.index, state.route.targetSnap);
        // The simulated traveller follows the directions, as you would.
        if (state.route && state.route !== current.followed && current.source?.follow) {
          current.followed = state.route;
          current.source.follow(state.route.points);
        }
        showDirections(state, mode.id);
      },
    });

    // If the soothing voice is already on this phone, wait (briefly) so it reads the welcome.
    if (voiceKey?.kind === 'neural' && (await isVoiceDownloaded(voiceKey.id))) {
      setStatus('Warming up the voice…');
      await Promise.race([voiceReady, new Promise((r) => setTimeout(r, 15000))]);
      if (!alive()) return;
    }

    const onPosition = (pos) => {
      if (!alive()) return;
      current.navigator.update(pos); // first, so your dot can be drawn on the route
      engine.update(pos);
    };
    const missingNote = missing.length ? ` (couldn't find: ${missing.join(', ')})` : '';
    const voiceNote =
      narrator.hasVoice || voiceKey?.kind === 'neural' ? '' : ' No voice found on this device, so showing the text only.';

    if (cfg.source === 'sim') {
      setStatus('Planning the route…');
      // A suggested route starts (and maybe ends) where you are.
      const fromPlan = plan?.start && plan.items.length === stops.length;
      const waypoints = fromPlan ? [plan.start, ...stops, ...(plan.loop ? [plan.start] : [])] : stops;
      const route = await fetchRoute(waypoints, mode.routeProfile);
      if (!alive()) return;
      drawRoute(route.points, { routed: route.routed });
      stops.forEach((stop, i) => engine.approachLimit(i, route.snaps?.[i + (fromPlan ? 1 : 0)]));
      current.source = new SimulatedSource({
        points: route.points,
        speedMps: mode.speedMps,
        multiplier: Number(cfg.simSpeed),
        onPosition,
        onEnd: () => alive() && setStatus('You reached the end of the simulated trip.'),
      });
      const routeNote = route.routed ? '' : " The route service didn't answer, so the dotted line only joins the stops directly.";
      setStatus(`Simulating your ${mode.label.toLowerCase()} at ${cfg.simSpeed}× speed${missingNote}.${routeNote}${voiceNote}`, route.routed ? undefined : 'warn');
    } else {
      current.source = new GpsSource({
        onPosition: (pos) => {
          if (!current.gotFix) {
            current.gotFix = true;
            setStatus(`Tour running. Put the phone in your pocket or on the dashboard${missingNote}.${voiceNote}`);
            if (city && distanceMeters(city, pos) > 50000) {
              setStatus(`You seem to be far from ${city.name}. I'll describe what's around you anyway.`, 'warn');
            }
          }
          onPosition(pos);
        },
        onError: (err) => {
          if (!alive()) return;
          const denied = err?.code === 1;
          setStatus(
            denied
              ? 'Location permission was denied. Allow location for this site, or try the simulation.'
              : `Waiting for GPS… (${err?.message ?? 'no signal'})`,
            denied ? 'error' : 'warn',
          );
        },
      });
      setStatus('Waiting for your GPS position…');
    }

    const started = engine.start(); // sets the engine running before the first position arrives
    current.source.start();
    await started;
  } catch (err) {
    if (alive()) setStatus(`Something went wrong: ${err.message}`, 'error');
    console.error(err);
  }
});

// ---------- Offline support ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
