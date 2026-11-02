// First person: travel through the streets instead of looking down on them. A 3D map seen from
// just above your head (higher on a hike, for the view), facing the way you're going, with the
// buildings standing up on either side, the route on the ground ahead, signposts for the stops
// and the places the guide tells you about. Same free map data as the top view (OpenFreeMap,
// from OpenStreetMap): no extra account, no key. Drawn only while it's on screen.

import { bearingDegrees, angleDiff, distanceMeters, buildPath, pointAlongPath, projectOnSegment } from './geo.js';

// How high the eye is (m above the street), and how far ahead signposts show.
export const EYE = {
  walk: { height: 5, signs: 700 },
  run: { height: 5, signs: 700 },
  hike: { height: 25, signs: 2500 }, // the landscape is the point
  cycle: { height: 5, signs: 1000 },
  drive: { height: 6, signs: 2500 },
};
export const PITCH = 80; // degrees from looking straight down (the map allows up to 85)
// Field of view, top to bottom: wide, like your own eyes, rather than the map's usual 37°
// telephoto (which shows a slice of road and little else). 60° is the most the map allows.
export const FOV = 60;
const MAP_FOV = 36.87;
const EARTH = 2 * Math.PI * 6378137; // metres round the equator

/** A point `meters` away in direction `bearing` (degrees). Flat-earth: fine at street scale. */
export function offsetPoint({ lat, lon }, bearing, meters) {
  const b = (bearing * Math.PI) / 180;
  const dLat = (meters * Math.cos(b)) / 111320;
  const dLon = (meters * Math.sin(b)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

/**
 * Where to point the map so its camera stands at `eye`, `height` metres up, looking along
 * `heading`: the map looks at a point on the ground ahead, from a zoom that puts the camera at
 * that height. (The map has no "stand here" camera, so we work it out.)
 */
export function eyeCamera({ eye, heading, height, viewHeightPx, pitch = PITCH, fov = FOV }) {
  const p = (pitch * Math.PI) / 180;
  const ahead = height * Math.tan(p); // from your feet to the point the camera looks at
  const center = offsetPoint(eye, heading, ahead);
  const cameraToCenterPx = (0.5 * viewHeightPx) / Math.tan(((fov / 2) * Math.PI) / 180);
  const metersPerPx = height / (cameraToCenterPx * Math.cos(p));
  const zoom = Math.log2((EARTH * Math.cos((center.lat * Math.PI) / 180)) / (512 * metersPerPx));
  return { center, zoom: Math.min(22, zoom), bearing: heading, pitch };
}

/**
 * Which way the street goes from here: towards the route ~`meters` ahead when you're on it
 * (so the view turns with the street, not with GPS jitter), else null.
 */
export function routeHeading(path, pos, meters = 30) {
  if (!path || path.points.length < 2) return null;
  let best = null;
  for (let i = 1; i < path.points.length; i++) {
    const { distance, t } = projectOnSegment(pos, path.points[i - 1], path.points[i]);
    if (!best || distance < best.distance) best = { distance, along: path.cumulative[i - 1] + t * (path.cumulative[i] - path.cumulative[i - 1]) };
  }
  if (best.distance > 40) return null; // off the route: follow your own steps instead
  const ahead = pointAlongPath(path, best.along + meters);
  if (!ahead || distanceMeters(pos, ahead) < 3) return null;
  return bearingDegrees(pos, ahead);
}

/**
 * A signpost seen from where you stand: shown when it's ahead (not behind you) and near
 * enough; nearer ones bigger. Returns { visible, scale, distance }.
 */
export function signpost(eye, heading, place, maxDistance) {
  const distance = distanceMeters(eye, place);
  if (distance > maxDistance) return { visible: false, scale: 0, distance };
  // Close by, it stays even if you've just walked past it; further away, only what's in view.
  const off = Math.abs(angleDiff(heading, bearingDegrees(eye, place)));
  if (distance > 25 && off > 60) return { visible: false, scale: 0, distance };
  const scale = Math.max(0.55, Math.min(1, 1.15 - distance / (maxDistance * 1.2)));
  return { visible: true, scale, distance };
}

// The map's look in first person: the day or night style, buildings in 3D, a sky.
const LOOK = {
  light: { walls: '#efe5d3', sky: '#b9d6ea', horizon: '#f6f1e8', fog: '#efe7da', route: '#c9a55c', edge: '#7f5f25' },
  dark: { walls: '#2c3547', sky: '#0b0f17', horizon: '#1d2636', fog: '#151b26', route: '#e3c98b', edge: '#0b0f17' },
};

/** The style with buildings standing up, the route layers and a sky. */
export function firstPersonStyle(style, { dark = false } = {}) {
  const look = LOOK[dark ? 'dark' : 'light'];
  const source = Object.keys(style.sources ?? {}).find((id) => style.sources[id].type === 'vector') ?? 'openmaptiles';
  const layers = (style.layers ?? []).filter((layer) => layer['source-layer'] !== 'building');
  const firstLabel = layers.findIndex((layer) => layer.type === 'symbol');
  const at = firstLabel < 0 ? layers.length : firstLabel;
  const ours = [
    {
      id: 'fp-route-edge',
      type: 'line',
      source: 'fp-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': look.edge, 'line-opacity': 0.45, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 5, 22, 150] },
    },
    {
      id: 'fp-route',
      type: 'line',
      source: 'fp-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': look.route, 'line-opacity': 0.9, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 3, 22, 110] }, // about 1.5 m wide
    },
    {
      id: 'fp-buildings',
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': look.walls,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      },
    },
  ];
  return {
    ...style,
    sources: { ...style.sources, 'fp-route': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [...layers.slice(0, at), ...ours, ...layers.slice(at)],
    // Sunlight from the side, so the street's two walls aren't the same flat colour.
    light: { anchor: 'viewport', color: '#ffffff', intensity: dark ? 0.25 : 0.4, position: [1.4, 100, 50] },
    sky: {
      'sky-color': look.sky,
      'horizon-color': look.horizon,
      'fog-color': look.fog,
      'sky-horizon-blend': 0.7,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.35,
      'atmosphere-blend': 0,
    },
  };
}

