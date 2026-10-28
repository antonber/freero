// ============================================================================
// Freero engine — PUBLIC CONTRACT.
//
// Features (src/features/*) and the app (src/app/*) may import ONLY from
// '@engine' (src/engine/index.ts), which re-exports this file plus hooks and
// UI building blocks. Deep imports into the engine fail `npm run check`.
//
// Changing a signature here is an architecture change: make it additive,
// note it in ARCHITECTURE.md, and mention it in your report.
// ============================================================================

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type {
  ActivityEntry,
  BoardElement,
  BoardLayer,
  BoardVersion,
  BoardSettings,
  ElementOf,
  ElementType,
  FontFamily,
  PresenceState,
  ReportReason,
  ReportTarget,
  Role,
  SessionLimits,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from '@freero/shared';

/** [additive] Where an element lives (see Editor.layerOf and ARCHITECTURE.md "Board layers"). */
export type ElementLayer = 'shared' | BoardLayer;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Camera { x: number; y: number; zoom: number } // world point at screen (0,0) = (x,y)

// ---------------------------------------------------------------------------
// Host — the ONE typed contract between the app shell and the engine.
// The app constructs it; the engine and features consume it. Features never
// import the REST client or router directly.
// ---------------------------------------------------------------------------
export interface HostUser { id: string; name: string; color: string; avatarUrl: string | null }

export interface Host {
  user: HostUser;
  board: {
    id: string;
    title: string;
    role: Role;
    /**
     * [additive] False when the board's workspace doesn't let this user export, download or copy
     * its boards (policy; the server enforces copies). Export features hide their commands then.
     * Default true.
     */
    canExport?: boolean;
    /**
     * [additive] The team workspace the board belongs to, when the user is a full member of it:
     * templates saved from this board may be shared with that team (`saveTemplate`'s
     * `shareWithTeam`, `shareTemplate`). Null/absent: personal templates only.
     */
    team?: { name: string } | null;
    /**
     * [additive] False for a visitor without an account (a guest on the board's link, KAI-43):
     * no account services, and the report dialog asks for a contact email. Default true.
     */
    signedIn?: boolean;
  };
  /** Full ws URL prefix; engine connects WebsocketProvider(syncUrl, board.id, doc). */
  syncUrl: string;
  uploadImage(file: Blob): Promise<{ url: string }>;
  /**
   * [additive] Stores a document (PDF) with the board's uploads, under the same per-account quota
   * as images. Rejects with an Error whose message can be shown (too large, quota reached).
   * Offline sandbox: a data: URL.
   */
  uploadFile(file: Blob): Promise<{ url: string }>;
  renameBoard(title: string): Promise<void>;
  /**
   * [additive] Tells the server a board export (image, PDF) was made in the browser, for the
   * workspace's audit log. Fire and forget; export features call it after each download. Absent in
   * the offline sandbox.
   */
  reportExport?(format: string): void;
  saveThumbnail(dataUrl: string): Promise<void>;
  openShareDialog(): void;
  navigate(path: string): void;
  /**
   * Lightweight toast from anywhere. [additive] `opts.action` adds one button (e.g. "Go"); toasts
   * with an action stay up longer.
   */
  notify(message: string, kind?: 'info' | 'success' | 'error', opts?: NotifyOptions): void;
  /**
   * Current time on the SERVER's clock (ms). Use it for anything shared that is time-based
   * (timers, deadlines) so clients with skewed clocks agree. Falls back to the local clock
   * until measured, and offline.
   */
  serverNow(): number;
  /**
   * [additive] Everyone with access to this board (owner + invited members), including people
   * who have never been online here. Offline sandbox: just the local user. Rejects when the
   * directory can't be loaded; callers fall back to presence.
   */
  listMembers(): Promise<HostUser[]>;
  /**
   * [additive] Current profiles (name, color, photo) of these users, for ids the board shows: people
   * with access, and anyone who wrote or is @mentioned in its comments — also after they left.
   * Other ids (and deleted accounts) are simply missing from the result. Offline sandbox: the
   * local user only.
   */
  lookupUsers(ids: string[]): Promise<HostUser[]>;
  /**
   * [additive] Shares this board with an email address (owner/editor; the server checks). An
   * existing account becomes a member right away (`{ user }`; someone who already has access is
   * returned as they are, their role unchanged); any other address gets an emailed invite
   * (`{ pendingEmail }`). Rejects with a message that can be shown (no permission, email not
   * verified, role conflict).
   */
  inviteMember(email: string, role: 'editor' | 'commenter' | 'viewer'): Promise<{ user: HostUser } | { pendingEmail: string }>;
  /**
   * [additive] Link preview for a pasted URL (title, description, image), fetched by the SERVER
   * (never from the browser: no third-party requests from viewers, no CORS). `image` is a data
   * URL (already fetched and size-capped) or null. Rejects when the URL can't be previewed
   * (offline sandbox, private address, timeout); callers fall back to a plain link card.
   */
  unfurl(url: string): Promise<LinkPreview>;
  /**
   * [additive] Copies an image placed by URL into the board's uploads — fetched by the SERVER, so
   * hosts without CORS work too — and resolves with its own URL (same origin: exports can read
   * it). Rejects when the server can't fetch it (private address, not an image, too large, rate
   * limit) or there is no server (offline sandbox); callers keep the original URL.
   */
  importImage(url: string): Promise<{ url: string }>;
  /**
   * [additive] The bytes of a remote image, fetched by the server (nothing stored). Exports use it
   * for images a board still links from hosts without CORS. Rejects like `importImage`.
   */
  fetchImage(url: string): Promise<Blob>;
  /**
   * [additive] Saved templates (a board or selection someone saved for reuse) the user may insert:
   * their own today; also their workspace's once workspaces exist — so compare `ownerId` with
   * `user.id` before offering owner-only actions (delete). Newest first. Rejects offline / when
   * the list can't be loaded.
   */
  listTemplates(): Promise<SavedTemplateInfo[]>;
  /** [additive] The content of a saved template, ready for `Editor.insertElements`. */
  loadTemplate(id: string): Promise<ElementsSnapshot>;
  /**
   * [additive] Saves content (from `Editor.exportElements`) as a template owned by the user.
   * `thumbnail` is a PNG/JPEG/WebP data URL (≤ 512 KB) or null. Rejects with a message fit for a
   * toast (over the limit, too large, offline sandbox).
   */
  saveTemplate(template: {
    name: string;
    description: string;
    thumbnail: string | null;
    content: ElementsSnapshot;
    /** [additive] Share it with `board.team` right away. */
    shareWithTeam?: boolean;
  }): Promise<SavedTemplateInfo>;
  /**
   * [additive] Shares one of the user's own templates with `board.team`, or stops sharing a team
   * template (its owner, or an admin of its workspace: `canUnshare`). Sharing rejects when there
   * is no team to share with (offline sandbox, personal board).
   */
  shareTemplate(id: string, shared: boolean): Promise<SavedTemplateInfo>;
  /** [additive] Deletes one of the user's own saved templates. */
  deleteTemplate(id: string): Promise<void>;
  /**
   * [additive] Version history of this board (editors and owners only; every call rejects for
   * other roles and in the offline sandbox, with a message fit for a toast).
   */
  versions: VersionHistory;
  /**
   * [additive] The board's activity, newest first (wire: @freero/shared `ActivityEntry`): what
   * people did, one entry per person per burst of work, as the SERVER saw it — never content of
   * hidden frames for viewers/commenters, never private drafts. `before`: entries that ended before
   * this instant (paging). Absent in the offline sandbox.
   */
  activity?: { list(before?: number): Promise<{ entries: ActivityEntry[]; hasMore: boolean }> };
  /**
   * [additive] Reports this board, an item on it, an uploaded file it shows or a comment to
   * Freero's moderators (KAI-142). Anyone who can open the board may. Rejects with a message fit
   * for a toast (rate limit, offline sandbox, the board is gone).
   */
  report(report: ContentReport): Promise<void>;
}

/** [additive] What `Host.report` sends (wire: @freero/shared `ReportRequest`, without the board id). */
export interface ContentReport {
  target: ReportTarget;
  reason: ReportReason;
  note: string;
  /** [additive] Visitors without an account (`board.signedIn === false`): where to send the outcome. */
  contactEmail?: string;
}

/**
 * [additive] `Host.versions`. A version's `state` is opaque board content: show it with
 * `<StaticBoardView state>`; never apply it to the live board yourself — `restore` does that on
 * the server, as a new change every collaborator receives.
 */
export interface VersionHistory {
  /** Newest first (wire: @freero/shared `BoardVersion`). */
  list(): Promise<BoardVersion[]>;
  /** The full content of a version (for previews). */
  load(id: number): Promise<Uint8Array>;
  /** Keeps the board as it is right now (everyone's latest edits) as a named version. */
  nameCurrent(name: string): Promise<BoardVersion>;
  /** Names / renames a version (named versions are never pruned). */
  rename(id: number, name: string): Promise<BoardVersion>;
  /**
   * Restores a version for everyone. Resolves with the 'before-restore' version that holds the
   * board as it was just before: restoring THAT one undoes the restore. Comments, votes and the
   * timer are left as they are.
   */
  restore(id: number): Promise<BoardVersion>;
}

/** [additive] A saved template as `Host.listTemplates` lists it (wire: @freero/shared `SavedTemplateSummary`). */
export interface SavedTemplateInfo {
  id: string;
  name: string;
  description: string;
  /** Preview image URL, or null. */
  thumbnail: string | null;
  ownerId: string;
  /** [additive] Shared with a team workspace (its members see it), not only its owner. */
  shared?: boolean;
  /** [additive] Who saved it (shown on team templates: "Shared by …"). */
  ownerName?: string;
  /**
   * [additive] The user may stop sharing it with its team (`shareTemplate(id, false)`): its owner,
   * or an owner/admin of the workspace it is shared with.
   */
  canUnshare?: boolean;
  elementCount: number;
  createdAt: number;
}

/**
 * [additive] A portable copy of board content: elements (ids as on the source board) plus what
 * they keep outside the elements map (`ElementDefinition.copyContent`, by source id). What copy
 * puts on the clipboard; `Editor.exportElements` makes one, `Editor.insertElements` inserts one.
 */
export interface ElementsSnapshot {
  elements: BoardElement[];
  content?: Record<string, unknown>;
}

/** [additive] What `Host.unfurl` resolves to (wire format: @freero/shared `UnfurlResponse`). */
export interface LinkPreview {
  /** Final URL after redirects. */
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** data: URL of the preview image (server-fetched, size-capped), or null. */
  image: string | null;
}

/** [additive] Extras for `Host.notify`. */
export interface NotifyOptions {
  action?: { label: string; run(): void };
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
/** Fields the engine fills in automatically on create. */
type AutoFields = 'id' | 'z' | 'createdBy' | 'createdAt' | 'updatedAt' | 'rotation';
export type NewElement<T extends ElementType = ElementType> =
  Omit<ElementOf<T>, AutoFields> & Partial<Pick<ElementOf<T>, AutoFields>>;

export type ElementPatch<T extends BoardElement = BoardElement> =
  Partial<Omit<T, 'id' | 'type' | 'createdBy' | 'createdAt'>>;

export interface ElementRenderProps<T extends BoardElement = BoardElement> {
  element: T;
  selected: boolean;
  /** True while this element's text is being edited locally. */
  editing: boolean;
  zoom: number;
  /**
   * [additive] Space other features' decorations draw over inside this element's box (world
   * units, per side; `DecorationDefinition.reserve`). Lay text out clear of it (sticky text above
   * the tag chips). Undefined when no decoration reserves anything.
   */
  reserved?: Insets;
}

/** Distances from each edge of a box, in world units. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ResizeMode =
  | 'free'         // any aspect
  | 'aspect'       // always keep aspect ratio (images, emoji)
  | 'scale'        // scale content including font size (text), keep aspect
  | 'width-only'   // text with autoWidth=false wraps; height auto
  | 'none';

/** [additive] How an item type reads in lists and menus (Layers, Find, "Select only ▸ …"). */
export interface ElementLabel {
  /** One item: 'Sticky note'. */
  one: string;
  /** Several, as a menu entry: 'Sticky notes'. */
  many: string;
}

/** Any icon component accepting lucide-style props (lucide-react icons fit as-is). */
export type IconComponent = ComponentType<{ size?: number | string; strokeWidth?: number | string }>;

export interface ElementDefinition<T extends ElementType = ElementType> {
  type: T;
  /**
   * [additive] The type's name, defined once by its feature. Layers, Find and "Select only"
   * read it through `describeElementType`; without it they fall back to the capitalised type.
   */
  label?: ElementLabel;
  /** [additive] The type's icon in those lists (default: a plain square). */
  icon?: IconComponent;
  /** World-space renderer. Must be pure and cheap; the engine memoizes per element. */
  Component: ComponentType<ElementRenderProps<ElementOf<T>>>;
  /** Defaults merged under user-provided fields on create (tools usually call this). */
  defaults(): Omit<NewElement<T>, 'x' | 'y'>;
  resize: ResizeMode;
  minSize?: { w: number; h: number };
  /** Has editable rich text (double-click / Enter / typing to edit). Engine handles the editor. */
  textField?: keyof ElementOf<T> & string;
  /** Containers own children by setting their `frameId` (frames). Engine moves children with them. */
  container?: boolean;
  /** Can connectors attach to it? Default true (false for connector/pen). */
  connectable?: boolean;
  /**
   * Precise hit test in element-local unrotated coordinates; default = `distanceTo` when defined,
   * else the bounding box. `ctx.tolerance` (world units, a few screen px at the current zoom) is
   * how far off the drawn shape a click still counts, so thin targets stay clickable.
   */
  hitTest?(element: ElementOf<T>, local: Point, ctx: HitTestContext): boolean;
  /**
   * [additive] Distance (world units, element-local unrotated `local`) from the point to what is
   * actually drawn: <= 0 on the ink/fill. Without `hitTest`, a hit is `distanceTo <= tolerance`.
   * Other features can ask it too (the eraser asks the pen's definition).
   */
  distanceTo?(element: ElementOf<T>, local: Point): number;
  /** Point on the outline for an anchor; default = bbox edge midpoints. */
  anchorPoint?(element: ElementOf<T>, anchor: 'top' | 'right' | 'bottom' | 'left'): Point;
  /**
   * [additive] Attach anywhere: where a line aimed from the element's center toward `toward`
   * (element-local, unrotated) meets its drawn outline, in element-local coordinates. A connector
   * end dropped on the edge of an ellipse sits on the curve. Default: the bounding box edge.
   */
  outlinePoint?(element: ElementOf<T>, toward: Point): Point;
  /**
   * Plain-text extraction for copy as text, previews (Layers, voting) and accessibility. `editor`
   * is the caller's, on the element's board: read content kept outside the element (a table's
   * cells) through it, never through a module-level handle that outlives the board.
   */
  toPlainText?(element: ElementOf<T>, editor: Editor): string;
  /**
   * Called after a LOCAL create/update so derived fields stay valid (e.g. auto height). `prev` is
   * the element before this change (undefined on create), so a definition can tell what changed
   * (a side-handle resize changes `w` alone; a corner scale changes `w` and `fontSize`).
   * Measure text with `measureRichText` (what ElementText renders). The engine re-runs it for the
   * elements this client measured once web fonts finish loading (no undo entry).
   */
  normalize?(element: ElementOf<T>, prev?: ElementOf<T>): ElementPatch<ElementOf<T>> | null;
  /**
   * Paste / drag-and-drop import. The engine offers clipboard or dropped data to every
   * definition with importData, highest importPriority first, until one returns true.
   * (e.g. images claim image files; text claims plain text.) Engine-native clipboard
   * payloads (copied Freero elements) are handled by the engine before this.
   */
  importData?(
    editor: Editor,
    data: { files: File[]; text: string | null; html: string | null },
    at: Point,
  ): boolean | Promise<boolean>;
  importPriority?: number;
  /**
   * [additive] Elements with SEVERAL texts (table cells, extra connector labels): the part under
   * `local` (element-local, unrotated). Double-clicking there, or clicking the already selected
   * element there, edits that part: `startEditing(id, { part })`. The component renders that
   * part with `<ElementText part=… value=… onCommit=…>`. null = not on a part (the engine falls
   * back to `textField`, if any).
   */
  textPartAt?(element: ElementOf<T>, local: Point, ctx: { editor: Editor; zoom: number }): string | null;
  /**
   * [additive] Every existing text part (see `textPartAt`) with its rich text, besides
   * `textField`: table cells, extra connector labels. Read through `Editor.getTextParts`, which
   * board-wide tools (find & replace) use, so a new multi-text element is searchable by
   * defining this. `editor` is scoped to the defining feature.
   */
  textParts?(element: ElementOf<T>, editor: Editor): TextPart[];
  /**
   * [additive] Writes one part named by `textParts` (what the part's `onCommit` does). `editor`
   * is scoped to the defining feature, so it may write that feature's own collections. Called
   * by `Editor.setTextParts`, inside its transaction, with the live element.
   */
  writeTextPart?(element: ElementOf<T>, part: string, html: string, editor: Editor): void;
  /**
   * [additive] Content an element keeps OUTSIDE the elements map, in its feature's collections
   * (table cells). Copy/cut put what this returns into the clipboard payload; duplicate,
   * Alt-drag and paste hand it to `pasteContent` with each NEW copy, inside the transaction that
   * creates it (one undo step), so copies never share or lose that content.
   */
  copyContent?(element: ElementOf<T>, editor: Editor): unknown;
  /** [additive] See `copyContent`. `element` is the new copy; write with the scoped `editor`. */
  pasteContent?(element: ElementOf<T>, content: unknown, editor: Editor): void;
  /** [additive] Show the rotate handle for this type. Default true (frames set false). */
  rotatable?: boolean;
  /**
   * [additive] Remove the element when a text edit session ends with empty text
   * (free text boxes). Default false (stickies/shapes stay).
   */
  removeWhenEmpty?: boolean;
  /**
   * [additive] Keeps fields derived from OTHER elements valid (connector endpoints attached to
   * shapes). Called for every element of this type inside the same transaction (one undo step,
   * one network update) as each LOCAL `update`/`updateMany`/`remove`, after that change is in
   * the store. Remote changes never call it, so only the client making a change writes the
   * derived fields. Return the fields to rewrite, or null (the common, cheap case).
   */
  follow?(element: ElementOf<T>, change: FollowChange): ElementPatch<ElementOf<T>> | null;
  /**
   * [additive] Not on the board right now (a collapsed mind-map branch): not rendered, not
   * exported, and ignored by hit testing, marquee, selection, snapping, bounds and zoom-to-fit.
   * Called often: keep it cheap. `editor` is scoped to the defining feature.
   */
  hidden?(element: ElementOf<T>, editor: Editor): boolean;
  /**
   * [additive] Containers only: true while this container hides its contents from viewers and
   * commenters. Its contents then live in the 'editors' layer, which the server never sends to
   * them (moved there and back by the engine on every owner/editor client); non-editors see
   * none of it, owners/editors see and edit it as usual.
   */
  hidesContents?(element: ElementOf<T>): boolean;
  /**
   * [additive] Ids this element is drawn against (a connector's attached ends). While any of them
   * is hidden for this viewer (`Editor.setViewHidden` — itself or a container it sits in), this
   * element is hidden for them too, so nothing is left pointing at empty space. Called often:
   * keep it cheap.
   */
  hiddenWith?(element: ElementOf<T>): ReadonlyArray<string | null | undefined>;
  /**
   * [additive] Ids that must be deleted together with this element, in the same transaction
   * (one undo step restores them all): a mind-map node's subtree. Applied recursively by every
   * LOCAL `editor.remove` (Delete, cut, context menu, eraser…).
   */
  removeWith?(element: ElementOf<T>, editor: Editor): string[];
  /**
   * [additive] Keys pressed while this type is selected (and no text is being edited), asked
   * BEFORE the engine's own keys and command shortcuts (Enter = edit text, Delete, Tab…).
   * Return true when handled (the engine then prevents the default). `selection` is the whole
   * selection; `editor` is scoped to the defining feature.
   */
  onKeyDown?(e: KeyboardEvent, ctx: { editor: Editor; selection: BoardElement[] }): boolean | void;
  /**
   * [additive] What `onKeyDown` (and keys this type's text parts handle, like table cells) does,
   * for the shortcut reference: `Editor.getShortcuts()` lists them under the feature (kind
   * 'key'). Declare every key next to the handler; undeclared keys are invisible to users.
   */
  keys?: ElementKey[];
  /** [additive] Extra style for the element's positioned world wrapper (e.g. mix-blend-mode). */
  wrapperStyle?(element: ElementOf<T>): CSSProperties | undefined;
  /**
   * [additive] false = the engine draws no bounding-box selection frame, resize/rotate handles
   * or hover outline for this type; the feature draws its own (connectors: endpoint handles).
   * Default true.
   */
  selectionFrame?: boolean;
  /**
   * [additive] How far (world units) the element draws outside its box, e.g. a frame title above
   * its top edge. Used for export bounds and anything placed around an element's visual bounds.
   * `zoom` is the live camera zoom (for decorations sized in screen px).
   */
  visualOutset?(element: ElementOf<T>, zoom: number): Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  /**
   * [additive] Double-click on a resize handle: the patch that fits the element back to its
   * content along that handle (a fixed-width text box goes back to auto width). null = ignore.
   */
  fitToContent?(element: ElementOf<T>, handle: ResizeHandle): ElementPatch<ElementOf<T>> | null;
  /**
   * [additive] Double-click with the select tool on an element that has no text to edit there
   * (no `textPartAt` part, no `textField`): images enter crop mode. Editors only; runs inside the
   * click's gesture. `point` is in world coordinates; `editor` is scoped to the defining feature.
   */
  onDoubleClick?(element: ElementOf<T>, ctx: { editor: Editor; point: Point }): void;
  /**
   * [additive] Containers that LAY OUT their children (kanban columns, frame grids). After every
   * LOCAL change — when the outermost gesture ends if one is open (drag, edit session), else
   * right after the write — the engine asks each element of this type for the patches that put
   * its children (and itself) back in layout, and applies them in the same undo step. Remote
   * changes never run it. Must be idempotent (null when already laid out): it also runs after
   * unrelated changes. `editor` is scoped to the defining feature.
   */
  arrange?(element: ElementOf<T>, ctx: ArrangeContext): Array<{ id: string; patch: ElementPatch }> | null;
  /**
   * [additive] The look this type shares with other types, for editing a mixed selection (a
   * sticky, two shapes and a text box at once): return the CURRENT value of every `SharedStyle`
   * key the type has; leave out what it doesn't (a text box has no fill). The engine's
   * mixed-selection toolbar shows a control when two or more selected items have its key.
   */
  sharedStyle?(element: ElementOf<T>): SharedStyle;
  /**
   * [additive] The patch that applies `style` (only the keys being changed, and only keys this
   * type's `sharedStyle` reports) to this element, in its own fields: a sticky maps `fill` to its
   * nearest paper colour, a text box ignores `fontSize: 'auto'`. null/empty when nothing applies.
   * Default: each key is written to the field of the same name. The engine writes every selected
   * element's patch in one `updateMany` (one undo step); the definition stays the only place
   * that knows its fields.
   */
  applySharedStyle?(element: ElementOf<T>, style: SharedStyle): ElementPatch<ElementOf<T>> | null;
}

/** [additive] Style keys several element types share (see `ElementDefinition.sharedStyle`). */
export interface SharedStyle {
  /** Main colour as a css hex colour: a sticky's paper, a shape's or frame's fill, a card's accent. */
  fill?: string;
  /** Line / border colour. */
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  fontFamily?: FontFamily;
  /** px, or 'auto' (shrink to fit) for types that fit text to their box. */
  fontSize?: number | 'auto';
  textColor?: string;
  align?: TextAlign;
  vAlign?: VerticalAlign;
}

/** [additive] What `ElementDefinition.arrange` is told. */
export interface ArrangeContext {
  editor: Editor;
  /** Ids written (moved, created, edited) or removed by the local change(s) since the last pass. */
  touched: ReadonlySet<string>;
  /** Each touched element as it was BEFORE those changes (null: created by them). */
  previous: ReadonlyMap<string, BoardElement | null>;
}

/** [additive] One text of an element: `part` null = its `textField`, else a text part's name. */
export interface TextPart {
  part: string | null;
  /** RichText. */
  html: string;
}

/** [additive] What `ElementDefinition.hitTest` is told. */
export interface HitTestContext {
  /** World units around the drawn shape that still count as a hit (a few screen px). */
  tolerance: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** [additive] What `ElementDefinition.follow` is told about a local change. */
export interface FollowChange {
  /** Scoped to the defining feature; reads already see the change. Don't write from follow. */
  editor: Editor;
  /** Ids written by the change (including the follower itself when it was written). */
  changed: ReadonlySet<string>;
  /** Ids deleted by the change. */
  removed: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export interface ToolPointerEvent {
  editor: Editor;
  /**
   * World coordinates. On the grid while grid snapping applies to this event (see
   * `ToolDefinition.snapToGrid`); `target` is always what is under the real pointer.
   */
  point: Point;
  /** Screen (viewport-relative) coordinates. */
  screen: Point;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean; // meta OR ctrl
  /**
   * The button that changed: on down/up 0 = primary, 1 = middle, 2 = secondary. On EVERY move
   * (hover and drag alike) it is -1, so never use it to tell a drag from a hover: use `buttons`.
   */
  button: number;
  /** [additive] Pressed-buttons bitmask (1 primary, 2 secondary, 4 middle); 0 while hovering. */
  buttons: number;
  pressure: number;
  pointerType: string;
  /** Element under the pointer, if any (topmost). */
  target: BoardElement | null;
}

export interface ToolDefinition {
  id: string;
  label: string;
  /** Any icon component accepting lucide-style props (lucide-react icons fit as-is). */
  icon: ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  /** Single key, e.g. 'n' for sticky. Shown in tooltip. */
  shortcut?: string;
  /** Position in the left toolbar (lower = higher up). Built-ins: select 0, hand 1. */
  order: number;
  /** 'main' = shown in toolbar; 'more' = inside the "+" apps/more panel. */
  placement: 'main' | 'more';
  /** Minimum role allowed to activate. Default 'editor'. */
  minRole?: Role;
  cursor?: string;
  /**
   * [additive] Grid snapping for creation tools, default true. While the board's "Snap to grid"
   * applies (Ctrl/⌘ inverts it, Alt disables it), the engine hands this tool grid points as
   * `ToolPointerEvent.point`, and elements it creates during a pointer down/move/up land with
   * their top-left on the grid (several created at once move together). Freehand tools (pen,
   * eraser), tools aimed at elements (connector, comments) and select set false.
   */
  snapToGrid?: boolean;
  /** Optional flyout shown next to the toolbar while active (shape picker, pen colors…). */
  Options?: ComponentType<{ editor: Editor }>;
  /** World-space preview layer while the tool is active (e.g. ghost sticky following cursor). */
  Preview?: ComponentType<{ editor: Editor }>;
  /**
   * [additive] Act-now tool (upload image, open templates): picking it — toolbar, "+" grid or
   * shortcut — calls this, still inside the click's user activation, and the tool never becomes
   * active (the current tool stays). onActivate/pointer handlers are then unused.
   */
  onSelect?(editor: Editor): void;
  /**
   * [additive] Element types this tool adds (default: the element type named like the tool, if
   * any; none for select, comments, eraser…). A facilitator's limits hide tools that add a type
   * participants may not add (`Editor.getLimits`), and `listAddableTypes` is built from it.
   */
  creates?: ElementType[];
  /**
   * [additive] Double-click on empty canvas (or a frame's empty area) with the select tool: "write
   * here". The first tool by `order` that defines it gets the world point (the text tool drops a
   * text box and starts typing). Runs inside the click's gesture, so it is one undo step with the
   * typing that follows.
   */
  onCanvasDoubleClick?(editor: Editor, point: Point): void;
  onActivate?(editor: Editor): void;
  onDeactivate?(editor: Editor): void;
  onPointerDown?(e: ToolPointerEvent): void;
  onPointerMove?(e: ToolPointerEvent): void;
  onPointerUp?(e: ToolPointerEvent): void;
  /** Return true if handled. */
  onKeyDown?(editor: Editor, e: KeyboardEvent): boolean | void;
  /** Escape / tool switch mid-gesture. */
  onCancel?(editor: Editor): void;
}

// ---------------------------------------------------------------------------
// Format sections (contextual toolbar above the selection)
// ---------------------------------------------------------------------------
export interface FormatDefinition {
  id: string;
  /** Lower = further left. Engine's common controls (lock, more) are always last. */
  order: number;
  appliesTo(selection: BoardElement[]): boolean;
  Component: ComponentType<{ editor: Editor; selection: BoardElement[] }>;
}

// ---------------------------------------------------------------------------
// Panels — UI mounted into named slots of the board chrome.
// ---------------------------------------------------------------------------
export type PanelSlot =
  | 'topbar-left'      // after board title (e.g. undo/redo, board menu items)
  | 'topbar-right'     // collaboration cluster (presence avatars, timer, voting, present, share)
  | 'bottom-left'      // e.g. frames list toggle
  | 'bottom-right'     // next to zoom controls (minimap toggle, comments toggle)
  | 'dock-right'       // side panel content (comments list, frames, templates)
  | 'screen-overlay'   // full-viewport screen-space layer (cursors, reaction bursts, timers)
  | 'top-center'       // [additive] session bars under the top bar (voting, "X is presenting"):
                       // stacked in a column so several never overlap; stays while presenting
  | 'world-overlay'    // world-space layer above elements (comment pins, vote badges)
  | 'dialog';          // [additive] mounted only while opened with editor.openPanel(id, props); stays
                       // available while the chrome is hidden (presenting). Close: editor.closePanel(id).

/** [additive] Props every panel component gets. `props` = what `openPanel(id, props)` passed (dialogs). */
export interface PanelProps {
  editor: Editor;
  props?: Record<string, unknown>;
}

export interface PanelDefinition {
  id: string;
  slot: PanelSlot;
  order: number;
  minRole?: Role;
  Component: ComponentType<PanelProps>;
}

// ---------------------------------------------------------------------------
// Commands — keyboard shortcuts and menu entries.
// ---------------------------------------------------------------------------
export interface CommandDefinition {
  id: string; // globally unique, namespaced: '<feature>.<verb>'
  label: string;
  /** e.g. 'mod+d', 'shift+1', 'g'. 'mod' = Ctrl on Windows/Linux, Cmd on macOS. */
  shortcut?: string;
  /**
   * [additive] Further bindings that run the same command, e.g. a layout-independent one for a
   * punctuation shortcut some keyboards can't press. Listed in the shortcut reference after
   * `shortcut`; menus show `shortcut` only.
   */
  extraShortcuts?: string[];
  /** Where it appears besides the shortcut: right-click menu and/or the board "…" menu. */
  menus?: Array<'context' | 'board'>;
  /** [additive] Icon shown in the context and board menus (lucide-style component). */
  icon?: ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  /**
   * [additive] Submenu label: menu commands sharing a `group` show as one "<group> ▸" entry whose
   * submenu lists them (in definition order), e.g. 'React with' → one command per stamp.
   */
  group?: string;
  minRole?: Role;
  when?(editor: Editor): boolean;
  /**
   * [additive] Why `when` is false right now ("Select two or more items"), for the command
   * palette, which lists unavailable commands greyed out with this reason. A function may name
   * what's missing from the live board. Without it the palette says "Not available right now".
   */
  disabledReason?: string | ((editor: Editor) => string | undefined);
  /**
   * [additive] A short live detail shown after the label in menus and the command palette (a
   * count: "Sticky notes (12)", a state: "Snap to grid (on)"). Called while the menu is open.
   */
  detail?(editor: Editor): string | undefined;
  /**
   * [additive] Offer it in the command palette (`Editor.listActions`). Default: when it has a
   * `shortcut` or `menus` — anything a person can already invoke. Commands that only other
   * features run with `args` have neither, so they never show; `true` lists one that has
   * neither (board settings), `false` hides one that has them (the palette's own shortcut).
   */
  palette?: boolean;
  /**
   * `args` [additive]: what `editor.runCommand(id, args)` passed (undefined from shortcuts and
   * menus). How features ask another feature to act on something specific (open this comment
   * thread) without importing it; validate them, they come from another feature.
   */
  run(editor: Editor, args?: Record<string, unknown>): void;
  /**
   * [additive] Deep link: when the board URL carries `?<urlParam>=<value>` the engine runs this
   * command with `{ [urlParam]: value }` once the board is synced — on load, and whenever the app
   * navigates to such a link while the board is open (a notification opening a comment thread:
   * `comments.openThread` with `urlParam: 'thread'`). Respects `minRole` like any run.
   */
  urlParam?: string;
}

/** [additive] A key an element type handles itself (`ElementDefinition.keys`). */
export interface ElementKey {
  /** Raw bindings like `ShortcutEntry.shortcuts` ('enter', 'alt+arrowup'), alternatives in order. */
  shortcuts: string[];
  /** What it does, e.g. 'Add a sibling topic'. */
  label: string;
  /** Lowest role it does anything for (default 'editor'); lower roles don't see it listed. */
  minRole?: Role;
}

/** [additive] One row of `Editor.getShortcuts()`. */
export interface ShortcutEntry {
  /** Tool / command id, or 'engine.key.<name>' for built-in keys. */
  id: string;
  label: string;
  /**
   * Raw bindings ('mod+shift+z', 'shift+/', 'arrowup'), alternatives in order. 'mod' = ⌘ on
   * macOS, Ctrl elsewhere: show them with `@ui` `Kbd` / `formatShortcut`, which follow the platform.
   */
  shortcuts: string[];
  kind: 'tool' | 'command' | 'key';
  /** Contributing feature ('engine' for built-ins). */
  feature: string;
}

/**
 * [additive] One row of `Editor.listActions()`: something a person can do on the board right now
 * or, greyed out, could do with another selection or role. Run a command with
 * `editor.runCommand(id)` and a tool with `editor.setTool(id)`.
 */
export interface ActionEntry {
  /** Command or tool id. */
  id: string;
  kind: 'command' | 'tool';
  /** Reads on its own: a command's `group` is folded in ("Select all of this type"). */
  label: string;
  /** Raw bindings like `ShortcutEntry.shortcuts` (empty when it has none). */
  shortcuts: string[];
  /** Contributing feature ('engine' for built-ins). */
  feature: string;
  icon?: ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  /** `CommandDefinition.detail` right now. */
  detail?: string;
  /** null when it can run now; otherwise why not (role, selection…). */
  disabledReason: string | null;
}

// ---------------------------------------------------------------------------
// Decorations (features/<name>/decoration.tsx) — [additive] world-space extras drawn INSIDE
// another feature's element wrapper (sticky tag chips). They move, rotate, cull and EXPORT with
// the element, unlike world-overlay panels. Render props mirror ElementRenderProps.
// ---------------------------------------------------------------------------
export interface DecorationDefinition {
  id: string;
  /** Lower = drawn first. */
  order?: number;
  /** Cheap check, called on every render of every element. */
  appliesTo(element: BoardElement): boolean;
  /** Positioned in the element's box (0,0 = its top-left, w × h, rotated with it). */
  Component: ComponentType<{ element: BoardElement; zoom: number }>;
  /**
   * Space this decoration covers along the element's edges (world units), so the element keeps
   * its own content clear of it: the element receives the per-side maximum over all applying
   * decorations as `ElementRenderProps.reserved`. Pure, cheap; only called when `appliesTo`.
   */
  reserve?(element: BoardElement): Partial<Insets>;
}

// ---------------------------------------------------------------------------
// Feature manifest (features/<name>/feature.ts — required).
// ---------------------------------------------------------------------------
export interface FeatureManifest {
  /** Must equal the folder name. */
  name: string;
  description: string;
  /** Yjs top-level maps this feature is the single writer of. */
  owns?: string[];
  /**
   * [additive] Owned collections whose LOCAL writes join the undo history like element writes
   * (one step per gesture / edit session). For content that belongs to elements (table cells);
   * never for social data (comments, votes) that undo must not take back.
   */
  undoable?: string[];
  /** Ephemeral presence key this feature writes (PresenceState.ext[name]). Defaults to `name`. */
}

/** What the app passes to the engine after discovering features/*. */
export interface FeatureBundle {
  manifest: FeatureManifest;
  elements: ElementDefinition<any>[];
  tools: ToolDefinition[];
  formats: FormatDefinition[];
  panels: PanelDefinition[];
  commands: CommandDefinition[];
  /** [additive] commands.ts exporting `defineCommands(ctx => [...])`: run once the registry knows every element. */
  commandFactories?: CommandFactory[];
  /** [additive] decoration.tsx */
  decorations?: DecorationDefinition[];
}

// ---------------------------------------------------------------------------
// Collections — feature-owned durable data (one Y.Map per name).
// An Editor handed to a feature component is SCOPED to that feature: writes to
// a collection the feature doesn't own throw:
//   "Collection 'votes' is owned by feature 'voting'; run one of its commands instead."
// Reads of any collection are allowed.
// ---------------------------------------------------------------------------
export interface Collection<T> {
  get(key: string): T | undefined;
  entries(): Array<[string, T]>;
  set(key: string, value: T): void;
  delete(key: string): void;
  observe(cb: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Editor — the single writer of board state. All mutations go through here.
// ---------------------------------------------------------------------------
export type EditorEvent =
  | 'selection'
  | 'camera'
  | 'tool'
  | 'elements'
  | 'presence'
  | 'editing'
  | 'connection'
  /** [additive] The USER moved the camera (wheel, pan, pinch, zoom controls/shortcuts, minimap) — never setCamera. */
  | 'camera-user'
  /** [additive] getFollowing() changed. */
  | 'follow';

/** [additive] Whom this client follows: a user, optionally pinned to one of their tabs. */
export interface FollowTarget {
  userId: string;
  /** Presence client (tab) to mirror; when it leaves, another tab of the same user takes over. */
  clientId?: number;
  /**
   * [additive] A facilitator's "follow me": the user's own camera moves, Esc and canvas clicks
   * don't end it (the view eases back), nor does the person leaving for a moment; other
   * `follow()` calls are ignored until one with `{ force: true }` (the feature that locked it).
   */
  locked?: boolean;
}

/** [additive] Options for zoomToFit / zoomToRect. */
export interface FitOptions {
  /** Screen px kept free around the content inside the area. */
  padding?: number;
  animate?: boolean;
  maxZoom?: number;
  /** 'safe' (default) = the part of the screen not covered by chrome (getSafeArea); 'viewport' = all of it. */
  area?: 'safe' | 'viewport';
}

export interface Editor {
  readonly host: Host;
  readonly boardId: string;
  readonly user: HostUser;
  /** Effective role (from the server's role message; falls back to host.board.role). */
  getRole(): Role;
  can(minRole: Role): boolean;
  /**
   * [additive] What a facilitator limits for this user right now (from the server's role message;
   * null: nothing). The server enforces it; the engine mirrors it: a locked board is commenting
   * only (`getRole()` is then 'commenter'), and tools / paste / inserts that would add other types
   * than `addTypes` are refused with a toast and hidden from the toolbar. Hook: useLimits().
   */
  getLimits(): SessionLimits | null;
  /** [additive] May this user add elements of `type` now (role and facilitator limits)? */
  mayAdd(type: ElementType): boolean;
  /**
   * [additive] Element types the board's tools add, in toolbar order (each tool's
   * `ToolDefinition.creates`): what a facilitator can allow participants to add.
   */
  listAddableTypes(): ElementType[];
  /** Feature this editor instance is scoped to ('engine' for the unscoped one). */
  readonly scope: string;

  // -- elements (reads) --
  getElement<T extends BoardElement = BoardElement>(id: string): T | undefined;
  /** All elements sorted by render order (frames first, then by z). */
  getElements(): BoardElement[];
  getDefinition(type: ElementType): ElementDefinition<any> | undefined;
  /**
   * Rotated-aware axis-aligned bounds of the given ids (or all elements). Hidden elements never
   * count. `visual` adds each definition's visualOutset (frame titles…), as exports draw them.
   */
  getBounds(ids?: string[], opts?: { visual?: boolean }): Rect | null;
  hitTest(point: Point, opts?: { exclude?: string[]; types?: ElementType[] }): BoardElement | null;
  elementsInRect(rect: Rect, mode?: 'intersect' | 'contain'): BoardElement[];
  getAnchorPoint(id: string, anchor: 'top' | 'right' | 'bottom' | 'left'): Point | null;

  // -- elements (writes; no-ops with a toast for read-only roles) --
  create<T extends ElementType>(el: NewElement<T>, opts?: { select?: boolean }): string;
  createMany(els: NewElement[], opts?: { select?: boolean }): string[];
  update<T extends BoardElement = BoardElement>(id: string, patch: ElementPatch<T>): void;
  updateMany(patches: Array<{ id: string; patch: ElementPatch }>): void;
  remove(ids: string[]): void;
  /** Groups writes into one undo step and one network update. */
  transact(fn: () => void): void;
  /**
   * [additive] Moves elements by per-element offsets in one transaction, like a drag would:
   * connector endpoints/waypoints move along, a container's children travel with it, locked
   * elements stay put, and moved elements join/leave containers by the drop rule (center).
   * Programmatic arranging (align, distribute, tidy up) uses it.
   */
  moveBy(moves: Array<{ id: string; dx: number; dy: number }>): void;
  /**
   * [additive] Gesture grouping: every local write between beginGesture() and the matching
   * endGesture() merges into ONE undo step (nestable). The engine already wraps each tool
   * pointer-down → pointer-up sequence and each text edit session in a gesture; call these
   * only for other continuous interactions (e.g. dragging a slider in a format section).
   */
  beginGesture(): void;
  endGesture(): void;
  /**
   * [additive] Ends the outermost gesture by REVERTING every local write made since its
   * beginGesture(), leaving no undo step (Escape during a drag). Inside a nested gesture it only
   * ends that level (the outer gesture owns the writes).
   */
  cancelGesture(): void;
  bringToFront(ids: string[]): void;
  sendToBack(ids: string[]): void;
  /**
   * [additive] One step up / down the stacking order: each item moves past the next item it
   * overlaps (items it doesn't overlap make no visible difference, so they are skipped), keeping
   * the selected items' order among themselves; riders (`attachedTo`) move with their item.
   * Frames only ever step among frames (they always render below other items). One undo step.
   */
  bringForward(ids: string[]): void;
  sendBackward(ids: string[]): void;
  duplicate(ids: string[], offset?: Point): string[];
  group(ids: string[]): void;
  ungroup(ids: string[]): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  copy(ids?: string[]): void;
  cut(ids?: string[]): void;
  paste(at?: Point): void;
  /**
   * [additive] A portable copy of `ids` (default: the whole board) with their frame children and
   * copied content — exactly what copy puts on the clipboard. null when there is nothing.
   * Read-only, any role.
   */
  exportElements(ids?: string[]): ElementsSnapshot | null;
  /**
   * [additive] Inserts a snapshot the way paste does, in one transaction (one undo step): fresh
   * ids with references between the inserted elements remapped (frames, groups, connectors,
   * mind-map parents), copied content restored, membership by the drop rule. Lands centered on
   * `at`, or by default on a free spot near the viewport center (`findFreeSpot`). Unknown element
   * types are skipped. Selects and returns the top-level inserted ids ([] for read-only roles).
   */
  insertElements(snapshot: ElementsSnapshot, opts?: { at?: Point }): string[];

  // -- selection & editing --
  getSelection(): string[];
  select(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void;
  clearSelection(): void;
  getEditingId(): string | null;
  /**
   * `part` [additive] edits one of the element's several texts (see `textPartAt`) instead of its
   * `textField`. Switching part ends the previous edit session (one undo step per part).
   */
  startEditing(id: string, opts?: { selectAll?: boolean; initialText?: string; part?: string }): void;
  /** [additive] The part being edited (startEditing's `part`), or null. */
  getEditingPart(): string | null;
  /**
   * [additive] Every text of an element as rich text: its `textField` (part null) when set,
   * then each of its definition's `textParts`. Empty for unknown ids.
   */
  getTextParts(id: string): TextPart[];
  /**
   * [additive] Rewrites texts of one element in ONE transaction: part null writes `textField`,
   * any other part goes through the definition's `writeTextPart` with an editor scoped to the
   * defining feature (so a table's cells are still written by the table feature).
   */
  setTextParts(id: string, parts: TextPart[]): void;
  stopEditing(): void;
  /**
   * Rich-text formatting. While editing, applies to the current text selection; otherwise
   * applies to the whole text of every selected element that has a textField.
   */
  formatText(
    cmd: 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'bullets' | 'numbers' | 'color' | 'highlight' | 'clear',
    value?: string,
  ): void;
  /** Formatting state at the caret / of the selection, for toggle buttons. */
  getTextFormatState(): { bold: boolean; italic: boolean; underline: boolean; strike: boolean; bullets: boolean; numbers: boolean; link: string | null };

  // -- camera --
  getCamera(): Camera;
  setCamera(camera: Camera, opts?: { animate?: boolean }): void;
  getViewportSize(): { width: number; height: number };
  screenToWorld(p: Point): Point;
  worldToScreen(p: Point): Point;
  zoomTo(zoom: number, screenCenter?: Point): void;
  /**
   * Fits the elements (default: all) — including their visualOutset — into the safe area
   * (see FitOptions.area). maxZoom defaults to 1.
   */
  zoomToFit(ids?: string[], opts?: FitOptions): void;
  /** Fits a world rect into the safe area (see FitOptions.area). maxZoom defaults to the engine max. */
  zoomToRect(rect: Rect, opts?: FitOptions): void;
  /** Center of the viewport in world coords (where "insert" actions place content). */
  getViewportCenter(): Point;
  /**
   * [additive] Where to insert new content of `size` (world units) without overlapping anything:
   * the top-left of a box that keeps `gap` (default 48) clear of every element, as close as
   * possible to having its center on `near` (default: getViewportCenter()), preferring spots
   * fully in view. Insert actions (templates, uploaded images) use it.
   */
  findFreeSpot(size: { w: number; h: number }, opts?: { near?: Point; gap?: number }): Point;
  /**
   * [additive] Screen rect (viewport px) not covered by the board chrome: left toolbar, top bar,
   * bottom-right controls and the open right dock. The whole viewport while the chrome is hidden.
   */
  getSafeArea(): Rect;
  /**
   * [additive] Follow someone's view: the camera mirrors theirs until this client moves the camera
   * itself (wheel, pan, zoom, a canvas click, Esc, any setCamera) or they leave. null stops. Others
   * see it in PresenceState.following, and the followed client publishes its view faster.
   */
  follow(target: FollowTarget | null, opts?: { force?: boolean }): void;
  getFollowing(): FollowTarget | null;
  /**
   * [additive] Hide other people's cursors (local view, any role; not synced). Their selections
   * and "is typing" outlines stay. Hook: useCursorsHidden().
   */
  setCursorsHidden(hidden: boolean): void;
  areCursorsHidden(): boolean;

  // -- tools --
  getToolId(): string;
  setTool(id: string): void;
  /** Ephemeral per-tool options (e.g. chosen shape kind, pen color). Not synced. */
  getToolOptions<T = Record<string, unknown>>(toolId: string): T;
  setToolOptions(toolId: string, patch: Record<string, unknown>): void;

  // -- commands --
  /** Runs a command as its feature (role and `when` checked). `args` [additive] go to its `run`. */
  runCommand(id: string, args?: Record<string, unknown>): void;

  // -- board settings (engine-owned 'settings' map) --
  getSettings(): BoardSettings;
  updateSettings(patch: Partial<BoardSettings>): void;

  // -- collections --
  collection<T>(name: string): Collection<T>;

  // -- board layers: content the SERVER withholds (ARCHITECTURE.md "Board layers") --
  /**
   * [additive] Where an element lives: 'shared' (everyone with access), 'private' (only this
   * user, until an owner/editor reveals it), 'editors' (inside a hidden frame: owners/editors
   * only), or null if there is no such element.
   */
  layerOf(id: string): ElementLayer | null;
  /**
   * [additive] Private mode: NEW elements this user creates that match `rule` go to their
   * private layer, which the server sends to nobody else. One rule at a time (the private-mode
   * feature owns it); null turns it off. Existing private elements stay private until revealed.
   * While a rule is set, this user's cursor is not shown to others where a new sticky would go
   * private (or over their private items), and presence never names private elements.
   */
  setPrivatePlacement(rule: ((el: BoardElement) => boolean) | null): void;
  /**
   * [additive] This user's PRIVATE copy of a collection the scope owns (same ownership guard as
   * `collection`): synced only between this user's own tabs, never readable by anyone else until
   * an owner/editor reveals it with `revealPrivate`. For sealed ballots and similar.
   */
  privateCollection<T>(name: string): Collection<T>;
  /**
   * [additive] Owners/editors: asks the server to move EVERY participant's private entries of
   * `collection` (keys starting with `prefix`) into the shared doc in one transaction, removing
   * them from the private layers ('elements' reveals private-mode drafts). Works while their
   * authors are offline. Runs in order with this client's writes; queued while disconnected.
   * Only people who may still edit the board take part. `mine`: only this user's own entries.
   */
  revealPrivate(collection: string, opts?: { prefix?: string; mine?: boolean }): void;
  /** [additive] Like revealPrivate, but deletes those private entries without revealing them. */
  discardPrivate(collection: string, opts?: { prefix?: string; mine?: boolean }): void;

  // -- presence --
  getPeers(): Array<PresenceState & { clientId: number }>;
  /** Writes PresenceState.ext[scope] for this client. */
  setPresenceExt(value: unknown): void;

  // -- rendering / export --
  /** Renders the given elements (or a world rect) to a data URL (PNG or SVG). */
  renderToDataUrl(opts: {
    ids?: string[];
    rect?: Rect;
    format: 'png' | 'svg' | 'jpeg';
    scale?: number;
    background?: string | null;
    padding?: number;
    /** Don't embed web fonts (faster; text falls back to installed fonts). */
    skipFonts?: boolean;
    /**
     * [additive] Called (before the promise resolves) when some images could not be read — a host
     * without CORS that the server can't reach either — and were left out of the picture.
     */
    onMissingImages?: (count: number) => void;
  }): Promise<string>;

  // -- UI state --
  /** Open/close the right dock with a panel id (or null to close). */
  openDock(panelId: string | null): void;
  getDock(): string | null;
  /**
   * [additive] Opens a panel from anywhere (a command, a button): a 'dialog' panel mounts with
   * `props` (one dialog at a time, also while the chrome is hidden); a 'dock-right' panel opens the
   * dock. closePanel(id) closes it if it is the open one; closePanel() closes the open dialog.
   */
  openPanel(id: string, props?: Record<string, unknown>): void;
  closePanel(id?: string): void;
  /**
   * [additive] Hide the board chrome (toolbar, top bar, zoom controls + minimap, format toolbar,
   * context menu, docks) and the local selection/hover overlays — used by presentation mode.
   * 'screen-overlay' and 'world-overlay' panels stay mounted. Not synced; local UI state only.
   */
  setChromeHidden(hidden: boolean): void;
  isChromeHidden(): boolean;
  /**
   * [additive] "Hidden for me": a local view filter (not synced, not saved, any role). Hidden ids —
   * and everything inside a hidden container — are treated like `ElementDefinition.hidden`
   * elements for THIS viewer only (not drawn, not hit-tested, not selectable, dropped from the
   * selection), while collaborators and exports/thumbnails still see them. Hook: useViewHidden().
   */
  setViewHidden(ids: string[], hidden: boolean): void;
  getViewHidden(): string[];
  /**
   * [additive] Every keyboard binding the board answers right now, for the current role: tool
   * keys, command shortcuts and the engine's built-in keys (Esc, arrows, Tab, Space…). Generated
   * from the registry, so a shortcut reference built on it can't drift from the real bindings.
   */
  getShortcuts(): ShortcutEntry[];
  /**
   * [additive] Every tool and every user-facing command (`CommandDefinition.palette`) with its
   * shortcuts and, when it can't run now, the reason (role, `when` + `disabledReason`). Built
   * from the same registry as `getShortcuts`, so a palette built on it can't drift either.
   */
  listActions(): ActionEntry[];
  /**
   * [additive] Whether the view filter hides this element for this viewer: it is in
   * getViewHidden(), sits in a container that is, or is drawn against one that is
   * (`ElementDefinition.hiddenWith`). False for unknown ids.
   */
  isViewHidden(id: string): boolean;

  // -- events --
  on(event: EditorEvent, cb: () => void): () => void;
}

// ---------------------------------------------------------------------------
// define* helpers — identity functions that give features type inference.
// Each reserved file default-exports exactly one of these (or an array).
// ---------------------------------------------------------------------------
export const defineFeature = (m: FeatureManifest): FeatureManifest => m;
export const defineElement = <T extends ElementType>(d: ElementDefinition<T>): ElementDefinition<T> => d;
export const defineTool = (d: ToolDefinition): ToolDefinition => d;
export const defineFormat = (d: FormatDefinition): FormatDefinition => d;
export const definePanel = (d: PanelDefinition): PanelDefinition => d;

/** [additive] `Host.versions` for hosts without version history (offline sandbox, tests). */
export function unavailableVersionHistory(reason: string): VersionHistory {
  const no = async (): Promise<never> => Promise.reject(new Error(reason));
  return { list: no, load: no, nameCurrent: no, rename: no, restore: no };
}
/**
 * [additive] What a command factory is told (`defineCommands(ctx => [...])`): the board's live
 * registry, for commands that exist once per element type ("Select only ▸ Sticky notes").
 */
export interface CommandFactoryContext {
  /** Every registered element definition. */
  elements: ReadonlyArray<ElementDefinition<any>>;
}

export type CommandFactory = (ctx: CommandFactoryContext) => CommandDefinition[];

export function defineCommands(d: CommandDefinition[]): CommandDefinition[];
export function defineCommands(d: CommandFactory): CommandFactory;
export function defineCommands(d: CommandDefinition[] | CommandFactory): CommandDefinition[] | CommandFactory {
  return d;
}
export const defineDecoration = (d: DecorationDefinition): DecorationDefinition => d;

/** Children helper type for slot components. */
export type Slot = { children?: ReactNode };
