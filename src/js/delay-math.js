// Pure helpers for the Congestion & Delay visualisation (M4).
// No DOM access — importable from both the browser renderer and node tests.
'use strict';

// Return the 96 buckets for a single day, sorted by secOfDay.
export function dayBuckets(delay, day) {
  return delay.filter((b) => b.day === day).sort((a, b) => a.secOfDay - b.secOfDay);
}

// Sum the per-CRS ins/outs maps of a single bucket into totals.
export function seriesTotals(bucket) {
  let ins = 0, outs = 0;
  if (bucket.ins) {
    for (const v of Object.values(bucket.ins)) ins += v;
  }
  if (bucket.outs) {
    for (const v of Object.values(bucket.outs)) outs += v;
  }
  return { ins, outs };
}

// Standard horizon technique: for each band produce a top and bottom
// area path so that positive and negative excursions are layered
// with mirror + clip. 3 bands → 6 layers (MBTA pattern).
// values: array of numbers (one per bucket), bandCount, h: band height in px.
export function horizonAreas(values, bandCount = 3, h = 40) {
  const n = values.length;
  const x = (i) => (i / (n - 1 || 1)) * 400;
  const areas = [];
  for (let band = 0; band < bandCount; band++) {
    const lo = band * h;
    const hi = (band + 1) * h;
    const topPts = values.map((v, i) => [x(i), Math.max(0, Math.min(hi, v)) - lo]);
    const botPts = values.map((v, i) => [x(i), Math.min(0, Math.max(-hi, v)) + lo]);
    areas.push([band, 'top', 'M' + topPts.map(([px, py]) => `${px},${py}`).join('L')]);
    areas.push([band, 'bottom', 'M' + botPts.map(([px, py]) => `${px},${py}`).join('L')]);
  }
  return areas;
}

// Map a delay ratio to a CSS rgb() colour: negative (fast) → green,
// 0 → white, +0.4 → red, clamped outside [-0.4, 0.4].
// Uses a 3-stop linear interpolation in RGB space (documented in
// lieu of Lab interpolation — see SPEC §2.3 audit note).
export function ratioColor(ratio) {
  const clamped = Math.max(-0.4, Math.min(0.4, ratio));
  const t = clamped / 0.4; // -1 … 0 … 1
  let r, g, b;
  if (t < 0) {
    // green ← white: t from -1 to 0
    const s = t + 1; // 0 … 1
    r = Math.round(255 * (1 - s));
    g = 255;
    b = Math.round(255 * (1 - s));
  } else {
    // white → red: t from 0 to 1
    const s = t;
    r = 255;
    g = Math.round(255 * (1 - s));
    b = Math.round(255 * (1 - s));
  }
  return `rgb(${r},${g},${b})`;
}

// Binary-search for the bucket whose secOfDay is nearest to tSec.
export function scrubAt(dayBuckets, tSec) {
  const buckets = dayBuckets;
  let lo = 0, hi = buckets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (buckets[mid].secOfDay < tSec) lo = mid + 1;
    else hi = mid;
  }
  // Check neighbour
  if (lo > 0) {
    const prev = buckets[lo - 1];
    const curr = buckets[lo];
    if (Math.abs(tSec - prev.secOfDay) < Math.abs(tSec - curr.secOfDay)) return prev;
  }
  return buckets[lo];
}
