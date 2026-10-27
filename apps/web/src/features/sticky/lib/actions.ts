// Sticky actions shared by the tool, commands and format toolbar.
import type { StickyElement } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { DEFAULT_COLOR, STICKY_GAP, STICKY_SIZE, TOOL_ID, type StickyToolOptions } from './constants';
import { nextFreeSlot } from './layout';

/** A new sticky centered on `at`, using the last chosen color. */
export function stickyAt(editor: Editor, at: Point, overrides: Partial<StickyElement> = {}): NewElement<'sticky'> {
  const color = editor.getToolOptions<StickyToolOptions>(TOOL_ID).color ?? DEFAULT_COLOR;
  const w = overrides.w ?? STICKY_SIZE;
  const h = overrides.h ?? STICKY_SIZE;
  return {
    type: 'sticky',
    color,
    text: '',
    fontFamily: 'sans',
    fontSize: 'auto',
    textColor: '#17162B',
    align: 'center',
    vAlign: 'middle',
    ...overrides,
    x: Math.round(at.x - w / 2),
    y: Math.round(at.y - h / 2),
    w,
    h,
  };
}

/** The single selected sticky, if the selection is exactly one sticky. */
export function selectedSticky(editor: Editor): StickyElement | null {
  const sel = editor.getSelection();
  if (sel.length !== 1) return null;
  const el = editor.getElement(sel[0]);
  return el?.type === 'sticky' ? el : null;
}

/**
 * Creates the next sticky beside `from` (same color, size and text style), skipping occupied
 * slots, then starts editing it — the Tab / Mod+Enter flow.
 */
export function createNextSticky(editor: Editor, from: StickyElement, dir: 'right' | 'below', copyText = false): string {
  editor.stopEditing();
  const fresh = editor.getElement<StickyElement>(from.id) ?? from;
  const probe = { x: fresh.x, y: fresh.y, w: fresh.w, h: fresh.h };
  const area = { x: probe.x - probe.w, y: probe.y - probe.h, w: probe.w * 40, h: probe.h * 40 };
  const occupied = editor.elementsInRect(area, 'intersect').filter((el) => el.id !== fresh.id && el.type !== 'frame');
  const pos = nextFreeSlot(probe, dir, occupied, STICKY_GAP);
  const { id: _id, z: _z, createdAt: _c, createdBy: _b, updatedAt: _u, groupId: _g, locked: _l, ...style } = fresh;
  // The new sticky and the text typed into it are ONE undo step, like a sticky made with the tool.
  editor.beginGesture();
  const id = editor.create<'sticky'>(
    { ...style, x: pos.x, y: pos.y, text: copyText ? fresh.text : '', rotation: fresh.rotation },
    { select: true },
  );
  if (id && !copyText) editor.startEditing(id);
  editor.endGesture();
  return id;
}
