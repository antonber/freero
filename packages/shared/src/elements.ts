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
  | 'mindmap';

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
  /**
   * Width the auto-layout last set (written by features/text). Lets normalize() tell a
   * side-handle resize (w differs) apart from an edit or corner scale.
   */
  autoW?: number;
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
  /** Optional user-dragged control/waypoint offsets, routing-specific. */
  waypoints?: { x: number; y: number }[];
  // x/y/w/h are the derived bounding box, kept updated for hit-testing/culling.
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
  | MindmapElement;

export type ElementOf<T extends ElementType> = Extract<BoardElement, { type: T }>;

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
  editedAt?: number;
  reactions?: Record<string, string[]>; // emoji -> userIds
}

/** Stored in the doc's `comments` map. Pinned to a world point or an element. */
export interface CommentThread {
  id: string;
  x: number;
  y: number;
  /** When set, (x, y) is relative to the element's top-left and follows it. */
  elementId?: string | null;
  resolved: boolean;
  messages: CommentMessage[];
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}
