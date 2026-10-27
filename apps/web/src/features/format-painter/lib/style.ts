// Format painter: what "style" means per item type, and how a style carries over to another type.
import { STICKY_COLORS, type BoardElement, type ElementType, type StickyColor } from '@freero/shared';
import type { Editor, ElementPatch } from '@engine';

export const TOOL_ID = 'format-painter';

/** Fields that are look, not content or layout. Only these are ever copied. */
const STYLE_KEYS = [
  'color',
  'fill',
  'fillOpacity',
  'stroke',
  'strokeWidth',
  'strokeStyle',
  'fontFamily',
  'fontSize',
  'textColor',
  'align',
  'vAlign',
  'background',
  'startCap',
  'endCap',
  'routing',
] as const;

export interface CopiedStyle {
  type: ElementType;
  fields: Record<string, unknown>;
  /** The item's main colour as a css color (a sticky's paper, a shape's fill…), for other types. */
  paint: string | null;
}

const hex = (c: unknown): string | null => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

/** The main colour of an item, as a css hex color (null when it has none or it's transparent). */
function paintOf(el: BoardElement): string | null {
  switch (el.type) {
    case 'sticky':
      return hex(STICKY_COLORS[el.color]);
    case 'shape':
      return hex(el.fill);
    case 'card':
    case 'mindmap':
      return hex(el.color);
    case 'frame':
      return hex(el.fill);
    default:
      return null;
  }
}

/** The sticky paper closest to a css hex color. */
export function nearestStickyColor(c: string): StickyColor {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(c);
  let best: StickyColor = 'yellow';
  let bestD = Infinity;
  for (const [name, value] of Object.entries(STICKY_COLORS) as Array<[StickyColor, string]>) {
    const [r2, g2, b2] = rgb(value);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export function copyStyle(el: BoardElement): CopiedStyle {
  const src = el as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) if (src[k] !== undefined) fields[k] = src[k];
  return { type: el.type, fields, paint: paintOf(el) };
}

/**
 * The patch that gives `target` the copied style. Same type: every style field. Another type:
 * the fields it has too, when the value fits (a sticky's 'auto' font size never lands on a text
 * box, which needs a number), plus the main colour mapped into its palette (a blue shape's fill
 * paints a sticky the closest sticky blue). `defaults` = the target type's defaults().
 */
export function stylePatch(style: CopiedStyle, target: BoardElement, defaults: Record<string, unknown>): ElementPatch {
  const cur = target as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const same = style.type === target.type;
  for (const [k, v] of Object.entries(style.fields)) {
    if (same) {
      patch[k] = v;
      continue;
    }
    if (k === 'color' || k === 'fill' || !(k in defaults)) continue; // colours go through `paint`
    const d = defaults[k];
    const fits = typeof v === typeof d || (k === 'fontSize' && d === 'auto' && typeof v === 'number');
    if (fits) patch[k] = v;
  }
  if (!same && style.paint) {
    if (target.type === 'sticky') patch.color = nearestStickyColor(style.paint);
    else if (target.type === 'shape' || target.type === 'frame') patch.fill = style.paint;
    else if (target.type === 'card' || target.type === 'mindmap') patch.color = style.paint;
  }
  for (const k of Object.keys(patch)) if (patch[k] === cur[k]) delete patch[k];
  return patch as ElementPatch;
}

// ---------------------------------------------------------------- editor glue
export const storedStyle = (editor: Editor): CopiedStyle | null =>
  editor.getToolOptions<{ style?: CopiedStyle }>(TOOL_ID).style ?? null;

/** Picks up the style of the single selected item. False (with a hint) when there isn't one. */
export function pickUp(editor: Editor): boolean {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  if (!el) {
    editor.host.notify('Select one item to copy its style.', 'info');
    return false;
  }
  editor.setToolOptions(TOOL_ID, { style: copyStyle(el) });
  return true;
}

/** Applies the picked-up style to `ids` (locked items are skipped). Returns how many changed. */
export function applyStyle(editor: Editor, ids: string[]): number {
  const style = storedStyle(editor);
  if (!style) return 0;
  const patches: Array<{ id: string; patch: ElementPatch }> = [];
  for (const id of ids) {
    const el = editor.getElement(id);
    if (!el || el.locked) continue;
    const defaults = (editor.getDefinition(el.type)?.defaults() ?? {}) as Record<string, unknown>;
    const patch = stylePatch(style, el, defaults);
    if (Object.keys(patch).length) patches.push({ id, patch });
  }
  editor.updateMany(patches);
  return patches.length;
}
