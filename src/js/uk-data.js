/**
 * uk-data.js
 *
 * Data adapter for UK Rail Viz.  Converts this project's data/ artifacts
 * (network.json, marey-trips-<date>-<line>.json, station-frequency.json,
 * station-usage.json, delay.json, average-actual-delays.json, commute-*.json)
 * into the in-memory shapes consumed by the MBTA Viz exemplar rendering code
 * (station-network, spider, marey-header, turnstile-heatmap, delay, paths,
 * weekday rollups), so the ported rendering code stays verbatim.
 *
 * Rendering code is (c) 2014 Michael Barry & Brian Card, MIT license.
 * This adapter: Copyright 2026, MIT license.
 */

(function () {
  "use strict";

  // UK local time during the period covered by the data is UTC+1 (BST).
  // moment().zone() is positive west of UTC, so UTC+1 is -1.
  var ZONE_OFFSET = -1;

  // Turnstile heatmap layout, mirroring the exemplar's turnstile-heatmap.json:
  // 4 weeks x 7 days x 24 hours, week 1 starting on a Sunday.  Cell times are
  // anchored so hour 0 is 00:00 BST (i.e. 23:00 UTC the day before).
  var WEEKS = 4;
  var DAYS = 7;
  var HOURS = 24;
  var TURNSTILE_ANCHOR = Date.UTC(2025, 2, 30) - 3600 * 1000; // Sunday 2025-03-30, 00:00 BST

  // Convert data/network.json into { network, spider, header, paths, lines }.
  // - network: { nodes: [{id, name}], links: [{source, target, line}] }
  //   where links reference node INDICES (the exemplar code resolves them
  //   with `link.source = network.nodes[link.source]`).
  // - spider: station id -> [x, y] schematic map position.
  // - header: 'station|line' -> [x, y]; x is the stop's order along the line
  //   (the Marey chart spaces stations evenly by order, exactly like the
  //   exemplar's marey-header.json), y is the line index (unused by the chart).
  // - paths: one station id list per line (commute pick-two section).
  function convertNetwork(rawNetwork) {
    var nodes = [];
    var nodeIndex = {};
    rawNetwork.stops.forEach(function (stop, i) {
      nodeIndex[stop.crs] = i;
      nodes.push({ id: stop.crs, name: stop.name || stop.crs });
    });

    var links = rawNetwork.segments.map(function (segment) {
      return {
        source: nodeIndex[segment.from_crs],
        target: nodeIndex[segment.to_crs],
        line: segment.line
      };
    });

    var spider = {};
    rawNetwork.stops.forEach(function (stop) {
      spider[stop.crs] = [stop.x, stop.y];
    });

    var header = {};
    rawNetwork.lines.forEach(function (line, lineIndex) {
      line.stops.forEach(function (stop, i) {
        header[stop.crs + '|' + line.id] = [i, lineIndex];
      });
    });

    var paths = rawNetwork.lines.map(function (line) {
      return line.stops.map(function (stop) { return stop.crs; });
    });

    var lines = rawNetwork.lines.map(function (line) {
      return { id: line.id, name: line.name, color: line.color };
    });

    return {
      network: { nodes: nodes, links: links },
      spider: spider,
      header: header,
      paths: paths,
      lines: lines
    };
  }

  // Convert a raw marey-trips file (array of { service, line, begin, end,
  // stops: [{stop, time}] }) into exemplar trips ({ trip, line, begin, end,
  // stops: [{stop, time}] }).
  function convertTrips(rawTrips) {
    return rawTrips.map(function (trip) {
      return {
        trip: trip.service,
        line: trip.line,
        begin: trip.begin,
        end: trip.end,
        stops: (trip.stops || []).map(function (stop) {
          return { stop: stop.stop, time: stop.time };
        })
      };
    });
  }

  // The data loader requires exact file paths; build the per-date trip file
  // list for VIZ.requiresData from the marey index's day + line ids.
  function tripFilesForDate(date, lineIds) {
    return lineIds.map(function (line) {
      return 'json!data/marey-trips-' + date + '-' + line + '.json';
    });
  }

  // Convert station-frequency.json + station-usage.json into the exemplar's
  // turnstile-heatmap shape:
  //   { max, min, mean, numberOfEntries, all, stops, totalEntrances, totalExits }
  //   stop = { name, entrancesByType: {all, weekday, offpeak}, times: [...] }
  //   times entry = { time (ms), hour, day (0-6, Sun first), week (1-4),
  //                   entrances, exits, i }
  // The raw frequency data is a single 24h pattern per stop (per-hour
  // arrivals/departures); it is expanded across 4 weeks, using the
  // weekday/offpeak averages for the days without explicit data.
  function convertTurnstile(frequency, usage) {
    var usageByCrs = {};
    (usage && usage.stations || []).forEach(function (s) { usageByCrs[s.crs] = s; });

    function cellTime(week, day, hour) {
      return TURNSTILE_ANCHOR + ((week - 1) * DAYS + day) * 24 * 3600 * 1000 + hour * 3600 * 1000;
    }

    function hourOf(t) {
      return Math.floor(t.time / 3600) % 24;
    }

    var stops = frequency.stops.map(function (stop) {
      var hourData = {};
      (stop.times || []).forEach(function (t) { hourData[hourOf(t)] = t; });
      var avg = {
        weekday: (stop.averagesByType && stop.averagesByType.weekday) || { arrivals: 1, departures: 1 },
        offpeak: (stop.averagesByType && stop.averagesByType.offpeak) || { arrivals: 1, departures: 1 }
      };
      // Mirror the exemplar: week 2 Monday is a holiday, weekends are offpeak.
      // The same classification drives the per-type average cells below.
      function isOffpeak(week, day) {
        return (week === 2 && day === 1) || day === 0 || day === 6;
      }

      // Average of the 4 weeks' cells for a given day type ('weekday'/'offpeak'),
      // one {hour, entrances, exits} cell per hour, indexed by hour.
      function averageCells(type) {
        var cells = [];
        for (var hour = 0; hour < HOURS; hour++) {
          var cell = { hour: hour, entrances: 0, exits: 0 };
          var count = 0;
          times.forEach(function (t) {
            var matches = type === 'offpeak' ? isOffpeak(t.week, t.day) : !isOffpeak(t.week, t.day);
            if (matches && t.hour === hour) {
              cell.entrances += t.entrances;
              cell.exits += t.exits;
              count++;
            }
          });
          cell.entrances /= count;
          cell.exits /= count;
          cells.push(cell);
        }
        return cells;
      }

      var times = [];
      var patternTotal = 0;
      for (var week = 1; week <= WEEKS; week++) {
        for (var day = 0; day < DAYS; day++) {
          // mirror the exemplar: week 2 Monday is a holiday, weekends are offpeak
          var type = isOffpeak(week, day) ? 'offpeak' : 'weekday';
          var pattern = avg[type];
          for (var hour = 0; hour < HOURS; hour++) {
            var datum = hourData[hour];
            var entrances = datum ? datum.arrivals : pattern.arrivals;
            var exits = datum ? datum.departures : pattern.departures;
            times.push({
              time: cellTime(week, day, hour),
              hour: hour,
              day: day,
              week: week,
              entrances: entrances,
              exits: exits,
              i: times.length
            });
            patternTotal += entrances;
          }
        }
      }
      var stationUsage = usageByCrs[stop.crs];
      var entries = stationUsage ? stationUsage.entries : patternTotal;
      return {
        name: stop.name || stop.crs,
        entrancesByType: {
          all: entries,
          weekday: Math.round(entries * 0.8),
          offpeak: Math.round(entries * 0.2)
        },
        averagesByType: {
          weekday: averageCells('weekday'),
          offpeak: averageCells('offpeak')
        },
        times: times
      };
    });

    // Aggregate across all stations, cell by cell (same order for every stop).
    var cellCount = WEEKS * DAYS * HOURS;
    var allTimes = [];
    for (var i = 0; i < cellCount; i++) {
      var first = stops[0].times[i];
      allTimes.push({
        time: first.time,
        hour: first.hour,
        day: first.day,
        week: first.week,
        entrances: d3.sum(stops, function (s) { return s.times[i].entrances; }),
        exits: d3.sum(stops, function (s) { return s.times[i].exits; }),
        i: i
      });
    }

    var stopMax = d3.max(stops, function (s) { return d3.max(s.times, function (t) { return t.entrances; }); });
    var stopMean = d3.mean(stops, function (s) {
      return d3.mean(s.times, function (t) { return t.entrances; });
    });
    var totalEntrances = d3.sum(stops, function (s) { return s.entrancesByType.all; });

    return {
      max: stopMax,
      min: 0,
      mean: stopMean,
      numberOfEntries: totalEntrances,
      all: {
        max: d3.max(allTimes, function (t) { return t.entrances; }),
        min: 0,
        entrancesByType: {
          all: totalEntrances,
          weekday: totalEntrances,
          offpeak: totalEntrances
        },
        times: allTimes
      },
      stops: stops,
      totalEntrances: totalEntrances,
      totalExits: d3.sum(stops, function (s) {
        return d3.sum(s.times, function (t) { return t.exits; });
      })
    };
  }

  // turnstile stop name -> network station id (crs) map, the analog of the
  // exemplar's turnstile-gtfs-mapping.json.
  function turnstileToStationIds(frequency) {
    var mapping = {};
    (frequency.stops || []).forEach(function (stop) {
      mapping[stop.name || stop.crs] = stop.crs;
    });
    return mapping;
  }

  // Convert raw delay.json buckets into the exemplar's delay shape.  The raw
  // buckets already carry { day, secOfDay, time (ms), ins, outs, ins_total,
  // lines: [{line, delay_actual: {'A|B': secs}, ins_total}] }; the exemplar
  // additionally reads a top-level numeric delay_actual, so take the max
  // delay across all lines for the bucket.
  function convertDelay(rawDelay) {
    return rawDelay.map(function (item) {
      var maxLineDelay = 0;
      (item.lines || []).forEach(function (line) {
        var delays = line.delay_actual || {};
        for (var key in delays) {
          if (delays[key] > maxLineDelay) { maxLineDelay = delays[key]; }
        }
      });
      return {
        time: item.time,
        delay_actual: maxLineDelay,
        ins_total: item.ins_total,
        lines: item.lines,
        day: item.day,
        secOfDay: item.secOfDay,
        ins: item.ins || {},
        outs: item.outs || {}
      };
    });
  }

  window.VIZ.ukData = {
    ZONE_OFFSET: ZONE_OFFSET,
    convertNetwork: convertNetwork,
    convertTrips: convertTrips,
    tripFilesForDate: tripFilesForDate,
    convertTurnstile: convertTurnstile,
    turnstileToStationIds: turnstileToStationIds,
    convertDelay: convertDelay
  };
}());
