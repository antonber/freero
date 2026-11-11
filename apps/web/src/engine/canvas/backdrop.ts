// What a dark page shows behind each item on the live canvas (theme.ts `Backdrop`), so an item's
// ink can follow it: black text placed over a white rectangle stays black, a dark brown heading on
// a frame shown dark is drawn light. Worked out at paint time, never stored.
//
// The backdrop of an item is the topmost surface (ElementDefinition.surface: a filled shape, a
// sticky, a card, a frame's fill) BELOW it in render order whose box holds the item's centre,
// else the board background. Light frame fills and a light background are shown dark (they
// carry the filter's strength); every other surface is shown as authored.
//
// Cheap on big boards: one pass over the items in render order builds a grid of the surfaces
// (each in the cells its box covers; a huge one in a short list of its own), and an item's
// backdrop is a look-up in the cell of its centre. Built at most once per change of the board, its
// background, the hidden items or the page's theme; nothing is built on a light page.
import type { BoardElement } from '@freero/shared';
import type { Rect } from '../api';
import type { EngineCore } from '../runtime/core';
import { elementAABB } from '../geometry/geometry';
import { CANVAS_INVERT, darkFiltered, documentTheme, isLightSurface, SURFACE_INVERT, subscribeDocumentTheme, type Backdrop } from './theme';

/** Grid cell size (world units). */
const CELL = 1024;
/** A surface covering more cells than this goes into the short list checked for every item. */
const MAX_CELLS = 64;

interface Surface {
  rank: number;
  id: string;
  box: Rect;
  backdrop: Backdrop;
}

interface Built {
  ordered: readonly BoardElement[];
  hidden: unknown;
  /** The board settings' version it was built for (the background). */
  settings: number;
  base: Backdrop | null;
  /** Per visible item: its place in render order and the centre of its box. */
  items: Map<string, { rank: number; x: number; y: number }>;
  cells: Map<string, Surface[]>;
  big: Surface[];
  memo: Map<string, Backdrop | null>;
}

const key = (cx: number, cy: number) => `${cx},${cy}`;

/** The index of the last surface in `list` (in render order) below rank `r`, -1 if none. */
function below(list: readonly Surface[], r: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].rank < r) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
const holds = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export class Backdrops {
  private built: Built | null = null;
  /** One object per distinct backdrop, so an item whose backdrop reads the same keeps the same value. */
  private interned = new Map<string, Backdrop>();
  private listeners = new Map<string, Set<() => void>>();
  private last = new Map<string, Backdrop | null>();
  private queued = false;
  private off: Array<() => void> = [];

  constructor(private core: EngineCore) {}

  private intern(shown: string, invert: number | null): Backdrop {
    const k = `${shown}|${invert}`;
    let b = this.interned.get(k);
    if (!b) this.interned.set(k, (b = { shown, invert }));
    return b;
  }

  /** The backdrop of the item `id` on this page now (null on a light page, or with nothing shown dark or light behind it). */
  get(id: string): Backdrop | null {
    const b = this.current();
    if (!b) return null;
    let v = b.memo.get(id);
    if (v === undefined) {
      v = this.compute(b, id);
      b.memo.set(id, v);
    }
    return v;
  }

  /** Calls `cb` when the backdrop of `id` changes. */
  subscribe(id: string, cb: () => void): () => void {
    if (!this.listeners.size) this.start();
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(cb);
    this.last.set(id, this.get(id));
    return () => {
      set!.delete(cb);
      if (!set!.size) {
        this.listeners.delete(id);
        this.last.delete(id);
      }
      if (!this.listeners.size) this.stop();
    };
  }

  private start() {
    const { store, ui } = this.core;
    const changed = () => this.schedule();
    this.off = [
      store.subscribeElements(changed),
      store.subscribeSettings(changed),
      subscribeDocumentTheme(changed),
      ui.subscribe((s, p) => {
        if (s.viewHidden !== p.viewHidden) changed();
      }),
    ];
  }

  private stop() {
    for (const off of this.off) off();
    this.off = [];
  }

  /** Once per task: tells the items whose backdrop changed. */
  private schedule() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      for (const [id, set] of this.listeners) {
        const now = this.get(id);
        if (now === this.last.get(id)) continue;
        this.last.set(id, now);
        for (const cb of [...set]) cb();
      }
    });
  }

  /** The index for the board as it is now; rebuilt when the board, its background, the hidden items or the theme changed. */
  private current(): Built | null {
    if (documentTheme() !== 'dark') return (this.built = null);
    const { store, editor, ui } = this.core;
    const ordered = store.getOrdered();
    const { viewHidden: hidden, settingsVersion: settings } = ui.getState();
    const b = this.built;
    if (b && b.ordered === ordered && b.hidden === hidden && b.settings === settings) return b;
    return (this.built = this.build(editor.getVisibleElements(), ordered, hidden, settings, store.getSettings().background));
  }

  private build(visible: readonly BoardElement[], ordered: readonly BoardElement[], hidden: unknown, settings: number, background: string): Built {
    const base = isLightSurface(background) ? this.intern(darkFiltered(background, CANVAS_INVERT), CANVAS_INVERT) : null;
    const items = new Map<string, { rank: number; x: number; y: number }>();
    const cells = new Map<string, Surface[]>();
    const big: Surface[] = [];
    const defs = this.core.registry.elements;
    visible.forEach((el, i) => {
      const box = elementAABB(el);
      items.set(el.id, { rank: i, x: box.x + box.w / 2, y: box.y + box.h / 2 });
      const s = defs.get(el.type)?.def.surface?.(el as never);
      if (!s || !s.color || s.color === 'transparent') return;
      const shown = s.darkens && isLightSurface(s.color) ? this.intern(darkFiltered(s.color, SURFACE_INVERT), SURFACE_INVERT) : this.intern(s.color, null);
      const surface: Surface = { rank: i, id: el.id, box, backdrop: shown };
      const x0 = Math.floor(box.x / CELL);
      const y0 = Math.floor(box.y / CELL);
      const x1 = Math.floor((box.x + box.w) / CELL);
      const y1 = Math.floor((box.y + box.h) / CELL);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
        big.push(surface);
        return;
      }
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = key(cx, cy);
          const list = cells.get(k);
          if (list) list.push(surface);
          else cells.set(k, [surface]);
        }
    });
    return { ordered, hidden, settings, base, items, cells, big, memo: new Map() };
  }

  private compute(b: Built, id: string): Backdrop | null {
    const item = b.items.get(id);
    if (!item) return b.base;
    const { rank: r, x, y } = item;
    // Lists are in render order: the last surface below the item that holds its centre is on top.
    let best: Surface | null = null;
    for (const list of [b.cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL))), b.big]) {
      if (!list) continue;
      for (let i = below(list, r); i >= 0; i--) {
        const s = list[i];
        if (best && s.rank <= best.rank) break;
        if (holds(s.box, x, y)) {
          best = s;
          break;
        }
      }
    }
    return best ? best.backdrop : b.base;
  }
}

const byCore = new WeakMap<EngineCore, Backdrops>();

/** The backdrops of a mounted board's items (one index per board session). */
export function backdrops(core: EngineCore): Backdrops {
  let b = byCore.get(core);
  if (!b) byCore.set(core, (b = new Backdrops(core)));
  return b;
}
