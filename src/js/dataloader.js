// Minimal, dependency-free loader for UK Rail Viz.
// Fetches the precomputed JSON payloads from /data in parallel,
// reports status in the header, and exposes the payloads to renderers
// via the `ready` promise. Section visualisations import this module
// and await `ready`.

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
  if (typeof document !== 'undefined') {
    const el = document.getElementById('data-status');
    if (el) { el.textContent = `✓ ${ok}/${all.length} payloads loaded`; el.setAttribute('aria-live', 'polite'); }
  }
  if (typeof window !== 'undefined') {
    window.UKRailViz = { data: out, loadedAt: Date.now() };
  }
  return out;
})();
