# SDD ledger — plan: docs/superpowers/plans/2026-08-02-uk-rail-marey-dashboard.md

## Task 0.3: ETL devDependencies + content-hashed assets — DONE
- Commits: c73e1f9..d15eacb
- Test summary: All 11 tests pass (10 pre-existing + 1 new hash test); test 5 (src references) and test 10 (hashed assets) both pass.
- Fix: Plan's assetRename keys had leading `/` but dist/index.html references assets without it — removed leading `/` in map keys.

## Task 1.0: Align fixtures to the §6.4 contract — DONE
- Commits: c73e1f9..1fdabd9
- Test summary: 16/16 tests pass (11 pre-existing + 5 new fixture contract tests); build passes (141.2 KB, budgets OK).

## Task 1.1: Real S3 collection + R2 mirror — DONE
- Commits: 1fdabd9..510581a
- Test summary: 19/19 tests pass (16 original + 3 new ETL tests); build passes.

## Task 1.2: Streaming timetable/ref parser + stations.json — DONE
- Commits: 510581a..b52386a (merged via PR)
- Test summary: 5/5 ETL tests pass (ref parse >5000 TIPLOCs, timetable filter keeps ~13.9% of schedules in 10-15% band, PADTON→PAD confirmed).
- PoC station set: 199 CRS, 200 TIPLOCs across CC+LE+TL TOCs.
