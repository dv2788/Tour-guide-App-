// Pure geographic helpers. No DOM access, so they run in the browser and in Node tests.

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance in meters between two {lat, lon} points. */
export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, in degrees [0, 360). 0 = north, 90 = east. */
export function bearingDegrees(a, b) {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed smallest angle from `from` to `to`, in degrees [-180, 180). Positive = clockwise. */
export function angleDiff(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Where is something relative to the direction of travel?
 * Returns 'ahead' | 'right' | 'left' | 'behind', or 'nearby' when the heading is unknown.
 */
export function relativeDirection(heading, bearing) {
  if (heading == null || !Number.isFinite(heading)) return 'nearby';
  const d = angleDiff(heading, bearing);
  const abs = Math.abs(d);
  if (abs <= 35) return 'ahead';
  if (abs >= 145) return 'behind';
  return d > 0 ? 'right' : 'left';
}

/** Precompute cumulative distances along a polyline of {lat, lon} points. */
export function buildPath(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

/**
 * Position `distance` meters along a path built with buildPath().
 * Returns {lat, lon, heading}. Distances outside the path are clamped to its ends.
 */
export function pointAlongPath(path, distance) {
  const { points, cumulative, length } = path;
  if (points.length === 0) return null;
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon, heading: null };

  const d = Math.max(0, Math.min(length, distance));
  // Binary search for the segment containing d.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= d) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const segLen = cumulative[hi] - cumulative[lo];
  const t = segLen > 0 ? (d - cumulative[lo]) / segLen : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    heading: segLen > 0 ? bearingDegrees(a, b) : null,
  };
}

/**
 * Shortest distance in meters from point p to the segment a–b. Uses a local flat
 * projection around p, which is accurate at city scale. Lets us notice that you
 * passed a stop between two GPS fixes, not only when a fix lands right on it.
 */
export function distanceToSegmentMeters(p, a, b) {
  const kx = 111320 * Math.cos(toRad(p.lat));
  const ky = 111320;
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * ky;
  const dx = (b.lon - a.lon) * kx;
  const dy = (b.lat - a.lat) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Where p falls on segment a–b: { distance (m) to the segment, t (0..1 along it) }. */
export function projectOnSegment(p, a, b) {
  const kx = 111320 * Math.cos(toRad(p.lat));
  const ky = 111320;
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * ky;
  const dx = (b.lon - a.lon) * kx;
  const dy = (b.lat - a.lat) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return { distance: Math.hypot(ax + t * dx, ay + t * dy), t };
}
