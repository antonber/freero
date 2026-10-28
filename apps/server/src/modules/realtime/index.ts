// Public API of modules/realtime [S2].
import { commentPeople, COMMENTS_COLLECTION } from './comments';
import type { BoardView } from './view';

export {
  snapshotBoardDoc,
  initBoardDoc,
  snapshotBoardLayer,
  snapshotBoardLayers,
  initBoardLayer,
  closeBoardDoc,
  refreshRoomAccess as refreshBoardAccess,
  flushAllRooms,
  renameCommentAuthor,
  commentPeopleOf,
  readBoardView,
  changeBoard,
  // An app writing through the API or MCP, shown on the board for a moment (KAI-168).
  showAgentPresence,
  type AgentPresence,
} from './rooms';
// The board as one reader sees it (their role's layers applied) and the one request-time write
// path for board content (one transaction, published and saved): the outline and structure
// modules read and write boards through these, never through Yjs.
export {
  BoardChangeError,
  type BoardReader,
  type BoardActor,
  type BoardView,
  type BoardChange,
  type AppliedChange,
  type ViewLayer,
} from './view';
/** User ids that appear in a board view's comments (authors, @mentions). */
export const commentPeopleIn = (view: BoardView): Set<string> => commentPeople(view.collection(COMMENTS_COLLECTION));
// Comment messages written on this instance, attributed to the socket's user (notifications).
export { onCommentMessage, type CommentMessageEvent } from './comments';
// Element changes applied from this instance's sockets or requests, attributed to their user (activity feed).
export { onBoardChange, type BoardChangeEvent, type ElementChange } from './changes';
// Version restores (the activity feed, KAI-188).
export { onVersionRestored, type VersionRestoredEvent } from './history';
// Version history (stored snapshots of a board's document): list them, read one's full Yjs state.
// The REST API for it is this module's routes.ts (history.ts); pruning: retention.ts.
export { listSnapshots as listBoardSnapshots, loadSnapshot as loadBoardSnapshot, type SnapshotInfo } from './docStore';
// Data exports (modules/privacy): board content and the comments a person wrote.
export { exportBoardContent, commentsWrittenBy, type BoardContentExport, type CommentThreadExport } from './dataExport';
// The uploads board documents reference (the uploads sweep keeps those files).
export { boardUploadReferences, storedBoardContent } from './uploadRefs';
