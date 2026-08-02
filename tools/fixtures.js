// tools/fixtures.js — generate shape-correct placeholder data/ artifacts so the
// site builds, deploys and passes smoke tests before real Darwin data flows.
// Real data overwrites these via tools/etl/derive.js once credentials are wired.
// Corridor used in fixtures: GWML (Paddington → Bristol Temple Meads) — spec D1 default.
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
mkdirSync(DATA, { recursive: true });

// Delete known artifact list first so re-runs are deterministic (no stale files).
const KNOWN_ARTIFACTS = [
  'marey-trips.json',
  'stations.json',
  'schedule-gwml.json',
  'marey-index.json',
  'live-delta.json',
];
for (const name of KNOWN_ARTIFACTS) {
  const p = join(DATA, name);
  if (existsSync(p)) rmSync(p);
}

// Also remove any old day/line trip files from prior runs.
try {
  for (const f of readdirSync(DATA)) {
    if (/^marey-trips-/.test(f)) rmSync(join(DATA, f));
  }
} catch { /* directory may not exist yet */ }

function writeJson(name, obj) {
  writeFileSync(join(DATA, name), JSON.stringify(obj));
}

// ── stations.json ──────────────────────────────────────────────────────────
const STATIONS = [
  { crs: 'PAD', name: 'London Paddington', lat: 51.5168, lon: -0.1270, tiploc: 'PADTON', stanox: '9200PAD', usage: 8000000 },
  { crs: 'RDG', name: 'Reading', lat: 51.4593, lon: -0.9733, tiploc: 'RDG', stanox: '9200RDG', usage: 6500000 },
  { crs: 'DID', name: 'Didcot Parkway', lat: 51.6123, lon: -1.1447, tiploc: 'DIDCO', stanox: '9200DID', usage: 5000000 },
  { crs: 'SWI', name: 'Swindon', lat: 51.5612, lon: -1.7923, tiploc: 'SWIND', stanox: '9200SWI', usage: 3500000 },
  { crs: 'BTH', name: 'Bath Spa', lat: 51.3775, lon: -2.3569, tiploc: 'BATH', stanox: '9200BTH', usage: 2000000 },
  { crs: 'BRI', name: 'Bristol Temple Meads', lat: 51.4497, lon: -2.5819, tiploc: 'BRIST', stanox: '9200BRI', usage: 500000 },
];
writeJson('stations.json', STATIONS);

// ── network.json ───────────────────────────────────────────────────────────
const CORRIDOR = {
  line: 'gwml', name: 'Great Western Main Line', color: '#0a7d33',
  stops: STATIONS,
};
const network = {
  lines: [{ id: CORRIDOR.line, name: CORRIDOR.name, color: CORRIDOR.color }],
  stops: CORRIDOR.stops.map((s, i) => ({
    crs: s.crs, name: s.name,
    x: +(30 + (i * 16) + (-s.lon - 0.12) * 10).toFixed(1),
    y: +(30 + (51.5168 - s.lat) * 150).toFixed(1),
  })),
  segments: [{ line: CORRIDOR.line, stations: CORRIDOR.stops.map((s) => s.crs) }],
};
writeJson('network.json', network);

// ── schedule-gwml.json ─────────────────────────────────────────────────────
// §6.4 shape: each service {uid, headcode, toc, stp, origin, destination, departures:[{crs, time}], stops:[{crs, planned_time}]}
// times are integer minutes-since-midnight.
function mins(h, m) { return h * 60 + m; }
const schedule = [
  { uid: '1A01', headcode: '1A01', toc: 'GW', stp: 'P', origin: 'PAD', destination: 'BRI',
    departures: [{ crs: 'PAD', time: mins(6, 0) }],
    stops: [
      { crs: 'PAD', planned_time: mins(6, 0) },
      { crs: 'RDG', planned_time: mins(6, 48) },
      { crs: 'DID', planned_time: mins(6, 72) },
      { crs: 'SWI', planned_time: mins(6, 108) },
      { crs: 'BTH', planned_time: mins(6, 150) },
      { crs: 'BRI', planned_time: mins(6, 180) },
    ]},
  { uid: '1A01', headcode: '1A02', toc: 'GW', stp: 'P', origin: 'PAD', destination: 'BRI',
    departures: [{ crs: 'PAD', time: mins(7, 0) }],
    stops: [
      { crs: 'PAD', planned_time: mins(7, 0) },
      { crs: 'RDG', planned_time: mins(7, 48) },
      { crs: 'DID', planned_time: mins(7, 72) },
      { crs: 'SWI', planned_time: mins(7, 108) },
      { crs: 'BTH', planned_time: mins(7, 150) },
      { crs: 'BRI', planned_time: mins(7, 180) },
    ]},
  { uid: '1A01', headcode: '1A03', toc: 'GW', stp: 'P', origin: 'PAD', destination: 'BRI',
    departures: [{ crs: 'PAD', time: mins(8, 0) }],
    stops: [
      { crs: 'PAD', planned_time: mins(8, 0) },
      { crs: 'RDG', planned_time: mins(8, 48) },
      { crs: 'DID', planned_time: mins(8, 72) },
      { crs: 'SWI', planned_time: mins(8, 108) },
      { crs: 'BTH', planned_time: mins(8, 150) },
      { crs: 'BRI', planned_time: mins(8, 180) },
    ]},
];
writeJson('schedule-gwml.json', schedule);

