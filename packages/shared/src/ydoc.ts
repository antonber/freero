// Layout of the per-board Yjs document.
//
// Single-writer rule: every top-level shared type has exactly one owner.
//   doc.getMap('elements')   owner: engine (apps/web/src/engine/store) — BoardElement by id
//   doc.getMap('settings')   owner: engine — BoardSettings fields
//   doc.getMap(<collection>) owner: the feature whose feature.ts declares it in `owns`
//
// Feature collections currently claimed (keep in sync with features/*/feature.ts;
// the engine throws at startup if two features claim the same name):
//   'comments' -> features/comments   (CommentRecord per key: t:/s:/m:/r:/x: — see elements.ts)
//   'tags'     -> features/tags       (Tag by id)
//   'timer'    -> features/timer      (key 'state' -> TimerState)
//   'tableCells' -> features/table (cell text/fill per key — see TableElement in elements.ts)
//   'voting'   -> features/voting     (key 'session' -> VotingSession, `${sessionId}:${userId}` -> VoteBallot)
//
// Content some connections must not read (private drafts, sealed ballots, hidden frames'
// contents) never enters this doc: it lives in server-held LAYER docs with the same layout (an
// `elements` map, feature collections) until revealed — see WS_MESSAGE_LAYER in api.ts.
//
// The server relays and persists updates. It drops all updates from viewers, and for
// commenters accepts only changes confined to the collections listed in COMMENTER_WRITABLE —
// and in 'comments' only records the commenter owns (see CommentRecord in elements.ts and
// apps/server/src/modules/realtime/commentRules.ts).

export const Y_ELEMENTS = 'elements';
export const Y_SETTINGS = 'settings';

/** Top-level types a commenter may modify (server-enforced). */
export const COMMENTER_WRITABLE = ['comments'] as const;

export interface BoardSettings {
  background: string;
  grid: 'dots' | 'lines' | 'none';
  /** World units between grid lines/dots (and the snap-to-grid step). */
  gridSize: number;
  /** Moves and resizes snap to the grid (Ctrl/⌘ while dragging inverts it). */
  snapToGrid: boolean;
}

/** Grid sizes offered in the board menu. */
export const GRID_SIZES = [8, 16, 24, 32, 48] as const;

export interface TimerState {
  /** Epoch ms when the timer reaches zero (when running). */
  endsAt: number | null;
  /** Total duration in ms for the current run. */
  duration: number;
  /** Remaining ms when paused. */
  pausedRemaining: number | null;
  running: boolean;
  startedBy: string | null;
}

export interface VotingSession {
  id: string;
  active: boolean;
  title: string;
  votesPerUser: number;
  /** If set, only these element ids can be voted on; otherwise all stickies/cards/shapes. */
  elementIds: string[] | null;
  /** Hide results until the session ends. */
  anonymous: boolean;
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
}

export interface VoteBallot {
  sessionId: string;
  userId: string;
  /** May contain duplicates (multiple votes on the same element). */
  elementIds: string[];
  /** Voter's display name/color at vote time, for "who has voted" avatars after they leave. */
  userName?: string;
  userColor?: string;
}

/** Yjs awareness state published by each client (written only by the engine). */
export interface PresenceState {
  /** Replaced by the server with the socket's authenticated user (no impersonation). */
  user: { id: string; name: string; color: string; avatarUrl?: string | null };
  /** World coordinates, or null when the pointer is off-canvas. */
  cursor: { x: number; y: number } | null;
  selection: string[];
  /** Current camera, used for "follow" and presentation. */
  viewport: { x: number; y: number; zoom: number; width: number; height: number } | null;
  /** Free-form per-feature ephemeral state, keyed by feature name (e.g. presenting, reaction). */
  ext?: Record<string, unknown>;
  /** Element currently being text-edited by this user. */
  editingId?: string | null;
  /** User id whose view this client is following (Editor.follow), or null. */
  following?: string | null;
}
