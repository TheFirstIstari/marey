// Tiny shared DOM helper for SVG building. Imported by the visualisations.
'use strict';

export function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}
