// tools/etl/derive.js — Stage 3 of the §6 pipeline: emit planned + actual artifacts
// (network, schedule-*, station-frequency, station-usage, toc, delay buckets, commute) into data/.
// Consumes parseTimetable/parseRef output, config/poc.json, and station
// coordinates. Deterministic: same input → identical bytes (sorted, no spaces).
import { readFileSync, existsSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRef, parseTimetable } from './xml.js';
import { assertBudget } from './serialize.js';
import { bstCorrectionMs } from './normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const hasRawTimetable = existsSync(join(ROOT, 'raw', 'timetable'));
const hasRawMovements = existsSync(join(ROOT, 'raw', 'movements'));

// Artifact writer.  Default target is data/; tests pass a temp dir so they
// never clobber the real artifacts (see tests/etl.test.js).
function outWriter(outDir) {
  return function (name, obj) {
    const rel = name.replace(/^data\//, '');
    writeFileSync(join(outDir, rel), JSON.stringify(obj) + '\n', 'utf8');
  };
}

// --- Helper functions for planned derivation ---

function findRawFiles(rawDir) {
  const dir = join(ROOT, rawDir);
  const ttDir = join(dir, 'timetable');
  const refDir = join(dir, 'ref');

  // If rawDir has timetable/ and ref/ subdirectories, look inside them.
  if (existsSync(ttDir) || existsSync(refDir)) {
    const ttFiles = existsSync(ttDir) ? readdirSync(ttDir) : [];
    const refFiles = existsSync(refDir) ? readdirSync(refDir) : [];
    const refFile = refFiles.find((f) => f.includes('_ref_') && f.endsWith('.xml.gz'));
    const ttFile = ttFiles.find((f) => f.includes('_v8.xml.gz') && !f.includes('_ref_'));
    return {
      refFile: refFile ? join(refDir, refFile) : null,
      ttFile: ttFile ? join(ttDir, ttFile) : null,
    };
  }

  // Otherwise look directly in rawDir.
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const refFile = files.find((f) => f.includes('_ref_') && f.endsWith('.xml.gz'));
  const ttFile = files.find((f) => f.includes('_v8.xml.gz') && !f.includes('_ref_'));
  return {
    refFile: refFile ? join(dir, refFile) : null,
    ttFile: ttFile ? join(dir, ttFile) : null,
  };
}

function readStationsJson() {
  const p = join(ROOT, 'data', 'stations.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}

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

function computeScaleFactors(bbox) {
  const kx = bbox.lonMax !== bbox.lonMin ? 100 / (bbox.lonMax - bbox.lonMin) : 1;
  const ky = bbox.latMax !== bbox.latMin ? 100 / (bbox.latMax - bbox.latMin) : 1;
  return { kx, ky };
}

function project(lon, lat, bbox, kx, ky, nudge = { x: 0, y: 0 }) {
  const x = (lon - bbox.lonMin) * kx + (nudge.x || 0);
  const y = (bbox.latMax - lat) * ky + (nudge.y || 0);
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function parseDaysRuns(daysRuns) {
  if (!daysRuns) return new Set([1, 2, 3, 4, 5, 6, 7]);
  const days = new Set();
  for (const ch of daysRuns) {
    const d = parseInt(ch, 10);
    if (d >= 1 && d <= 7) days.add(d);
  }
  return days;
}

function isWeekday(d) {
  return d >= 1 && d <= 5;
}

function isOffpeakHour(hour) {
  return hour < 6 || (hour >= 9.5 && hour < 16.5) || hour >= 19.5;
}

function computeFrequency(schedules, cfg) {
  const crsSet = cfg.stationSet?.crs || [];
  const crsFilter = crsSet.length > 0 ? new Set(crsSet) : null;
  const allCrs = new Set();
  for (const sched of schedules) {
    for (const call of sched.calling) {
      if (!call.crs) continue;
      if (crsFilter && !crsFilter.has(call.crs)) continue;
      allCrs.add(call.crs);
    }
  }
  const stopsMap = new Map();
  for (const crs of allCrs) {
    const times = [];
    for (let h = 0; h < 24; h++) {
      times.push({ time: h * 3600, arrivals: 0, departures: 0 });
    }
    stopsMap.set(crs, { crs, times, weekdayArrTotal: 0, weekdayDepTotal: 0, offpeakArrTotal: 0, offpeakDepTotal: 0, weekdayHours: 0, offpeakHours: 0 });
  }
  for (const sched of schedules) {
    const daysRuns = parseDaysRuns(sched.days_runs);
    const isWeekdayService = [...daysRuns].some(isWeekday);
    for (const call of sched.calling) {
      if (!call.crs) continue;
      if (crsFilter && !crsFilter.has(call.crs)) continue;
      if (!stopsMap.has(call.crs)) continue;
      const stop = stopsMap.get(call.crs);
      if (call.ptd != null) {
        const depSec = Number(call.ptd);
        if (!Number.isFinite(depSec)) continue;
        const depHour = Math.floor(depSec / 3600) % 24;
        stop.times[depHour].departures++;
        if (isWeekdayService) { stop.weekdayDepTotal++; stop.weekdayHours++; }
        if (isOffpeakHour(depHour)) { stop.offpeakDepTotal++; stop.offpeakHours++; }
      }
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
  stops.sort((a, b) => a.crs.localeCompare(b.crs));
  return { stops };
}

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

function computeToc(refToc, poc) {
  const colours = poc.tocColours || {};
  const toc = [];
  for (const [code, name] of refToc) {
    if (colours[code]) {
      toc.push({ toc: code, name, colour: colours[code] });
    }
  }
  for (const line of poc.lines || []) {
    // Lines don't directly map to TOCs; operators do. We use the ref TOC map.
  }
  toc.sort((a, b) => a.toc.localeCompare(b.toc));
  return toc;
}

// --- Public: derive planned artifacts ---

/**
 * @param {{ cfg: object, stations: Array, rawDir: string, outDir?: string }} params
 * @returns { Promise<{ lines: Array, stops: Array, segments: Array }> }
 */
export async function derivePlanned({ cfg, stations, rawDir, outDir = join(ROOT, 'data') }) {
  const { refFile, ttFile } = findRawFiles(rawDir);
  if (!refFile) throw new Error(`derivePlanned: no ref file found in ${rawDir}`);
  if (!ttFile) throw new Error(`derivePlanned: no timetable file found in ${rawDir}`);
  const write = outWriter(outDir);

  const ref = await parseRef(refFile);
  const schedules = [];
  const filter = { ...cfg, byTiploc: ref.byTiploc };
  for await (const s of parseTimetable(ttFile, filter)) {
    schedules.push(s);
  }

  const stationCoords = stations && stations.length > 0 ? stations : readStationsJson();
  const crsSet = cfg.stationSet?.crs || [];
  const poCStations = crsSet.length > 0
    ? stationCoords.filter((s) => crsSet.includes(s.crs))
    : stationCoords;
  const bbox = computeBbox(poCStations);
  const { kx, ky } = computeScaleFactors(bbox);

  const stationByCrs = new Map();
  for (const s of stationCoords) {
    if (s.crs) stationByCrs.set(s.crs, s);
  }

  const lines = [];
  const allStops = new Map();
  const allSegments = [];
  const allSchedulesByLine = {};

  for (const line of cfg.lines) {
    const operators = new Set(line.operators);
    const lineSchedules = schedules
      .filter((s) => s.toc && operators.has(s.toc))
      .sort((a, b) => a.uid.localeCompare(b.uid));
    allSchedulesByLine[line.id] = lineSchedules;

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

    const nudge = line.nudge || { x: 0, y: 0 };
    const projectedStops = lineStops.map((crs) => {
      const station = stationByCrs.get(crs);
      const lon = station?.lon || 0;
      const lat = station?.lat || 0;
      const { x, y } = project(lon, lat, bbox, kx, ky, nudge);
      return { crs, x, y, name: station?.name || crs };
    });

    for (const stop of projectedStops) {
      if (!allStops.has(stop.crs)) {
        allStops.set(stop.crs, stop);
      }
    }

    const lineSegments = [];
    for (let i = 0; i < projectedStops.length - 1; i++) {
      lineSegments.push({
        line: line.id,
        from_crs: projectedStops[i].crs,
        to_crs: projectedStops[i + 1].crs,
        stations: [projectedStops[i].crs, projectedStops[i + 1].crs],
      });
      allSegments.push(lineSegments[lineSegments.length - 1]);
    }

    lines.push({
      id: line.id,
      name: line.name,
      color: line.color,
      stops: projectedStops,
      segments: lineSegments,
    });
  }

  const network = { lines, stops: [...allStops.values()], segments: allSegments };
  network.lines.sort((a, b) => a.id.localeCompare(b.id));
  network.stops.sort((a, b) => a.crs.localeCompare(b.crs));
  network.segments.sort((a, b) => {
    const lineCmp = a.line.localeCompare(b.line);
    if (lineCmp !== 0) return lineCmp;
    return a.from_crs.localeCompare(b.from_crs);
  });

  const networkRaw = JSON.stringify(network);
  assertBudget('data/network.json', networkRaw.length);
  write('data/network.json', network);

  for (const line of cfg.lines) {
    const lineSchedules = allSchedulesByLine[line.id] || [];
    const trimmed = lineSchedules.slice(0, 50);
    const scheduleData = trimmed.map((s) => ({
      uid: s.uid,
      headcode: s.headcode,
      toc: s.toc,
      stp: s.stp,
      origin: s.origin,
      destination: s.destination,
      departures: s.calling.map((c) => ({ crs: c.crs, time: timeToMin(c.ptd) })).filter((d) => d.time != null),
      stops: s.calling.map((c) => ({ crs: c.crs, planned_time: timeToMin(c.pta || c.ptd) })).filter((st) => st.planned_time != null),
    }));
    scheduleData.sort((a, b) => a.uid.localeCompare(b.uid));
    const relPath = `data/schedule-${line.id}.json`;
    const raw = JSON.stringify(scheduleData);
    assertBudget(relPath, raw.length);
    write(relPath, scheduleData);
  }

  const frequency = computeFrequency(schedules, cfg);
  const freqRaw = JSON.stringify(frequency);
  assertBudget('data/station-frequency.json', freqRaw.length);
  write('data/station-frequency.json', frequency);

  const usage = computeStationUsage(stationCoords);
  const usageRaw = JSON.stringify(usage);
  assertBudget('data/station-usage.json', usageRaw.length);
  write('data/station-usage.json', usage);

  const toc = computeToc(ref.toc, cfg);
  const tocRaw = JSON.stringify(toc);
  assertBudget('data/toc.json', tocRaw.length);
  write('data/toc.json', toc);

  return network;
}

// --- Public: build 7×96 delay buckets from trips ---

export function buildDelayBuckets(trips, { days, windowDays }) {
  const bucketCount = days * 96;
  const buckets = [];
  for (let day = 0; day < days; day++) {
    for (let i = 0; i < 96; i++) {
      buckets.push({
        day,
        secOfDay: i * 900,
        time: 0,
        ins: {},
        outs: {},
        ins_total: 0,
        lines: [],
      });
    }
  }

  let avgDelays = {};
  try {
    const raw = readFileSync(join(ROOT, 'data', 'average-actual-delays.json'), 'utf8');
    avgDelays = JSON.parse(raw);
  } catch (_) {
    // no baseline file — delay_actual will be omitted
  }

  for (const trip of trips) {
    for (let i = 0; i < trip.stops.length; i++) {
      const stop = trip.stops[i];
      const secOfDay = Math.floor(stop.time % 86400);
      if (secOfDay < 0) continue;
      const bucketIdx = Math.min(Math.floor(secOfDay / 900), 95);
      const dayIdx = Math.floor(stop.time / 86400) % days;
      const idx = dayIdx * 96 + bucketIdx;
      if (idx < 0 || idx >= bucketCount) continue;

      const bucket = buckets[idx];
      bucket.ins[stop.stop] = (bucket.ins[stop.stop] || 0) + 1;
      bucket.ins_total++;

      if (i < trip.stops.length - 1) {
        bucket.outs[stop.stop] = (bucket.outs[stop.stop] || 0) + 1;
      }

      if (i < trip.stops.length - 1) {
        const nextStop = trip.stops[i + 1];
        const actualSeg = nextStop.time - stop.time;
        const key = `${stop.stop}|${nextStop.stop}`;
        const avgSeg = avgDelays[key];
        if (avgSeg && avgSeg > 0) {
          const delayActual = (actualSeg - avgSeg) / avgSeg;
          let lineEntry = bucket.lines.find((l) => l.line === trip.line);
          if (!lineEntry) {
            lineEntry = { line: trip.line, delay_actual: {}, ins_total: 0 };
            bucket.lines.push(lineEntry);
          }
          lineEntry.delay_actual[key] = Math.round(delayActual * 100) / 100;
          lineEntry.ins_total++;
        }
      }
    }
  }

  return buckets;
}

// --- Public: derive actuals from HSP data ---

export async function deriveActuals(trips, hspClient, options = {}) {
  const {
    origins = [],
    destinations = [],
    date = new Date().toISOString().slice(0, 10),
    windowDays = 7,
    outDir = join(ROOT, 'data'),
  } = options;
  const write = outWriter(outDir);

  const commute = [];

  for (const origin of origins) {
    const originCommute = { origin, destinations: {} };

    for (const dest of destinations) {
      const rids = [];
      for (let hh = 5; hh <= 23; hh++) {
        const hhmm = String(hh).padStart(2, '0') + '00';
        try {
          const metrics = await hspClient.metrics(origin, dest, date, hhmm);
          if (metrics && metrics.rid) rids.push(metrics.rid);
          if (Array.isArray(metrics?.rids)) {
            for (const rid of metrics.rids) {
              if (!rids.includes(rid)) rids.push(rid);
            }
          }
        } catch (_) {
          // HSP unreachable or no data for this OD/hour — skip
        }
      }

      const serviceTrips = [];
      for (const rid of rids) {
        try {
          const details = await hspClient.details(rid);
          if (!details?.locations) continue;
          const corrected = details.locations.map((loc) => {
            let time = loc.actual_ta || loc.actual_td || loc.gbtt_pta || loc.gbtt_ptd;
            if (time) {
              const [h, m] = time.split(':').map(Number);
              const epochSec = h * 3600 + m * 60;
              const correctedSec = epochSec + bstCorrectionMs(epochSec * 1000) / 1000;
              return { location: loc.location, time: correctedSec };
            }
            return { location: loc.location, time: null };
          });
          serviceTrips.push({ rid: details.rid, origin: details.origin, destination: details.destination, locations: corrected });
        } catch (_) {
          // skip failed detail lookups
        }
      }

      const hourly = {};
      for (let hh = 5; hh <= 23; hh++) {
        hourly[hh] = { transit: [], wait: [] };
      }

      for (const trip of serviceTrips) {
        const originLoc = trip.locations.find((l) => l.location === origin);
        const destLoc = trip.locations.find((l) => l.location === dest);
        if (!originLoc?.time || !destLoc?.time) continue;
        const hour = Math.floor(originLoc.time / 3600);
        if (hour < 5 || hour > 23) continue;
        const transitSec = destLoc.time - originLoc.time;
        const waitSec = 0; // placeholder — real computation needs planned vs actual dep
        hourly[hour].transit.push(transitSec);
        hourly[hour].wait.push(waitSec);
      }

      const result = [];
      const actuals = [];
      for (let hh = 5; hh <= 23; hh++) {
        const t = hourly[hh].transit.sort((a, b) => a - b);
        const w = hourly[hh].wait.sort((a, b) => a - b);
        if (t.length === 0) continue;
        result.push([
          hh,
          [percentile(t, 0.1), percentile(t, 0.5), percentile(t, 0.9)],
          [percentile(w, 0.1), percentile(w, 0.5), percentile(w, 0.9)],
        ]);
        actuals.push([hh, t[t.length - 1], w[w.length - 1]]);
      }

      originCommute.destinations[dest] = { result, actuals };
    }

    if (Object.keys(originCommute.destinations).length > 0) {
      commute.push(originCommute);
    }
  }

  write(`data/marey-index.json`, {
    days: [{ date, lines: [...new Set(trips.map((t) => t.line))].map((line) => ({ line, count: trips.filter((t) => t.line === line).length })) }],
    lines: (options.cfg || { lines: [] }).lines.map((l) => ({ id: l.id, name: l.name, color: l.color })),
  });

  for (const trip of trips) {
    const key = `data/marey-trips-${date}-${trip.line}.json`;
    write(key, [trip]);
  }

  write('data/delay.json', buildDelayBuckets(trips, { days: 7, windowDays }));

  for (const c of commute) {
    write(`data/commute-${c.origin}.json`, c.destinations);
  }

  return { commute, delay: buildDelayBuckets(trips, { days: 7, windowDays }) };
}

function timeToMin(timeStr) {
  if (timeStr == null) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(p * (sorted.length - 1)), sorted.length - 1);
  return Math.round(sorted[idx]);
}

// --- main guard ---

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1]?.endsWith('derive.js')) {
  if (hasRawTimetable) {
    const poc = JSON.parse(readFileSync(join(ROOT, 'config', 'poc.json'), 'utf8'));
    const stations = readStationsJson();
    console.log('derive: raw timetable present — running planned derivation (M1)');
    await derivePlanned({ cfg: poc, stations, rawDir: 'raw' });
    console.log('derive: planned artifacts written to data/');
    process.exit(0);
  }
  console.log('derive: no raw Darwin input — keeping data/ fixtures (site remains deployable)');
  process.exit(0);
}
