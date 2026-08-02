// Pure helpers for the Marey diagram (M2). No DOM access — importable from
// both the browser renderer (src/js/marey.js) and node tests.
'use strict';

// Epoch seconds → minutes since midnight. Payloads carry UK wall-clock epochs
// (the ETL applies the BST fix per SPEC.md §6), so seconds-of-day is the time
// axis directly. Values may exceed 1440 when a service crosses midnight.
export function secOfDayMin(epochSec) {
  return (epochSec % 86400) / 60;
}

// Station index within a line segment (-1 when the CRS is not on the segment).
export function stationIndex(segStations, crs) {
  return segStations.indexOf(crs);
}

// Linear scale: domain [d0,d1] → range [r0,r1].
export function linScale(d0, d1, r0, r1) {
  return (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

// Equally-spaced y positions for n stations over [r0,r1]; index 0 at the top.
export function stationY(n, r0, r1) {
  return (i) => r0 + (i / (n - 1 || 1)) * (r1 - r0);
}

// Minutes-since-midnight → HH:MM (wraps past 24:00).
export function hhmm(min) {
  const m = Math.round(min);
  const h = ((Math.floor(m / 60) % 24) + 24) % 24;
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Map a trip's stops to chart points [x, y, crs], skipping stops not on the
// given line segment. x and y are the pre-built scale functions.
export function tripPoints(trip, segStations, x, y) {
  const pts = [];
  for (const st of trip.stops) {
    const i = stationIndex(segStations, st.stop);
    if (i < 0) continue;
    pts.push([x(secOfDayMin(st.time)), y(i), st.stop]);
  }
  return pts;
}
