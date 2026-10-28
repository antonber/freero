// Mind maps as indented outlines, both ways (pure, unit-tested): a map copies as a Markdown list
// (two spaces per level), and pasted text that is an outline — at least two levels of
// indentation — becomes a map. A flat list is left to the sticky notes' paste rule.
import { parseIndentedList, richTextToPlain, type OutlineNodeInput } from '@freero/shared';
import { sideOf, type MindNode, type TreeIndex } from './tree';

/** Most items one pasted outline may hold. */
export const MAX_OUTLINE_ITEMS = 500;

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/**
 * First-level branches in the order a pasted outline would put them back on the same sides: a
 * 'both' map alternates right, left, right … when it is built (`rebalance`), so its branches are
 * listed right[0], left[0], right[1] … — copy, paste and the map comes back the same.
 */
function firstLevel(index: TreeIndex, root: MindNode): MindNode[] {
  const kids = index.kids.get(root.id) ?? [];
  if (root.direction !== 'both') return kids;
  const right = kids.filter((k) => sideOf(k, root) === 'right');
  const left = kids.filter((k) => sideOf(k, root) === 'left');
  const out: MindNode[] = [];
  for (let i = 0; i < Math.max(right.length, left.length); i++) {
    if (right[i]) out.push(right[i]);
    if (left[i]) out.push(left[i]);
  }
  return out;
}

export interface OutlineText {
  /** Markdown bullets, two spaces per level (also what plain-text editors show). */
  text: string;
  /** Nested lists, for documents that paste HTML. */
  html: string;
}

/** The maps rooted at `rootIds` as one outline (collapsed branches included). */
export function mapsToOutline(index: TreeIndex, rootIds: string[], textOf: (id: string) => string): OutlineText {
  const lines: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const seen = new Set<string>();
  const html = (n: MindNode, depth: number, kids: MindNode[]): string => {
    if (seen.has(n.id)) return '';
    seen.add(n.id);
    const label = oneLine(richTextToPlain(textOf(n.id)));
    lines.push(`${'  '.repeat(depth)}- ${label}`);
    const inner = kids.map((k) => html(k, depth + 1, index.kids.get(k.id) ?? [])).join('');
    return `<li>${esc(label)}${inner ? `<ul>${inner}</ul>` : ''}</li>`;
  };
  const parts: string[] = [];
  for (const id of rootIds) {
    const root = index.byId.get(id);
    if (root) parts.push(`<ul>${html(root, 0, firstLevel(index, root))}</ul>`);
  }
  return { text: lines.join('\n'), html: parts.join('') };
}

/** Code is indented too: lines ending like statements or blocks don't read as an outline. */
const CODE_LINE = /[{};]\s*$|^\s*[})\]]/;

/**
 * The outline pasted `text` holds, or null when it isn't one: two or more lines, at least two
 * levels of indentation (spaces, tabs, bullets or numbers), tabs only as indentation (otherwise
 * it is spreadsheet cells), and not code.
 */
export function outlineFromPaste(text: string | null): OutlineNodeInput[] | null {
  if (!text) return null;
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length < 2) return null;
  if (lines.some((l) => l.trimStart().includes('\t'))) return null;
  const indents = lines.map((l) => l.replace(/\t/g, '  ').length - l.replace(/\t/g, '  ').trimStart().length);
  if (new Set(indents).size < 2 || indents[0] !== Math.min(...indents)) return null;
  if (lines.filter((l) => CODE_LINE.test(l)).length * 4 > lines.length) return null;
  const roots = parseIndentedList(lines.join('\n'));
  let count = 0;
  const walk = (n: OutlineNodeInput) => {
    count++;
    n.children?.forEach(walk);
  };
  roots.forEach(walk);
  return roots.length && count <= MAX_OUTLINE_ITEMS ? roots : null;
}
