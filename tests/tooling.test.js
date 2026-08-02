// Tooling-level checks, run AFTER `npm run fixtures` (see package.json test
// script): budgets.json must be well-formed, and the fixture pipeline must
// produce the exact shapes the smoke test and the §8 budget enforce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secOfDayMin, hhmm, linScale, stationY, stationIndex, tripPoints, pickDayLines } from '../src/js/marey-math.js';
import { heatColor, freqTotal, usageSorted, nodeExtents, linePath, stationDetail } from '../src/js/people-math.js';
import { LOAD_PLAN } from '../src/js/dataloader.js';
import { dayBuckets, seriesTotals, horizonAreas, ratioColor, scrubAt } from '../src/js/delay-math.js';
import { percentilePath, downsample, nearestHit, parseHash } from '../src/js/commute-math.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const HASH_RE = /^[a-f0-9]{8}$/;

function readJson(rel) {
  const p = join(ROOT, rel);
  assert.ok(existsSync(p), `expected ${rel} to exist (run npm run fixtures first)`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

test('budgets.json is well-formed and coherent', () => {
  const b = readJson('budgets.json');
  assert.equal(typeof b.totalMaxBytes, 'number');
  assert.ok(b.totalMaxBytes > 0, 'totalMaxBytes must be positive');
  assert.equal(typeof b.firstVisitTargetBytes, 'number');
  assert.ok(Array.isArray(b.artifacts) && b.artifacts.length > 0, 'artifacts must be a non-empty array');
  for (const a of b.artifacts) {
    assert.equal(typeof a.match, 'string');
    assert.equal(typeof a.maxBytes, 'number');
    assert.ok(a.maxBytes > 0, `budget for ${a.match} must be positive`);
  }
});

test('delay.json is exactly 7 days × 96 buckets = 672', () => {
  const delay = readJson('data/delay.json');
  assert.equal(delay.length, 672, 'must have 7×96 = 672 buckets');
  const days = new Set(delay.map((b) => b.day));
  assert.deepEqual([...days].sort(), [0, 1, 2, 3, 4, 5, 6], 'all 7 days present');
  const seconds = delay.map((b) => b.secOfDay);
  assert.equal(new Set(seconds).size, 96, '96 unique 15-minute buckets per day');
  for (const b of delay) {
    assert.ok(b.ins && typeof b.ins === 'object' && !Array.isArray(b.ins), 'ins is a station map');
    assert.ok(b.outs && typeof b.outs === 'object' && !Array.isArray(b.outs), 'outs is a station map');
    assert.equal(typeof b.ins_total, 'number', 'ins_total is the numeric total');
  }
});

test('live.json has at least one train with position fields', () => {
  const live = readJson('data/live.json');
  assert.ok(Array.isArray(live.trains) && live.trains.length >= 1, 'at least 1 train');
  const t = live.trains[0];
  for (const key of ['train_id', 'lat', 'lon', 'lateness_min', 'origin', 'destination']) {
    assert.ok(key in t, `train record has ${key}`);
  }
});

test('marey trips are split per day+line with an index', () => {
  const idx = readJson('data/marey-index.json');
  assert.ok(idx.days.length >= 1);
  assert.ok(idx.lines.length >= 1);
  for (const day of idx.days) {
    for (const line of day.lines) {
      const f = `data/marey-trips-${day.date}-${line.line}.json`;
      const trips = readJson(f);
      assert.ok(Array.isArray(trips) && trips.length >= 1, `${f} non-empty`);
      for (const trip of trips) {
        assert.ok(trip.service && trip.line, 'trip has service and line');
        assert.ok(Array.isArray(trip.stops) && trip.stops.length >= 2, 'trip has ≥2 stops');
        assert.ok(trip.begin < trip.end, 'trip.begin < trip.end');
        assert.ok(trip.begin > 1e9, 'plausible epoch timestamp');
      }
    }
  }
});

test('index.html references only assets that exist in src/', () => {
  const html = readFileSync(join(ROOT, 'src/index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, 'page references at least css + js');
  for (const ref of refs) {
    if (ref.startsWith('http')) continue; // attribution/licensing external links allowed
    const stripped = join(ROOT, 'src', ref.replace(/^assets\//, ''));
    const raw = join(ROOT, 'src', ref);
    assert.ok(existsSync(stripped) || existsSync(raw), `referenced file exists in src/: ${ref}`);
  }
});

test('marey math helpers behave', () => {
  assert.equal(secOfDayMin(1743494400), 480, 'fixture anchor is 08:00 UTC');
  assert.equal(hhmm(0), '00:00');
  assert.equal(hhmm(480), '08:00');
  assert.equal(hhmm(1380), '23:00');
  assert.equal(hhmm(1439), '23:59');
  assert.equal(hhmm(1740), '05:00', 'wraps past midnight');
  assert.equal(stationIndex(['PAD', 'RDG', 'DID'], 'RDG'), 1);
  assert.equal(stationIndex(['PAD', 'RDG'], 'BRI'), -1);

  const x = linScale(0, 100, 0, 200);
  assert.equal(x(0), 0);
  assert.equal(x(50), 100);
  assert.equal(x(100), 200);
  const y = stationY(3, 10, 40);
  assert.equal(y(0), 10);
  assert.equal(y(2), 40);

  const trip = {
    begin: 1743548400,
    end: 1743577200,
    stops: [{ stop: 'PAD', time: 1743548400 }, { stop: 'BRI', time: 1743577200 }, { stop: 'ZZZ', time: 1743552000 }],
  };
  const pts = tripPoints(trip, ['PAD', 'BRI'], x, y);
  assert.equal(pts.length, 2, 'off-segment stop skipped');
  assert.deepEqual(pts[0], [x(secOfDayMin(1743548400)), y(0), 'PAD']);
  assert.deepEqual(pts[1], [x(secOfDayMin(1743577200)), y(1), 'BRI']);
});

test('pickDayLines resolves the index into per-line files', () => {
  const idx = { days: [{ date: '2025-04-01', lines: [{ line: 'gwml', count: 12 }] }], lines: [{ id: 'gwml' }] };
  const out = pickDayLines(idx, '2025-04-01');
  assert.deepEqual(out, [{ line: 'gwml', file: 'data/marey-trips-2025-04-01-gwml.json', tripCount: 12 }]);
});

test('people math: heatColor ramps blue→amber and clamps', () => {
  const low = heatColor(0, 100);
  const high = heatColor(100, 100);
  assert.notEqual(low, high, 'low and high map to different colors');
  assert.match(low, /^hsl\(/);
  assert.match(high, /^hsl\(/);
  assert.equal(heatColor(500, 100), high, 'clamps above max');
  assert.equal(heatColor(-5, 100), low, 'clamps below 0');
  assert.equal(heatColor(10, 0), low, 'degenerate max falls back to low');
});

test('people math: freqTotal sums arrivals+departures', () => {
  assert.equal(
    freqTotal({ times: [{ arrivals: 4, departures: 4 }, { arrivals: 1, departures: 2 }] }),
    11,
  );
  assert.equal(freqTotal({}), 0);
  assert.equal(freqTotal(null), 0);
});

test('people math: usageSorted orders by total descending', () => {
  const sorted = usageSorted([
    { crs: 'A', total: 5 },
    { crs: 'B', total: 20 },
    { crs: 'C', total: 0 },
    { crs: 'D' },
  ]);
  assert.deepEqual(sorted.map((s) => s.crs), ['B', 'A', 'C', 'D'], 'missing total treated as 0');
  assert.deepEqual(usageSorted(null), [], 'null input is an empty list');
});

test('build hashes assets and index.html references the hashed names', () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'dist/index.html missing');
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'expected asset references in dist/index.html');
  for (const ref of refs) {
    const parts = ref.split('/');
    const file = parts.at(-1);
    const base = file.split('.')[0];
    const hash = file.split('.')[1];
    assert.match(hash, HASH_RE, `${ref} has no 8-hex content hash`);
    assert.ok(existsSync(join(DIST, ...parts)), `${ref} missing from dist`);
    // same basename must not appear un-hashed anywhere in dist/index.html
    assert.ok(!html.includes(`${base}.js`) && !html.includes(`${base}.css`),
      `un-hashed reference to ${base} remains`);
  }
});

test('people math: fixture-derived values (PAD hourly total, network extents, line path)', () => {
  const freq = readJson('data/station-frequency.json');
  assert.equal(freqTotal(freq.stops[0]), 72, 'PAD = 4 busy hours ×8 + 20 quiet hours ×2');

  const net = readJson('data/network.json');
  const ext = nodeExtents(net);
  assert.ok(ext.maxX > ext.minX && ext.maxY > ext.minY, 'non-degenerate viewBox');
  const stopById = new Map(net.stops.map((s) => [s.crs, s]));
  const seg = net.segments[0];
  const path = linePath(seg, stopById);
  assert.ok(path.startsWith('M'), 'path starts with a move');
  assert.ok(path.includes('L'), 'path has line segments');
  assert.equal((path.match(/L/g) || []).length, seg.stations.length - 1, 'one L per station hop');
});

// --- T5.1: stationDetail ---

test('people math: stationDetail returns 24 hourly rows with arrivals/departures', () => {
  const freq = { stops: [{ crs: 'PAD', times: [
    { time: 0, arrivals: 2, departures: 3 },
    ...Array.from({ length: 23 }, (_, i) => ({ time: (i + 1) * 3600, arrivals: 0, departures: 0 })),
  ] }] };
  const d = stationDetail('PAD', freq);
  assert.equal(d.hours.length, 24, '24 hourly entries');
  assert.equal(d.hours[0].arrivals, 2, 'first hour arrivals');
  assert.equal(d.hours[0].departures, 3, 'first hour departures');
  assert.equal(d.hours[1].arrivals, 0, 'second hour arrivals');
  assert.ok(Array.isArray(d.hours), 'hours is an array');
  for (const h of d.hours) {
    assert.ok('hour' in h, 'each hour has hour field');
    assert.ok('arrivals' in h, 'each hour has arrivals field');
    assert.ok('departures' in h, 'each hour has departures field');
  }
});

test('people math: stationDetail weekdayAvg and offpeakAvg from averagesByType', () => {
  const freq = { stops: [{ crs: 'PAD', times: [
    { time: 0, arrivals: 1, departures: 1 },
    ...Array.from({ length: 23 }, (_, i) => ({ time: (i + 1) * 3600, arrivals: 0, departures: 0 })),
  ], weekdayHours: 12, offpeakHours: 12,
    averagesByType: { weekday: { arrivals: 5, departures: 4 }, offpeak: { arrivals: 1, departures: 1 } } }] };
  const d = stationDetail('PAD', freq);
  assert.equal(d.weekdayAvg, 9, 'weekdayAvg = arrivals + departures');
  assert.equal(d.offpeakAvg, 2, 'offpeakAvg = arrivals + departures');
});

test('people math: stationDetail returns zero for missing station', () => {
  const freq = { stops: [{ crs: 'PAD', times: [] }] };
  const d = stationDetail('MISSING', freq);
  assert.equal(d.hours.length, 24);
  assert.equal(d.weekdayAvg, 0);
  assert.equal(d.offpeakAvg, 0);
});

test('LOAD_PLAN covers every §6.4 artifact with no duplicates', () => {
  const urls = new Set();
  for (const [, u] of LOAD_PLAN.common) assert.ok(!urls.has(u) && urls.add(u));
  for (const key of ['marey', 'usage', 'delay', 'commute', 'live']) {
    assert.ok(Array.isArray(LOAD_PLAN.sections[key]), `${key} section plan`);
    for (const [, u] of LOAD_PLAN.sections[key]) assert.ok(!urls.has(u) && urls.add(u));
  }
  assert.ok(LOAD_PLAN.common.some(([k]) => k === 'stations'));
  assert.ok(LOAD_PLAN.common.some(([k]) => k === 'toc'));
    assert.ok(LOAD_PLAN.sections.marey.some(([k]) => k === 'index'), 'marey section has index');
});

// --- T5.1: delay-math helpers ---

function makeDelay() {
  const out = [];
  for (let day = 0; day < 7; day++) {
    for (let i = 0; i < 96; i++) {
      const sec = i * 900;
      const crs = i % 2 === 0 ? 'PAD' : 'RDG';
      const ins = { [crs]: i === 0 ? 2 : i % 3 + 1 };
      const outs = { [crs]: i === 0 ? 1 : i % 2 + 1 };
      const delay = { day, secOfDay: sec, time: 0, ins, outs, ins_total: ins[crs], lines: [] };
      if (i > 0 && i < 95) {
        delay.lines = [{ line: 'gwml', delay_actual: { 'PAD|RDG': (Math.sin(i / 8) * 10 + 12) / 60 }, ins_total: ins[crs] }];
      }
      out.push(delay);
    }
  }
  return out;
}

test('dayBuckets slices 96 buckets for one day and seriesTotals sums stations', () => {
  const delay = makeDelay();
  const b = dayBuckets(delay, 0);
  assert.equal(b.length, 96);
  assert.equal(seriesTotals(b[0]).ins, 2);
  assert.equal(seriesTotals(b[0]).outs, 1);
  const b1 = dayBuckets(delay, 1);
  assert.equal(b1.length, 96);
  assert.equal(b1[0].secOfDay, 0);
  assert.equal(b1[95].secOfDay, 86400 - 900);
});

test('horizonAreas returns bandCount*2 area strings', () => {
  const values = Array.from({ length: 96 }, (_, i) => Math.sin(i / 8) * 10 + 12);
  const areas = horizonAreas(values, 3, 40);
  assert.equal(areas.length, 6);
  assert.ok(areas.every((a) => Array.isArray(a) && a.length === 3));
  assert.ok(areas.every(([band]) => band >= 0 && band <= 3));
  assert.ok(areas.every(([, , d]) => typeof d === 'string' && d.startsWith('M')));
});

test('ratioColor clamps and maps sign', () => {
  assert.ok(ratioColor(-0.3).startsWith('rgb'), 'negative → greenish');
  assert.ok(ratioColor(0.4).startsWith('rgb'), '+0.4 → reddish');
  assert.equal(ratioColor(0), 'rgb(255,255,255)', 'zero → white');
  assert.ok(ratioColor(-1).startsWith('rgb'), 'clamped negative');
  assert.ok(ratioColor(1).startsWith('rgb'), 'clamped positive');
});

test('scrubAt binary-searches the nearest bucket', () => {
  const buckets = dayBuckets(makeDelay(), 1);
  const hit = scrubAt(buckets, 900 * 4.2);
  assert.ok(Math.abs(hit.secOfDay - 900 * 4) <= 900, 'nearest bucket found');
  const exact = scrubAt(buckets, 900 * 10);
    assert.equal(exact.secOfDay, 900 * 10, 'exact match');
});

// --- T6.1: commute-math.js helpers ---

test('percentilePath builds band + median from result rows', () => {
  const result = [[5, [10, 20, 30], [2, 4, 6]], [6, [12, 22, 32], [3, 5, 7]]];
  const p = percentilePath(result);
  assert.ok(p.areaD.startsWith('M') && p.areaD.endsWith('Z'), 'areaD is a closed path');
  assert.equal(p.p50.length, result.length, 'p50 has one point per result row');
  assert.equal(p.p10.length, result.length, 'p10 has one point per result row');
  assert.equal(p.p90.length, result.length, 'p90 has one point per result row');
});

test('downsample caps length at max', () => {
  const pts = Array.from({ length: 5000 }, (_, i) => [i, i % 100]);
  assert.ok(downsample(pts, 1000).length <= 1000);
  assert.equal(downsample(pts, 1000).length, 1000, 'keeps exactly max when oversampled');
  assert.equal(downsample(pts, 5000).length, 5000, 'no downsampling when under max');
  assert.equal(downsample([], 1000).length, 0, 'empty input gives empty output');
});

test('nearestHit finds the closest point within radius', () => {
  const pts = [[0, 0], [100, 100], [200, 0]];
  assert.equal(nearestHit(98, 99, pts, 8), 1, 'finds point within radius');
  assert.equal(nearestHit(500, 500, pts, 8), -1, 'returns -1 when no point in radius');
  assert.equal(nearestHit(0, 0, pts, 8), 0, 'finds point at exact location');
  assert.equal(nearestHit(0, 0, pts, 0), -1, 'radius 0 misses unless exact');
});

test('parseHash handles #your-commute.FST.LST', () => {
  assert.deepEqual(parseHash('#your-commute.FST.LST'), { from: 'FST', to: 'LST' });
  assert.deepEqual(parseHash('#your-commute.PAD.BRI'), { from: 'PAD', to: 'BRI' });
  assert.equal(parseHash('#trains'), null);
  assert.equal(parseHash('#your-commute.FST'), null);
  assert.equal(parseHash(''), null);
  assert.equal(parseHash(null), null);
});

// --- T6.1: live-math.js applyDelta ---

import { applyDelta } from '../src/js/live-math.js';

test('applyDelta upserts, removes and sorts', () => {
  const base = [{ train_id: '1A01', lateness_min: 0 }, { train_id: '1A02', lateness_min: 5 }];
  const d = { changed: [{ train_id: '1A01', lateness_min: 9 }], removed: ['1A02'] };
  const out = applyDelta(base, d);
  assert.deepEqual(out.map((t) => t.train_id), ['1A01']);
  assert.equal(out[0].lateness_min, 9);
});