// ── marey trips (split per day+line) ──────────────────────────────────────
const TRIP_ANCHOR_EPOCH = 1743494400; // 2025-04-01T08:00Z
const dayTrips = schedule.map((s) => ({
  service: s.uid,
  line: s.line || CORRIDOR.line,
  begin: TRIP_ANCHOR_EPOCH + 30,
  end: TRIP_ANCHOR_EPOCH + 1800 + 90,
  stops: s.stops.map((st) => ({ stop: st.crs, time: TRIP_ANCHOR_EPOCH + 40 + (st.planned_time - mins(6, 0)) * 60 + (st.crs === 'BRI' ? 90 : 0) })),
}));
writeJson('marey-trips-2025-04-01-gwml.json', dayTrips);

const mareyIndex = {
  days: [{ date: '2025-04-01', lines: [{ line: 'gwml', count: dayTrips.length }] }],
  lines: [{ id: 'gwml', name: 'Great Western Main Line', color: '#0a7d33' }],
};
writeJson('marey-index.json', mareyIndex);

// ── live-delta.json ────────────────────────────────────────────────────────
writeJson('live-delta.json', { refreshed_at: 0, changed: [], removed: [] });

// ── station-frequency.json ────────────────────────────────────────────────
const HOUR = 3600;
writeJson('station-frequency.json', {
  stops: CORRIDOR.stops.map((s) => ({
    crs: s.crs,
    times: Array.from({ length: 24 }, (_, h) => ({ time: h * HOUR, arrivals: h >= 6 && h <= 9 ? 4 : 1, departures: h >= 6 && h <= 9 ? 4 : 1 })),
    averagesByType: { weekday: { arrivals: 2, departures: 2 }, offpeak: { arrivals: 1, departures: 1 } },
  })),
});

// ── station-usage.json ────────────────────────────────────────────────────
writeJson('station-usage.json', {
  stations: CORRIDOR.stops.map((s, i) => ({ crs: s.crs, name: s.name, entries: 8000000 - i * 1500000, exits: 7800000 - i * 1500000, interchange: i * 200000, total: 15800000 - i * 3000000 })),
  max: 15800000, min: 800000, mean: 7900000,
});

// ── delay.json ────────────────────────────────────────────────────────────
const buckets = [];
for (let day = 0; day < 7; day++) {
  for (let b = 0; b < 96; b++) {
    const secOfDay = b * 900;
    const busy = (secOfDay >= 6 * 3600 && secOfDay <= 9 * 3600) || (secOfDay >= 16 * 3600 && secOfDay <= 19 * 3600);
    buckets.push({
      day, secOfDay, time: 1743548400000 + day * 86400000 + secOfDay * 1000,
      ins: busy ? { PAD: 3.2, BRI: 2.1 } : {}, outs: busy ? { PAD: 2.9, BRI: 2.4 } : {},
      ins_total: busy ? 5.3 : 0,
      lines: [{ line: CORRIDOR.line, delay_actual: { 'PAD|BRI': busy ? 240 : 60 }, ins_total: busy ? 5.3 : 0 }],
    });
  }
}
writeJson('delay.json', buckets);

writeJson('average-actual-delays.json', {
  'PAD|RDG': 1140, 'RDG|DID': 480, 'DID|SWI': 360, 'SWI|BTH': 540, 'BTH|BRI': 480, 'PAD|BRI': 3000,
});

// ── commute-PAD.json ──────────────────────────────────────────────────────
writeJson('commute-PAD.json', {
  BRI: {
    result: Array.from({ length: 18 }, (_, h) => [h + 5.5, [85, 97, 112], [2, 4, 9]]),
    actuals: [[6.5, 98, 3], [7.5, 105, 6], [8.5, 110, 8]],
  },
});

// ── live.json ─────────────────────────────────────────────────────────────
writeJson('live.json', {
  refreshed_at: new Date().toISOString(),
  trains: [
    { train_id: '515G531I24', headcode: '1A05', toc: 'GW', crs: 'RDG', lat: 51.4560, lon: -0.9721, lateness_min: 3, status: 'ON TIME', platform: '9', origin: 'PAD', destination: 'BRI' },
    { train_id: '515G532I31', headcode: '1C22', toc: 'GW', crs: 'SWI', lat: 51.5650, lon: -1.7840, lateness_min: 11, status: 'LATE', platform: '1', origin: 'PAD', destination: 'BRI' },
  ],
});

// ── toc.json ──────────────────────────────────────────────────────────────
writeJson('toc.json', [{ toc: 'GW', name: 'Great Western Railway', colour: '#0a7d33' }]);

console.log('fixtures written to data/');
