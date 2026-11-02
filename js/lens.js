// "Point your camera": which landmark, monument or street is the phone pointing at?
// Worked out from where you stand (GPS) and which way the camera faces (compass), so it needs
// no image recognition and no account. Pure functions, so they can be tested.

import { distanceMeters, bearingDegrees, angleDiff } from './geo.js';
import { isPlaceToSee } from './suggest.js';

const DEG = Math.PI / 180;
// Something you can point at: not a district or a whole city ("You're here: London"), an
// organisation ("Archdiocese of Paris") or an event ("Notre-Dame fire"). Same test as routes.
const pointable = (p) => p.lat != null && isPlaceToSee(p);
// Squares are where you stand, like streets: on the Grand-Place, pointing at the Town Hall,
// the Town Hall is what you're looking at.
const SQUARE_RE =
  /^(?:place|plaza|piazza|plaça|praça|piazzale|platz|plein)\s|(?:square|platz|plein|markt|grand-place|grote markt)(?:,.*|\s*\(.*\))?$|^grand-place/iu;
const SQUARE_DESCRIPTION_RE = /^(?:[\p{L}'’-]+\s+){0,2}(?:square|plaza|piazza|place|platz|plein|praça|plaça|market square)(?![\p{L}])/iu;
const isSquare = (p) => SQUARE_RE.test(p.title ?? '') || SQUARE_DESCRIPTION_RE.test(p.description ?? '');

/**
 * Which way the back camera points (degrees clockwise from north), from a device orientation
 * event, or null if the phone doesn't say.
 * - iPhone: `webkitCompassHeading` is already a compass heading.
 * - Android: an absolute event's alpha/beta/gamma give the phone's rotation; the back camera
 *   looks along the phone's -z axis, so turn that axis into the earth frame (east, north) and
 *   take its bearing. This works however the phone is held (flat, upright, sideways).
 */
export function cameraHeading(event) {
  if (!event) return null;
  if (Number.isFinite(event.webkitCompassHeading)) return (event.webkitCompassHeading + 360) % 360;
  if (!event.absolute || !Number.isFinite(event.alpha)) return null;
  const a = event.alpha * DEG;
  const b = (event.beta ?? 90) * DEG;
  const g = (event.gamma ?? 0) * DEG;
  // Device-to-earth rotation (W3C: Z, then X', then Y''), applied to (0, 0, -1).
  const east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const north = Math.cos(a) * Math.sin(b) * Math.cos(g) - Math.sin(a) * Math.sin(g);
  if (Math.hypot(east, north) < 0.15) return null; // camera pointing at the sky or the ground
  return (Math.atan2(east, north) / DEG + 360) % 360;
}

/**
 * Smooth a jittery compass: move part of the way towards the new reading, the short way round.
 * Without a factor, it adapts: steady when you hold the phone still, quick when you turn.
 */
export function smoothHeading(previous, next, factor = null) {
  if (previous == null) return next;
  if (next == null) return previous;
  const diff = angleDiff(previous, next);
  const f = factor ?? (Math.abs(diff) > 25 ? 0.6 : 0.25);
  return (previous + diff * f + 360) % 360;
}

/**
 * How much a compass wavers, in degrees, from its recent readings (oldest first): the back and
 * forth beyond the overall turn. Turning steadily scores ~0; an uncalibrated compass, a lot.
 */
export function compassJitter(readings) {
  let travelled = 0;
  let net = 0;
  for (let i = 1; i < readings.length; i++) {
    const d = angleDiff(readings[i - 1], readings[i]);
    travelled += Math.abs(d);
    net += d;
  }
  return travelled - Math.abs(net);
}

/** Half the width of a place in metres, and whether we know it (Wikipedia gave its size). */
function halfWidth(p) {
  // Without a size of its own, Wikipedia gives a default by kind (about 1 km for a landmark).
  const dim = Number(p.dim);
  const known = Number.isFinite(dim) && dim > 0 && dim < 1000;
  return { half: known ? Math.min(150, Math.max(10, dim / 2)) : 15, known };
}

/**
 * The places in front of the camera, best first. `off` is how far from the centre of the view
 * (degrees, negative = left), `x` where to draw its label (0 = left edge, 1 = right edge).
 * Places you're standing at come first ("here"), unless they're behind you and something else is in view.
 *
 * A place counts as in view if it's within the camera's field of view, widened a little for
 * big buildings close by and for compass error. The best is the one nearest the centre, nearer
 * places and better-known ones winning ties: in a street of famous houses, the one you aim at.
 */
export function placesInView(position, heading, places, { fov = 60, maxDistance = 300, hereWithin = 25, headingError = 5 } = {}) {
  if (!position || heading == null) return [];
  const half = fov / 2;
  // GPS error in metres: in a street of tall buildings it can be 30–60 m.
  const accuracy = Number.isFinite(position.accuracy) ? position.accuracy : 10;
  const seen = [];
  for (const p of places) {
    if (!pointable(p)) continue;
    const distance = distanceMeters(position, p);
    if (distance > maxDistance) continue;
    // (Not widened by GPS error: a vague position mustn't make "You're here" more likely.)
    const here = distance <= hereWithin;
    const bearingOff = angleDiff(heading, bearingDegrees(position, p));
    // Standing at a place with your back to it, you're pointing at something else (on a square,
    // with GPS 10–20 m off, the building beside you mustn't hide the belfry in front).
    const behind = here && (Math.abs(bearingOff) > 100 || isSquare(p));
    const off = here ? 0 : bearingOff;
    const near = Math.max(distance, 1);
    const width = halfWidth(p);
    const size = Math.atan2(width.half, near) / DEG; // how wide it looks from here
    // In view: within the field of view, widened by its width and by the GPS error seen from here.
    const gpsAngle = Math.min(15, Math.atan2(accuracy, near) / DEG);
    if (!here && Math.abs(off) > half + Math.min(size, 45) + gpsAngle) continue;
    // Closest to the middle first, but within the compass's error it's a tie: then the better
    // known, then the nearer (Wikipedia puts a building's point anywhere inside it). Aiming
    // anywhere across a place whose size we know (a 190 m amphitheatre) counts as aiming at it.
    // (GPS error moves neighbouring buildings together, so it doesn't decide between them.)
    const aimed = Math.max(headingError, width.known ? Math.min(30, size) : 0);
    const fame = Math.log10(1 + (p.langs ?? 0)) + (p.category === 'minor' ? -1 : 0);
    const cost = here ? -1000 : Math.max(0, Math.abs(off) - aimed) + distance / 25 - fame * 4;
    seen.push({ ...p, distance, off, here, behind, x: Math.min(1, Math.max(0, 0.5 + off / fov)), cost });
  }
  const ahead = seen.filter((p) => !p.behind);
  return (ahead.length ? ahead : seen).sort((a, b) => a.cost - b.cost).map(({ behind, ...p }) => p);
}

/** Nearby places with no compass to go by: nearest first ("what's around you"). */
export function placesAround(position, places, { maxDistance = 300 } = {}) {
  if (!position) return [];
  return places
    .filter(pointable)
    .map((p) => ({ ...p, distance: distanceMeters(position, p), off: null, x: null }))
    .filter((p) => p.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

/** "40 m ahead", "120 m, a little to the left", "you're here". */
export function whereItIs(place) {
  if (place.here) return "You're here";
  const m = place.distance < 100 ? `${Math.round(place.distance / 5) * 5} m` : `${Math.round(place.distance / 10) * 10} m`;
  if (place.off == null) return `${m} away`;
  const side = Math.abs(place.off) < 8 ? 'ahead' : place.off < 0 ? 'a little to the left' : 'a little to the right';
  return `${m}, ${side}`;
}
