// Magnetic declination: how far a compass's "north" is from true north, here and now.
// Phones give the camera's direction relative to magnetic north (iPhone's compass heading,
// Android's absolute orientation); maps and Wikipedia use true north. The difference is about
// 1° in Paris but 24° in Rio de Janeiro and 26° in Cape Town: without it, the camera would
// name the building next to the one you point at.
//
// World Magnetic Model 2025 (WMM2025, valid 2025–2030), by NOAA's National Centers for
// Environmental Information and the British Geological Survey; a U.S. Government work in the
// public domain. The calculation follows NOAA's reference implementation (geomag).

// [n, m, g, h, g per year, h per year] in nT, Schmidt semi-normalised.
const WMM2025 = [[1,0,-29351.8,0,12,0],[1,1,-1410.8,4545.4,9.7,-21.5],[2,0,-2556.6,0,-11.6,0],[2,1,2951.1,-3133.6,-5.2,-27.7],[2,2,1649.3,-815.1,-8,-12.1],[3,0,1361,0,-1.3,0],[3,1,-2404.1,-56.6,-4.2,4],[3,2,1243.8,237.5,0.4,-0.3],[3,3,453.6,-549.5,-15.6,-4.1],[4,0,895,0,-1.6,0],[4,1,799.5,278.6,-2.4,-1.1],[4,2,55.7,-133.9,-6,4.1],[4,3,-281.1,212,5.6,1.6],[4,4,12.1,-375.6,-7,-4.4],[5,0,-233.2,0,0.6,0],[5,1,368.9,45.4,1.4,-0.5],[5,2,187.2,220.2,0,2.2],[5,3,-138.7,-122.9,0.6,0.4],[5,4,-142,43,2.2,1.7],[5,5,20.9,106.1,0.9,1.9],[6,0,64.4,0,-0.2,0],[6,1,63.8,-18.4,-0.4,0.3],[6,2,76.9,16.8,0.9,-1.6],[6,3,-115.7,48.8,1.2,-0.4],[6,4,-40.9,-59.8,-0.9,0.9],[6,5,14.9,10.9,0.3,0.7],[6,6,-60.7,72.7,0.9,0.9],[7,0,79.5,0,-0,0],[7,1,-77,-48.9,-0.1,0.6],[7,2,-8.8,-14.4,-0.1,0.5],[7,3,59.3,-1,0.5,-0.8],[7,4,15.8,23.4,-0.1,0],[7,5,2.5,-7.4,-0.8,-1],[7,6,-11.1,-25.1,-0.8,0.6],[7,7,14.2,-2.3,0.8,-0.2],[8,0,23.2,0,-0.1,0],[8,1,10.8,7.1,0.2,-0.2],[8,2,-17.5,-12.6,0,0.5],[8,3,2,11.4,0.5,-0.4],[8,4,-21.7,-9.7,-0.1,0.4],[8,5,16.9,12.7,0.3,-0.5],[8,6,15,0.7,0.2,-0.6],[8,7,-16.8,-5.2,-0,0.3],[8,8,0.9,3.9,0.2,0.2],[9,0,4.6,0,-0,0],[9,1,7.8,-24.8,-0.1,-0.3],[9,2,3,12.2,0.1,0.3],[9,3,-0.2,8.3,0.3,-0.3],[9,4,-2.5,-3.3,-0.3,0.3],[9,5,-13.1,-5.2,0,0.2],[9,6,2.4,7.2,0.3,-0.1],[9,7,8.6,-0.6,-0.1,-0.2],[9,8,-8.7,0.8,0.1,0.4],[9,9,-12.9,10,-0.1,0.1],[10,0,-1.3,0,0.1,0],[10,1,-6.4,3.3,0,0],[10,2,0.2,0,0.1,-0],[10,3,2,2.4,0.1,-0.2],[10,4,-1,5.3,-0,0.1],[10,5,-0.6,-9.1,-0.3,-0.1],[10,6,-0.9,0.4,0,0.1],[10,7,1.5,-4.2,-0.1,0],[10,8,0.9,-3.8,-0.1,-0.1],[10,9,-2.7,0.9,-0,0.2],[10,10,-3.9,-9.1,-0,-0],[11,0,2.9,0,0,0],[11,1,-1.5,0,-0,-0],[11,2,-2.5,2.9,0,0.1],[11,3,2.4,-0.6,0,-0],[11,4,-0.6,0.2,0,0.1],[11,5,-0.1,0.5,-0.1,-0],[11,6,-0.6,-0.3,0,-0],[11,7,-0.1,-1.2,-0,0.1],[11,8,1.1,-1.7,-0.1,-0],[11,9,-1,-2.9,-0.1,0],[11,10,-0.2,-1.8,-0.1,0],[11,11,2.6,-2.3,-0.1,0],[12,0,-2,0,0,0],[12,1,-0.2,-1.3,0,-0],[12,2,0.3,0.7,-0,0],[12,3,1.2,1,-0,-0.1],[12,4,-1.3,-1.4,-0,0.1],[12,5,0.6,-0,-0,-0],[12,6,0.6,0.6,0.1,-0],[12,7,0.5,-0.1,-0,-0],[12,8,-0.1,0.8,0,0],[12,9,-0.4,0.1,0,-0],[12,10,-0.2,-1,-0.1,-0],[12,11,-1.3,0.1,-0,0],[12,12,-0.7,0.2,-0.1,-0.1]];
const EPOCH = 2025.0;
const MAX = 12;

