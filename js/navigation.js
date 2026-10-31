// Showing the way to the next stop: the walking route on the map, the next turn on screen
// ("In 80 m, turn left onto Rue de Rivoli"), a short spoken direction just before each
// turn, and re-routing when the traveller strays. Directions come from the same OSRM
// routing service used for planning (routing.openstreetmap.de).

import { distanceMeters, bearingDegrees, angleDiff, buildPath, pointAlongPath, projectOnSegment } from './geo.js';
import { formatDistance } from './i18n.js';

// ---------- Reading a route ----------

// OpenStreetMap maps many pavements and crossings as separate little paths, so a raw walking
// route is full of "turn left, 5 m, turn right" zig-zags (crossing a street, stepping onto
// the pavement) and most of its paths have no name. Read literally, that's a stream of
// confusing orders. So the route is simplified the way a person would describe it: nearby
// maneuvers are merged, the real change of direction is measured on the line itself, and
// zig-zags that leave you heading the same way are dropped.

const TURN_WINDOW = 15; // meters of line before/after a maneuver used to measure the turn

/** Compass heading of the route between two distances along it (null if too short). */
function headingAlong(path, from, to) {
  const a = pointAlongPath(path, Math.max(0, from));
  const b = pointAlongPath(path, Math.min(path.length, to));
  if (!a || !b || distanceMeters(a, b) < 2) return null;
  return bearingDegrees(a, b);
}

/** Turn angle (degrees, + = right) -> OSRM-style modifier. */
function modifierFor(angle) {
  const a = Math.abs(angle);
  const side = angle > 0 ? 'right' : 'left';
  if (a < 30) return 'straight';
  if (a < 60) return `slight ${side}`;
  if (a < 140) return side;
  if (a < 170) return `sharp ${side}`;
  return 'uturn';
}

const ROUND = /^(roundabout|rotary|roundabout turn)$/;
/** A step where the route can change direction (not "the street changes name"). */
function isDecision(step) {
  if (step.type === 'depart' || step.type === 'arrive' || step.type === 'notification') return false;
  if (step.type === 'exit roundabout' || step.type === 'exit rotary') return false; // said with the roundabout
  if ((step.type === 'new name' || step.type === 'continue' || step.type === 'turn') && (!step.modifier || step.modifier === 'straight')) return false;
  return true;
}

/** Where each OSRM maneuver falls on the drawn line (its location is a vertex of it). */
function placeSteps(path, rawSteps) {
  let cursor = 0;
  let summed = 0;
  return rawSteps.map((s) => {
    let along = summed;
    for (let i = cursor; i < path.points.length && s.lat != null; i++) {
      if (distanceMeters(path.points[i], s) < 1) {
        along = path.cumulative[i];
        cursor = i;
        break;
      }
    }
    summed += s.distance;
    return { ...s, along: Math.min(path.length, Math.max(0, along)) };
  });
}

/**
 * The maneuvers a walker (or driver) actually needs, from OSRM's raw steps: depart, the real
 * turns (nearby steps merged, zig-zags dropped, angles measured on the line), arrive.
 */
