// tools/etl/xml.js — Streaming XML parser for Darwin timetable and ref files.
// Uses saxes (event-driven push parser) + gunzip — never materialises the DOM.
// Emits plain objects; the caller filters. Peak RSS well under 500 MB (§6.7).
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { SaxesParser } from 'saxes';

const NS = 'http://www.thalesgroup.com/rtti/XmlTimetable/';

// Location element tags in the timetable XML (v8).
const LOCATION_TAGS = new Set([
  'OPOR', 'OPIP', 'OPDT', 'OR', 'DT', 'IP', 'PP',
]);

function stripNS(name) {
  return name.replace(/^.*:/, '');
}

// Resolve CRS for a TIPLOC from the ref map.
function resolveCrs(tiploc, byTiploc) {
  if (!tiploc || !byTiploc) return null;
  const entry = byTiploc.get(tiploc);
  return entry ? entry.crs : null;
}

/**
 * Streams a gunzipped timetable XML file through saxes, yielding schedule
 * objects whose calling pattern touches the PoC station set.
 * filter must include stationSet.crs and byTiploc (from parseRef).
 */
export async function* parseTimetable(gzPath, filter) {
  const out = [];
  const parser = new SaxesParser();
  let cur = null;
  let error = null;
  const byTiploc = filter?.byTiploc;
  const crsSet = filter?.stationSet?.crs;

  parser.on('opentag', (node) => {
    const t = stripNS(node.name);
    if (t === 'Journey') {
      const a = node.attributes;
      cur = {
        uid: a.uid ?? null,
        headcode: a.trainId ?? null,
        toc: a.toc ?? null,
        stp: a.stp ?? null,
        days_runs: a.days ?? null,
        start_date: a.ssd ?? null,
        end_date: a.ned ?? null,
        origin: null,
        destination: null,
        calling: [],
      };
    } else if (LOCATION_TAGS.has(t) && cur) {
      const a = node.attributes;
      const tiploc = a.tpl ?? null;
      const crs = resolveCrs(tiploc, byTiploc);
      cur.calling.push({
        tiploc,
        crs,
        pta: a.pta ?? null,
        ptd: a.ptd ?? null,
        platform: a.plat ?? null,
        activity: a.act ?? null,
      });
    }
  });

  parser.on('closetag', (tag) => {
    const t = stripNS(tag.name);
    if (t !== 'Journey' || !cur) return;

    // origin/destination: first/last stop with T / TB / TF activity.
    const isStop = (s) =>
      (s.activity || '').split(/\s+/).some((c) => c === 'T' || c === 'TB' || c === 'TF');
    const first = cur.calling.find(isStop);
    const last = [...cur.calling].reverse().find(isStop);

    // PoC corridor filter: keep only calling stops whose CRS is in the station set.
    const calling = (crsSet && crsSet.length > 0)
      ? cur.calling.filter((s) => s.crs && crsSet.includes(s.crs))
      : cur.calling;

    out.push({
      uid: cur.uid,
      headcode: cur.headcode,
      toc: cur.toc,
      stp: cur.stp,
      days_runs: cur.days_runs,
      start_date: cur.start_date,
      end_date: cur.end_date,
      origin: first
        ? { crs: first.crs, tiploc: first.tiploc, time: first.ptd ?? first.pta }
        : null,
      destination: last
        ? { crs: last.crs, tiploc: last.tiploc, time: last.pta ?? last.ptd }
        : null,
      calling,
    });
    cur = null;
  });

  parser.on('error', (err) => {
    error = err;
  });

  // Feed gunzipped chunks straight into saxes — no DOM, no intermediate string array.
  for await (const chunk of createReadStream(gzPath).pipe(createGunzip())) {
    await parser.write(chunk);
  }
  parser.close();

  if (error) throw error;

  for (const journey of out) {
    yield journey;
  }
}

/**
 * Parses a gunzipped ref XML file, returning { byTiploc, toc }.
 * byTiploc: Map<TIPLOC, { crs, name, stanox, toc }>
 * toc: Map<TOC_CODE, TOC_NAME>
 */
export async function parseRef(gzPath) {
  const byTiploc = new Map();
  const toc = new Map();
  const parser = new SaxesParser();
  let error = null;

  parser.on('opentag', (node) => {
    const t = stripNS(node.name);
    if (t === 'LocationRef') {
      const a = node.attributes;
      byTiploc.set(a.tpl, {
        crs: a.crs ?? null,
        name: a.locname ?? null,
        stanox: null,
        toc: a.toc ?? null,
      });
    } else if (t === 'TocRef') {
      const a = node.attributes;
      toc.set(a.toc, a.tocname);
    }
  });

  parser.on('error', (err) => {
    error = err;
  });

  for await (const chunk of createReadStream(gzPath).pipe(createGunzip())) {
    await parser.write(chunk);
  }
  parser.close();

  if (error) throw error;

  return { byTiploc, toc };
}

/**
 * Joins byTiploc → CRS with NaPTAN CSV rows and ORR rows to produce
 * the stations.json array (§6.4). Stub for M1 — returns empty array
 * until NaPTAN/ORR data is available.
 */
export function stationsFrom(refMap, naptanRows, usageRows) {
  // M1: implement full NaPTAN + ORR join
  return [];
}
