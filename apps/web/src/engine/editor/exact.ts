// Exact size & position ("Size and position" in the format toolbar): typed X / Y / W / H /
// rotation for the selection. Each change is one undo step; locked items never change; each
// type is resized the way its resize handles would (an image keeps its aspect ratio, a text box
// only takes a width, a mind-map topic none).
import type { BoardElement } from '@freero/shared';
import type { Editor, ElementPatch, Rect } from '../api';
import { localToWorld, rotatePoint } from '../geometry/geometry';
import { gridNudge } from '../geometry/snap';

export type ExactField = 'x' | 'y' | 'w' | 'h' | 'rotation';

const MIN = 4;

/** Which fields an element takes, by its definition. */
function capabilities(editor: Editor, el: BoardElement) {
  const def = editor.getDefinition(el.type);
  const mode = def?.resize ?? 'free';
  return {
    w: mode !== 'none',
    h: mode === 'free' || mode === 'aspect',
    rotation: mode !== 'none' && def?.rotatable !== false && def?.selectionFrame !== false,
    aspect: mode === 'aspect',
    min: def?.minSize ?? { w: MIN, h: MIN },
  };
}

/** Selected, unlocked elements that take `field`. */
export function exactTargets(editor: Editor, els: BoardElement[], field: ExactField): BoardElement[] {
  const open = els.filter((el) => !el.locked);
  if (field === 'x' || field === 'y') return open;
  return open.filter((el) => capabilities(editor, el)[field]);
}

/**
 * Where X / Y read from: one element's own box (its unrotated top-left, as stored), or the
 * bounding box of several.
 */
export function exactFrame(editor: Editor, els: BoardElement[]): Rect | null {
  if (els.length === 1) return { x: els[0].x, y: els[0].y, w: els[0].w, h: els[0].h };
  return editor.getBounds(els.map((el) => el.id));
}

/** A box resized to w × h with its own top-left corner (as drawn, rotated) staying put. */
function resizedKeepingCorner(el: BoardElement, w: number, h: number): Pick<BoardElement, 'x' | 'y' | 'w' | 'h'> {
  const corner = localToWorld(el, { x: 0, y: 0 });
  const off = rotatePoint({ x: -w / 2, y: -h / 2 }, { x: 0, y: 0 }, el.rotation || 0);
  const cx = corner.x - off.x;
  const cy = corner.y - off.y;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The patch typing `value` into W or H gives `el` (null: it doesn't take that field). */
function sizePatch(editor: Editor, el: BoardElement, field: 'w' | 'h', value: number): ElementPatch | null {
  const cap = capabilities(editor, el);
  if (!cap[field]) return null;
  let w = field === 'w' ? Math.max(cap.min.w, value) : el.w;
  let h = field === 'h' ? Math.max(cap.min.h, value) : el.h;
  if (cap.aspect && el.w > 0 && el.h > 0) {
    if (field === 'w') h = (w * el.h) / el.w;
    else w = (h * el.w) / el.h;
  }
  if (w === el.w && h === el.h) return null;
  return resizedKeepingCorner(el, w, h);
}

/**
 * Applies a typed value to the selection as ONE undo step. X / Y move the whole selection (like a
 * drag: connectors, frame contents and riders come along); W / H / rotation set each element
 * that takes them. Values land on whole pixels (rotation on tenths of a degree).
 */
export function applyExact(editor: Editor, els: BoardElement[], field: ExactField, raw: number): void {
  if (!Number.isFinite(raw)) return;
  const value = field === 'rotation' ? Math.round((((raw % 360) + 360) % 360) * 10) / 10 : Math.round(raw);
  const targets = exactTargets(editor, els, field);
  if (!targets.length) return;
  editor.beginGesture();
  try {
    if (field === 'x' || field === 'y') {
      const frame = exactFrame(editor, els);
      if (!frame) return;
      const d = value - frame[field];
      if (d) editor.moveBy(targets.map((el) => ({ id: el.id, dx: field === 'x' ? d : 0, dy: field === 'y' ? d : 0 })));
      return;
    }
    const patches: Array<{ id: string; patch: ElementPatch }> = [];
    for (const el of targets) {
      const patch = field === 'rotation' ? (el.rotation === value ? null : { rotation: value }) : sizePatch(editor, el, field, value);
      if (patch) patches.push({ id: el.id, patch });
    }
    if (patches.length) editor.updateMany(patches);
  } finally {
    editor.endGesture();
  }
}

/**
 * Alt+Shift+arrow on the canvas: the patches that grow (dir 1) or shrink (dir -1) each unlocked
 * item's width or height by one step — the next grid line with "Snap to grid" on, else 10 px —
 * the way its handles would (aspect kept, width-only types take widths only), its top-left corner
 * staying put. The caller writes them (the keyboard joins them to its nudge burst's undo step).
 */
export function keyResizePatches(editor: Editor, els: BoardElement[], field: 'w' | 'h', dir: -1 | 1): Array<{ id: string; patch: ElementPatch }> {
  const s = editor.getSettings();
  const out: Array<{ id: string; patch: ElementPatch }> = [];
  for (const el of exactTargets(editor, els, field)) {
    const current = el[field];
    const value = s.snapToGrid ? current + gridNudge(current, dir, s.gridSize, 1) : current + dir * 10;
    const patch = sizePatch(editor, el, field, value);
    if (patch) out.push({ id: el.id, patch });
  }
  return out;
}

/**
 * The value one arrow-key step from `current` reaches. With "Snap to grid" on, sizes and
 * positions step to the next grid line (an off-grid value lands on the grid first) and Shift
 * steps five lines; otherwise 1 px (Shift 10). Rotation steps 1° (Shift 15°).
 */
export function stepExact(editor: Editor, field: ExactField, current: number, dir: -1 | 1, big: boolean): number {
  if (field === 'rotation') return current + dir * (big ? 15 : 1);
  const s = editor.getSettings();
  if (s.snapToGrid) return current + gridNudge(current, dir, s.gridSize, big ? 5 : 1);
  return current + dir * (big ? 10 : 1);
}
