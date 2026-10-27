// "Select all like this": same type, same colour, same tag as anything in the selection.
import { STICKY_COLORS, type BoardElement } from '@freero/shared';

const norm = (c: unknown): string | null =>
  typeof c === 'string' && c && c !== 'transparent' ? c.trim().toLowerCase() : null;

/** The colour a person would name for an item (a sticky's paper, a shape's fill, a line's ink…). */
export function colourOf(el: BoardElement): string | null {
  switch (el.type) {
    case 'sticky':
      return norm(STICKY_COLORS[el.color] ?? el.color);
    case 'shape':
      return norm(el.fill) ?? norm(el.stroke);
    case 'card':
    case 'mindmap':
      return norm(el.color);
    case 'pen':
    case 'connector':
      return norm(el.stroke);
    case 'text':
      return norm(el.textColor);
    case 'frame':
      return norm(el.fill);
    default:
      return null;
  }
}

export const tagsOf = (el: BoardElement): string[] => {
  const t = (el as { tags?: unknown }).tags;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
};

export type Similarity = 'type' | 'colour' | 'tag';

/** Ids on the board that share `by` with at least one selected element (the selection included). */
export function similarIds(board: BoardElement[], selection: BoardElement[], by: Similarity): string[] {
  if (by === 'type') {
    const types = new Set(selection.map((el) => el.type));
    return board.filter((el) => types.has(el.type)).map((el) => el.id);
  }
  if (by === 'colour') {
    // Colour is compared within a type: a yellow sticky and yellow text ink are different things.
    const keys = new Set(selection.map((el) => `${el.type}:${colourOf(el)}`).filter((k) => !k.endsWith(':null')));
    return board.filter((el) => keys.has(`${el.type}:${colourOf(el)}`)).map((el) => el.id);
  }
  const tags = new Set(selection.flatMap(tagsOf));
  return board.filter((el) => tagsOf(el).some((t) => tags.has(t))).map((el) => el.id);
}
