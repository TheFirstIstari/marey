// Pure node-safe helpers for build/ETL. No imports — usable from tools/ and src/.
import { createHash } from 'node:crypto';

export function hashFile(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}
