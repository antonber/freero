// Local (non-synced) UI state for one board session. Written only by the engine (Editor + tools).
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Role } from '@freero/shared';
import type { Camera, Rect } from '../api';
import type { SnapGuide } from '../geometry/snap';
import type { ConnectionStatus } from '../store/BoardStore';

export type TransformKind = 'translate' | 'resize' | 'rotate' | 'marquee' | 'pan' | 'tool' | null;

export interface EditRequest {
  id: string;
  selectAll?: boolean;
  initialText?: string;
  /** Monotonic counter so repeated requests for the same id re-trigger focus. */
  nonce: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  /** World point where the menu was opened (used by paste). */
  world: { x: number; y: number };
}

export interface UiState {
  selection: string[];
  toolId: string;
  camera: Camera;
  viewport: { width: number; height: number };
  editingId: string | null;
  editRequest: EditRequest | null;
  dock: string | null;
  toolOptions: Record<string, Record<string, unknown>>;
  hoverId: string | null;
  marquee: Rect | null;
  guides: SnapGuide[];
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
  /** Board chrome hidden (presentation mode). */
  chromeHidden: boolean;
}

export interface PointerState {
  /** Viewport-relative screen point. */
  screen: { x: number; y: number } | null;
  world: { x: number; y: number } | null;
  inside: boolean;
}

export function createPointerStore(): StoreApi<PointerState> {
  return createStore<PointerState>(() => ({ screen: null, world: null, inside: false }));
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
    dock: null,
    toolOptions: {},
    hoverId: null,
    marquee: null,
    guides: [],
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
    chromeHidden: false,
  }));
}
