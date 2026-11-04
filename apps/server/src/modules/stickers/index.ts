// Public API of modules/stickers [S2]: a workspace's own sticker sets (#138).
import * as repo from './repo';

export { listStickers, createSet, addSticker, removeSet, removeSticker } from './service';

/**
 * Data exports (modules/privacy, the workspace export): every sticker set of the workspace with its
 * stickers — name, who added it (user id), when, and the upload holding its image (`uploadName`;
 * the archive carries the files).
 */
export async function stickerSetsExportOf(workspaceId: string) {
  const sets = await repo.setsIn(workspaceId);
  const stickers = await repo.stickersOf(sets.map((s) => s.id));
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    createdBy: s.createdBy,
    createdAt: new Date(s.createdAt).toISOString(),
    stickers: stickers
      .filter((k) => k.setId === s.id)
      .map((k) => ({ id: k.id, name: k.name, uploadName: k.uploadName, createdBy: k.createdBy, createdAt: new Date(k.createdAt).toISOString() })),
  }));
}

/**
 * Upload names team stickers use, restricted to `among` when given (the uploads sweep): a set
 * outlives the boards its stickers were placed on, so its files must too.
 */
export function stickerUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.uploadNames(among ?? null);
}
