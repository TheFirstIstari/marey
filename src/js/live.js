// T6.1 — Live overlay: snapshot table + map overlay with session delta merge.
// Polls data/live.json + data/live-delta.json every 900 s, pausing when the
// tab is hidden (document.visibilitychange). Platform numbers are suppressed
// per §9 feed direction — shown as "—" always.
'use strict';

import { applyDelta } from './live-math.js';
import { svgEl } from './svg.js';
import { ready } from './dataloader.js';

const POLL_MS = 900 * 1000; // D2*60 s

function project(lat, lon, stations) {
  let lonMin = Infinity, lonMax = -Infinity;
  let latMin = Infinity, latMax = -Infinity;
  for (const s of stations) {
    if (s.lon != null) { lonMin = Math.min(lonMin, s.lon); lonMax = Math.max(lonMax, s.lon); }
    if (s.lat != null) { latMin = Math.min(latMin, s.lat); latMax = Math.max(latMax, s.lat); }
  }
  const kx = lonMax !== lonMin ? 100 / (lonMax - lonMin) : 1;
  const ky = latMax !== latMin ? 100 / (latMax - latMin) : 1;
  return {
    x: Math.round((lon - lonMin) * kx * 100) / 100,
    y: Math.round((latMax - lat) * ky * 100) / 100,
  };
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function renderTable(slot, trains) {
  slot.replaceChildren();
  const table = document.createElement('table');
  table.className = 'live-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Headcode</th><th>Operator</th><th>Route</th><th>Lateness</th><th>Status</th><th>Platform</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const t of trains) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.headcode || '—'}</td><td>${t.toc || '—'}</td><td>${t.origin || '—'} → ${t.destination || '—'}</td><td>${t.lateness_min != null ? t.lateness_min + ' min' : '—'}</td><td>${t.status || '—'}</td><td>—</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  slot.appendChild(table);
}

function renderMap(slot, trains, stations) {
  slot.replaceChildren();
  if (!trains.length || !stations.length) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of trains) {
    const p = project(t.lat, t.lon, stations);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const pad = 5;
  const W = Math.max(maxX - minX + pad * 2, 10);
  const H = Math.max(maxY - minY + pad * 2, 10);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'live-map',
    role: 'img',
    'aria-label': 'Live train positions map',
  });

  for (const t of trains) {
    const p = project(t.lat, t.lon, stations);
    const cx = p.x - minX + pad;
    const cy = p.y - minY + pad;
    const colour = t.status === 'LATE' ? '#ef4444' : '#22c55e';
    svg.appendChild(svgEl('circle', {
      cx: cx.toFixed(1), cy: cy.toFixed(1), r: 4,
      fill: colour, class: 'live-dot',
    }));
    const label = svgEl('text', {
      x: cx.toFixed(1), y: (cy - 6).toFixed(1),
      class: 'live-label', 'text-anchor': 'middle', 'font-size': '9',
    });
    label.textContent = t.headcode || t.train_id;
    svg.appendChild(label);
  }

  slot.appendChild(svg);
}

function mount(el, data) {
  const stations = (data.stations || []).filter((s) => s.lat != null && s.lon != null);
  let baseline = [];
  let refreshedAt = '';
  let timer = null;
  let visible = true;

  function refresh() {
    if (!visible) return;
    el.innerHTML = '<p class="live-status">Loading…</p>';

    Promise.all([
      fetch('data/live.json').then((r) => r.json()),
      fetch('data/live-delta.json').then((r) => r.json()),
    ]).then(([live, delta]) => {
      refreshedAt = live.refreshed_at || '';
      if (!baseline.length) {
        baseline = live.trains || [];
      } else {
        baseline = applyDelta(baseline, delta);
      }

      el.innerHTML = '';
      const status = document.createElement('p');
      status.className = 'live-status';
      status.textContent = `As of ${fmtTime(refreshedAt)}`;
      el.appendChild(status);

      const tableSlot = document.createElement('div');
      tableSlot.className = 'live-table-slot';
      renderTable(tableSlot, baseline);
      el.appendChild(tableSlot);

      const mapSlot = document.createElement('div');
      mapSlot.className = 'live-map-slot';
      renderMap(mapSlot, baseline, stations);
      el.appendChild(mapSlot);
    }).catch((err) => {
      el.innerHTML = `<p class="live-status live-error">Live data unavailable: ${err.message}</p>`;
    });
  }

  function startPolling() {
    stopPolling();
    refresh();
    timer = setInterval(refresh, POLL_MS);
  }

  function stopPolling() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) startPolling();
    else stopPolling();
  });

  startPolling();
}

export { mount };
