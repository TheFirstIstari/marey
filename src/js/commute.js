// M6 — Your Commute: mirrored scatter of percentile journey-time bands
// (transit above zero, wait below) with on-demand per-origin fetch,
// deep-linkable hash, and click-to-select destination.
'use strict';

import { svgEl } from './svg.js';
import { downsample, nearestHit, parseHash, percentilePath } from './commute-math.js';
import { ready } from './dataloader.js';

const W = 500;
const H = 290;
const M = { top: 20, right: 20, bottom: 40, left: 120 };
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;

const ORIGINS = ['FST', 'LST', 'KGX', 'MOO', 'CBG', 'PBX', 'NRW', 'IPS', 'SOS', 'STN'];

function linScale(d0, d1, r0, r1) {
  return (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

function stationName(stops, crs) {
  const s = stops.find((s) => s.crs === crs);
  return s ? s.name : crs;
}

// Render the commute scatter into slot.
function render(slot, payloads, origin, dest) {
  slot.replaceChildren();

  const stops = (payloads.network && payloads.network.stops) || [];
  const nameOf = (crs) => stationName(stops, crs);

  // ---- origin select ----
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Commute origin');
  for (const o of ORIGINS) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === origin) opt.selected = true;
    sel.appendChild(opt);
  }
  slot.appendChild(sel);

  // ---- SVG ----
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'commute',
    role: 'img',
    'aria-label': `Commute scatter for ${origin}`,
  });

  let commuteData = null;
  let currentOrigin = origin;
  let currentDest = dest;

  async function loadOrigin(orig) {
    currentOrigin = orig;
    try {
      const res = await fetch(`data/commute-${orig}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      commuteData = await res.json();
    } catch (err) {
      commuteData = null;
      return;
    }
    drawScatter();
    // sync dest from hash
    const hash = parseHash(location.hash);
    if (hash && hash.from === currentOrigin) {
      currentDest = hash.to;
    } else {
      currentDest = null;
    }
    highlightDest();
  }

  function drawScatter() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!commuteData) return;

    const dests = Object.keys(commuteData);
    if (dests.length === 0) return;

    // compute domains
    let xMin = 5, xMax = 24;
    let yMax = 1;
    for (const dest of dests) {
      const dd = commuteData[dest];
      if (!dd) continue;
      for (const row of dd.actuals || []) {
        xMin = Math.min(xMin, row[0]);
        xMax = Math.max(xMax, row[0]);
        yMax = Math.max(yMax, row[1], row[2]);
      }
      for (const row of dd.result || []) {
        xMin = Math.min(xMin, row[0]);
        xMax = Math.max(xMax, row[0]);
        yMax = Math.max(yMax, row[1][2], row[2][2]);
      }
    }

    const x = linScale(xMin, xMax, M.left, W - M.right);
    const yCenter = M.top + plotH / 2;
    const yScale = (v) => yCenter - (v / yMax) * (plotH / 2);

    // x-axis grid + labels
    for (let h = Math.ceil(xMin); h <= Math.floor(xMax); h++) {
      svg.appendChild(svgEl('line', { x1: x(h), y1: M.top, x2: x(h), y2: H - M.bottom, class: 'grid-v' }));
      const t = svgEl('text', { x: x(h), y: H - M.bottom + 16, class: 'axis', 'text-anchor': 'middle' });
      t.textContent = String(h);
      svg.appendChild(t);
    }

    // y=0 line
    svg.appendChild(svgEl('line', { x1: M.left, y1: yCenter, x2: W - M.right, y2: yCenter, class: 'grid-h' }));

    // y-axis label
    const yLabel = svgEl('text', { x: M.left - 8, y: M.top + 10, class: 'station', 'text-anchor': 'end' });
    yLabel.textContent = 'min';
    svg.appendChild(yLabel);

    // ---- draw each destination ----
    for (const dest of dests) {
      const dd = commuteData[dest];
      if (!dd || !dd.result || dd.result.length === 0) continue;

      const isSelected = currentDest === dest;
      const band = percentilePath(dd.result);

      // p10-p90 band
      if (band.areaD) {
        svg.appendChild(svgEl('path', {
          d: band.areaD,
          fill: isSelected ? 'rgba(255,180,0,0.25)' : 'rgba(255,180,0,0.08)',
          stroke: 'none',
          class: 'commute-band',
        }));
      }

      // p50 line
      if (band.p50.length > 1) {
        const d = band.p50.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${yScale(p[1]).toFixed(1)}`).join('');
        svg.appendChild(svgEl('path', {
          d, fill: 'none',
          stroke: isSelected ? '#ffb400' : 'rgba(255,180,0,0.5)',
          'stroke-width': isSelected ? 2 : 1,
          class: 'commute-line',
        }));
      }

      // actuals dots (downsampled)
      const sampled = downsample(dd.actuals || [], 100);
      for (const [h, transit, wait] of sampled) {
        // transit dot (above zero)
        svg.appendChild(svgEl('circle', {
          cx: x(h).toFixed(1), cy: yScale(transit).toFixed(1), r: isSelected ? 2.5 : 1,
          fill: isSelected ? '#ffb400' : 'rgba(255,180,0,0.6)',
          class: 'commute-dot', 'data-dest': dest,
        }));
        // wait dot (below zero, mirrored)
        svg.appendChild(svgEl('circle', {
          cx: x(h).toFixed(1), cy: yScale(-wait).toFixed(1), r: isSelected ? 2.5 : 1,
          fill: isSelected ? '#ff6b00' : 'rgba(255,107,0,0.5)',
          class: 'commute-dot', 'data-dest': dest,
        }));
      }

      // destination label
      const lastPt = band.p50[band.p50.length - 1];
      if (lastPt) {
        const lbl = svgEl('text', {
          x: x(lastPt[0]).toFixed(1),
          y: yScale(lastPt[1]) - 6,
          class: 'station', 'text-anchor': 'middle', 'font-size': '10',
        });
        lbl.textContent = dest;
        svg.appendChild(lbl);
      }
    }

    // ---- click handler for destination selection ----
    svg.addEventListener('click', (e) => {
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      const svgY = ((e.clientY - rect.top) / rect.height) * H;

      const allDots = [...svg.querySelectorAll('.commute-dot')];
      const pts = allDots.map((d) => [parseFloat(d.getAttribute('cx')), parseFloat(d.getAttribute('cy'))]);
      const idx = nearestHit(svgX, svgY, pts, 12);
      if (idx >= 0) {
        currentDest = allDots[idx].getAttribute('data-dest');
        location.hash = `#your-commute.${currentOrigin}.${currentDest}`;
        highlightDest();
      }
    });

    slot.appendChild(svg);
  }

  function highlightDest() {
    sel.value = currentOrigin;
    if (commuteData) drawScatter();
  }

  // initial load
  loadOrigin(currentOrigin);

  // origin change
  sel.addEventListener('change', () => {
    currentDest = null;
    loadOrigin(sel.value);
    location.hash = `#your-commute.${sel.value}`;
  });
}

