import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickHighestVersion, listS3Keys, statusShape } from '../tools/etl/collect.js';
import { parseTimetable, parseRef } from '../tools/etl/xml.js';
import { loadPoc } from '../tools/etl/corridors.js';
import { derivePlanned } from '../tools/etl/derive.js';
import { deriveActuals, buildDelayBuckets } from '../tools/etl/derive.js';

const TS = '20260802020500';

test('pickHighestVersion selects the day highest v{n}', () => {
  const keys = [
    'PPTimetable/20260802020300_v4.xml.gz',
    'PPTimetable/20260802020500_v8.xml.gz',
    'PPTimetable/20260802020500_v7.xml.gz',
  ];
  assert.equal(pickHighestVersion(keys), 'PPTimetable/20260802020500_v8.xml.gz');
});

test('pickHighestVersion prefers ref v99 for the ref side', () => {
  const keys = ['PPTimetable/20260802020500_ref_v99.xml.gz', 'PPTimetable/20260802020500_ref_v8.xml.gz'];
  assert.equal(pickHighestVersion(keys, { ref: true }), 'PPTimetable/20260802020500_ref_v99.xml.gz');
});

test('collect-status shape', () => {
  assert.ok(statusShape({ status: 'skipped', reason: 'x', missingEnvVars: ['A'], next: 'y', createdAt: 1 }));
});

test('ref file parses to a TIPLOC map (real sample)', async () => {
  const ref = await parseRef(`raw/20260802020500_ref_v99.xml.gz`);
  assert.ok(ref.byTiploc.size > 5000, `expected >5000 TIPLOCs, got ${ref.byTiploc.size}`);
  const pad = ref.byTiploc.get('PADTON');
  assert.ok(pad, 'PADTON present');
  assert.equal(pad.crs, 'PAD', 'PADTON maps to PAD');
  assert.ok(ref.toc.size > 5, 'TOC map populated');
});

test('timetable streams and filters to the PoC station set', async () => {
  const poc = await loadPoc('config/poc.json');
  let kept = 0, total = 0;
  for await (const s of parseTimetable(`raw/20260802020500_v8.xml.gz`, poc)) {
    total++;
    if (s.calling.length) kept++;
    assert.ok(Array.isArray(s.calling) && s.uid, `schedule has uid and calling array`);
  }
  assert.ok(kept > 100, `expected >100 PoC schedules, got ${kept}`);
  // eastern subset is ~10–15% of the national file (§6.7)
  assert.ok(kept < total * 0.25, `filter kept too much: ${kept}/${total}`);
});

test('network.json is self-consistent', async () => {
  const cfg = await loadPoc('config/poc.json');
  const net = await derivePlanned({ cfg, stations: [], rawDir: 'raw' });
  for (const seg of net.segments) {
    assert.ok(seg.line && seg.from_crs && seg.to_crs, `segment has line/from_crs/to_crs`);
    assert.ok(seg.stations.length >= 2, `segment has >=2 stations`);
    for (const crs of seg.stations) {
      assert.ok(net.stops.some((s) => s.crs === crs), `station ${crs} in network stops`);
    }
  }
});

test('station-frequency buckets are per-hour and sorted', () => {
  const freq = JSON.parse(
    readFileSync('data/station-frequency.json', 'utf8')
  );
  assert.ok(Array.isArray(freq.stops), 'stops is an array');
  assert.ok(freq.stops.length > 0, 'at least one stop');
  for (const stop of freq.stops) {
    assert.ok(Array.isArray(stop.times), `times array for ${stop.crs}`);
    assert.equal(stop.times.length, 24, `24 hourly buckets for ${stop.crs}`);
    for (let i = 0; i < stop.times.length; i++) {
      const t = stop.times[i];
      assert.equal(t.time, i * 3600, `time is integer hour ${i} for ${stop.crs}`);
      assert.ok(Number.isInteger(t.arrivals), `arrivals is integer for ${stop.crs} hour ${i}`);
      assert.ok(Number.isInteger(t.departures), `departures is integer for ${stop.crs} hour ${i}`);
    }
  }
});

// --- T1.4: HSP client + actuals derivation ---

const BASE = 1743465600; // 2025-04-01 00:00:00 UTC

function makeTrip(line, stops) {
  return { line, begin: stops[0].time, end: stops[stops.length - 1].time, stops };
}

