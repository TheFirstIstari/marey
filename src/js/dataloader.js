// Minimal, dependency-free loader for UK Rail Viz.
// Fetches the precomputed JSON payloads from /data, reports status in the
// header, and exposes the payloads to renderers via the `ready` promise.
// Section visualisations import this module and await `ready`.
const DATA = [
  ['marey',  'data/marey-trips.json'],
  ['network','data/network.json'],
  ['usage',  'data/station-usage.json'],
  ['freq',   'data/station-frequency.json'],
  ['delay',  'data/delay.json'],
  ['delays', 'data/average-actual-delays.json'],
  ['live',   'data/live.json'],
  ['toc',    'data/toc.json'],
];

const statusEl = document.getElementById('data-status');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

export const ready = (async () => {
  const payloads = {};
  const lines = [];
  for (const [key, url] of DATA) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payloads[key] = await res.json();
      lines.push(`${key}: ${kb(JSON.stringify(payloads[key]).length)}`);
    } catch (err) {
      lines.push(`${key}: failed (${err.message})`);
    }
  }
  const failed = lines.filter((l) => l.includes('failed'));
  if (statusEl) {
    statusEl.textContent = failed.length
      ? `⚠ ${failed.length} payload(s) failed to load — ${lines.join(', ')}`
      : `✓ ${DATA.length} payloads loaded — ${lines.join(', ')}`;
  }
  window.UKRailViz = { data: payloads, loadedAt: Date.now() };
  return payloads;
})();
