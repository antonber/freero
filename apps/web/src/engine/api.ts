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

import type { ComponentType, ReactNode } from 'react';
import type {
  BoardElement,
  BoardSettings,
  ElementOf,
  ElementType,
  PresenceState,
  Role,
} from '@freero/shared';

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
  board: { id: string; title: string; role: Role };
  /** Full ws URL prefix; engine connects WebsocketProvider(syncUrl, board.id, doc). */
  syncUrl: string;
  uploadImage(file: Blob): Promise<{ url: string }>;
  renameBoard(title: string): Promise<void>;
  saveThumbnail(dataUrl: string): Promise<void>;
  openShareDialog(): void;
  navigate(path: string): void;
  /** Lightweight toast from anywhere. */
  notify(message: string, kind?: 'info' | 'success' | 'error'): void;
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
}

export type ResizeMode =
  | 'free'         // any aspect
  | 'aspect'       // always keep aspect ratio (images, emoji)
  | 'scale'        // scale content including font size (text), keep aspect
  | 'width-only'   // text with autoWidth=false wraps; height auto
  | 'none';

export interface ElementDefinition<T extends ElementType = ElementType> {
  type: T;
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
  /** Precise hit test in element-local unrotated coordinates; default = bounding box. */
  hitTest?(element: ElementOf<T>, local: Point): boolean;
  /** Point on the outline for an anchor; default = bbox edge midpoints. */
  anchorPoint?(element: ElementOf<T>, anchor: 'top' | 'right' | 'bottom' | 'left'): Point;
  /** Plain-text extraction for search, export alt text, and accessibility. */
  toPlainText?(element: ElementOf<T>): string;
  /** Called after a geometry/content change so derived fields stay valid (e.g. auto height). */
  normalize?(element: ElementOf<T>): ElementPatch<ElementOf<T>> | null;
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
  /** [additive] Show the rotate handle for this type. Default true (frames set false). */
  rotatable?: boolean;
  /**
   * [additive] Remove the element when a text edit session ends with empty text
   * (free text boxes). Default false (stickies/shapes stay).
   */
  removeWhenEmpty?: boolean;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export interface ToolPointerEvent {
  editor: Editor;
  /** World coordinates. */
  point: Point;
  /** Screen (viewport-relative) coordinates. */
  screen: Point;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean; // meta OR ctrl
  button: number;
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
  /** Optional flyout shown next to the toolbar while active (shape picker, pen colors…). */
  Options?: ComponentType<{ editor: Editor }>;
  /** World-space preview layer while the tool is active (e.g. ghost sticky following cursor). */
  Preview?: ComponentType<{ editor: Editor }>;
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
  | 'world-overlay';   // world-space layer above elements (comment pins, vote badges)

export interface PanelDefinition {
  id: string;
  slot: PanelSlot;
  order: number;
  minRole?: Role;
  Component: ComponentType<{ editor: Editor }>;
}

// ---------------------------------------------------------------------------
// Commands — keyboard shortcuts and menu entries.
// ---------------------------------------------------------------------------
export interface CommandDefinition {
  id: string; // globally unique, namespaced: '<feature>.<verb>'
  label: string;
  /** e.g. 'mod+d', 'shift+1', 'g'. 'mod' = Ctrl on Windows/Linux, Cmd on macOS. */
  shortcut?: string;
  /** Where it appears besides the shortcut: right-click menu and/or the board "…" menu. */
  menus?: Array<'context' | 'board'>;
  minRole?: Role;
  when?(editor: Editor): boolean;
  run(editor: Editor): void;
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
  | 'connection';

export interface Editor {
  readonly host: Host;
  readonly boardId: string;
  readonly user: HostUser;
  /** Effective role (from the server's role message; falls back to host.board.role). */
  getRole(): Role;
  can(minRole: Role): boolean;
  /** Feature this editor instance is scoped to ('engine' for the unscoped one). */
  readonly scope: string;

  // -- elements (reads) --
  getElement<T extends BoardElement = BoardElement>(id: string): T | undefined;
  /** All elements sorted by render order (frames first, then by z). */
  getElements(): BoardElement[];
  getDefinition(type: ElementType): ElementDefinition<any> | undefined;
  /** Rotated-aware axis-aligned bounds of the given ids (or all elements). */
  getBounds(ids?: string[]): Rect | null;
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
   * [additive] Gesture grouping: every local write between beginGesture() and the matching
   * endGesture() merges into ONE undo step (nestable). The engine already wraps each tool
   * pointer-down → pointer-up sequence and each text edit session in a gesture; call these
   * only for other continuous interactions (e.g. dragging a slider in a format section).
   */
  beginGesture(): void;
  endGesture(): void;
  bringToFront(ids: string[]): void;
  sendToBack(ids: string[]): void;
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

  // -- selection & editing --
  getSelection(): string[];
  select(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void;
  clearSelection(): void;
  getEditingId(): string | null;
  startEditing(id: string, opts?: { selectAll?: boolean; initialText?: string }): void;
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
  zoomToFit(ids?: string[], opts?: { padding?: number; animate?: boolean; maxZoom?: number }): void;
  zoomToRect(rect: Rect, opts?: { padding?: number; animate?: boolean }): void;
  /** Center of the viewport in world coords (where "insert" actions place content). */
  getViewportCenter(): Point;

  // -- tools --
  getToolId(): string;
  setTool(id: string): void;
  /** Ephemeral per-tool options (e.g. chosen shape kind, pen color). Not synced. */
  getToolOptions<T = Record<string, unknown>>(toolId: string): T;
  setToolOptions(toolId: string, patch: Record<string, unknown>): void;

  // -- commands --
  runCommand(id: string): void;

  // -- board settings (engine-owned 'settings' map) --
  getSettings(): BoardSettings;
  updateSettings(patch: Partial<BoardSettings>): void;

  // -- collections --
  collection<T>(name: string): Collection<T>;

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
  }): Promise<string>;

  // -- UI state --
  /** Open/close the right dock with a panel id (or null to close). */
  openDock(panelId: string | null): void;
  getDock(): string | null;

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
export const defineCommands = (d: CommandDefinition[]): CommandDefinition[] => d;

/** Children helper type for slot components. */
export type Slot = { children?: ReactNode };
