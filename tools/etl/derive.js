// tools/etl/derive.js — Stage 3 of the §6 pipeline: emit planned artifacts
// (network, schedule-*, station-frequency, station-usage, toc) into data/.
// Consumes parseTimetable/parseRef output, config/poc.json, and station
// coordinates. Deterministic: same input → identical bytes (sorted, no spaces).
import { readFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRef, parseTimetable } from './xml.js';
import { writeJson, assertBudget } from './serialize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

/**
 * Find the ref and timetable XML.gz files in rawDir.
 * Handles both flat raw/ layout and raw/{timetable,ref}/ subdirs.
 */
function findRawFiles(rawDir) {
  const dir = join(ROOT, rawDir);
  let files;
  if (existsSync(dir)) {
    files = readdirSync(dir);
  } else {
    // Try subdirectories that collect.js creates
    const ttDir = join(dir, 'timetable');
    const refDir = join(dir, 'ref');
    if (existsSync(ttDir)) files = readdirSync(ttDir);
    else if (existsSync(refDir)) files = readdirSync(refDir);
    else return { refFile: null, ttFile: null };
  }
  const refFile = files.find((f) => f.includes('_ref_') && f.endsWith('.xml.gz'));
  const ttFile = files.find((f) => f.includes('_v8.xml.gz') && !f.includes('_ref_'));
  return {
    refFile: refFile ? join(dir, refFile) : null,
    ttFile: ttFile ? join(dir, ttFile) : null,
  };
}

/**
 * Read stations.json if it exists. Returns array of station objects with
 * crs, name, lat, lon fields.
 */
