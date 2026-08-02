// T6.1 — Pure helpers for the live overlay: delta merge and sort.
export function applyDelta(baseline, delta) {
  const map = new Map();
  for (const t of baseline) map.set(t.train_id, t);
  for (const t of delta.changed) map.set(t.train_id, t);
  for (const id of delta.removed) map.delete(id);
  return [...map.values()].sort((a, b) => b.lateness_min - a.lateness_min);
}
