// Public API of modules/stickers [S2]: a workspace's own sticker sets (#138).
import * as repo from './repo';

export { listStickers, createSet, addSticker, removeSet, removeSticker } from './service';

/**
 * Upload names team stickers use, restricted to `among` when given (the uploads sweep): a set
 * outlives the boards its stickers were placed on, so its files must too.
 */
export function stickerUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.uploadNames(among ?? null);
}
