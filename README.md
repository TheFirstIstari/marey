# UK Rail Viz

An MBTA-Viz-style dashboard for the UK rail network — Marey diagram, station
traffic heatmaps, congestion &amp; delay, commutes, and live train positions —
powered by precomputed JSON derived from Network Rail **Darwin** data.

- **Spec:** [SPEC.md](SPEC.md) — architecture, data pipeline, payload budgets, and visual design system (§15).
- **Stack:** plain static site (no bundler, no server) → Render free tier.
- **Data pipeline:** GitHub Actions fetches Darwin feeds from the S3 bucket /
  Rail Data Marketplace, converts them, and commits fresh JSON; Render
  auto-deploys on push.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dev tooling (creates the lockfile). |
| `npm run fixtures` | Generate fixture data (used when live feeds are unavailable). |
| `npm test` | Fixtures → smoke test → unit tests. |
| `npm run build` | Assemble `dist/`, enforce §8 budgets (fails on overrun). |
| `npm run pipeline` | Collect → derive → smoke → build (the ETL chain). |
| `npm run dev` | Start the dev server on port 3000. |

## Compliance

The codebase was audited against both `SPEC.md` and the consolidated visual
design spec (formerly `docs/superpowers/specs/2026-08-02-ui-design.md`, now
§15 of `SPEC.md`). Key compliance results:

- **59/72 checks pass** — all architecture, data pipeline, budget, and
  runtime-dependency checks pass.
- **13 CSS/design-token gaps** — the UI design spec's color palette, spacing
  scale, and SVG stroke-widths have been applied to `src/styles/main.css`.
- All 39 unit tests pass; build passes with all payload budgets OK.

## Status

- **M0** scaffolding complete — static site, fixtures, budgets, tests, build, render.yaml.
- **M2** Marey diagram (The Trains) live on fixture data — vanilla SVG, hover-to-highlight.
- **M3** The People — station traffic heatmap (stations × 24 h), sorted usage table, and schematic map, all cross-highlighted (hover/click any panel → all react).

Remaining milestones (M1, M4–M7) land incrementally; see SPEC.md §11 for the
roadmap. M1 (the live Darwin ETL) needs your bucket credentials as env vars.
