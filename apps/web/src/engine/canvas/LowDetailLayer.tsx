// Low detail on one canvas (#131, canvas/detail.ts). Zoomed out far, the items whose types know
// how to paint themselves cheaply (ElementDefinition.lowDetail) are painted here, in render order,
// instead of being DOM of their own: ten thousand items are a few thousand canvas calls, not ten
// thousand positioned boxes for the browser to style, lay out, paint and layer every frame (Chrome
// spent most of a zoomed-out frame layering them: docs/performance.md). The canvas lies in the
// world (it moves and scales with the camera, so a pan repaints nothing); it covers its items'
// bounds within the culled area, at the zoom's resolution. When some of its items change (a drag,
// a collaborator's edit) only the part of the canvas they cover is painted again; the selection,
// the focus, the theme, the zoom or its set of items paint it all. Live canvas only: exports and
// thumbnails never come here. aria-hidden: what the board says is read from the doc (live
// regions, Board as list), never from pixels.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { BoardElement } from '@freero/shared';
import type { ChildPresentation, LowDetailPaint, Rect } from '../api';
import { useCore } from '../context';
import { elementAABB, rectContainsRect, rectsIntersect, rectUnion } from '../geometry/geometry';
import { pictureColor } from './pictureColor';
import { useDocumentTheme } from './theme';

/** At most this many canvas pixels (a zoomed-out view on a large, dense screen draws a little softer). */
const MAX_PIXELS = 12_000_000;
/** Repaint everything rather than a part once the part is this share of the canvas. */
const PARTIAL_MAX = 0.4;

/** `var(--x, fallback)` → the value of --x where `style` is, else the fallback (resolved too). */
function resolver(style: CSSStyleDeclaration) {
  const cache = new Map<string, string>();
  const resolve = (c: string): string => {
    if (!c.startsWith('var(')) return c;
    let v = cache.get(c);
    if (v === undefined) {
      const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(c);
      v = (m && style.getPropertyValue(m[1]).trim()) || (m?.[2] ? resolve(m[2].trim()) : 'transparent');
      cache.set(c, v);
    }
    return v;
  };
  return resolve;
}

