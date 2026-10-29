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
  | 'icon'
  | 'kanban'
  | 'pdf'
  | 'swimlane'
  | 'media'
  | 'file'
  | 'objectlink'
  | 'activity'
  | 'code'
  | 'timeline'
  | 'timelinebar'
  | 'doc';

/**
 * An app (OAuth) or personal token acting for a person: what the board shows as "<name> for
 * <person>" (KAI-168). `id` is the app's client id or the token's id (never a secret).
 */
export interface ActingApp {
  kind: 'app' | 'token';
  id: string;
  name: string;
}

/** "Claude for Maria". */
export const actingFor = (via: Pick<ActingApp, 'name'>, person: string): string => `${via.name} for ${person}`;

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
  /**
   * Id of the element this one rides on (a reaction stamp on a sticky): it moves, duplicates,
   * copies and is deleted with that element, like a frame's children. Set by the feature that
   * places it; the engine clears it on copies whose target wasn't copied.
   */
  attachedTo?: string | null;
  /**
   * [additive] Accepted from a suggestion (KAI-169): who proposed it. `createdBy` is the person who
   * accepted it, so both are on the item.
   */
  suggestedBy?: { kind: 'person' | 'app' | 'ai'; name: string; userId: string } | null;
  createdBy: string;
  /**
   * The app or token that created it for `createdBy` (the public API or MCP, KAI-168): read as
   * "<name> for <person>". Stamped by the server; absent for things people made themselves.
   */
  createdVia?: ActingApp | null;
  /**
   * [additive] The tracker issue this item was sent to or imported from (KAI-153): the id of its
   * record in the board's `trackers` collection. Written only by the server (modules/trackers);
   * the badge shows only while that record still lists this item among its sources, so a copy of
   * a linked item carries no link.
   */
  trackerLink?: string | null;
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
  | 'callout'
  // Flowchart
  | 'terminator'
  | 'manualInput'
  | 'manualOperation'
  | 'delay'
  | 'display'
  | 'offPageRef'
  | 'merge'
  | 'internalStorage'
  | 'multiDocument'
  | 'punchedCard'
  | 'punchedTape'
  | 'collate'
  | 'sort'
  | 'loopLimit'
  | 'storedData'
  | 'summingJunction'
  | 'orJunction'
  // UML
  | 'umlClass'
  | 'umlActor'
  | 'umlPackage'
  | 'umlNote'
  | 'umlComponent'
  | 'umlNode'
  // UML sequence diagrams
  | 'umlLifeline'
  | 'umlActivation'
  | 'umlFragment'
  // BPMN
  | 'bpmnIntermediate'
  | 'bpmnEnd'
  | 'bpmnGatewayX'
  | 'bpmnGatewayPlus'
  | 'bpmnGatewayO'
  | 'bpmnSubprocess'
  | 'bpmnMessageEvent'
  | 'bpmnTimerEvent'
  | 'bpmnErrorEvent'
  // Entity-relationship (crow's foot)
  | 'erdEntity'
  // Network
  | 'netServer'
  | 'netFirewall'
  | 'netRouter'
  | 'netSwitch'
  | 'netMonitor'
  | 'netLaptop'
  | 'netPhone'
  | 'netUser'
  // [additive] Wireframe kit (KAI-120): device frames and low-fidelity UI controls. Their corners
  // and marks keep a fixed size when resized. Clients that don't know a kind draw its box.
  | 'wfBrowser'
  | 'wfPhone'
  | 'wfTablet'
  | 'wfDesktop'
  | 'wfButton'
  | 'wfInput'
  | 'wfSearch'
  | 'wfTextArea'
  | 'wfCheckbox'
  | 'wfRadio'
  | 'wfToggle'
  | 'wfDropdown'
  | 'wfTabs'
  | 'wfNavBar'
  | 'wfCard'
  | 'wfList'
  | 'wfImage'
  | 'wfAvatar'
  | 'wfSlider'
  | 'wfModal'
  | 'wfProgress';

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

/**
 * Line ends. Hollow variants (`…Open`) are UML's (generalisation, aggregation). The crow's-foot
 * cardinalities are ER notation: `one` = exactly one (two bars), `many`, `zeroOrOne`,
 * `oneOrMany`, `zeroOrMany`. Clients that don't know a cap draw a plain end.
 */
