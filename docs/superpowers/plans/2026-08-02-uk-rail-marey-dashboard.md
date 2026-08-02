# UK Rail Viz (Eastern Region PoC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **When agents run in parallel, each must work in its own git worktree under `.worktrees/` (Execution Model below); never share a working directory.**

**Goal:** Deliver the eastern-region proof of concept end-to-end — a static, efficiency-first UK rail dashboard on Render (Marey chart, People, Congestion & Delay, Commute, Live overlay) powered by Darwin S3 timetables + HSP historical actuals, per SPEC.md v1.1 (milestones M1–M7).

**Architecture:** Static site on Render's free tier serving precomputed minified JSON from `data/`; zero server compute in the request path. All ETL runs in GitHub Actions (collect from Darwin S3 + HSP + TRUST window → normalize with streaming gunzip→saxes → derive the §6.4 artifacts → commit `data/` → push → Render auto-deploys). The site itself is **zero-runtime-dependency vanilla ESM + SVG** (no d3, no bundler): the existing scaffold's Marey/People implementations already prove this pattern, and SPEC §2.3's port table is amended to match (T0.2).

**Tech Stack:**
- Node ≥ 20 (v22.14.0 verified) ESM; tests via `node --test` + `node:assert/strict`.
- Site: vanilla ES modules + native DOM/SVG APIs; pure hand-rolled math helpers (unit-tested); native `fetch`. **Zero runtime dependencies.**
- ETL (devDependencies only — run in GitHub Actions, never shipped): `saxes@6.0.0` (streaming XML), `stompit@1.0.0` (STOMP window for the live overlay), AWS CLI v2 (S3 fetch + R2 mirror; preinstalled on GitHub ubuntu runners; local profile `darwin`).
- GitHub Actions cron (`*/15` live refresh + daily timetable) → commit `data/` → push → Render static auto-deploy (CDN invalidates per deploy).
- Render: static site via `render.yaml` blueprint; CLI v2.22.0 verified.

## Global Constraints

Copied verbatim from SPEC.md v1.1 — every task's requirements implicitly include these.

1. **Payload budgets** (§8, enforced by `tools/build.js`, build FAILS on violation): `dist/` total ≤ 15,000,000 B; first visit ≈ 1.5 MB; `assets/*.js` ≤ 200 KB; `assets/*.css` ≤ 50 KB; `index.html` ≤ 50 KB; per-artifact caps in `budgets.json`.
2. **No runtime dependencies in the request path** (§9): all JS/CSS hand-rolled or built; no CDN links; no tracking beacons. DevDependencies are allowed for ETL only.
3. **No server** (§5, R-2): Render's `buildCommand` runs `npm run build` **offline** on committed `data/`; it NEVER fetches from S3 (Hobby = 5 GB/mo outbound, suspension risk for service-initiated traffic).
4. **All data precomputed minified JSON** (§6.4): epoch timestamps, CRS-keyed, short keys, lat/lon to 5 dp, deduped. Artifact schemas in §6.4 + `budgets.json` are the contract; `tools/smoke-test.js` and `tests/tooling.test.js` validate shape on every test run.
5. **Streaming parse with early filter** (§6.7): gunzip → saxes → emit only schedules touching the PoC station set; no full-file object; peak RSS < 500 MB.
6. **BST −1 h correction** mandatory for TRUST timestamps (normalize.js `KNOWN_BUGS`).
7. **Credentials only via env/config** (`DARWIN_S3_*`, `NROD_*`, `R2_*`, `GH_PAT`); never hard-coded (Evolution-proof, R-3).
8. **Attribution footer required** (§9, R-5): NRE logo + "Powered by National Rail Enquiries"; suppress time-bound data (live platform numbers) per feed direction.
9. **Lazy per-section data** (§8): per-section loads; commute per-origin on demand; live `delta` after a session baseline.
10. **Eastern-region PoC scope fixed** (§4): c2c + Greater Anglia + selected CrossCountry + selected Great Northern; ~3,500–4,500 services/day, ~80–120 unique CRS.
11. **Refresh cadence** (§6.2): live D2 = 15 min; timetable daily ~03:15 UK; CIF weekly; NaPTAN monthly; ORR annually.
12. **No git repo exists yet** — T0.1 initializes it (the `.github/workflows/refresh.yml` and `render.yaml` already assume GitHub/Render).
13. **Fixtures vs real data** (scaffold rule, keep): `tools/etl/derive.js` emits real artifacts only when `raw/timetable/` + actuals exist; otherwise it keeps the shape-correct fixtures — the build/smoke gate never ships broken output.

## Execution Model — Parallel Agents

This plan is built so tasks can run in parallel (independent files, test-gated commits), and **parallel agents must never share a working directory**. Whenever more than one agent runs at once (subagent-driven execution, parallel review passes, etc.):

- Each agent gets its **own isolated git worktree** at `.worktrees/<task-branch>` (using-git-worktrees skill: detect existing isolation first, prefer native worktree tools, fall back to `git worktree add .worktrees/<name> -b <branch>`). The `.worktrees/` directory is gitignored (T0.1 Step 1) so it can never be committed.
- Worktrees branch from `main`; each agent commits and tests inside its own worktree. Branches are merged into `main` at the normal review checkpoint — worktrees never touch `prod` (branch model, T0.1).
- Cleanup: `git worktree remove .worktrees/<name>` once the branch merges; re-run `npm test` in the main checkout before the checkpoint commit.
- Sequential single-agent execution works directly in the main checkout — a worktree is required only when agents run in parallel.

## File Structure

**New files to create:**

| File | Responsibility |
|---|---|
| `config/poc.json` | Eastern-region corridor/line/station configuration (CRS + TIPLOC set per line, operators, terminals, commute origins, window days). The single scale-up knob (M8). |
| `src/js/sections.js` | Section registry + lazy per-section module loader, shell wiring — nav render, scroll-spy, `slotError` (T2.1/T2.2). |
| `src/js/toc-colours.js` | Pure `tocColour(toc, code, fallback)` — operator colour from `toc.json` `colour` field; legends/filters (T2.2). |
| `src/js/header.js` | Animated schematic header glyph (train dots along `network.json` lines). |
| `src/js/delay.js` | Congestion & Delay renderer (horizon charts, delay band, thick-link glyphs). |
| `src/js/delay-math.js` | Pure helpers for delay: horizon areas, gradient stops, ratio colour. |
| `src/js/commute.js` | Your Commute renderer (scatter, percentile bands, deep-links, on-demand origin). |
| `src/js/commute-math.js` | Pure helpers: percentile areas, downsample, nearest-point hit test. |
| `src/js/live.js` | Live overlay renderer (snapshot + session delta merge). |
| `src/js/live-math.js` | Pure helpers: delta merge, sort by lateness. |
| `src/js/hash.js` | Pure helpers shared by build/ETL: sha256 content hash (8 hex chars). |
| `tools/etl/hsp.js` | HSP client: `serviceMetrics`/`serviceDetails`, Basic Auth, rate batching, R2 cache by `(from,to,date)`. |
| `tools/etl/xml.js` | Streaming timetable/ref parser (gunzip → saxes → filtered schedules + code maps). |
| `tools/etl/corridors.js` | Loads `config/poc.json`, resolves CRS↔TIPLOC, derives the PoC filter set. |
| `tools/etl/serialize.js` | Minified-JSON writer + per-artifact budget check (shared by derive). |
| `tests/fixtures.test.js` | Schema-contract tests for every fixture artifact (§6.4 + budgets.json). |
| `tests/etl.test.js` | ETL unit tests against the captured samples in `raw/` (network stubbed). |
| `.env.example` | Documents required env vars (never committed with values). |

**Existing files to modify:**

| File | Change |
|---|---|
| `tools/build.js` | Content-hash asset filenames (T0.3) so `/assets/*` immutable caching is real; keep budgets + size report. |
| `src/index.html` | Shell: five sections + header glyph + attribution footer + skip link + section nav; zero external refs (test 5 enforces) (T2.1/T2.2). |
| `src/styles/main.css` | Studied-DNA design tokens (light editorial per mbtaviz.github.io) + shell styles: sticky section nav, header row, slot error/loading states, focus-visible, reduced-motion, responsive (T2.2). |
| `src/js/dataloader.js` | Parallel `Promise.all` loads, per-section load plans, load `stations.json` + `schedule-*` + `marey-index`; status reporting. |
| `src/js/marey.js` | Add lined-up variant + time-axis brush, click-to-freeze, annotations, day/line lazy file loading. |
| `src/js/marey-math.js` | Add brush-extent, invert-y, freeze-domain helpers. |
| `src/js/people.js` | Add click-through station detail heatmap, keyboard focus + ARIA on table rows. |
| `src/js/people-math.js` | Add per-station detail aggregation helper. |
| `tools/fixtures.js` | Align to §6.4 exactly: add `stations.json` + `marey-index.json`, split `marey-trips-{date}-{line}.json`, fix `schedule-*` shape (T1.0). |
| `tools/etl/collect.js` | Real S3 download (aws CLI), R2 mirror, NaPTAN + ORR fetch, STOMP window (T7.2), status file. |
| `tools/etl/normalize.js` | Real `buildStationIndex` from ref/CORPUS + NaPTAN; emit `stations.json`. |
| `tools/etl/derive.js` | Real derivation of all §6.4 artifacts from normalized data + HSP actuals. |
| `tests/tooling.test.js` | Add hashing test (T0.3) + `tocColour` test (T2.2); keep existing 9 tests green. |
| `budgets.json` | Add `data/stations.json`, `data/marey-trips-*.json` (per-line/day), `data/marey-index.json`, `data/live-delta.json`; drop the monolithic `data/marey-trips.json` (T1.0). |
| `package.json` | Add `saxes`, `stompit` devDependencies (T0.3); no other deps ever. |
| `.github/workflows/refresh.yml` | Wire secrets + R2 mirror env; concurrency guard; push trigger → main only; FF-push `main → prod` (T7.3). |
| `SPEC.md` | §2.3 port table amended (T0.2); §7 branch model (T0.1) — both applied at execution. |
| `render.yaml` | Add `branch: prod` (deploy branch, §7.2); validate header globs (T8.1). |
| `.gitignore` | Add `.worktrees/` (parallel-agent worktree dir — Execution Model; T0.1 Step 1). |

---

## Phase 0 — Foundation

### Task 0.1: Initialize the git repository + branch strategy

