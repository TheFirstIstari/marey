// Pure helpers for the Commute visualisation (T6.1). No DOM access —
// importable from both the browser renderer (src/js/commute.js) and node tests.
'use strict';

// Build percentile band + median lines from result rows.
// Each row is [hour, [p10,p50,p90], [p10,p50,p90]] where the first
// triplet is transit (above zero) and the second is wait (mirrored below).
// Returns {p10, p50, p90, areaD} — p10/p50/p90 are [x,y] point arrays
// for the transit percentile lines; areaD is a closed SVG path for the
// p10–p90 band (upper p90 forward, lower p10 reversed).
export function percentilePath(result) {
  if (!result || result.length === 0) {
    return { p10: [], p50: [], p90: [], areaD: '' };
  }

  const p10 = [];
  const p50 = [];
  const p90 = [];

  for (const [hour, transit, wait] of result) {
    p10.push([hour, transit[0]]);
    p50.push([hour, transit[1]]);
    p90.push([hour, transit[2]]);
  }

  // Closed band: forward along p90, reverse along p10
  const forward = p90.map((p) => `L${p[0]},${p[1]}`).join('');
  const reverse = p10.slice().reverse().map((p) => `L${p[0]},${p[1]}`).join('');
  const areaD = `M${p90[0][0]},${p90[0][1]}${forward}${reverse}Z`;

  return { p10, p50, p90, areaD };
}

// Downsample points to at most max entries by keeping every Nth point.
// MBTA iOS path approach: when points.length > max, keep every Nth point
// where N = ceil(points.length / max).
export function downsample(points, max = 1000) {
  if (!points || points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]);
  }
  return out;
}

// Brute-force nearest-point hit test within radius r (default 8 px).
// Returns the index of the closest point within r, or -1 if none.
export function nearestHit(cx, cy, points, r = 8) {
  if (!points || points.length === 0) return -1;
  const r2 = r * r;
  let bestIdx = -1;
  let bestDist2 = r2;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i][0] - cx;
    const dy = points[i][1] - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Parse a deep-link hash of the form #your-commute.<from>.<to>.
// Returns {from, to} or null if the hash does not match.
export function parseHash(hash) {
  if (typeof hash !== 'string') return null;
  const m = hash.match(/^#your-commute\.([A-Z]{3})\.([A-Z]{3})$/);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}