export type CapStyle =
  | 'none'
  | 'arrow'
  | 'triangle'
  | 'circle'
  | 'diamond'
  | 'bar'
  | 'triangleOpen'
  | 'diamondOpen'
  | 'circleOpen'
  | 'one'
  | 'many'
  | 'zeroOrOne'
  | 'oneOrMany'
  | 'zeroOrMany';
export type ConnectorRouting = 'straight' | 'elbow' | 'curved';
export type Anchor = 'auto' | 'top' | 'right' | 'bottom' | 'left';

export interface ConnectorEndpoint {
  /** Attached element id; when set, x/y are recomputed from that element. */
  elementId?: string | null;
  anchor?: Anchor;
  /**
   * Attached anywhere on the element's outline: the spot as fractions (0..1) of its unrotated
   * box, projected onto the drawn outline (a point on an ellipse's curve). It scales with the
   * element, so 25% along a side stays at 25% after a resize. `anchor` then names the nearest
   * side (clients that predate this attach there). Absent = `anchor` alone.
   */
  at?: { u: number; v: number } | null;
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
  preset?: 'custom' | '16:9' | '4:3' | '1:1' | 'a4' | 'letter' | 'mobile' | 'desktop' | 'tablet' /* [additive] */;
  /**
   * Contents hidden from viewers and commenters. Server-enforced: while set, everything inside
   * lives in the board's 'editors' layer, which the server sends only to owners/editors
   * (ElementDefinition.hidesContents; see "Board layers" in ARCHITECTURE.md).
   */
  hidden?: boolean;
  /** Auto-layout: the frame keeps its children in a grid (reading order) of `cols` columns. */
  layout?: FrameGridLayout | null;
  /**
   * A slide left out of the deck (KAI-126): presenting skips it and PDF exports leave it out by
   * default. It stays on the board, in its place in the order.
   */
  skip?: boolean;
}

export interface FrameGridLayout {
  kind: 'grid';
  cols: number;
  /** World units between items and around them. */
  gap: number;
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
  /** Agreed estimate (story points, a size): written by planning poker through `card.setEstimate`. */
  estimate?: string | null;
  /**
   * [additive] First day of the work (ISO date), with `dueDate` as the last: a card on a timeline
   * spans these days. Written through `card.setDates` (the timeline asks; cards keep one writer).
   */
  startDate?: string | null;
  /**
   * [additive] The id this task has in the agent that posts it to a control room (KAI-249): the
   * server's post_status matches a task by it before its title, so a renamed task keeps its card.
   * Written only by the server (modules/api controlRoom.ts); the card feature never shows or edits it.
   */
  externalId?: string | null;
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
  cols: TableColumn[];
  /** First row is a header (bold, tinted). */
  header: boolean;
  fontSize: number;
  /**
   * Rows shown (KAI-123): only those matching this condition (the header row always shows). The
   * others keep their place in `rows` and their cells; they are drawn collapsed.
   */
  filter?: TableFilter | null;
  /** 'board': the same rows drawn as cards in columns by `groupBy` (a select column). Default grid. */
  view?: 'grid' | 'board';
  groupBy?: string | null;
}

/**
 * A table column (KAI-123). `type` (default text) says what its cells hold. Cells live in
 * `tableCells` either way: a text column's as RichText; a typed column's as its canonical plain
 * value, which is also valid RichText (number "12.5", date "2026-10-28", select: the option's
 * label, person: a user id, checkbox: "true" or no record). Plain readers (outline, find, CSV)
 * therefore read typed cells unchanged.
 */
export interface TableColumn {
  id: string;
  w: number;
  type?: TableColumnType;
  /** Choices of a select column, in order. */
  options?: TableSelectOption[];
}

export type TableColumnType = 'text' | 'number' | 'date' | 'select' | 'person' | 'checkbox';

export interface TableSelectOption {
  id: string;
  label: string;
  color: string;
}

export type TableFilterOp = 'contains' | 'is' | 'empty' | 'notEmpty' | 'gt' | 'lt' | 'checked' | 'unchecked';

export interface TableFilter {
  colId: string;
  op: TableFilterOp;
  value?: string;
}