/** An item's painted bounds (its box, turned, with room for a line's width). */
function paintedBox(el: BoardElement): Rect {
  const r = elementAABB(el);
  const pad = 2 + ((el as { strokeWidth?: number }).strokeWidth ?? 0);
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

interface Painted {
  /** World rect the canvas covers. */
  area: Rect;
  /** Canvas pixels per world unit. */
  px: number;
  /** Each item as last painted, where, and its container as it was then (it may present it). */
  items: Map<string, { el: BoardElement; box: Rect; container?: BoardElement }>;
}

export function LowDetailLayer({ ids, cull, zoom }: { ids: readonly string[]; cull: Rect; zoom: number }) {
  const core = useCore();
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useDocumentTheme();
  const painted = useRef<Painted | null>(null);
  const draw = useRef<(all: boolean) => void>(() => undefined);

  draw.current = (all) => {
    const canvas = ref.current;
    if (!canvas) return;
    const { store, registry } = core;
    const els: Array<{ el: BoardElement; box: Rect; container?: BoardElement }> = [];
    for (const id of ids) {
      const el = store.getElement(id);
      if (el) els.push({ el, box: paintedBox(el), container: registry.presents && el.frameId ? store.getElement(el.frameId) : undefined });
    }
    const union = rectUnion(els.map((e) => e.box));
    const want = union && intersection(union, cull);
    if (!want) {
      canvas.style.display = 'none';
      painted.current = null;
      return;
    }
    let last = painted.current;
    // The canvas keeps its place while its items stay inside it: a drag inside repaints a part.
    if (all || !last || !rectContainsRect(last.area, want) || last.area.w * last.area.h > want.w * want.h * 4) {
      const ratio = Math.min(2, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
      const px = Math.min(zoom * ratio, Math.sqrt(MAX_PIXELS / (want.w * want.h)));
      last = painted.current = { area: want, px, items: new Map() };
      all = true;
    }
    const { area, px } = last;
    const W = Math.max(1, Math.ceil(area.w * px));
    const H = Math.max(1, Math.ceil(area.h * px));
    canvas.style.display = '';
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    Object.assign(canvas.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${W / px}px`, height: `${H / px}px` });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A part: what changed since the last paint, where it was and where it is.
    let dirty: Rect | null = null;
    if (!all) {
      const now = new Set<string>();
      for (const { el, box, container } of els) {
        now.add(el.id);
        const was = last.items.get(el.id);
        if (was?.el === el && was.container === container) continue;
        dirty = grow(grow(dirty, box), was?.box ?? null);
      }
      for (const [id, was] of last.items) if (!now.has(id)) dirty = grow(dirty, was.box);
      if (!dirty) return;
      dirty = intersection(dirty, area);
      if (!dirty) return;
      if (dirty.w * dirty.h > area.w * area.h * PARTIAL_MAX) {
        dirty = null;
        all = true;
      }
    }
    if (all) last.items.clear();

    const { selection, focusId, focusHide } = core.ui.getState();
    const selected = new Set(selection);
    const resolve = resolver(getComputedStyle(canvas));
    ctx.setTransform(px, 0, 0, px, -area.x * px, -area.y * px);
    ctx.save();
    if (dirty) {
      ctx.beginPath();
      ctx.rect(dirty.x, dirty.y, dirty.w, dirty.h);
      ctx.clip();
      ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
    } else ctx.clearRect(area.x, area.y, area.w, area.h);

    // The painter draws in the item's own units: (ox, oy) is its top left (0, 0 while turned).
    let el: BoardElement = els[0].el;
    let ox = 0;
    let oy = 0;
    let queued = false;
    const repaint = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => draw.current(true));
    };
    const withAlpha = (alpha: number, fn: () => void) => {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * alpha;
      fn();
      ctx.globalAlpha = a;
    };
    const paint: LowDetailPaint & { selected: boolean; presentation: ChildPresentation | null } = {
      selected: false,
      presentation: null,
      selectionColor: resolve('var(--fr-select, #5b3ff0)'),
      box({ fill, stroke, strokeWidth = 0, radius, round, alpha = 1 }) {
        const sw = stroke && stroke !== 'transparent' ? Math.max(0, strokeWidth) : 0;
        const w = Math.max(0, el.w - sw);
        const h = Math.max(0, el.h - sw);
        const x = ox + sw / 2;
        const y = oy + sw / 2;
        const plain = !round && !(radius && radius * px >= 0.75);
        if (plain && !sw) {
          if (fill && fill !== 'transparent') withAlpha(alpha, () => ((ctx.fillStyle = resolve(fill)), ctx.fillRect(ox, oy, el.w, el.h)));
          return;
        }
        ctx.beginPath();
        if (round) ctx.ellipse(ox + el.w / 2, oy + el.h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else if (!plain && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(radius!, w / 2, h / 2));
        else ctx.rect(x, y, w, h);
        if (fill && fill !== 'transparent') withAlpha(alpha, () => ((ctx.fillStyle = resolve(fill)), ctx.fill()));
        if (sw > 0) {
          ctx.strokeStyle = resolve(stroke!);
          ctx.lineWidth = sw;
          ctx.stroke();
        }
      },
      rect(x, y, w, h, color, alpha = 1) {
        withAlpha(alpha, () => ((ctx.fillStyle = resolve(color)), ctx.fillRect(ox + x, oy + y, w, h)));
      },
      polygon(points, color, alpha = 1) {
        ctx.beginPath();
        points.forEach(([u, v], i) => (i ? ctx.lineTo(ox + u * el.w, oy + v * el.h) : ctx.moveTo(ox + u * el.w, oy + v * el.h)));
        ctx.closePath();
        withAlpha(alpha, () => ((ctx.fillStyle = resolve(color)), ctx.fill()));
      },
      line(points, color, width) {
        if (points.length < 2) return;
        ctx.beginPath();
        points.forEach((p, i) => (i ? ctx.lineTo(ox + p.x, oy + p.y) : ctx.moveTo(ox + p.x, oy + p.y)));
        ctx.strokeStyle = resolve(color);
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      },
      picture(src, fallback) {
        ctx.fillStyle = resolve((src && pictureColor(src, repaint)) || fallback);
        ctx.fillRect(ox, oy, el.w, el.h);
      },
    };
    for (const item of els) {
      last.items.set(item.el.id, item);
      if (dirty && !rectsIntersect(item.box, dirty)) continue;
      const def = registry.elements.get(item.el.type)?.def;
      if (!def?.lowDetail) continue;
      el = item.el;
      // Outside the item this viewer focuses on: faded, or not drawn ("hide the rest"), as the DOM item would be.
      const outside = !!focusId && !core.editor.inFocus(el);
      if (outside && focusHide) continue;
      ctx.globalAlpha = outside ? 0.16 : 1;
      paint.selected = selected.has(el.id);
      // As ElementFrame gives it to the component: the container's view of it (kanban colour-by).
      const creg = item.container && registry.elements.get(item.container.type);
      paint.presentation = creg?.def.presentChild ? creg.def.presentChild(item.container as never, el, { editor: core.scoped(creg.feature), personal: true }) : null;
      if (el.rotation) {
        ctx.save();
        ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
        ctx.rotate((el.rotation * Math.PI) / 180);
        ctx.translate(-el.w / 2, -el.h / 2);
        ox = 0;
        oy = 0;
        def.lowDetail(el as never, paint);
        ctx.restore();
      } else {
        ox = el.x;
        oy = el.y;
        def.lowDetail(el as never, paint);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    canvas.dataset.paints = String(Number(canvas.dataset.paints ?? 0) + 1);
  };

  // Its items, the area or the zoom changed (React), or the theme: paint it all, before the frame.
  useLayoutEffect(() => draw.current(true), [ids, cull, zoom, theme]);
  // Some of its items changed: paint their part, once per task. The selection or the focus: all.
  useEffect(() => {
    let queued: boolean | null = null;
    const later = (all: boolean) => {
      if (queued !== null) {
        queued ||= all;
        return;
      }
      queued = all;
      queueMicrotask(() => {
        const a = !!queued;
        queued = null;
        draw.current(a);
      });
    };
    const offEls = core.store.subscribeElements(() => later(false));
    // My own view settings change how containers present their items (a kanban's colour-by for me).
    const offMine = core.emitter.on('personal-views', () => later(true));
    const offUi = core.ui.subscribe((s, p) => {
      if (s.selection !== p.selection || s.focusId !== p.focusId || s.focusHide !== p.focusHide) later(true);
    });
    return () => {
      offEls();
      offMine();
      offUi();
    };
  }, [core]);

  return <canvas ref={ref} className="fr-lod-layer" data-items={ids.length} aria-hidden />;
}

function grow(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
