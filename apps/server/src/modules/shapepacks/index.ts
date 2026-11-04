// Public API of modules/shapepacks [S2]: a workspace's own icon and shape packs, and a person's own
// library of them (#4). Routes are routes.ts; a pack's workspace or account deletion cascades.
export { listPacks, createPack, renamePack, removePack } from './service';
import { packsExportOf } from './service';

/**
 * Data exports (modules/privacy): the packs a workspace keeps, or a person keeps for themselves,
 * each with every icon's sanitised drawing (what the library places; the uploaded files are gone).
 */
export function shapePacksExportOf(by: { workspaceId: string } | { ownerId: string }) {
  return packsExportOf(by);
}
