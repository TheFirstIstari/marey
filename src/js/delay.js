// M4 — Congestion & Delay: horizon chart + gradient delay band + scrubber.
// Seven day-rows of horizon areas per line, a gradient rect delay band,
// and a 24 h scrubber. All vanilla SVG, no dependencies.
import { ready } from './dataloader.js';
import { svgEl } from './svg.js';
import { dayBuckets, seriesTotals, horizonAreas, ratioColor, scrubAt } from './delay-math.js';

const W = 880;
const DAY_H = 52;
const M = { top: 26, right: 20, bottom: 52, left: 150 };
const plotW = W - M.left - M.right;
const bandH = 40;
const bandCount = 3;

function xScale(i) {
  return M.left + (i / 95) * plotW;
}

function yRow(day) {
  return M.top + day * DAY_H;
}

function buildDayRow(svg, buckets, day, delaysMap) {
  // Collect all delay ratios for this day across all lines
  const ratios = [];
  for (const b of buckets) {
    for (const line of b.lines || []) {
      for (const [seg, sec] of Object.entries(line.delay_actual || {})) {
        const avg = delaysMap[seg];
        if (avg && avg > 0) {
          ratios.push(sec / avg);
        }
      }
    }
  }
  const medianRatio = ratios.length ? ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)] : 0;

  // Horizon areas for each line that has delay data this day
  const linesSeen = new Set();
  for (const b of buckets) {
    for (const line of b.lines || []) {
      if (linesSeen.has(line.line)) continue;
      linesSeen.add(line.line);
      const values = buckets.map((bk) => {
        const ld = bk.lines?.find((l) => l.line === line.line);
        if (!ld?.delay_actual) return 0;
        const seg = Object.keys(ld.delay_actual)[0];
        const sec = ld.delay_actual[seg];
        const avg = delaysMap[seg];
        return avg && avg > 0 ? sec / avg : 0;
      });
      const areas = horizonAreas(values, bandCount, bandH);
      for (const [band, side, d] of areas) {
        const path = svgEl('path', {
          d,
          fill: side === 'top' ? ratioColor(band * 0.15 - 0.1) : ratioColor(-band * 0.15 + 0.1),
          opacity: 0.7,
          class: 'horizon-area',
        });
        svg.appendChild(path);
      }
    }
  }

  // Gradient rect delay band — one <linearGradient> per day
  const gradId = `delay-grad-day-${day}`;
  const stops = buckets.map((b, i) => {
    let maxRatio = 0;
    for (const line of b.lines || []) {
      for (const [seg, sec] of Object.entries(line.delay_actual || {})) {
        const avg = delaysMap[seg];
        if (avg && avg > 0) maxRatio = Math.max(maxRatio, sec / avg);
      }
    }
    return { offset: `${(i / 95 * 100).toFixed(1)}%`, color: ratioColor(maxRatio) };
  });

  const defs = svg.querySelector('defs') || (() => {
    const d = svgEl('defs', {});
    svg.insertBefore(d, svg.firstChild);
    return d;
  })();

  const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '1', y2: '0' });
  for (const s of stops) {
    grad.appendChild(svgEl('stop', { offset: s.offset, 'stop-color': s.color }));
  }
  defs.appendChild(grad);

  const rect = svgEl('rect', {
    x: M.left,
    y: yRow(day) + bandCount * bandH + 4,
    width: plotW,
    height: 8,
    fill: `url(#${gradId})`,
    rx: 2,
    class: 'delay-band',
  });
  svg.appendChild(rect);

  // Day label
  const label = svgEl('text', {
    x: M.left - 8,
    y: yRow(day) + bandCount * bandH / 2 + 4,
    class: 'day-label',
    'text-anchor': 'end',
  });
  label.textContent = `Day ${day}`;
  svg.appendChild(label);
}