// ---- boot & hashchange ----
let currentPayloads = null;
let currentSlot = null;
let currentOrigin = ORIGINS[0];
let currentDest = null;

async function boot() {
  const slot = document.querySelector('[data-viz-slot="commute"]');
  if (!slot) return;
  currentSlot = slot;
  try {
    currentPayloads = await ready;
    const hash = parseHash(location.hash);
    currentOrigin = (hash && ORIGINS.includes(hash.from)) ? hash.from : ORIGINS[0];
    currentDest = hash ? hash.to : null;
    render(slot, currentPayloads, currentOrigin, currentDest);
  } catch (err) {
    slot.textContent = `Could not load commute data: ${err.message}`;
  }
}

window.addEventListener('hashchange', () => {
  if (!currentPayloads || !currentSlot) return;
  const hash = parseHash(location.hash);
  if (hash && ORIGINS.includes(hash.from)) {
    currentOrigin = hash.from;
    currentDest = hash.to;
    render(currentSlot, currentPayloads, currentOrigin, currentDest);
  }
});

export function mount(el, data) {
  currentSlot = el;
  currentPayloads = data;
  const hash = parseHash(location.hash);
  currentOrigin = (hash && ORIGINS.includes(hash.from)) ? hash.from : ORIGINS[0];
  currentDest = hash ? hash.to : null;
  render(el, data, currentOrigin, currentDest);
}

boot();
