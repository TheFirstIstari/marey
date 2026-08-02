import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHighestVersion, listS3Keys, statusShape } from '../tools/etl/collect.js';

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
