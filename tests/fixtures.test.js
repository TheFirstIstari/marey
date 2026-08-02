import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const json = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const crsRe = /^[A-Z]{3}$/;

test('stations.json exists with §6.4 shape', () => {
  const s = json('stations.json');
  assert.ok(Array.isArray(s) && s.length > 0);
  for (const st of s) {
    assert.match(st.crs, crsRe);
    assert.equal(typeof st.name, 'string');
    assert.equal(typeof st.lat, 'number');
    assert.equal(typeof st.lon, 'number');
    assert.equal(typeof st.tiploc, 'string');
    assert.equal(typeof st.stanox, 'string');
    assert.equal(typeof st.usage, 'number');
  }
});

test('schedule-*.json files match §6.4 shape', () => {
  const files = readdirSync(DATA).filter((f) => /^schedule-.+\.json$/.test(f));
  assert.ok(files.length >= 1, 'at least one schedule-{line}.json');
  for (const f of files) {
    const sched = json(f);
    assert.ok(Array.isArray(sched));
    for (const svc of sched) {
      assert.ok(svc.uid && svc.headcode && svc.toc);
      assert.ok(Array.isArray(svc.departures) && svc.departures.every((d) => crsRe.test(d.crs) && Number.isInteger(d.time)));
      assert.ok(Array.isArray(svc.stops) && svc.stops.every((x) => crsRe.test(x.crs) && Number.isInteger(x.planned_time)));
    }
  }
});

test('marey trips are split per day+line with an index', () => {
  const idx = json('marey-index.json');
  assert.ok(idx.days.length >= 1);
  assert.ok(idx.lines.length >= 1);
  for (const day of idx.days) {
    for (const line of day.lines) {
      const f = `marey-trips-${day.date}-${line.line}.json`;
      assert.ok(existsSync(join(DATA, f)), `${f} missing`);
      const trips = json(f);
      assert.ok(Array.isArray(trips));
      for (const t of trips) {
        assert.ok(t.service && t.line && Number.isInteger(t.begin) && Number.isInteger(t.end));
        assert.ok(Array.isArray(t.stops) && t.stops.length >= 2);
        assert.ok(t.stops.every((s) => crsRe.test(s.stop) && Number.isInteger(s.time)));
        assert.ok(t.begin < t.end);
      }
    }
  }
});

test('no monolithic marey-trips.json remains', () => {
  assert.ok(!existsSync(join(DATA, 'marey-trips.json')));
});

test('live-delta.json shape', () => {
  const d = json('live-delta.json');
  assert.ok(Number.isInteger(d.refreshed_at) || typeof d.refreshed_at === 'string');
  assert.ok(Array.isArray(d.changed) && Array.isArray(d.removed));
});
