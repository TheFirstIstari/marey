// tools/etl/normalize.js — Stage 2 of the §6 pipeline: code joins and schedule parsing.
// Shared helpers for the derive stage. Real implementations (XML/CIF parsers, CORPUS and
// NaPTAN joins, BST correction) land at the M1 milestone; this module defines the contract.
export const KNOWN_BUGS = {
  // SPEC.md §6.5.1 — TRUST emits these epoch timestamps 1h early during UK BST.
  bstTimestampFields: ['gbtt_timestamp', 'planned_timestamp', 'actual_timestamp', 'canx_timestamp', 'dep_timestamp', 'orig_dep_timestamp', 'original_loc_timestamp'],
  bstFixMs: 3600_000,
  sundayOutage: 'TRUST has a ~5-min gap Sun 02:00–02:15; tolerate gaps, never alert',
};

// Return +1h correction (ms) if the given epoch falls inside UK BST (last Sun Mar → last Sun Oct).
export function bstCorrectionMs(epochSecOrMs) {
  const ms = epochSecOrMs < 1e12 ? epochSecOrMs * 1000 : epochSecOrMs;
  const d = new Date(ms);
  const mar = lastSunday(d.getUTCFullYear(), 2, d);   // last Sunday in March, 01:00 UTC
  const oct = lastSunday(d.getUTCFullYear(), 9, d);   // last Sunday in October, 01:00 UTC
  return ms >= mar && ms < oct ? KNOWN_BUGS.bstFixMs : 0;
}
function lastSunday(year, month, ref) {
  // month is 0-based; find last Sunday at/before month end, 01:00 UTC
  const end = new Date(Date.UTC(year, month + 1, 1));
  const dow = end.getUTCDay();
  const lastSun = new Date(Date.UTC(year, month, 1 - ((dow + 1) % 7))); // walk back to last Sunday
  lastSun.setUTCHours(1, 0, 0, 0);
  return lastSun.getTime();
}

// Schedule identity per wiki: UID + start date + STP indicator (SPEC.md §3.2).
export function scheduleKey(uid, startDate, stp) { return `${uid}|${startDate}|${stp}`; }

/**
 * Build a station index from the ref map and optional NaPTAN/ORR rows.
 * Returns { corpus, naptan, byStanox: Map, byCrs: Map }.
 * byCrs is populated from the ref map; byStanox is empty until CORPUS lands (M1.5).
 */
export function buildStationIndex(refMap, naptanRows, usageRows) {
  const corpus = [];
  const naptan = [];
  const byStanox = new Map();
  const byCrs = new Map();

  // Populate byCrs from the ref map (TIPLOC → CRS mapping).
  if (refMap && refMap.byTiploc) {
    for (const [tiploc, entry] of refMap.byTiploc) {
      if (entry.crs) {
        byCrs.set(entry.crs, {
          tiploc,
          crs: entry.crs,
          name: entry.name,
          stanox: entry.stanox ?? null,
          toc: entry.toc ?? null,
        });
      }
    }
  }

  return { corpus, naptan, byStanox, byCrs };
}
