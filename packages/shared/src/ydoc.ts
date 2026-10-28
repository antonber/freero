import { tableCellOwner } from './elements';

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
//   'tableCells' -> features/table (cell text/fill per key — see TableElement in elements.ts;
//                                     element content: in the table's doc, ELEMENT_CONTENT_COLLECTIONS)
//   'privateMode' -> features/private-mode (key 'session' -> PrivateModeSession)
//   'voting'   -> features/voting     (key 'session' -> VotingSession, `${sessionId}:${userId}` -> VoteBallot;
//                                     while results are hidden the real ballot is in the voter's
//                                     PRIVATE layer and the shared key holds a `sealed` marker)
//   'facilitation' -> features/facilitation (key 'session' -> FacilitationSession; READ BY THE
//                                     SERVER: realtime/facilitation.ts enforces it)
//   'estimation' -> features/estimation (planning poker; sealed estimates in the PRIVATE layer)
//   'retro'    -> features/retro      (key 'session' -> the guided retro's phase)
//   'presenterNotes' -> features/present (frame id -> the presenter's notes for that slide; element
//                                     content: in the frame's doc)
//   'diagramSources' -> features/from-text (diagram id -> the source a diagram was laid out from
//                                     and what that layout wrote; board content, so a restored
//                                     version brings back the source that matches its diagram)
//
// Content some connections must not read (private drafts, sealed ballots, hidden frames'
// contents) never enters this doc: it lives in server-held LAYER docs with the same layout (an
// `elements` map, feature collections) until revealed — see WS_MESSAGE_LAYER in api.ts.
//
// A new collection is board CONTENT by default (restoring a version rolls it back); social /
// session collections go in Y_KEPT_ON_RESTORE below.
//
// The server never interprets contents (except to restore a version: top-level maps of JSON
// values, and to check commenters' writes); it relays and persists updates. It drops all updates
// from viewers, and for commenters accepts only changes confined to the collections listed in
// COMMENTER_WRITABLE — and in 'comments' only records the commenter owns (see CommentRecord in
// elements.ts and apps/server/src/modules/realtime/commentRules.ts).

export const Y_ELEMENTS = 'elements';
export const Y_SETTINGS = 'settings';

/** Top-level types a commenter may modify (server-enforced). */
export const COMMENTER_WRITABLE = ['comments'] as const;

/**
 * Collections whose entries BELONG to an element (KAI-230): content an element keeps outside the
 * elements map, keyed so that the owning element's id can be read from the key. An entry lives in
 * the SAME doc as its element — the shared doc, the `editors` layer (inside a hidden frame) or its
 * author's private layer — and moves with it, atomically, whenever the element moves (hidden /
 * shown frame, a sticky dragged in or out, a draft revealed or discarded). Otherwise a table in a
 * hidden frame or a private draft would still send its cell text to every socket.
 *
 * Applied by the engine on every write and move (engine/store, editor/layers.ts), and by the server
 * on requests (realtime/view.ts applyChange), reveals (layers.ts), a socket's misplaced writes and
 * when a board loads (realtime/elementContent.ts). Both runtimes need it, so it lives here, like
 * Y_KEPT_ON_RESTORE. Value: the id of the element a key belongs to (null: no element's).
 *
 * Not here on purpose (ARCHITECTURE.md "Board layers", per-collection audit): `diagramSources`
 * (one record per diagram, many elements: from-text keeps one only while the whole diagram is
 * shared), and social / session collections (votes, tags, timers; comments on withheld items:
 * KAI-234).
 */
export const ELEMENT_CONTENT_COLLECTIONS: Readonly<Record<string, (key: string) => string | null>> = {
  tableCells: tableCellOwner,
  // frame id -> the presenter's notes for that frame
  presenterNotes: (key) => key || null,
  // activity id -> its live results (ENGAGE_RESULTS_COLLECTION; written by the server only, which
  // also moves them: see SERVER_WRITTEN_COLLECTIONS)
  engageResults: (key) => key || null,
};

/** The element `key` of `collection` belongs to, or null (not an element-content collection, or no owner). */
export function elementContentOwner(collection: string, key: string): string | null {
  const owner = Object.prototype.hasOwnProperty.call(ELEMENT_CONTENT_COLLECTIONS, collection) ? ELEMENT_CONTENT_COLLECTIONS[collection] : null;
  return owner ? owner(key) : null;
}

export const isElementContentCollection = (name: string): boolean => Object.prototype.hasOwnProperty.call(ELEMENT_CONTENT_COLLECTIONS, name);

/**
 * Top-level types that restoring an older version (version history) leaves as they are: social
 * and session data (the conversation, a vote, the timer), not board content. Everything else —
 * elements, settings and content collections (tags, table cells) — goes back to the version.
 * A new social / session collection belongs here. 'voting' also holds the "has voted" markers of
 * a sealed vote (rolling them back would desync them from the ballots in the private layers), and
 * 'privateMode' is session state: rolling it back could restart private mode (new content going
 * private again) or end it while drafts are still sealed. Layer docs are never versioned or
 * restored (see "Board layers" in ARCHITECTURE.md).
 */
