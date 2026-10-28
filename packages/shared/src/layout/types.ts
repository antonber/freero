// Layout from structure (KAI-167): callers say WHAT (an outline, a list, clusters, a graph, a
// Mermaid diagram, a table) and the layout says WHERE, so agents and AI never pick coordinates.
// Pure and deterministic (ids come from the caller's generator), so the server and the web
// produce the same elements for the same input.
import type { BoardElement, ShapeKind, StickyColor, TableCopyContent } from '../elements';

/** A new element before it is written: the writer stamps stacking, author and times. */
export type ElementDraft = BoardElement extends infer E
  ? E extends BoardElement
    ? Omit<E, 'z' | 'createdBy' | 'createdAt' | 'updatedAt'>
    : never
  : never;

export interface OutlineNodeInput {
  text: string;
  children?: OutlineNodeInput[];
  /**
   * [additive] A stable name for the item (a Mermaid mind-map node id), so a re-layout of edited
   * source finds the same item again (`LaidOut.keys`). Default: its path of texts.
   */
  id?: string;
}

/** [additive] A person in an org chart; `manager` names another person's `id` (or `name`). */
export interface OrgPersonInput {
  name: string;
  title?: string;
  manager?: string | null;
  id?: string;
}

/** [additive] A kanban column and the cards in it, top to bottom. */
export interface KanbanColumnInput {
  title: string;
  items: string[];
}

export interface GraphNodeInput {
  id: string;
  text: string;
  shape?: ShapeKind;
}

export interface GraphEdgeInput {
  from: string;
  to: string;
  label?: string;
  /** Line style (Mermaid: -.-> dotted, ==> thick). */
  style?: 'solid' | 'dashed' | 'thick';
  arrow?: 'forward' | 'both' | 'none';
}

/** A named box around some nodes (Mermaid subgraph): becomes a frame holding them. */
export interface GraphGroupInput {
  id: string;
  title: string;
  /** Node ids directly in this group. */
  nodes: string[];
  /** Enclosing group id. */
  parent?: string | null;
}

export type Direction = 'TB' | 'BT' | 'LR' | 'RL';

export interface SequenceInput {
  title?: string;
  participants: Array<{ id: string; label: string; actor?: boolean }>;
  steps: Array<
    | { kind: 'message'; from: string; to: string; text: string; dashed?: boolean; arrow?: 'arrow' | 'open' | 'cross' | 'none' }
    | { kind: 'note'; over: string[]; side?: 'left' | 'right' | 'over'; text: string }
  >;
}

export type StructureInput =
  /** Nested items → a mind map (root in the middle of its branches). */
  | { kind: 'mindmap'; root: OutlineNodeInput }
  /** Nested items → a top-down tree of boxes joined by connectors (org chart). */
  | { kind: 'tree'; root: OutlineNodeInput; direction?: Direction }
  /** An indented list (Markdown bullets or plain indentation) → mind map or tree. */
  | { kind: 'outline'; text: string; as?: 'mindmap' | 'tree' }
  /** A list → a grid of stickies, optionally under a title. */
  | { kind: 'stickies'; items: string[]; title?: string; color?: StickyColor }
  /**
   * Named groups → affinity clusters side by side. An item is new text (a new sticky) or
   * `{ id }` of a sticky already on the board, which is moved into its cluster.
   */
  | { kind: 'clusters'; clusters: Array<{ title?: string; color?: StickyColor; items: Array<string | { id: string }> }> }
  /** Nodes and edges → a layered diagram (shapes + attached connectors). */
  | { kind: 'graph'; nodes: GraphNodeInput[]; edges: GraphEdgeInput[]; direction?: Direction; groups?: GraphGroupInput[] }
  /** Mermaid flowchart (subgraphs become frames) or sequence diagram. */
  | { kind: 'mermaid'; source: string }
  | { kind: 'sequence'; diagram: SequenceInput }
  /** Rows of cells → a table (first row the header unless `header: false`). */
  | { kind: 'table'; rows: string[][]; header?: boolean }
  /**
   * [additive] A written note (a summary): a soft rounded card (a shape) with the title in bold and
   * the text's paragraphs and bullet lines kept.
   */
  | { kind: 'note'; title?: string; text: string }
  /** [additive] Columns of task cards → a kanban board (column titles like "To do" / "Done" set card status). */
  | { kind: 'kanban'; title?: string; columns: KanbanColumnInput[] }
  /** [additive] People and their managers → an org chart (a top-down tree of name / title boxes). */
  | { kind: 'orgchart'; people: OrgPersonInput[] };

/** What a layout produced, relative to its own top-left (0, 0). */
export interface LaidOut {
  elements: ElementDraft[];
  /** Content kept outside elements, by element id (table cells: TableCopyContent). */
  content: Record<string, TableCopyContent>;
  /** Existing elements moved into the result (their new top-left). */
  moves: Array<{ id: string; x: number; y: number }>;
  size: { w: number; h: number };
  /**
   * [additive] Element id → the source item it stands for (`n:<node id>`, `e:<from>><to>#<k>`,
   * `g:<group id>`, `t:<path of texts>` …): how a re-layout of edited source keeps the elements it
   * already made (diagrams as code). Kinds without lasting identity (stickies, tables) leave it out.
   */
  keys?: Record<string, string>;
}

/** What the layout may ask about the board (existing stickies to move into clusters). */
export interface LayoutContext {
  newId: () => string;
  existing?: (id: string) => { type: string; w: number; h: number } | undefined;
}

export class LayoutError extends Error {}

/** Limits that keep one request bounded (clamped or rejected with a LayoutError). */
export const LAYOUT_LIMITS = {
  /** Elements one structure may create (nodes + connectors + frames …). */
  elements: 2000,
  /** Characters of text per item. */
  text: 2000,
  /** Mermaid source length. */
  source: 100_000,
  /** Outline / tree depth. */
  depth: 24,
  /** Table cells. */
  cells: 4000,
  /** Characters of a note's text. */
  note: 8000,
} as const;
