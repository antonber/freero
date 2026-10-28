// Editing a mixed selection (a sticky, two shapes and a text box): the style keys several of the
// selected types share, their common values, and one write that applies a change to every item
// that has the key, each through its own definition (ElementDefinition.sharedStyle /
// applySharedStyle).
import type { BoardElement } from '@freero/shared';
import type { Editor, ElementPatch, SharedStyle } from '../api';
import { MIXED, type Mixed } from '../ui/TextStyleControls';

export type SharedKey = keyof SharedStyle;

/** Each selected item's shared style (items whose type has none are left out). */
export function sharedStyles(editor: Editor, els: BoardElement[]): Array<{ el: BoardElement; style: SharedStyle }> {
  const out: Array<{ el: BoardElement; style: SharedStyle }> = [];
  for (const el of els) {
    const style = editor.getDefinition(el.type)?.sharedStyle?.(el as never);
    if (style) out.push({ el, style });
  }
  return out;
}

/**
 * The value every item that has `key` agrees on (MIXED when they differ), or null when fewer
 * than two selected items have it: then it isn't shared, and no control is shown for it.
 */
export function sharedValue<K extends SharedKey>(items: Array<{ style: SharedStyle }>, key: K): Mixed<NonNullable<SharedStyle[K]>> | null {
  const holders = items.filter((i) => i.style[key] !== undefined);
  if (holders.length < 2) return null;
  const first = holders[0].style[key]!;
  return holders.every((h) => h.style[key] === first) ? first : MIXED;
}

/**
 * Applies `style` to every unlocked item whose type has its keys, as ONE undo step: each type
 * maps it to its own fields (`applySharedStyle`; by default the field of the same name), and
 * items without the key (a text box and a fill) stay as they are.
 */
export function applySharedStyle(editor: Editor, els: BoardElement[], style: SharedStyle): void {
  const patches: Array<{ id: string; patch: ElementPatch }> = [];
  for (const { el, style: has } of sharedStyles(editor, els)) {
    if (el.locked) continue;
    const wanted: SharedStyle = {};
    for (const k of Object.keys(style) as SharedKey[]) if (has[k] !== undefined) (wanted as Record<string, unknown>)[k] = style[k];
    if (!Object.keys(wanted).length) continue;
    const def = editor.getDefinition(el.type)!;
    const patch = (def.applySharedStyle ? def.applySharedStyle(el as never, wanted) : wanted) as Record<string, unknown> | null;
    if (!patch) continue;
    const current = el as unknown as Record<string, unknown>;
    for (const k of Object.keys(patch)) if (patch[k] === current[k]) delete patch[k];
    if (Object.keys(patch).length) patches.push({ id: el.id, patch: patch as ElementPatch });
  }
  if (patches.length) editor.updateMany(patches);
}
