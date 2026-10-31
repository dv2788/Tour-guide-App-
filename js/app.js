// Screen wiring: the setup form, the map, the "now playing" card and the controls.

import { getMode, MODES } from './modes.js';
import { LANGUAGES, speechLocale } from './i18n.js';
import { createWikiService } from './wiki.js';
import { createGeocoder, fetchRoute } from './geocode.js';
import { Narrator } from './narrator.js';
import { GpsSource, SimulatedSource } from './location.js';
import { TourEngine } from './tourEngine.js';
import { distanceMeters } from './geo.js';
import { parseItinerary, parseTextList, SOURCE_LABELS } from './itineraryImport.js';
import { NEURAL_VOICES, neuralVoiceKey, parseVoiceKey, rankSystemVoices, PREVIEW_TEXT } from './voices.js';
import { isVoiceDownloaded, neuralVoicesSupported } from './neuralVoice.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'tour-guide:setup';
const SAMPLE = {
  city: 'Paris',
  stops: ['Eiffel Tower', "Pont de l'Alma", 'Grand Palais', 'Place de la Concorde', 'Louvre Museum'].join('\n'),
  mode: 'walk',
  source: 'sim',
  simSpeed: '8',
};

// ---------- Setup form ----------

const form = $('setup-form');

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
    voice: data.get('voice') ?? '',
    imported: [...imported.entries()],
  };
}

