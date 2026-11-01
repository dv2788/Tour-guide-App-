// "Point your camera": which landmark, monument or street is the phone pointing at?
// Worked out from where you stand (GPS) and which way the camera faces (compass), so it needs
// no image recognition and no account. Pure functions, so they can be tested.

import { distanceMeters, bearingDegrees, angleDiff } from './geo.js';
import { isPlaceToSee } from './suggest.js';

const DEG = Math.PI / 180;
// Something you can point at: not a district or a whole city ("You're here: London"), an
// organisation ("Archdiocese of Paris") or an event ("Notre-Dame fire"). Same test as routes.
const pointable = (p) => p.lat != null && isPlaceToSee(p);

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

/** Smooth a jittery compass: move part of the way towards the new reading, the short way round. */
export function smoothHeading(previous, next, factor = 0.25) {
  if (previous == null) return next;
  if (next == null) return previous;
  return (previous + angleDiff(previous, next) * factor + 360) % 360;
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
export function placesInView(position, heading, places, { fov = 60, maxDistance = 300, hereWithin = 25 } = {}) {
  if (!position || heading == null) return [];
  const half = fov / 2;
  const seen = [];
  for (const p of places) {
    if (!pointable(p)) continue;
    const distance = distanceMeters(position, p);
    if (distance > maxDistance) continue;
    const here = distance <= hereWithin;
    const bearingOff = angleDiff(heading, bearingDegrees(position, p));
    // Standing at a place with your back to it, you're pointing at something else (on a square,
    // with GPS 10–20 m off, the building beside you mustn't hide the belfry in front).
    const behind = here && Math.abs(bearingOff) > 100;
    const off = here ? 0 : bearingOff;
    const size = Math.atan2(15, Math.max(distance, 1)) / DEG; // a building is ~30 m wide
    if (!here && Math.abs(off) > half + Math.min(size, 15)) continue;
    // Closest to the middle first, but within compass error (~5°) it's a tie: then the better
    // known, then the nearer (Wikipedia puts a building's point anywhere inside it).
    const fame = Math.log10(1 + (p.langs ?? 0)) + (p.category === 'minor' ? -1 : 0);
    const cost = here ? -1000 : Math.max(0, Math.abs(off) - 5) + distance / 25 - fame * 4;
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
