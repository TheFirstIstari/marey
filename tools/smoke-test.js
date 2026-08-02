// tools/smoke-test.js — validate the shape of every derived artifact.
// This is the automated check from the goal's completion criterion; it runs
// against whatever data/ contains (fixtures now, real Darwin-derived data later).
// Exit code 0 = pass, 1 = fail with a clear message.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f) => join(ROOT, 'data', f);

let failures = [];
function check(name, cond, detail = '') {
  if (!cond) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function load(name) {
  const p = D(name);
  if (!existsSync(p)) { failures.push(`missing ${name}`); return null; }
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { failures.push(`unparseable ${name}`); return null; }
}

// 1. marey-trips — non-empty, sane trajectory shape (read via index + day/line files)
const idx = load('marey-index.json');
let marey = [];
if (idx && idx.days && idx.lines) {
  for (const day of idx.days) {
    for (const line of day.lines) {
      const f = `marey-trips-${day.date}-${line.line}.json`;
      const trips = load(f);
      if (Array.isArray(trips)) marey = marey.concat(trips);
    }
  }
}
check('marey-trips (day+line) non-empty', Array.isArray(marey) && marey.length >= 1);
if (Array.isArray(marey) && marey.length) {
  const t = marey[0];
  check('marey-trips: service+line+stops', t.service && t.line && Array.isArray(t.stops) && t.stops.length >= 2);
  check('marey-trips: begin<end', typeof t.begin === 'number' && typeof t.end === 'number' && t.begin < t.end);
  check('marey-trips: epoch seconds', t.begin > 1e9, `begin=${t.begin} looks too small`);
  // Every trip's stop times must be ordered after unwrapping a single midnight
  // crossing (the ETL emits post-midnight events as 1440+ minutes). Out-of-order
  // stops would render backwards on the Marey chart.
  const minOfDay = (s) => (s % 86400) / 60;
  let tripsBad = 0;
  for (const trip of marey) {
    let prev = -Infinity;
    let wrapped = false;
    for (const st of trip.stops || []) {
      let m = minOfDay(st.time);
      if (wrapped) m += 1440;
      else if (m < prev) { wrapped = true; m += 1440; }
      if (m < prev) { tripsBad++; break; }
      prev = m;
    }
  }
  check('marey-trips: per-trip stop times ordered (no backwards runs)', tripsBad === 0, `${tripsBad} trip(s) with out-of-order stops`);
}

// 2. delay.json — exactly 7 days × 96 buckets
const delay = load('delay.json');
check('delay.json is array', Array.isArray(delay));
if (Array.isArray(delay)) {
  check('delay.json has 672 buckets (7×96)', delay.length === 672, `got ${delay.length}`);
  const perDay = new Set(delay.map((b) => b.day));
  check('delay.json days 0..6', perDay.size === 7 && [...perDay].every((d) => d >= 0 && d <= 6));
  const secs = new Set(delay.map((b) => b.secOfDay));
  check('delay.json 96 unique secOfDay', secs.size === 96, `got ${secs.size}`);
  const b = delay[0];
  check('delay.json bucket shape', b && 'ins' in b && 'outs' in b && 'ins_total' in b);
}

// 3. live.json — non-empty with ≥1 train (completion criterion)
const live = load('live.json');
check('live.json refreshed_at', live && typeof live.refreshed_at === 'string');
check('live.json ≥1 train', live && Array.isArray(live.trains) && live.trains.length >= 1);
if (live?.trains?.[0]) {
  const tr = live.trains[0];
  check('live train shape', tr.train_id && typeof tr.lat === 'number' && typeof tr.lon === 'number' && 'lateness_min' in tr);
}

// 4. station-usage — stations keyed by CRS
const usage = load('station-usage.json');
check('station-usage.stations non-empty', usage && Array.isArray(usage.stations) && usage.stations.length >= 1);
if (usage?.stations?.[0]) check('station-usage CRS+entries+exits', usage.stations[0].crs && 'entries' in usage.stations[0] && 'exits' in usage.stations[0]);

// 5. station-frequency — stops with hourly times
const freq = load('station-frequency.json');
check('station-frequency.stops non-empty', freq && Array.isArray(freq.stops) && freq.stops.length >= 1);
if (freq?.stops?.[0]) check('station-frequency hourly times', Array.isArray(freq.stops[0].times) && freq.stops[0].times.length >= 24);

// 6. network — topology for map + Marey x-positions
const net = load('network.json');
check('network.lines+segments', net && Array.isArray(net.lines) && Array.isArray(net.segments) && net.segments.length >= 1);

// 7. Corridor coverage sanity: the corridor stop set must be in network + usage
const crs = (a) => new Set((a || []).map((s) => s.crs));
if (net && usage && marey) {
  const netCrs = crs(net.stops), useCrs = crs(usage.stations);
  const used = [...new Set(marey.flatMap((t) => t.stops.map((s) => s.stop)))];
  check('marey stops exist in network', used.every((c) => netCrs.has(c)), used.filter((c) => !netCrs.has(c)).join(','));
  check('marey stops exist in station-usage', used.every((c) => useCrs.has(c)), used.filter((c) => !useCrs.has(c)).join(','));
}

if (failures.length) {
  console.error(`❌ SMOKE TEST FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('✅ Smoke test passed: all artifacts shape-valid (marey 1+, delay 7×96, live ≥1 train, network/usage/frequency ok)');