export function simplifyManeuvers(path, steps, { mergeWithin = 25 } = {}) {
  const depart = steps.find((s) => s.type === 'depart') ?? { id: 0, type: 'depart', name: '', along: 0 };
  const arrive = steps.findLast((s) => s.type === 'arrive') ?? { id: steps.length, type: 'arrive', name: '' };
  const nameBefore = (along) => steps.findLast((s) => s.along < along)?.name ?? '';

  // Group decision points that come within `mergeWithin` meters of each other.
  const clusters = [];
  for (const s of steps.filter(isDecision)) {
    const last = clusters.at(-1);
    if (last && s.along - last.at(-1).along <= mergeWithin) last.push(s);
    else clusters.push([s]);
  }
  // Anything in the first few meters is part of setting off.
  const setOff = [depart];
  while (clusters.length && clusters[0][0].along <= mergeWithin) setOff.push(...clusters.shift());
  const setOffEnd = setOff.at(-1).along;
  const out = [
    {
      ...depart,
      along: 0,
      bearing: headingAlong(path, setOffEnd, setOffEnd + 25) ?? depart.bearing,
      name: setOff.findLast((s) => s.name)?.name ?? '',
      probeAt: setOffEnd,
    },
  ];

  let previousAlong = setOffEnd;
  for (const c of clusters) {
    const first = c[0];
    const last = c.at(-1);
    if (path.length - first.along < 15) continue; // you're there: the arrival takes over
    const roundabout = c.find((s) => ROUND.test(s.type));
    const previous = out.at(-1)?.name;
    const name = last.name && last.name !== nameBefore(first.along) && last.name !== previous ? last.name : '';
    const base = { id: first.id, lat: first.lat, lon: first.lon, along: first.along, name, probeAt: last.along };
    if (roundabout) {
      out.push({ ...base, type: roundabout.type, modifier: roundabout.modifier, exit: roundabout.exit });
      continue;
    }
    const outH = headingAlong(path, last.along, last.along + TURN_WINDOW);
    const turnFrom = (from, to) => {
      const inH = headingAlong(path, Math.max(from, previousAlong), to);
      return inH != null && outH != null ? angleDiff(inH, outH) : null;
    };
    const near = turnFrom(first.along - TURN_WINDOW, first.along);
    // The path often curves into a junction before the point OSRM marks (a slip path round a
    // corner): measured only from just before, that turn would look like "straight on".
    // (Only on a clear run-up: right after another maneuver, the "before" is that maneuver.)
    const wide = first.along - 60 >= previousAlong ? turnFrom(first.along - 60, first.along - 30) : null;
    const angle = near != null && wide != null && Math.abs(wide) >= 60 && Math.abs(wide) > Math.abs(near) ? wide : near;
    previousAlong = last.along;
    if (c.length === 1) {
      // One clear maneuver: trust OSRM's reading of the junction, unless the line hardly bends.
      const straightish = angle != null && Math.abs(angle) < 15;
      if (straightish && first.type !== 'fork') continue;
      const curved = angle === wide && wide !== near; // the turn happened on the way in: say what it really is
      out.push({ ...base, type: first.type === 'fork' && !curved ? 'fork' : 'turn', modifier: curved ? modifierFor(angle) : first.modifier });
      continue;
    }
    const modifier = angle == null ? first.modifier : modifierFor(angle);
    if (modifier === 'straight') continue; // a zig-zag (crossing, pavement): carry on
    if (modifier === 'uturn' || modifier.startsWith('sharp')) {
      // Two turns the same way round a corner, not one about-turn: say both.
      const turns = c.filter((s) => s.modifier && s.modifier !== 'straight');
      if (turns.length >= 2) {
        out.push({ ...base, type: 'turn', modifier: turns[0].modifier, name: '', probeAt: turns[0].along });
        const second = turns.at(-1);
        out.push({ id: second.id, lat: second.lat, lon: second.lon, along: second.along, name, probeAt: second.along, type: 'turn', modifier: second.modifier });
        continue;
      }
    }
    out.push({ ...base, type: 'turn', modifier });
  }
  out.push({ ...arrive, along: path.length });
  return out;
}

/** OSRM route (with steps) -> points, length, and the maneuvers placed along the line. */
export function parseRoute(osrm, { mergeWithin = 25 } = {}) {
  const r = osrm?.routes?.[0];
  if (!r?.geometry?.coordinates?.length) return null;
  const path = buildPath(r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })));
  const raw = (r.legs ?? []).flatMap((leg) => leg.steps ?? []).map((s, id) => ({
    id,
    type: s.maneuver?.type,
    modifier: s.maneuver?.modifier ?? null,
    exit: s.maneuver?.exit ?? null,
    bearing: s.maneuver?.bearing_after ?? null,
    name: s.name || s.ref || '',
    lat: s.maneuver?.location?.[1],
    lon: s.maneuver?.location?.[0],
    distance: s.distance ?? 0,
  }));
  const placed = placeSteps(path, raw);
  return {
    ...path,
    duration: r.duration ?? null,
    targetSnap: osrm.waypoints?.at(-1)?.distance ?? null, // how close the paths get to the stop
    rawSteps: placed,
    steps: simplifyManeuvers(path, placed, { mergeWithin }),
  };
}

