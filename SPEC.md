# UK Rail Viz — Comprehensive Specification

**Recreating [Visualizing MBTA Data](https://mbtaviz.github.io/) for the UK rail network, powered by Network Rail Darwin data, hosted on Render.com (efficiency-first).**

- **Spec version:** 1.2 (2026-08-02: + §7 branch model)
- **Date:** 2026-08-02
- **Status:** Draft for review
- **Repository:** `marey` (this directory). Note: a working implementation scaffold now exists alongside the spec (fixtures, build, budgets, and reference code) — it is a reference, not the deliverable; keep or discard as you prefer.

**v1.1 audit changes (2026-08-02):**
- v1 scoped to an **eastern-region proof of concept** — c2c + Greater Anglia + selected CrossCountry + selected Great Northern — before full-network rollout (§4).
- **Historical actuals sourced from HSP**, not self-archived TRUST: the TRUST stream has no archive/replay, and a periodic cron cannot capture a continuous stream (§3.2, §6.2, §13 R-1).
- Pipeline reworked for the **large Darwin S3 files**: streaming parse (gunzip → saxes) + early station-set filtering that discards ~90% before joins (§6.7).
- **Darwin S3 filename scheme corrected** to `{ts}_v{n}.xml.gz` / `{ts}_ref_v{n}.xml.gz` (§3.1).
- **Darwin Evolution go-live confirmed: mid-August 2026** — ETL must be config-driven and re-verified at M0 (§3.1, §13 R-3).
- **All ETL confined to GitHub Actions**; Render's build runs offline on committed `data/` (5 GB/mo egress cap + suspension risk for service-initiated traffic; §5, §7, §13 R-2).
- **Cloudflare R2** added as the $0 rolling archive for daily S3 snapshots (§6.2).
- **Licensing/attribution** requirements added (OGL v2.0 + NRE variations; mandatory attribution; §9, §13 R-5).
- **M0 bucket verification done (2026-08-02):** live `s3 ls` + sample download confirmed naming (`PPTimetable/` prefix, `{ts}_v{n}.xml.gz`, current `v8`), format (`PportTimetable` v8, no DTD), and real sizes (4–13 MiB gz ≈ 64 MiB raw — ~100× smaller than the community figure); §12 Q1/Q7 answered, R-4/R-8 closed (§3.1).
- **MBTA Viz library audit done (2026-08-02):** confirmed the reference is pure-SVG D3 v3 with delegated events, parallel per-section data loads and lazy per-station payloads — our §5/§6 plan already adopts the pattern (see §2.3).
- Full risk register in **§13**.

---

## 1. Purpose & goals

Build a static, interactive dashboard that visualises the performance and behaviour of the UK (Great Britain) rail network, modelled on the MBTA Viz site:

1. **Marey chart** of actual train trajectories (the signature "Trains" visualization).
2. **Station traffic** — heatmap + table + map with cross-highlighting (MBTA used turnstile counts; UK has no equivalent — see §4 for our substitution).
3. **Congestion & delay** — per-day horizon charts and per-station "breathing" glyphs.
4. **Point-to-point commute** — planned-vs-actual journey-time percentiles between station pairs.
5. **Live service overlay** — near-real-time train positions, lateness and status, refreshed periodically.

**v1 = an eastern-region proof of concept** (§4): the site first covers **c2c, Greater Anglia, selected CrossCountry and selected Great Northern routes** — four corridors out of the London terminals — then scales to the full GB network. Every artifact and visualization is built for that subset first; the pipeline design (§6) is what makes the later scale-up a config change rather than a rework.

**Hard requirements:**

- **Static site on Render's free tier** (no always-on server; CDN-served; cold-start-free).
- **Maximum efficiency**: tiny payloads, per-section lazy loading, edge compression, aggressive caching, and a refresh pipeline that costs $0/mo.
- All data precomputed at build/refresh time into small JSON artifacts (mirroring MBTA Viz's `data/` approach) — **no runtime API calls to Darwin**.
- Open-source-friendly stack; easy local development (`npm run build && npx serve`).

---

## 2. Reference: MBTA Viz anatomy

Facts verified against the [live site](https://mbtaviz.github.io/), the [repo](https://github.com/mbtaviz/mbtaviz.github.io/), and the [repo wiki](https://github.com/mbtaviz/mbtaviz.github.io/wiki) (2026-08-02).

### 2.1 Visualizations and their data

| Section | What it shows | Consumes (in `data/`) |
|---|---|---|
| Header | Animated schematic map glyph, trains moving along lines (1 real min = 1 s) | `station-network.json`, `spider.json`, `marey-trips.json` |
| The Trains | Full Marey chart (x = station position per line, y = time of day), lined-up variant with time-axis brush, click-to-freeze a single trip, annotations ("next train at X: 3:30") | `marey-header.json`, `marey-trips.json`, `station-network.json`, `spider.json` |
| The People | (a) All-station entry/exit heatmap (8 weeks, hourly, weekday/offpeak); (b) station table sorted by volume, per-row mini heatmaps; (c) map glyph with circles sized by volume; hover/drag cross-highlighting between table rows and map circles; click row → full month heatmap | `turnstile-heatmap.json`, `turnstile-gtfs-mapping.json`, `station-network.json`, `spider.json` |
| Congestion & Delay | 7 day-rows of horizon charts (total flows per 15-min bucket) with a delay band; per-station "breathing" polygon glyphs sized by flow, coloured by speed ratio (actual vs scheduled segment time) | `delay.json`, `average-actual-delays.json`, `station-network.json`, `spider.json` |
| Your Commute | Scatterplot of actual vs planned commutes with p10–p90 percentile bands and p50 lines; Voronoi map glyph; per-origin data loaded on demand; deep-linkable `#your-commute.<from>.<to>` | `station-paths.json`, 57 per-origin `upick2-weekday-rollup-<id>.json` files |

### 2.2 Data model (the contract our pipeline must reproduce)

| File | Size | Schema (verified) |
|---|---|---|
| `station-network.json` | 5 KB | `{nodes:[{name,id}], links:[{color,line,source,target}]}` — links by node index |
| `spider.json` | 2 KB | `{GTFS_station_id: [x,y]}` — hand-placed schematic coordinates |
| `marey-header.json` | 1 KB | `{"GTFSid\|line": [x,y]}` per-line station x-positions |
| `marey-trips.json` | 818 KB | `[{trip,line,begin,end,stops:[{stop,time}]}]` — `begin`/`end`/`time` in **unix epoch seconds**; one element per actual vehicle run |
| `turnstile-heatmap.json` | 2.8 MB | `{max,min,mean,numberOfEntries,all:{max,min,entrancesByType,times},stops:[{name,times,entrancesByType,averagesByType}]}`; `times[]` = `{time(unix ms),hour,day(0=Mon),week,i,entrances,exits}` — **per-hour** volumes |
| `delay.json` | 2.8 MB | 674 fifteen-minute buckets; `{outs:{gtfsId:exits/min},ins:{gtfsId:entrances/min},secOfDay,day,lines:[{line,delay_actual:{"from\|to":seconds}}],ins_total,delay_actual,time}` — `delay_actual` relative (0.4 = 40% slower) |
| `average-actual-delays.json` | 8 KB | `{"from\|to": average_seconds}` actual inter-station travel times |
| `station-paths.json` | 1 KB | ordered GTFS-id arrays per line |
| `upick2-weekday-rollup-<origin>.json` | 0.5–2 MB ×57 | keyed by destination id; `{result:[[hour,[p10,p50,p90 transit],[p10,p50,p90 wait]]...], actuals:[[hour,transit,wait]...]}` |

**Key facts for the recreation:**

- **Everything is precomputed static JSON** — no runtime API calls; data loads lazily per section (D3 `require`-style loader with byte-accurate progress bars).
- **There are no map tiles.** The "map" is a hand-drawn SVG schematic built from `spider.json` coordinates + `station-network.json` links. No Leaflet, no CartoDB, no projection.
- **Stack:** d3 ~3.4.1, underscore, moment, jQuery, bootstrap, es6-shim; LESS → single `main.css`; **no JS build step** (plain scripts loaded in order); served as a pure static site.
- **The processing utilities were never released** ("The utilities that transform the raw data into the files used by the visualizations are not available at this time" — [MBTA blog](http://mbtaviz.wordpress.com/2014/07/25/website-source-announcement)). The wiki schemas above are the *only* pipeline contract — we must re-derive the ETL ourselves.
- **Total data payload ≈ 55 MB** (dominated by the 57 commute rollups). We will do far better (budget in §8).

### 2.3 How the reference is actually built (library usage — audited 2026-08-02)

Source audit of the [repo](https://github.com/mbtaviz/mbtaviz.github.io/) (cloned 2026-08-02) — what the site does under the hood, and what we port.
  *Port decision updated 2026-08-02 (see port table): the scaffold adopts the exemplar stack verbatim — vendored d3 ~3.5.17, d3-tip, underscore, moment, es6-shim, jquery ~2.1.0, bootstrap ~3.1.1 — matching the dependencies in package.json.*

**Stack (bower.json):** d3 ~3.4.1, d3-tip ~0.6.4, underscore ~1.6.0, moment ~2.6.0, es6-shim ~0.10.1, jquery ~2.1.0, bootstrap ~3.1.1 (CSS-only, compiled from Less). **No bundler, no minification, no build step** — plain scripts loaded in order at the end of `<body>`: es6-shim → underscore → moment → d3 → jquery → horizon.js (a script-local D3 v3 plugin) → d3-tip → `common.js` → `files.js` → `dataloader.js` → `fixed.js` → `header.js` → one IIFE per section. `common.js` defines a global `VIZ` namespace with `appendOnce`/`onOnce`/`moveToFront` helpers; `dataloader.js` wraps d3.json v3 with byte-aggregated progress events; `files.js` is build-generated (`{file: byteSize}` + `{file: shortHash}`) and used as `?nocache=hash` cache-busting.

**Loading architecture:**

- Single long HTML page, one `<section>` per visualization with its own anchor; each section's empty container divs are rendered into SVG by D3.
- **All sections load their data in parallel at page load — there is no scroll-lazy loading.** Shared files (`station-network.json`, `spider.json`) are re-requested per section (browser cache aside). The **only lazy path** is the per-origin commute rollups, fetched when the user starts a drag (`your-commute.js:452-464`) with a monotonic token guarding against stale in-flight requests. No scroll-spy, no IntersectionObserver.
- **Everything is SVG — there is no canvas anywhere in the app.** A deliberate constraint we keep: 3500 px-tall Marey chart, 672-cell heatmaps, horizon charts, tables — all SVG.

**Per-section techniques (the ones that matter for us):**

- **Marey chart (`the-trains.js`):** one `<path>` per trip — **no aggregation: all 1,148 trips** (red 441, orange 314, blue 393) drawn from `marey-trips.json` via a keyed join. X = stations, Y = time downward; station columns come from the `"id|line" → [x,y]` dict. Branch splits (Braintree/Ashmont) are handled by injecting `null` gaps into `d3.svg.line().defined()` rather than splitting the data. Perf tricks we adopt: **relative path coordinates + a group `translate` to the trip's start time** (so most path coordinates are small), colour via CSS classes instead of inline stroke, **delegated listeners on the parent group** (`onOnce`), hover/click as pure class toggles (`.highlight-active` dims the rest via CSS opacity, not per-path JS), a time scrubber driving `yScale.invert(y)`, `d3.svg.brush` for the lined-up range highlight, and an early-return if the viewport width is unchanged (`the-trains.js:428`).
- **Header glyph:** a 283×283 SVG schematic; train dots animated at **10 fps via recursive `setTimeout`, not rAF**; 1 sim minute = 1 wall second, wrapping 02:00→07:00; `transition().duration(100)` on `cx`/`cy` with a keyed join.
- **People heatmap:** one `<rect>` per hour-cell (672 cells = 28 d × 24 h, ×2 for in+out) at 3×8 px, **linear colour scale `[min, mean, max] → white→black→red`**; cross-highlighting by class toggling + 100 ms debounce. The station table is a single SVG (580×800) with per-row mini heatmaps; drag-brushing via `d3.behavior.drag` highlights matching stations across table and map through shared `place-*` classes.
- **Congestion & delay:** horizon charts via the D3 v3 horizon plugin (3 bands → 6 layered, clipped, mirrored areas per series). The **delay band is one `<rect>` per day whose `linearGradient` stops encode each 15-min datapoint**, Lab-interpolated red/white/green — cheap to render, precise on hover. Scrubbing uses `d3.bisector` + linear interpolation. The "breathing" glyphs are **not timer circles**: they are directed link polygons offset perpendicular to each line segment with intersection clipping (fragile geometry, `congestion-and-delay.js:717-841`) — we will **not** port this; thick stroke-width links achieve the same effect robustly.
- **Your Commute:** a mirrored scatterplot (~500×290; transit above zero, wait below), ~3,700 dots at r=1 (downsampled to 1,000 on iOS), p10–p90 bands as `d3.svg.area` + a p50 line (basis-interpolated, `.defined` for hours 5–24.5), **a Voronoi overlay for fat hit targets**, drag origin→destination with preload-on-drag, and deep-links `#your-commute.<from>.<to>`.

**Port decision (keep vs. replace in the 2026 build):**

| Keep (adopted verbatim) | Replace (not applicable — exemplar stack retained) |
|---|---|
| SVG-first rendering; keyed joins (native `selectAll`-style helpers, pure math modules) | — the exemplar stack (d3 ~3.5.17, d3-tip, underscore, moment, es6-shim, jquery ~2.1.0, bootstrap ~3.1.1) is vendored and kept as-is |
| Event delegation + class-based hover | — jQuery + d3 v3 interaction model retained (d3 handles SVG, jQuery used for DOM utilities) |
| Parallel per-section loads (barrier at page load) | — Bootstrap 3 CSS palette retained as the light stylesheet base |
| Content-hash cache-busting (`?nocache=hash`) | — IIFE-per-section loading pattern retained |
| Gradient delay band; `bisector` scrub; Voronoi hit targets | — d3-tip retained for tooltip pattern |
| `[min, mean, max]` heatmap scale; hash deep-linking; lazy per-origin payloads | — breathing-glyph polygon geometry replaced with thick stroke-width links |

Data-scale contrast: the reference ships **≈ 48 MB of JSON in `data/`** (measured in the clone; the 51+ per-origin rollups ≈ 40 MB dominate), loaded wholesale per section. Our §8 budget targets **≈ 1.2 MB first visit** — the §6 per-day/per-line split of Marey trips and the §4.3 station-split of commute rollups already improve on their pattern rather than copy it.

---

## 3. UK data landscape — Darwin & the supporting datasets

### 3.1 Darwin, the Rail Data Marketplace, and access

- **Darwin** is GB rail's official train-running information engine: it ingests every TOC's Customer Information System (CIS) feed plus Network Rail train-location data and produces real-time arrival/departure predictions, platforms, delay estimates, schedule changes and cancellations. It powers National Rail Enquiries and most third-party products. (Source: [National Rail — Darwin Data Feeds](https://www.nationalrail.co.uk/developers/darwin-data-feeds/).)
- **Access is via the Rail Data Marketplace (RDM) at https://raildata.org.uk/** — a JS SPA (title: "Rail Data Marketplace"). The RDM is the successor to the retiring National Rail Data Portal (`opendata.nationalrail.co.uk`); registration there grants the Darwin/NROD subscriptions. Its data catalog API (`api.raildata.org.uk`) is account-authenticated and not publicly resolvable — the catalogue of available products must be confirmed from the user's logged-in account (§12).
- **Darwin distribution channels:**
  1. **S3 static snapshots** — bucket `darwin.xmltimetable` (eu-west-1), key prefix `PPTimetable/`, one pair per day: `{yyyymmddhhmmss}_ref_v{n}.xml.gz` (reference) and `{yyyymmddhhmmss}_v{n}.xml.gz` (full timetable — **no `_timetable_` infix**). **Full snapshots only — no deltas.** Uploaded ~02:10 UTC each morning (file timestamp 02:05:00 UTC), with **several revisions per day** (`v4`…`v8` on 2026-08-02, ~1 min apart) — ingest the day's **highest `v{n}`**; the ref side additionally carries a `_v99` alias for "latest". Coverage is a **rolling ~4-day window** peaking on the *next* operating day (02 Aug snapshot: 21,059 journeys on 02 Aug, 33,363 on 03 Aug, tails on 01/04 Aug). **Verified 2026-08-02 (M0 live listing + sample download):** timetable = **4–13 MiB gz ≈ 64 MiB uncompressed** (02 Aug `v8`: 10.0 MiB → 66,681,656 B), `PportTimetable` XML, namespace `http://www.thalesgroup.com/rtti/XmlTimetable/v8`, **no DOCTYPE/DTD**; ref = **231 KiB gz ≈ 1.9 MiB raw**, 12,146 `LocationRef` entries (TIPLOC/CRS/name/TOC). The community figure of 150–250 MB gz / 1–1.5 GB raw is **wrong for this feed — real size is ~100× smaller** (R-8 resolved). The bucket currently holds ~10 days (25 Jul → 02 Aug) — **treat the bucket as a source, never as your archive**; mirror each day's files to Cloudflare R2 (§6.2; ~10 MiB/day ≈ 900 MB per 90-day window). Credentials (shared access/secret key) are on the portal under My Feeds → Darwin → "Darwin File Information". Note: the shared key was revoked once (Nov 2025) after leaking; a replacement was issued.
  - Also present in the bucket: `EHSnapshot/` — tiny fixed-width marker files (`EHSnapshot_{yymmdd}_{hhmm}.txt`, ~164 B–2.1 KiB) containing `HD`/`ZZ` header/trailer records with datestamps and a status flag; ~03:30 daily cadence but **silent since 2026-07-30 15:30**. Purpose unconfirmed (likely an Evolution platform file-availability/health snapshot); **not load-bearing for the PoC** — record and ignore.
  2. **Realtime push feeds (NROD)** over STOMP/OpenWire/AMQP on port 61612, topics `TRAIN_MVT_ALL_TOC` (Train Movements), `TD_ALL_SIG_AREA` (Train Describer), `VSTP_ALL`, `RTPPM_ALL`. (Evolution moves the broker to `amq1.realtime.nationalrail.co.uk:61616` — re-verify at M0.)
  3. **Static HTTP endpoints** on `publicdatafeeds.networkrail.co.uk` for SCHEDULE/CIF, CORPUS/SMART reference data, KB stations feed, HSP history.
- **Darwin Evolution** (the SISJ Programme replacement platform) is **live for migration: go-live confirmed for mid-August 2026** (announcement on opendata.nationalrail.co.uk, fetched 2026-08-02; delayed from mid-July). NRDP (opendata.nationalrail.co.uk) shuts down later in 2026; all consumers must move to the RDM. Technical changes: new AMQ broker `amq1.realtime.nationalrail.co.uk:61616`, and S3 replacing the FTP push-port snapshots. **Observed 2026-08-02:** the S3 timetable product has already been publishing daily since **2026-07-25** — the migration is live in practice, ahead of the announced date. **Action:** keep the ETL config-driven against the RDM; re-verify every endpoint, product name, and credential at M0 (we land right in the migration window); confirm the HSP endpoint's post-Evolution fate (§12 Q8).

### 3.2 The feeds we use

| Feed | Channel | Cadence | Contents we need |
|---|---|---|---|
| **Train Movements (TRUST)** | STOMP `TRAIN_MVT_ALL_TOC` | bursts ≤ ~600 msgs/min; weekly ~5-min outage Sun ~02:00 | `0001` Activation (UID, full calling pattern, origin dep timestamp), `0002` Cancellation, `0003` Movement (event ARRIVAL/DEPARTURE, `gbtt_timestamp`, `planned_timestamp`, `actual_timestamp`, `timetable_variation`, `platform`, `reporting_stanox`, `train_id`, `toc_id`, `variation_status`), `0005` Reinstatement. **All locations are STANOX, not CRS.** |
| **Schedule (CIF)** | HTTP `CifFileAuthenticate?type=...` | full daily JSON ~06:00; updates daily (`CIF_ALL_FULL_DAILY`, `CIF_ALL_UPDATE_DAILY` — apply in sequence; `toc-update-{prev-day}`); full CIF weekly Fri | Planned timetable: UID, headcode, TOC, days-run, origin/destination, intermediate stops with planned/public times, platform. STP indicators C/N/O/P (lowest letter wins). Identity = UID + start date + STP. |
| **VSTP** | STOMP `VSTP_ALL` | low volume | Very short-term planned trains (~48 h) not yet in SCHEDULE; merge/de-dupe on UID+start+STP. |
| **Darwin S3 snapshots** | S3 | 1 pair/day | Timetable XML (same schedule info) + ref XML (TIPLOC, CRS, TOC codes, location names) — **the ref file is our compact reference source.** |
| **HSP** | JSON REST `hsp-prod.rockshore.net/api/v1/` (POST `serviceMetrics` → RIDs, then `serviceDetails` by RID) | query API | **v1's source of historical actuals** — per-location planned vs actual times + lateness, up to ~1 year. No RIDs needed upfront (query by from/to/date first). Basic Auth with NRDP credentials; see §6.2. |

**Critical audit finding (2026-08):** the TRUST train-movements stream is **real-time only — Network Rail offers no archive or replay** of past movements, and a periodic cron cannot hold a continuous STOMP connection between runs. The only official source of past per-stop actuals is **HSP** — or self-archiving the feed, which needs an always-on consumer we will not run at $0. Therefore: **historical actuals (Marey actuals, delay, commute percentiles) come from HSP; the live overlay comes from each refresh's STOMP window** (current positions only). See §6.2 and §13 R-1.

### 3.3 Reference data (codes + coordinates)

- **STANOX ↔ TIPLOC ↔ NLC ↔ CRS ↔ UIC:** **CORPUS** via `SupportingFileAuthenticate?type=CORPUS` — JSON with `STANOX, UIC, 3ALPHA, TIPLOC, NLC, NLCDESC, NLCDESC16`. **Required**: TRUST movements are STANOX-keyed; the dashboard is CRS/name-keyed. Never assume a STANOX is a CRS.
- **CRS → station name (clean list):** KB static feed `GET /api/staticfeeds/4.0/stations` (XML), or the Darwin `_ref_v{n}` file.
- **Coordinates:** **NaPTAN** (DfT; daily updates; national XML/CSV snapshot + API `https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv`) carries ATCO/CRS/TIPLOC + lat/long for every GB public-transport access node. Covers England, Scotland, Wales (not NI).
- **Platform numbers:** only live (TRUST `platform` field) or in BPLAN geography (~2×/year). Not needed for v1.

### 3.4 Station usage (the turnstile substitute)

- **ORR "Estimates of station usage"** ([ORR Data Portal](https://dataportal.orr.gov.uk/statistics/usage/estimates-of-station-usage/)): annual entries/exits/interchanges per station, keyed by **CRS**, from LENNON ticket-sales data (financial year, April–March). Tables **1410** (entries & exits + interchanges) and **1415** (time series); the Origin-Destination Matrix is now free on the RDM. Refresh annually. Caveats: Eurostar excluded (St Pancras/Ashford/Ebbsfleet understated); ~2,500+ stations.
- **There is no public per-minute gate-count data for UK stations** — MBTA Viz's turnstile heatmap cannot be replicated literally. Substitution strategy in §4.

---

## 4. Feature mapping & v1 scope

| MBTA Viz section | UK replacement | Data source | Feasibility |
|---|---|---|---|
| Header animation | Keep: schematic SVG map glyph with moving train dots | `stations/network.json` + live snapshot | ✅ |
| The Trains (Marey) | **Recreate 1:1.** Planned trajectories from schedule, actual from TRUST. Scope: one or more corridors/lines (see decision D1) | SCHEDULE + TRUST + CORPUS | ✅ core of the project |
| The People — hourly turnstile heatmap | **Substitute:** hourly *service frequency* heatmap (arrivals/departures per hour per station from the schedule) + annual *usage* heatmap from ORR | SCHEDULE + ORR 1410 | ✅ (different metric, same interactions) |
| The People — station table + map brushing | **Recreate 1:1** (rows = stations, circles = annual usage volume; hover/drag cross-highlight; click → station detail heatmap) | ORR 1410 + NaPTAN | ✅ |
| Congestion & Delay | **Recreate 1:1.** 15-min bucket horizon charts of service flow + delay band; per-station breathing glyphs sized by flow, coloured by actual-vs-planned segment time | SCHEDULE + TRUST | ✅ |
| Your Commute | **Recreate 1:1** for a curated set of origins (major terminals/hubs, e.g. London terminals + top regional hubs) | SCHEDULE + TRUST | ✅ (bounded set, keep payload small) |
| *New* Live service overlay | Train positions, lateness, status, platform — snapshot refreshed every N minutes | TRUST live | ✅ (static snapshot pattern, §6.6) |
| — | **Cut:** any per-minute passenger-volume metric (no data), multi-year time series (out of scope v1) | — | — |

### v1 scope — the "eastern region" proof of concept (decided 2026-08-02)

v1 covers an **eastern-region subset** of the network:

| Operator | Corridors in scope (PoC) | London terminal(s) |
|---|---|---|
| **c2c** | Fenchurch Street → Shoeburyness, all branches (via Basildon; via Grays + Rainham) | Fenchurch Street |
| **Greater Anglia** | Liverpool St → Norwich (GEML fast/slow), Liverpool St → Cambridge (West Anglia), Stansted Express, selected local branches | Liverpool Street |
| **CrossCountry (selected)** | Services that traverse the region — e.g. Birmingham ↔ Cambridge ↔ Stansted via Peterborough/Ely; exact route set = §12 Q3 | — (through) |
| **Great Northern (selected)** | King's Cross → Cambridge (via Welwyn), King's Cross → Peterborough, Moorgate suburban (Northern City Line / Hertford Loop) | King's Cross, Moorgate |

Measured scale (2026-08-02 timetable, national counts across the file's window): **c2c 795, Greater Anglia (LE) 2,833, CrossCountry (XR) 2,184, Thameslink/GN (TL) 1,912** journeys — the eastern subset after the XC/GN "selected" filters lands at roughly **~3,500–4,500 passenger services/day** (Greater Anglia is the largest of the four), **~80–120 unique CRS**, four corridors out of separate London terminals (Fenchurch St, Liverpool St, King's Cross, Moorgate). That is ideal for the line-keyed Marey chart and schematic map (MBTA's structure), keeps every derived artifact well inside the §8 budget, and exercises all five visualization sections on real, delay-rich, commuter-heavy data.

This is a **proof of concept**: it validates the full pipeline + visualization stack end-to-end on real eastern-region data before committing to full-GB scope (≈2,500 stations, dozens of lines — noise on a single Marey chart, so the full rollout needs per-line views and day-split trip files; §13 R-6/R-11).

### Design decisions to confirm (§12)

- **D1 — Corridor scope for v1:** **DECIDED — eastern-region subset** (c2c + Greater Anglia + selected CrossCountry + selected Great Northern, §4). The Marey chart renders each corridor as its own line group with per-line filtering, so density stays readable.
- **D2 — Refresh cadence:** 5 / 15 / 60 minutes for the live overlay (payload + bandwidth trade-off, §8).
- **D3 — Commute origins:** ~10–25 hubs with per-origin rollups (MBTA had 57).
- **D4 — Time window:** v1 shows a rolling recent window (e.g. 7 days of TRUST for delay + 1 day of live) — full-fidelity equivalent of MBTA's "one month" is a storage decision (§6.2).

---

## 5. Target architecture (efficiency-first, Render static)

```
 ┌───────────────────────  $0/mo refresh pipeline (GitHub Actions only)  ─────────────────┐
 │  [1] Collect: Darwin S3 snapshot/day → mirror to R2 · HSP queries (historical actuals)  │
 │      · TRUST/VSTP STOMP window (live only) · ORR · NaPTAN                               │
 │  [2] Normalize (streaming): gunzip → saxes → early station-set filter (§6.7)            │
 │      → CORPUS join (STANOX→CRS), NaPTAN join (coords), schedules index                  │
 │  [3] Derive: MBTA-style JSON artifacts (schemas §6.4) — minified, sorted, deduped       │
 │  [4] Commit data + run `npm run build` (offline, small) → git push → Render auto-deploy │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                │
                                    Render.com — static site (free, CDN, brotli) — serves dist/ only.
                                    Render's build NEVER downloads from S3 (egress + suspension risk, §13 R-2).
```

**Why static beats a web service here** (Render facts, verified 2026-08-02):

- **Static sites on Render are free with no instance at all** — no 15-min spin-down, no 750 instance-hour cap, no cold starts; served from a global CDN with Brotli, HTTP/2, free TLS, and CDN cache invalidation on every deploy.
- A **free web service** would spin down after 15 min idle (~1 min wake, loading page), burn the 750 h/mo budget, have an ephemeral filesystem, no edge caching, and risks suspension for "uncommonly high volume of service-initiated traffic" if it polled Darwin itself. **Do not run a server.**
- **Audit (2026-08): all ETL runs in GitHub Actions.** Render's free Hobby plan has only **5 GB/month outbound** and suspends for service-initiated traffic (including object-storage transfers) — and even at the measured ~10 MB/day, any Render build that touched S3 would both burn egress and expose the shared S3 key to the static host. Render's `buildCommand` therefore runs only `npm run build` on already-committed `data/` (offline, ~150 KB output). Public-repo Actions minutes are free and unlimited (the 2,000 min/mo cap applies to private repos only), so the ETL can afford full daily reprocessing.

**Efficiency principles (non-negotiable):**

1. Every request is a static file; **zero server compute in the request path**.
2. **All data precomputed and minified** — never ship raw Darwin/CIF XML or full JSON.
3. **Lazy loading per section** (mirror MBTA Viz) + per-origin commute files loaded on demand.
4. **Immutable, hashed assets** for JS/CSS (`max-age=31536000, immutable`); short TTL only for data that changes (the live snapshot).
5. Refresh costs $0: GitHub Actions runners (free) do the fetching/transform; Render only runs a short static build (pipeline minutes, 500/mo on the free Hobby plan).
6. Bandwidth budget: **≤ 5 GB/month outbound** on Hobby (down from 100 GB in the Apr 2026 plan change) — every payload byte is budgeted (§8).

---

## 6. Data pipeline specification

### 6.1 Access & credentials (setup, one-time)

| Credential | Source | Used for |
|---|---|---|
| RDM account (raildata.org.uk) | Register via RDM (successor to NRDP) | Subscriptions (Darwin data feeds + Network Rail), product catalogue (§12) |
| S3 access/secret key | Portal → My Feeds → Darwin → "Darwin File Information" | `darwin.xmltimetable` bucket |
| NROD username/password | RDM/NRDP account | `publicdatafeeds.networkrail.co.uk` (CIF, CORPUS, SMART), STOMP port 61612 |
| ORR table 1410 CSV/ODS | ORR Data Portal (annual) | Station usage |
| NaPTAN CSV/XML | data.gov.uk / `naptan.api.dft.gov.uk` (daily) | Coordinates |
| HSP (Historical Service Performance) | RDM product; Basic Auth with RDM/NRDP credentials | Historical per-stop actuals (§6.2) |
| Cloudflare R2 bucket (free tier) | Cloudflare dashboard | Rolling archive of daily S3 snapshots (§6.2) |

**Account liveness:** NRDP accounts are **deleted after 30 days of no feed consumption** — the refresh pipeline must run at least every few weeks even before v1 goes live (or consume a feed on a schedule).

### 6.2 Collection stage (what we download & store)

- **Daily (once/day, ~03:15 UK):**
  - Darwin S3: today's highest `{ts}_v{n}.xml.gz` (timetable, ~10 MiB) + `{ts}_ref_v99.xml.gz` (reference, ~231 KiB) — verified upload ~02:10 UTC.
  - **Mirror both to Cloudflare R2** (free tier: 10 GB storage, $0 egress; overage $0.015/GB/mo) — the bucket retains only days and the shared key is a risk. At ~10 MiB/day, a **90-day rolling window ≈ 0.9 GB** (a full year ≈ 3.6 GB) — comfortably inside the free tier. (GitHub artifacts cap at 90 days / 500 MB; Actions cache evicts after 7 days — neither is a durable archive.)
- **History (v1): HSP queries** for past per-stop actuals — the **only** official source of historical movements (TRUST has no replay; §3.2, §13 R-1). Each refresh cycle calls `serviceMetrics` (from/to, HHMM, date range → matched RIDs) then `serviceDetails` (by RID → per-location `gbtt_pta/ptd` + `actual_ta/actual_td`, cancellation reasons) for the PoC's OD pairs over the rolling window (e.g. 7 days). Respect the webservice rate cap (~5,000 req/hr class): batch queries and **cache results in R2 keyed by `(from,to,date)`**, re-querying only uncached dates.
- **Every refresh cycle (D2, e.g. 15 min):**
  - **Live overlay only**: connect to the TRUST/VSTP STOMP stream for the duration of the job (≤ ~10 min) and snapshot current train positions, lateness, status, platform. This yields "as of last refresh" positions without an always-on consumer. It is **not** a source of history — movements between runs are missed by design, because history comes from HSP.
- **Weekly:** full CIF rebuild from `CIF_ALL_FULL_DAILY`/`CIF_ALL_UPDATE_DAILY` sequence to stay aligned with SCHEDULE.
- **Annually:** ORR 1410; **monthly:** NaPTAN refresh (coordinates change rarely).

**Storage note:** for v1 on free tiers, the persistent TRUST/schedule store lives in the GitHub repo or Actions artifacts (500 MB artifact storage free). Historical real-time positions are **not officially archived by Network Rail** — if we want "one month of live" like MBTA, *we* must archive it from day one.

### 6.3 Normalization stage (codes → geometry → services)

1. Parse timetable XML (S3) or CIF (JSON) → `schedules` table: `{uid, headcode, toc, stp, days_runs, start_date, calling_pattern: [{tiploc_or_crs, arrival, departure, public_arr, public_dep, platform, activity}], origin, destination}`. **Streamed, not DOM-loaded:** `zlib.createGunzip()` → saxes/saxophone event parser (fast-xml-parser builds a whole JS object — unnecessary at ~64 MiB and wrong for the eventual full-year archive). **Filter at parse time** to the PoC station set (CRS/TIPLOC list from §4): drop any schedule whose calling pattern touches no PoC station, and prune out-of-region stops from kept schedules. Expect to discard ~90% of the file before any joins (§6.7).
2. Parse ref XML / CORPUS → code map: `STANOX → TIPLOC → CRS → NLC → UIC`, plus TOC codes.
3. Join NaPTAN (ATCO/CRS → lat/lon) → `stations` table: `{crs, name, tiploc, stanox, lat, lon}`.
4. Build **line/corridor topology** for the Marey chart (decision D1): ordered station sequences per line; assign each service a line; generate schematic `spider`-style coordinates from a **simple geographic projection** (Mercator or equirectangular over the GB bounding box) with optional manual nudge for clarity — no tiles needed, matching MBTA's approach.
5. Resolve TRUST movements: `reporting_stanox` → CRS via the code map; join `train_id` → schedule via UID (from `0001` Activation); apply **BST timestamp correction** (see 6.5).
6. Compute per-service, per-segment actuals: arrival/departure times at each stop, actual travel time vs planned, `timetable_variation`.

### 6.4 Derived artifacts & schemas (the "format we need")

All artifacts are **minified JSON, epoch timestamps, CRS-keyed**, matching the MBTA schemas in §2.2 where the visualization is replicated 1:1.

| Artifact | Schema (v1) | Source | Purpose |
|---|---|---|---|
| `stations.json` | `[{crs, name, lat, lon, tiploc, stanox, usage}]` (usage = annual entries+exits, ORR) | CORPUS/ref + NaPTAN + ORR | everything station-keyed |
| `network.json` | `{lines:[{id, name, color}], stops:[{crs, x, y}], segments:[{line, from_crs, to_crs, stations:[crs…]}]}` | topology (§6.3.4) | map glyph + Marey x-positions |
| `schedule.json` | per selected line: `[{uid, headcode, toc, origin, destination, departures:[{crs, time}], stops:[{crs, planned_time}]}]` | SCHEDULE | planned Marey + station frequency |
| `marey-trips.json` | `[{service, line, begin, end, stops:[{stop: crs, time: epoch_sec}]}]` (actuals) | TRUST | The Trains |
| `station-frequency.json` | `{stops:[{crs, times:[{time, arrivals, departures}], averagesByType:{weekday, offpeak}}]}` (per-hour) | SCHEDULE | The People heatmap (proxy) |
| `station-usage.json` | `{stations:[{crs, entries, exits, interchange, total}], max, min, mean}` | ORR 1410 | The People table + map sizing |
| `delay.json` | 7 days × 96 15-min buckets: `{day, secOfDay, ins:{crs: services/15min}, outs:{…}, lines:[{line, delay_actual:{"from\|to": seconds}, ins_total, delay_actual}]}` | TRUST + SCHEDULE | Congestion & Delay |
| `average-actual-delays.json` | `{"from\|to": avg_seconds}` | TRUST | speed ratio |
| `commute-<origin>.json` | keyed by dest crs: `{result:[[hour,[p10,p50,p90 transit],[p10,p50,p90 wait]]…], actuals:[[hour,transit,wait]…]}` | TRUST | Your Commute |
| `live.json` | `{refreshed_at, trains:[{train_id, headcode, toc, crs, lat, lon, lateness_min, status, platform, origin, destination}]}` | TRUST (rolling window) | Live overlay |
| `toc.json` | `[{toc, name, colour}]` | ref/CORPUS | legend, filters |

**Derivation rules to encode (from MBTA wiki + our re-derivation):**

- Hourly/frequency buckets: MBTA used per-hour volumes for heatmaps, 15-min buckets for `delay.json`; per-minute display derived by `/60`.
- Percentiles: p10/p50/p90 per hour-of-day for transit (actual origin-dep → destination-arr) and wait (actual vs planned dep difference), computed over all observed weekdays in the window.
- `delay_actual` relative metric: `(actual_segment_time − avg_segment_time) / avg_segment_time` — negative = fast, 0 = on time, +0.4 = 40% slower (matches MBTA's colour scale).
- **Dedupe VSTP vs SCHEDULE** on UID + start date + STP indicator (lowest STP letter wins).

### 6.5 Known data bugs & mitigations (must implement)

1. **BST −1 h bug in TRUST**: during UK BST, `gbtt_timestamp`, `planned_timestamp`, `actual_timestamp`, `canx_timestamp`, `dep_timestamp`, `orig_dep_timestamp`, `original_loc_timestamp` are emitted **one hour early** — apply +1 h correction for BST dates.
2. **Sunday outage:** TRUST has a ~5-min gap (~02:00–02:15 Sun) — tolerate gaps; don't alert.
3. **STANOX ≠ CRS:** always map via CORPUS; never assume.
4. **Schedule updates must be applied in sequence**; a full rebuild from the latest full snapshot is the safe reset.
5. **S3 bucket is shallow + shared-key** — mirror every day's files to our own storage; expect a future key rotation.
6. **Darwin Evolution / RDM migration:** re-verify feed endpoints, product names, and credentials at integration time; keep the ETL config-driven.

### 6.6 Live overlay pattern (static-site friendly)

- The live overlay is a **precomputed snapshot** (`live.json`) refreshed every D2 minutes by the pipeline; the page loads `live.json` with `Cache-Control: public, max-age=<D2*60>`, and (optionally) polls it client-side to pick up new snapshots without a reload.
- "Live" means "as of last refresh" — acceptable for a dashboard, $0 cost, no websockets, no server.

### 6.7 Pipeline optimisation for the S3 data (audit 2026-08-02)

The daily timetable is **measured at 4–13 MiB gz ≈ 64 MiB uncompressed** (2026-08-02; the earlier 150–250 MB gz estimate was wrong — R-8 resolved). At that size the file is trivial to process end-to-end, but we still stream for memory hygiene and keep the early filter so derived artifacts only ever see the PoC subset. Strategy, in priority order:

1. **Stream and discard early.** One pass: gunzip → saxes → emit only schedules touching the PoC station set. No full-file object is ever materialised; per-schedule work is O(stops). Expected: keep ~10–15% of schedules and prune most out-of-region stops; peak RSS stays well under 500 MB on a 16 GB runner.
2. **Precompute the filter set.** The PoC station list (CRS/TIPLOC, §4) is static per run — load once. Filter on the XML's TIPLOC/Location elements; use the ref file's own TIPLOC table so no second lookup is needed.
3. **Incremental where cheap, full where reliable.** The daily snapshot is full-only (no deltas), so a fresh full parse each day is simplest and correct. HSP results cache in R2 by `(from,to,date)` so re-runs are no-ops. The live snapshot regenerates from scratch per cycle (small).
4. **GitHub Actions is the only data mover.** Public-repo Actions: free, unlimited minutes, 6 h/job cap, 16 GB RAM / 14 GB disk runners. Render only runs `npm run build` on committed `data/` (offline) — never fetches from S3 (§5, §13 R-2).
5. **Artifact hygiene.** Minified JSON with short keys; lat/lon to 5 dp; epoch timestamps; **per-day, per-line trip files** for the Marey chart so the page lazy-loads only what is in view (§8, R-11).
6. **DTD question — answered:** the 2026-08-02 sample files contain **no DOCTYPE/DTD** and no custom entities; saxes (which does not expand DTD entities) is safe as-is (R-7).

---

## 7. Deployment & refresh on Render

### 7.1 `render.yaml` (in repo root)

```yaml
services:
  - type: web
    name: ukrail-viz
    runtime: static
    branch: prod                 # deploy branch — Render auto-deploys ONLY this (see §7.2)
    buildCommand: npm run build          # generates dist/ from src/ + data/
    staticPublishPath: dist
    headers:
      - path: /assets/*
        name: Cache-Control
        value: public, max-age=31536000, immutable
      - path: /data/*.json
        name: Cache-Control
        value: public, max-age=60         # shortest TTL: live/frequency data
      - path: /data/!(live|station-frequency).json
        name: Cache-Control
        value: public, max-age=3600       # daily/stable artifacts
      - path: /*
        name: Cache-Control
        value: public, max-age=300
```

> Note: CDN cache is **fully invalidated on every deploy** — batch data refreshes rather than deploying continuously. Header glob semantics to be validated against Render's static-site header docs at integration time.

### 7.2 Refresh pipeline (recommended: GitHub Actions, $0)

- **Workflow A — data refresh (schedule `*/D2 * * * *`, or 15/30-min):** fetch Darwin (S3 snapshot daily + HSP history queries + TRUST live window), normalize, derive artifacts, commit `data/` to the repo, push → Render auto-deploys (CDN invalidates). The daily run also mirrors the S3 snapshot to R2 (§6.2).
- **Workflow B — daily (04:15 UK):** S3 timetable/ref mirror + CIF alignment + weekly full rebuild.
- **Workflow C — monthly/annually:** NaPTAN refresh; ORR 1410 refresh.
- Public repos get free Actions minutes (scheduled workflows in public repos are auto-disabled after 60 days without activity — keep the repo active or re-enable via `gh workflow enable`).
- **Alternative triggers (fallback):** cron-job.org (free, up to 60 runs/h) hitting the Render **Deploy Hook URL** (unique per service) — no GitHub dependency.
- **Avoid:** Render cron jobs ($1/mo+ min) and background workers (no free tier) unless we later move off the free plan.
- **Branch model:** `main` is the integration branch — all code and the Actions data pipeline land there. `prod` is the release branch Render deploys from (`branch: prod` in §7.1) and is kept **always a fast-forward of `main`**: after every workflow run the bot pushes `origin main:prod` (T7.3). Nobody commits to `prod`; hotfixes flow through `main` and reach `prod` on the next FF push. A divergent `prod` makes the FF push fail loudly — reconcile with `git switch prod && git reset --hard main && git push --force-with-lease origin prod`.

### 7.3 Render CLI usage

- `render blueprints validate render.yaml` (CLI v2.22.0 — note: there is **no** `render blueprint launch` command in the current CLI; blueprint creation/linking happens in the Dashboard → New → Blueprint, or via `render services create` for non-interactive service creation).
- Deploys: git push auto-deploy, or `render deploys create <SERVICE_ID>`; Deploy Hook URL for external schedulers.

---

## 8. Efficiency budget (the numbers that matter)

**The hard limit: Hobby free plan = 5 GB/month outbound bandwidth** (verified 2026-08-02; changed from 100 GB in the Apr-2026 plan update; overage $0.15/GB, suspension without payment method). Build pipeline minutes: 500/mo. Inbound traffic is free. **This is why all S3 traffic stays inside GitHub Actions and Render only serves `dist/` (§5, §13 R-2).**

### Payload budget (per full page visit ≈ 1.2 MB target)

| Asset | Budget |
|---|---|
| HTML/CSS/JS (hashed, immutable, brotli) | Per-asset budgets in `budgets.json`; vendor stack keeps d3.min.js alone at ~148 KB |
| Section 1: The Trains — marey-trips **split per day + per line** (PoC ≈ 1.2 MB/day at ~2,500 services), network + schedule | ≤ 1.5 MB for a full day, lazy-loaded per line/day |
| Section 2: The People (station-frequency + usage) | ≤ 350 KB |
| Section 3: Congestion & Delay (delay + averages) | ≤ 400 KB |
| Section 4: Your Commute (per-origin file, on demand) | ≤ 150 KB each |
| Live overlay (`live.json`, refreshed every D2) | ≤ 150 KB |
| **First-visit total** | **≈ 1.5–2 MB** (shell ~250 KB + one Marey day ~1.2 MB) |
| **Subsequent/partial visits** | ≪ 500 KB (cache hits, lazy sections) |

**Techniques (all mandatory):**

- Minified JSON with short keys (`crs`, `lat`, `lon`, `t` for times…); no repeated station-name strings in data files (lookups via `stations.json` index).
- Brotli at Render's CDN edge (automatic for static sites; 5–10× on JSON).
- Lazy per-section loading + on-demand commute files (MBTA pattern).
- **Deltas:** for the live overlay, ship `live-delta.json` (only changed trains) after a baseline `live.json` per session, keyed by `train_id`.
- Round lat/lon to 5 dp; encode timestamps as epoch; prefer ints.
- Long-lived immutable caching for everything except the live/daily artifacts.

**Bandwidth math:** 2 MB × ~2,500 visits ≈ 5 GB. Every 100 KB saved ≈ +50 visits/month. Design the first page to be ~1.5 MB or less, keep the heavy Marey day-file lazy-loaded, and re-run `du -sh dist` + a per-file size report on every build (failing CI if the budget is exceeded — §9).

---

## 9. Performance & quality requirements

- `npm run build` must produce `dist/` and a **size report**; CI (or the build) **fails if any artifact exceeds its §8 budget** or total > 15 MB.
- All data loads lazily per section; the initial route renders with ≤ ~250 KB of data.
- No external runtime dependencies (all vendored/bundled at build); no tracking beacons.
- Accessibility floor: the table + map interaction must be usable with keyboard focus + ARIA roles on the station list (bonus over the 2014 original).
- Works on a 13" laptop and mobile (subsample points like the original's iOS path).
- **Licensing & attribution (audit 2026-08-02):** Darwin/NROD data is licensed under **Open Government Licence v2.0 with NRE variations**. Public derived visualisations are permitted, with **mandatory attribution** — a visible link to National Rail Enquiries plus the "Powered by National Rail Enquiries" logo, per NRE brand guidelines. Time-bound data (e.g. live platform numbers) must be suppressed per feed direction. Add the attribution footer to the page (§13 R-5).
- Tests: schema-validation tests for every derived artifact (fixtures), a golden-file test on `delay.json` bucket shape (7×96), and a build + render blueprints validate check run manually via §7.3 until added to CI. ETL unit tests run against **captured sample feeds** (one timetable day, one HSP response set) with the network stubbed; endpoints and credentials are injected via config, never hard-coded (Evolution-proof, §13 R-3).

---

## 10. Non-goals & known data gaps (v1)

- **No per-minute passenger counts** (no public UK equivalent of turnstiles) — substituted with schedule-derived frequency + ORR annual usage (§4). Explicitly documented on the page, like MBTA's "exit data is less reliable" note.
- **No multi-year trends** (v1 is a rolling window); ORR time series (Table 1415) is a possible later addition.
- **No self-archived TRUST history and no continuous STOMP consumer.** Historical actuals come from HSP (§6.2); the live overlay from per-refresh STOMP windows. We do not run an always-on process (conflicts with the $0/no-server constraint; §13 R-1).
- **Live positions are "last reported at the last refresh"** — trains are only as current as the last refresh cycle (D2); no second-by-second tracking.
- **No platform-level geometry** (BPLAN) — platforms shown live from TRUST only.
- **Not covering Northern Ireland** (NaPTAN/data scope is GB; NIR services are a separate network).
- **No always-on server, no websockets, no API endpoints.**

---

## 11. Milestones

| # | Milestone | Status (2026-08-03) | Exit criteria |
|---|---|---|---|
| M0 | **Access spike (eastern region)** | Partial | **Bucket listing + one-day download DONE (2026-08-02)** — naming/sizes/format verified; samples captured in `raw/` (gitignored): `20260802020500_v8.xml.gz` + `20260802020500_ref_v99.xml.gz` (§3.1, §12 Q1). Remaining: RDM product-catalogue review incl. HSP subscription (§12 Q2/Q8); mirror the first day to R2 (R2 account pending); first HSP `serviceMetrics` + `serviceDetails` query returns real eastern-region actuals; one TRUST STOMP window captured (1k+ events); ORR 1410 + NaPTAN downloaded. |
| M1 | **Normalization toolchain** | Tooling committed, not live | Streaming parse of a full daily timetable (gunzip → saxes) with early station-set filter; CORPUS + NaPTAN joined → `stations.json`; HSP responses decoded → per-stop actuals (BST-corrected); unit-tested on captured samples. |
| M2 | **Trains (Marey) — eastern region** | Fixtures | Marey chart renders from real data for the PoC corridors (§4); header glyph animates. |
| M3 | **People** | Fixtures | Frequency + usage heatmaps, station table ↔ map cross-highlighting, click-through station detail. |
| M4 | **Congestion & Delay** | Implemented | Horizon charts + breathing glyphs from HSP-derived actuals. |
| M5 | **Commute** | Implemented | Percentile scatterplots for curated origins (D3), deep-links. |
| M6 | **Live overlay + refresh pipeline** | Implemented, pipeline red | `live.json` refreshed on schedule from STOMP windows; page picks it up; GitHub Actions end-to-end green; R2 mirror running. |
| M7 | **Render deploy + efficiency audit** | Partial | Static site live on Render free tier; `render.yaml` valid; payload budget enforced; bandwidth metered after 1 week ≤ 0.5 GB; attribution footer live. |
| M8 | **Scale-up to full GB** | Implemented | PoC validated; station/line set becomes config; new corridors added via the §6.7 process; full-network payload budget re-audited (§13 R-6). |

---

## 12. Open questions (need the user's account access / decisions)

1. **Bucket listing — RESOLVED (2026-08-02):** `aws s3 ls s3://darwin.xmltimetable/` shows two prefixes: `PPTimetable/` (the daily pair `{ts}_v{n}.xml.gz` / `{ts}_ref_v{n}.xml.gz`; current version `v8`, ref alias `v99`; timetable 4–13 MiB gz ≈ 64 MiB raw; upload ~02:10 UTC; several revisions/day) and `EHSnapshot/` (tiny `HD`/`ZZ` marker files, dormant since 30 Jul). **No `~.pub/~.json/~.xml` files exist in this bucket** — that recollection likely refers to a different Darwin product or bucket; confirm against the RDM product pages. Full detail in §3.1; the ingestion parser targets the day's highest `v{n}`.
2. **RDM catalogue** — confirm which subscriptions/products are on your raildata.org.uk account (Darwin timetable / reference / TD / live feeds, Network Rail NROD schedule + TRUST, HSP, ORR, NaPTAN). The spec assumes Darwin + Network Rail + ORR + NaPTAN are all available.
3. **D1 — which CrossCountry routes count as "selected"** (recommend: Birmingham ↔ Cambridge ↔ Stansted via Peterborough/Ely, plus any XC service calling at ≥2 PoC stations). c2c, Greater Anglia and Great Northern route sets are unambiguous; XC needs your pick (§4).
4. **D2 — live refresh cadence** (recommend 15 min; §6.6).
5. **D3 — commute origins** (recommend ~10–20: London terminals + Cambridge, Peterborough, Norwich, Ipswich, Southend, Stansted; §4).
6. **Darwin Evolution go-live date** — re-verify on the portal/feeds at M0 before finalising the ETL (currently mid-August 2026; R-3).
7. **File retention — PARTIALLY ANSWERED (2026-08-02):** the bucket currently holds 25 Jul → 02 Aug (~10 days), matching the wiki's "usually several days". The S3 product has been publishing since **2026-07-25** (ahead of the announced mid-August Evolution go-live). Confirm any stated retention on the product page at ETL; the R2 mirror (§6.2) is the real archive regardless.
8. **HSP** — confirm an HSP product/subscription is available on the account (Q2), and re-verify at M0 whether the `hsp-prod.rockshore.net` API survives the Darwin Evolution migration or moves (R-9).

---

## 13. Audit findings & risk register (2026-08-02)

| ID | Risk / finding | Severity | Mitigation / status |
|---|---|---|---|
| R-1 | **TRUST has no archive or replay** — a periodic cron cannot capture a continuous STOMP stream, so self-archived history is impossible at $0 | High | Historical actuals come from **HSP** (§3.2, §6.2); the live overlay uses each refresh's STOMP window only (§10) |
| R-2 | **Render Hobby free tier = 5 GB/mo outbound + suspension risk** for service-initiated traffic (Apr-2026 plan change) | High | **All ETL runs in GitHub Actions**; Render's build is offline on committed `data/`; bandwidth metered at M7 (§5, §7, §8) |
| R-3 | **Darwin Evolution go-live mid-August 2026** — we build into the migration window; endpoints/products/credentials may change | High | Config-driven ETL; re-verify every endpoint at M0; capture sample feeds for tests (§3.1, §6.1, §9) |
| R-4 | **S3 filename scheme mismatch** — CLOSED (2026-08-02 M0 listing): naming confirmed `{ts}_v{n}.xml.gz` / `{ts}_ref_v{n}.xml.gz` under `PPTimetable/`; no `~.pub/~.json/~.xml` variant exists in this bucket | Closed | Verified (§12 Q1, §3.1); the parser ingests the day's highest `v{n}` |
| R-5 | **Licensing/attribution** — OGL v2.0 + NRE variations; mandatory attribution; time-bound data must be suppressed | Medium | Attribution footer + NRE logo; live platform numbers suppressed (§9) |
| R-6 | **Full-network scale** — the full-GB Marey chart is noise: dozens of lines, ~2,500 stations | Medium | PoC first; station/line set is config; per-line groups + day-split trip files; payload budget re-audited before M8 (§4, §8) |
| R-7 | **Large-XML parsing + DTD entities** — MEASURED at ~64 MiB uncompressed (not ~1.5 GB); no DOCTYPE/DTD in the samples | Low | Streaming `gunzip → saxes` + early station-set filter retained (§6.3, §6.7) — cheap insurance, no longer load-bearing |
| R-8 | **Timetable file size unverified** — CLOSED (2026-08-02): measured 4–13 MiB gz / ~64 MiB raw per day; the community 150–250 MB gz figure is wrong for this feed | Closed | Measured at M0 (§12 Q1, §3.1); budget updated throughout §6 |
| R-9 | **HSP rate caps (~5,000 req/hr) and post-Evolution endpoint fate** | Low | Batch queries; cache by `(from,to,date)` in R2; re-verify the endpoint at M0 (§6.2, §12 Q8) |
| R-10 | **Scheduled Actions workflows auto-disable after 60 days of repo inactivity** | Low | `gh workflow enable` on resume; periodic commits keep the repo active (§7.2) |
| R-11 | **PoC Marey density** — ~3,500–4,500 services/day on one chart is still busy | Low | Per-line chart groups + day-split trip files (§4, §6.4) |

---

## 14. Sources

- MBTA Viz live site / repo / wiki: https://mbtaviz.github.io/ · https://github.com/mbtaviz/mbtaviz.github.io/ · https://github.com/mbtaviz/mbtaviz.github.io/wiki
- MBTA source announcement (processing utilities not released): http://mbtaviz.wordpress.com/2014/07/25/website-source-announcement
- National Rail — Darwin data feeds (registration via Rail Data Marketplace): https://www.nationalrail.co.uk/developers/darwin-data-feeds/
- Rail Data Marketplace (RDM, successor portal): https://raildata.org.uk/
- ORR — Estimates of station usage (Table 1410/1415): https://dataportal.orr.gov.uk/statistics/usage/estimates-of-station-usage/
- NaPTAN: https://www.data.gov.uk/dataset/ff93ffc1-6656-47d8-9155-85ea0b8f2251/national-public-transport-access-nodes-naptan · https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv
- Open Rail Data wiki (archived): National Rail Data Portal · About the Feeds · Train Movements · SCHEDULE · VSTP · TD · RTPPM · Darwin Push Port · Reference Data · HSP (via web.archive.org, cited in §3.2/§6.3)
- Render docs/pricing (verified 2026-08-02): https://render.com/docs/free · /docs/static-sites · /docs/blueprint-spec · /docs/cli-reference · /docs/outbound-bandwidth · https://render.com/pricing · /docs/new-workspace-plans

---

## 15. Visual Design System (UI Design Spec)

*Incorporated from `docs/superpowers/specs/2026-08-02-ui-design.md` — the visual design system for the UK Rail Viz dashboard, emulating the MBTA Viz site's aesthetic.*

### 15.1 Design Principles

- **Data-first**: Visualizations dominate the viewport; chrome is minimal.
- **Dark theme**: Deep navy background with amber accents — reads as "operations center."
- **SVG-first**: All visualizations render as inline SVG; no canvas, no raster.
- **Vendored runtime stack**: d3 ~3.5.17, d3-tip, underscore, moment, es6-shim, jquery ~2.1.0, bootstrap ~3.1.1 — all bundled as static scripts, no npm install or CDN fetch at runtime.
- **Timeless over trendy**: The MBTA Viz aesthetic has aged well because it's functional, not fashionable.

### 15.2 Color Palette

The main stylesheet (`src/styles/main.css`) is the MBTA exemplar CSS — a Bootstrap-3-palette light stylesheet with no CSS custom properties. A small UK addendum (~3124–3157) layers on the dark theme tokens used by the dashboard. The Bootstrap 3 palette provides the base light stylesheet; the dark theme overrides are additive.

| Token | Usage |
|---|---|
| Page background | Deep navy (`#0a1628` in dark theme) |
| Card/slot background | Dark panel (`#132236` in dark theme) |
| Primary text | Light ink (`#e8eef4` in dark theme) |
| Secondary text, axis labels, grid | Muted grey (`#7a8fa3` in dark theme) |
| Section headings, highlights, active states | Amber accent (`#ffb400`) |
| Borders, grid lines, dividers | Subtle line (`#2a3a4a` in dark theme) |
| Late/alert states | Red (`#ef4444`) |
| On-time states | Green (`#22c55e`) |

### 15.3 Typography

- **Font stack**: `-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Base**: `16px / 1.5` on `html, body`
- **Section headings (`h2`)**: `1.3rem`, `--accent` color, weight 600
- **Panel titles**: `0.95rem`, `--accent` color
- **Axis/station labels**: `11px`, `--muted` color
- **Tooltips**: `0.8rem`, `1.35` line-height
- **Status text**: `0.85rem`, `--muted` color

### 15.4 Spacing Scale

Consistent 4px/8px base scale using CSS custom properties:

| Token | Value |
|---|---|
| `--sp-1` | `0.25rem` (4px) |
| `--sp-2` | `0.5rem` (8px) |
| `--sp-3` | `0.75rem` (12px) |
| `--sp-4` | `1rem` (16px) |
| `--sp-5` | `1.25rem` (20px) |
| `--sp-6` | `1.5rem` (24px) |
| `--sp-8` | `2rem` (32px) |

### 15.5 Layout

- Single long HTML page, one `<section>` per visualization with anchor IDs.
- `max-width: 64rem` centered container with `margin: 0 auto`.
- Sections separated by `1px solid var(--line)` border-bottom.
- Section padding: `1.75rem 0`.
- Each section has an `<h2>` title and optional `.viz-note` description.
- SVG visualizations fill full container width (`width: 100%`).

### 15.6 SVG Visualization Styles

**General**: All SVGs use `viewBox` for responsive scaling, no fixed width/height. Grid lines: `stroke: var(--line)`, `stroke-width: 0.5`. Axis labels: `fill: var(--muted)`, `font-size: 11px`. Station labels: `fill: var(--muted)`, `font-size: 11px`, right-aligned.

**Marey Chart (The Trains)**: Trajectory paths `stroke-width: 1.4`, `opacity: 0.75`, color per line. Dots `r: 1.8`. Selected: `opacity: 1`, `stroke-width: 2.6`. Dimmed (hover): `opacity: 0.15`.

**The People (Heatmap)**: Heat cells `height: 16px`, `border-radius: 2px`. Active cell: `outline: 1px solid var(--ink)`, `outline-offset: 1px`. Heat ramp: `hsl(215, 60%, 22%)` → `hsl(45, 95%, 60%)`.

**Congestion & Delay (Horizon Charts)**: Horizon areas `mix-blend-mode: multiply`. Delay band `opacity: 0.85`. Scrub line `stroke: var(--accent)`, `stroke-width: 2`.

**Live Overlay**: On-time dots `fill: var(--green)`. Late dots `fill: var(--red)`. Labels `fill: var(--ink)`, `font-size: 9`.

### 15.7 Interaction Patterns

- **Delegated events**: Mouse events on parent wrapper `<div>`, not per-element.
- **Hover**: Pure CSS class toggles. `.highlight-active` dims non-selected items via `opacity`.
- **Tooltip**: Absolute-positioned `<div>`, dark background (`#0b1219`), amber strong text, `pointer-events: none`, `z-index: 5`.
- **Click**: Toggle `.active` class for cross-section highlighting.
- **d3 v3 + jQuery interaction**: d3 v3 handles SVG rendering and data joins; jQuery provides DOM utility helpers. All interactions use delegated events and class-based toggles on SVG elements.

### 15.8 Deferred Sections

All five sections render via IIFE scripts loaded in order in the HTML shell. Each IIFE checks `VIZ.requiresData` for its data file before rendering; sections whose data is absent simply skip their SVG draw calls. The five IIFE scripts are: `the-trains.js`, `the-people.js`, `congestion-and-delay.js`, `your-commute.js`, and `live-overlay.js`.

### 15.9 Implementation Notes

- **Color values** are specified per the design system; exact MBTA Viz values should be verified by auditing the live site during implementation.
- **No `box-shadow`** — MBTA Viz uses flat surfaces with no depth shadows.
- **Axis label font size** — `11px` aligns with MBTA Viz's 10px–11px range.
- **CSS migration** — `src/styles/main.css` is the MBTA exemplar CSS (Bootstrap-3-palette light stylesheet) with a small UK addendum (~3124–3157) for dark-theme overrides; it does not use CSS custom properties throughout.