function fillForm(values) {
  if (Array.isArray(values.imported)) imported = new Map(values.imported);
  for (const [key, value] of Object.entries(values)) {
    if (key === 'imported' || key === 'voice') continue;
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
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
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
$('demo').addEventListener('click', () => {
  imported = new Map();
  fillForm({ ...SAMPLE, lang: $('lang').value });
  showImportNote('');
  $('setup-error').textContent = '';
});

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

// ---------- Voice ----------

function neuralVoiceInfo(lang, key) {
  return (NEURAL_VOICES[lang] ?? []).find((v) => v.id === key.id && (v.speaker ?? 0) === key.speaker);
}

function populateVoices(selectedKey) {
  const lang = $('lang').value;
  const select = $('voice');
  select.replaceChildren();
  if (neuralVoicesSupported()) {
    const group = document.createElement('optgroup');
    group.label = 'Soothing AI voices · free, downloads once';
    for (const v of NEURAL_VOICES[lang] ?? []) group.append(new Option(`${v.label} · ${v.note}`, neuralVoiceKey(v)));
    select.append(group);
  }
  const group = document.createElement('optgroup');
  group.label = "This phone's voices · instant";
  const system = rankSystemVoices(globalThis.speechSynthesis?.getVoices() ?? [], lang, speechLocale(lang)).slice(0, 8);
  if (system.length) for (const v of system) group.append(new Option(v.name, `system:${v.name}`));
  else group.append(new Option("This phone's built-in voice", 'system:'));
  select.append(group);
  const keys = [...select.options].map((o) => o.value);
  select.value = keys.includes(selectedKey) ? selectedKey : keys[0];
  updateVoiceStatus();
}

let voiceStatusRun = 0;
async function updateVoiceStatus(text) {
  const run = ++voiceStatusRun;
  const status = $('voice-status');
  if (text) {
    status.textContent = text;
    return;
  }
  const key = parseVoiceKey($('voice').value);
  if (key?.kind === 'neural') {
    const downloaded = await isVoiceDownloaded(key.id);
    if (run !== voiceStatusRun) return;
    status.textContent = downloaded
      ? '✓ Downloaded. Works offline.'
      : 'A natural, calm voice that runs on your phone. Downloads once (about 80 MB), so Wi-Fi is best.';
  } else {
    status.textContent = "Uses your phone's own voice. Starts instantly.";
  }
}

$('lang').addEventListener('change', () => populateVoices(null));
$('voice').addEventListener('change', () => updateVoiceStatus());
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => populateVoices($('voice').value));

let previewNarrator = null;
$('voice-preview').addEventListener('click', async () => {
  previewNarrator?.stop();
  const lang = $('lang').value;
  const key = parseVoiceKey($('voice').value);
  const narrator = new Narrator({
    lang,
    rate: Number($('rate').value),
    systemVoiceName: key?.kind === 'system' ? key.name : null,
  });
  previewNarrator = narrator;
  narrator.unlock(); // inside the tap
  if (key?.kind === 'neural') {
    const button = $('voice-preview');
    button.disabled = true;
    try {
      const loading = narrator.useNeuralVoice({ ...key, label: neuralVoiceInfo(lang, key)?.label }, (p) =>
        updateVoiceStatus(p < 1 ? `Downloading the voice… ${Math.round(p * 100)}%` : 'Getting the voice ready…'),
      );
      await loading;
      updateVoiceStatus();
    } catch {
      updateVoiceStatus("Couldn't download the voice (check your connection). You'll hear your phone's voice instead.");
    } finally {
      button.disabled = false;
    }
  }
  if (previewNarrator === narrator) narrator.speak(PREVIEW_TEXT[lang] ?? PREVIEW_TEXT.en);
});

const saved = loadSaved();
if (saved) fillForm(saved);
populateVoices(saved?.voice ?? null);
syncFormHints();

// ---------- Map ----------

// Map labels as plain text (Leaflet would otherwise read a string as HTML).
function label(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
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
    map = L.map('map', { zoomControl: false }).setView([48.8566, 2.3522], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layers = {
      route: L.layerGroup().addTo(map),
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

function drawRoute(points) {
  if (!map) return;
  window.L.polyline(
    points.map((p) => [p.lat, p.lon]),
    { color: '#0f766e', weight: 5, opacity: 0.6 },
  ).addTo(layers.route);
}

function drawPois(pois) {
  if (!map) return;
  for (const poi of pois) {
    if (poi.category === 'skip' || poiMarkers.has(poi.id)) continue;
    const marker = window.L.circleMarker([poi.lat, poi.lon], {
      radius: poi.category === 'minor' ? 4 : 6,
      color: '#b45309',
      weight: 2,
      fillColor: '#f59e0b',
      fillOpacity: 0.8,
    }).addTo(layers.pois);
    marker.bindTooltip(label(poi.title));
    poiMarkers.set(poi.id, marker);
  }
}

function markPoiHeard(id) {
  poiMarkers.get(id)?.setStyle({ color: '#64748b', fillColor: '#94a3b8', fillOpacity: 0.6 });
}

function moveUser({ lat, lon, accuracy }) {
  if (!map) return;
  const L = window.L;
  if (!userMarker) {
    accuracyCircle = L.circle([lat, lon], { radius: accuracy ?? 0, stroke: false, fillColor: '#2563eb', fillOpacity: 0.12 }).addTo(layers.user);
    userMarker = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(layers.user);
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

function showNowPlaying(item) {
  const { meta, text } = item;
  $('now').hidden = false;
  $('now').classList.remove('idle');
  $('now-label').textContent =
    meta.kind === 'stop' ? 'You have arrived' : meta.kind === 'poi' ? 'Now telling you about' : 'Your guide';
  $('now-title').textContent = meta.title ?? '';
  $('now-text').textContent = text;
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

function endTour() {
  if (!session) return;
  session.ended = true;
  session.source?.stop();
  session.engine?.stop();
  session.narrator.stop();
  session.wakeLock?.release?.().catch(() => {});
  session = null;
  $('tour').hidden = true;
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
  $('btn-pause').innerHTML = paused ? '▶<span>Resume</span>' : '⏸<span>Pause</span>';
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

  if (cfg.source === 'sim' && stopNames.length < 2) {
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
    const info = neuralVoiceInfo(cfg.lang, voiceKey);
    voiceReady = narrator
      .useNeuralVoice({ ...voiceKey, label: info?.label }, (p) => {
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
  $('tour').hidden = false;
  $('now').hidden = true;
  $('next-stop').hidden = true;
  $('journal').replaceChildren();
  $('journal-count').textContent = '0';
  setPauseButton(false);
  initMap();
  requestWakeLock();

  narrator.on('start', (item) => {
    showNowPlaying(item);
    if (!item.repeated) addToJournal(item.meta);
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
      if (entry.coordsOnly) {
        // Typed coordinates: name the stop after what's there.
        place = await geocoder.reverse(entry).catch(() => ({ ...entry }));
      } else if (entry.lat != null) {
        // From a map link or typed coordinates: we know where it is; learn the rest.
        place = await geocoder.findPlaceNear(entry.query ?? entry.name, entry, entry.name).catch(() => ({ ...entry }));
      } else {
        place = await geocoder.findPlace(entry.query ?? entry.name, city, entry.name).catch(() => null);
      }
      if (!alive()) return;
      if (place) stops.push(place);
      else missing.push(entry.name);
    }
    drawStops(stops);
    if (stops.length) fitTo(stops);

    if (!city && stops.length) {
      // No city given (e.g. only a pasted link): work it out from the first stop.
      setStatus('Finding which city you are in…');
      city = await geocoder.reverse(stops[0], 10).catch(() => null);
      if (!alive()) return;
    }

    if (cfg.source === 'sim' && stops.length < 2) {
      setStatus("I couldn't find enough of your stops on the map to simulate a trip. Check the spelling?", 'error');
      return;
    }

    const wiki = createWikiService({ lang: cfg.lang });
    const engine = new TourEngine({
      mode,
      lang: cfg.lang,
      wiki,
      narrator,
      city,
      stops,
      onEvent: (type, data) => {
        if (!alive()) return;
        if (type === 'position') moveUser(data);
        else if (type === 'pois') drawPois(data.added);
        else if (type === 'narrated') markPoiHeard(data.poi.id);
        else if (type === 'stop-reached') stopMarkers.get(data.stop.index)?.getElement()?.classList.add('reached');
        else if (type === 'next-stop') {
          $('next-stop').hidden = false;
          $('next-stop').textContent = `Next stop: ${data.stop.name} · ${formatMeters(data.distance)}`;
        } else if (type === 'error') setStatus(data.message, 'warn');
      },
    });
    current.engine = engine;

    // If the soothing voice is already on this phone, wait (briefly) so it reads the welcome.
    if (voiceKey?.kind === 'neural' && (await isVoiceDownloaded(voiceKey.id))) {
      setStatus('Warming up the voice…');
      await Promise.race([voiceReady, new Promise((r) => setTimeout(r, 15000))]);
      if (!alive()) return;
    }

    const onPosition = (pos) => alive() && engine.update(pos);
    const missingNote = missing.length ? ` (couldn't find: ${missing.join(', ')})` : '';
    const voiceNote =
      narrator.hasVoice || voiceKey?.kind === 'neural' ? '' : ' No voice found on this device, so showing the text only.';

    if (cfg.source === 'sim') {
      setStatus('Planning the route…');
      const route = await fetchRoute(stops, mode.routeProfile);
      if (!alive()) return;
      drawRoute(route.points);
      current.source = new SimulatedSource({
        points: route.points,
        speedMps: mode.speedMps,
        multiplier: Number(cfg.simSpeed),
        onPosition,
        onEnd: () => alive() && setStatus('You reached the end of the simulated trip.'),
      });
      setStatus(`Simulating your ${mode.label.toLowerCase()} at ${cfg.simSpeed}× speed${missingNote}.${voiceNote}`);
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