/**
 * How far along the route we are, and how far off it. With `near` (the last known progress),
 * the match stays on the same part of the route, so a route that doubles back along a street
 * doesn't make us jump ahead or behind.
 */
export function progressOn(route, position, near = null) {
  const { points, cumulative } = route;
  const search = (lo, hi) => {
    let best = { off: Infinity, along: 0 };
    for (let i = 1; i < points.length; i++) {
      if (cumulative[i] < lo || cumulative[i - 1] > hi) continue;
      const { distance, t } = projectOnSegment(position, points[i - 1], points[i]);
      if (distance < best.off) best = { off: distance, along: cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1]) };
    }
    return best;
  };
  if (near != null) {
    const local = search(near - 60, near + 400);
    if (local.off <= 30) return local;
  }
  return search(-Infinity, Infinity);
}

/** Is this a step you actually have to do something at? (Not "carry straight on".) */
function isAction(step) {
  return step.type === 'arrive' || isDecision(step) || step.type === 'roundabout' || step.type === 'rotary';
}

/**
 * The next thing to do: the first real maneuver ahead, plus the one right after it when
 * they come within `combineWithin` meters ("Turn left, then turn right").
 */
export function upcomingManeuver(route, along, { combineWithin = 30 } = {}) {
  const ahead = route.steps.filter((s) => isAction(s) && s.along > along + 2 && s.type !== 'depart');
  const atStart = along < 15 ? route.steps.find((s) => s.type === 'depart') : null;
  const next = atStart ?? ahead[0];
  if (!next) return null;
  const after = ahead.find((s) => s.along > next.along);
  const then = after && after.type !== 'arrive' && after.along - next.along <= combineWithin ? after : null;
  return { step: next, distance: Math.max(0, next.along - along), then };
}

// ---------- Words ----------

const COMPASS = {
  en: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
  fr: ['le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest'],
  es: ['el norte', 'el noreste', 'el este', 'el sureste', 'el sur', 'el suroeste', 'el oeste', 'el noroeste'],
  de: ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'],
  it: ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'],
};