const line = (points) => ({
  type: 'FeatureCollection',
  features: points?.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) } }] : [],
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text; // names from Wikipedia and the map: always text, never markup
  return node;
}

/**
 * The first-person view. `style`: the base map style (JSON). Feed it what the top map gets:
 * setRoute, setStops, addPlaces, move; it keeps them, so it can be opened mid-tour.
 */
export class StreetView {
  constructor({ container, style, dark = false, modeId = 'walk', coverTop = () => 0, maplibregl = globalThis.maplibregl }) {
    this.container = container;
    this.coverTop = coverTop; // how much of the top is under the direction card: the horizon goes below it
    this.eyeConfig = EYE[modeId] ?? EYE.walk;
    this.heading = 0;
    this.eye = null;
    this.path = null;
    this.legPath = null;
    this.lastMoveAt = 0;
    this.signs = []; // { place, marker, inner, kind }
    this.placeIds = new Set();
    this.ready = false;
    this.map = new maplibregl.Map({
      container,
      style: firstPersonStyle(style, { dark }),
      attributionControl: false, // our own fixed credit line (see app.js), never the tile server's markup
      interactive: false, // it follows you: nothing to drag
      maxPitch: 85,
      maxZoom: 22,
      pitch: PITCH,
      fadeDuration: 0,
    });
    this.maplibregl = maplibregl;
    // A wide view (the map has no option for it in this version: its camera's own setting).
    try {
      if (this.map.transform && 'fov' in this.map.transform) this.map.transform.fov = FOV;
    } catch {
      // keep the map's own
    }
    this.fov = Number(this.map.transform?.fov) || MAP_FOV;
    this.map.on('load', () => {
      this.ready = true;
      this.#drawRoute();
    });
  }

  /** The whole planned route, and (during the tour) the way to the next stop. */
  setRoute(points) {
    this.path = points?.length > 1 ? buildPath(points) : null;
    this.#drawRoute();
  }

  setLeg(points) {
    this.legPath = points?.length > 1 ? buildPath(points) : null;
    this.#drawRoute();
  }

