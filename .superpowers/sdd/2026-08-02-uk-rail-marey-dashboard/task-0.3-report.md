# T0.3 Report

Status: DONE

Commits: c73e1f9..d15eacb

Test summary: All 11 tests pass (10 pre-existing + 1 new hash test); test 5 (src references) and test 10 (hashed assets) both pass.

Concerns (if any):
- The plan's `assetRename.set('/' + rel, '/' + hashedRel)` used a leading `/` in keys, but `dist/index.html` references assets without a leading `/` (e.g., `assets/styles/main.css`). Fixed by removing the leading `/` in the map keys so the HTML rewrite matches correctly.
