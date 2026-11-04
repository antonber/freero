// Public API of modules/shapepacks [S2]: a workspace's own icon and shape packs (#4). Routes are
// routes.ts; other modules need nothing from it yet (a pack's workspace deletion cascades).
export { listPacks, createPack, renamePack, removePack } from './service';
