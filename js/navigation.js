// Showing the way to the next stop: the walking route on the map, the next turn on screen
// ("In 80 m, turn left onto Rue de Rivoli"), a short spoken direction just before each
// turn, and re-routing when the traveller strays. Directions come from the same OSRM
// routing service used for planning (routing.openstreetmap.de).

import { distanceMeters, bearingDegrees, buildPath, projectOnSegment } from './geo.js';
import { formatDistance } from './i18n.js';

// ---------- Reading a route ----------

/** OSRM route (with steps) -> points, length, and maneuvers placed along the line. */
export function parseRoute(osrm) {
  const r = osrm?.routes?.[0];
  if (!r?.geometry?.coordinates?.length) return null;
  const path = buildPath(r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })));
  let along = 0;
  const steps = (r.legs ?? []).flatMap((leg) => leg.steps ?? []).map((s, id) => {
    const step = {
      id,
      type: s.maneuver?.type,
      modifier: s.maneuver?.modifier ?? null,
      exit: s.maneuver?.exit ?? null,
      bearing: s.maneuver?.bearing_after ?? null,
      name: s.name || '',
      lat: s.maneuver?.location?.[1],
      lon: s.maneuver?.location?.[0],
      along,
    };
    along += s.distance ?? 0;
    return step;
  });
  return { ...path, duration: r.duration ?? null, steps };
}

/** How far along the route we are, and how far off it. */
export function progressOn(route, position) {
  const { points, cumulative } = route;
  let best = { off: Infinity, along: 0 };
  for (let i = 1; i < points.length; i++) {
    const { distance, t } = projectOnSegment(position, points[i - 1], points[i]);
    if (distance < best.off) best = { off: distance, along: cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1]) };
  }
  return best;
}

const ACTION_TYPES = new Set(['turn', 'end of road', 'fork', 'merge', 'on ramp', 'off ramp', 'roundabout', 'rotary', 'roundabout turn', 'exit roundabout', 'exit rotary', 'continue', 'new name', 'depart', 'arrive']);

/** Is this a step you actually have to do something at? (Not "carry straight on".) */
function isAction(step) {
  if (!ACTION_TYPES.has(step.type)) return false;
  if ((step.type === 'new name' || step.type === 'continue') && (!step.modifier || step.modifier === 'straight')) return false;
  return true;
}

/**
 * The next thing to do: the first real maneuver ahead, plus the one right after it when
 * they come within `combineWithin` meters ("Turn left, then turn right").
 */
export function upcomingManeuver(route, along, { combineWithin = 25 } = {}) {
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
    depart: 'Head {compass}', left: 'Turn left', right: 'Turn right', 'slight left': 'Bear left', 'slight right': 'Bear right',
    'sharp left': 'Turn sharp left', 'sharp right': 'Turn sharp right', straight: 'Continue straight', uturn: 'Turn around',
    roundabout: 'At the roundabout, take exit {exit}', onto: '{action} onto {name}', arrive: '{stop} is just ahead',
    then: '{first}, then {second}', in: 'In {d}, {action}', lowerFirst: true,
  },
  fr: {
    depart: 'Partez vers {compass}', left: 'Tournez à gauche', right: 'Tournez à droite', 'slight left': 'Serrez à gauche',
    'slight right': 'Serrez à droite', 'sharp left': 'Tournez franchement à gauche', 'sharp right': 'Tournez franchement à droite',
    straight: 'Continuez tout droit', uturn: 'Faites demi-tour', roundabout: 'Au rond-point, prenez la sortie {exit}',
    onto: '{action} sur {name}', arrive: '{stop} est juste devant vous', then: '{first}, puis {second}', in: 'Dans {d}, {action}', lowerFirst: true,
  },
  es: {
    depart: 'Dirígete hacia {compass}', left: 'Gira a la izquierda', right: 'Gira a la derecha', 'slight left': 'Mantente a la izquierda',
    'slight right': 'Mantente a la derecha', 'sharp left': 'Gira bruscamente a la izquierda', 'sharp right': 'Gira bruscamente a la derecha',
    straight: 'Sigue recto', uturn: 'Da la vuelta', roundabout: 'En la rotonda, toma la salida {exit}', onto: '{action} hacia {name}',
    arrive: '{stop} está justo delante', then: '{first} y luego {second}', in: 'En {d}, {action}', lowerFirst: true,
  },
  de: {
    depart: 'Gehen Sie Richtung {compass}', left: 'Links abbiegen', right: 'Rechts abbiegen', 'slight left': 'Halten Sie sich links',
    'slight right': 'Halten Sie sich rechts', 'sharp left': 'Scharf links abbiegen', 'sharp right': 'Scharf rechts abbiegen',
    straight: 'Geradeaus weiter', uturn: 'Wenden Sie', roundabout: 'Im Kreisverkehr die {exit}. Ausfahrt nehmen', onto: '{action} in {name}',
    arrive: '{stop} liegt direkt vor Ihnen', then: '{first}, dann {second}', in: 'In {d}: {action}', lowerFirst: false,
  },
  it: {
    depart: 'Procedi verso {compass}', left: 'Gira a sinistra', right: 'Gira a destra', 'slight left': 'Tieni la sinistra',
    'slight right': 'Tieni la destra', 'sharp left': 'Gira decisamente a sinistra', 'sharp right': 'Gira decisamente a destra',
    straight: 'Prosegui dritto', uturn: 'Torna indietro', roundabout: 'Alla rotonda, prendi la uscita {exit}', onto: '{action} in {name}',
    arrive: '{stop} è proprio davanti a te', then: '{first}, poi {second}', in: 'Tra {d}, {action}', lowerFirst: true,
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
  } else {
    action = w[step.modifier] ?? w.straight;
  }
  return step.name ? fill(w.onto, { action, name: step.name }) : action;
}