const NAV = {
  en: {
    depart: 'Head {compass}', left: 'Turn left', right: 'Turn right', 'slight left': 'Bear left', 'slight right': 'Bear right', 'keep left': 'Keep left', 'keep right': 'Keep right',
    'sharp left': 'Turn sharp left', 'sharp right': 'Turn sharp right', straight: 'Continue straight', uturn: 'Turn around',
    roundabout: 'At the roundabout, take exit {exit}', onto: '{action} onto {name}', arrive: '{stop} is just ahead', arriveIn: '{stop} is {d} ahead',
    then: '{first}, then {second}', in: 'In {d}, {action}', lowerFirst: true,
  },
  fr: {
    depart: 'Partez vers {compass}', left: 'Tournez à gauche', right: 'Tournez à droite', 'slight left': 'Tournez légèrement à gauche',
    'slight right': 'Tournez légèrement à droite', 'keep left': 'Restez à gauche', 'keep right': 'Restez à droite', 'sharp left': 'Tournez franchement à gauche', 'sharp right': 'Tournez franchement à droite',
    straight: 'Continuez tout droit', uturn: 'Faites demi-tour', roundabout: 'Au rond-point, prenez la sortie {exit}',
    onto: '{action} sur {name}', arrive: '{stop} est juste devant vous', arriveIn: '{stop} est à {d} devant vous', then: '{first}, puis {second}', in: 'Dans {d}, {action}', lowerFirst: true,
  },
  es: {
    depart: 'Dirígete hacia {compass}', left: 'Gira a la izquierda', right: 'Gira a la derecha', 'slight left': 'Gira ligeramente a la izquierda',
    'slight right': 'Gira ligeramente a la derecha', 'keep left': 'Mantente a la izquierda', 'keep right': 'Mantente a la derecha', 'sharp left': 'Gira bruscamente a la izquierda', 'sharp right': 'Gira bruscamente a la derecha',
    straight: 'Sigue recto', uturn: 'Da la vuelta', roundabout: 'En la rotonda, toma la salida {exit}', onto: '{action} hacia {name}',
    arrive: '{stop} está justo delante', arriveIn: '{stop} está a {d}', then: '{first} y luego {second}', in: 'En {d}, {action}', lowerFirst: true,
  },
  de: {
    depart: 'Gehen Sie Richtung {compass}', left: 'Links abbiegen', right: 'Rechts abbiegen', 'slight left': 'Leicht links abbiegen',
    'slight right': 'Leicht rechts abbiegen', 'keep left': 'Links halten', 'keep right': 'Rechts halten', 'sharp left': 'Scharf links abbiegen', 'sharp right': 'Scharf rechts abbiegen',
    straight: 'Geradeaus weiter', uturn: 'Wenden Sie', roundabout: 'Im Kreisverkehr die {exit}. Ausfahrt nehmen', onto: '{action} in {name}',
    arrive: '{stop} liegt direkt vor Ihnen', arriveIn: '{stop} liegt {d} vor Ihnen', then: '{first}, dann {second}', in: 'In {d}: {action}', lowerFirst: false,
  },
  it: {
    depart: 'Procedi verso {compass}', left: 'Gira a sinistra', right: 'Gira a destra', 'slight left': 'Svolta leggermente a sinistra',
    'slight right': 'Svolta leggermente a destra', 'keep left': 'Tieni la sinistra', 'keep right': 'Tieni la destra', 'sharp left': 'Gira decisamente a sinistra', 'sharp right': 'Gira decisamente a destra',
    straight: 'Prosegui dritto', uturn: 'Torna indietro', roundabout: 'Alla rotonda, prendi la uscita {exit}', onto: '{action} in {name}',
    arrive: '{stop} è proprio davanti a te', arriveIn: '{stop} è a {d} davanti a te', then: '{first}, poi {second}', in: 'Tra {d}, {action}', lowerFirst: true,
  },
};

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** What to do at a step, in words: "Turn left onto Rue de Rivoli". */
export function stepInstruction(lang, step, stopName = '') {
  const w = NAV[lang] ?? NAV.en;
  if (step.type === 'arrive') return fill(w.arrive, { stop: stopName });
  let action;
  if (step.type === 'depart') {
    const compass = (COMPASS[lang] ?? COMPASS.en)[Math.round(((step.bearing ?? 0) % 360) / 45) % 8];
    action = fill(w.depart, { compass });
  } else if (step.type === 'roundabout' || step.type === 'rotary') {
    action = fill(w.roundabout, { exit: step.exit ?? 1 });
  } else if (step.type === 'fork' && /left|right/.test(step.modifier ?? '')) {
    action = w[/left/.test(step.modifier) ? 'keep left' : 'keep right'];
  } else {
    action = w[step.modifier] ?? w.straight;
  }
  return step.name ? fill(w.onto, { action, name: step.name }) : action;
}

/** Closer than this to the place and there is no way left to show: it's right there. */
const HERE_METERS = 25;

