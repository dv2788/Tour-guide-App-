// The Street View page (streetview.html): Google's photos of the street you're on, shown inside
// the app's first-person view. The app drives it with messages (js/photoView.js): where you
// are and which way the street goes, the stops and the places the guide mentions. It answers
// whether Google has a photo here; where it hasn't, the app shows the 3D map instead.
// It only runs inside the app, from the app's own address, and only with a key set
// (js/streetview-config.js). One viewer per visit: that's what Google counts.

import { STREET_VIEW_CONFIG as CONFIG } from './streetview-config.js';
import { parseCommand, needsLookup } from './photoView.js';
import { signpost } from './streetView.js';

const $ = (id) => document.getElementById(id);
const note = (text) => {
  $('note').textContent = text;
  $('note').hidden = !text;
};
const app = (() => {
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
})();
const inApp = window.parent !== window && app === location.origin;
const report = (message) => window.parent.postMessage(message, location.origin);

/** Google's script, loaded once; resolves when its objects exist. */
function loadGoogle(key) {
  return new Promise((resolve, reject) => {
    window.roamieStreetViewReady = () => resolve(window.google?.maps);
    // Google calls this when the key is refused (wrong key, or another site's address).
    window.gm_authFailure = () => reject(new Error('key refused'));
    const script = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: 'roamieStreetViewReady' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => reject(new Error('script failed'));
    document.head.append(script);
    setTimeout(() => reject(new Error('timeout')), 20000);
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text; // names from Wikipedia: always text, never markup
  return node;
}

async function start() {
  let g;
  try {
    g = await loadGoogle(CONFIG.apiKey);
    if (!g?.StreetViewPanorama) throw new Error('no street view');
  } catch (err) {
    report({ type: 'failed', reason: err.message });
    return;
  }
  const service = new g.StreetViewService();
  // The frame is sized by the app (and can be resized with it): tell the viewer.
  new ResizeObserver(() => g.event?.trigger(panorama, 'resize')).observe($('pano'));
  const panorama = new g.StreetViewPanorama($('pano'), {
    // Just the photo: no arrows, no address, no controls; you can still look around by hand.
    disableDefaultUI: true,
    linksControl: false,
    clickToGo: false,
    showRoadLabels: false,
    motionTracking: false,
    motionTrackingControl: false,
    scrollwheel: false,
    pov: { heading: 0, pitch: 0 },
    visible: true,
  });

  // A signpost standing where its place is, drawn by Google's projection of that spot.
  class Sign extends g.OverlayView {
    constructor(place, root, inner, kind, max) {
      super();
      this.place = place;
      this.root = root;
      this.inner = inner;
      this.kind = kind;
      this.max = max;
      this.latLng = new g.LatLng(place.lat, place.lon);
    }
    onAdd() {
      this.getPanes().overlayMouseTarget.appendChild(this.root);
    }
    draw() {
      const point = this.getProjection()?.fromLatLngToDivPixel(this.latLng);
      const eye = state.pos;
      if (!point || !eye) {
        this.root.hidden = true;
        return;
      }
      const { visible, scale } = signpost(eye, panorama.getPov().heading, this.place, this.max);
      this.root.hidden = !visible;
      if (!visible) return;
      this.root.style.left = `${point.x}px`;
      this.root.style.top = `${point.y}px`;
      this.inner.style.transform = `scale(${scale.toFixed(2)})`;
    }
    onRemove() {
      this.root.remove();
    }
  }

  const state = { pos: null, heading: null, last: null, panoId: null, inFlight: false, again: false, lastDragAt: 0, signs: 700 };
  let signs = []; // Sign overlays
  let placeIds = new Set();

  // Looking around by hand (a finger on the photo, a key): the view is yours for a while.
  // (Not the viewer's own events: it reports our turns and its transitions as view changes too.)
  for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
    $('pano').addEventListener(type, () => (state.lastDragAt = Date.now()), { capture: true, passive: true });
  }
  panorama.addListener('status_changed', () => {
    if (panorama.getStatus() !== 'OK') covered(false);
  });

  let coveredHere = null;
  const covered = (here) => {
    if (coveredHere === here) return;
    coveredHere = here;
    report({ type: 'coverage', here });
  };

  /** Face the way the street goes, unless you're looking around yourself just now. */
  const turnWithStreet = () => {
    if (state.heading == null || Date.now() - state.lastDragAt < CONFIG.freeLookSeconds * 1000) return;
    panorama.setPov({ heading: state.heading, pitch: 0 });
  };

  const redraw = () => {
    for (const sign of signs) sign.draw();
  };

  /** The nearest photo to where you are now (asking isn't billed; only the viewer is). */
  const lookup = async () => {
    if (state.inFlight) {
      state.again = true;
      return;
    }
    state.inFlight = true;
    state.again = false;
    const at = state.pos;
    state.last = at;
    try {
      const { data } = await service.getPanorama({ location: { lat: at.lat, lng: at.lon }, radius: CONFIG.radius, source: 'outdoor', preference: 'nearest' });
      const id = data?.location?.pano;
      if (!id) throw new Error('no photo');
      if (id !== state.panoId) {
        state.panoId = id;
        panorama.setPano(id);
      }
      turnWithStreet();
      covered(true);
    } catch {
      covered(false); // no photo within reach (or Google didn't answer): the 3D map takes over
    } finally {
      state.inFlight = false;
      redraw();
      if (state.again) lookup();
    }
  };

  const commands = {
    config: ({ signs: max }) => {
      state.signs = max;
    },
    move: ({ lat, lon, heading }) => {
      state.pos = { lat, lon };
      if (heading != null) state.heading = heading;
      if (needsLookup(state.last, state.pos, CONFIG.stepMeters)) lookup();
      else {
        turnWithStreet();
        redraw();
      }
    },
    stops: ({ stops }) => {
      for (const sign of signs.filter((s) => s.kind === 'stop')) sign.setMap(null);
      signs = signs.filter((s) => s.kind !== 'stop');
      stops.forEach((stop, i) => {
        const root = el('div', 'fp-sign fp-anchor fp-stop');
        const inner = el('div', 'fp-sign-inner');
        inner.append(el('span', 'fp-num', String(i + 1)), el('span', 'fp-name', stop.name));
        root.append(inner, el('span', 'fp-pole'));
        root.hidden = true;
        const sign = new Sign(stop, root, inner, 'stop', state.signs);
        sign.index = i;
        sign.setMap(panorama);
        signs.push(sign);
      });
    },
    places: ({ places }) => {
      for (const place of places) {
        if (placeIds.has(place.id)) continue;
        placeIds.add(place.id);
        const root = el('div', 'fp-sign fp-anchor fp-place');
        const inner = el('div', 'fp-sign-inner');
        inner.append(el('span', 'fp-name', place.title));
        root.append(inner, el('span', 'fp-pole'));
        root.hidden = true;
        const sign = new Sign(place, root, inner, 'place', state.signs * 0.45);
        sign.id = place.id;
        sign.setMap(panorama);
        signs.push(sign);
      }
    },
    highlight: ({ id }) => {
      for (const sign of signs) sign.root.classList.toggle('now', sign.kind === 'place' && id != null && sign.id === id);
    },
    reached: ({ index }) => {
      signs.find((s) => s.kind === 'stop' && s.index === index)?.root.classList.add('reached');
    },
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const command = parseCommand(event.data);
    if (command) commands[command.type](command);
  });
  report({ type: 'ready' });
}

if (!inApp) note('This page is part of Roamie: open the app and choose "First person" during a tour.');
else if (!CONFIG.apiKey) report({ type: 'failed', reason: 'no key' });
else start();