// Unnormalised coefficients and recursion constants, computed once.
let model = null;
function build() {
  const grid = () => Array.from({ length: MAX + 1 }, () => new Array(MAX + 1).fill(0));
  const c = grid();
  const cd = grid();
  const k = grid();
  const snorm = grid();
  for (const [n, m, g, h, gd, hd] of WMM2025) {
    c[m][n] = g;
    cd[m][n] = gd;
    if (m !== 0) {
      c[n][m - 1] = h;
      cd[n][m - 1] = hd;
    }
  }
  snorm[0][0] = 1;
  for (let n = 1; n <= MAX; n++) {
    snorm[0][n] = (snorm[0][n - 1] * (2 * n - 1)) / n;
    let j = 2;
    for (let m = 0; m <= n; m++) {
      k[m][n] = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
      if (m > 0) {
        const flnmj = ((n - m + 1) * j) / (n + m);
        snorm[m][n] = snorm[m - 1][n] * Math.sqrt(flnmj);
        j = 1;
        c[n][m - 1] *= snorm[m][n];
        cd[n][m - 1] *= snorm[m][n];
      }
      c[m][n] *= snorm[m][n];
      cd[m][n] *= snorm[m][n];
    }
  }
  k[1][1] = 0;
  return { c, cd, k, grid };
}

/**
 * Magnetic declination in degrees (east of true north is positive) at a place and time.
 * `year` is a decimal year (2026.5 = early July 2026); `altitudeKm` above sea level.
 */
export function declination(lat, lon, year = decimalYear(), altitudeKm = 0) {
  model ??= build();
  const { c, cd, k, grid } = model;
  const dt = year - EPOCH;
  const dtr = Math.PI / 180;
  const a = 6378.137;
  const b = 6356.7523142;
  const re = 6371.2;
  const a2 = a * a;
  const b2 = b * b;
  const c2 = a2 - b2;
  const a4 = a2 * a2;
  const b4 = b2 * b2;
  const c4 = a4 - b4;
  const rlon = lon * dtr;
  const rlat = lat * dtr;
  const srlat = Math.sin(rlat);
  const crlat = Math.cos(rlat);
  const srlat2 = srlat * srlat;
  const crlat2 = crlat * crlat;
  const sp = new Array(MAX + 1).fill(0);
  const cp = new Array(MAX + 1).fill(0);
  sp[0] = 0;
  cp[0] = 1;
  sp[1] = Math.sin(rlon);
  cp[1] = Math.cos(rlon);
  // Geodetic to spherical coordinates.
  const q = Math.sqrt(a2 - c2 * srlat2);
  const q1 = altitudeKm * q;
  const q2 = ((q1 + a2) / (q1 + b2)) ** 2;
  const ct = srlat / Math.sqrt(q2 * crlat2 + srlat2);
  const st = Math.sqrt(1 - ct * ct);
  const r2 = altitudeKm * altitudeKm + 2 * q1 + (a4 - c4 * srlat2) / (q * q);
  const r = Math.sqrt(r2);
  const d = Math.sqrt(a2 * crlat2 + b2 * srlat2);
  const ca = (altitudeKm + d) / r;
  const sa = (c2 * crlat * srlat) / (r * d);
  for (let m = 2; m <= MAX; m++) {
    sp[m] = sp[1] * cp[m - 1] + cp[1] * sp[m - 1];
    cp[m] = cp[1] * cp[m - 1] - sp[1] * sp[m - 1];
  }
  const p = grid();
  const dp = grid();
  const pp = new Array(MAX + 1).fill(0);
  p[0][0] = 1;
  pp[0] = 1;
  const aor = re / r;
  let ar = aor * aor;
  let br = 0;
  let bt = 0;
  let bp = 0;
  let bpp = 0;
  for (let n = 1; n <= MAX; n++) {
    ar *= aor;
    for (let m = 0; m <= n; m++) {
      // Associated Legendre functions and their derivatives, by recursion.
      if (n === m) {
        p[m][n] = st * p[m - 1][n - 1];
        dp[m][n] = st * dp[m - 1][n - 1] + ct * p[m - 1][n - 1];
      } else if (n === 1 && m === 0) {
        p[m][n] = ct * p[m][n - 1];
        dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1];
      } else if (n > 1 && n !== m) {
        if (m > n - 2) {
          p[m][n - 2] = 0;
          dp[m][n - 2] = 0;
        }
        p[m][n] = ct * p[m][n - 1] - k[m][n] * p[m][n - 2];
        dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1] - k[m][n] * dp[m][n - 2];
      }
      // The coefficients at this date.
      const tcmn = c[m][n] + dt * cd[m][n];
      const tcnm = m !== 0 ? c[n][m - 1] + dt * cd[n][m - 1] : 0;
      const par = ar * p[m][n];
      const temp1 = m === 0 ? tcmn * cp[m] : tcmn * cp[m] + tcnm * sp[m];
      const temp2 = m === 0 ? tcmn * sp[m] : tcmn * sp[m] - tcnm * cp[m];
      bt -= ar * temp1 * dp[m][n];
      bp += m * temp2 * par;
      br += (n + 1) * temp1 * par;
      // At the geographic poles.
      if (st === 0 && m === 1) {
        pp[n] = n === 1 ? pp[n - 1] : ct * pp[n - 1] - k[m][n] * pp[n - 2];
        bpp += m * temp2 * ar * pp[n];
      }
    }
  }
  bp = st === 0 ? bpp : bp / st;
  // Spherical to geodetic components: north (x) and east (y).
  const bx = -bt * ca - br * sa;
  const by = bp;
  return Math.atan2(by, bx) / dtr;
}

/** Today as a decimal year (2026.83 = 1 November 2026). */
export function decimalYear(date = new Date()) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/** A magnetic compass heading turned into a true one. */
export function trueHeading(magnetic, decl) {
  if (magnetic == null) return null;
  return (magnetic + (decl ?? 0) + 360) % 360;
}
