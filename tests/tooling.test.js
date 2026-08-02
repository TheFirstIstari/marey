// Tooling-level checks, run AFTER `npm run fixtures` (see package.json test
// script): budgets.json must be well-formed, and the fixture pipeline must
// produce the exact shapes the smoke test and the §8 budget enforce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secOfDayMin, hhmm, linScale, stationY, stationIndex, tripPoints } from '../src/js/marey-math.js';
import { heatColor, freqTotal, usageSorted, nodeExtents, linePath } from '../src/js/people-math.js';
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
    assert.ok(!ref.startsWith('http'), `no external references (found ${ref})`);
    const srcPath = join(ROOT, 'src', ref.replace(/^assets\//, ''));
    assert.ok(existsSync(srcPath), `referenced file exists in src/: ${ref}`);
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