function mount(el, data) {
  const delay = data.delay || [];
  const delaysMap = data.delays || {};
  const days = [...new Set(delay.map((b) => b.day))].sort((a, b) => a - b);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${M.top + days.length * DAY_H + M.bottom}`,
    class: 'delay-chart',
    role: 'img',
    'aria-label': 'Delay horizon chart',
  });

  // Defs for gradients
  svg.appendChild(svgEl('defs', {}));

  // Hour grid lines
  for (let i = 0; i <= 96; i += 4) {
    const x = xScale(i);
    svg.appendChild(svgEl('line', {
      x1: x, y1: M.top, x2: x, y2: M.top + days.length * DAY_H,
      class: 'grid-v',
    }));
  }

  // Hour labels
  const hhmm = (min) => {
    const m = Math.round(min);
    const h = ((Math.floor(m / 60) % 24) + 24) % 24;
    const mm = ((m % 60) + 60) % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  for (let i = 0; i <= 96; i += 16) {
    const tx = svgEl('text', {
      x: xScale(i),
      y: M.top + days.length * DAY_H + 14,
      class: 'axis',
      'text-anchor': 'middle',
    });
    tx.textContent = hhmm(i * 9); // 9 min per bucket → i*9 minutes
    svg.appendChild(tx);
  }

  // Build each day row
  for (const day of days) {
    const buckets = dayBuckets(delay, day);
    buildDayRow(svg, buckets, day, delaysMap);
  }

  // Scrubber
  const scrubLine = svgEl('line', {
    x1: 0, y1: M.top, x2: 0, y2: M.top + days.length * DAY_H,
    stroke: '#ffb400', 'stroke-width': 2, opacity: 0, class: 'scrub-line',
  });
  svg.appendChild(scrubLine);

  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.setAttribute('role', 'status');

  const wrap = document.createElement('div');
  wrap.className = 'delay-panel';
  const title = document.createElement('p');
  title.className = 'delay-title';
  title.textContent = 'Congestion & Delay';
  wrap.appendChild(title);
  wrap.appendChild(svg);
  wrap.appendChild(tip);
  el.appendChild(wrap);

  // Scrubber interaction
  wrap.addEventListener('mousemove', (e) => {
    const srect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - srect.left) / srect.width) * W;
    if (svgX < M.left || svgX > W - M.right) {
      scrubLine.setAttribute('opacity', 0);
      tip.style.display = 'none';
      return;
    }
    const tMin = ((svgX - M.left) / plotW) * 96 * 9; // minutes since midnight
    const secOfDay = tMin * 60;
    const day = days[0]; // show first day's data for the scrubber
    const buckets = dayBuckets(delay, day);
    const bucket = scrubAt(buckets, secOfDay);
    if (!bucket) return;

    scrubLine.setAttribute('x1', svgX);
    scrubLine.setAttribute('x2', svgX);
    scrubLine.setAttribute('opacity', 1);

    const parts = [];
    for (const line of bucket.lines || []) {
      for (const [seg, sec] of Object.entries(line.delay_actual || {})) {
        const avg = delaysMap[seg];
        const ratio = avg && avg > 0 ? sec / avg : 0;
        parts.push(`${seg}: ${(ratio * 100).toFixed(0)}%`);
      }
    }
    if (parts.length) {
      tip.innerHTML = `<strong>${hhmm(tMin)}</strong><br>${parts.join('<br>')}`;
    } else {
      tip.innerHTML = `<strong>${hhmm(tMin)}</strong><br>No delay data`;
    }
    const wrect = wrap.getBoundingClientRect();
    tip.style.left = `${e.clientX - wrect.left + 12}px`;
    tip.style.top = `${e.clientY - wrect.top - 12}px`;
    tip.style.display = 'block';
  });
  wrap.addEventListener('mouseleave', () => {
    scrubLine.setAttribute('opacity', 0);
    tip.style.display = 'none';
  });
}

async function boot() {
  const slot = document.querySelector('[data-viz-slot="delay"]');
  if (!slot) return;
  try {
    mount(slot, await ready);
  } catch (err) {
    slot.textContent = `Could not load data: ${err.message}`;
  }
}
boot();
