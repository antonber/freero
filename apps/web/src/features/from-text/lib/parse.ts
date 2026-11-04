// What people paste into "Insert from text", read as a structure (pure, unit-tested). The layout
// itself is @freero/shared's `layoutStructure`, the one the server runs for insert-structure.
import { LayoutError, looksLikeMermaid, looksLikePlantUml, parseIndentedList, parseOrgRows, type OutlineNodeInput, type StructureInput } from '@freero/shared';

import { t as tr } from '../messages';
export type TextKind = 'mindmap' | 'tree' | 'orgchart' | 'mermaid' | 'plantuml' | 'kanban' | 'stickies' | 'table';

export const KINDS: Array<{ value: TextKind; label: string; noun: string; hint: string; placeholder: string }> = [
  {
    value: 'mindmap',
    noun: tr('mindMap'),
    label: tr('mindMap'),
    hint: tr('anIndentedListTheFirst'),
    placeholder: tr('launchPlanMarketingBlogPost'),
  },
  {
    value: 'mermaid',
    noun: tr('diagram'),
    label: 'Mermaid',
    hint: tr('aFlowchartASequenceClass'),
    placeholder: 'flowchart TD\n  A[Request] --> B{Approved?}\n  B -- yes --> C([Ship it])\n  B -- no --> D[Revise]\n  D --> A',
  },
  {
    value: 'plantuml',
    noun: tr('diagram'),
    label: tr('plantuml'),
    hint: tr('aSequenceClassActivityState'),
    placeholder: '@startuml\nactor Customer\nparticipant Shop\nCustomer -> Shop : Place order\nShop --> Customer : Confirmation\n@enduml',
  },
  {
    value: 'tree',
    noun: tr('tree'),
    label: tr('tree'),
    hint: tr('anIndentedListDrawnAs'),
    placeholder: tr('websiteProductsPricingAboutTeam'),
  },
  {
    value: 'orgchart',
    noun: tr('orgChart'),
    label: tr('orgChart'),
    hint: 'One person per line: Name, Title, Manager (comma- or tab-separated). No manager = top of the chart.',
    placeholder: tr('nameTitleManagerMariaLopez'),
  },
  {
    value: 'kanban',
    noun: tr('kanbanBoard'),
    label: tr('kanban'),
    hint: tr('columnTitlesEachWithIts'),
    placeholder: tr('toDoWriteTheBrief'),
  },
  {
    value: 'stickies',
    noun: tr('stickyNotes'),
    label: tr('stickyNotes'),
    hint: tr('oneStickyNotePerLine'),
    placeholder: tr('fasterOnboardingDarkModeOffline'),
  },
  {
    value: 'table',
    noun: tr('table'),
    label: tr('table'),
    hint: tr('rowsOfCellsAMarkdown'),
    placeholder: tr('riskOwnerStatusDataLoss'),
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
  if (looksLikePlantUml(text)) return 'plantuml';
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
    case 'plantuml':
      return { kind: 'plantuml', source: text };
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
export const EDITABLE: ReadonlySet<TextKind> = new Set(['mermaid', 'plantuml', 'tree', 'orgchart', 'mindmap']);
