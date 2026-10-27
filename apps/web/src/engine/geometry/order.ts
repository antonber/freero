// Reading order of board items (Tab / Shift+Tab cycling): rows top to bottom, left to right
// within a row. A box joins the current row when it starts above the middle of the row's first box.
import type { BoardElement } from '@freero/shared';
import { elementAABB } from './geometry';

export function readingOrder<T extends Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>(items: T[]): T[] {
  const boxed = items.map((item) => ({ item, r: elementAABB(item) })).sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const out: T[] = [];
  let i = 0;
  while (i < boxed.length) {
    const first = boxed[i].r;
    const rowEnd = first.y + first.h / 2;
    let j = i;
    while (j < boxed.length && boxed[j].r.y < rowEnd) j++;
    if (j === i) j = i + 1;
    out.push(...boxed.slice(i, j).sort((a, b) => a.r.x - b.r.x || a.r.y - b.r.y).map((b) => b.item));
    i = j;
  }
  return out;
}
