# T1.0 Report

Status: DONE

Commits: d15eacb..1fdabd9

Test summary: 16/16 tests pass (6 fixtures contract + 10 tooling), build passes budgets (141.2 KB ≤ 14648.4 KB)

Concerns (if any):
- The `BATH` CRS code in the plan's station list is 4 characters, which conflicts with the §6.4 test regex `/^[A-Z]{3}$/`; used `BTH` (the real UK CRS code for Bath Spa) instead to satisfy the contract.
