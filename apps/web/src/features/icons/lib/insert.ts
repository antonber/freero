import { cleanViewBox, ICON_LIMITS, type IconNode } from '@freero/shared';
import type { Editor, Point } from '@engine';
import { cleanNodes } from './nodes';

export const LIBRARY_PANEL = 'icons.library';
export const ICON_SIZE = 96;
export const DEFAULT_COLOR = '#1f1a33';
export const DEFAULT_STROKE = 2;
/** Marker for dragging an icon from the library onto the canvas (the drop arrives as text). */
export const DRAG_PREFIX = 'freero-icon:';

/** An icon to place: a library one (lucide line art) or one from a workspace's shape pack (#4). */
export interface PlaceableIcon {
  name: string;
  nodes: IconNode[];
  viewBox?: string;
  art?: 'mono' | 'color';
}

/** The box an icon takes: ICON_SIZE on its longer side, in its drawing's proportions. */
export function iconBox(icon: Pick<PlaceableIcon, 'viewBox'>): { w: number; h: number } {
  const vb = cleanViewBox(icon.viewBox)?.split(' ').map(Number);
  if (!vb) return { w: ICON_SIZE, h: ICON_SIZE };
  const k = ICON_SIZE / Math.max(vb[2], vb[3]);
  return { w: Math.max(12, Math.round(vb[2] * k)), h: Math.max(12, Math.round(vb[3] * k)) };
}

/** The drawing of `icon` as an element keeps it (everything checked again). */
function drawingOf(icon: PlaceableIcon): Pick<PlaceableIcon, 'nodes' | 'viewBox' | 'art'> | null {
  const nodes = cleanNodes(icon.nodes);
  if (!nodes.length) return null;
  const art = icon.art === 'mono' || icon.art === 'color' ? icon.art : undefined;
  const viewBox = art ? (cleanViewBox(icon.viewBox) ?? undefined) : undefined;
  return { nodes, ...(art ? { art } : {}), ...(viewBox ? { viewBox } : {}) };
}

/** Places an icon: centered on `at`, or in a free spot near the middle of the view. */
export function insertIcon(editor: Editor, icon: PlaceableIcon, at?: Point): string | null {
  const drawing = drawingOf(icon);
  if (!drawing || !editor.can('editor')) return null;
  const { w, h } = iconBox(drawing);
  const pos = at ? { x: at.x - w / 2, y: at.y - h / 2 } : editor.findFreeSpot({ w, h }, { gap: 24 });
  return editor.create<'icon'>(
    { type: 'icon', ...pos, w, h, name: icon.name.slice(0, ICON_LIMITS.name), ...drawing, color: DEFAULT_COLOR, strokeWidth: DEFAULT_STROKE },
    { select: true },
  );
}

export const dragPayload = (icon: PlaceableIcon) =>
  DRAG_PREFIX + JSON.stringify({ name: icon.name, nodes: icon.nodes, ...(icon.viewBox ? { viewBox: icon.viewBox } : {}), ...(icon.art ? { art: icon.art } : {}) });

/** The icon in a drop's text, if it came from the library. */
export function parseDragPayload(text: string | null): PlaceableIcon | null {
  if (!text?.startsWith(DRAG_PREFIX)) return null;
  try {
    const v = JSON.parse(text.slice(DRAG_PREFIX.length)) as { name?: unknown; nodes?: unknown; viewBox?: unknown; art?: unknown };
    const drawing = drawingOf({ name: '', nodes: v.nodes as IconNode[], viewBox: typeof v.viewBox === 'string' ? v.viewBox : undefined, art: v.art as PlaceableIcon['art'] });
    return typeof v.name === 'string' && drawing ? { name: v.name.slice(0, ICON_LIMITS.name), ...drawing } : null;
  } catch {
    return null;
  }
}
