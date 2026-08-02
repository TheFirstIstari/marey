// tools/etl/discover.js — Discover PoC station set from the real timetable sample.
// Usage: node tools/etl/discover.js raw/timetable/{ts}_v8.xml.gz
// Writes raw/discovery.json with { tocCounts, stations }.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTimetable, parseRef } from './xml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

async function main() {
  const gzPath = process.argv[2];
  if (!gzPath) {
    console.error('Usage: node tools/etl/discover.js <timetable-gz-path>');
    process.exit(1);
  }

  // Resolve the ref file from the same timestamp as the timetable file.
  const basename = gzPath.split('/').at(-1);
  const ts = basename.match(/^(\d{14})/)?.[1];
  if (!ts) {
    console.error('Could not extract timestamp from filename:', basename);
    process.exit(1);
  }

  const refPath = join(ROOT, 'raw', 'ref', `${ts}_ref_v99.xml.gz`);
  if (!existsSync(refPath)) {
    console.error('Ref file not found:', refPath);
    process.exit(1);
  }

  console.log(`Parsing ref file: ${refPath}`);
  const refMap = await parseRef(refPath);
  console.log(`Ref map: ${refMap.byTiploc.size} TIPLOCs, ${refMap.toc.size} TOCs`);

  const filter = { byTiploc: refMap.byTiploc, stationSet: { crs: [], tiploc: [] } };

  const tocCounts = {};
  const crsSet = new Set();
  const tiplocSet = new Set();
  let total = 0;

  for await (const sched of parseTimetable(gzPath, filter)) {
    total++;
    if (sched.toc) {
      tocCounts[sched.toc] = (tocCounts[sched.toc] || 0) + 1;
    }
    for (const stop of sched.calling) {
      if (stop.crs) crsSet.add(stop.crs);
      if (stop.tiploc) tiplocSet.add(stop.tiploc);
    }
  }

  const discovery = {
    tocCounts,
    stations: {
      crs: [...crsSet].sort(),
      tiploc: [...tiplocSet].sort(),
      crsCount: crsSet.size,
      tiplocCount: tiplocSet.size,
    },
    totalSchedules: total,
  };

  const outPath = join(ROOT, 'raw', 'discovery.json');
  writeFileSync(outPath, JSON.stringify(discovery, null, 2) + '\n', 'utf8');
  console.log(`Discovery written to ${outPath}`);
  console.log(`Total schedules: ${total}`);
  console.log(`TOC counts:`, JSON.stringify(tocCounts, null, 2));
  console.log(`Unique CRS: ${crsSet.size}, Unique TIPLOC: ${tiplocSet.size}`);
}

main().catch((err) => {
  console.error('Discovery failed:', err.message);
  process.exit(1);
});
