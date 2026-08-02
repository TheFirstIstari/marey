// T2.1: Section registry + lazy per-section module loader.
// Finds [data-viz-slot] elements, import()s the section module,
// and calls its mount(slotEl, data) export.
import { ready } from './dataloader.js';

const registry = {};

export function registerSection(slot, module) {
  registry[slot] = module;
}

export async function bootSections(root = document) {
  const data = await ready;
  for (const [slot, load] of Object.entries(registry)) {
    const el = root.querySelector(`[data-viz-slot="${slot}"]`);
    if (!el) continue;
    try {
      const mod = await load();
      if (typeof mod.mount === 'function') mod.mount(el, data);
    } catch (err) {
      console.warn(`sections: failed to boot ${slot}:`, err);
    }
  }
}

// Default registry entries for the five PoC sections.
registerSection('marey', () => import('./marey.js'));
registerSection('usage', () => import('./people.js'));
registerSection('delay', () => import('./delay.js'));
registerSection('commute', () => import('./commute.js'));
registerSection('live', () => import('./live.js'));
