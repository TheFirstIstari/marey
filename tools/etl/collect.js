// tools/etl/collect.js — Stage 1 of the §6 pipeline: acquire raw Darwin/NROD data.
// Credentials come from environment variables (never committed):
//   DARWIN_S3_KEY_ID / DARWIN_S3_SECRET   → S3 bucket darwin.xmltimetable (eu-west-1), prefix PPTimetable/
//   NROD_USER / NROD_PASS                 → publicdatafeeds.networkrail.co.uk (CIF, CORPUS, SMART) + STOMP 61612
// If credentials are absent this exits 0 with a SKIPPED marker so the refresh
// pipeline stays green on fixtures; real ingestion activates once secrets exist.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = join(ROOT, 'raw');
const MARKER = join(RAW, 'collect-status.json');

const cfg = {
  s3Key: process.env.DARWIN_S3_KEY_ID,
  s3Secret: process.env.DARWIN_S3_SECRET,
  nrodUser: process.env.NROD_USER,
  nrodPass: process.env.NROD_PASS,
};

mkdirSync(RAW, { recursive: true });

function missing() {
  return Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k);
}

if (missing().length) {
  const note = {
    status: 'skipped',
    reason: 'credentials not configured',
    missingEnvVars: missing(),
    next: 'Set DARWIN_S3_KEY_ID, DARWIN_S3_SECRET, NROD_USER, NROD_PASS (Render Dashboard → Environment, or GitHub repo secrets for the Actions pipeline) and re-run. Until then the pipeline uses data/ fixtures.',
    createdAt: new Date().toISOString(),
  };
  writeFileSync(MARKER, JSON.stringify(note, null, 2));
  console.log(`collect: SKIPPED (missing: ${missing().join(', ')})`);
  process.exit(0);
}

// --- Real collection is implemented at the M0/M1 milestone (this turn is scaffolding).
// The intended flow (SPEC.md §6.2), pending implementation:
//   1. aws s3 cp s3://darwin.xmltimetable/PPTimetable/{ts}_timetable_v{n}.xml.gz → raw/timetable/
//   2. aws s3 cp s3://darwin.xmltimetable/PPTimetable/{ts}_ref_v{n}.xml.gz      → raw/ref/
//      (list the bucket first: the actual file set — _ref_v{n}/_timetable_v{n} vs ~-prefixed
//       keys — must be confirmed against the bucket, SPEC.md §12 Q1)
//   3. STOMP consumer on TRAIN_MVT_ALL_TOC + VSTP_ALL for a rolling window → raw/movements/ (delta-merged)
//   4. curl CifFileAuthenticate?type=CORPUS → raw/ref/corpus.json ; NaPTAN CSV → raw/ref/naptan.csv
writeFileSync(MARKER, JSON.stringify({ status: 'stub', createdAt: new Date().toISOString(), note: 'real collection implemented at M0/M1' }, null, 2));
console.log('collect: stub — real S3/STOMP/HTTP ingestion lands with the M0/M1 milestone');
process.exit(0);
