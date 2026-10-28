// "Select only ▸ Sticky notes (12)": narrow a mixed selection down to one item type.
import type { BoardElement, ElementType } from '@freero/shared';

/** How each type reads in "Select only ▸ …", in menu order. */
export const TYPE_NAMES: ReadonlyArray<[ElementType, string]> = [
  ['sticky', 'Sticky notes'],
  ['shape', 'Shapes'],
  ['text', 'Text'],
  ['card', 'Cards'],
  ['connector', 'Connectors'],
  ['pen', 'Drawings'],
  ['image', 'Images'],
  ['frame', 'Frames'],
  ['mindmap', 'Mind map topics'],
  ['table', 'Tables'],
  ['kanban', 'Kanban boards'],
  ['emoji', 'Stamps'],
  ['icon', 'Icons'],
  ['embed', 'Links'],
  ['pdf', 'PDF pages'],
];

/** True when the selection holds more than one type, one of them `type`. */
export function canNarrow(selection: BoardElement[], type: ElementType): boolean {
  return selection.some((el) => el.type === type) && selection.some((el) => el.type !== type);
}

/** The selected ids of one type, in selection order. */
export const narrowTo = (selection: BoardElement[], type: ElementType): string[] =>
  selection.filter((el) => el.type === type).map((el) => el.id);
