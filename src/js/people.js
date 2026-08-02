// M3 — "The People": station traffic heatmap (stations × 24 h), usage table,
// and schematic map, all cross-highlighted (hover/click any panel → all react).
import { ready } from './dataloader.js';
import { svgEl } from './svg.js';
import { heatColor, freqTotal, usageSorted, nodeExtents, linePath, stationDetail } from './people-math.js';

function hcell(cls, text, bg) {
  const el = document.createElement('div');
  el.className = cls;
  if (text) el.textContent = text;
  if (bg) el.style.background = bg;
  return el;
}

function render(slot, payloads) {
  const net = payloads.network || {};
  const usage = payloads.usage || {};
  const freq = payloads.freq || {};
  const stations = usageSorted(usage.stations || []);
  const stops = freq.stops || [];
  if (!stations.length || !stops.length) { slot.textContent = 'No station data yet.'; return; }

  const stopById = new Map((net.stops || []).map((s) => [s.crs, s]));
  const usageById = new Map(stations.map((s) => [s.crs, s]));
  const nameOf = (crs) => (usageById.get(crs) || {}).name || crs;
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-GB') : '—');

  // ---- shared tooltip + cross-highlight selection ----
  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.setAttribute('role', 'status');
  const showTipAt = (e) => {
    const r = slot.getBoundingClientRect();
    tip.style.left = `${e.clientX - r.left + 14}px`;
    tip.style.top = `${e.clientY - r.top - 10}px`;
    tip.style.display = 'block';
  };
  const hideTip = () => { tip.style.display = 'none'; };

  let rowEls = [], nodeEls = [], cellEls = [];
  const state = { crs: null, pinned: false };
  function select(crs) {
    state.crs = crs;
    for (const el of rowEls) el.classList.toggle('active', el.dataset.crs === crs);
    for (const el of nodeEls) el.classList.toggle('active', el.dataset.crs === crs);
    for (const el of cellEls) el.classList.toggle('active', el.dataset.crs === crs);
  }
  const hoverSelect = (crs) => { if (!state.pinned) select(crs); };
  const pinToggle = (crs) => { state.pinned = !(state.pinned && state.crs === crs); select(crs); };
  const unpin = () => { state.pinned = false; select(null); };

  // ---- 1. heatmap: stations × 24 hours (arrivals + departures) ----
  let cellMax = 0;
  for (const s of stops) for (const t of s.times || []) cellMax = Math.max(cellMax, (t.arrivals || 0) + (t.departures || 0));
  const heatmap = document.createElement('div');
  heatmap.className = 'heatmap';
  heatmap.appendChild(hcell('', ''));
  for (let h = 0; h < 24; h++) heatmap.appendChild(hcell('heat-h', h % 3 === 0 ? String(h) : ''));
  for (const s of stops) {
    heatmap.appendChild(hcell('heat-lbl', s.crs));
    for (const t of s.times || []) {
      const val = (t.arrivals || 0) + (t.departures || 0);
      const cell = hcell('heat-cell', '', heatColor(val, cellMax));
      cell.dataset.crs = s.crs;
      const hour = Math.round((t.time || 0) / 3600);
      cell.title = `${nameOf(s.crs)} ${String(hour).padStart(2, '0')}:00 — ${t.arrivals || 0} arr, ${t.departures || 0} dep`;
      cell.addEventListener('mouseenter', (e) => { hoverSelect(s.crs); tip.textContent = cell.title; showTipAt(e); });
      cell.addEventListener('mouseleave', hideTip);
      cellEls.push(cell);
      heatmap.appendChild(cell);
    }
  }
  const legend = document.createElement('div');
  legend.className = 'heat-legend';
  legend.innerHTML = '<span>low</span><i class="heat-ramp"></i><span>high</span>';

  // §10 caption
  const caption = document.createElement('p');
  caption.className = 'heat-caption';
  caption.textContent = 'Arrivals/departures per hour from the timetable — the UK has no public turnstile counts (SPEC §10).';

  // ---- detail panel (shown on click) ----
  const detail = document.createElement('div');
  detail.className = 'detail-panel';
  detail.setAttribute('role', 'dialog');
  detail.setAttribute('aria-label', 'Station detail');
  detail.hidden = true;
  const detailClose = () => { detail.hidden = true; unpin(); };
  detail.addEventListener('keydown', (e) => { if (e.key === 'Escape') detailClose(); });

  function showDetail(crs) {
    const d = stationDetail(crs, freq);
    const name = nameOf(crs);
    const u = usageById.get(crs);
    detail.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = name;
    detail.appendChild(heading);
    if (u) {
      const usageLine = document.createElement('p');
      usageLine.className = 'detail-usage';
      usageLine.textContent = `${fmt(u.entries)} entries · ${fmt(u.exits)} exits · total ${fmt(u.total)}`;
      detail.appendChild(usageLine);
    }
    const avgLine = document.createElement('p');
    avgLine.className = 'detail-avgs';
    avgLine.textContent = `Weekday avg: ${d.weekdayAvg} arr+dep/h · Offpeak avg: ${d.offpeakAvg} arr+dep/h`;
    detail.appendChild(avgLine);
    const barGrid = document.createElement('div');
    barGrid.className = 'detail-bars';
    for (const h of d.hours) {
      const bar = document.createElement('div');
      bar.className = 'detail-bar';
      bar.title = `H${String(h.hour).padStart(2, '0')}: ${h.arrivals} arr, ${h.departures} dep`;
      const total = h.arrivals + h.departures;
      bar.style.height = cellMax > 0 ? `${Math.max(2, (total / cellMax) * 100)}%` : '2px';
      bar.style.background = heatColor(total, cellMax);
      bar.setAttribute('aria-label', `Hour ${h.hour}: ${h.arrivals} arrivals, ${h.departures} departures`);
      barGrid.appendChild(bar);
    }
    detail.appendChild(barGrid);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'detail-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', detailClose);
    detail.appendChild(closeBtn);
    detail.hidden = false;
  }

  // ---- 2. usage table (sorted by total, with mini bars) ----
  const table = document.createElement('table');
  table.className = 'usage-table';
  table.innerHTML = '<thead><tr><th>Station</th><th>Entries</th><th>Exits</th><th>Total</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  const maxTotal = Math.max(1, ...stations.map((s) => s.total || 0));
  for (const s of stations) {
    const tr = document.createElement('tr');
    tr.dataset.crs = s.crs;
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', `${nameOf(s.crs)} arrivals and departures`);
    tr.innerHTML = `<td>${nameOf(s.crs)}</td><td>${fmt(s.entries)}</td><td>${fmt(s.exits)}</td>` +
      `<td>${fmt(s.total)}</td><td class="bar"><span style="width:${Math.round(((s.total || 0) / maxTotal) * 100)}%"></span></td>`;
    tr.addEventListener('mouseenter', () => hoverSelect(s.crs));
    tr.addEventListener('click', () => pinToggle(s.crs));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pinToggle(s.crs); showDetail(s.crs); }
    });
    rowEls.push(tr);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // ---- 3. schematic map ----
  const ext = nodeExtents(net);
  const svg = svgEl('svg', {
    viewBox: `${ext.minX} ${ext.minY} ${ext.maxX - ext.minX} ${ext.maxY - ext.minY}`,
    class: 'map', role: 'img', 'aria-label': 'Schematic network map',
  });
  const bg = svgEl('rect', { x: ext.minX, y: ext.minY, width: ext.maxX - ext.minX, height: ext.maxY - ext.minY, fill: 'transparent', class: 'map-bg' });
  bg.addEventListener('click', unpin);
  svg.appendChild(bg);
  for (const line of net.lines || []) {
    const seg = (net.segments || []).find((s) => s.line === line.id);
    if (!seg) continue;
    const d = linePath(seg, stopById);
    if (d) svg.appendChild(svgEl('path', { d, fill: 'none', stroke: line.color, 'stroke-width': 2.5, class: 'map-line', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  for (const s of net.stops || []) {
    const node = svgEl('circle', { cx: s.x, cy: s.y, r: 6, class: 'map-node' });
    node.dataset.crs = s.crs;
    node.setAttribute('aria-label', nameOf(s.crs));
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleEl.textContent = nameOf(s.crs);
    node.appendChild(titleEl);
    const u = usageById.get(s.crs);
    node.addEventListener('mouseenter', (e) => {
      hoverSelect(s.crs);
      tip.innerHTML = `<strong>${nameOf(s.crs)}</strong><br>${fmt(u && u.entries)} entries · ${fmt(u && u.exits)} exits`;
      showTipAt(e);
    });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('click', () => { pinToggle(s.crs); showDetail(s.crs); });
    nodeEls.push(node);
    svg.appendChild(node);
  }

  // ---- assemble ----
  const panels = document.createElement('div');
  panels.className = 'people-panels';
  const hwrap = document.createElement('div');
  hwrap.className = 'people-panel';
  hwrap.append(heatmap, legend, caption);
  const maprow = document.createElement('div');
  maprow.className = 'people-maprow';
  const twrap = document.createElement('div');
  twrap.className = 'people-panel';
  twrap.appendChild(table);
  const mwrap = document.createElement('div');
  mwrap.className = 'people-panel';
  mwrap.appendChild(svg);
  maprow.append(twrap, mwrap);
  panels.append(hwrap, maprow, detail);
  slot.replaceChildren();
  slot.append(panels, tip);
}

async function boot() {
  const slot = document.querySelector('[data-viz-slot="usage"]');
  if (!slot) return;
  try {
    render(slot, await ready);
  } catch (err) {
    slot.textContent = `Could not load data: ${err.message}`;
  }
}
boot();