export const Y_KEPT_ON_RESTORE = ['comments', 'voting', 'timer', 'privateMode', 'facilitation', 'estimation', 'retro', 'engageResults', 'call'] as const;

/**
 * Facilitator controls (KAI-129): the `facilitation` collection, key FACILITATION_KEY. While it is
 * set, every editor but the facilitator is limited (never the board owner), and the SERVER enforces it
 * (apps/server/src/modules/realtime/facilitation.ts): a locked board drops their writes except
 * comments (they are commenters for the session), and they cannot add elements of other types
 * than `allowedTypes`. Only the facilitator (or the board owner) may change or end it; the server
 * ends it when the facilitator has been gone for a while. Following and hidden cursors are each
 * client's view and only applied by the clients.
 */
export const FACILITATION_COLLECTION = 'facilitation';
export const FACILITATION_KEY = 'session';
export interface FacilitationSession {
  /** The facilitator's user id: their sockets are never limited. */
  by: string;
  byName: string;
  startedAt: number;
  /** Everyone else may only comment. */
  locked: boolean;
  /** Element types everyone else may ADD (null: any). */
  allowedTypes: string[] | null;
  /** Everyone else's view follows the facilitator. */
  follow: boolean;
  /** Remote cursors are hidden for everyone. */
  cursorsHidden: boolean;
}

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

/**
 * Dot voting: the `voting` collection (key VOTING_SESSION_KEY -> VotingSession, `${sessionId}:${userId}`
 * -> VoteBallot). The SERVER enforces the budget (apps/server/src/modules/realtime/votingRules.ts):
 * a socket may write only its own ballot, only for the running session, with at most the
 * session's votesPerUser votes, in the shared doc and in its private layer; and a running session's
 * budget can't be raised after the fact.
 */
export const VOTING_COLLECTION = 'voting';
export const VOTING_SESSION_KEY = 'session';
export const VOTES_PER_USER_MIN = 1;
export const VOTES_PER_USER_MAX = 20;

export interface VotingSession {
  id: string;
  active: boolean;
  title: string;
  votesPerUser: number;
  /** If set, only these element ids can be voted on; otherwise all stickies/cards/shapes. */
  elementIds: string[] | null;
  /**
   * Hide results until the session ends. Server-enforced: ballots are written to each voter's
   * private layer (nobody else can read them) and revealed into this doc when the session ends.
   */
  anonymous: boolean;
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
}

/**
 * Live audience activities (KAI-132): results of each `activity` element, keyed by its id. Written
 * ONLY by the server (modules/engage through realtime): a socket's write to this collection, in
 * the shared doc or a layer, is undone in the same transaction (realtime/serverCollections.ts).
 */
export const ENGAGE_RESULTS_COLLECTION = 'engageResults';

/**
 * Collections only the SERVER writes (apps/server/src/modules/realtime/serverCollections.ts undoes
 * any socket's change to them). When one of them is also element content
 * (ELEMENT_CONTENT_COLLECTIONS), the server — never a client — keeps each entry with its element.
 */
export const SERVER_WRITTEN_COLLECTIONS: readonly string[] = [ENGAGE_RESULTS_COLLECTION];

export interface ActivityResults {
  activityId: string;
  /** How many people answered (Q&A: asked or upvoted). */
  respondents: number;
  /** Results withheld until an editor reveals them (`results: 'reveal'`): only `respondents` is set. */
  sealed: boolean;
  updatedAt: number;
  /** Per choice, in the element's order. `names`: who picked it, only for answers given while not anonymous. */
  poll?: Array<{ optionId: string; count: number; names?: string[] }>;
  /** Most frequent first (at most ENGAGE_MAX_CLOUD_WORDS). */
  words?: Array<{ word: string; count: number }>;
  /** Best first: Borda points (first place = number of items) and the average place (1 = top). */
  ranking?: Array<{ optionId: string; points: number; avgRank: number }>;
  /** Per statement: the average, how many rated it and how many gave each value 1..scale. */
  rating?: Array<{ optionId: string; avg: number; count: number; dist: number[] }>;
  /** Most upvoted first; hidden questions left out. `by`: the asker's name unless asked anonymously. */
  questions?: Array<{ id: string; text: string; by?: string; votes: number; answered: boolean; at: number }>;
}

/** Private mode: while active, what participants add stays in their private layer until revealed. */
export interface PrivateModeSession {
  active: boolean;
  startedBy: string;
  startedByName: string;
  startedAt: number;
  /** Only content added inside this frame goes private (null: the whole board). */
  frameId: string | null;
}

export interface VoteBallot {
  sessionId: string;
  userId: string;
  /** May contain duplicates (multiple votes on the same element). */
  elementIds: string[];
  /**
   * Marker in the shared doc while results are hidden: this user has voted, the ballot itself is
   * sealed in their private layer (elementIds is then empty) until the session ends.
   */
  sealed?: boolean;
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
  /**
   * Set only by the SERVER, for an app writing through the API or MCP for a person (KAI-168): a
   * short-lived presence ("Claude for Maria", its cursor on what it just wrote). Sockets can't
   * publish it: the server replaces a socket's `user`, and agent presence uses a user id of its own.
   */
  agent?: { app: string; forUserId: string };
}
