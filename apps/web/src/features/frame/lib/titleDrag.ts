// Dragging a frame by its title (the title sits outside the frame's bounds, so the engine's
// geometric hit-test never sees it; the title handles its own pointer events).
import type { BoardElement } from '@freero/shared';
import type { Editor } from '@engine';

const DRAG_THRESHOLD_PX = 3;

function shifted(el: BoardElement, dx: number, dy: number): Record<string, unknown> {
  const patch: Record<string, unknown> = { x: el.x + dx, y: el.y + dy };
  if (el.type === 'connector') {
    patch.start = { ...el.start, x: el.start.x + dx, y: el.start.y + dy };
    patch.end = { ...el.end, x: el.end.x + dx, y: el.end.y + dy };
    if (el.waypoints) patch.waypoints = el.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return patch;
}

export function startTitleDrag(editor: Editor, frameId: string, down: PointerEvent): void {
  const start = { x: down.clientX, y: down.clientY };
  let snapshot: BoardElement[] | null = null;

  const move = (e: PointerEvent) => {
    const sx = e.clientX - start.x;
    const sy = e.clientY - start.y;
    if (!snapshot) {
      if (Math.hypot(sx, sy) < DRAG_THRESHOLD_PX) return;
      const frame = editor.getElement(frameId);
      if (!frame) return stop();
      // The frame plus every unlocked element it contains travel together, as one undo step.
      snapshot = [frame, ...editor.getElements().filter((el) => el.frameId === frameId && !el.locked)];
      editor.beginGesture();
    }
    const zoom = editor.getCamera().zoom;
    const dx = Math.round((sx / zoom) * 100) / 100;
    const dy = Math.round((sy / zoom) * 100) / 100;
    editor.updateMany(snapshot.map((el) => ({ id: el.id, patch: shifted(el, dx, dy) })));
  };

  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    if (snapshot) editor.endGesture();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}
