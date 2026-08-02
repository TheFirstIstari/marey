// tools/fixtures.js — generate shape-correct placeholder data/ artifacts so the
// site builds, deploys and passes smoke tests before real Darwin data flows.
// Real data overwrites these via tools/etl/derive.js once credentials are wired.
// Corridor used in fixtures: GWML (Paddington → Bristol Temple Meads) — spec D1 default.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
mkdirSync(DATA, { recursive: true });

const CORRIDOR = {
  line: 'gwml', name: 'Great Western Main Line', color: '#0F4C81',
  stops: [
    { crs: 'PAD', name: 'London Paddington', lat: 51.5171, lon: -0.1762 },
    { crs: 'RDG', name: 'Reading', lat: 51.4597, lon: -0.9711 },
    { crs: 'DID', name: 'Didcot Parkway', lat: 51.6111, lon: -1.2425 },
    { crs: 'SWI', name: 'Swindon', lat: 51.5657, lon: -1.7851 },
    { crs: 'BATH', name: 'Bath Spa', lat: 51.3775, lon: -2.3565 },
    { crs: 'BRI', name: 'Bristol Temple Meads', lat: 51.4493, lon: -2.5812 },
  ],
};

// network.json — lines + stops + segments (schematic coords: GWML runs roughly
// west-southwest of London, so x grows with -lon and y grows with southern lat)
const network = {
  lines: [{ id: CORRIDOR.line, name: CORRIDOR.name, color: CORRIDOR.color }],
  stops: CORRIDOR.stops.map((s, i) => ({
    crs: s.crs, name: s.name,
    x: +(30 + (i * 16) + (-s.lon - 0.17) * 10).toFixed(1),
    y: +(30 + (51.5171 - s.lat) * 150).toFixed(1),
  })),
  segments: [{ line: CORRIDOR.line, stations: CORRIDOR.stops.map((s) => s.crs) }],
};
writeJson('network.json', network);

// schedule-gwml.json — a few planned services
const HOUR = 3600;
const planned = [];
for (let h = 6; h <= 8; h++) {
  planned.push(service('1A01', `1A0${h}`, 'PAD', 'BRI', [h * HOUR, h * HOUR + 8 * 60, h * HOUR + 12 * 60, h * HOUR + 18 * 60, h * HOUR + 25 * 60, h * HOUR + 30 * 60]));
}
function service(uid, headcode, origin, destination, secs) {
  const t0 = 1743494400; // 2025-04-01T08:00Z anchor (epochs are illustrative in fixtures)
  return {
    uid, headcode, toc: 'GW', stp: 'P', origin, destination, line: CORRIDOR.line,
    stops: CORRIDOR.stops.map((s, i) => ({ crs: s.crs, t: t0 + secs[i] })),
  };
}
writeJson('schedule-gwml.json', planned);

// marey-trips.json — actual trajectories (one per planned service, slightly delayed)
writeJson('marey-trips.json', planned.map((s) => ({
  service: s.uid, line: s.line, begin: s.stops[0].t + 30, end: s.stops.at(-1).t + 90,
  stops: s.stops.map((st) => ({ stop: st.crs, time: st.t + 40 + (st.crs === 'BRI' ? 90 : 0) })),
})));

// station-frequency.json — hourly arrivals/departures per station (proxy metric)
writeJson('station-frequency.json', {
  stops: CORRIDOR.stops.map((s) => ({
    crs: s.crs,
    times: Array.from({ length: 24 }, (_, h) => ({ time: h * HOUR, arrivals: h >= 6 && h <= 9 ? 4 : 1, departures: h >= 6 && h <= 9 ? 4 : 1 })),
    averagesByType: { weekday: { arrivals: 2, departures: 2 }, offpeak: { arrivals: 1, departures: 1 } },
  })),
});

// station-usage.json — ORR-style annual usage (fixture values)
writeJson('station-usage.json', {
  stations: CORRIDOR.stops.map((s, i) => ({ crs: s.crs, name: s.name, entries: 8000000 - i * 1500000, exits: 7800000 - i * 1500000, interchange: i * 200000, total: 15800000 - i * 3000000 })),
  max: 15800000, min: 800000, mean: 7900000,
});

// delay.json — 7 days × 96 15-min buckets (the 7×96 shape the smoke test requires)
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
  'PAD|RDG': 1140, 'RDG|DID': 480, 'DID|SWI': 360, 'SWI|BATH': 540, 'BATH|BRI': 480, 'PAD|BRI': 3000,
});

// commute-PAD.json — per-origin percentile rollup (destination-keyed)
writeJson('commute-PAD.json', {
  BRI: {
    result: Array.from({ length: 18 }, (_, h) => [h + 5.5, [85, 97, 112], [2, 4, 9]]),
    actuals: [[6.5, 98, 3], [7.5, 105, 6], [8.5, 110, 8]],
  },
});

// live.json — the smoke test requires ≥1 train
writeJson('live.json', {
  refreshed_at: new Date().toISOString(),
  trains: [
    { train_id: '515G531I24', headcode: '1A05', toc: 'GW', crs: 'RDG', lat: 51.4560, lon: -0.9721, lateness_min: 3, status: 'ON TIME', platform: '9', origin: 'PAD', destination: 'BRI' },
    { train_id: '515G532I31', headcode: '1C22', toc: 'GW', crs: 'SWI', lat: 51.5650, lon: -1.7840, lateness_min: 11, status: 'LATE', platform: '1', origin: 'PAD', destination: 'BRI' },
  ],
});

writeJson('toc.json', [{ toc: 'GW', name: 'Great Western Railway', colour: '#0F4C81' }]);
console.log('fixtures written to data/');

function writeJson(name, obj) {
  writeFileSync(join(DATA, name), JSON.stringify(obj));
}