**Files:**
- Create: `.git/` (via `git init`) + GitHub remote (user's account)
- Modify: `SPEC.md` §7 — branch model + `branch: prod` in the §7.1 snippet (exact text in Step 4)
- Verify: `.gitignore` already covers `node_modules/`, `dist/`, `raw/`, `*.log`, `.DS_Store`, `.env`, `.env.*`

**Interfaces:**
- Consumes: nothing (repo is not yet a git repo).
- Produces: a repo with two branches — `main` (integration) and `prod` (deploy) — and one baseline commit; required by every later "Commit" step, by `refresh.yml` (T7.3 FF-push) and by Render (T8.1 deploys from `prod`).
- **Branch model (decision, binds all phases):** `main` is the only working branch — every commit, test run, and the Actions data pipeline land here. `prod` is a pure release branch: it is **always a fast-forward of `main`** (the workflow bot pushes `origin main:prod` after every run, T7.3) and it is the branch Render auto-deploys from (`branch: prod` in `render.yaml`, T8.1). Nobody commits to `prod` directly; a hotfix goes through `main` and reaches `prod` on the next FF push. If `prod` ever diverges, the bot's FF push fails loudly — reconcile with `git switch prod && git reset --hard main && git push --force-with-lease origin prod` (SPEC §7.2).

- [ ] **Step 1: Initialize and commit the baseline**

```bash
git init
git branch -M main
printf '\n# --- Parallel agent worktrees (Execution Model) ---\n.worktrees/\n' >> .gitignore
git add -A
git status --short            # expect: no raw/, dist/, node_modules, .worktrees in the list
git commit -m "chore: scaffold baseline (spec, build, fixtures, ETL stubs, site shell)"
```

Expected: exit 0; commit exists on `main`; `raw/` (contains the two real M0 samples + status file) stays untracked.

- [ ] **Step 2: Verify the scaffold is green before any changes**

Run: `npm test`
Expected: PASS — all existing tests (fixtures shape, tooling, math helpers, smoke) exit 0.

- [ ] **Step 3: Create the `prod` branch**

```bash
git switch -c prod
git switch main
git branch -vv                # expect: * main, prod — both at the baseline commit
```

- [ ] **Step 4: Document the branch model in SPEC §7**

Edit `SPEC.md` — bump the version line `**Spec version:** 1.1 (2026-08-02 audit)` to `**Spec version:** 1.2 (2026-08-02: + §7 branch model)`; in the §7.1 yaml block add `branch: prod` after `runtime: static`:

```yaml
    runtime: static
    branch: prod                 # deploy branch — Render auto-deploys ONLY this (see §7.2)
```

and append this bullet to §7.2 (directly after the Workflow A line):

```markdown
- **Branch model:** `main` is the integration branch — all code and the Actions data pipeline land there. `prod` is the release branch Render deploys from (`branch: prod` in §7.1) and is kept **always a fast-forward of `main`**: after every workflow run the bot pushes `origin main:prod` (T7.3). Nobody commits to `prod`; hotfixes flow through `main` and reach `prod` on the next FF push. A divergent `prod` makes the FF push fail loudly — reconcile with `git switch prod && git reset --hard main && git push --force-with-lease origin prod`.
```

- [ ] **Step 5: Verify + commit the spec change**

```bash
grep -n "branch: prod" SPEC.md   # expect: the §7.1 line above
npm test                         # expect: PASS (spec-only change)
git add SPEC.md
git commit -m "docs: spec §7 branch model — main integrates, prod deploys (FF push)"
```

- [ ] **Step 6: Create the GitHub remote + push both branches** (user's account; repo must be **public** so scheduled Actions runs stay free — §7.2)

```bash
gh auth status                  # confirm gh is logged in
gh repo create ukrail-viz --public --source . --remote origin --push
git push -u origin main
git push origin main:prod       # must be a fast-forward (prod == main head)
git log --oneline -1 origin/prod && git log --oneline -1 main   # expect: the same commit
```

- [ ] **Step 7: Branch-protection note** — do **not** enable PR-required protection on `main` while the bot pushes directly with `GH_PAT` (a `require_pull_request` rule blocks the bot's push and silently kills the refresh pipeline). If protection is wanted later, add the PAT as an allowed bypass. `prod` gets no rules — it is a mirror of `main` by construction.

---

### Task 0.2: Reconcile SPEC §2.3 with the scaffold (vanilla decision)

**Files:**
- Modify: `SPEC.md:106` (the keep/replace table row for d3) and the §2.3 intro line at `SPEC.md:84`

**Interfaces:**
- Consumes: scaffold reality (working vanilla Marey/People, zero deps — verified by the code audit).
- Produces: a spec consistent with the plan; rationale recorded for reviewers.

The audit showed the scaffold's `marey.js`/`people.js` render with native DOM/SVG and pure math helpers — no d3 — and that full d3 v7 (`d3@7.9.0`, ≈ 277 KB minified) would exceed the `assets/*.js` 200 KB budget unless tree-shaken through a bundler (esbuild), adding a build step and ~80–120 KB of JS to a ~40 KB hand-rolled bundle. Per SPEC §5/§8 efficiency principles and §9's "no external runtime dependencies", the site stays zero-dep vanilla; d3 v7 remains the documented fallback if a full-network visualization (M8) outgrows hand-rolled primitives.

- [ ] **Step 1: Replace the §2.3 port-table d3 row**

Edit `SPEC.md` — replace the row:

```markdown
| SVG-first rendering; keyed D3 joins | d3 v3 → **d3 v7** (ES modules; `d3.scaleTime`/`d3.area`/`d3.drag`) |
```

with:

```markdown
| SVG-first rendering; keyed joins (native `selectAll`-style helpers, pure math modules) | d3 v3 → **zero-dependency vanilla ESM** — decided 2026-08-02: the scaffold's Marey/People already render natively (~40 KB JS total vs ≥ 80–120 KB tree-shaken d3); §5/§8/§9 win. d3 v7 stays the documented fallback for a full-network scale-out (M8) |
```

- [ ] **Step 2: Amend the §2.3 intro sentence**

Edit `SPEC.md` — replace `Source audit of the [repo](https://github.com/mbtaviz/mbtaviz.github.io/) (cloned 2026-08-02) — what the site does under the hood, and what we port.` with the same sentence plus:

```markdown
  *Port decision updated 2026-08-02 (see port table): the site builds on the scaffold's zero-dependency vanilla ESM + pure math helpers instead of adopting d3 v7.*
```

- [ ] **Step 3: Verify**

Run: `grep -n "zero-dependency vanilla" SPEC.md` — expect 2 matches (§2.3 intro + port table).
Run: `npm test` — expect PASS (spec-only change).

- [ ] **Step 4: Commit**

```bash
git add SPEC.md
git commit -m "docs: spec §2.3 port decision — zero-dep vanilla ESM over d3 v7"
```

---

### Task 0.3: ETL devDependencies + content-hashed assets

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `tools/build.js` (hashing)
- Modify: `tests/tooling.test.js` (hashing test)
- Test: `tests/tooling.test.js`

**Interfaces:**
- Consumes: current `tools/build.js` (copy src→dist, budgets, size report — verified working).
- Produces: `hashFile(file)` in `src/js/hash.js` (node-safe, no imports); build.js renames `dist/assets/**` files to `name.[sha256-8].ext` and rewrites matching references in `dist/index.html` via a `Map` from old asset URL → hashed URL. Existing test 5 ("index.html references only assets that exist in `src/`") still reads `src/index.html` (un-hashed), so it stays valid.

- [ ] **Step 1: Write the failing test**

Add to `tests/tooling.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const HASH_RE = /^[a-f0-9]{8}$/;

test('build hashes assets and index.html references the hashed names', () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'dist/index.html missing');
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'expected asset references in dist/index.html');
  for (const ref of refs) {
    const parts = ref.split('/');
    const file = parts.at(-1);
    const base = file.split('.')[0];
    const hash = file.split('.')[1];
    assert.match(hash, HASH_RE, `${ref} has no 8-hex content hash`);
    assert.ok(existsSync(join(DIST, ...parts)), `${ref} missing from dist`);
    // same basename must not appear un-hashed anywhere in dist/index.html
    assert.ok(!html.includes(`${base}.js`) && !html.includes(`${base}.css`),
      `un-hashed reference to ${base} remains`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tooling.test.js`
Expected: FAIL — `dist/index.html` currently references `assets/js/marey.js` with no hash.

- [ ] **Step 3: Add the shared hash helper**

Create `src/js/hash.js`:

```js
// Pure node-safe helpers for build/ETL. No imports — usable from tools/ and src/.
import { createHash } from 'node:crypto';

export function hashFile(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}
```

- [ ] **Step 4: Implement hashing in `tools/build.js`**

In `build()`, after copying `src/` files to `dist/` and before writing the size report:

```js
// --- Content-hash assets so /assets/* immutable caching is safe (SPEC §5/§8) ---
const assetRename = new Map(); // old dist-relative URL -> hashed URL
for (const rel of listFilesUnder(DIST, 'assets')) {
  const abs = join(DIST, rel);
  const ext = extname(rel);
  const dir = dirname(rel);
  const base = basename(rel, ext);
  const hash = hashFile(readFileSync(abs));
  const hashedRel = join(dir, `${base}.${hash}${ext}`);
  renameSync(abs, join(DIST, hashedRel));
  assetRename.set('/' + rel, '/' + hashedRel);
}
// Rewrite references in the copied index.html
const htmlPath = join(DIST, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
for (const [oldUrl, newUrl] of assetRename) {
  html = html.split(oldUrl).join(newUrl);
}
writeFileSync(htmlPath, html);
```

Add the small helpers (`listFilesUnder(dir, root)` recursive walk, `extname`/`basename`/`dirname` from `node:path`, `readFileSync`/`writeFileSync`/`renameSync` from `node:fs`) at the top of `build.js`. **Budget check order matters:** run the budget/size-report pass *after* hashing so `assets/*.js` caps apply to the final files.

- [ ] **Step 5: Add devDependencies**

```bash
npm install --save-dev saxes@6.0.0 stompit@1.0.0
```

Expected: `package.json` devDependencies = `{ "saxes": "^6.0.0", "stompit": "^1.0.0" }`; `package-lock.json` updated.

- [ ] **Step 6: Run all tests + build**

Run: `npm test && npm run build`
Expected: PASS; `npm run build` exits 0 and the size report shows hashed asset names.

- [ ] **Step 7: Verify the hash test specifically**

Run: `node --test tests/tooling.test.js`
Expected: the new hashing test PASSES; the pre-existing test 5 (src references) still PASSES.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tools/build.js src/js/hash.js tests/tooling.test.js
git commit -m "build: content-hash assets; add ETL devDeps (saxes, stompit)"
```

---

## Phase 1 — ETL core (SPEC M1)

### Task 1.0: Align fixtures to the §6.4 contract

**Files:**
- Modify: `tools/fixtures.js`
- Modify: `budgets.json`
- Modify: `tests/tooling.test.js` (fixture-shape expectations)
- Test: `tests/fixtures.test.js` (new)

**Interfaces:**
- Consumes: SPEC §6.4 schemas; existing fixture shapes (verified by audit: `network.json`, `marey-trips.json`, `station-frequency.json`, `station-usage.json`, `delay.json`, `average-actual-delays.json`, `commute-PAD.json`, `live.json`, `toc.json` are close; `schedule-gwml.json` diverges; `stations.json` missing; `marey-trips.json` is monolithic).
- Produces: every fixture file matches §6.4 exactly, plus the new day/line-split trip files, `stations.json`, `marey-index.json`, `live-delta.json`. `data/` fixture set becomes the stable contract for `derive.js` to overwrite with real data.

- [ ] **Step 1: Write the failing contract tests**

Create `tests/fixtures.test.js` asserting, per artifact (all read from `data/` after `npm run fixtures`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const json = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const crsRe = /^[A-Z]{3}$/;

test('stations.json exists with §6.4 shape', () => {
  const s = json('stations.json');
  assert.ok(Array.isArray(s) && s.length > 0);
  for (const st of s) {
    assert.match(st.crs, crsRe);
    assert.equal(typeof st.name, 'string');
    assert.equal(typeof st.lat, 'number');
    assert.equal(typeof st.lon, 'number');
    assert.equal(typeof st.tiploc, 'string');
    assert.equal(typeof st.stanox, 'string');
    assert.equal(typeof st.usage, 'number');
  }
});

test('schedule-*.json files match §6.4 shape', () => {
  const files = readdirSync(DATA).filter((f) => /^schedule-.+\.json$/.test(f));
  assert.ok(files.length >= 1, 'at least one schedule-{line}.json');
  for (const f of files) {
    const sched = json(f);
    assert.ok(Array.isArray(sched));
    for (const svc of sched) {
      assert.ok(svc.uid && svc.headcode && svc.toc && svc.stp);
      assert.ok(Array.isArray(svc.departures) && svc.departures.every((d) => crsRe.test(d.crs) && Number.isInteger(d.time)));
      assert.ok(Array.isArray(svc.stops) && svc.stops.every((x) => crsRe.test(x.crs) && Number.isInteger(x.planned_time)));
    }
  }
});

test('marey trips are split per day+line with an index', () => {
  const idx = json('marey-index.json');
  assert.ok(idx.days.length >= 1);
  assert.ok(idx.lines.length >= 1);
  for (const day of idx.days) {
    for (const line of day.lines) {
      const f = `marey-trips-${day.date}-${line.line}.json`;
      assert.ok(existsSync(join(DATA, f)), `${f} missing`);
      const trips = json(f);
      assert.ok(Array.isArray(trips));
      for (const t of trips) {
        assert.ok(t.service && t.line && Number.isInteger(t.begin) && Number.isInteger(t.end));
        assert.ok(Array.isArray(t.stops) && t.stops.length >= 2);
        assert.ok(t.stops.every((s) => crsRe.test(s.stop) && Number.isInteger(s.time)));
        assert.ok(t.begin < t.end);
      }
    }
  }
});

test('no monolithic marey-trips.json remains', () => {
  assert.ok(!existsSync(join(DATA, 'marey-trips.json')));
});

test('live-delta.json shape', () => {
  const d = json('live-delta.json');
  assert.ok(Number.isInteger(d.refreshed_at) || typeof d.refreshed_at === 'string');
  assert.ok(Array.isArray(d.changed) && Array.isArray(d.removed));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run fixtures && node --test tests/fixtures.test.js`
Expected: FAIL — `stations.json` absent, `schedule-gwml.json` wrong shape, monolithic `marey-trips.json` still present, no `marey-index.json`/`live-delta.json`.

- [ ] **Step 3: Rework `tools/fixtures.js`**

Keep the GWML corridor (PAD→RDG→DID→SWI→BATH→BRI) but now:
- Emit `stations.json` — one entry per stop CRS with plausible lat/lon (e.g. PAD 51.5168/-0.1270, RDG 51.4593/-0.9733, DID 51.6123/-1.1447, SWI 51.5612/-1.7923, BATH 51.3775/-2.3569, BRI 51.4497/-2.5819), `tiploc`/`stanox` placeholders (`PADTON`, `PADTON` style), `usage` ints.
- Emit `schedule-gwml.json` with the §6.4 shape: each service `{uid, headcode, toc, stp, origin, destination, departures:[{crs, time}], stops:[{crs, planned_time}]}` with integer minutes-since-midnight times (derive from the existing 06:00–20:00 pattern).
- Split trips: write `marey-trips-2025-04-01-gwml.json` (the fixture anchor date) from the current `marey-trips.json` contents; write `marey-index.json` `{days:[{date:'2025-04-01', lines:[{line:'gwml', count}]}], lines:[{id:'gwml', name:'Great Western Main Line', color:'#0a7d33'}]}`.
- Add `live-delta.json` `{refreshed_at: 0, changed: [], removed: []}` (empty delta is valid).
- Delete the old `data/marey-trips.json` on run (fixtures regenerate `data/` deterministically — `rmSync` the known artifact list first).

- [ ] **Step 4: Update `budgets.json`**

Replace the `data/marey-trips.json` entry with:

```json
{ "match": "data/marey-trips-*.json", "maxBytes": 250000, "note": "The Trains — per day+line (SPEC §6.4/§8 R-11)" },
{ "match": "data/marey-index.json", "maxBytes": 20000, "note": "Marey day/line index" },
```

and add:

```json
{ "match": "data/stations.json", "maxBytes": 200000, "note": "station index (SPEC §6.4)" },
{ "match": "data/live-delta.json", "maxBytes": 50000, "note": "live session delta (SPEC §8)" }
```

- [ ] **Step 5: Update the stale expectations in `tests/tooling.test.js`**

Any test asserting on `data/marey-trips.json` must switch to the index + day/line files. Check test 4 (`marey-trips.json is a non-empty, time-ordered trip set`) and smoke-test.js — update both to read the `marey-index.json` + first day/line file instead.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run build`
Expected: PASS — fixtures contract tests green; build passes budgets; size report present.

- [ ] **Step 7: Commit**

```bash
git add tools/fixtures.js budgets.json tests/fixtures.test.js tests/tooling.test.js tools/smoke-test.js data
git commit -m "fixtures: align data/ to SPEC §6.4 contract (stations, schedule, day+line trips)"
```

---

### Task 1.1: Real S3 collection (aws CLI) + R2 mirror

**Files:**
- Modify: `tools/etl/collect.js`
- Create: `.env.example`
- Create: `tools/etl/serialize.js`
- Test: `tests/etl.test.js` (new)

**Interfaces:**
- Consumes: SPEC §3.1 (bucket `darwin.xmltimetable`, prefix `PPTimetable/`, files `{ts}_v{n}.xml.gz` / `{ts}_ref_v99.xml.gz`, upload ~02:10 UTC, several revisions/day — take the day's highest `v{n}`); AWS CLI with profile `darwin` (local) or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env (Actions).
- Produces: `raw/timetable/{ts}_v{n}.xml.gz`, `raw/ref/{ts}_ref_v{n}.xml.gz`, `raw/misc/naptan.csv`, `raw/misc/orr-station-usage.csv`, `raw/collect-status.json` `{status:'ok'|'skipped'|'error', files:[...], mirroredR2:boolean, createdAt, error?}`. `serialize.js` exports `writeJson(path, obj)` (minified, 1-line, LF) + `assertBudget(rel, bytes)`.

- [ ] **Step 1: Write the failing tests**

In `tests/etl.test.js` (pure-node, no network):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHighestVersion, listS3Keys, statusShape } from '../tools/etl/collect.js';

test('pickHighestVersion selects the day highest v{n}', () => {
  const keys = [
    'PPTimetable/20260802020300_v4.xml.gz',
    'PPTimetable/20260802020500_v8.xml.gz',
    'PPTimetable/20260802020500_v7.xml.gz',
  ];
  assert.equal(pickHighestVersion(keys), 'PPTimetable/20260802020500_v8.xml.gz');
});

test('pickHighestVersion prefers ref v99 for the ref side', () => {
  const keys = ['PPTimetable/20260802020500_ref_v99.xml.gz', 'PPTimetable/20260802020500_ref_v8.xml.gz'];
  assert.equal(pickHighestVersion(keys, { ref: true }), 'PPTimetable/20260802020500_ref_v99.xml.gz');
});

test('collect-status shape', () => {
  assert.ok(statusShape({ status: 'skipped', reason: 'x', missingEnvVars: ['A'], next: 'y', createdAt: 1 }));
});
```

Export those helpers from `collect.js` as named functions (node-safe, no side effects). `statusShape` validates `{status ∈ {ok,skipped,error}, createdAt:number, ...}`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/etl.test.js`
Expected: FAIL — imports don't exist yet.

- [ ] **Step 3: Implement `collect.js`**

Add to the existing env-gated flow (keep the `skipped` path when `DARWIN_S3_KEY_ID`/`DARWIN_S3_SECRET` are missing):

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAW = join(ROOT, 'raw');
const BUCKET = 'darwin.xmltimetable';

function aws(args, env) {
  // local: profile 'darwin' (user's machine); CI: env creds already present
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

export async function collect({ profile = 'darwin', mirrorR2 = !!process.env.R2_ENDPOINT } = {}) {
  const missing = ['DARWIN_S3_KEY_ID', 'DARWIN_S3_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    writeFileSync(join(RAW, 'collect-status.json'), JSON.stringify(
      statusShape({ status: 'skipped', reason: 'missing env', missingEnvVars: missing, next: 'set env or run with profile', createdAt: Date.now() }), null, 0));
    return { status: 'skipped' };
  }
  mkdirSync(join(RAW, 'timetable'), { recursive: true });
  mkdirSync(join(RAW, 'ref'), { recursive: true });
  mkdirSync(join(RAW, 'misc'), { recursive: true });
  const listing = aws(['s3', 'ls', `s3://${BUCKET}/PPTimetable/`]);
  const keys = listing.split('\n').map((l) => l.split(/\s+/).at(-1)).filter((k) => k.endsWith('.xml.gz'));
  const timetable = pickHighestVersion(keys);
  const ref = pickHighestVersion(keys, { ref: true });
  const files = [];
  for (const key of [timetable, ref]) {
    if (!key) continue;
    const local = join(RAW, key.includes('_ref_') ? 'ref' : 'timetable', key.split('/').at(-1));
    aws(['s3', 'cp', `s3://${BUCKET}/${key}`, local]);
    files.push({ key, local });
    if (mirrorR2) {
      aws(['s3', 'cp', local, `s3://${process.env.R2_BUCKET}/${key}`, '--endpoint-url', process.env.R2_ENDPOINT,
        '--profile', process.env.R2_PROFILE || 'r2']);
    }
  }
  writeFileSync(join(RAW, 'collect-status.json'), JSON.stringify(statusShape({
    status: 'ok', files, mirroredR2: mirrorR2, createdAt: Date.now() }), null, 0));
  return { status: 'ok', files };
}
```

Also add `fetchNaPTAN` + `fetchORR` steps (curl → `raw/misc/`), executed when the env `FETCH_AUX=1` (they are public but large; keep them out of the fast path). Note: the M0 samples already sit loose in `raw/` as `20260802020500_v8.xml.gz` + `20260802020500_ref_v99.xml.gz` — the first real run replaces/duplicates them under `raw/timetable/` + `raw/ref/`; keep both (gitignored).

- [ ] **Step 4: Write `.env.example`**

```bash
# Darwin S3 (raildata.org.uk → My Feeds → Darwin → "Darwin File Information")
DARWIN_S3_KEY_ID=
DARWIN_S3_SECRET=
# NROD (publicdatafeeds.networkrail.co.uk + STOMP 61612)
NROD_USER=
NROD_PASS=
# Cloudflare R2 (rolling archive, SPEC §6.2)
R2_ENDPOINT=
R2_BUCKET=
R2_PROFILE=
# GitHub (refresh.yml)
GH_PAT=
```

- [ ] **Step 5: Run the unit tests**

Run: `node --test tests/etl.test.js`
Expected: PASS.

- [ ] **Step 6: Manual integration (local machine, real bucket)**

```bash
AWS_PROFILE=darwin node tools/etl/collect.js
cat raw/collect-status.json
```

Expected: status `ok`; `raw/timetable/20260802020500_v8.xml.gz` (10.0 MB) and `raw/ref/20260802020500_ref_v99.xml.gz` (231 KB) present. (If the bucket has moved on, the day's highest `v{n}` is downloaded instead.)

- [ ] **Step 7: Commit**

```bash
git add tools/etl/collect.js tools/etl/serialize.js tests/etl.test.js .env.example
git commit -m "etl: real S3 collection via aws CLI + R2 mirror + status contract"
```

---

### Task 1.2: Streaming timetable/ref parser (gunzip → saxes) + `stations.json`

**Files:**
- Create: `config/poc.json`
- Create: `tools/etl/xml.js`
- Create: `tools/etl/corridors.js`
- Modify: `tools/etl/normalize.js` (real `buildStationIndex`)
- Test: `tests/etl.test.js`

**Interfaces:**
- Consumes: `raw/timetable/{ts}_v{n}.xml.gz` + `raw/ref/{ts}_ref_v{n}.xml.gz` (real M0 samples present); SPEC §3.1 format (`PportTimetable` v8, namespace `http://www.thalesgroup.com/rtti/XmlTimetable/v8`, no DTD).
- Produces:
  - `parseTimetable(gzPath, filter)` → async generator of `schedule` objects `{uid, headcode, toc, stp, days_runs, start_date, end_date, origin, destination, calling:[{tiploc, crs, pta, ptd, platform, activity}]}` — only schedules whose calling pattern touches the filter, with out-of-region stops pruned.
  - `parseRef(gzPath)` → `{ byTiploc: Map, toc: Map }` (`tiploc → {crs, name, stanox?}`).
  - `stationsFrom(refMap, naptanRows, usageRows)` → §6.4 `stations.json` array.
  - `buildStationIndex(...)` in `normalize.js` — real implementation replacing the placeholder.

- [ ] **Step 1: Write the failing tests (against the real captured sample)**

```js
import { parseTimetable, parseRef } from '../tools/etl/xml.js';
import { loadPoc } from '../tools/etl/corridors.js';

const TS = '20260802020500';

test('ref file parses to a TIPLOC map (real sample)', async () => {
  const ref = await parseRef(`raw/ref/${TS}_ref_v99.xml.gz`);
  assert.ok(ref.byTiploc.size > 5000, `expected >5000 TIPLOCs, got ${ref.byTiploc.size}`);
  const pad = ref.byTiploc.get('PADTON');
  assert.ok(pad, 'PADTON present');
  assert.equal(pad.crs, 'PAD');
  assert.ok(ref.toc.size > 5, 'TOC map populated');
});

test('timetable streams and filters to the PoC station set', async () => {
  const poc = await loadPoc('config/poc.json');
  let kept = 0, total = 0;
  for await (const s of parseTimetable(`raw/timetable/${TS}_v8.xml.gz`, poc)) {
    total++;
    if (s.calling.length) kept++;
    assert.ok(Array.isArray(s.calling) && s.uid);
  }
  assert.ok(kept > 100, `expected >100 PoC schedules, got ${kept}`);
  // eastern subset is ~10–15% of the national file (§6.7)
  assert.ok(kept < total * 0.25, `filter kept too much: ${kept}/${total}`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/etl.test.js`
Expected: FAIL — `xml.js`/`corridors.js` don't exist.

- [ ] **Step 3: Create `config/poc.json` from SPEC §4**

The corridor list is fixed by §4; the exact CRS set must be *discovered* (each corridor's stations). Structure:

```json
{
  "region": "eastern",
  "windowDays": 7,
  "lines": [
    { "id": "c2c", "name": "c2c", "color": "#1e56a0", "operators": ["CC"], "terminals": ["FST"],
      "describe": "Fenchurch Street -> Shoeburyness, via Basildon; via Grays + Rainham" },
    { "id": "ga", "name": "Greater Anglia", "color": "#7a003c", "operators": ["LE"],
      "terminals": ["LST"],
      "describe": "GEML fast/slow to Norwich; West Anglia to Cambridge; Stansted Express; selected local branches" },
    { "id": "xc", "name": "CrossCountry (selected)", "color": "#a4a4a4", "operators": ["XR"],
      "terminals": [],
      "describe": "Birmingham <-> Cambridge <-> Stansted via Peterborough/Ely; any XC service calling at >= 2 PoC stations" },
    { "id": "gn", "name": "Great Northern (selected)", "color": "#00a8e1", "operators": ["TL"],
      "terminals": ["KGX", "MOO"],
      "describe": "King's Cross -> Cambridge via Welwyn; King's Cross -> Peterborough; Moorgate Northern City Line / Hertford Loop" }
  ],
  "stationSet": { "crs": [], "tiploc": [] },
  "commuteOrigins": ["FST", "LST", "KGX", "MOO", "CBG", "PBX", "NRW", "IPS", "SOS", "STN"],
  "stationUsageFile": "raw/misc/orr-station-usage.csv"
}
```

`stationSet` starts empty and is filled by a discovery step: parse the ref file's `LocationRef` list, keep entries whose CRS is on any line's route (terminals + the station names from `describe` matched against ref names is fragile — instead: run a first pass of `parseTimetable` with an empty filter to count per-operator schedules, then use the spec's measured counts (c2c 795, GA 2,833, XC 2,184, TL 1,912 on 2026-08-02) as the sanity gate. See Step 6.

- [ ] **Step 4: Implement `tools/etl/xml.js`**

```js
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { SaxesParser } from 'saxes';

// Streams raw/{timetable,ref}/*.xml.gz through saxes, never materialising the DOM.
// Emits plain objects; the caller filters. Peak RSS well under 500 MB (§6.7).
// Journey attributes (TiplocV3): uid, ssd (start date), ned (end date), toc, stp,
// days (runs mask), trainId (WTT headcode). Location attributes: tpl, crs, pta,
// ptd, plat, act. Emitted shape matches the §6.4 / T1.2 Step 2 contract; exact
// attribute names (notably `ned`) are confirmed against the sample at T1.2 Step 6.
export async function parseTimetable(gzPath, filter) {
  const out = [];
  const parser = new SaxesParser();
  let cur = null;
  let error = null;

  parser.on('opentag', (node) => {
    const t = node.name.replace(/^.*:/, '');
    if (t === 'Journey') {
      const a = node.attributes;
      cur = {
        uid: a.uid ?? null, headcode: a.trainId ?? null, toc: a.toc ?? null,
        stp: a.stp ?? null, days_runs: a.days ?? null,
        start_date: a.ssd ?? null, end_date: a.ned ?? null,
        origin: null, destination: null, calling: [],
      };
    } else if (t === 'Location' && cur) {
      const a = node.attributes;
      cur.calling.push({
        tiploc: a.tpl ?? null, crs: a.crs ?? null, pta: a.pta ?? null,
        ptd: a.ptd ?? null, platform: a.plat ?? null, activity: a.act ?? null,
      });
    }
  });

  parser.on('closetag', (name) => {
    const t = name.replace(/^.*:/, '');
    if (t !== 'Journey' || !cur) return;

    // origin/destination: first/last stop with T / TB (begins) / TF (finishes).
    const isStop = (s) => (s.activity || '').split(/\s+/).some(
      (c) => c === 'T' || c === 'TB' || c === 'TF');
    const first = cur.calling.find(isStop);
    const last = [...cur.calling].reverse().find(isStop);

    // PoC corridor stops only; a journey with no PoC stop is dropped (§4 counts gate).
    const calling = cur.calling.filter((s) => filter.stationSet.crs.includes(s.crs));
    if (calling.length > 0) {
      out.push({
        uid: cur.uid, headcode: cur.headcode, toc: cur.toc, stp: cur.stp,
        days_runs: cur.days_runs, start_date: cur.start_date, end_date: cur.end_date,
        origin: first ? { crs: first.crs, tiploc: first.tiploc, time: first.ptd ?? first.pta } : null,
        destination: last ? { crs: last.crs, tiploc: last.tiploc, time: last.pta ?? last.ptd } : null,
        calling,
      });
    }
    cur = null;
  });

  parser.on('error', (err) => { error = err; });

  // saxes is event-driven push: feed each gunzipped chunk straight in — no DOM,
  // no intermediate array of raw strings, so a 10 MB timetable stays in memory
  // as parsed objects only (filtered to the PoC corridor by the caller).
  for await (const chunk of createReadStream(gzPath).pipe(createGunzip())) {
    await parser.write(chunk);
  }
  if (error) throw error;
  return out;
}
```

`parseRef(gzPath)` — same loop, `LocationRef` elements (`tpl`, `locname`, `crs`, plus `TOC` elements): returns `{ byTiploc: Map(tpl → {crs, name, stanox: null}), toc: Map(code → name) }`. `toc.json` is derived from the TOC map + colour assignment in `derive.js`.

`stationsFrom(refMap, naptanRows, usageRows)` — joins `byTiploc` → CRS with NaPTAN CSV rows (ATCO, name, lat, lon) and ORR rows (`CRS Code`, `Entries & Exits`); emits `stations.json`.

- [ ] **Step 5: Implement `normalize.js` `buildStationIndex`**

Replace the placeholder body — same return shape as today (`{corpus, naptan, byStanox: Map, byCrs: Map}`) but populated: `byCrs.set(entry.crs, entry)` from the ref map; `byStanox` filled from CORPUS when available (M1.5), else empty — STANOX isn't in the ref file, so TRUST joins stay on TIPLOC→CRS until CORPUS lands.

- [ ] **Step 6: Populate + gate the PoC station set**

Add a `--discover` flag to a small `tools/etl/discover.js`: runs `parseTimetable` with no filter, groups by `toc`, and writes `raw/discovery.json` `{tocCounts: {CC: n, LE: n, XR: n, TL: n}, stations: {crs: n}}`. Manual step:

```bash
node tools/etl/discover.js raw/timetable/20260802020500_v8.xml.gz
```

Gate: `raw/discovery.json.tocCounts` for CC/LE/XR/TL must be within ±20% of SPEC §4's measured counts (795/2833/2184/1912). Then decide the XC "selected" rule (SPEC §12 Q3 default: any XC service calling at ≥ 2 PoC stations), fill `config/poc.json` `stationSet` (CRS + TIPLOC for c2c/GA/GN routes + XC matches), and re-run the T1.2 filter test — `kept` should land in the ~10–15% band.

- [ ] **Step 7: Run the ETL tests**

Run: `node --test tests/etl.test.js`
Expected: PASS (ref parse > 5000 TIPLOCs; timetable filter keeps 10–15% of schedules; PADTON→PAD).

- [ ] **Step 8: Commit**

```bash
git add config/poc.json tools/etl/xml.js tools/etl/corridors.js tools/etl/discover.js tools/etl/normalize.js tests/etl.test.js
git commit -m "etl: streaming saxes timetable/ref parser with PoC station filter"
```

---

### Task 1.3: Planned-side artifact derivation

**Files:**
- Modify: `tools/etl/derive.js`
- Test: `tests/etl.test.js`

**Interfaces:**
- Consumes: `parseTimetable`/`parseRef` output (T1.2), `config/poc.json`, `raw/misc/orr-station-usage.csv`, `raw/misc/naptan.csv`, `stations.json` (T1.2).
- Produces (all §6.4, minified via `serialize.writeJson`): `data/network.json` (lines from `config/poc.json`; stops = discovered station CRS; schematic x/y from an equirectangular projection over the PoC bounding box with per-line nudges), `data/schedule-{line}.json` (planned, per line, §6.4 shape), `data/station-frequency.json` (per-hour arrivals/departures per station from the schedule), `data/station-usage.json` (ORR, `{stations, max, min, mean}`), `data/toc.json` (from ref TOC map + colour table). Deterministic: same input → identical bytes (sorted, deduped).

- [ ] **Step 1: Write the failing tests**

```js
import { derivePlanned } from '../tools/etl/derive.js';
import { loadPoc } from '../tools/etl/corridors.js';

test('network.json is self-consistent', async () => {
  const net = await derivePlanned({ cfg: await loadPoc('config/poc.json'), stations: [], rawDir: 'raw' });
  for (const seg of net.segments) {
    assert.ok(seg.line && seg.from_crs && seg.to_crs);
    assert.ok(seg.stations.length >= 2);
    for (const crs of seg.stations) assert.ok(net.stops.some((s) => s.crs === crs));
  }
});

test('station-frequency buckets are per-hour and sorted', () => {
  // consume a fixture-derived station-frequency.json and assert 24 hourly buckets, ints
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/etl.test.js`
Expected: FAIL — `derivePlanned` not exported.

- [ ] **Step 3: Implement `derivePlanned` in `derive.js`**

Core algorithm, per line in `config/poc.json`: gather kept schedules (T1.2 output) for its operators; sort by `uid`; build the station sequence from the calling pattern (CRS order); projection: `x = (lon - lonMin) * kx`, `y = (latMax - lat) * ky` over the PoC bbox (equirectangular, SPEC §6.3.4), with a per-line `nudge: {x, y}` table in `config/poc.json` for legibility; emit segments per consecutive station pair. Frequency: count per (crs, hour, direction) across the schedule's `days_runs` — weekday/offpeak averages per §2.2's `averagesByType` shape. Sort all arrays; `JSON.stringify` without spaces; assert every artifact ≤ its `budgets.json` cap via `serialize.assertBudget`.

- [ ] **Step 4: Run the ETL tests + smoke**

Run: `node --test tests/etl.test.js && npm run smoke`
Expected: PASS — smoke-test's cross-artifact CRS consistency (every marey stop ∈ network stops ∈ station-usage) holds for real derived data.

- [ ] **Step 5: Commit**

```bash
git add tools/etl/derive.js tests/etl.test.js config/poc.json
git commit -m "etl: derive planned artifacts (network, schedule-*, frequency, usage, toc)"
```

---

### Task 1.4: HSP client + actuals derivation (marey trips, delays, commute)

**Files:**
- Create: `tools/etl/hsp.js`
- Modify: `tools/etl/derive.js`
- Test: `tests/etl.test.js`

**Interfaces:**
- Consumes: SPEC §6.2 (HSP: `serviceMetrics` by from/to+date+HHMM → matched RIDs; `serviceDetails` by RID → per-location `gbtt_pta/ptd` + `actual_ta/td`, cancellation reasons; Basic Auth with `NROD_USER`/`NROD_PASS`; rate cap ~5,000 req/hr; cache by `(from,to,date)` in R2), `config/poc.json` (commute origins + windowDays), TRUST BST fix (normalize.js).
- Produces:
  - `hspClient({user, pass, cache})` → `{ metrics(from, to, date, hhmm), details(rid), close() }` — batching + `(from,to,date)` cache keys, `429`-aware backoff (sleep 60 s on rate-limit).
  - `deriveActuals(...)` → `data/marey-trips-{date}-{line}.json` + `marey-index.json`, `data/average-actual-delays.json`, `data/delay.json` (7×96 buckets), `data/commute-{origin}.json` (per-origin).

- [ ] **Step 1: Write the failing tests**

```js
import { deriveActuals, buildDelayBuckets } from '../tools/etl/derive.js';

test('delay.json has 7 days x 96 buckets and the §6.4 shape', () => {
  const trips = []; // 8 sampled eastern trips: {line, begin, end, stops:[{stop, time}]}
  const delay = buildDelayBuckets(trips, { days: 7, windowDays: 7 });
  assert.equal(delay.length, 7 * 96);
  assert.ok(delay.every((b) => Number.isInteger(b.secOfDay) && b.ins && b.outs && b.ins_total));
  assert.ok(delay.every((b) => b.day >= 0 && b.day <= 6));
});

test('commute rollups key by destination and expose p10/p50/p90', () => {
  // from 30 sampled OD pairs: result [[hour,[p10,p50,p90],[p10,p50,p90]]...] sorted by hour
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/etl.test.js`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement `tools/etl/hsp.js`**

```js
import { fetch } from 'node:fetch'; // node >= 18: global fetch

export function hspClient({ user, pass, cache = new Map() }) {
  const base = process.env.HSP_ENDPOINT || 'https://hsp-prod.rockshore.net/api/v1';
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function post(path, body) {
    const res = await fetch(`${base}/${path}`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 429) { await sleep(60_000); return post(path, body); }
    if (!res.ok) throw new Error(`HSP ${path}: HTTP ${res.status}`);
    return res.json();
  }

  return {
    async metrics(from, to, date, hhmm) {
      const key = `metrics|${from}|${to}|${date}|${hhmm}`;
      if (cache.has(key)) return cache.get(key);
      const out = await post('serviceMetrics', {
        from_loc: from, to_loc: to, from_time: hhmm, to_time: hhmm, from_date: date, to_date: date,
      });
      cache.set(key, out);
      return out;
    },
    async details(rid) {
      const key = `details|${rid}`;
      if (cache.has(key)) return cache.get(key);
      const out = await post('serviceDetails', { rid });
      cache.set(key, out);
      return out;
    },
    close() {},
  };
}
```

The R2-backed cache (`(from,to,date)` per §6.2) is implemented by seeding `cache` from R2 objects (`aws s3 cp`/`get-object` on cache keys) and writing back at `close()` — behind `R2_ENDPOINT` env, no-op locally.

- [ ] **Step 4: Implement `buildDelayBuckets` + `deriveActuals` in `derive.js`**

`buildDelayBuckets(trips, {days, windowDays})`: initialise 7×96 zeroed buckets `{day, secOfDay: i*900, time, ins:{}, outs:{}, ins_total:0, lines:[]}`; for each trip walk its stops, add 1 to `ins[dst]`/`outs[src]` at the bucket of the arrival/departure; per line accumulate `delay_actual` as `(actual_seg − avg_seg) / avg_seg` using `average-actual-delays.json` (relative metric, §2.2/§6.4). `deriveActuals` orchestrates: for each commute origin × destination (from `config/poc.json` × station set), call `hsp.metrics` per hour 05–23, then `hsp.details` for each RID, apply `bstCorrectionMs` to every timestamp, group by service UID → `marey-trips-{date}-{line}.json`, and compute the per-hour p10/p50/p90 transit (origin dep → dest arr) + wait (actual vs planned dep) arrays per §6.4 derivation rules. All outputs via `serialize.writeJson`; empty OD pairs are omitted.

- [ ] **Step 5: Manual integration (needs NROD creds + network)**

```bash
NROD_USER=... NROD_PASS=... FETCH_AUX=1 npm run pipeline
```

Expected: real `data/marey-trips-*.json` + `delay.json` + `commute-*.json` for the PoC; smoke + build pass; sizes within §8 caps. If HSP is unreachable (account/permissions — SPEC §12 Q2/Q8), the run keeps fixtures and reports `collect-status.json` `status:'error'` with the reason — the pipeline must never ship broken output.

- [ ] **Step 6: Commit**

```bash
git add tools/etl/hsp.js tools/etl/derive.js tests/etl.test.js
git commit -m "etl: HSP actuals -> marey trips, delay buckets, commute rollups"
```

---

## Phase 2 — Site foundation (SPEC M2 groundwork)

### Task 2.1: Parallel dataloader + section registry

**Files:**
- Modify: `src/js/dataloader.js`
- Create: `src/js/sections.js`
- Modify: `src/index.html`
- Test: `tests/tooling.test.js` (pure load-plan helper)

**Interfaces:**
- Consumes: current sequential `dataloader.js` (`export const ready` → `{key: payload}`, 9 entries).
- Produces:
  - `LOAD_PLAN` — object `{common: [[key, url]…], sections: {marey: [[key,url]…], usage: […], delay: […], commute: […], live: […]}}` — a pure, node-safe data structure (testable without DOM).
  - `export const ready` — `Promise.all` over every URL in `common` **plus** each section's plan, resolving to `{key: payload}` per section so each section module receives only its own data.
  - `registerSection(slot, module)` / `bootSections()` in `sections.js` — finds `[data-viz-slot]` elements, `import()`s the section module, calls its `mount(slotEl, data)` export. Lazy: only sections present in the DOM boot (all five are, but the mechanism is the M8 scale-up hook).
  - `src/index.html`: five sections + header glyph slot + attribution footer.

- [ ] **Step 1: Write the failing test**

```js
import { LOAD_PLAN } from '../src/js/dataloader.js';

test('LOAD_PLAN covers every §6.4 artifact with no duplicates', () => {
  const urls = new Set();
  for (const [, u] of LOAD_PLAN.common) assert.ok(!urls.has(u) && urls.add(u));
  for (const key of ['marey', 'usage', 'delay', 'commute', 'live']) {
    assert.ok(Array.isArray(LOAD_PLAN.sections[key]), `${key} section plan`);
    for (const [, u] of LOAD_PLAN.sections[key]) assert.ok(!urls.has(u) && urls.add(u));
  }
  assert.ok(LOAD_PLAN.common.some(([k]) => k === 'stations'));
  assert.ok(LOAD_PLAN.common.some(([k]) => k === 'toc'));
  assert.ok(LOAD_PLAN.sections.marey.some(([k]) => k.startsWith('trips')));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tooling.test.js`
Expected: FAIL — `LOAD_PLAN` not exported.

- [ ] **Step 3: Implement `LOAD_PLAN` + parallel `ready` in `dataloader.js`**

```js
export const LOAD_PLAN = {
  common: [
    ['stations', 'data/stations.json'],
    ['network', 'data/network.json'],
    ['toc', 'data/toc.json'],
  ],
  sections: {
    marey: [['index', 'data/marey-index.json']],
    usage: [['freq', 'data/station-frequency.json'], ['usage', 'data/station-usage.json']],
    delay: [['delay', 'data/delay.json'], ['delays', 'data/average-actual-delays.json']],
    commute: [],            // per-origin files load on demand (T6.1)
    live: [['live', 'data/live.json']],
  },
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export const ready = (async () => {
  const out = {};
  const all = [...LOAD_PLAN.common, ...Object.values(LOAD_PLAN.sections).flat()];
  const results = await Promise.allSettled(all.map(async ([key, url]) => [key, await fetchJson(url)]));
  for (const r of results) {
    if (r.status === 'fulfilled') out[r.value[0]] = r.value[1];
    else console.warn('dataloader:', r.reason?.message ?? r.reason);
  }
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const el = document.getElementById('data-status');
  if (el) { el.textContent = `✓ ${ok}/${all.length} payloads loaded`; el.setAttribute('aria-live', 'polite'); }
  window.UKRailViz = { data: out, loadedAt: Date.now() };
  return out;
})();
```

Note: Marey's per-day/per-line trip files are **not** in `LOAD_PLAN` (that's the heavy payload, §8) — `marey.js` fetches them after the user picks a day (T3.1). The old sequential loop and the 9-entry constant are removed; the status line contract stays.

- [ ] **Step 4: Implement `sections.js`**

```js
import { ready } from './dataloader.js';

const registry = {
  marey: () => import('./marey.js'),
  usage: () => import('./people.js'),
  delay: () => import('./delay.js'),
  commute: () => import('./commute.js'),
  live: () => import('./live.js'),
};

export async function bootSections(root = document) {
  const data = await ready;
  for (const [slot, load] of Object.entries(registry)) {
    const el = root.querySelector(`[data-viz-slot="${slot}"]`);
    if (!el) continue;
    const mod = await load();
    if (typeof mod.mount === 'function') mod.mount(el, data);
  }
}
```

`index.html` gets a boot script (`<script type="module"> import { bootSections } from './assets/js/sections.js'; bootSections(); </script>`) replacing the current per-module imports.

- [ ] **Step 5: Shell additions in `src/index.html`**

- Header glyph slot: `<div class="viz-slot" data-viz-slot="marey-header"></div>` inside `<header>` (booted by `header.js`, T3.3).
- Attribution footer per §9/R-5:

```html
<footer class="site-footer">
  <p>Data: Network Rail <a href="https://www.nationalrail.co.uk/developers/darwin-data-feeds/">Darwin</a> timetable &amp; performance feeds, licensed under the
  <a href="https://www.nationalrail.co.uk/">Open Government Licence v2.0</a> with NRE variations.
  <img src="assets/img/nre-logo.svg" alt="Powered by National Rail Enquiries" width="120" height="28" loading="lazy"></p>
  <p>Live platform numbers are time-bound and suppressed per feed direction. Not an official National Rail product.</p>
</footer>
```

(Add `src/assets/img/nre-logo.svg` — a single-colour NRE mark; if the official logo asset isn't obtainable at build time, keep the text attribution only and note it in §9.) The existing test 5 ("no http refs, files exist in src/") validates this.

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build && npx serve dist -l 4173` then open `http://localhost:4173` — Marey + People must render (as before), no console errors, `#data-status` shows `✓ … payloads loaded`.

- [ ] **Step 7: Commit**

```bash
git add src/js/dataloader.js src/js/sections.js src/index.html tests/tooling.test.js src/assets
git commit -m "site: parallel dataloader, section registry, shell + attribution footer"
```

### Task 2.2: UI design system + app shell polish

**Files:**
- Create: `src/js/toc-colours.js`
- Modify: `src/styles/main.css` (tokens + shell/state styles), `src/index.html` (nav + skip link + header row), `src/js/sections.js` (nav render, scroll-spy, `slotError`)
- Test: `tests/tooling.test.js`

**Interfaces:**
- Consumes: `LOAD_PLAN`/`ready` (T2.1), the shell + footer from T2.1 Step 5, `toc.json` (`[{toc, name, colour}]`, §6.4), `network.json` `lines[].color` (T1.3).
- Produces:
  - `tocColour(tocPayload, tocCode, fallback)` in `src/js/toc-colours.js` — pure, node-safe; returns the operator's hex from `tocPayload` (`hit.colour`) or `fallback` (default `#9aa7b0`).
  - `slotError(slotEl, err)` in `sections.js` — marks a failed section `.has-error`, sets `role="alert"`, replaces slot content with a readable message.
  - `renderNav(root)` in `sections.js` — builds the sticky section nav from the registry labels; scroll-spy toggles `aria-current="true"` on the section in view.
  - `src/index.html` shell: skip link, header row (status + glyph slot), `<nav class="section-nav">`, sections + footer (supersedes the T2.1 Step 5 header fragment).

**Design direction — studied DNA from mbtaviz.github.io (public reference, MIT — Barry & Card 2014):** the site recreates the MBTA Viz look for UK rail: **light editorial data-viz** on white paper, not the scaffold's dark theme. Extracted DNA: paper `#ffffff` with a `#fafafa` masthead and hairline `#e5e5e5` rules; ink `#333`; muted `#999`; **serif body** (Georgia stack) with **grotesk sans headings** (Helvetica stack, weight 600, subtitles weight 200) — the classic long-form narrative pairing; each section is a heading + short prose + one full-width interactive graphic (narrative spine, sticky nav); line/operator colours are data-driven from `toc.json` `colour` and `network.json` `lines[].color` (MBTA red/blue/orange ⇒ our operator colours, never hard-coded); the animated header glyph (T3.3) is the masthead's schematic graphic; dashed-underline hover-links (`border-bottom: 1px dashed`) for annotations; conservative motion (opacity/transform only, `prefers-reduced-motion`). Carry-over to skip (2014-era anti-patterns): no `transition: all`, no hover-scale; focus rings ≥ 3:1. Muted greys bump from `#999` to `#666` where they carry interactive/subtitle text so WCAG AA holds — the look, not the 2014 contrast failures. Every section renders three states: loading (existing `:empty::before`), data, and error (`slotError`). Focus states and `prefers-reduced-motion` are handled globally here so per-section tasks (T3–T7) don't repeat them.

- [ ] **Step 1: Write the failing test**

Add to `tests/tooling.test.js`:

```js
import { tocColour } from '../src/js/toc-colours.js';

test('tocColour resolves operator colour with fallback', () => {
  const toc = [{ toc: 'CC', name: 'c2c', colour: '#e4002b' }];
  assert.equal(tocColour(toc, 'CC'), '#e4002b');       // hit from payload
  assert.equal(tocColour(toc, 'LE'), '#9aa7b0');       // unknown operator → default fallback
  assert.equal(tocColour(toc, 'CC', '#000000'), '#e4002b'); // explicit fallback unused
  assert.equal(tocColour([], 'CC', '#000000'), '#000000');  // empty payload → fallback
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tooling.test.js`
Expected: FAIL — module `../src/js/toc-colours.js` not found.

- [ ] **Step 3: Implement `toc-colours.js`**

```js
// src/js/toc-colours.js — pure, node-safe. Reads the §6.4 toc.json `colour` field.
export function tocColour(tocPayload, tocCode, fallback = '#9aa7b0') {
  if (!Array.isArray(tocPayload) || tocCode == null) return fallback;
  const hit = tocPayload.find((t) => t.toc === tocCode);
  return (hit && typeof hit.colour === 'string' && hit.colour) || fallback;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/tooling.test.js`
Expected: PASS.

- [ ] **Step 5: Design tokens + shell styles in `src/styles/main.css`**

Append:

```css
/* ---- T2.2 design tokens + app shell (studied DNA: mbtaviz.github.io) ---- */
:root {
  --paper: #ffffff;          /* page paper */
  --panel: #fafafa;          /* masthead / card surface */
  --ink: #333333;            /* body text */
  --muted: #999999;          /* secondary text (non-interactive) */
  --muted-2: #666666;        /* interactive/subtitle text — AA bump over #999 */
  --line: #e5e5e5;           /* hairlines: header, section nav, rules */
  --good: #43b581;           /* on time / healthy */
  --warn: #e87200;           /* minor delay (MBTA orange) */
  --bad: #e12d27;            /* severe delay / error (MBTA red) */
  --focus: #2f5da6;          /* :focus-visible ring (MBTA blue) */
  --nav-h: 2.5rem;
  --radius: 4px;
  --font-body: Georgia, 'Times New Roman', serif;
  --font-head: Helvetica, Arial, sans-serif;
}
body { font-family: var(--font-body); color: var(--ink); background: var(--paper); }
h1, h2, h3 { font-family: var(--font-head); font-weight: 600; }
.tagline { font-family: var(--font-head); font-weight: 200; color: var(--muted-2); }
.tabular { font-variant-numeric: tabular-nums; }

.skip-link { position: absolute; left: -9999px; top: -9999px; }
.skip-link:focus { position: static; display: inline-block; padding: .5rem 1rem; color: var(--paper); background: var(--focus); }

.header-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.viz-slot--glyph { min-height: 2.5rem; border-style: none; background: transparent; }

.section-nav {
  position: sticky; top: 0; z-index: 20;
  display: flex; gap: 1.25rem; overflow-x: auto;
  padding: .5rem 1.25rem;
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  backdrop-filter: blur(4px);
  border-bottom: 1px solid var(--line);
}
.section-nav a {
  flex: 0 0 auto; padding: .25rem 0;
  color: var(--muted-2); font-family: var(--font-head); font-size: .9rem;
  text-decoration: none; border-bottom: 1px dashed transparent;
}
.section-nav a:hover { color: var(--ink); border-bottom-color: var(--muted); }
.section-nav a[aria-current="true"] { color: var(--ink); border-bottom: 2px solid var(--focus); }

.viz-section { scroll-margin-top: calc(var(--nav-h) + 1rem); }

.viz-slot.has-error { border-color: var(--bad); color: var(--bad); padding: 1rem; }

:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
@media (max-width: 640px) {
  .usage-table { display: block; overflow-x: auto; }
}
```

- [ ] **Step 6: Shell in `src/index.html`** — replace the T2.1 Step 5 header fragment with this (sections + footer content from T2.1 stay unchanged):

```html
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <h1>UK Rail Viz</h1>
    <p class="tagline">An MBTA-Viz-style look at Britain's railways, powered by Network Rail Darwin data (spec: <code>SPEC.md</code>).</p>
    <div class="header-row">
      <p id="data-status" class="data-status" role="status">Loading data…</p>
      <div class="viz-slot viz-slot--glyph" data-viz-slot="marey-header" aria-hidden="true"></div>
    </div>
  </header>
  <nav class="section-nav" aria-label="Sections"></nav>
  <main id="main">
    <!-- the five <section class="viz-section"> blocks from T2.1, unchanged -->
  </main>
  <footer class="site-footer">…T2.1 Step 5 attribution…</footer>
```

(The `<script type="module"> bootSections() </script>` stays in place.)

- [ ] **Step 7: Shell wiring in `src/js/sections.js`** — supersedes the T2.1 Step 4 module (adds nav render, scroll-spy, `slotError`):

```js
import { ready } from './dataloader.js';

const registry = {
  marey: () => import('./marey.js'),
  usage: () => import('./people.js'),
  delay: () => import('./delay.js'),
  commute: () => import('./commute.js'),
  live: () => import('./live.js'),
};
const NAV = [
  ['marey', 'The Trains'], ['usage', 'The People'], ['delay', 'Congestion & Delay'],
  ['commute', 'Your Commute'], ['live', 'Live Trains'],
];

export function slotError(el, err) {
  el.classList.add('has-error');
  el.setAttribute('role', 'alert');
  el.textContent = `Section unavailable: ${err?.message ?? err}`;
}

function renderNav(root) {
  const nav = root.querySelector('.section-nav');
  if (!nav) return;
  nav.innerHTML = NAV.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('');
  const links = [...nav.querySelectorAll('a')];
  const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1)));
  const spy = () => {
    const current = sections
      .map((el) => ({ el, top: el.getBoundingClientRect().top }))
      .filter((o) => o.top <= 96)
      .sort((a, b) => b.top - a.top)[0];
    for (const a of links) {
      if (current && a.getAttribute('href') === `#${current.el.id}`) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  };
  addEventListener('scroll', spy, { passive: true });
  spy();
}

export async function bootSections(root = document) {
  const data = await ready;
  renderNav(root);
  for (const [slot, load] of Object.entries(registry)) {
    const el = root.querySelector(`[data-viz-slot="${slot}"]`);
    if (!el) continue;
    const mod = await load();
    try {
      if (typeof mod.mount === 'function') mod.mount(el, data);
    } catch (err) {
      slotError(el, err);
      console.error(err);
    }
  }
}
```

- [ ] **Step 8: Build + visual check**

Run: `npm test && npm run build && npx serve dist -l 4173` then open `http://localhost:4173`.
Expected: nav renders the five section links and highlights the one in view while scrolling; skip link moves focus to `#main`; Marey/People render with no console errors; reduced-motion and narrow viewport behave (no transitions; nav scrolls horizontally).

- [ ] **Step 9: Commit**

```bash
git add src/styles/main.css src/index.html src/js/sections.js src/js/toc-colours.js tests/tooling.test.js
git commit -m "site: design tokens, sticky section nav, slot error states, toc colours"
```

---

## Phase 3 — Marey chart completion (SPEC M2)

### Task 3.1: Per-day/per-line trip loading + day picker

**Files:**
- Modify: `src/js/marey.js`
- Modify: `src/js/marey-math.js`
- Test: `tests/tooling.test.js` (math only)

**Interfaces:**
- Consumes: `data/marey-index.json` (T1.0), `LOAD_PLAN.sections.marey.index` (T2.1), `ready` → `{network}`.
- Produces:
  - `pickDayLines(index, chosenDay)` → `[{line, file, tripCount}]` (pure).
  - `fetchDayTrips(day, line)` → fetch `data/marey-trips-{day}-{line}.json`, cached in a module-level Map.
  - Marey renders per chosen day: line groups from `network.lines`, trips joined per line; a `<select>` day picker populated from `index.days` (default: newest). No monolithic `marey-trips.json` anywhere.

- [ ] **Step 1: Write the failing test**

```js
import { pickDayLines } from '../src/js/marey-math.js';

test('pickDayLines resolves the index into per-line files', () => {
  const idx = { days: [{ date: '2025-04-01', lines: [{ line: 'gwml', count: 12 }] }], lines: [{ id: 'gwml' }] };
  const out = pickDayLines(idx, '2025-04-01');
  assert.deepEqual(out, [{ line: 'gwml', file: 'data/marey-trips-2025-04-01-gwml.json', tripCount: 12 }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tooling.test.js` — expected FAIL (`pickDayLines` missing).

- [ ] **Step 3: Implement the helpers in `marey-math.js`**

```js
export function pickDayLines(index, chosenDay) {
  const day = index.days.find((d) => d.date === chosenDay) ?? index.days[0];
  if (!day) return [];
  return day.lines.map(({ line, count }) => ({
    line, tripCount: count, file: `data/marey-trips-${day.date}-${line}.json`,
  }));
}
```

- [ ] **Step 4: Wire into `marey.js`**

`mount(el, data)`: build the day picker from `data.index.days`; on change, `fetchDayTrips` each line file in parallel (`Promise.all`), render panels per line (existing `renderMarey` per line panel is reused); a per-line toggle checkbox filters groups (SPEC R-11: per-line chart groups). Show a "loading day…" state in `#data-status`; failures surface as a non-fatal notice.

- [ ] **Step 5: Test + build**

Run: `npm test && npm run build`
Expected: PASS; manual check in `npx serve dist -l 4173` shows the picker and per-line panels with the fixture trips.

- [ ] **Step 6: Commit**

```bash
git add src/js/marey.js src/js/marey-math.js tests/tooling.test.js
git commit -m "marey: per-day/per-line trip loading with day picker"
```

---

### Task 3.2: Lined-up variant, time-axis brush, click-to-freeze, annotations

**Files:**
- Modify: `src/js/marey.js`
- Modify: `src/js/marey-math.js`
- Test: `tests/tooling.test.js`

**Interfaces:**
- Consumes: existing `renderMarey` + `tripPoints`/`linScale`/`stationY`/`hhmm` (scaffold).
- Produces (pure, in `marey-math.js`):
  - `brushExtent(day, x, y, rect)` → `{t0, t1}` minutes of day covered by the brush rect (invert y via existing `yScale`-style mapping).
  - `freezeDomain(trip, x, y)` → `{tempSetDomain, tempSetRange}`-style `{x0, x1, y0, y1}` for a 1000 ms CSS transition on the focused path (MBTA pattern: dim others, zoom the frozen trip's time span).
  - `annotateNext(trips, t)` → nearest future trip start ≥ t (for the "next train at X: HH:MM" line).
- Renderer work in `marey.js` (DOM/SVG only, no new deps): a toggle switches between the standard and lined-up layouts; the lined-up layout draws a **hand-rolled time-axis brush** — a `mousedown`/`mousemove`/`mouseup` rect over the axis with `pointer-events`, clamped to the day; dragging updates `.highlight` region and dims out-of-range trips via CSS `opacity`. Click on a trip freezes it (`freezeDomain` + a 1 s CSS transition); a scrubber input on the right edge mirrors `yScale.invert` (MBTA `.fixed-right`).

- [ ] **Step 1: Write the failing tests**

```js
import { brushExtent, freezeDomain, annotateNext } from '../src/js/marey-math.js';

test('brushExtent inverts y into minutes of day', () => {
  const day = { t0: 240, t1: 1380 };              // 04:00-23:00, y=0..420
  const rect = { y0: 105, y1: 315 };
  const out = brushExtent(day, rect, 420);
  assert.equal(out.t0, 525);                       // 240 + (105/420)*(1380-240)
  assert.equal(out.t1, 1095);
});

test('freezeDomain spans the frozen trip plus margin', () => {
  const trip = { begin: 6 * 3600, end: 8.5 * 3600 };
  const d = freezeDomain(trip, 0, 420);
  assert.ok(d.y0 < 6 * 60 && d.y1 > 8.5 * 60);
});

test('annotateNext finds the next departure at or after t', () => {
  const trips = [{ begin: 9 * 3600 }, { begin: 9.5 * 3600 }];
  assert.equal(annotateNext(trips, 9.2 * 3600), trips[1]);
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/tooling.test.js`, expected FAIL.

- [ ] **Step 3: Implement the three helpers** in `marey-math.js` (minutes-of-day arithmetic; `brushExtent` uses linear interpolation: `t = day.t0 + (y / h) * (day.t1 - day.t0)`).

- [ ] **Step 4: Implement the renderer interactions** in `marey.js` (toggle, brush rect, freeze class + CSS transition, scrubber, annotation text). All interaction state lives in the module's render scope; no globals.

- [ ] **Step 5: Test + manual check**

Run: `npm test && npm run build && npx serve dist -l 4173`
Expected: brush highlights a time range and dims out-of-range trips; clicking a trip dims others and zooms its span; scrubber moves a marker line; annotation shows the next departure.

- [ ] **Step 6: Commit**

```bash
git add src/js/marey.js src/js/marey-math.js tests/tooling.test.js src/styles/main.css
git commit -m "marey: lined-up variant, time brush, freeze, scrubber, next-train annotation"
```

---

### Task 3.3: Animated header glyph

**Files:**
- Create: `src/js/header.js`
- Modify: `src/index.html` (slot already added in T2.1)
- Modify: `src/styles/main.css`
- Test: `tests/tooling.test.js` (math: wrap logic)

**Interfaces:**
- Consumes: `ready` → `{network, toc}`; the `[data-viz-slot="marey-header"]` element.
- Produces: `mount(el, data)` — 283×283 SVG schematic (MBTA's size): `network.segments` polylines + station dots from `network.stops`; N train dots animated along each line with `setTimeout`-driven 10 fps stepping (MBTA pattern, `transition().duration(100)` equivalent via CSS `transition: cx 100ms linear, cy 100ms linear`); 1 sim minute = 1 wall second; wraps 02:00→07:00. Pure helper `wrapSim(t, t0=120, t1=420)` → `t0 + ((t - t0) % (t1 - t0))` tested.

- [ ] **Step 1: Test `wrapSim`** — `assert.equal(wrapSim(430, 120, 420), 130)`.
- [ ] **Step 2: Implement `header.js`** with `mount(el, data)`; pause animation when the tab is hidden (`document.visibilitychange`).
- [ ] **Step 3: Boot it** — add `header: () => import('./header.js')` to the `sections.js` registry mapping slot `marey-header` (small registry extension + slot element in the header).
- [ ] **Step 4: Verify** — `npm test && npm run build`; glyph animates in the browser, dots wrap 02:00→07:00, pauses on tab hide.
- [ ] **Step 5: Commit**

```bash
git add src/js/header.js src/index.html src/js/sections.js tests/tooling.test.js src/styles/main.css
git commit -m "header: animated schematic glyph (10fps, wraps 02:00-07:00)"
```

---

## Phase 4 — People section completion (SPEC M3)

### Task 4.1: Station detail heatmap + keyboard/ARIA

**Files:**
- Modify: `src/js/people.js`
- Modify: `src/js/people-math.js`
- Modify: `src/styles/main.css`
- Test: `tests/tooling.test.js`

**Interfaces:**
- Consumes: existing `people.js` (heatmap grid, usage table, map, cross-highlight — verified working), `ready` → `{freq, usage, network, stations}`.
- Produces:
  - `stationDetail(stationCrs, freq)` in `people-math.js` → `{hours: [24 × {hour, arrivals, departures}], weekdayAvg, offpeakAvg}` (pure).
  - Clicking a table row or map node opens a detail panel: the station's 24 h arrivals/departures bars + weekday vs offpeak averages, plus its usage figure.
  - Table rows are `<tr>` with `tabindex="0"`, `role="button"`/`aria-label="<name> arrivals and departures"`, Enter/Space triggers the same click; map nodes get `<title>` + `aria-label`.
  - The "no turnstile equivalent" note (SPEC §10) as a one-line caption under the heatmap: "Arrivals/departures per hour from the timetable — the UK has no public turnstile counts (SPEC §10)."

- [ ] **Step 1: Test `stationDetail`**

```js
import { stationDetail } from '../src/js/people-math.js';
const freq = { stops: [{ crs: 'PAD', times: [
  { time: 0, arrivals: 2, departures: 3 }, ...Array.from({ length: 23 }, (_, i) => ({ time: i + 1, arrivals: 0, departures: 0 })),
] }] };
const d = stationDetail('PAD', freq);
assert.equal(d.hours.length, 24);
assert.equal(d.hours[0].arrivals, 2);
```

- [ ] **Step 2: Run to verify it fails** — expected FAIL (`stationDetail` missing).
- [ ] **Step 3: Implement `stationDetail`** in `people-math.js` (group `times[]` by hour; weekday/offpeak means from `averagesByType`).
- [ ] **Step 4: Renderer work in `people.js`** — detail panel (a `<details>`-free custom panel to keep styling simple: `div.viz-tip`-style absolute panel, or a fixed side panel on wide screens), keyboard handlers, ARIA attributes, the §10 caption.
- [ ] **Step 5: Verify** — `npm test && npm run build`; tab through the table with the keyboard opens the detail; map nodes are focusable with labels; panel closes on `Escape`.
- [ ] **Step 6: Commit**

```bash
git add src/js/people.js src/js/people-math.js src/styles/main.css tests/tooling.test.js
git commit -m "people: station detail heatmap + keyboard access + §10 caption"
```
---

## Phase 5 — Congestion & Delay (SPEC M4)

### Task 5.1: Horizon chart + delay band math

**Files:**
- Create: `src/js/delay-math.js`
- Create: `src/js/delay.js`
- Modify: `src/styles/main.css`
- Test: `tests/tooling.test.js`

**Interfaces:**
- Consumes: `ready` → `{delay, delays}` (`delay.json` 7×96 buckets, `average-actual-delays.json`); `[data-viz-slot="delay"]`.
- Produces (pure, `delay-math.js`):
  - `dayBuckets(delay, day)` → the 96 buckets for one day.
  - `seriesTotals(bucket)` → `{ins, outs}` totals (sum of per-CRS maps).
  - `horizonAreas(values, bandCount=3, h=40)` → `[band, top, pathD][]` layered area strings for the horizon technique (mirror + clip; MBTA used 3 bands → 6 layers).
  - `delayGradientStops(bucketValues)` → `[{offset, color}]` — linearGradient stops per 15-min datapoint, Lab-interpolated red/white/green (via a small hand-rolled `labLerp` or a 3-stop CSS ramp — SPEC §2.3 audit: MBTA used Lab interpolation; a white→red CSS gradient per day rect achieves the same visual with fewer bytes).
  - `ratioColor(ratio)` → CSS colour for the line-glyph fill: negative (fast) green, 0 white, +0.4 red, clamped.
  - `scrubAt(dayBuckets, tSec)` → nearest bucket via binary search (hand-rolled `bisect`).

- [ ] **Step 1: Write the failing tests**

```js
import { dayBuckets, seriesTotals, horizonAreas, ratioColor, scrubAt } from '../src/js/delay-math.js';

test('dayBuckets slices 96 buckets and seriesTotals sums stations', () => {
  const delay = [{ day: 0, secOfDay: 0, ins: { PAD: 2 }, outs: { PAD: 1 }, ins_total: 2, lines: [] }, ...];
  const b = dayBuckets(delay, 0);
  assert.equal(b.length, 96);
  assert.equal(seriesTotals(b[0]).ins, 2);
});

test('horizonAreas returns bandCount*2 area strings', () => {
  const values = Array.from({ length: 96 }, (_, i) => Math.sin(i / 8) * 10 + 12);
  const areas = horizonAreas(values, 3, 40);
  assert.equal(areas.length, 6);
  assert.ok(areas.every(([band]) => band >= 0 && band <= 3));
});

test('ratioColor clamps and maps sign', () => {
  assert.ok(ratioColor(-0.3).startsWith('rgb'));
  assert.ok(ratioColor(0.4).startsWith('rgb'));
  assert.equal(ratioColor(0), 'rgb(255,255,255)');
});

test('scrubAt binary-searches the nearest bucket', () => {
  const buckets = dayBuckets(makeDelay(), 1);
  const hit = scrubAt(buckets, 900 * 4.2);   // between buckets 4 and 5
  assert.ok(Math.abs(hit.secOfDay - 900 * 4) <= 900);
});
```

- [ ] **Step 2: Run to verify they fail** — expected FAIL (no `delay-math.js`).

- [ ] **Step 3: Implement `delay-math.js`**

`horizonAreas`: for band b ∈ 0..bandCount-1, layer the positive/negative excursions of `values` clipped to band height, mirroring below zero — standard horizon algorithm:

```js
export function horizonAreas(values, bandCount = 3, h = 40) {
  const areas = [];
  const x = (i) => i * (400 / (values.length - 1 || 1));
  for (let band = 0; band < bandCount; band++) {
    const lo = band * h, hi = (band + 1) * h;
    const pts = values.map((v, i) => [x(i), Math.max(0, Math.min(hi, v)) - lo]);
    const neg = values.map((v, i) => [x(i), Math.min(0, Math.max(-hi, v)) + lo]);
    areas.push([band, 'top', 'M' + pts.map(([px, py]) => `${px},${py}`).join('L')]);
    areas.push([band, 'bottom', 'M' + neg.map(([px, py]) => `${px},${py}`).join('L')]);
  }
  return areas;
}
```

`delayGradientStops`: normalise each bucket's `delay_actual` to `[0,1]`, emit `[{offset: (i/95*100).toFixed(1)+'%', color: ratioColor(v)}]` — one `<linearGradient>` per day `<rect>` (MBTA's pattern, SPEC §2.3). `scrubAt` = binary search on `secOfDay`. `labLerp` optional — CSS `rgb()` interpolation across 3 stops is sufficient (documented in a code comment).

- [ ] **Step 4: Implement `delay.js` renderer**

`mount(el, data)`: 7 rows (one per day) of horizon areas per line (from `delay.json` lines), plus one gradient `<rect>` delay band per day; a scrubber across the 24 h shows the bucket values at the cursor (mousemove → `scrubAt`); station line glyphs replaced by **thick stroke-width links** (SPEC §2.3: no fragile polygon geometry) whose colour is `ratioColor(median delay for that segment)`; hover shows the exact value in the shared `.viz-tip`. All rendered into `[data-viz-slot="delay"]` as SVG.

- [ ] **Step 5: Verify**

Run: `npm test && npm run build && npx serve dist -l 4173`
Expected: 7 day-rows of horizon bands + delay band; scrubbing highlights bucket values; glyph links colour by ratio; no console errors with fixture data.

- [ ] **Step 6: Commit**

```bash
git add src/js/delay-math.js src/js/delay.js src/styles/main.css tests/tooling.test.js
git commit -m "delay: horizon charts + gradient delay band + ratio glyphs"
```

---

## Phase 6 — Your Commute (SPEC M5)

### Task 6.1: Scatter + percentile bands + on-demand origins + deep-links

**Files:**
- Create: `src/js/commute-math.js`
- Create: `src/js/commute.js`
- Modify: `src/styles/main.css`
- Test: `tests/tooling.test.js`

**Interfaces:**
- Consumes: `ready` → `{stations, network}`; `data/commute-{origin}.json` (per-origin, on demand); hash deep-links `#your-commute.<from>.<to>`.
- Produces (pure, `commute-math.js`):
  - `originsFromStations(stations, cfgOrigins)` → the available origins (CRS present in both config and stations).
  - `percentilePath(result)` → `{p10, p50, p90, areaD}` — mirrored scatter layout: transit above zero, wait below (MBTA pattern); p10–p90 band as a closed path, p50 as a line, hours 5–24.5, basis-style smoothing optional (straight segments are fine at 15-min granularity — fewer bytes).
  - `downsample(points, max=1000)` — keep every Nth point when `points.length > max` (MBTA's iOS path).
  - `nearestHit(cx, cy, points, r=8)` → index of the closest point within `r` px, else -1 — the Voronoi-free hit test (SPEC §2.3: "Voronoi overlay for fat hit targets" → brute-force nearest on the visible subset; ≤ 3,700 points, fine).
  - `parseHash(hash)` → `{from, to}` or null.

- [ ] **Step 1: Write the failing tests**

```js
import { percentilePath, downsample, nearestHit, parseHash } from '../src/js/commute-math.js';

test('percentilePath builds band + median from result rows', () => {
  const result = [[5, [10, 20, 30], [2, 4, 6]], [6, [12, 22, 32], [3, 5, 7]]];
  const p = percentilePath(result);
  assert.ok(p.areaD.startsWith('M') && p.p50.length === result.length);
});

test('downsample caps length at max', () => {
  const pts = Array.from({ length: 5000 }, (_, i) => [i, i % 100]);
  assert.ok(downsample(pts, 1000).length <= 1000);
});

test('nearestHit finds the closest point within radius', () => {
  const pts = [[0, 0], [100, 100], [200, 0]];
  assert.equal(nearestHit(98, 99, pts, 8), 1);
  assert.equal(nearestHit(500, 500, pts, 8), -1);
});

test('parseHash handles #your-commute.FST.LST', () => {
  assert.deepEqual(parseHash('#your-commute.FST.LST'), { from: 'FST', to: 'LST' });
  assert.equal(parseHash('#trains'), null);
});
```

- [ ] **Step 2: Run to verify they fail** — expected FAIL (`commute-math.js` missing).

- [ ] **Step 3: Implement `commute-math.js`** — the four pure helpers; `percentilePath` uses the p10/p50/p90 triplets per hour and builds the closed band path (upper p90 forward, lower p10 reversed), mirroring wait below zero.

- [ ] **Step 4: Implement `commute.js` renderer**

`mount(el, data)`: origin `<select>` (default from hash or first origin); on origin change, `fetch(data/commute-{origin}.json)` and render the mirrored scatter (~500×290 SVG): dots r=1 (downsampled per `downsample`), p10–p90 band + p50 line, destination axis labelled with CRS → station names; drag origin→destination selects a pair; `location.hash = '#your-commute.' + from + '.' + to` updates on change and `hashchange` re-renders (deep-linkable, MBTA parity). Only the selected origin's file loads — never more than one at a time (lazy per-origin, §8).

- [ ] **Step 5: Verify**

Run: `npm test && npm run build && npx serve dist -l 4173`
Expected: picking an origin loads only its file (Network tab), scatter renders, deep-link `#your-commute.PAD.BRI` restores the pair, dots are hoverable within 8 px.

- [ ] **Step 6: Commit**

```bash
git add src/js/commute-math.js src/js/commute.js src/styles/main.css tests/tooling.test.js
git commit -m "commute: percentile scatter, on-demand origins, deep-links"
```

---

## Phase 7 — Live overlay + refresh pipeline (SPEC M6)

### Task 7.1: Live snapshot + session delta

**Files:**
- Create: `src/js/live-math.js`
- Create: `src/js/live.js`
- Modify: `src/styles/main.css`
- Test: `tests/tooling.test.js`

**Interfaces:**
- Consumes: `data/live.json` (baseline, `refreshed_at`, trains keyed by `train_id`), `data/live-delta.json` (`{changed:[train…], removed:[train_id…]}`).
- Produces:
  - `applyDelta(baseline, delta)` (pure) → merged train map; `removed` entries dropped; `changed` upserted; returns new array sorted by `lateness_min` desc.
  - `live.js mount(el, data)`: table (headcode, toc, origin→destination, lateness, status, platform suppressed per §9 feed direction — show "—" instead of platform), map overlay on the `network` schematic (train dots at lat/lon → projected x/y via the same equirectangular mapping used in `derive.js`); poll `data/live.json` + `data/live-delta.json` every D2*60 s (default 900 s) and `applyDelta` onto the session baseline; `refreshed_at` shown as "as of HH:MM:SS".

- [ ] **Step 1: Test `applyDelta`**

```js
import { applyDelta } from '../src/js/live-math.js';
test('applyDelta upserts, removes and sorts', () => {
  const base = [{ train_id: '1A01', lateness_min: 0 }, { train_id: '1A02', lateness_min: 5 }];
  const d = { changed: [{ train_id: '1A01', lateness_min: 9 }], removed: ['1A02'] };
  const out = applyDelta(base, d);
  assert.deepEqual(out.map((t) => t.train_id), ['1A01']);
  assert.equal(out[0].lateness_min, 9);
});
```

- [ ] **Step 2: Run to verify it fails** — expected FAIL.
- [ ] **Step 3: Implement `live-math.js`** (`applyDelta` with a `Map` keyed by `train_id`, then sort desc by `lateness_min`).
- [ ] **Step 4: Implement `live.js`** per the interface; use `setInterval` with `document.visibilitychange` pause (same pattern as `header.js`); platform shown as "—" always (suppressed).
- [ ] **Step 5: Verify** — `npm test && npm run build`; with fixtures, the table renders 2 trains and the delta merges without duplicating.
- [ ] **Step 6: Commit**

```bash
git add src/js/live-math.js src/js/live.js src/styles/main.css tests/tooling.test.js
git commit -m "live: snapshot table + map overlay + session delta merge"
```

---

### Task 7.2: STOMP window collector

**Files:**
- Modify: `tools/etl/collect.js`
- Create: `tools/etl/stomp.js`
- Test: `tests/etl.test.js`

**Interfaces:**
- Consumes: SPEC §3.2 (STOMP `TRAIN_MVT_ALL_TOC` + `VSTP_ALL`, port 61612; Evolution broker `amq1.realtime.nationalrail.co.uk:61616` — endpoint config-driven), `stompit@1`.
- Produces: `captureWindow({host, port, user, pass, topics, seconds=600})` → `[{header, body}]` snapshot of events seen in the window; `collect.js` reduces them into `data/live.json` (per `train_id` latest state: `headcode, toc, crs, lat, lon, lateness_min, status, platform: null`) + `data/live-delta.json` (changed/removed vs the previous run's baseline). Runs only in the Actions job, never on Render.

- [ ] **Step 1: Test the reducer (pure)**

```js
import { reduceMovements } from '../tools/etl/stomp.js';
test('reduceMovements keeps the latest per train_id', () => {
  const events = [
    { header: { 'train_id': '1A01', toc: 'CC' }, body: { event: 'DEPARTURE', gbtt_timestamp: '20260802080000', actual_timestamp: '20260802075930', timetable_variation: '-30', reporting_stanox: 'FST', platform: '1' } },
    { header: { 'train_id': '1A01' }, body: { event: 'ARRIVAL', gbtt_timestamp: '20260802081500', actual_timestamp: '20260802081600', timetable_variation: '60', reporting_stanox: 'STF' } },
  ];
  const live = reduceMovements(events, { now: 1754121600 });
  assert.equal(live.trains.length, 1);
  assert.equal(live.trains[0].lateness_min, 1);
  assert.equal(live.trains[0].platform, null);   // suppressed (§9)
});
```

- [ ] **Step 2: Run to verify it fails** — expected FAIL (`stomp.js` missing).
- [ ] **Step 3: Implement `stomp.js`**

`captureWindow`: connect with `stompit.connect({host, port, connectHeaders: {host: '/', login: user, passcode: pass, 'accept-version': '1.2'}})`, subscribe to each topic with `ack: 'client-individual'`, accumulate events, `setTimeout` end-of-window → unsubscribe, disconnect, resolve. `reduceMovements(events, {now})`: key by `train_id`, apply the `KNOWN_BUGS.bstFixMs` correction to `gbtt_timestamp`/`actual_timestamp` (parse `yyyyMMddHHmmss` → epoch, +1 h in BST), compute `lateness_min = round((actual − gbtt)/60000)`, drop platform per §9, and diff against the previous run's baseline to emit `live-delta.json` (`changed`/`removed`).

- [ ] **Step 4: Wire into `collect.js`** — after S3 collection, when `CAPTURE_LIVE=1` and `NROD_USER`/`NROD_PASS` are set, run `captureWindow` and write `data/live.json` + `data/live-delta.json` (not `raw/` — live artifacts are committed per §7.2). Keep the timeout to ≤ 10 min and the fail-fast contract (status `error` on STOMP auth failure — do not commit a stale live.json over a fresh one).

- [ ] **Step 5: Verify** — `node --test tests/etl.test.js` PASS; manual STOMP window (needs NROD creds) in the Actions job.
- [ ] **Step 6: Commit**

```bash
git add tools/etl/stomp.js tools/etl/collect.js tests/etl.test.js
git commit -m "etl: STOMP window collector -> live.json + delta"
```

---

### Task 7.3: End-to-end GitHub Actions refresh

**Files:**
- Modify: `.github/workflows/refresh.yml`
- Create: `.env.example` additions (already in T1.1) — no new files
- Test: manual — `gh workflow run refresh.yml --ref main`

**Interfaces:**
- Consumes: all ETL tasks; repo secrets.
- Produces: a green scheduled pipeline: `*/15` (D2) live refresh + `05 3 * * *` daily (timetable + R2 mirror + HSP history) — both commit `data/` when it changed and always FF-push `main → prod`; Render auto-deploys from `prod` (T8.1).
- Push-trigger guard: `on.push` restricted to `branches: ['main']` + `paths: ['data/**']` so ad-hoc pushes never start the heavy pipeline; top-level `concurrency: { group: refresh, cancel-in-progress: false }` so scheduled runs queue rather than overlap.
- FF-push invariant (branch model §7.2): every run ends with `git push origin main:prod` — a no-op when branches are equal, and the mechanism that flows code commits from `main` to the deploy branch within one tick.

- [ ] **Step 1: Verify the workflow's cron, trigger, and steps**

Read `.github/workflows/refresh.yml` and confirm: cron `*/15 * * * *` (spec D2), `on.push` → `branches: ['main']` + `paths: ['data/**']`, top-level `concurrency: { group: refresh, cancel-in-progress: false }`, steps checkout → setup-node → `npm ci` → collect → derive → smoke → commit+push (bot identity, `GH_PAT`), artifact upload. Add the daily job:

```yaml
jobs:
  daily:
    if: github.event_name == 'schedule' && (github.event.schedule == '5 3 * * *')
    runs-on: ubuntu-latest
    steps: # same chain, with FETCH_AUX=1 R2_ENDPOINT/R2_BUCKET/R2_PROFILE from secrets
```

- [ ] **Step 2: Add repo secrets** (user action — document in the commit body): `DARWIN_S3_KEY_ID`, `DARWIN_S3_SECRET`, `NROD_USER`, `NROD_PASS`, `GH_PAT`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PROFILE`.
- [ ] **Step 3: Manual run**

```bash
git push origin main && gh workflow run refresh.yml
```

Expected: the run downloads the day's timetable, mirrors to R2, derives artifacts, commits `data/` (if changed), and passes smoke; `data/live.json` has a fresh `refreshed_at`. Commit step: `if git status --porcelain data/ | grep -q .; then git add data && git commit -m "chore(data): refresh rail data [skip render]" && git push origin HEAD:main; else echo "no data change"; fi` — then **always** `git push origin main:prod` (FF; a no-op when branches are equal). Confirm `git log --oneline -1 origin/prod` equals the `main` head.
- [ ] **Step 4: Watch two live cycles** — confirm `*/15` runs commit deltas without churn: unchanged `data/` skips the commit (Step 3 guard) but the FF push still runs, so `prod` tracks `main` every cycle.
- [ ] **Step 5: Commit the workflow change**

```bash
git add .github/workflows/refresh.yml
git commit -m "ci: daily ETL job + no-op commit guard"
```

---

## Phase 8 — Render deploy + efficiency audit (SPEC M7)

### Task 8.1: Blueprint validation + first deploy + attribution check

**Files:**
- Verify: `render.yaml` (header globs + `branch: prod` — deploy branch, §7.2), `budgets.json`, size report
- Test: `render blueprints validate`

- [ ] **Step 1: Validate the blueprint**

```bash
render blueprints validate render.yaml
```

Expected: PASS — `branch: prod` accepted (Render deploys from the `prod` branch, §7.2). If header globs (`/data/!(live|station-frequency).json` negations) are rejected, adjust `render.yaml` to explicit globs per SPEC §7.1's note ("Header glob semantics to be validated… at integration time") — e.g. list `live.json` and `station-frequency.json` first with `max-age=60`, then `/data/*.json` 1 h, then `/assets/*` immutable, `/*` 300 s.

- [ ] **Step 2: First deploy**

```bash
render blueprints launch    # or the Dashboard → New → Blueprint flow; CLI v2.22.0 has no 'blueprint launch' per §7.3
```

Then `git push origin main && git push origin main:prod` → Render auto-deploys from `prod` (branch model, §7.2). Verify at the public URL: `curl -I <url>/data/live.json` shows `cache-control: public, max-age=60` and `content-encoding: br`; `curl -I <url>/assets/js/marey.<hash>.js` shows `max-age=31536000, immutable`.

- [ ] **Step 3: Efficiency audit**

```bash
npm run build && node -e "const r=require('./dist/size-report.json'); console.log(r.totalBytes, r.violations)"
```

Expected: total ≤ 15 MB, zero violations; first-visit shell ≤ ~250 KB data (stations + network + toc + index ≈ small). Record the numbers in the commit message. After 1 week: Render dashboard bandwidth — expect ≪ 0.5 GB (SPEC M7 exit criteria).

- [ ] **Step 4: Attribution + suppression spot-check** — page footer shows NRE attribution; the live section shows no platform numbers.
- [ ] **Step 5: Commit**

```bash
git add render.yaml
git commit -m "deploy: validate blueprint, audit payload, metered bandwidth"
```

---

## Phase 9 — Scale-up readiness (SPEC M8)

### Task 9.1: Configuration-driven corridor expansion

**Files:**
- Modify: `config/poc.json` → `config/network.json` (rename + generalize)
- Modify: `tools/etl/corridors.js`
- Create: `docs/scale-up.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the documented scale-up path: adding a corridor = adding a `lines[]` entry + a discovery pass (T1.2 Step 6) + budget re-check, nothing else.

- [ ] **Step 1: Generalise the config** — rename `config/poc.json` → `config/network.json`, keep the schema, update `corridors.js` `loadPoc` → `loadConfig` (accept a path). Update every test/import reference.
- [ ] **Step 2: Write `docs/scale-up.md`** — the M8 checklist: (1) extend `lines[]`/`stationSet` via discovery; (2) re-run ETL + smoke; (3) re-audit §8 budgets (full-GB marey needs per-line day files already built in — the architecture absorbs it); (4) re-check Render bandwidth against the 5 GB/mo cap; (5) revisit the §2.3 d3-fallback note if any visualization outgrows hand-rolled primitives.
- [ ] **Step 3: Verify** — `npm test && npm run build` green with the renamed config.
- [ ] **Step 4: Commit**

```bash
git add config docs/scale-up.md tools/etl/corridors.js tests/etl.test.js
git commit -m "scale: config-driven corridors + M8 scale-up checklist"
```

---

## Self-Review (run against SPEC.md before execution)

- **§4 scope** → T1.2/1.3 (config + discovery + measured-count gate) ✅
- **§5/§8 efficiency** → T0.3 hashing, T2.1 parallel loads, T3.1 day/line split, T6.1 on-demand commute, T7.1 delta, T8.1 audit ✅
- **§6.1 credentials** → T1.1 `.env.example` + secrets list T7.3 ✅
- **§6.2 HSP + R2 cache** → T1.4 (cache by `(from,to,date)`), T1.1 (R2 mirror), T7.3 (R2 env) ✅
- **§6.3/6.7 streaming + filter** → T1.2 (gunzip→saxes, early filter, ~90% discard gate) ✅
- **§6.4 artifact schemas** → T1.0 contract tests + T1.3/1.4 derivation ✅ (note: `live-delta.json` schema added — matches §8 "deltas" requirement)
- **§6.5 data bugs** → BST fix in T1.4/T7.2; Sunday-outage tolerance in T7.2 (no alerting) ✅
- **§6.6 live pattern** → T7.1 (poll + delta), T7.2 (window) ✅
- **§7.2 Actions refresh** → T7.3 ✅
- **§9 a11y/licensing/tests** → T4.1 (keyboard/ARIA), T2.1 footer, T0.3/T1.0 tests ✅
- **§10 non-goals** → respected (no server, no turnstile data, platform suppressed) ✅
- **§11 milestones** → M1 (Phase 1), M2 (Phase 3), M3 (Phase 4), M4 (Phase 5), M5 (Phase 6), M6 (Phase 7), M7 (Phase 8), M8 (Phase 9) ✅
- **§12 open questions** → plan depends on: Q2 (RDM catalogue incl. HSP) and Q8 (HSP endpoint fate) at T1.4's manual integration; Q3 (XC "selected" rule) at T1.2 Step 6 (default: ≥2 PoC stations); Q4/D2 = 15 min (workflow cron); Q5/D3 = origins list in `config/poc.json`. D1/D4 decided in spec.
- **§13 risks** → R-1 (HSP instead of TRUST history) T1.4 ✅; R-2 (Render offline build) T8.1 ✅; R-3 (Evolution re-verify) T1.4/T7.2 config-driven endpoints ✅; R-5 attribution T2.1 ✅; R-6/R-11 day/line splits T3.1/T9.1 ✅; R-10 workflow re-enable noted in T7.3 ✅.

- **§7 branch model / deploy** → T0.1 (branch init + SPEC §7 amendment), T7.3 (FF push + concurrency + trigger guard), T8.1 (`branch: prod`) ✅
- **UI shell/design system** → T2.2 (studied DNA from mbtaviz.github.io: light editorial tokens, serif body/grotesk headings, sticky nav, scroll-spy, slot error states, tocColour); §9 a11y → T2.2 skip-link/focus/reduced-motion + T4.1 ✅
- **Parallel-worktree execution model** → Execution Model section + T0.1 Step 1 (`.worktrees/` gitignored) ✅
**Known gaps acknowledged (not placeholders):** the exact `config/poc.json` CRS lists are discovered at T1.2 Step 6 against the real sample (the spec's §4 measured counts are the gate); HSP/STOMP integration requires the user's RDM account (T1.4/T7.2 manual steps document the failure path: keep fixtures, never ship broken output); the saxes streaming parser is implemented in T1.2 Step 4, but the exact TiplocV3 attribute names (notably `ned` for the validity end date) are confirmed at the Step 6 discovery pass — the parser contract (`uid`, `ssd`, `toc`, `stp`, `days`, `trainId`, `Location` attributes) is specified.