/** "Casa Batlló is just ahead", or "Your starting point is just ahead" (a sentence starts with a capital). */
function hereSentence(lang, stopName) {
  const text = fill((NAV[lang] ?? NAV.en).arrive, { stop: stopName });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The full sentence for the next maneuver, with distance and any "then …". */
export function maneuverSentence(lang, maneuver, stopName, { withDistance = true } = {}) {
  const w = NAV[lang] ?? NAV.en;
  if (maneuver.step.type === 'arrive') {
    // "Plaça de Catalunya is 100 meters ahead": a name never loses its capital.
    return withDistance && maneuver.distance >= 15 ? fill(w.arriveIn, { stop: stopName, d: formatDistance(lang, maneuver.distance) }) : fill(w.arrive, { stop: stopName });
  }
  let text = stepInstruction(lang, maneuver.step, stopName);
  if (maneuver.then) text = fill(w.then, { first: text, second: w.lowerFirst ? lowerFirst(stepInstruction(lang, maneuver.then, stopName)) : stepInstruction(lang, maneuver.then, stopName) });
  if (withDistance && maneuver.distance >= 15 && maneuver.step.type !== 'depart') {
    text = fill(w.in, { d: formatDistance(lang, maneuver.distance), action: w.lowerFirst ? lowerFirst(text) : text });
  }
  return text;
}

/** Which arrow to show. */
export function maneuverIcon(step) {
  if (step.type === 'depart') return 'navigation';
  if (step.type === 'arrive') return 'flag';
  if (step.type === 'roundabout' || step.type === 'rotary') return 'roundabout-right';
  return (
    {
      left: 'turn-left',
      right: 'turn-right',
      'slight left': 'turn-slight-left',
      'slight right': 'turn-slight-right',
      'sharp left': 'turn-sharp-left',
      'sharp right': 'turn-sharp-right',
      uturn: 'u-turn-left',
    }[step.modifier] ?? 'straight'
  );
}

/** A link that opens full turn-by-turn navigation to the stop in the phone's maps app. */
export function mapsLink(stop, modeId = 'walk', { apple = false } = {}) {
  const at = `${stop.lat.toFixed(6)},${stop.lon.toFixed(6)}`;
  if (apple) {
    const flag = { walk: 'w', run: 'w', cycle: 'c', drive: 'd' }[modeId] ?? 'w';
    return `https://maps.apple.com/?daddr=${at}&dirflg=${flag}`;
  }
  const mode = { walk: 'walking', run: 'walking', cycle: 'bicycling', drive: 'driving' }[modeId] ?? 'walking';
  return `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=${mode}`;
}

/**
 * The whole route in Google Maps, every stop in order. Google takes up to 9 stops on the way
 * plus the destination, so a longer route comes in parts, each starting where the last ended.
 * Without an origin, Google starts from where the phone is.
 */
export function routeMapsLinks(stops, { modeId = 'walk', origin = null, perPart = 10 } = {}) {
  const at = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const mode = { walk: 'walking', run: 'walking', cycle: 'bicycling', drive: 'driving' }[modeId] ?? 'walking';
  const links = [];
  for (let i = 0; i < stops.length; i += perPart) {
    const part = stops.slice(i, i + perPart);
    const from = i === 0 ? origin : stops[i - 1];
    const params = new URLSearchParams({ api: '1' });
    if (from) params.set('origin', at(from));
    params.set('destination', at(part.at(-1)));
    if (part.length > 1) params.set('waypoints', part.slice(0, -1).map(at).join('|'));
    params.set('travelmode', mode);
    links.push(`https://www.google.com/maps/dir/?${params}`);
  }
  return links;
}

// ---------- Guiding ----------

const SETTINGS = {
  // speed in m/min; announce/reroute in m; merge = maneuvers this close are described as one
  // strays = positions in a row off the route before we call it a wrong turn (GPS jumps about)
  walk: { speed: 75, announce: 30, reroute: 40, merge: 25, strays: 3, speak: true },
  run: { speed: 160, announce: 45, reroute: 45, merge: 25, strays: 3, speak: true },
  cycle: { speed: 250, announce: 70, reroute: 50, merge: 20, strays: 2, speak: true },
  drive: { speed: 400, announce: 200, reroute: 80, merge: 15, strays: 2, speak: false }, // drivers use their maps app
};
const MIN_REROUTE_MS = 12000;

/**
 * Keeps the route to the next stop up to date as positions come in, and reports what to
 * show. onUpdate({ target, route, maneuver, sentence, icon, remaining, minutes, offRoute }).
 * `streetName(point)` (optional) names the street at a point, for the many paths that
 * OpenStreetMap leaves unnamed (pavements, crossings).
 */
export class Navigator {
  constructor({ lang = 'en', modeId = 'walk', getDirections, streetName = null, narrator = null, speak, onUpdate = () => {}, now = () => Date.now() }) {
    this.lang = lang;
    this.settings = SETTINGS[modeId] ?? SETTINGS.walk;
    this.speak = speak ?? this.settings.speak;
    this.getDirections = getDirections; // (from, to) => Promise<OSRM json>
    this.streetName = streetName;
    this.narrator = narrator;
    this.onUpdate = onUpdate;
    this.now = now;
    this.target = null;
    this.route = null;
    this.position = null;
    this.progress = null;
    this.strays = 0;
    this.fetching = false;
    this.lastFetchAt = 0;
    this.failures = 0;
    this.announced = new Set();
    this.naming = false;
    this.running = true;
  }

  /** The stop to guide to (null when the itinerary is done). */
  setTarget(stop) {
    if (stop?.name === this.target?.name && stop?.lat === this.target?.lat) return;
    this.target = stop ?? null;
    this.route = null;
    this.rerouted = false;
    this.progress = null;
    this.failures = 0;
    this.announced.clear();
    if (this.position) this.#refresh(true);
    else this.onUpdate(this.#state());
  }

  update(position) {
    if (!this.running) return;
    this.position = { lat: position.lat, lon: position.lon, accuracy: position.accuracy ?? null, heading: Number.isFinite(position.heading) ? position.heading : null };
    this.#refresh(false);
  }

  stop() {
    this.running = false;
  }

  /**
   * Where to draw you: on the route when you're clearly following it (GPS wanders a few
   * meters into buildings; the way you're walking doesn't), else where the GPS says.
   */
  snap(position) {
    const p = this.progress;
    if (!this.route || !p || p.offRoute) return position;
    if (p.off > Math.max(20, Math.min(position.accuracy ?? 0, 35))) return position;
    const on = pointAlongPath(this.route, p.along);
    return on ? { ...position, lat: on.lat, lon: on.lon, snapped: true } : position;
  }

  /** How far off the route counts as a wrong turn, given how sure the GPS is. */
  #strayLimit() {
    const accuracy = Math.min(this.position?.accuracy ?? 0, 60);
    return Math.max(this.settings.reroute, accuracy * 1.5);
  }

  #track() {
    if (!this.route || !this.position) return (this.progress = null);
    const p = progressOn(this.route, this.position, this.progress?.along ?? null);
    this.strays = p.off > this.#strayLimit() ? this.strays + 1 : 0;
    this.progress = { ...p, offRoute: this.strays >= this.settings.strays };
    return this.progress;
  }

  #refresh(force) {
    if (!this.target || !this.position) {
      this.onUpdate(this.#state());
      return;
    }
    const progress = this.#track();
    const sinceFetch = this.now() - this.lastFetchAt;
    // After a failure, wait longer each time (3 s, 6 s, 12 s… up to a minute) before retrying.
    const retryAfter = this.failures ? Math.min(60000, 3000 * 2 ** (this.failures - 1)) : 0;
    const needed = force || !this.route || progress?.offRoute;
    const allowed = force || (!this.route ? sinceFetch >= retryAfter : sinceFetch > Math.max(MIN_REROUTE_MS, retryAfter));
    if (needed && allowed && !this.fetching) this.#fetch();
    this.#guide(progress);
  }

  async #fetch() {
    this.fetching = true;
    this.lastFetchAt = this.now();
    const target = this.target;
    try {
      const route = parseRoute(await this.getDirections(this.position, target), { mergeWithin: this.settings.merge });
      if (!route) throw new Error('No route');
      if (this.running && target === this.target) {
        this.rerouted = Boolean(this.route); // a new way after a wrong turn: say it straight away
        this.route = route;
        this.progress = null;
        this.strays = 0;
        this.failures = 0;
        this.announced.clear();
      }
    } catch {
      this.failures++; // keep the previous route (or none); we'll try again
    } finally {
      this.fetching = false;
    }
    if (this.running) this.#guide(this.#track());
  }

  /** Ask for the name of an unnamed street we're about to turn into (once per maneuver). */
  #nameStreets(maneuver) {
    if (!this.streetName || this.naming || !maneuver) return;
    const route = this.route;
    const step = [maneuver.step, maneuver.then].find((s) => s && !s.name && !s.named && s.type !== 'arrive');
    if (!step) return;
    step.named = true;
    const next = route.steps.find((s) => s.along > step.along && s !== step);
    const from = step.probeAt ?? step.along;
    const room = (next?.along ?? route.length) - from;
    const probe = pointAlongPath(route, from + Math.max(6, Math.min(20, room / 2)));
    this.naming = true;
    Promise.resolve(this.streetName(probe))
      .then((name) => {
        const before = route.steps.findLast((s) => s.along < step.along);
        if (name && this.route === route && name !== before?.name) {
          step.name = name;
          if (this.running) this.onUpdate(this.#state(this.progress));
        }
      })
      .catch(() => {})
      .finally(() => {
        this.naming = false;
      });
  }

  #guide(progress) {
    const state = this.#state(progress);
    const m = state.maneuver;
    this.#nameStreets(m);
    if (this.speak && this.narrator && m && !state.offRoute && m.step.type !== 'arrive' && !this.announced.has(m.step.id)) {
      const due = m.step.type === 'depart' ? !this.announced.size : m.distance <= this.settings.announce;
      if (due) {
        this.announced.add(m.step.id);
        if (m.then) this.announced.add(m.then.id);
        // Turns cut in (time-critical); the first "head this way" waits for the current story.
        const urgent = m.step.type !== 'depart' || this.rerouted;
        this.narrator.interject?.(maneuverSentence(this.lang, m, this.target.name, { withDistance: m.distance >= 15 }), { kind: 'direction' }, { urgent });
      }
    }
    this.onUpdate(state);
  }

  #state(progress = null) {
    // failed: the route service couldn't give a way here (yet): the maps app is the way out.
    const base = { target: this.target, route: this.route, maneuver: null, sentence: null, icon: null, remaining: null, minutes: null, offRoute: false, failed: this.failures > 0 && !this.route };
    if (!this.target) return base;
    if (!this.route || !progress) {
      const straight = this.position ? distanceMeters(this.position, this.target) : null;
      // Already there (e.g. back at the start of a round trip): no route to wait for.
      const here = straight != null && straight <= HERE_METERS;
      return {
        ...base,
        sentence: here ? hereSentence(this.lang, this.target.name) : null,
        icon: here ? 'flag' : null,
        remaining: straight,
        minutes: straight != null ? Math.max(1, Math.round(straight / this.settings.speed)) : null,
      };
    }
    const remaining = Math.max(0, this.route.length - progress.along) + progress.off;
    const maneuver = upcomingManeuver(this.route, progress.along);
    const offRoute = Boolean(progress.offRoute);
    const arrived = !maneuver && !offRoute; // past the last step of the route
    return {
      ...base,
      maneuver,
      // While re-routing, don't keep giving directions for the road you've left.
      sentence: maneuver && !offRoute ? maneuverSentence(this.lang, maneuver, this.target.name) : arrived ? hereSentence(this.lang, this.target.name) : null,
      icon: maneuver && !offRoute ? maneuverIcon(maneuver.step) : arrived ? 'flag' : null,
      remaining,
      minutes: Math.max(1, Math.round(remaining / this.settings.speed)),
      offRoute,
      bearing: this.position ? bearingDegrees(this.position, this.target) : null,
    };
  }
}
