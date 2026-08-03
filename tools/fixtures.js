// tools/fixtures.js — generate shape-correct placeholder data/ artifacts so the
// site builds, deploys and passes smoke tests before real Darwin data flows.
// Real data overwrites these via tools/etl/derive.js once credentials are wired.
// Corridor used in fixtures: all PoC lines from config/poc.json (eastern region).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
mkdirSync(DATA, { recursive: true });

// Load PoC config so fixtures match the eastern-region line set.
const poc = JSON.parse(readFileSync(join(ROOT, 'config/poc.json'), 'utf8'));

// Delete known artifact list first so re-runs are deterministic (no stale files).
const KNOWN_ARTIFACTS = [
  'marey-trips.json',
  'stations.json',
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

// ── stations.json ──────────────────────────────────────────────────
// Generate one placeholder station per CRS code in the PoC station set.
const STATIONS = poc.stationSet.crs.map((crs) => ({
  crs,
  name: crs,
  lat: 0,
  lon: 0,
  tiploc: crs,
  stanox: crs,
  usage: 0,
}));
writeJson('stations.json', STATIONS);

// ── network.json ───────────────────────────────────────────────────
// Build a network with all PoC lines, each containing all PoC stations.
// Positions are schematic (non-geographic): stops are laid out evenly
// along the corridor in x, one vertical band per line in y so the Marey
// chart / side map can distinguish services. Top-level stops use a
// single reference band. Shape matches tools/etl/derive.js output:
// lines[].stops[].{crs,x,y,name} and stops[].{crs,x,y,name}.
const stopNames = new Map(STATIONS.map((s) => [s.crs, s.name]));
const N = STATIONS.length;

// Per-line positions: x = order index along the line (the Marey chart
// spaces stations evenly by order, exactly like the exemplar's
// marey-header.json), y = one band per line so services can be told apart.
function orderPos(i, bandY) {
  return { x: i, y: Math.round((bandY + Math.sin(i / 25) * 15) * 100) / 100 };
}

// Top-level (map) positions: a schematic corridor S-curve with a usable
// aspect ratio for the map glyphs (~2:1, not a flat strip).
function corridorPos(i) {
  const x = N > 1 ? (i * 900) / (N - 1) : 0;
  const y = 300 + Math.sin(i / 10) * 150 + (i / (N - 1)) * 200;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

const lines = [];
const allSegments = [];
poc.lines.forEach((lineDef, lineIndex) => {
  const bandY = 60 + lineIndex * 55;
  const lineStops = STATIONS.map((s, i) => ({
    crs: s.crs,
    name: s.name,
    ...orderPos(i, bandY),
  }));
  const lineSegments = [];
  for (let i = 0; i < lineStops.length - 1; i++) {
    lineSegments.push({
      line: lineDef.id,
      from_crs: lineStops[i].crs,
      to_crs: lineStops[i + 1].crs,
      stations: [lineStops[i].crs, lineStops[i + 1].crs],
    });
    allSegments.push(lineSegments[lineSegments.length - 1]);
  }
  lines.push({
    id: lineDef.id,
    name: lineDef.name,
    color: lineDef.color,
    stops: lineStops,
    segments: lineSegments,
  });
});

const allStops = STATIONS.map((s, i) => ({
  crs: s.crs,
  name: s.name,
  ...corridorPos(i),
}));

const network = {
  lines,
  stops: allStops,
  segments: allSegments,
};
writeJson('network.json', network);

// ── schedules (one per PoC line) ───────────────────────────────────
function mins(h, m) { return h * 60 + m; }

const allSchedules = {};
for (const lineDef of poc.lines) {
  const schedule = [];
  const terminals = lineDef.terminals || [];
  const origin = terminals[0] || STATIONS[0].crs;
  const destination = terminals.length > 1 ? terminals[1] : STATIONS[STATIONS.length - 1].crs;

  for (let i = 1; i <= 3; i++) {
    schedule.push({
      uid: `${lineDef.id.toUpperCase()}-${String(i).padStart(3, '0')}`,
      headcode: `${lineDef.id.toUpperCase()}-${String(i).padStart(3, '0')}`,
      toc: lineDef.operators[0] || 'XX',
      stp: 'P',
      origin,
      destination,
      departures: [{ crs: origin, time: mins(6, 0) + i * 30 }],
      stops: allStops.map((s, idx) => ({
        crs: s.crs,
        planned_time: mins(6, 0) + i * 30 + idx * 5,
      })),
    });
  }
  allSchedules[lineDef.id] = schedule;
  writeJson(`schedule-${lineDef.id}.json`, schedule);
}

// ── marey trips (split per day+line) ──────────────────────────────
const TRIP_ANCHOR_EPOCH = 1743494400; // 2025-04-01T08:00Z

for (const lineDef of poc.lines) {
  const schedule = allSchedules[lineDef.id] || [];
  const dayTrips = schedule.map((s) => ({
    service: s.uid,
    line: lineDef.id,
    begin: TRIP_ANCHOR_EPOCH + 30,
    end: TRIP_ANCHOR_EPOCH + 1800 + 90,
    stops: s.stops.map((st) => ({
      stop: st.crs,
      time: TRIP_ANCHOR_EPOCH + 40 + (st.planned_time - mins(6, 0)) * 60,
    })),
  }));
  writeJson(`marey-trips-2025-04-01-${lineDef.id}.json`, dayTrips);
}

const mareyIndex = {
  days: [{
    date: '2025-04-01',
    lines: poc.lines.map((l) => ({ line: l.id, count: (allSchedules[l.id] || []).length })),
  }],
  lines: poc.lines.map((l) => ({ id: l.id, name: l.name, color: l.color })),
};
writeJson('marey-index.json', mareyIndex);

// ── live-delta.json ────────────────────────────────────────────────
writeJson('live-delta.json', { refreshed_at: 0, changed: [], removed: [] });

// ── station-frequency.json ─────────────────────────────────────────
const HOUR = 3600;
writeJson('station-frequency.json', {
  stops: STATIONS.map((s) => ({
    crs: s.crs,
    times: Array.from({ length: 24 }, (_, h) => ({ time: h * HOUR, arrivals: h >= 6 && h <= 9 ? 4 : 1, departures: h >= 6 && h <= 9 ? 4 : 1 })),
    averagesByType: { weekday: { arrivals: 2, departures: 2 }, offpeak: { arrivals: 1, departures: 1 } } })),
});

// ── station-usage.json ─────────────────────────────────────────────
// Entries/exits decay along the station list but never go negative.
writeJson('station-usage.json', {
  stations: STATIONS.map((s, i) => {
    const entries = Math.max(100, 8000000 - i * 39000);
    const exits = Math.max(50, 7800000 - i * 39000);
    return { crs: s.crs, name: s.name, entries, exits, interchange: i * 200000, total: entries + exits };
  }),
  max: 8000000, min: 100, mean: 3980000,
});

// ── delay.json ─────────────────────────────────────────────────────
const buckets = [];
for (let day = 0; day < 7; day++) {
  for (let b = 0; b < 96; b++) {
    const secOfDay = b * 900;
    const busy = (secOfDay >= 6 * 3600 && secOfDay <= 9 * 3600) || (secOfDay >= 16 * 3600 && secOfDay <= 19 * 3600);
    const lineDelays = {};
    const corridorKey = `${STATIONS[0].crs}|${STATIONS[STATIONS.length - 1].crs}`;
    for (const lineDef of poc.lines) {
      lineDelays[lineDef.id] = { delay_actual: { [corridorKey]: busy ? 240 : 60 }, ins_total: busy ? 5.3 : 0 };
    }
    buckets.push({
      day, secOfDay, time: 1743548400000 + day * 86400000 + secOfDay * 1000,
      ins: busy ? { [STATIONS[0].crs]: 3.2, [STATIONS[STATIONS.length - 1].crs]: 2.1 } : {},
      outs: busy ? { [STATIONS[0].crs]: 2.9, [STATIONS[STATIONS.length - 1].crs]: 2.4 } : {},
      ins_total: busy ? 5.3 : 0,
      lines: Object.values(lineDelays),
    });
  }
}
writeJson('delay.json', buckets);

// Average actual inter-station travel times, one entry per consecutive
// station pair in the corridor plus the full-corridor pair (the key the
// delay buckets use).  Shape matches the exemplar: {from|to: seconds}.
const avgDelays = {};
for (let i = 0; i < STATIONS.length - 1; i++) {
  avgDelays[`${STATIONS[i].crs}|${STATIONS[i + 1].crs}`] = 240 + (i % 6) * 60;
}
avgDelays[`${STATIONS[0].crs}|${STATIONS[STATIONS.length - 1].crs}`] = 3000;
writeJson('average-actual-delays.json', avgDelays);

// ── commute-<origin>.json (one per PoC commute origin) ─────────────
// Placeholder weekday rollups for a fixed set of eastern destinations;
// shape matches the exemplar's per-origin commute file ({dest: {result,
// actuals}}).  Destinations are real eastern stations, so the scatterplot
// renders for any pair picked on the map.
const COMMUTE_DESTS = ['SOS', 'CBG', 'ELY', 'IPS', 'NRW'];
for (const origin of poc.commuteOrigins) {
  const rollup = {};
  COMMUTE_DESTS.forEach((dest, k) => {
    rollup[dest] = {
      result: Array.from({ length: 18 }, (_, h) => [h + 5.5, [85 + k * 6, 97 + k * 6, 112 + k * 6], [2, 4, 9]]),
      actuals: [[6.5, 98 + k * 6, 3], [7.5, 105 + k * 6, 6], [8.5, 110 + k * 6, 8]],
    };
  });
  writeJson(`commute-${origin}.json`, rollup);
}

// ── live.json ──────────────────────────────────────────────────────
writeJson('live.json', {
  refreshed_at: new Date().toISOString(),
  trains: [
    { train_id: '515G531I24', headcode: '1A05', toc: poc.lines[0].operators[0], crs: STATIONS[1].crs, lat: 51.5080, lon: -0.0500, lateness_min: 3, status: 'ON TIME', platform: '9', origin: STATIONS[0].crs, destination: STATIONS[STATIONS.length - 1].crs },
    { train_id: '515G532I31', headcode: '1C22', toc: poc.lines[0].operators[0], crs: STATIONS[3].crs, lat: 51.5410, lon: 0.4300, lateness_min: 11, status: 'LATE', platform: '1', origin: STATIONS[0].crs, destination: STATIONS[STATIONS.length - 1].crs },
  ],
});

// ── toc.json ───────────────────────────────────────────────────────
writeJson('toc.json', poc.lines.map((l) => ({ toc: l.operators[0] || 'XX', name: l.name, colour: l.color })));

console.log('fixtures written to data/');
