// Public API of modules/realtime [S2].
export {
  copyState as copyBoardDoc,
  destroyBoardDoc as deleteBoardDoc,
  refreshRoomAccess as refreshBoardAccess,
  flushAllRooms,
} from './rooms';
