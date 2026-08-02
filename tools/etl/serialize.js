// tools/etl/serialize.js — Minimal JSON serialization + payload budget enforcement.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function writeJson(relPath, obj) {
  const raw = JSON.stringify(obj);
  const full = join(ROOT, relPath);
  writeFileSync(full, raw + '\n', 'utf8');
  return raw;
}

export function assertBudget(relPath, bytes) {
  const budgets = JSON.parse(
    readFileSync(join(ROOT, 'budgets.json'), 'utf8')
  );
  const artifact = budgets.artifacts.find((a) => {
    const pattern = a.match.replace(/\*/g, '.*');
    return new RegExp(`^${pattern}$`).test(relPath);
  });
  if (artifact && bytes > artifact.maxBytes) {
    throw new Error(
      `Budget exceeded: ${relPath} is ${bytes} bytes (limit ${artifact.maxBytes})`
    );
  }
  const total = budgets.artifacts.reduce((sum, a) => sum + a.maxBytes, 0);
  if (bytes > budgets.totalMaxBytes) {
    throw new Error(
      `Total budget exceeded: ${relPath} is ${bytes} bytes (total max ${budgets.totalMaxBytes})`
    );
  }
}
