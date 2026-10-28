// Board element model. Every element lives in the Yjs doc's `elements` map
// (see ./ydoc.ts), keyed by id, stored as a plain JSON object. Updates replace
// the whole object (last-writer-wins per element), which keeps sync simple.
//
// Coordinates are world units (1 unit = 1 CSS px at zoom 1). (x, y) is the
// top-left of the unrotated bounding box; rotation is in degrees, clockwise,
// around the box center.

export type ElementType =
  | 'sticky'
  | 'shape'
  | 'text'
  | 'connector'
  | 'pen'
  | 'frame'
  | 'image'
  | 'card'
  | 'emoji'
  | 'mindmap'
  | 'table'
  | 'embed'
  | 'icon';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Stacking order. Higher = on top. Frames always render below non-frames. */
  z: number;
  locked?: boolean;
  /** Id of the frame that contains this element, if any. */
  frameId?: string | null;
  /** Elements sharing a groupId are selected/moved together. */
  groupId?: string | null;
  /**
   * Item link: an external URL (http(s), mailto, tel) or an in-board target '#<elementId>'.
   * Untrusted: validate with the web's `isSafeHref` before following it.
   */
  link?: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type FontFamily = 'sans' | 'serif' | 'mono' | 'hand';

/**
 * Rich text is stored as a small sanitized HTML subset:
 * <b> <i> <u> <s> <a href> <br> <ul> <ol> <li> <p> <span style="color|background-color">.
 * Use sanitizeRichText() on the web side before rendering/storing.
 */
export type RichText = string;

export interface TextStyle {
  fontFamily: FontFamily;
  /** 'auto' = shrink/grow to fit the container (stickies, shapes). */
  fontSize: number | 'auto';
  textColor: string;
  align: TextAlign;
  vAlign: VerticalAlign;
}