/** Key of a cell's text / fill in the `tableCells` collection. */
export const tableCellKey = (kind: 't' | 'f', tableId: string, rowId: string, colId: string): string =>
  `${kind}:${tableId}:${rowId}:${colId}`;

/** The table a `tableCells` key belongs to (null: not a cell key). See ELEMENT_CONTENT_COLLECTIONS. */
export function tableCellOwner(key: string): string | null {
  const parts = key.split(':');
  return parts.length === 4 && (parts[0] === 't' || parts[0] === 'f') && parts[1] ? parts[1] : null;
}

/**
 * What a table carries outside the elements map when it is copied (`ElementsSnapshot.content`
 * of a table): cell part `"<rowId>:<colId>"` → RichText `t` and fill `f` (absent = empty). Saved
 * templates persist it and built-in templates write it, so it is a stable format, not a table
 * internal.
 */
export type TableCopyContent = Record<string, { t?: string; f?: string }>;

/** The `tableCells` entries that hold `content` for table `tableId` (what pasting a table writes). */
export function tableCellEntries(tableId: string, content: TableCopyContent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [part, cell] of Object.entries(content)) {
    const [rowId, colId] = part.split(':');
    if (!rowId || !colId) continue;
    if (cell.t) out[tableCellKey('t', tableId, rowId, colId)] = cell.t;
    if (cell.f) out[tableCellKey('f', tableId, rowId, colId)] = cell.f;
  }
  return out;
}

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
 * A smart link (KAI-149): a live chip for a Freero object address (a board, an item on one, a
 * template…). It stores ONLY the address: the title and preview are resolved for each viewer when
 * shown, permission-checked, so a board never carries the name of something its readers may not
 * see, and a renamed target shows its new name.
 */
export interface ObjectLinkElement extends BaseElement {
  type: 'objectlink';
  /** Canonical object address (`freero://…`, see objects.ts). */
  uri: string;
}

/**
 * A doc on the board (KAI-124, KAI-152): the SAME object as the doc's own page (`freero://doc/<id>`),
 * shown live from its own Yjs document and socket — the board stores only the address, never a
 * copy. Each viewer's access is checked on the doc itself: someone who can't open it sees a
 * "No access" card, whatever their role on the board.
 */
