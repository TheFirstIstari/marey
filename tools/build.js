// tools/build.js — assemble dist/ from src/ + data/, emit a size report, and
// enforce the §8 payload budgets (fails the build on any overrun).
// Run: npm run build   (Render's buildCommand; also CI-checkable locally.)
import { readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const budgets = JSON.parse(readFileSync(join(ROOT, 'budgets.json'), 'utf8'));

function walk(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

// Simple glob: supports '*' within a path segment.
function matches(pattern, path) {
  const rx = new RegExp('^' + pattern.split('*').map(escapeRegExp).join('.*') + '$');
  return rx.test(path);
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function build() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'data'), { recursive: true });
  mkdirSync(join(DIST, 'assets'), { recursive: true });

  // src → dist (plain static, no bundler; js/ and styles/ nest under assets/)
  for (const f of walk(SRC)) {
    const out = f.startsWith('js/') || f.startsWith('styles/') ? `assets/${f}` : f;
    mkdirSync(join(DIST, dirname(out)), { recursive: true });
    cpSync(join(SRC, f), join(DIST, out));
  }
  // data/ → dist/data/
  for (const f of walk(DATA)) {
    cpSync(join(DATA, f), join(DIST, 'data', f));
  }

  // Size report + budget enforcement
  const files = walk(DIST).map((rel) => ({ rel, bytes: statSync(join(DIST, rel)).size })).sort((a, b) => b.bytes - a.bytes);
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    totalBytes: total,
    totalMaxBytes: budgets.totalMaxBytes,
    firstVisitTargetBytes: budgets.firstVisitTargetBytes,
    files,
    violations: [],
  };

  for (const a of budgets.artifacts) {
    const hits = files.filter((f) => matches(a.match, f.rel));
    const max = hits.reduce((m, f) => Math.max(m, f.bytes), 0);
    if (max > a.maxBytes) report.violations.push({ match: a.match, maxBytes: a.maxBytes, actualBytes: max });
  }
  if (total > budgets.totalMaxBytes) report.violations.push({ match: '(total)', maxBytes: budgets.totalMaxBytes, actualBytes: total });

  writeFileSync(join(DIST, 'size-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(DIST, 'size-report.min.json'), JSON.stringify({
    generatedAt: report.generatedAt, totalBytes: total, files: files.map((f) => [f.rel, f.bytes]),
  }));

  console.log(`dist/ built: ${files.length} files, ${(total / 1024).toFixed(1)} KB total`);
  for (const f of files.slice(0, 15)) console.log(`  ${f.rel.padEnd(40)} ${(f.bytes / 1024).toFixed(1)} KB`);
  if (files.length > 15) console.log(`  … ${files.length - 15} more`);
  console.log(`First-visit target: ${(budgets.firstVisitTargetBytes / 1024).toFixed(0)} KB (${total <= budgets.firstVisitTargetBytes ? 'OK' : 'over'})`);

  if (report.violations.length) {
    console.error('\n❌ PAYLOAD BUDGET VIOLATIONS (SPEC.md §8):');
    for (const v of report.violations) console.error(`  ${v.match}: ${(v.actualBytes / 1024).toFixed(1)} KB > ${(v.maxBytes / 1024).toFixed(1)} KB`);
    process.exit(1);
  }
  console.log(`✅ Budget OK (total ${(total / 1024).toFixed(1)} KB ≤ ${(budgets.totalMaxBytes / 1024).toFixed(1)} KB)`);
}

build();
