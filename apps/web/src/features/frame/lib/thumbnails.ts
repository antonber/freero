// Real slide thumbnails (#52): each slide rendered once with the board's own export renderer
// (Editor.renderToDataUrl over the frame's rect), cached per slide and drawn again only when the
// slide or something on it changed. Renders run one at a time, a moment after the last change, so
// typing on a slide or dragging across it costs one picture, not one per keystroke. Until a slide
// has its picture (and in tests, where nothing renders) the panels show the block sketch.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { BoardElement, FrameElement } from '@freero/shared';
import type { Editor } from '@engine';

/** Widest a thumbnail is drawn (the side deck's), so pictures are rendered at about twice that. */
const PICTURE_W = 560;
/** Wait after the last change to a slide before drawing it again. */
const SETTLE_MS = 400;

/** Changes whenever the slide's picture would: the frame itself, or anything on it. */
export function slideSignature(frame: FrameElement, children: readonly BoardElement[]): string {
  let s = `${frame.x},${frame.y},${frame.w},${frame.h},${frame.fill},${frame.updatedAt}`;
  for (const c of children) s += `|${c.id}:${c.updatedAt}`;
  return s;
}

type Render = (frameId: string) => Promise<string | null>;

interface Entry {
  /** Signature of the picture in `url`. */
  drawn: string | null;
  url: string | null;
  /** Latest signature asked for. */
  wanted: string;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Pictures per slide: asked for with the slide's signature, drawn (later) only when it changed. */
export class ThumbCache {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private queue: string[] = [];
  private busy = false;

  constructor(
    private readonly render: Render,
    private readonly settleMs = SETTLE_MS,
  ) {}

  url(frameId: string): string | null {
    return this.entries.get(frameId)?.url ?? null;
  }

  /** The slide looks like `signature` now: draw it again unless its picture already shows that. */
  request(frameId: string, signature: string): void {
    const e = this.entries.get(frameId) ?? { drawn: null, url: null, wanted: '', timer: null };
    this.entries.set(frameId, e);
    if (e.wanted === signature) return;
    e.wanted = signature;
    if (e.drawn === signature) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      e.timer = null;
      if (!this.queue.includes(frameId)) this.queue.push(frameId);
      void this.pump();
    }, this.settleMs);
  }

  subscribe(frameId: string, cb: () => void): () => void {
    const set = this.listeners.get(frameId) ?? new Set();
    set.add(cb);
    this.listeners.set(frameId, set);
    return () => set.delete(cb);
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let id = this.queue.shift(); id; id = this.queue.shift()) {
        const e = this.entries.get(id);
        if (!e || e.drawn === e.wanted) continue;
        const sig = e.wanted;
        const url = await this.render(id).catch(() => null);
        // Kept even when it failed (null): the sketch stays, and an unchanged slide isn't retried.
        e.drawn = sig;
        if (url) e.url = url;
        this.listeners.get(id)?.forEach((cb) => cb());
      }
    } finally {
      this.busy = false;
    }
  }
}

const caches = new Map<string, ThumbCache>();

function cacheFor(editor: Editor): ThumbCache {
  let c = caches.get(editor.boardId);
  if (!c) {
    c = new ThumbCache(async (frameId) => {
      const f = editor.getElement<FrameElement>(frameId);
      if (!f || f.type !== 'frame' || f.w < 1 || f.h < 1) return null;
      return editor.renderToDataUrl({
        rect: { x: f.x, y: f.y, w: f.w, h: f.h },
        format: 'jpeg',
        scale: Math.min(1, PICTURE_W / f.w),
        background: f.fill && f.fill !== 'transparent' ? f.fill : '#FFFFFF',
        padding: 0,
        skipFonts: true,
      });
    });
    caches.set(editor.boardId, c);
  }
  return c;
}

/** The slide's rendered picture (a data URL), or null until it has one. */
export function useSlidePicture(editor: Editor, frame: FrameElement, children: readonly BoardElement[]): string | null {
  const cache = cacheFor(editor);
  const sig = useMemo(() => slideSignature(frame, children), [frame, children]);
  useEffect(() => cache.request(frame.id, sig), [cache, frame.id, sig]);
  return useSyncExternalStore(
    (cb) => cache.subscribe(frame.id, cb),
    () => cache.url(frame.id),
  );
}
