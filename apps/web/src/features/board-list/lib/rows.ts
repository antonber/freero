// The outline (Editor.getOutline) as the rows of an ARIA tree: depth-first, children under their
// parent unless it is collapsed, each row with the words a screen reader says for it.
import type { BoardOutline, OutlineItem } from '@freero/shared';
import { describeElementType, type Editor } from '@engine';

export interface Row {
  item: OutlineItem;
  level: number;
  /** Position among its siblings (1-based) and their count: aria-posinset / aria-setsize. */
  pos: number;
  size: number;
  parent: string | null;
  hasChildren: boolean;
}

const MADE_UP: Record<string, string> = { cluster: 'Cluster', group: 'Group', column: 'Column' };

/** "Sticky note (yellow)", "Frame", "Cluster" — the kind as the board names it. */
export function kindLabel(editor: Editor, item: OutlineItem): string {
  const name = MADE_UP[item.kind] ?? describeElementType(editor, item.kind).one;
  return item.variant ? `${name} (${item.variant})` : name;
}

/** Everything a row says: kind, title, text, then its facts (votes, tags, comments, fields). */
export function rowLabel(editor: Editor, item: OutlineItem): string {
  const head = [kindLabel(editor, item), item.title].filter(Boolean).join(': ');
  const facts: string[] = [];
  if (item.fields) for (const [k, v] of Object.entries(item.fields)) facts.push(typeof v === 'boolean' ? (v ? k : `not ${k}`) : `${k} ${v}`);
  if (item.tags?.length) facts.push(`tags ${item.tags.join(', ')}`);
  if (item.votes) facts.push(`${item.votes} vote${item.votes === 1 ? '' : 's'}`);
  const threads = item.comments?.length ?? 0;
  if (threads) facts.push(`${threads} comment thread${threads === 1 ? '' : 's'}`);
  if (item.rows?.length) facts.push(`table, ${item.rows.length} rows`);
  if (item.private) facts.push('private to you');
  if (item.hidden) facts.push('hidden frame');
  if (item.withheld) facts.push('contents hidden from you');
  if (item.children?.length) facts.push(`${item.children.length} item${item.children.length === 1 ? '' : 's'}`);
  const text = item.text ? item.text.replace(/\s+/g, ' ').trim() : '';
  return [head + (text ? ` — ${text}` : ''), facts.join(', ')].filter(Boolean).join('. ');
}

export function treeRows(outline: BoardOutline, collapsed: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const walk = (items: OutlineItem[], level: number, parent: string | null) => {
    items.forEach((item, i) => {
      const hasChildren = !!item.children?.length;
      out.push({ item, level, pos: i + 1, size: items.length, parent, hasChildren });
      if (hasChildren && !collapsed.has(item.id)) walk(item.children!, level + 1, item.id);
    });
  };
  walk(outline.items, 1, null);
  return out;
}

/** Ids of the elements under an outline node (itself when it is one): what "go to" zooms to. */
export function elementIdsOf(editor: Editor, item: OutlineItem): string[] {
  if (editor.getElement(item.id)) return [item.id];
  return (item.children ?? []).flatMap((c) => elementIdsOf(editor, c));
}
