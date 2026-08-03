// tools/etl/collect.js — Stage 1 of the §6 pipeline: acquire raw Darwin/NROD data.
// Credentials come from environment variables (never committed):
//   DARWIN_S3_KEY_ID / DARWIN_S3_SECRET   → S3 bucket darwin.xmltimetable (eu-west-1), prefix PPTimetable/
//   NROD_USER / NROD_PASS                 → publicdatafeeds.networkrail.co.uk (CIF, CORPUS, SMART) + STOMP 61612
// If credentials are absent this exits 0 with a SKIPPED marker so the refresh
// pipeline stays green on fixtures; real ingestion activates once secrets exist.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from './serialize.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = join(ROOT, 'raw');
const BUCKET = 'darwin.xmltimetable';

function aws(args, env) {
  const fullEnv = process.env.AWS_PROFILE ? process.env : { ...process.env, AWS_PROFILE: env?.profile ?? 'darwin' };
  return execFileSync('aws', args, { env: fullEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function pickHighestVersion(keys, { ref = false } = {}) {
  const wanted = keys.filter((k) => k.includes('_ref_') === ref);
  if (wanted.length === 0) return null;
  wanted.sort((a, b) => {
    const va = a.match(/_v(\d+)/)[1] || '0';
    const vb = b.match(/_v(\d+)/)[1] || '0';
    return Number(vb) - Number(va);
  });
  return wanted[0];
}

export function listS3Keys(prefix = 'PPTimetable/') {
  const listing = aws(['s3', 'ls', `s3://${BUCKET}/${prefix}`]);
  return listing
    .split('\n')
    .map((l) => l.split(/\s+/).at(-1))
    .filter((k) => k && k.endsWith('.xml.gz'));
}

export function statusShape(obj) {
  if (!obj || typeof obj !== 'object') throw new TypeError('statusShape: expected object');
  if (!['ok', 'skipped', 'error'].includes(obj.status)) throw new TypeError(`statusShape: invalid status "${obj.status}"`);
  if (typeof obj.createdAt !== 'number') throw new TypeError('statusShape: createdAt must be a number');
  return obj;
}

export async function collect({ profile = 'darwin', mirrorR2 = !!process.env.R2_ENDPOINT } = {}) {
  const missing = ['DARWIN_S3_KEY_ID', 'DARWIN_S3_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    writeJson('raw/collect-status.json', statusShape({
      status: 'skipped',
      reason: 'missing env',
      missingEnvVars: missing,
      next: 'set env or run with profile',
      createdAt: Date.now(),
    }));
    return { status: 'skipped' };
  }
  mkdirSync(join(RAW, 'timetable'), { recursive: true });
  mkdirSync(join(RAW, 'ref'), { recursive: true });
  mkdirSync(join(RAW, 'misc'), { recursive: true });
  const keys = listS3Keys();
  const timetable = pickHighestVersion(keys);
  const ref = pickHighestVersion(keys, { ref: true });
  const files = [];
  for (const key of [timetable, ref]) {
    if (!key) continue;
    const local = join(RAW, key.includes('_ref_') ? 'ref' : 'timetable', key.split('/').at(-1));
    aws(['s3', 'cp', `s3://${BUCKET}/${key}`, local]);
    files.push({ key, local });
    if (mirrorR2) {
      aws([
        's3', 'cp', local,
        `s3://${process.env.R2_BUCKET}/${key}`,
        '--endpoint-url', process.env.R2_ENDPOINT,
        '--profile', process.env.R2_PROFILE || 'r2',
      ]);
    }
  }
  writeJson('raw/collect-status.json', statusShape({
    status: 'ok', files, mirroredR2: mirrorR2, createdAt: Date.now(),
  }));
  return { status: 'ok', files };
}

export async function fetchNaPTAN() {
  const url = process.env.NAPTAN_URL || 'https://naptan.dft.gov.uk/datafeed/naptan.csv';
  const dest = join(RAW, 'misc', 'naptan.csv');
  execFileSync('curl', ['-fsSL', '-o', dest, url], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return dest;
}

export async function fetchORR() {
  const url = process.env.ORR_URL || 'https://orr.dft.gov.uk/statistics/station-usage/csv';
  const dest = join(RAW, 'misc', 'orr-station-usage.csv');
  execFileSync('curl', ['-fsSL', '-o', dest, url], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return dest;
}

// --- main guard: only run collection when executed directly ---
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1]?.endsWith('collect.js')) {
  (async () => {
    try {
      const result = await collect();
      console.log(`collect: ${result.status}`);
      process.exit(result.status === 'ok' || result.status === 'skipped' ? 0 : 1);
    } catch (err) {
      writeJson('raw/collect-status.json', statusShape({
        status: 'error',
        error: err.message,
        createdAt: Date.now(),
      }));
      console.error('collect: ERROR', err.message);
      process.exit(1);
    }
  })();
}