export interface DocElement extends BaseElement {
  type: 'doc';
  /** The doc's address (`freero://doc/<id>`). */
  uri: string;
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

export type CardStatus = NonNullable<CardElement['status']>;

/**
 * A kanban board: a header and side-by-side columns. Items dropped onto it join it (it is a
 * container: their `frameId` is the kanban) and are stacked in the column under their center.
 * A column with a `status` sets that status on task cards dropped into it.
 */
export interface KanbanElement extends BaseElement {
  type: 'kanban';
  title: RichText;
  columns: KanbanColumn[];
  /** Width of every column (world units); the element's w follows from it. */
  colW: number;
}

/**
 * Kanban geometry (element-local, world units), shared by the kanban feature's layout and the
 * server, which places a card in the column of the status a tracker reports (modules/trackers).
 */
export const KANBAN_LAYOUT = {
  /** Board title band. */
  headerH: 52,
  /** Column header (title, count, menu). */
  colHeadH: 44,
  /** Between columns and around them. */
  gap: 12,
  /** Inside a column, around its items. */
  pad: 10,
  /** Between stacked items. */
  itemGap: 10,
} as const;

export interface KanbanColumn {
  id: string;
  title: RichText;
  /** Status set on task cards dropped into this column (null: leave it as it is). */
  status: CardStatus | null;
  /** Work-in-progress limit (items); 0 / absent = none. */
  wip?: number;
  /** Header accent color. */
  color: string;
}

/** A PDF document: shows one page at a time; the file lives in uploads. */
export interface PdfElement extends BaseElement {
  type: 'pdf';
  /** /uploads/<id>.pdf (or a data: URL in the offline sandbox). */
  src: string;
  name: string;
  /** 1-based page shown. */
  page: number;
  /** 0 until the document has been opened once. */
  pageCount: number;
}

/**
 * A video or audio file that plays on the board. The file lives in uploads (served with byte
 * ranges, so it seeks); playback is each viewer's own (never synced). A video shows `poster` (a
 * frame captured by the uploading browser) until played, and in exports.
 */
export interface MediaElement extends BaseElement {
  type: 'media';
  kind: 'video' | 'audio';
  /** /uploads/<id>.<mp4|webm|mov|m4a|mp3|wav|ogg|flac|aac> (or a data: URL in the offline sandbox). */
  src: string;
  /** /uploads/<id>.jpg|png: a still of the video (absent for audio, or when none could be taken). */
  poster?: string | null;
  /** The original file name (shown, and the name it downloads under). */
  name: string;
  /** Bytes. */
  size: number;
  /** Seconds; 0 when unknown. */
  duration: number;
  /** The video's own size (px), for its aspect ratio; 0 for audio. */
  naturalW: number;
  naturalH: number;
}

/**
 * Any other file attached to the board: a card with its name, type and size that downloads on
 * click (never opened in the browser). The bytes live in uploads as an opaque attachment that is
 * only served through the board (the workspace's downloads policy, the audit log).
 */
export interface FileElement extends BaseElement {
  type: 'file';
  /** /uploads/<id>.bin (or a data: URL in the offline sandbox). */
  src: string;
  /** The original file name, extension included. */
  name: string;
  /** Bytes. */
  size: number;
  /** The type the uploading browser reported (display only: never trusted, never served). */
  mime: string;
}

/** Live audience activities (KAI-132). */
export type ActivityKind = 'poll' | 'wordcloud' | 'ranking' | 'rating' | 'qna';
export interface ActivityOption {
  id: string;
  text: string;
}

/**
 * A live audience activity (KAI-132): a poll, word cloud, ranking, rating scale or Q&A. The
 * element holds the question and its settings (written by editors like any element); answers go
 * to the SERVER (REST), which keeps them out of the board and publishes only results — counts,
 * words, averages, questions — into the `engageResults` collection (ENGAGE_RESULTS_COLLECTION,
 * written by nobody else). So nobody can map an anonymous answer to a person, and sealed results
 * are on no client until revealed.
 */
export interface ActivityElement extends BaseElement {
  type: 'activity';
  kind: ActivityKind;
  question: RichText;
  /** Poll choices, items to rank, statements to rate (unused by word clouds and Q&A). */
  options: ActivityOption[];
  /** Poll: how many choices one person may pick (1: single choice). */
  maxChoices?: number;
  /** Rating: the top of the scale (1..scale). */
  scale?: number;
  /** Names are never shown with answers (kept with each answer as it was when given). */
  anonymous: boolean;
  /** 'live': results as answers arrive; 'reveal': only how many answered, until an editor reveals them. */
  results: 'live' | 'reveal';
  /** Visitors without an account (guests on the board's link) may answer. */
  guests: boolean;
  /** No more answers (results stay). */
  closed?: boolean;
  /** Accent colour. */
  color: string;
}

/**
 * A swimlane diagram (a pool): a title band, lanes — rows, or columns when `vertical` — and
 * phases across them. It is a container: items dropped in it join it (`frameId`) and keep their
 * own positions; an item is in the lane (and phase) under its center. Lanes grow to fit what is
 * in them and carry their items along when a lane is resized, added, removed or reordered.
 * Older clients that don't know the type show nothing for it but keep its items.
 */
export interface SwimlaneElement extends BaseElement {
  type: 'swimlane';
  title: RichText;
  /** Lanes run top to bottom as columns (default: left to right as rows). */
  vertical?: boolean;
  lanes: SwimlaneBand[];
  /** Phases across the lanes, at least one; their headers show when there are two or more. */
  phases: SwimlaneBand[];
}

export interface SwimlaneBand {
  id: string;
  title: RichText;
  /** Thickness across the band's direction (a row lane's height), world units. */
  size: number;
  /** Header tint. */
  color: string;
}

/**
 * A code block (KAI-125). `code` is PLAIN TEXT — never HTML: the web app tokenises it with a
 * highlighter into text spans, so whatever it contains (`<script>`, markup) is shown, never run.
 * Tabs and indentation are kept as typed.
 */
export interface CodeElement extends BaseElement {
  type: 'code';
  code: string;
  /** Highlighting grammar id ('typescript', 'python'…); 'auto' guesses, 'plaintext' highlights nothing. */
  language: string;
  lineNumbers: boolean;
  /** Paper the code sits on. */
  theme: 'light' | 'dark';
}

/**
 * A timeline (KAI-122): a date axis from `start` to `end` (ISO dates, both shown) at a `scale`,
 * with lanes as rows. It is a container: its bars — `timelinebar` items and task cards — are its
 * children (`frameId`), each its own element (two people moving different bars never collide),
 * placed by their dates; dragging one changes its dates. Dependencies are ordinary connectors
 * between bars. A bar belongs to the lane under its center.
 */
export interface TimelineElement extends BaseElement {
  type: 'timeline';
  title: RichText;
  start: string;
  end: string;
  scale: TimelineScale;
  lanes: TimelineLane[];
  /**
   * 'horizons' (KAI-160): a roadmap's Now / Next / Later columns instead of the date axis. Bars keep
   * their dates; each sits in the column its start falls in, and moving one to another column
   * moves its dates there. Default 'dates'.
   */
  view?: 'dates' | 'horizons';
}

export type TimelineScale = 'day' | 'week' | 'month' | 'quarter';

export interface TimelineLane {
  id: string;
  title: RichText;
  /** Header tint. */
  color: string;
  /** Rows of bars the lane is tall enough for (kept by the timeline's layout; at least 2). */
  rows?: number;
}

/** A bar (or a milestone: one day, drawn as a diamond) on a timeline, from `start` to `end` inclusive. */
export interface TimelineBarElement extends BaseElement {
  type: 'timelinebar';
  title: RichText;
  start: string;
  end: string;
  color: string;
  milestone?: boolean;
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
  | MindmapElement
  | TableElement
  | EmbedElement
  | IconElement
  | KanbanElement
  | PdfElement
  | SwimlaneElement
  | MediaElement
  | FileElement
  | ObjectLinkElement
  | ActivityElement
  | CodeElement
  | TimelineElement
  | TimelineBarElement
  | DocElement;

export type ElementOf<T extends ElementType> = Extract<BoardElement, { type: T }>;

// ---------------------------------------------------------------------------
// Comments
//
// The doc's `comments` map stores ONE SMALL RECORD PER KEY, never a whole thread, so people
// writing the same thread at once never write the same value: replies, edits, deletes,
// reactions and resolve from several clients all merge (each Yjs map key is
// last-writer-wins, and no client ever read-modify-writes a value another client writes).
// Commenters may write this map only (server-enforced), so every record lives in it. For
// commenters the server also enforces the "written by" column (realtime/commentRules.ts);
// owners and editors may write any record.
//
//   key                                      value                  written by
//   t:<threadId>                             CommentThreadRecord    creator; anyone to detach it
//   s:<threadId>                             CommentStatusRecord    anyone (resolve / reopen)
//   m:<threadId>:<messageId>                 CommentMessageRecord   the message's author
//   r:<threadId>:<messageId>:<userId>:<emoji> CommentReactionRecord that user (deleted to un-react)
//   x:<threadId>  /  x:<threadId>:<messageId> CommentTombstone      whoever deleted the thread/message
//                                                                   (the thread's creator or the
//                                                                   message's author); never removed
//
// A tombstone wins over a concurrent edit/reply/detach of what it deletes. Readers assemble
// the records into `CommentThread` (the read model below).
//
// Mentions inside a message's text are tokens naming a user ID: `<@userId>`. Readers show the
// person's CURRENT name for that ID, so typing "@Ann" (or someone renaming themselves) can never
// make a comment look like it mentions someone else, and the server notifies exactly those IDs.
// ---------------------------------------------------------------------------

export const MENTION_RE = /<@([A-Za-z0-9_-]{1,64})>/g;

export const mentionToken = (userId: string) => `<@${userId}>`;

/** Distinct user IDs mentioned in `text`, in order of first appearance. */
export function mentionedUserIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) out.add(m[1]);
  return [...out];
}

/** `text` with every mention as "@Name" (unknown IDs: "@someone"). */
export function mentionsAsNames(text: string, nameOf: (userId: string) => string | undefined): string {
  return text.replace(MENTION_RE, (_, id: string) => `@${nameOf(id) ?? 'someone'}`);
}

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
