// How an item type reads in lists and menus: the defining feature's `label` / `icon`, with one
// fallback for types that declare none, so Layers, Find and "Select only" never disagree.
import { Square } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import type { Editor, ElementDefinition, ElementLabel, IconComponent } from '../api';
import { richTextToPlain } from '../text/sanitize';

export interface ElementTypeDescription extends ElementLabel {
  icon: IconComponent;
}

/** The name and icon a definition declares (`label` / `icon`), or the fallback for `type`. */
export function elementTypeDescription(def: ElementDefinition<any> | undefined, type: string): ElementTypeDescription {
  const fallback = type.charAt(0).toUpperCase() + type.slice(1);
  return { one: def?.label?.one ?? fallback, many: def?.label?.many ?? fallback, icon: def?.icon ?? Square };
}

/** The name and icon of an element type on this board. */
export const describeElementType = (editor: Pick<Editor, 'getDefinition'>, type: string): ElementTypeDescription =>
  elementTypeDescription(editor.getDefinition(type as never), type);

/** Longest text an item's spoken description carries (the rest is "…"). */
const SPOKEN_TEXT_MAX = 160;

/**
 * How assistive tech reads an item (the live region, the canvas' keyboard walk): its type name and
 * what it says — the definition's `toPlainText`, else its text field, else a title — e.g.
 * "Sticky note: Ship on Friday". So a new type is spoken correctly by defining those, nothing more.
 */
export function describeElement(editor: Editor, el: BoardElement): string {
  const def = editor.getDefinition(el.type as never) as ElementDefinition<any> | undefined;
  const type = elementTypeDescription(def, el.type).one;
  const rec = el as unknown as Record<string, unknown>;
  let text = '';
  try {
    const field = def?.textField;
    text = def?.toPlainText
      ? def.toPlainText(el as never, editor)
      : field
        ? richTextToPlain(String(rec[field] ?? ''))
        : typeof rec.title === 'string'
          ? rec.title
          : '';
  } catch {
    // Content kept outside the element (a table's cells) may not have arrived yet.
  }
  text = (text ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > SPOKEN_TEXT_MAX) text = `${text.slice(0, SPOKEN_TEXT_MAX - 1)}…`;
  return `${type}${text ? `: ${text}` : ''}${el.locked ? ' (locked)' : ''}`;
}
