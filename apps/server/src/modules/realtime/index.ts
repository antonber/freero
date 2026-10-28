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
} from './rooms';
// Version history (stored snapshots of a board's document): list them, read one's full Yjs state.
// The REST API for it is this module's routes.ts (history.ts); pruning: retention.ts.
export { listSnapshots as listBoardSnapshots, loadSnapshot as loadBoardSnapshot, type SnapshotInfo } from './docStore';
// The uploads board documents reference (the uploads sweep keeps those files).
export { boardUploadReferences } from './uploadRefs';
