// tools/etl/derive.js — Stage 3 of the §6 pipeline: emit the MBTA-style artifacts
// into data/ (schemas in SPEC.md §6.4). Currently passes through fixtures so the
// site stays deployable; the real derivation (marey trips from HSP, delay buckets
// 7×96, commute percentiles) is implemented here.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from './serialize.js';
import { bstCorrectionMs } from './normalize.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const hasRawTimetable = existsSync(join(ROOT, 'raw', 'timetable'));
const hasRawMovements = existsSync(join(ROOT, 'raw', 'movements'));

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

  // Load average-actual-delays baseline if available.
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

      // Arrival at this stop
      bucket.ins[stop.stop] = (bucket.ins[stop.stop] || 0) + 1;
      bucket.ins_total++;

      // Departure from this stop (all stops except the last)
      if (i < trip.stops.length - 1) {
        bucket.outs[stop.stop] = (bucket.outs[stop.stop] || 0) + 1;
      }

      // Segment delay for this stop → next stop
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
  } = options;

  const commute = [];

  for (const origin of origins) {
    const originCommute = { origin, destinations: {} };

    for (const dest of destinations) {
      // Collect RIDs from HSP metrics queries (one per hour 05–23)
      const rids = [];
      for (let hh = 5; hh <= 23; hh++) {
        const hhmm = String(hh).padStart(2, '0') + '00';
        try {
          const metrics = await hspClient.metrics(origin, dest, date, hhmm);
          if (metrics && metrics.rid) {
            rids.push(metrics.rid);
          }
          // Also handle array of RIDs from serviceMetrics response
          if (Array.isArray(metrics?.rids)) {
            for (const rid of metrics.rids) {
              if (!rids.includes(rid)) rids.push(rid);
            }
          }
        } catch (_) {
          // HSP unreachable or no data for this OD/hour — skip
        }
      }

      // Fetch details for each RID
      const serviceTrips = [];
      for (const rid of rids) {
        try {
          const details = await hspClient.details(rid);
          if (!details?.locations) continue;

          // Apply BST correction to every timestamp
          const corrected = details.locations.map((loc) => {
            let time = loc.actual_ta || loc.actual_td || loc.gbtt_pta || loc.gbtt_ptd;
            if (time) {
              // Parse HH:MM into seconds since midnight
              const [h, m] = time.split(':').map(Number);
              const epochSec = h * 3600 + m * 60;
              const correctedSec = epochSec + bstCorrectionMs(epochSec * 1000) / 1000;
              return { location: loc.location, time: correctedSec };
            }
            return { location: loc.location, time: null };
          });

          serviceTrips.push({
            rid: details.rid,
            origin: details.origin,
            destination: details.destination,
            locations: corrected,
          });
        } catch (_) {
          // skip failed detail lookups
        }
      }

      // Compute per-hour p10/p50/p90 transit and wait times
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
        // Wait = actual departure - planned departure (simplified: use origin time as proxy)
        const waitSec = 0; // placeholder — real computation needs planned vs actual dep

        hourly[hour].transit.push(transitSec);
        hourly[hour].wait.push(waitSec);
      }

      // Build result arrays
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

  // Write outputs
  writeJson(`data/marey-index.json`, { date, lines: [...new Set(trips.map((t) => t.line))] });

  for (const trip of trips) {
    const key = `data/marey-trips-${date}-${trip.line}.json`;
    writeJson(key, [trip]);
  }

  writeJson('data/delay.json', buildDelayBuckets(trips, { days: 7, windowDays }));

  for (const c of commute) {
    writeJson(`data/commute-${c.origin}.json`, c.destinations);
  }

  return { commute, delay: buildDelayBuckets(trips, { days: 7, windowDays }) };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(p * (sorted.length - 1)), sorted.length - 1);
  return Math.round(sorted[idx]);
}

// --- main guard: preserve existing direct-execution behaviour ---

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1]?.endsWith('derive.js')) {
  if (hasRawTimetable && hasRawMovements) {
    console.log('derive: raw timetable + movements present — running real derivation (M1+, TODO)');
    process.exit(1);
  }
  console.log('derive: no raw Darwin input — keeping data/ fixtures (site remains deployable)');
  process.exit(0);
}
