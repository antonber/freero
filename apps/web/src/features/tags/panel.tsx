import { memo, useEffect, useMemo, useState } from 'react';
import type { StickyElement, Tag } from '@freero/shared';
import { definePanel, useCollection, useElement, type Editor, type Rect } from '@engine';
import './tags.css';

/** Below this zoom chips are unreadable specks: don't render any. */
const MIN_ZOOM = 0.3;
const MAX_CHIPS = 3;

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/**
 * Ids of tagged stickies near the viewport. Recomputed (one linear pass, coalesced per task) when
 * elements change, and on camera moves only when the view leaves a padded cull rect or crosses
 * the readability zoom — so panning doesn't re-render anything.
 */
function useVisibleTaggedStickies(editor: Editor): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let cull: Rect | null = null;
    let readable = true;
    let prev: string[] = [];
    let queued = false;
    let disposed = false;
    const compute = (force: boolean) => {
      const cam = editor.getCamera();
      const vp = editor.getViewportSize();
      const view = { x: cam.x, y: cam.y, w: vp.width / cam.zoom, h: vp.height / cam.zoom };
      const nowReadable = cam.zoom >= MIN_ZOOM;
      if (!force && cull && contains(cull, view) && nowReadable === readable) return;
      readable = nowReadable;
      const pad = Math.max(view.w, view.h) * 0.4;
      cull = { x: view.x - pad, y: view.y - pad, w: view.w + pad * 2, h: view.h + pad * 2 };
      const next: string[] = [];
      if (readable) {
        for (const el of editor.getElements()) {
          if (el.type !== 'sticky' || !el.tags?.length) continue;
          const r = Math.max(el.w, el.h); // rotation-safe bounds
          if (intersects({ x: el.x + el.w / 2 - r, y: el.y + el.h / 2 - r, w: r * 2, h: r * 2 }, cull)) next.push(el.id);
        }
      }
      if (next.length !== prev.length || next.some((id, i) => id !== prev[i])) {
        prev = next;
        setIds(next);
      }
    };
    compute(true);
    const offElements = editor.on('elements', () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed) compute(true);
      });
    });
    const offCamera = editor.on('camera', () => compute(false));
    return () => {
      disposed = true;
      offElements();
      offCamera();
    };
  }, [editor]);
  return ids;
}

/** Chips along the bottom edge of one sticky, in world space, scaled with the sticky. */
const StickyChips = memo(function StickyChips({ id, tags }: { id: string; tags: Map<string, Tag> }) {
  const el = useElement<StickyElement>(id);
  const known = (el?.tags ?? []).map((t) => tags.get(t)).filter((t): t is Tag => !!t);
  if (!el || !known.length) return null;
  const s = Math.min(2.5, Math.max(0.5, Math.min(el.w, el.h) / 200));
  return (
    <div
      className="fr-tagchips"
      style={{
        width: el.w,
        height: el.h,
        transform: `translate(${el.x}px, ${el.y}px)${el.rotation ? ` rotate(${el.rotation}deg)` : ''}`,
        ['--s' as string]: s,
      }}
    >
      <div className="fr-tagchips__row">
        {known.slice(0, MAX_CHIPS).map((t) => (
          <span key={t.id} className="fr-tagchips__chip" style={{ ['--tag' as string]: t.color }}>
            {t.name}
          </span>
        ))}
        {known.length > MAX_CHIPS && <span className="fr-tagchips__chip is-more">+{known.length - MAX_CHIPS}</span>}
      </div>
    </div>
  );
});

// Cards draw their own chips (they read the tags collection directly); stickies get them here.
export default definePanel({
  id: 'tags.stickyChips',
  slot: 'world-overlay',
  order: 20,
  Component: ({ editor }) => {
    const entries = useCollection<Tag>('tags');
    const tags = useMemo(() => new Map(entries), [entries]);
    const ids = useVisibleTaggedStickies(editor);
    if (!tags.size) return null;
    return (
      <>
        {ids.map((id) => (
          <StickyChips key={id} id={id} tags={tags} />
        ))}
      </>
    );
  },
});
