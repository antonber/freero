// Local (non-synced) UI state for one board session. Written only by the engine (Editor + tools).
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Role } from '@freero/shared';
import type { Camera, FollowTarget, Rect } from '../api';
import type { GapGuide, SnapGuide } from '../geometry/snap';
import type { ConnectionStatus } from '../store/BoardStore';

export type TransformKind = 'translate' | 'resize' | 'rotate' | 'marquee' | 'pan' | 'tool' | null;

export interface EditRequest {
  id: string;
  selectAll?: boolean;
  initialText?: string;
  /** [additive] Part of the element being edited (ElementDefinition.textPartAt), if any. */
  part?: string;
  /** Monotonic counter so repeated requests for the same id re-trigger focus. */
  nonce: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  /** World point where the menu was opened (used by paste). */
  world: { x: number; y: number };
  /** Opened from the keyboard (Shift+F10 / Menu key) at the selection, not at a pointer. */
  keyboard?: boolean;
}

export interface UiState {
  selection: string[];
  toolId: string;
  camera: Camera;
  viewport: { width: number; height: number };
  editingId: string | null;
  editRequest: EditRequest | null;
  /** [additive] Part of `editingId` being edited (table cell, extra connector label), or null. */
  editingPart: string | null;
  dock: string | null;
  toolOptions: Record<string, Record<string, unknown>>;
  hoverId: string | null;
  marquee: Rect | null;
  guides: SnapGuide[];
  /** Equal-spacing distance markers while dragging (see geometry/snap). */
  gaps: GapGuide[];
  transforming: TransformKind;
  connection: ConnectionStatus;
  synced: boolean;
  role: Role;
  contextMenu: ContextMenuState | null;
  spaceHeld: boolean;
  minimapOpen: boolean;
  /** Bumped on caret/selection changes inside the text editor so format buttons refresh. */
  textStateVersion: number;
  /** Bumped when undo/redo availability may have changed. */
  undoVersion: number;
  /** Bumped when presence (peers) changes. */
  presenceVersion: number;
  /** Bumped when board settings change. */
  settingsVersion: number;
  /** True while the camera is moving (pan/zoom/animation): lets the world layer use will-change. */
  cameraMoving: boolean;
  /** Small label near the pointer during transforms (e.g. "45°", "240 × 120"). */
  hint: { text: string; x: number; y: number } | null;
  /** Container highlighted as the drop target while dragging. */
  dropTargetId: string | null;
  /** Where the format toolbar is on screen (viewport px), null while hidden (useFormatToolbarRect). */
  formatToolbarRect: Rect | null;
  /** Board chrome hidden (presentation mode). */
  chromeHidden: boolean;
  /** Open 'dialog' panel (Editor.openPanel). */
  dialog: { id: string; props?: Record<string, unknown> } | null;
  /** Whose view this client follows (Editor.follow). */
  following: FollowTarget | null;
  /** Elements hidden for this viewer only (Editor.setViewHidden). Replaced, never mutated. */
  viewHidden: ReadonlySet<string>;
}

export interface PointerState {
  /** Viewport-relative screen point. */
  screen: { x: number; y: number } | null;
  world: { x: number; y: number } | null;
  inside: boolean;
  /** Modifiers held now (`metaKey` = Ctrl or ⌘), so hover previews follow the grid-snap rules. */
  mods: { metaKey: boolean; altKey: boolean };
}

export function createPointerStore(): StoreApi<PointerState> {
  return createStore<PointerState>(() => ({ screen: null, world: null, inside: false, mods: { metaKey: false, altKey: false } }));
}

export type UiStore = StoreApi<UiState>;

export function createUiStore(init: { role: Role }): UiStore {
  return createStore<UiState>(() => ({
    selection: [],
    toolId: 'select',
    camera: { x: -200, y: -150, zoom: 1 },
    viewport: { width: 1, height: 1 },
    editingId: null,
    editRequest: null,
    editingPart: null,
    dock: null,
    toolOptions: {},
    hoverId: null,
    marquee: null,
    guides: [],
    gaps: [],
    transforming: null,
    connection: 'connecting',
    synced: false,
    role: init.role,
    contextMenu: null,
    spaceHeld: false,
    minimapOpen: false,
    textStateVersion: 0,
    undoVersion: 0,
    presenceVersion: 0,
    settingsVersion: 0,
    cameraMoving: false,
    hint: null,
    dropTargetId: null,
    formatToolbarRect: null,
    chromeHidden: false,
    dialog: null,
    following: null,
    viewHidden: new Set<string>(),
  }));

}