/** The full sentence for the next maneuver, with distance and any "then …". */
export function maneuverSentence(lang, maneuver, stopName, { withDistance = true } = {}) {
  const w = NAV[lang] ?? NAV.en;
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

// ---------- Guiding ----------

const SETTINGS = {
  walk: { speed: 75, announce: 30, reroute: 40, speak: true }, // speed in m/min
  run: { speed: 160, announce: 45, reroute: 45, speak: true },
  cycle: { speed: 250, announce: 70, reroute: 50, speak: true },
  drive: { speed: 400, announce: 200, reroute: 80, speak: false }, // drivers use their maps app
};
const MIN_REROUTE_MS = 12000;

/**
 * Keeps the route to the next stop up to date as positions come in, and reports what to
 * show. onUpdate({ target, route, maneuver, sentence, icon, remaining, minutes, offRoute }).
 */
export class Navigator {
  constructor({ lang = 'en', modeId = 'walk', getDirections, narrator = null, speak, onUpdate = () => {}, now = () => Date.now() }) {
    this.lang = lang;
    this.settings = SETTINGS[modeId] ?? SETTINGS.walk;
    this.speak = speak ?? this.settings.speak;
    this.getDirections = getDirections; // (from, to) => Promise<OSRM json>
    this.narrator = narrator;
    this.onUpdate = onUpdate;
    this.now = now;
    this.target = null;
    this.route = null;
    this.position = null;
    this.fetching = false;
    this.lastFetchAt = 0;
    this.announced = new Set();
    this.running = true;
  }

  /** The stop to guide to (null when the itinerary is done). */
  setTarget(stop) {
    if (stop?.name === this.target?.name && stop?.lat === this.target?.lat) return;
    this.target = stop ?? null;
    this.route = null;
    this.announced.clear();
    if (this.position) this.#refresh(true);
    else this.onUpdate(this.#state());
  }

  update(position) {
    if (!this.running) return;
    this.position = { lat: position.lat, lon: position.lon };
    this.#refresh(false);
  }

  stop() {
    this.running = false;
  }

  #refresh(force) {
    if (!this.target || !this.position) {
      this.onUpdate(this.#state());
      return;
    }
    const progress = this.route ? progressOn(this.route, this.position) : null;
    const strayed = progress && progress.off > this.settings.reroute;
    if ((force || !this.route || strayed) && !this.fetching && (force || this.now() - this.lastFetchAt > MIN_REROUTE_MS || !this.route)) {
      this.#fetch();
    }
    this.#guide(progress);
  }

  async #fetch() {
    this.fetching = true;
    this.lastFetchAt = this.now();
    const target = this.target;
    try {
      const route = parseRoute(await this.getDirections(this.position, target));
      if (this.running && target === this.target && route) {
        this.route = route;
        this.announced.clear();
      }
    } catch {
      // keep the previous route (or none); we'll try again
    } finally {
      this.fetching = false;
    }
    if (this.running) this.#guide(this.route ? progressOn(this.route, this.position) : null);
  }

  #guide(progress) {
    const state = this.#state(progress);
    const m = state.maneuver;
    if (this.speak && this.narrator && m && m.step.type !== 'arrive' && !this.announced.has(m.step.id)) {
      const due = m.step.type === 'depart' ? !this.announced.size : m.distance <= this.settings.announce;
      if (due) {
        this.announced.add(m.step.id);
        if (m.then) this.announced.add(m.then.id);
        // Turns cut in (time-critical); the first "head this way" waits for the current story.
        this.narrator.interject?.(maneuverSentence(this.lang, m, this.target.name, { withDistance: m.distance >= 15 }), { kind: 'direction' }, { urgent: m.step.type !== 'depart' });
      }
    }
    this.onUpdate(state);
  }

  #state(progress = null) {
    const base = { target: this.target, route: this.route, maneuver: null, sentence: null, icon: null, remaining: null, minutes: null, offRoute: false };
    if (!this.target) return base;
    if (!this.route || !progress) {
      const straight = this.position ? distanceMeters(this.position, this.target) : null;
      return { ...base, remaining: straight, minutes: straight != null ? Math.max(1, Math.round(straight / this.settings.speed)) : null };
    }
    const remaining = Math.max(0, this.route.length - progress.along) + progress.off;
    const maneuver = upcomingManeuver(this.route, progress.along);
    return {
      ...base,
      maneuver,
      sentence: maneuver ? maneuverSentence(this.lang, maneuver, this.target.name) : null,
      icon: maneuver ? maneuverIcon(maneuver.step) : null,
      remaining,
      minutes: Math.max(1, Math.round(remaining / this.settings.speed)),
      offRoute: progress.off > this.settings.reroute,
      bearing: this.position ? bearingDegrees(this.position, this.target) : null,
    };
  }
}
