// How an item type reads in lists and menus: the defining feature's `label` / `icon`, with one
// fallback for types that declare none, so Layers, Find and "Select only" never disagree.
import { Square } from 'lucide-react';
import type { Editor, ElementDefinition, ElementLabel, IconComponent } from '../api';

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
