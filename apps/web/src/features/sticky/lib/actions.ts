// Sticky actions shared by the tool, commands and format toolbar.
import type { StickyElement } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { STICKY_INK } from '@freero/shared';
import { DEFAULT_COLOR, STICKY_GAP, TOOL_ID, stickyDims, stickyPreset, toolDims, type StickyShape, type StickySize, type StickyToolOptions } from './constants';
import { nextFreeSlot, type Direction } from './layout';

/** A new sticky centered on `at`, using the last chosen color, shape and size. */
export function stickyAt(editor: Editor, at: Point, overrides: Partial<StickyElement> = {}): NewElement<'sticky'> {
  const opts = editor.getToolOptions<StickyToolOptions>(TOOL_ID);
  const color = opts.color ?? DEFAULT_COLOR;
  const dims = toolDims(opts);
  const w = overrides.w ?? dims.w;
  const h = overrides.h ?? dims.h;
  return {
    type: 'sticky',
    color,
    text: '',
    fontFamily: 'sans',
    fontSize: 'auto',
    textColor: STICKY_INK,
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
export function createNextSticky(editor: Editor, from: StickyElement, dir: Direction, copyText = false): string {
  editor.stopEditing();
  const fresh = editor.getElement<StickyElement>(from.id) ?? from;
  const probe = { x: fresh.x, y: fresh.y, w: fresh.w, h: fresh.h };
  const reach = 41;
  const area = { x: probe.x - probe.w * reach, y: probe.y - probe.h * reach, w: probe.w * reach * 2, h: probe.h * reach * 2 };
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

/**
 * Gives `stickies` a preset shape and/or size, each keeping its center (a note grows in place
 * rather than off to one side). A sticky resized freely takes the medium size when only the shape
 * is chosen. One undo step; locked stickies stay as they are.
 */
export function setStickyBox(editor: Editor, stickies: StickyElement[], pick: { shape?: StickyShape; size?: StickySize }): void {
  const patches: Array<{ id: string; patch: Partial<StickyElement> }> = [];
  for (const s of stickies) {
    if (s.locked) continue;
    const now = stickyPreset(s);
    const { w, h } = stickyDims(pick.shape ?? now.shape, pick.size ?? now.size ?? 'm');
    if (w === s.w && h === s.h) continue;
    patches.push({ id: s.id, patch: { x: Math.round(s.x + (s.w - w) / 2), y: Math.round(s.y + (s.h - h) / 2), w, h } });
  }
  if (patches.length) editor.updateMany(patches);
}
