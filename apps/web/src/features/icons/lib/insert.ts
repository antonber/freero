import type { IconNode } from '@freero/shared';
import type { Editor, Point } from '@engine';
import { cleanNodes } from './nodes';

export const LIBRARY_PANEL = 'icons.library';
export const ICON_SIZE = 96;
export const DEFAULT_COLOR = '#1f1a33';
export const DEFAULT_STROKE = 2;
/** Marker for dragging an icon from the library onto the canvas (the drop arrives as text). */
export const DRAG_PREFIX = 'freero-icon:';

/** Places an icon: centered on `at`, or in a free spot near the middle of the view. */
export function insertIcon(editor: Editor, icon: { name: string; nodes: IconNode[] }, at?: Point): string | null {
  const nodes = cleanNodes(icon.nodes);
  if (!nodes.length || !editor.can('editor')) return null;
  const pos = at ? { x: at.x - ICON_SIZE / 2, y: at.y - ICON_SIZE / 2 } : editor.findFreeSpot({ w: ICON_SIZE, h: ICON_SIZE }, { gap: 24 });
  return editor.create<'icon'>(
    { type: 'icon', ...pos, w: ICON_SIZE, h: ICON_SIZE, name: icon.name, nodes, color: DEFAULT_COLOR, strokeWidth: DEFAULT_STROKE },
    { select: true },
  );
}

export const dragPayload = (icon: { name: string; nodes: IconNode[] }) => DRAG_PREFIX + JSON.stringify({ name: icon.name, nodes: icon.nodes });

/** The icon in a drop's text, if it came from the library. */
export function parseDragPayload(text: string | null): { name: string; nodes: IconNode[] } | null {
  if (!text?.startsWith(DRAG_PREFIX)) return null;
  try {
    const v = JSON.parse(text.slice(DRAG_PREFIX.length)) as { name?: unknown; nodes?: unknown };
    const nodes = cleanNodes(v.nodes);
    return typeof v.name === 'string' && nodes.length ? { name: v.name.slice(0, 64), nodes } : null;
  } catch {
    return null;
  }
}
