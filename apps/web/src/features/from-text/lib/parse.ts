// What people paste into "Insert from text", read as a structure (pure, unit-tested). The layout
// itself is @freero/shared's `layoutStructure`, the one the server runs for insert-structure.
import { LayoutError, looksLikeMermaid, parseIndentedList, parseOrgRows, type OutlineNodeInput, type StructureInput } from '@freero/shared';

export type TextKind = 'mindmap' | 'tree' | 'orgchart' | 'mermaid' | 'kanban' | 'stickies' | 'table';

export const KINDS: Array<{ value: TextKind; label: string; noun: string; hint: string; placeholder: string }> = [
  {
    value: 'mindmap',
    noun: 'Mind map',
    label: 'Mind map',
    hint: 'An indented list: the first line is the central topic, each indent a level deeper.',
    placeholder: 'Launch plan\n  Marketing\n    Blog post\n    Webinar\n  Product\n    Private beta',
  },
  {
    value: 'mermaid',
    noun: 'Diagram',
    label: 'Mermaid',
    hint: 'A flowchart, sequence diagram or mind map in Mermaid syntax. Edit the source later to update the diagram.',
    placeholder: 'flowchart TD\n  A[Request] --> B{Approved?}\n  B -- yes --> C([Ship it])\n  B -- no --> D[Revise]\n  D --> A',
  },
  {
    value: 'tree',
    noun: 'Tree',
    label: 'Tree',
    hint: 'An indented list drawn as boxes, top-down, joined by lines.',
    placeholder: 'Website\n  Products\n    Pricing\n  About\n    Team\n    Careers',
  },
  {
    value: 'orgchart',
    noun: 'Org chart',
    label: 'Org chart',
    hint: 'One person per line: Name, Title, Manager (comma- or tab-separated). No manager = top of the chart.',
    placeholder: 'Name, Title, Manager\nMaria Lopez, CEO,\nAnn Kim, CTO, Maria Lopez\nBo Chen, CFO, Maria Lopez\nCy Park, Engineer, Ann Kim',
  },
  {
    value: 'kanban',
    noun: 'Kanban board',
    label: 'Kanban',
    hint: 'Column titles, each with its cards indented below. "To do", "In progress" and "Done" columns set the cards’ status.',
    placeholder: 'To do\n  Write the brief\n  Book the venue\nIn progress\n  Draft agenda\nDone\n  Pick a date',
  },
  {
    value: 'stickies',
    noun: 'Sticky notes',
    label: 'Sticky notes',
    hint: 'One sticky note per line (bullets and numbers are dropped).',
    placeholder: '- Faster onboarding\n- Dark mode\n- Offline drafts',
  },
  {
    value: 'table',
    noun: 'Table',
    label: 'Table',
    hint: 'Rows of cells: a Markdown table, or tab- or comma-separated lines. The first row is the header.',
    placeholder: '| Risk | Owner | Status |\n| --- | --- | --- |\n| Data loss | Ann | Open |\n| Slow sync | Bo | Fixed |',
  },
];

export const kindLabel = (k: TextKind) => KINDS.find((x) => x.value === k)?.label ?? k;

const LIST_PREFIX = /^(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+/;

/** Text that starts with a Mermaid diagram header (`flowchart`, `graph`, `sequenceDiagram`, `mindmap`). */
export const isMermaid = (text: string) => looksLikeMermaid(text);

const lines = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim());

/** Markdown table, tabs, or a consistent CSV → rows of cells; null when it isn't one. */
export function parseRows(text: string): string[][] | null {
  const ls = lines(text).map((l) => l.trim());
  if (!ls.length) return null;
  if (ls.every((l) => l.startsWith('|'))) {
    return ls
      .filter((l) => !/^\|[\s:|-]+\|?$/.test(l))
      .map((l) =>
        l
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim()),
      );
  }
  if (ls.some((l) => l.includes('\t'))) return ls.map((l) => l.split('\t').map((c) => c.trim()));
  const csv = ls.map((l) => l.split(',').map((c) => c.trim()));
  if (csv.length >= 2 && csv[0].length >= 2 && csv.every((r) => r.length === csv[0].length)) return csv;
  return null;
}

/** The kind of text this most likely is (what the dialog picks when text is pasted into it). */
export function detectKind(text: string): TextKind | null {
  if (!text.trim()) return null;
  if (isMermaid(text)) return 'mermaid';
  const ls = lines(text);
  const t = ls.map((l) => l.trim());
  if (t.length >= 2 && t.every((l) => l.startsWith('|'))) return 'table';
  if (/^name\s*[,\t]\s*(title|role)\s*[,\t]\s*(manager|reports to)/i.test(t[0] ?? '')) return 'orgchart';
  if (parseRows(text) && !ls.some((l) => /^\s/.test(l))) return 'table';
  const indents = new Set(ls.map((l) => l.replace(/\t/g, '  ').length - l.replace(/\t/g, '  ').trimStart().length));
  if (indents.size >= 2) return 'mindmap';
  return ls.length >= 1 ? 'stickies' : null;
}

/** The structure `text` describes as `kind`; throws a LayoutError naming what is wrong. */
export function toStructure(kind: TextKind, text: string): StructureInput {
  if (!text.trim()) throw new LayoutError('Type or paste something first');
  switch (kind) {
    case 'mindmap':
      return { kind: 'outline', text, as: 'mindmap' };
    case 'tree':
      return { kind: 'outline', text, as: 'tree' };
    case 'mermaid':
      return { kind: 'mermaid', source: text };
    case 'orgchart':
      return { kind: 'orgchart', people: parseOrgRows(text) };
    case 'kanban': {
      const roots = parseIndentedList(text);
      if (!roots.some((r) => r.children?.length)) throw new LayoutError('Indent each card under its column title');
      // Deeper lines are cards too (a kanban has no sub-cards), in reading order.
      const flat = (n: OutlineNodeInput): string[] => (n.children ?? []).flatMap((c) => [c.text, ...flat(c)]);
      return { kind: 'kanban', columns: roots.map((r) => ({ title: r.text, items: flat(r) })) };
    }
    case 'stickies': {
      const items = lines(text)
        .map((l) => l.trim().replace(LIST_PREFIX, '').trim())
        .filter(Boolean);
      return { kind: 'stickies', items };
    }
    case 'table': {
      const rows = parseRows(text) ?? lines(text).map((l) => [l.trim()]);
      return { kind: 'table', rows, header: true };
    }
  }
}

/** Kinds whose inserted diagram keeps its source, so it can be edited and laid out again. */
export const EDITABLE: ReadonlySet<TextKind> = new Set(['mermaid', 'tree', 'orgchart', 'mindmap']);