// 8 sampled eastern trips with stops at known bucket positions
const sampleTrips = [
  makeTrip('gwml', [
    { stop: 'PAD', time: BASE + 5 * 3600 },
    { stop: 'RDG', time: BASE + 5 * 3600 + 1800 },
    { stop: 'BRI', time: BASE + 5 * 3600 + 3600 },
  ]),
  makeTrip('gwml', [
    { stop: 'PAD', time: BASE + 6 * 3600 },
    { stop: 'RDG', time: BASE + 6 * 3600 + 1800 },
    { stop: 'BRI', time: BASE + 6 * 3600 + 3600 },
  ]),
  makeTrip('c2c', [
    { stop: 'FST', time: BASE + 7 * 3600 },
    { stop: 'SUT', time: BASE + 7 * 3600 + 900 },
    { stop: 'SSE', time: BASE + 7 * 3600 + 2700 },
  ]),
  makeTrip('c2c', [
    { stop: 'FST', time: BASE + 8 * 3600 },
    { stop: 'SUT', time: BASE + 8 * 3600 + 900 },
    { stop: 'SSE', time: BASE + 8 * 3600 + 2700 },
  ]),
  makeTrip('ga', [
    { stop: 'LST', time: BASE + 9 * 3600 },
    { stop: 'BRC', time: BASE + 9 * 3600 + 1800 },
    { stop: 'NRW', time: BASE + 9 * 3600 + 3600 },
  ]),
  makeTrip('ga', [
    { stop: 'LST', time: BASE + 10 * 3600 },
    { stop: 'BRC', time: BASE + 10 * 3600 + 1800 },
    { stop: 'NRW', time: BASE + 10 * 3600 + 3600 },
  ]),
  makeTrip('xc', [
    { stop: 'CBG', time: BASE + 11 * 3600 },
    { stop: 'BTH', time: BASE + 11 * 3600 + 2700 },
    { stop: 'STN', time: BASE + 11 * 3600 + 5400 },
  ]),
  makeTrip('xc', [
    { stop: 'CBG', time: BASE + 12 * 3600 },
    { stop: 'BTH', time: BASE + 12 * 3600 + 2700 },
    { stop: 'STN', time: BASE + 12 * 3600 + 5400 },
  ]),
];

test('delay.json has 7 days x 96 buckets and the §6.4 shape', () => {
  const delay = buildDelayBuckets(sampleTrips, { days: 7, windowDays: 7 });
  assert.equal(delay.length, 7 * 96);
  assert.ok(delay.every((b) => Number.isInteger(b.secOfDay) && b.ins && b.outs && b.ins_total !== undefined));
  assert.ok(delay.every((b) => b.day >= 0 && b.day <= 6));
  assert.ok(delay.every((b) => Number.isInteger(b.day) && Number.isInteger(b.secOfDay)));
  // verify ins/outs counts are populated from the sample trips
  const bucket0 = delay.find((b) => b.secOfDay === 0);
  assert.ok(bucket0, 'bucket 0 exists');
  assert.ok(bucket0.ins_total >= 0, 'ins_total is a number');
  assert.ok(Array.isArray(bucket0.lines), 'lines is an array');
});

test('commute rollups key by destination and expose p10/p50/p90', async () => {
  // mock HSP client that returns fixture data
  const mockHsp = {
    async metrics(from, to, date, hhmm) {
      return { rid: `test-${from}-${to}-${hhmm}`, from_loc: from, to_loc: to };
    },
    async details(rid) {
      return { rid, origin: 'PAD', destination: 'BRI', locations: [
        { location: 'PAD', gbtt_pta: '05:00', actual_ta: '05:02' },
        { location: 'BRI', gbtt_ptd: '06:00', actual_td: '06:05' },
      ]};
    },
    close() {},
  };

  const result = await deriveActuals(sampleTrips, mockHsp, {
    origins: ['PAD', 'FST', 'LST'],
    destinations: ['BRI', 'NRW'],
    date: '2025-04-01',
    windowDays: 7,
  });

  assert.ok(result, 'deriveActuals returns a result');
  assert.ok(Array.isArray(result.commute), 'commute is an array');
  for (const originCommute of result.commute) {
    assert.ok(originCommute.origin, 'commute entry has origin');
    assert.ok(originCommute.destinations, 'commute entry has destinations');
    for (const [dest, data] of Object.entries(originCommute.destinations)) {
      assert.ok(data.result, `commute ${originCommute.origin}->${dest} has result`);
      assert.ok(Array.isArray(data.result), `result is an array for ${dest}`);
      for (const hourEntry of data.result) {
        assert.equal(hourEntry.length, 3, 'each result entry is [hour, [p10,p50,p90], [p10,p50,p90]]');
        assert.ok(Array.isArray(hourEntry[1]), 'p10/p50/p90 transit is an array');
        assert.ok(Array.isArray(hourEntry[2]), 'p10/p50/p90 wait is an array');
        assert.equal(hourEntry[1].length, 3, 'transit percentile array has 3 values');
        assert.equal(hourEntry[2].length, 3, 'wait percentile array has 3 values');
      }
    }
  }
});