  #drawRoute() {
    if (!this.ready) return;
    this.map.getSource('fp-route')?.setData(line((this.legPath ?? this.path)?.points));
  }

  /** Numbered signposts for the stops, with their names. */
  setStops(stops) {
    for (const sign of this.signs.filter((s) => s.kind === 'stop')) sign.marker.remove();
    this.signs = this.signs.filter((s) => s.kind !== 'stop');
    stops.forEach((stop, i) => {
      const root = el('div', 'fp-sign fp-stop');
      const inner = el('div', 'fp-sign-inner');
      inner.append(el('span', 'fp-num', String(i + 1)), el('span', 'fp-name', stop.name ?? stop.title ?? ''));
      root.append(inner, el('span', 'fp-pole'));
      this.#addSign({ place: stop, root, inner, kind: 'stop', index: i });
    });
    this.#placeSigns();
  }

  /** Smaller labels for the places the guide may tell you about on the way. */
  addPlaces(places) {
    for (const place of places) {
      if (place.category === 'skip' || place.category === 'minor' || this.placeIds.has(place.id)) continue;
      this.placeIds.add(place.id);
      const root = el('div', 'fp-sign fp-place');
      const inner = el('div', 'fp-sign-inner');
      inner.append(el('span', 'fp-name', place.title ?? ''));
      root.append(inner, el('span', 'fp-pole'));
      this.#addSign({ place, root, inner, kind: 'place', id: place.id });
    }
    this.#placeSigns();
  }

  #addSign(sign) {
    sign.marker = new this.maplibregl.Marker({ element: sign.root, anchor: 'bottom' }).setLngLat([sign.place.lon, sign.place.lat]).addTo(this.map);
    sign.root.hidden = true;
    this.signs.push(sign);
  }

  /** The place being told about stands out for a while. */
  highlight(id) {
    for (const sign of this.signs) sign.root.classList.toggle('now', sign.kind === 'place' && sign.id === id);
  }

  markReached(index) {
    this.signs.find((s) => s.kind === 'stop' && s.index === index)?.root.classList.add('reached');
  }

  /** You moved: the camera walks with you, turning with the street. */
  move(pos, { heading = null } = {}) {
    const now = performance.now();
    const step = this.eye ? distanceMeters(this.eye, pos) : 0;
    const along = routeHeading(this.legPath, pos) ?? routeHeading(this.path, pos);
    if (along != null) this.heading = along;
    else if (heading != null && Number.isFinite(heading)) this.heading = heading;
    else if (this.eye && step > 2) this.heading = bearingDegrees(this.eye, pos);
    const first = !this.eye;
    this.eye = { lat: pos.lat, lon: pos.lon };
    const camera = eyeCamera({ eye: this.eye, heading: this.heading, height: this.eyeConfig.height, viewHeightPx: this.container.clientHeight || 400, fov: this.fov });
    // The view's centre moves down by half the padding: the horizon (and the stops far ahead)
    // clear of the direction card. The camera still stands where you are.
    camera.padding = { top: Math.round(Math.max(0, this.coverTop()) * 0.8), bottom: 0, left: 0, right: 0 };
    // Glide from one position to the next over the time between them, so you seem to walk.
    const duration = first ? 0 : Math.min(1500, Math.max(250, now - this.lastMoveAt));
    this.lastMoveAt = now;
    if (first) this.map.jumpTo(camera);
    else this.map.easeTo({ ...camera, duration, easing: (t) => t });
    this.#placeSigns();
  }

  #placeSigns() {
    if (!this.eye) return;
    for (const sign of this.signs) {
      const max = sign.kind === 'stop' ? this.eyeConfig.signs : this.eyeConfig.signs * 0.45;
      const { visible, scale } = signpost(this.eye, this.heading, sign.place, max);
      sign.root.hidden = !visible;
      if (visible) sign.inner.style.transform = `scale(${scale.toFixed(2)})`;
    }
  }

  resize() {
    this.map.resize();
    if (this.eye) this.move(this.eye);
  }

  destroy() {
    for (const sign of this.signs) sign.marker.remove();
    this.signs = [];
    this.map.remove();
  }
}
