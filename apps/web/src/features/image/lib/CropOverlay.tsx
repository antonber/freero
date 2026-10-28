// Crop mode for one image (a dialog panel, screen space): the whole picture with the crop window
// on top. Drag the handles to crop, drag the picture to pan it under the window. Enter / Done or a
// click elsewhere applies (one undo step), Esc / Cancel leaves the image as it was.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImageElement } from '@freero/shared';
import { useCamera, useElement, type PanelProps, type Point, type Rect } from '@engine';
import { Button } from '@ui';
import { applyDraft, panPicture, resizeWindow, startDraft, type CropDraft, type CropHandle } from './crop';
import { CROP_PANEL, setCropping } from './cropping';

const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Smallest crop window, in screen px. */
const MIN_PX = 16;

type Drag =
  | { kind: 'resize'; handle: CropHandle; start: Point; window: Rect; pointerId: number }
  | { kind: 'pan'; start: Point; full: Rect; pointerId: number };

const rot = (p: Point, deg: number): Point => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

export function CropOverlay({ editor, props }: PanelProps) {
  const id = String(props?.id ?? '');
  const live = useElement<ImageElement>(id);
  // The session works in the element's frame as it was when crop mode opened.
  const [snap] = useState(() => editor.getElement<ImageElement>(id) ?? null);
  const [draft, setDraft] = useState<CropDraft | null>(() => (snap ? startDraft(snap) : null));
  const drag = useRef<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const cam = useCamera();
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const finish = useRef<(apply: boolean) => void>(() => undefined);
  finish.current = (apply: boolean) => {
    const d = draftRef.current;
    if (apply && snap && d && editor.getElement(id)) {
      const patch = applyDraft(snap, d);
      const changed = (['x', 'y', 'w', 'h'] as const).some((k) => Math.abs(patch[k] - snap[k]) > 0.01) || JSON.stringify(patch.crop ?? null) !== JSON.stringify(snap.crop ?? null);
      if (changed) editor.update<ImageElement>(id, patch);
    }
    if (editor.getElement(id)) editor.select([id]);
    editor.closePanel(CROP_PANEL);
  };

  // Enter crop mode: hide the element and its selection frame; leave it on unmount.
  useLayoutEffect(() => {
    setCropping(id);
    editor.clearSelection();
    root.current?.focus({ preventScroll: true });
    return () => setCropping(null);
  }, [editor, id]);

  // Enter / Esc, before the board's own keys; a press anywhere else applies the crop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish.current(e.key === 'Enter');
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) finish.current(true);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  // Deleted (by anyone) or no longer an image we can crop: leave crop mode.
  useEffect(() => {
    if (!live || !snap || !draft) editor.closePanel(CROP_PANEL);
  }, [live, snap, draft, editor]);
  if (!live || !snap || !draft) return null;

  const z = cam.zoom;
  const rotation = snap.rotation || 0;
  const origin = editor.worldToScreen({ x: snap.x, y: snap.y });
  /** Screen-pixel delta → the element's local frame (unrotated, world units). */
  const toLocal = (dx: number, dy: number) => {
    const p = rot({ x: dx, y: dy }, -rotation);
    return { x: p.x / z, y: p.y / z };
  };

  const begin = (e: ReactPointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const delta = toLocal(e.clientX - d.start.x, e.clientY - d.start.y);
    setDraft((cur) => {
      if (!cur) return cur;
      if (d.kind === 'pan') return panPicture(cur, d.full, delta.x, delta.y);
      return resizeWindow(cur, d.window, d.handle, delta.x, delta.y, MIN_PX / z);
    });
  };
  const end = (e: ReactPointerEvent) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };
  const startPan = (e: ReactPointerEvent) =>
    begin(e, { kind: 'pan', start: { x: e.clientX, y: e.clientY }, full: draft.full, pointerId: e.pointerId });

  const { full: f, window: c } = draft;
  const px = (r: Rect) => ({ left: r.x * z, top: r.y * z, width: r.w * z, height: r.h * z });

  // Action bar under the crop window's on-screen bounds (above it when there's no room below).
  const center = { x: snap.w / 2, y: snap.h / 2 };
  const corners = [
    { x: c.x, y: c.y },
    { x: c.x + c.w, y: c.y },
    { x: c.x, y: c.y + c.h },
    { x: c.x + c.w, y: c.y + c.h },
  ].map((p) => {
    const r = rot({ x: p.x - center.x, y: p.y - center.y }, rotation);
    return { x: origin.x + (center.x + r.x) * z, y: origin.y + (center.y + r.y) * z };
  });
  const vp = editor.getViewportSize();
  const barX = Math.min(Math.max((Math.min(...corners.map((p) => p.x)) + Math.max(...corners.map((p) => p.x))) / 2, 150), vp.width - 150);
  const below = Math.max(...corners.map((p) => p.y)) + 14;
  const barY = below + 44 < vp.height ? below : Math.max(8, Math.min(...corners.map((p) => p.y)) - 58);

  return (
    <div ref={root} className="fr-image-crop" role="dialog" aria-label="Crop image" tabIndex={-1}>
      <div
        className="fr-image-crop__frame"
        style={{ left: origin.x, top: origin.y, width: snap.w * z, height: snap.h * z, transform: rotation ? `rotate(${rotation}deg)` : undefined }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="fr-image-crop__full" style={px(f)} onPointerDown={startPan}>
          <img src={snap.src} alt="" draggable={false} />
          <div className="fr-image-crop__hole" style={px({ x: c.x - f.x, y: c.y - f.y, w: c.w, h: c.h })} />
        </div>
        <div className="fr-image-crop__window" style={px(c)} onPointerDown={startPan}>
          <span className="fr-image-crop__thirds" aria-hidden />
          {HANDLES.map((h) => (
            <span
              key={h}
              className={`fr-image-crop__handle fr-image-crop__handle--${h}`}
              aria-hidden
              onPointerDown={(e) => begin(e, { kind: 'resize', handle: h, start: { x: e.clientX, y: e.clientY }, window: draft.window, pointerId: e.pointerId })}
            />
          ))}
        </div>
      </div>
      <div className="fr-image-crop__bar" style={{ left: barX, top: barY }}>
        <Button size="sm" variant="ghost" onClick={() => setDraft((d) => (d ? { full: d.full, window: { ...d.full } } : d))}>
          Show whole image
        </Button>
        <Button size="sm" variant="secondary" onClick={() => finish.current(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => finish.current(true)}>
          Done
        </Button>
      </div>
    </div>
  );
}
