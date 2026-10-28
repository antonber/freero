// "Select only ▸ Sticky notes (12)": narrow a mixed selection down to one item type.
import type { BoardElement, ElementType } from '@freero/shared';
import { elementTypeDescription, type ElementDefinition } from '@engine';

/** Every type "Select only" offers, by the name its feature gives it, in menu order. */
export function narrowableTypes(defs: ReadonlyArray<ElementDefinition<any>>): Array<{ type: ElementType; name: string }> {
  return defs.map((d) => ({ type: d.type, name: elementTypeDescription(d, d.type).many })).sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the selection holds more than one type, one of them `type`. */
export function canNarrow(selection: BoardElement[], type: ElementType): boolean {
  return selection.some((el) => el.type === type) && selection.some((el) => el.type !== type);
}

/** The selected ids of one type, in selection order. */
export const narrowTo = (selection: BoardElement[], type: ElementType): string[] =>
  selection.filter((el) => el.type === type).map((el) => el.id);
