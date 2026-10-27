// The part of the viewport not covered by board chrome (Editor.getSafeArea). Chrome regions mark
// themselves with `data-fr-occludes`; each one is cut away from the viewport rect along whichever
// side keeps the most room (the toolbar trims the left, the top bar the top, the dock the right…).
import type { Rect } from '../api';
import type { EngineCore } from '../runtime/core';

/** `.fr-dock` geometry in chrome.css, used while the dock was just opened and isn't rendered yet. */
const DOCK = { right: 12, top: 72, bottom: 64, width: 360 };

export function safeArea(core: EngineCore): Rect {
  const s = core.ui.getState();
  const full: Rect = { x: 0, y: 0, w: s.viewport.width, h: s.viewport.height };
  if (s.chromeHidden) return full;
  const dockOpen = !!s.dock && core.registry.panelsById.get(s.dock)?.def.slot === 'dock-right';
  const covers: Rect[] = [];
  let dockMeasured = false;

  const viewport = core.dom.viewport;
  const root = viewport?.parentElement;
  if (viewport && root) {
    const base = viewport.getBoundingClientRect();
    for (const el of root.querySelectorAll<HTMLElement>('[data-fr-occludes]')) {
      // The DOM can lag the state by a render: trust the state for whether the dock is open.
      if (el.dataset.frOccludes === 'dock') {
        if (!dockOpen) continue;
        dockMeasured = true;
      }
      const r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) covers.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    }
  }
  if (dockOpen && !dockMeasured)
    covers.push({ x: full.w - DOCK.right - DOCK.width, y: DOCK.top, w: DOCK.width, h: Math.max(0, full.h - DOCK.top - DOCK.bottom) });

  let area = full;
  for (const c of covers) area = cutAway(area, c);
  return area;
}

/** `area` minus `cover`, trimmed from the side that leaves the largest rect. */
export function cutAway(area: Rect, cover: Rect): Rect {
  const right = area.x + area.w;
  const bottom = area.y + area.h;
  const cr = cover.x + cover.w;
  const cb = cover.y + cover.h;
  if (cover.x >= right || cr <= area.x || cover.y >= bottom || cb <= area.y) return area;
  const options: Rect[] = [
    { x: cr, y: area.y, w: right - cr, h: area.h }, // keep what's right of it
    { x: area.x, y: area.y, w: cover.x - area.x, h: area.h }, // keep what's left of it
    { x: area.x, y: cb, w: area.w, h: bottom - cb }, // below it
    { x: area.x, y: area.y, w: area.w, h: cover.y - area.y }, // above it
  ];
  let best = options[0];
  for (const o of options) if (Math.max(0, o.w) * Math.max(0, o.h) > Math.max(0, best.w) * Math.max(0, best.h)) best = o;
  return { ...best, w: Math.max(0, best.w), h: Math.max(0, best.h) };
}
