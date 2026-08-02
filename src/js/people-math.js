// Pure helpers for "The People" (M3): station traffic heatmap, usage table,
// and schematic map. No DOM access — importable from browser and node tests.
'use strict';

// Hourly arrivals+departures total for one station (frequency payload).
export function freqTotal(stop) {
  return ((stop && stop.times) || []).reduce((s, t) => s + (t.arrivals || 0) + (t.departures || 0), 0);
}

// Stations sorted by total usage, descending.
export function usageSorted(stations) {
  return [...(stations || [])].sort((a, b) => (b.total || 0) - (a.total || 0));
}

// Heat color: v/max → hsl string, deep blue (low) → amber (high). Clamps v.
export function heatColor(v, max) {
  const t = max > 0 ? Math.min(Math.max(v / max, 0), 1) : 0;
  const h = 215 - 170 * t;   // hue 215 (blue) → 45 (amber)
  const s = 60 + 35 * t;     // saturation %
  const l = 22 + 38 * t;     // lightness %
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

// Bounding box of schematic station coords, padded (map viewBox).
export function nodeExtents(net) {
  const xs = (net.stops || []).map((s) => s.x);
  const ys = (net.stops || []).map((s) => s.y);
  if (!xs.length) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  const pad = 26;
  return {
    minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad,
    minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad,
  };
}

// Polyline path for a line segment through its stations.
export function linePath(seg, stopById) {
  const pts = (seg.stations || []).map((crs) => stopById.get(crs)).filter(Boolean);
  return pts.map((s, i) => `${i ? 'L' : 'M'}${s.x},${s.y}`).join('');
}