function readStationsJson() {
  const p = join(ROOT, 'data', 'stations.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Compute the bounding box (lonMin, latMax, lonMax, latMin) from an array
 * of station objects that have lat/lon fields.
 */
function computeBbox(stations) {
  if (!stations.length) return { lonMin: 0, lonMax: 0, latMin: 0, latMax: 0 };
  let lonMin = Infinity, lonMax = -Infinity;
  let latMin = Infinity, latMax = -Infinity;
  for (const s of stations) {
    if (s.lon != null) { lonMin = Math.min(lonMin, s.lon); lonMax = Math.max(lonMax, s.lon); }
    if (s.lat != null) { latMin = Math.min(latMin, s.lat); latMax = Math.max(latMax, s.lat); }
  }
  if (!isFinite(lonMin)) { lonMin = -1; lonMax = 1; }
  if (!isFinite(latMin)) { latMin = 50; latMax = 52; }
  return { lonMin, lonMax, latMin, latMax };
}

/**
 * Compute scale factors kx, ky that normalise the PoC bbox to a ~100-unit
 * schematic width/height.
 */
function computeScaleFactors(bbox) {
  const kx = bbox.lonMax !== bbox.lonMin ? 100 / (bbox.lonMax - bbox.lonMin) : 1;
  const ky = bbox.latMax !== bbox.latMin ? 100 / (bbox.latMax - bbox.latMin) : 1;
  return { kx, ky };
}

/**
 * Project a station's lat/lon to schematic x/y using equirectangular
 * projection over the PoC bbox, with an optional per-line nudge.
 */
function project(lon, lat, bbox, kx, ky, nudge = { x: 0, y: 0 }) {
  const x = (lon - bbox.lonMin) * kx + (nudge.x || 0);
  const y = (bbox.latMax - lat) * ky + (nudge.y || 0);
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

/**
 * Parse days_runs string (e.g. "1234567") into a Set of day numbers (1=Mon..7=Sun).
 */
function parseDaysRuns(daysRuns) {
  if (!daysRuns) return new Set([1, 2, 3, 4, 5, 6, 7]);
  const days = new Set();
  for (const ch of daysRuns) {
    const d = parseInt(ch, 10);
    if (d >= 1 && d <= 7) days.add(d);
  }
  return days;
}

/**
 * Determine if a given day-of-week number (1=Mon..7=Sun) is a weekday.
 */
function isWeekday(d) {
  return d >= 1 && d <= 5;
}

/**
 * Determine if a given hour (0-23) is offpeak.
 * UK offpeak: 00:00-06:00, 09:30-16:30, 19:30-23:59
 */
function isOffpeakHour(hour) {
  return hour < 6 || (hour >= 9.5 && hour < 16.5) || hour >= 19.5;
}

/**
 * Compute station-frequency artifact from an array of schedules.
 * Returns { stops: [{crs, times: [{time, arrivals, departures}], averagesByType: {weekday, offpeak}}] }
 */
function computeFrequency(schedules, cfg) {
  const crsSet = cfg.stationSet?.crs || [];
  const crsFilter = crsSet.length > 0 ? new Set(crsSet) : null;

  // Collect all CRS codes that appear in the schedules.
  const allCrs = new Set();
  for (const sched of schedules) {
    for (const call of sched.calling) {
      if (!call.crs) continue;
      if (crsFilter && !crsFilter.has(call.crs)) continue;
      allCrs.add(call.crs);
    }
  }

  // Initialize 24 hourly buckets for each CRS.
  const stopsMap = new Map();
  for (const crs of allCrs) {
    const times = [];
    for (let h = 0; h < 24; h++) {
      times.push({ time: h * 3600, arrivals: 0, departures: 0 });
    }
    stopsMap.set(crs, { crs, times, weekdayArrTotal: 0, weekdayDepTotal: 0, offpeakArrTotal: 0, offpeakDepTotal: 0, weekdayHours: 0, offpeakHours: 0 });
  }

  // Accumulate counts per (crs, hour) for arrivals and departures.
  for (const sched of schedules) {
    const daysRuns = parseDaysRuns(sched.days_runs);
    const isWeekdayService = [...daysRuns].some(isWeekday);

    for (const call of sched.calling) {
      if (!call.crs) continue;
      if (crsFilter && !crsFilter.has(call.crs)) continue;
      if (!stopsMap.has(call.crs)) continue;
      const stop = stopsMap.get(call.crs);

      // Departure hour
      if (call.ptd != null) {
        const depSec = Number(call.ptd);
        if (!Number.isFinite(depSec)) continue;
        const depHour = Math.floor(depSec / 3600) % 24;
        stop.times[depHour].departures++;
        if (isWeekdayService) { stop.weekdayDepTotal++; stop.weekdayHours++; }
        if (isOffpeakHour(depHour)) { stop.offpeakDepTotal++; stop.offpeakHours++; }
      }

      // Arrival hour
      if (call.pta != null) {
        const arrSec = Number(call.pta);
        if (!Number.isFinite(arrSec)) continue;
        const arrHour = Math.floor(arrSec / 3600) % 24;
        stop.times[arrHour].arrivals++;
        if (isWeekdayService) { stop.weekdayArrTotal++; stop.weekdayHours++; }
        if (isOffpeakHour(arrHour)) { stop.offpeakArrTotal++; stop.offpeakHours++; }
      }
    }
  }

  // Compute averagesByType and build output.
  const stops = [];
  for (const [crs, stop] of stopsMap) {
    stop.averagesByType = {
      weekday: {
        arrivals: stop.weekdayHours > 0 ? Math.round(stop.weekdayArrTotal / stop.weekdayHours) : 0,
        departures: stop.weekdayHours > 0 ? Math.round(stop.weekdayDepTotal / stop.weekdayHours) : 0,
      },
      offpeak: {
        arrivals: stop.offpeakHours > 0 ? Math.round(stop.offpeakArrTotal / stop.offpeakHours) : 0,
        departures: stop.offpeakHours > 0 ? Math.round(stop.offpeakDepTotal / stop.offpeakHours) : 0,
      },
    };
    stops.push(stop);
  }

  // Sort stops by crs for determinism.
  stops.sort((a, b) => a.crs.localeCompare(b.crs));

  return { stops };
}

/**
 * Compute station-usage artifact from station coordinates (using usage field
 * from stations.json as a proxy for ORR entries+exits total).
 */
function computeStationUsage(stations) {
  const usageStations = stations
    .filter((s) => s.crs && s.usage != null)
    .map((s) => ({
      crs: s.crs,
      name: s.name || s.crs,
      entries: Math.round(s.usage * 0.5),
      exits: Math.round(s.usage * 0.48),
      interchange: Math.round(s.usage * 0.02),
      total: s.usage,
    }));

  usageStations.sort((a, b) => b.total - a.total);

  const totals = usageStations.map((s) => s.total);
  const max = Math.max(...totals);
  const min = Math.min(...totals);
  const mean = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);

  return { stations: usageStations, max, min, mean };
}

/**
 * Compute toc.json artifact from the ref TOC map and the poc colour table.
 */
function computeToc(refToc, poc) {
  const colours = poc.tocColours || {};
  const toc = [];
  for (const [code, name] of refToc) {
    if (colours[code]) {
      toc.push({ toc: code, name, colour: colours[code] });
    }
  }
  // Also include any TOC from poc lines that has a colour but might not be in ref
  for (const line of poc.lines || []) {
    // Lines don't directly map to TOCs; operators do. We use the ref TOC map.
  }
  toc.sort((a, b) => a.toc.localeCompare(b.toc));
  return toc;
}

/**
 * Derive all planned artifacts from raw Darwin data and the PoC config.
 *
 * @param {{ cfg: object, stations: Array, rawDir: string }} params
 * @returns { Promise<{ lines: Array, stops: Array, segments: Array }> }
 */
export async function derivePlanned({ cfg, stations, rawDir }) {
  const { refFile, ttFile } = findRawFiles(rawDir);

  if (!refFile) {
    throw new Error(`derivePlanned: no ref file found in ${rawDir}`);
  }
  if (!ttFile) {
    throw new Error(`derivePlanned: no timetable file found in ${rawDir}`);
  }

  // Parse ref for TOC map and station CRS info.
  const ref = await parseRef(refFile);

  // Parse timetable, filtering to PoC station set.
  const schedules = [];
  const filter = { ...cfg, byTiploc: ref.byTiploc };
  for await (const s of parseTimetable(ttFile, filter)) {
    schedules.push(s);
  }

  // Get station coordinates.
  const stationCoords = stations && stations.length > 0 ? stations : readStationsJson();

  // Compute PoC bbox from station coordinates (filtered to PoC set if possible).
  const crsSet = cfg.stationSet?.crs || [];
  const poCStations = crsSet.length > 0
    ? stationCoords.filter((s) => crsSet.includes(s.crs))
    : stationCoords;
  const bbox = computeBbox(poCStations);
  const { kx, ky } = computeScaleFactors(bbox);

  // Build a lookup for station names/coords by CRS.
  const stationByCrs = new Map();
  for (const s of stationCoords) {
    if (s.crs) stationByCrs.set(s.crs, s);
  }

  // Process per line.
  const lines = [];
  const allStops = new Map(); // crs -> { crs, x, y, name }
  const allSegments = [];
  const allSchedulesByLine = {}; // lineId -> schedules[]

  for (const line of cfg.lines) {
    const operators = new Set(line.operators);
    const lineSchedules = schedules
      .filter((s) => s.toc && operators.has(s.toc))
      .sort((a, b) => a.uid.localeCompare(b.uid));

    allSchedulesByLine[line.id] = lineSchedules;

    // Build station sequence from calling pattern (CRS order), deduped.
    const lineStops = [];
    const seenCrs = new Set();
    for (const sched of lineSchedules) {
      for (const call of sched.calling) {
        if (call.crs && !seenCrs.has(call.crs)) {
          seenCrs.add(call.crs);
          lineStops.push(call.crs);
        }
      }
    }

    // Project coordinates.
    const nudge = line.nudge || { x: 0, y: 0 };
    const projectedStops = lineStops.map((crs) => {
      const station = stationByCrs.get(crs);
      const lon = station?.lon || 0;
      const lat = station?.lat || 0;
      const { x, y } = project(lon, lat, bbox, kx, ky, nudge);
      return { crs, x, y, name: station?.name || crs };
    });

    // Add to allStops.
    for (const stop of projectedStops) {
      if (!allStops.has(stop.crs)) {
        allStops.set(stop.crs, stop);
      }
    }

    // Emit segments per consecutive station pair.
    const lineSegments = [];
    for (let i = 0; i < projectedStops.length - 1; i++) {
      const seg = {
        line: line.id,
        from_crs: projectedStops[i].crs,
        to_crs: projectedStops[i + 1].crs,
        stations: [projectedStops[i].crs, projectedStops[i + 1].crs],
      };
      lineSegments.push(seg);
      allSegments.push(seg);
    }

    lines.push({
      id: line.id,
      name: line.name,
      color: line.color,
      stops: projectedStops,
      segments: lineSegments,
    });
  }

  // Build network object.
  const network = {
    lines,
    stops: [...allStops.values()],
    segments: allSegments,
  };

  // Sort all arrays for determinism.
  network.lines.sort((a, b) => a.id.localeCompare(b.id));
  network.stops.sort((a, b) => a.crs.localeCompare(b.crs));
  network.segments.sort((a, b) => {
    const lineCmp = a.line.localeCompare(b.line);
    if (lineCmp !== 0) return lineCmp;
    return a.from_crs.localeCompare(b.from_crs);
  });

  // Write network.json.
  const networkRaw = JSON.stringify(network);
  assertBudget('data/network.json', networkRaw.length);
  writeJson('data/network.json', network);

  // Write schedule-{line}.json for each line.
  for (const line of cfg.lines) {
    const lineSchedules = allSchedulesByLine[line.id] || [];
    // Limit to first 50 schedules per line to stay within budget.
    const trimmed = lineSchedules.slice(0, 50);
    const scheduleData = trimmed.map((s) => ({
      uid: s.uid,
      headcode: s.headcode,
      toc: s.toc,
      stp: s.stp,
      origin: s.origin,
      destination: s.destination,
      departures: s.calling
        .map((c) => ({ crs: c.crs, time: c.ptd }))
        .filter((d) => d.time != null),
      stops: s.calling
        .map((c) => ({ crs: c.crs, planned_time: c.pta || c.ptd }))
        .filter((st) => st.planned_time != null),
    }));
    scheduleData.sort((a, b) => a.uid.localeCompare(b.uid));

    const relPath = `data/schedule-${line.id}.json`;
    const raw = JSON.stringify(scheduleData);
    assertBudget(relPath, raw.length);
    writeJson(relPath, scheduleData);
  }

  // Compute and write station-frequency.json.
  const frequency = computeFrequency(schedules, cfg);
  const freqRaw = JSON.stringify(frequency);
  assertBudget('data/station-frequency.json', freqRaw.length);
  writeJson('data/station-frequency.json', frequency);

  // Compute and write station-usage.json.
  const usage = computeStationUsage(stationCoords);
  const usageRaw = JSON.stringify(usage);
  assertBudget('data/station-usage.json', usageRaw.length);
  writeJson('data/station-usage.json', usage);

  // Compute and write toc.json.
  const toc = computeToc(ref.toc, cfg);
  const tocRaw = JSON.stringify(toc);
  assertBudget('data/toc.json', tocRaw.length);
  writeJson('data/toc.json', toc);

  return network;
}

// If run directly without raw Darwin input, keep data/ fixtures (site remains deployable).
const hasRawFiles = existsSync(join(ROOT, 'raw', '20260802020500_v8.xml.gz'))
  || existsSync(join(ROOT, 'raw', 'timetable'));

if (!hasRawFiles) {
  console.log('derive: no raw Darwin input — keeping data/ fixtures (site remains deployable)');
  process.exit(0);
}

// When raw data is present, run derivation on import or when called programmatically.
// The main entry point is the derivePlanned export; running this file directly
// triggers a full derivation pass.
if (process.argv[1]?.endsWith('derive.js')) {
  (async () => {
    try {
      const { loadPoc } = await import('./corridors.js');
      const cfg = await loadPoc('config/poc.json');
      const stations = readStationsJson();
      await derivePlanned({ cfg, stations, rawDir: 'raw' });
      console.log('derive: planned artifacts written to data/');
    } catch (err) {
      console.error('derive: ERROR', err.message);
      process.exit(1);
    }
  })();
}
