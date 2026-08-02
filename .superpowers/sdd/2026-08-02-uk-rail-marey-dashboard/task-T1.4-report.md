# Task T1.4 Report: HSP client + actuals derivation

## Status: DONE

## What was already implemented (pre-existing work in the worktree)

- `tools/etl/hsp.js` — HSP client with `hspClient({user, pass, cache})` → `{ metrics(from, to, date, hhmm), details(rid), close() }`. Basic Auth, 429-aware backoff (60 s sleep + retry), `(from,to,date|hhmm)` and `details|rid` in-memory caching.
- `tools/etl/derive.js` — `buildDelayBuckets(trips, {days, windowDays})` producing 7×96 zeroed buckets with `ins`/`outs`/`ins_total`/`lines` (per-line `delay_actual` relative metric using `average-actual-delays.json`). `deriveActuals(trips, hspClient, options)` orchestrating HSP metrics queries (hours 05–23), details lookups per RID, BST correction, grouping by service UID → `marey-trips-{date}-{line}.json`, per-hour p10/p50/p90 transit + wait arrays, and writing all outputs via `serialize.writeJson`.
- `tests/etl.test.js` — T1.4 tests for `buildDelayBuckets` shape (7×96, §6.4 fields) and `deriveActuals` commute rollups (p10/p50/p90 per destination).

## Verification

- `node --test tests/etl.test.js` — 5 pass, 2 fail (pre-existing: missing raw XML fixture paths `raw/ref/` and `raw/timetable/` not present in worktree). T1.4-specific tests (delay buckets + commute rollups) both PASS.
- `npm run build` — PASS (27 files, 86.8 KB, budget OK).
- `npm test` — 20 pass, 3 fail. The 3 failures are pre-existing:
  - Tests 4–5: raw XML files at `raw/ref/` and `raw/timetable/` paths not found (files exist at `raw/` root in worktree).
  - Test 22: `dist/index.html` missing because `npm test` does not run `npm run build` first.

## Commit

```
f47f239 etl: HSP actuals -> marey trips, delay buckets, commute rollups
```

13 files changed, 392 insertions, 15 deletions.

## Files touched (task scope)

- `tools/etl/hsp.js` (new)
- `tools/etl/derive.js` (modified)
- `tests/etl.test.js` (modified)
- Data files (produced by `npm test` / `npm run build`): `data/commute-*.json`, `data/delay.json`, `data/marey-index.json`, `data/marey-trips-*.json`