export const STICKY_COLORS = {
  yellow: '#FFF3A3',
  lemon: '#FBE96B',
  orange: '#FFC98B',
  coral: '#FFA9A0',
  pink: '#F9B9E0',
  violet: '#D3C4FF',
  blue: '#B5D6FF',
  cyan: '#A7EBEB',
  green: '#C2EFB0',
  lime: '#E1F59A',
  gray: '#E6E6EA',
  white: '#FFFFFF',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;

export interface StickyElement extends BaseElement, TextStyle {
  type: 'sticky';
  color: StickyColor;
  text: RichText;
  /** Tag ids from the board's `tags` map. */
  tags?: string[];
}

export type ShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'parallelogram'
  | 'trapezoid'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star'
  | 'cross'
  | 'arrowRight'
  | 'arrowLeft'
  | 'chevron'
  | 'speech'
  | 'cloud'
  | 'cylinder'
  | 'document'
  | 'predefinedProcess'
  | 'callout';

export interface ShapeElement extends BaseElement, TextStyle {
  type: 'shape';
  shape: ShapeKind;
  fill: string; // css color or 'transparent'
  fillOpacity: number; // 0..1
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  text: RichText;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: RichText;
  fontFamily: FontFamily;
  fontSize: number;
  textColor: string;
  align: TextAlign;
  /** Background highlight behind the whole text box, or 'transparent'. */
  background: string;
  /** When true, width grows with content; when false, text wraps at w. */
  autoWidth: boolean;
}

export type CapStyle = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond' | 'bar';
export type ConnectorRouting = 'straight' | 'elbow' | 'curved';
export type Anchor = 'auto' | 'top' | 'right' | 'bottom' | 'left';

export interface ConnectorEndpoint {
  /** Attached element id; when set, x/y are recomputed from that element. */
  elementId?: string | null;
  anchor?: Anchor;
  /** Absolute world point (used when unattached, and cached when attached). */
  x: number;
  y: number;
}

export interface ConnectorElement extends BaseElement {
  type: 'connector';
  start: ConnectorEndpoint;
  end: ConnectorEndpoint;
  routing: ConnectorRouting;
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  startCap: CapStyle;
  endCap: CapStyle;
  label: string;
  /** Where `label` sits along the route, 0..1 by length (default 0.5). */
  labelT?: number;
  /** More labels along the line, each at its own position (double-click the line to add one). */
  labels?: ConnectorLabel[];
  /** Optional user-dragged control/waypoint offsets, routing-specific. */
  waypoints?: { x: number; y: number }[];
  // x/y/w/h are the derived bounding box, kept updated for hit-testing/culling.
}

export interface ConnectorLabel {
  id: string;
  /** Position along the route, 0..1 by length. */
  t: number;
  text: RichText;
}

export interface PenElement extends BaseElement {
  type: 'pen';
  /** Flat [x0, y0, p0, x1, y1, p1, ...] relative to (x, y); p = pressure 0..1. */
  points: number[];
  stroke: string;
  strokeWidth: number;
  highlighter: boolean;
  /** Natural size the points were recorded at; scale = w/baseW, h/baseH. */
  baseW: number;
  baseH: number;
}

export interface FrameElement extends BaseElement {
  type: 'frame';
  title: string;
  fill: string;
  /** Order in presentation mode / frames panel. */
  index: number;
  /** Optional aspect preset used when created. */
  preset?: 'custom' | '16:9' | '4:3' | '1:1' | 'a4' | 'letter' | 'mobile' | 'desktop';
  /** Hide contents from viewers who aren't the owner/editor (Miro-like "hide frame"). */
  hidden?: boolean;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /** URL served by the Freero server (/uploads/...) or a data URL. */
  src: string;
  naturalW: number;
  naturalH: number;
  alt?: string;
  /**
   * Non-destructive crop: the part of the picture shown in the box, as fractions (0..1) of the
   * natural image. Absent = the whole picture. The file itself is never changed.
   */
  crop?: ImageCrop | null;
}

export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kanban/task card. */
export interface CardElement extends BaseElement {
  type: 'card';
  title: string;
  description: RichText;
  color: string; // left accent bar
  assigneeId?: string | null;
  dueDate?: string | null; // ISO date
  status?: 'todo' | 'doing' | 'done' | null;
  tags?: string[];
}

export interface EmojiElement extends BaseElement {
  type: 'emoji';
  /** A single emoji grapheme or a stamp id like 'stamp:thumbsup'. */
  emoji: string;
}

/** A mind-map node; root nodes have parentId null. Edges are drawn from parentId. */
export interface MindmapElement extends BaseElement {
  type: 'mindmap';
  text: RichText;
  parentId: string | null;
  rootId: string;
  /** Root-only: which side children grow to. */
  direction?: 'right' | 'left' | 'both';
  color: string;
  collapsed?: boolean;
}

/**
 * A table. The element holds the STRUCTURE only (rows, columns, their sizes, header style);
 * cell contents live in the `tableCells` collection, one key per cell, so two people typing
 * into different cells at once never overwrite each other (elements are last-writer-wins per
 * whole element). Row/column ids are stable: inserting or deleting a row never re-keys cells.
 *
 *   tableCells key                       value
 *   t:<tableId>:<rowId>:<colId>          RichText  cell text
 *   f:<tableId>:<rowId>:<colId>          string    cell fill (css color; '' = none)
 */
export interface TableElement extends BaseElement {
  type: 'table';
  rows: Array<{ id: string; h: number }>;
  cols: Array<{ id: string; w: number }>;
  /** First row is a header (bold, tinted). */
  header: boolean;
  fontSize: number;
}

/** Key of a cell's text / fill in the `tableCells` collection. */
export const tableCellKey = (kind: 't' | 'f', tableId: string, rowId: string, colId: string): string =>
  `${kind}:${tableId}:${rowId}:${colId}`;

/** A pasted link: a preview card; known video hosts can play inline (after a click). */
export interface EmbedElement extends BaseElement {
  type: 'embed';
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Preview image (an /uploads URL or data: URL), or null. */
  image: string | null;
  /** 'loading' while the preview is being fetched. */
  status: 'loading' | 'ready' | 'failed';
}

/**
 * A vector icon from the icon library. The drawing is stored IN the element (a short list of
 * SVG primitives on a 24×24 grid, stroke-only), so it renders and exports without loading the
 * icon set, and never changes when the library is upgraded.
 */
export interface IconElement extends BaseElement {
  type: 'icon';
  /** Library name, for search and alt text (e.g. 'rocket'). */
  name: string;
  /** [tag, attributes] pairs; tags limited to path/circle/ellipse/line/polyline/polygon/rect. */
  nodes: IconNode[];
  color: string;
  /** Stroke width on the 24-unit grid (lucide's default is 2). */
  strokeWidth: number;
}

export type IconNode = [string, Record<string, string | number>];

export type BoardElement =
  | StickyElement
  | ShapeElement
  | TextElement
  | ConnectorElement
  | PenElement
  | FrameElement
  | ImageElement
  | CardElement
  | EmojiElement
  | MindmapElement
  | TableElement
  | EmbedElement
  | IconElement;

export type ElementOf<T extends ElementType> = Extract<BoardElement, { type: T }>;

// ---------------------------------------------------------------------------
// Comments
//
// The doc's `comments` map stores ONE SMALL RECORD PER KEY, never a whole thread, so people
// writing the same thread at once never write the same value: replies, edits, deletes,
// reactions and resolve from several clients all merge (each Yjs map key is
// last-writer-wins, and no client ever read-modify-writes a value another client writes).
// Commenters may write this map only (server-enforced), so every record lives in it.
//
//   key                                      value                  written by
//   t:<threadId>                             CommentThreadRecord    creator; anyone to detach it
//   s:<threadId>                             CommentStatusRecord    anyone (resolve / reopen)
//   m:<threadId>:<messageId>                 CommentMessageRecord   the message's author
//   r:<threadId>:<messageId>:<userId>:<emoji> CommentReactionRecord that user (deleted to un-react)
//   x:<threadId>  /  x:<threadId>:<messageId> CommentTombstone      whoever deleted the thread/message
//
// A tombstone wins over a concurrent edit/reply/detach of what it deletes. Readers assemble
// the records into `CommentThread` (the read model below).
// ---------------------------------------------------------------------------

export interface CommentThreadRecord {
  kind: 'thread';
  id: string;
  x: number;
  y: number;
  /** When set, (x, y) is relative to the element's top-left and follows it. */
  elementId?: string | null;
  /** Element-pinned threads only: the pin sits just outside this corner (ignores x/y). */
  corner?: 'top-right' | null;
  /** Absolute fallback point if the pinned element disappears while nobody is online. */
  origin?: { x: number; y: number };
  createdAt: number;
  createdBy: string;
}

export interface CommentStatusRecord {
  kind: 'status';
  threadId: string;
  resolved: boolean;
  by: string;
  at: number;
}

export interface CommentMessageRecord {
  kind: 'message';
  threadId: string;
  id: string;
  authorId: string;
  authorName: string;
  /** Author's cursor color at write time (avatars render after the author leaves). */
  authorColor?: string;
  text: string;
  createdAt: number;
  editedAt?: number;
}

export interface CommentReactionRecord {
  kind: 'reaction';
  threadId: string;
  messageId: string;
  userId: string;
  emoji: string;
}

export interface CommentTombstone {
  kind: 'deleted';
  threadId: string;
  /** Absent when the whole thread was deleted. */
  messageId?: string;
  by: string;
  at: number;
}

export type CommentRecord =
  | CommentThreadRecord
  | CommentStatusRecord
  | CommentMessageRecord
  | CommentReactionRecord
  | CommentTombstone;

/** Read model: one message with its reactions, assembled from the records above. */
export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorColor?: string;
  text: string;
  createdAt: number;
  editedAt?: number;
  /** emoji -> userIds */
  reactions: Record<string, string[]>;
}

/** Read model: a thread assembled from its records; messages oldest first. */
export interface CommentThread {
  id: string;
  x: number;
  y: number;
  elementId: string | null;
  corner: 'top-right' | null;
  origin?: { x: number; y: number };
  resolved: boolean;
  messages: CommentMessage[];
  createdAt: number;
  createdBy: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}
