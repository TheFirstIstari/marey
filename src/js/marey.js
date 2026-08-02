// M2 — Marey diagram: time × station-position chart of train trajectories
// (the "The Trains" section). One panel per line in network.json, vanilla SVG,
// no dependencies. Hover scrubs to the nearest trajectory.
import { ready } from './dataloader.js';
import { svgEl } from './svg.js';
import { secOfDayMin, hhmm, linScale, stationY, tripPoints, pickDayLines, fetchDayTrips } from './marey-math.js';

const W = 880;
const H = 420;
const M = { top: 26, right: 20, bottom: 42, left: 150 };
const plotW = W - M.left - M.right;
const fmt = (t) => hhmm(secOfDayMin(t));

function buildPanel(slot, payloads, line) {
  const trips = (payloads.marey || []).filter((t) => t.line === line.id);
  const seg = (payloads.network.segments || []).find((s) => s.line === line.id);
  if (!seg || trips.length === 0) return null;

  const stopNames = new Map((payloads.network.stops || []).map((s) => [s.crs, s.name]));
  const stops = seg.stations.map((crs) => ({ crs, name: stopNames.get(crs) || crs }));

  // x domain: span of all trajectories on this line, padded to the hour
  let d0 = Infinity, d1 = -Infinity;
  for (const t of trips) {
    d0 = Math.min(d0, secOfDayMin(t.begin));
    d1 = Math.max(d1, secOfDayMin(t.end));
  }
  d0 = Math.floor((d0 - 5) / 60) * 60;
  d1 = Math.ceil((d1 + 5) / 60) * 60;

  const x = linScale(d0, d1, M.left, W - M.right);
  const y = stationY(stops.length, M.top, H - M.bottom);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'marey', role: 'img', 'aria-label': `Marey diagram for ${line.name}` });

  // hourly vertical grid + time labels; horizontal grid per station
  for (let m = Math.ceil(d0 / 60) * 60; m <= d1; m += 60) {
    svg.appendChild(svgEl('line', { x1: x(m), y1: M.top, x2: x(m), y2: H - M.bottom, class: 'grid-v' }));
    const tx = svgEl('text', { x: x(m), y: H - M.bottom + 18, class: 'axis', 'text-anchor': 'middle' });
    tx.textContent = hhmm(m);
    svg.appendChild(tx);
  }
  stops.forEach((s, i) => {
    const yy = y(i);
    svg.appendChild(svgEl('line', { x1: M.left, y1: yy, x2: W - M.right, y2: yy, class: 'grid-h' }));
    const ty = svgEl('text', { x: M.left - 8, y: yy + 4, class: 'station', 'text-anchor': 'end' });
    ty.textContent = s.name;
    svg.appendChild(ty);
  });

  // trajectories + station dots
  const items = trips.map((t) => {
    const pts = tripPoints(t, seg.stations, x, y);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const path = svgEl('path', { d, fill: 'none', stroke: line.color, 'stroke-width': 1.4, opacity: 0.75, class: 'trip' });
    svg.appendChild(path);
    for (const p of pts) svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 1.8, fill: line.color, class: 'trip-dot' }));
    return { t, path };
  });

  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.setAttribute('role', 'status');

  const select = (item) => {
    for (const it of items) {
      it.path.setAttribute('opacity', it === item ? 1 : 0.15);
      it.path.setAttribute('stroke-width', it === item ? 2.6 : 1.4);
    }
  };
  const showTip = (item, cx, cy) => {
    const o = stopNames.get(item.t.stops[0].stop) || item.t.stops[0].stop;
    const d = stopNames.get(item.t.stops.at(-1).stop) || item.t.stops.at(-1).stop;
    tip.innerHTML = `<strong>${item.t.service}</strong> · ${o} → ${d}<br>${fmt(item.t.begin)} → ${fmt(item.t.end)}`;
    tip.style.left = `${cx + 12}px`;
    tip.style.top = `${cy - 12}px`;
    tip.style.display = 'block';
  };

  const wrap = document.createElement('div');
  wrap.className = 'marey-panel';
  const title = document.createElement('p');
  title.className = 'marey-title';
  title.textContent = line.name;
  wrap.appendChild(title);
  wrap.appendChild(svg);
  wrap.appendChild(tip);
  slot.appendChild(wrap);

  wrap.addEventListener('mousemove', (e) => {
    const srect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - srect.left) / srect.width) * W;
    if (svgX < M.left || svgX > W - M.right) {
      select(null);
      tip.style.display = 'none';
      return;
    }
    const tMin = d0 + ((svgX - M.left) / plotW) * (d1 - d0);
    let best = null, bestD = Infinity;
    for (const it of items) {
      const a = secOfDayMin(it.t.begin), b = secOfDayMin(it.t.end);
      const dd = tMin < a ? a - tMin : tMin > b ? tMin - b : 0;
      if (dd < bestD) { bestD = dd; best = it; }
    }
    select(best);
    const wrect = wrap.getBoundingClientRect();
    showTip(best, e.clientX - wrect.left, e.clientY - wrect.top);
  });
  wrap.addEventListener('mouseleave', () => {
    select(null);
    tip.style.display = 'none';
  });

  return true;
}

async function render(slot, payloads, chosenDay) {
  const index = payloads.marey;
  if (!index || !index.days || !index.lines) return;

  const dayEntry = index.days.find((d) => d.date === chosenDay);
  if (!dayEntry) return;

  const lines = (payloads.network && payloads.network.lines) || [];
  let rendered = 0;

  for (const line of lines) {
    const lineInfo = dayEntry.lines.find((l) => l.line === line.id);
    if (!lineInfo || lineInfo.count === 0) continue;

    try {
      const trips = await fetchDayTrips(chosenDay, line.id);
      if (!Array.isArray(trips) || trips.length === 0) continue;
      const panelPayloads = { ...payloads, marey: trips };
      if (buildPanel(slot, panelPayloads, line)) rendered++;
    } catch (err) {
      console.warn(`marey: failed to load ${chosenDay}/${line.id}:`, err.message);
    }
  }
}

function populateDayPicker(index, chosenDay, onSelect) {
  const select = document.getElementById('marey-day-select');
  if (!select) return;
  select.innerHTML = '';

  for (const day of index.days) {
    const opt = document.createElement('option');
    opt.value = day.date;
    opt.textContent = day.date;
    if (day.date === chosenDay) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => onSelect(select.value), { once: false });
}

async function boot() {
  const slot = document.querySelector('[data-viz-slot="marey"]');
  if (!slot) return;
  try {
    const payloads = await ready;
    const index = payloads.marey;
    const defaultDay = (index && index.days && index.days.length > 0)
      ? index.days[index.days.length - 1].date
      : null;

    populateDayPicker(index, defaultDay, async (chosenDay) => {
      slot.querySelectorAll('.marey-panel').forEach((el) => el.remove());
      const tip = slot.querySelector('.viz-tip');
      if (tip) tip.remove();
      await render(slot, payloads, chosenDay);
    });

    if (defaultDay) {
      await render(slot, payloads, defaultDay);
    }
  } catch (err) {
    slot.textContent = `Could not load data: ${err.message}`;
  }
}
boot();
