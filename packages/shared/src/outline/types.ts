// The semantic board read model (KAI-166): what a board SAYS, without coordinates or styling.
// Frames → clusters / groups → items; containers keep their own structure (kanban columns,
// mind-map trees, table rows); connectors become edges; votes, tags and comments ride on the
// items they belong to. Every item keeps its element id, so a caller can address an edit to it.
//
// Versioning (docs/board-outline.md): `outlineVersion` is a MAJOR version. Within it, changes are
// additive only (new optional fields, new `kind` / `variant` values, new facts); anything that
// removes or changes the meaning of a field bumps it.

export const OUTLINE_VERSION = 1 as const;

/** Kinds the outline makes up itself (no element of that type exists). */
export type OutlineStructureKind = 'cluster' | 'group' | 'column';

export interface OutlineItem {
  /**
   * The element id. Made-up nodes have ids no element can have: 'cluster:<first member>',
   * 'group:<groupId>', '<kanbanId>:<columnId>'.
   */
  id: string;
  /** The element type ('sticky', 'shape', 'mindmap', …) or an OutlineStructureKind. */
  kind: string;
  /** A refinement of the kind: a shape's outline ('diamond'), a sticky's color. */
  variant?: string;
  title?: string;
  /** Plain text (newlines kept); mentions read as @Name. */
  text?: string;
  /** Small typed facts ('status', 'due', 'assignee', 'url', …). */
  fields?: Record<string, string | number | boolean>;
  /** Tag names. */
  tags?: string[];
  /** Votes in the board's current vote, when its results may be shown. */
  votes?: number;
  /** Who created it (current display name). Only with `authors: true`. */
  author?: string;
  /** Item link (external URL or '#<elementId>'). */
  link?: string;
  /** In the reader's private layer: only they can see it until it is revealed. */
  private?: true;
  /** A hidden frame (contents withheld from viewers and commenters). */
  hidden?: true;
  /** The reader may not see what is inside (a hidden frame, read by a viewer or commenter). */
  withheld?: true;
  /** A table's cells as plain text, row by row (the first row is the header when `fields.header`). */
  rows?: string[][];
  comments?: OutlineThread[];
  children?: OutlineItem[];
  /** Items under this one left out of this response (budget or page); counted once each. */
  omitted?: number;
  /** Repeated from an earlier page so this page's items keep their place in the tree. */
  context?: true;
}

export interface OutlineEdge {
  /** The connector's element id. */
  id: string;
  /** Item ids at both ends; null = a loose end (or an end the reader cannot see). */
  from: string | null;
  to: string | null;
  label?: string;
  /** Which way the arrowheads point ('forward' = from → to). */
  arrow?: 'forward' | 'backward' | 'both' | 'none';
}

export interface OutlineMessage {
  id: string;
  authorId: string;
  /** The author's current display name (as written, when they are unknown). */
  author: string;
  text: string;
  at: number;
}

export interface OutlineThread {
  id: string;
  resolved?: true;
  messages: OutlineMessage[];
}

export interface OutlineMeta {
  /** Items (made-up nodes included) and edges on the board as the reader sees it. */
  itemCount: number;
  edgeCount: number;
  /** Items and edges in this response, context repeats excluded. */
  returned: number;
  /** Something was left out (budget or page). */
  truncated: boolean;
  /** Top-level items and edges left out (items under a returned node count in its `omitted`). */
  omitted: number;
  /** Pass as `cursor` for the next page. */
  nextCursor?: string;
  /** The cursor was made for an earlier `version`: the board changed between the pages. */
  versionChanged?: true;
}

export interface BoardOutline {
  outlineVersion: typeof OUTLINE_VERSION;
  board: { id: string; title: string; url?: string };
  /** Changes whenever anything the reader can see changes (an ETag). */
  version: string;
  /** Frames and the items outside any frame, in reading order. */
  items: OutlineItem[];
  edges: OutlineEdge[];
  /** Comment threads not pinned to an item the reader can see. */
  comments: OutlineThread[];
  /** Board-level facts ("Vote … ended · 12 votes"). */
  notes: string[];
  meta: OutlineMeta;
  /**
   * [additive] Pending suggestions (KAI-169): changes proposed for people to accept, NOT on the
   * board. Only when asked for (`include=suggestions`) and only for owners and editors; never
   * counted in `meta`, never paged or budgeted.
   */
  suggestions?: OutlineSuggestion[];
}

export interface OutlineSuggestion {
  id: string;
  groupId: string;
  op: 'create' | 'update' | 'delete';
  /** The item it creates (the id it gets when accepted), changes or deletes. */
  itemId: string;
  /** How the item reads once accepted (a deletion: the item it deletes), like an OutlineItem. */
  kind?: string;
  title?: string;
  text?: string;
  /** update: the fields it changes. */
  changes?: string[];
  /** Who proposed it ("Claude for Maria"). */
  by: string;
  /** What the proposer says the group does. Untrusted, like board text. */
  description?: string;
  /** 'ready', or stale: 'changed' (edited since), 'gone' (the item, or one it needs, was deleted). */
  state: 'ready' | 'changed' | 'gone';
}
