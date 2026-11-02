// Real street photos in first person (Google Street View), driven from the app. Google's
// script needs things the app's page refuses (inline styles, its own hosts), so it runs in its
// own page, streetview.html, shown here inside a frame, and the two talk with messages:
// where you are and which way the street goes, the stops and places; back comes whether
// Google has photos here (where it hasn't, the app shows the 3D map instead). Every message is
// checked on arrival, both ways, and only messages from the app's own address count.
// One Street View viewer per tour (that's what Google bills), kept while the tour runs.

import { distanceMeters, bearingDegrees, buildPath } from './geo.js';
import { routeHeading, EYE } from './streetView.js';

export const FRAME_PAGE = './streetview.html';

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const onEarth = (p) => Boolean(p) && typeof p === 'object' && num(p.lat) != null && num(p.lon) != null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const anId = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 80);

/** A message from the app to the Street View page, checked: only well-formed ones pass. */
export function parseCommand(data) {
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'config':
      return { type: 'config', signs: Math.min(10000, Math.max(100, num(data.signs) ?? 700)) };
    case 'move':
      return onEarth(data) ? { type: 'move', lat: data.lat, lon: data.lon, heading: num(data.heading) } : null;
    case 'stops':
      if (!Array.isArray(data.stops)) return null;
      return { type: 'stops', stops: data.stops.filter(onEarth).slice(0, 60).map((s) => ({ lat: s.lat, lon: s.lon, name: str(s.name) })) };
    case 'places':
      if (!Array.isArray(data.places)) return null;
      return {
        type: 'places',
        places: data.places
          .filter((p) => onEarth(p) && anId(p.id))
          .slice(0, 300)
          .map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, title: str(p.title) })),
      };
    case 'highlight':
      return { type: 'highlight', id: data.id == null ? null : anId(data.id) ? data.id : null };
    case 'reached':
      return Number.isInteger(data.index) && data.index >= 0 && data.index < 1000 ? { type: 'reached', index: data.index } : null;
    default:
      return null;
  }
}

/** A message from the Street View page to the app, checked. */
export function parseReport(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'ready') return { type: 'ready' };
  if (data.type === 'coverage') return { type: 'coverage', here: data.here === true };
  if (data.type === 'failed') return { type: 'failed', reason: str(data.reason, 200) };
  return null;
}

/** Time to look for the next photo: never looked yet, or moved `step` metres since. */
export function needsLookup(last, pos, step) {
  return !last || distanceMeters(last, pos) >= step;
}

/**
 * The app's side: the frame, and what to tell it. The same calls as the 3D view (StreetView),
 * so the tour screen feeds both alike.
 */
export class PhotoView {
  constructor({ container, modeId = 'walk', onCoverage = () => {}, onFailed = () => {}, page = FRAME_PAGE }) {
    this.onCoverage = onCoverage;
    this.onFailed = onFailed;
    this.ready = false;
    this.queue = [];
    this.covered = null;
    this.path = null;
    this.legPath = null;
    this.eye = null;
    this.heading = 0;
    this.placeIds = new Set();
    this.frame = document.createElement('iframe');
    this.frame.className = 'street-photo-frame';
    this.frame.title = 'Street View: the street you are on';
    this.frame.referrerPolicy = 'strict-origin-when-cross-origin'; // Google checks the key against the site's address
    this.frame.src = page;
    this.listener = (event) => this.#onMessage(event);
    window.addEventListener('message', this.listener);
    container.append(this.frame);
    this.#send({ type: 'config', signs: (EYE[modeId] ?? EYE.walk).signs });
  }

  #onMessage(event) {
    if (event.source !== this.frame.contentWindow || event.origin !== location.origin) return;
    const report = parseReport(event.data);
    if (!report) return;
    if (report.type === 'ready') {
      this.ready = true;
      const queued = this.queue;
      this.queue = [];
      for (const message of queued) this.#send(message);
    } else if (report.type === 'coverage') {
      if (this.covered === report.here) return;
      this.covered = report.here;
      this.onCoverage(report.here);
    } else if (report.type === 'failed') {
      this.onFailed(report.reason);
    }
  }

  #send(message) {
    if (!this.ready) {
      // Until the page is up, keep what it will need (only the latest position).
      if (message.type === 'move') this.queue = this.queue.filter((m) => m.type !== 'move');
      this.queue.push(message);
      return;
    }
    this.frame.contentWindow?.postMessage(message, location.origin);
  }

  /** The route only serves to face the way the street goes (the photos follow you). */
  setRoute(points) {
    this.path = points?.length > 1 ? buildPath(points) : null;
  }

  setLeg(points) {
    this.legPath = points?.length > 1 ? buildPath(points) : null;
  }

  setStops(stops) {
    this.#send({ type: 'stops', stops: stops.map((s) => ({ lat: s.lat, lon: s.lon, name: s.name ?? s.title ?? '' })) });
  }

  addPlaces(places) {
    const fresh = [];
    for (const place of places) {
      if (place.category === 'skip' || place.category === 'minor' || this.placeIds.has(place.id)) continue;
      this.placeIds.add(place.id);
      fresh.push({ id: place.id, lat: place.lat, lon: place.lon, title: place.title ?? '' });
    }
    if (fresh.length) this.#send({ type: 'places', places: fresh });
  }

  highlight(id) {
    this.#send({ type: 'highlight', id: id ?? null });
  }

  markReached(index) {
    this.#send({ type: 'reached', index });
  }

  /** You moved: the next photo, facing along the street (as the 3D view works it out). */
  move(pos, { heading = null } = {}) {
    const step = this.eye ? distanceMeters(this.eye, pos) : 0;
    const along = routeHeading(this.legPath, pos) ?? routeHeading(this.path, pos);
    if (along != null) this.heading = along;
    else if (heading != null && Number.isFinite(heading)) this.heading = heading;
    else if (this.eye && step > 2) this.heading = bearingDegrees(this.eye, pos);
    this.eye = { lat: pos.lat, lon: pos.lon };
    this.#send({ type: 'move', lat: pos.lat, lon: pos.lon, heading: this.heading });
  }

  resize() {}

  destroy() {
    window.removeEventListener('message', this.listener);
    this.frame.remove();
  }
}
