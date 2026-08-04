// tools/fixtures.js — generate shape-correct placeholder data/ artifacts so the
// site builds, deploys and passes smoke tests before real Darwin data flows.
// Real data overwrites these via tools/etl/derive.js once credentials are wired.
// Corridor used in fixtures: all PoC lines from config/poc.json (eastern region).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

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
  writeFileSync(join(DATA, name), JSON.stringify(obj) + '\n', 'utf8');
}

// ── stations.json ──────────────────────────────────────────
// Use real station names from the ref XML where available;
// fallback to CRS code.  Lat/lon are approximate eastern-UK
// coordinates (not real NaPTAN — that needs the M1
// NaPTAN join in derive.js).  Usage values are realistic
// placeholder distributions.
let refStationNames = {};
try {
  const refRaw = readFileSync(join(ROOT, 'raw', '20260802020500_ref_v99.xml.gz'), 'utf8');
  const refText = gunzipSync(refRaw).toString('utf8');
  const nameRe = /<LocationRef[^>]*crs="([^"]+)"[^>]*locname="([^"]+)"[^>]*\/>/g;
  let m;
  while ((m = nameRe.exec(refText)) !== null) {
    refStationNames[m[1]] = m[2];
  }
} catch (_) { /* ref XML not available — use CRS codes as names */ }

const STATIONS = poc.stationSet.crs.map((crs, i) => {
  const name = refStationNames[crs] || crs;
  // Deterministic approximate eastern-UK coordinates based on index.
  const lat = 51.5 + (i % 10) * 0.01;
  const lon = -0.1 + (i % 20) * 0.005;
  const usage = 500000 + (i * 7913) % 8000000;
  return { crs, name, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, tiploc: crs + 'A', stanox: crs + '1', usage };
});
writeJson('stations.json', STATIONS);

// ── network.json ───────────────────────────────────────────
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

// ── schedules (one per PoC line) ───────────────────────────
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

// ── marey trips (split per day+line) ──────────────────────
// Each trip has a varied stop sequence (not all 202 stops) and a
// realistic duration (30–90 min for the PoC corridor length).
const TRIP_ANCHOR_EPOCH = 1743494400; // 2025-04-01T08:00Z

for (const lineDef of poc.lines) {
  const schedule = allSchedules[lineDef.id] || [];
  const dayTrips = schedule.map((s, tripIdx) => {
    // Vary the stop subset per trip: each trip covers a different
    // subset of stations (simulating different route patterns).
    const stopSubset = s.stops.filter((_, idx) => {
      // Include every station but vary the start/end points per trip
      return idx >= tripIdx * 20 && idx < s.stops.length - tripIdx * 10;
    });
    const tripStart = TRIP_ANCHOR_EPOCH + 30 + tripIdx * 600; // stagger start times
    const tripDuration = 1800 + tripIdx * 300; // 30–45 min base + variation
    return {
      service: s.uid,
      line: lineDef.id,
      begin: tripStart,
      end: tripStart + tripDuration,
      stops: stopSubset.map((st, idx) => ({
        stop: st.crs,
        time: tripStart + Math.round((idx / Math.max(stopSubset.length - 1, 1)) * tripDuration),
      })),
    };
  });
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

// ── live-delta.json ────────────────────────────────────────
writeJson('live-delta.json', { refreshed_at: 0, changed: [], removed: [] });

// ── station-frequency.json ─────────────────────────────────
// Varied per-stop time series: major London terminals have high
// frequency (10–20/hr), suburban stations have lower frequency
// (2–8/hr).  Each stop gets a unique pattern based on its index.
const HOUR = 3600;
writeJson('station-frequency.json', {
  stops: STATIONS.map((s, i) => {
    // Station type determines frequency profile:
    //  - London terminals (first 5): high frequency all day
    //  - Major interchanges (next 10): high frequency peak only
    //  - Suburban (rest): low frequency, peak-only service
    const isTerminal = i < 5;
    const isMajor = i >= 5 && i < 15;
    const isSuburban = i >= 15;
    const times = Array.from({ length: 24 }, (_, h) => {
      let arrivals, departures;
      if (isTerminal) {
        // Terminals: 8–12/hr all day, 12–16/hr peak
        arrivals = (h >= 6 && h <= 9) || (h >= 16 && h <= 19) ? 12 + Math.floor(Math.random() * 4) : 8 + Math.floor(Math.random() * 4);
        departures = arrivals;
      } else if (isMajor) {
        // Major: 6–10/hr peak, 2–4/hr off-peak
        arrivals = (h >= 7 && h <= 9) || (h >= 17 && h <= 19) ? 8 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 2);
        departures = arrivals;
      } else {
        // Suburban: 4–8/hr peak, 1–2/hr off-peak
        arrivals = (h >= 7 && h <= 9) || (h >= 17 && h <= 19) ? 6 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
        departures = arrivals;
      }
      return { time: h * HOUR, arrivals, departures };
    });
    // averagesByType varies per station based on its profile
    const peakArr = isTerminal ? 12 : isMajor ? 8 : 6;
    const peakDep = isTerminal ? 12 : isMajor ? 8 : 6;
    const offpeakArr = isTerminal ? 8 : isMajor ? 3 : 1;
    const offpeakDep = isTerminal ? 8 : isMajor ? 3 : 1;
    return {
      crs: s.crs,
      times,
      averagesByType: {
        weekday: { arrivals: peakArr, departures: peakDep },
        offpeak: { arrivals: offpeakArr, departures: offpeakDep },
      },
    };
  }),
});

// ── station-usage.json ─────────────────────────────────────
// Entries/exits/interchange are realistic: interchange is always
// less than total (entries + exits + interchange).  max/min/mean
// are computed from the actual `total` field.
const usageStations = STATIONS.map((s, i) => {
  // Usage decays along the station list (major terminals first).
  const entries = Math.max(100000, 8000000 - i * 39000);
  const exits = Math.max(50000, 7800000 - i * 39000);
  // Interchange is a small fraction of total (2–5%).
  const interchange = Math.round((entries + exits) * (0.02 + (i % 5) * 0.005));
  const total = entries + exits + interchange;
  return { crs: s.crs, name: s.name, entries, exits, interchange, total };
});
usageStations.sort((a, b) => b.total - a.total);
const usageTotals = usageStations.map((s) => s.total);
const usageMax = Math.max(...usageTotals);
const usageMin = Math.min(...usageTotals);
const usageMean = Math.round(usageTotals.reduce((a, b) => a + b, 0) / usageTotals.length);
writeJson('station-usage.json', { stations: usageStations, max: usageMax, min: usageMin, mean: usageMean });

// ── delay.json ─────────────────────────────────────────────
// 7 days × 96 15-min buckets.  ins/outs use integer service counts
// (not float delays).  Each line gets its own entry with a unique
// delay_actual ratio.  ins_total is consistent across line entries
// for the same bucket.
const buckets = [];
const lineIds = poc.lines.map((l) => l.id);
const corridorKey = `${STATIONS[0].crs}|${STATIONS[STATIONS.length - 1].crs}`;

for (let day = 0; day < 7; day++) {
  for (let b = 0; b < 96; b++) {
    const secOfDay = b * 900;
    const busy = (secOfDay >= 6 * 3600 && secOfDay <= 9 * 3600) || (secOfDay >= 16 * 3600 && secOfDay <= 19 * 3600);
    const insTotal = busy ? 45 + Math.floor(Math.random() * 10) : 5 + Math.floor(Math.random() * 3);
    const ins = {};
    const outs = {};
    // Populate ins/outs for a few stations per bucket (not all 202).
    const stationIndices = [0, 1, Math.floor(N / 2), N - 1];
    for (const idx of stationIndices) {
      if (busy) {
        ins[STATIONS[idx].crs] = Math.floor(insTotal / stationIndices.length) + (idx === 0 ? insTotal % stationIndices.length : 0);
        outs[STATIONS[idx].crs] = Math.floor(insTotal / stationIndices.length) + (idx === N - 1 ? insTotal % stationIndices.length : 0);
      }
    }
    // Each line gets a unique delay_actual ratio (relative: -0.2 = 20% faster, 0 = on time, 0.4 = 40% slower).
    const lineEntries = lineIds.map((lineId, li) => {
      const delayRatio = busy
        ? Math.round((-0.1 + li * 0.08 + Math.random() * 0.05) * 100) / 100
        : Math.round((0.1 + li * 0.05 + Math.random() * 0.03) * 100) / 100;
      return {
        line: lineId,
        delay_actual: { [corridorKey]: delayRatio },
        ins_total: insTotal,
      };
    });
    const avgDelay = lineEntries.reduce((sum, l) => {
      const vals = Object.values(l.delay_actual);
      return sum + (vals.length ? vals[0] : 0);
    }, 0) / lineEntries.length;
    buckets.push({
      day, secOfDay, time: 1743548400000 + day * 86400000 + secOfDay * 1000,
      ins, outs, ins_total: insTotal,
      delay_actual: Math.round(avgDelay * 100) / 100,
      lines: lineEntries,
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

// ── commute-<origin>.json (one per PoC commute origin) ─────
// Each origin gets unique data with correct structure:
// {dest: {result: [[hour, [p10,p50,p90 transit], [p10,p50,p90 wait]], ...],
//         actuals: [[hour, transit, wait], ...]}}
// 24 hours (0–23) for both result and actuals.
const COMMUTE_DESTS = ['SOS', 'CBG', 'ELY', 'IPS', 'NRW'];
for (const origin of poc.commuteOrigins) {
  const originIdx = poc.commuteOrigins.indexOf(origin);
  const rollup = {};
  COMMUTE_DESTS.forEach((dest, k) => {
    // Each destination has unique percentile bands per hour.
    const result = Array.from({ length: 24 }, (_, h) => {
      const baseTransit = 60 + k * 15 + originIdx * 10 + h * 2;
      const baseWait = 2 + k + originIdx;
      return [
        h,
        [Math.round(baseTransit * 0.85), Math.round(baseTransit), Math.round(baseTransit * 1.15)],
        [Math.round(baseWait * 0.8), Math.round(baseWait), Math.round(baseWait * 1.2)],
      ];
    });
    const actuals = Array.from({ length: 24 }, (_, h) => {
      const transit = 55 + k * 14 + originIdx * 9 + h * 2;
      const wait = 2 + k + originIdx;
      return [h, transit, wait];
    });
    rollup[dest] = { result, actuals };
  });
  writeJson(`commute-${origin}.json`, rollup);
}

// ── live.json ──────────────────────────────────────────────
writeJson('live.json', {
  refreshed_at: new Date().toISOString(),
  trains: [
    { train_id: '515G531I24', headcode: '1A05', toc: poc.lines[0].operators[0], crs: STATIONS[1].crs, lat: 51.5080, lon: -0.0500, lateness_min: 3, status: 'ON TIME', platform: '9', origin: STATIONS[0].crs, destination: STATIONS[STATIONS.length - 1].crs },
    { train_id: '515G532I31', headcode: '1C22', toc: poc.lines[0].operators[0], crs: STATIONS[3].crs, lat: 51.5410, lon: 0.4300, lateness_min: 11, status: 'LATE', platform: '1', origin: STATIONS[0].crs, destination: STATIONS[STATIONS.length - 1].crs },
  ],
});

// ── toc.json ───────────────────────────────────────────────
writeJson('toc.json', poc.lines.map((l) => ({ toc: l.operators[0] || 'XX', name: l.name, colour: l.color })));

console.log('fixtures written to data/');
