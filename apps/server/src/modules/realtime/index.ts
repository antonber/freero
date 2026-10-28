// Public API of modules/realtime [S2].
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
} from './rooms';
// Comment messages written on this instance, attributed to the socket's user (notifications).
export { onCommentMessage, type CommentMessageEvent } from './comments';
// Version history (stored snapshots of a board's document): list them, read one's full Yjs state.
// The REST API for it is this module's routes.ts (history.ts); pruning: retention.ts.
export { listSnapshots as listBoardSnapshots, loadSnapshot as loadBoardSnapshot, type SnapshotInfo } from './docStore';
// Data exports (modules/privacy): board content and the comments a person wrote.
export { exportBoardContent, commentsWrittenBy, type BoardContentExport, type CommentThreadExport } from './dataExport';
// The uploads board documents reference (the uploads sweep keeps those files).
export { boardUploadReferences, storedBoardContent } from './uploadRefs';
