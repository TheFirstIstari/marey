// tools/etl/corridors.js — Loads the PoC corridor config and builds a
// byTiploc map from the ref file so parseTimetable can resolve CRS from TIPLOC.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRef } from './xml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

/**
 * Load the PoC corridor config and enrich it with a byTiploc map from the
 * ref file so that parseTimetable can resolve CRS from TIPLOC.
 */
export async function loadPoc(pocPath) {
  const fullPath = join(ROOT, pocPath);
  const poc = JSON.parse(readFileSync(fullPath, 'utf8'));

  // Find the ref file in raw/ref/ and build the byTiploc map.
  const refDir = join(ROOT, 'raw', 'ref');
  if (existsSync(refDir)) {
    const refFiles = readdirSync(refDir)
      .filter((f) => f.includes('_ref_') && f.endsWith('.xml.gz'));
    if (refFiles.length > 0) {
      const refMap = await parseRef(join(refDir, refFiles[0]));
      poc.byTiploc = refMap.byTiploc;
    }
  }

  return poc;
}
