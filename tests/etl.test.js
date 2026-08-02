import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHighestVersion, listS3Keys, statusShape } from '../tools/etl/collect.js';
import { parseTimetable, parseRef } from '../tools/etl/xml.js';
import { loadPoc } from '../tools/etl/corridors.js';

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
  const ref = await parseRef(`raw/ref/${TS}_ref_v99.xml.gz`);
  assert.ok(ref.byTiploc.size > 5000, `expected >5000 TIPLOCs, got ${ref.byTiploc.size}`);
  const pad = ref.byTiploc.get('PADTON');
  assert.ok(pad, 'PADTON present');
  assert.equal(pad.crs, 'PAD', 'PADTON maps to PAD');
  assert.ok(ref.toc.size > 5, 'TOC map populated');
});

test('timetable streams and filters to the PoC station set', async () => {
  const poc = await loadPoc('config/poc.json');
  let kept = 0, total = 0;
  for await (const s of parseTimetable(`raw/timetable/${TS}_v8.xml.gz`, poc)) {
    total++;
    if (s.calling.length) kept++;
    assert.ok(Array.isArray(s.calling) && s.uid, `schedule has uid and calling array`);
  }
  assert.ok(kept > 100, `expected >100 PoC schedules, got ${kept}`);
  // eastern subset is ~10–15% of the national file (§6.7)
  assert.ok(kept < total * 0.25, `filter kept too much: ${kept}/${total}`);
});
