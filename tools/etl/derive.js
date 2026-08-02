// tools/etl/derive.js — Stage 3 of the §6 pipeline: emit the MBTA-style artifacts
// into data/ (schemas in SPEC.md §6.4). Currently passes through fixtures so the
// site stays deployable; the real derivation (marey-trips from TRUST, delay buckets
// 7×96, commute percentiles, live.json) is implemented at M1–M6.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const hasRawTimetable = existsSync(join(ROOT, 'raw', 'timetable'));
const hasRawMovements = existsSync(join(ROOT, 'raw', 'movements'));

if (hasRawTimetable && hasRawMovements) {
  console.log('derive: raw timetable + movements present — running real derivation (M1+, TODO)');
  // M1+ implementation: parse → normalize → emit artifacts per §6.4. Not yet written;
  // the build/smoke gate means we never ship broken output.
  process.exit(1); // fail loudly rather than emit wrong data from an unbuilt parser
}

console.log('derive: no raw Darwin input — keeping data/ fixtures (site remains deployable)');
process.exit(0);
