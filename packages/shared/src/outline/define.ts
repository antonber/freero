// How features take part in the board outline: a feature's reserved `outline.ts`
// (`export default defineOutline({...})`) says how its element types read and what its
// collections add to items. There is no central switch: the server (modules/outline) and the web
// discover these files like every other reserved feature file.
//
// `outline.ts` runs on the server too, so it must stay pure: it may load this package, files of
// its own feature, and types (type-only imports) from anywhere, never runtime code from the
// engine, the ui kit or other packages [W13].
import type { BoardElement, ElementOf, ElementType } from '../elements';
import type { OutlineThread } from './types';

/** What a feature's outline functions can read: the board as ONE reader sees it. */
export interface OutlineContext {
  /** The reader's user id. */
  readonly readerId: string;
  /** Every element the reader can see (shared, plus layers they may read). */
  elements(): readonly BoardElement[];
  element(id: string): BoardElement | undefined;
  /** A feature collection of the shared doc (empty when absent). */
  collection<T = unknown>(name: string): ReadonlyMap<string, T>;
  /** RichText → plain text, mentions as @Name. */
  plain(html: string): string;
  /** `<@userId>` mention tokens in plain text → @Name. */
  mentions(text: string): string;
  /** A user's current display name, when known. */
  personName(userId: string): string | undefined;
}

/** How one element reads. Returned by a feature's `kinds[type]`. */
export interface OutlineDescription {
  /** Defaults to the element type. */
  kind?: string;
  variant?: string;
  title?: string;
  text?: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
  rows?: string[][];
  /** Its contents are hidden from viewers and commenters (a hidden frame). */
  hidden?: boolean;
  /** Nests the item under another item (a mind-map node under its parent). */
  parentId?: string | null;
  /** The element is a relation between two items, not an item (connectors). */
  edge?: { from: string | null; to: string | null; label?: string; arrow?: 'forward' | 'backward' | 'both' | 'none' };
  /** Its children (elements with `frameId` = this id) fall into these sections (kanban columns). */
  sections?: Array<{ id: string; title: string; fields?: Record<string, string | number | boolean | null | undefined> }>;
  /** Which section a child is in (null: directly under the container). */
  sectionOf?: (child: BoardElement) => string | null;
  /**
   * Never part of a spatial cluster: containers, tables, trees, strokes. Default false (stickies,
   * shapes, cards and text are clustered by proximity).
   */
  standalone?: boolean;
}

export type OutlineKindFn<T extends ElementType> = (el: ElementOf<T>, ctx: OutlineContext) => OutlineDescription | null;

/** Facts a feature's collections add to items or to the board. */
export interface OutlineAnnotations {
  /** By element id. */
  items?: Map<string, OutlineFacts>;
  /** Threads not pinned to a visible item, board-level notes. */
  comments?: OutlineThread[];
  notes?: string[];
}

export interface OutlineFacts {
  votes?: number;
  tags?: string[];
  comments?: OutlineThread[];
}

export interface OutlineFeature {
  /** How elements of these types read; null = not content (left out). */
  kinds?: { [T in ElementType]?: OutlineKindFn<T> };
  /** What this feature's collections say about items (votes, tags, comments). */
  annotate?: (ctx: OutlineContext) => OutlineAnnotations;
}

export const defineOutline = (f: OutlineFeature): OutlineFeature => f;
