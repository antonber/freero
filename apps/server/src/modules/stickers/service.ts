// Team sticker sets (#138): who may see, make, fill and remove a workspace's sets.
//
// - See and place: anyone in the workspace (guests too: they place stickers on boards they edit).
// - Make a set, add stickers: its full members (not guests).
// - Remove a set (and any sticker in it): the set's creator, or a workspace owner / admin; who added
//   a sticker may also remove that sticker.
//
// A sticker's image goes through uploads' saveUpload like any image (type allowlist, the bytes must
// be that image, the uploader's quota) under a smaller cap of its own, so a set can't be filled
// with a file that would not have been accepted as an image, nor with someone else's upload.
import {
  MAX_STICKER_BYTES,
  MAX_STICKER_NAME,
  MAX_STICKER_SETS,
  MAX_STICKERS_PER_SET,
  type Sticker,
  type StickerSet,
  type StickersResponse,
} from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { boardWorkspaceId, requireBoardAccess } from '../boards/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import { isFullMember, isManager, workspaceRole } from '../workspaces/index';
import * as repo from './repo';
import type { StoredSet, StoredSticker } from './repo';

/** Image types a sticker may be (no PDF, video or attachment). */
const STICKER_TYPES = new Set(['image/png', 'image/svg+xml', 'image/webp', 'image/gif']);

function cleanName(v: unknown, what: string): string {
  if (typeof v !== 'string') throw badRequest(`${what} name is required`);
  const t = v.replace(/\s+/g, ' ').trim().slice(0, MAX_STICKER_NAME);
  if (!t) throw badRequest(`Give the ${what} a name`);
  return t;
}

const urlOf = (s: StoredSticker): Sticker => ({ id: s.id, name: s.name, url: `/uploads/${s.uploadName}` });

/** The board's workspace, for someone who can open the board (404 otherwise). */
async function boardWorkspace(boardId: string, userId: string): Promise<string> {
  await requireBoardAccess(boardId, userId, 'viewer');
  const ws = await boardWorkspaceId(boardId);
  if (!ws) throw notFound('Board not found');
  return ws;
}

/** A set and the caller's role in its workspace; 404 unless they are in that workspace. */
async function setFor(setId: string, userId: string) {
  const set = await repo.getSet(setId);
  const role = set ? await workspaceRole(set.workspaceId, userId) : null;
  if (!set || !role) throw notFound('Sticker set not found');
  return { set, role };
}

const mayManage = (set: StoredSet, userId: string, role: Parameters<typeof isManager>[0]) => isManager(role) || set.createdBy === userId;

/** The sticker sets of the board's workspace, as `userId` may use them. */
export async function listStickers(boardId: string, userId: string): Promise<StickersResponse> {
  const workspaceId = await boardWorkspace(boardId, userId);
  const role = await workspaceRole(workspaceId, userId);
  // On the board through a board invite only: the team's stickers aren't theirs to see.
  if (!role) return { sets: [], canCreate: false };
  const sets = await repo.setsIn(workspaceId);
  const [stickers, people] = await Promise.all([repo.stickersOf(sets.map((s) => s.id)), getUsers(sets.flatMap((s) => (s.createdBy ? [s.createdBy] : [])))]);
  const bySet = new Map<string, Sticker[]>();
  for (const s of stickers) bySet.set(s.setId, [...(bySet.get(s.setId) ?? []), urlOf(s)]);
  return {
    canCreate: isFullMember(role),
    sets: sets.map(
      (s): StickerSet => ({
        id: s.id,
        name: s.name,
        createdBy: s.createdBy ? (people.get(s.createdBy)?.name ?? null) : null,
        canAdd: isFullMember(role),
        canManage: mayManage(s, userId, role),
        stickers: bySet.get(s.id) ?? [],
      }),
    ),
  };
}

/** A new, empty set in the board's workspace. */
export async function createSet(boardId: string, userId: string, body: unknown): Promise<StickerSet> {
  const workspaceId = await boardWorkspace(boardId, userId);
  const role = await workspaceRole(workspaceId, userId);
  if (!isFullMember(role)) throw forbidden('Only members of this board’s workspace can make sticker sets');
  const name = cleanName((body as { name?: unknown } | null)?.name, 'sticker set');
  const set: StoredSet = { id: newId(), workspaceId, name, createdBy: userId, createdAt: Date.now() };
  await repo.transaction(async () => {
    await repo.lockWorkspaceSets(workspaceId);
    if ((await repo.countSets(workspaceId)) >= MAX_STICKER_SETS)
      throw badRequest(`A workspace can have at most ${MAX_STICKER_SETS} sticker sets. Remove one you no longer use first.`);
    await repo.insertSet(set);
  });
  const [me] = (await getUsers([userId])).values();
  return { id: set.id, name, createdBy: me?.name ?? null, canAdd: true, canManage: true, stickers: [] };
}

/**
 * Adds an image to a set: stored through uploads' checks (the bytes must be the declared image
 * type, the uploader's quota applies), at most MAX_STICKER_BYTES.
 */
export async function addSticker(setId: string, userId: string, data: Uint8Array, contentType: string, name: unknown): Promise<Sticker> {
  const { set, role } = await setFor(setId, userId);
  if (!isFullMember(role)) throw forbidden('Only members of this workspace can add stickers');
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (!STICKER_TYPES.has(type)) throw new HttpError(415, 'Stickers are PNG, SVG, WebP or GIF images');
  if (data.byteLength > MAX_STICKER_BYTES) throw new HttpError(413, `A sticker can be at most ${MAX_STICKER_BYTES / 1024}KB`);
  const label = cleanName(name, 'sticker');
  const url = await saveUpload(data, type, userId);
  const sticker: StoredSticker = { id: newId(), setId: set.id, name: label, uploadName: url.slice('/uploads/'.length), createdBy: userId, createdAt: Date.now() };
  try {
    await repo.transaction(async () => {
      await repo.lockSet(set.id);
      if (!(await repo.getSet(set.id))) throw notFound('Sticker set not found');
      if ((await repo.countStickers(set.id)) >= MAX_STICKERS_PER_SET) throw badRequest(`A sticker set holds at most ${MAX_STICKERS_PER_SET} stickers`);
      await repo.insertSticker(sticker);
    });
  } catch (e) {
    await deleteUpload(url);
    throw e;
  }
  return urlOf(sticker);
}

/**
 * Removes a set. Stickers already placed on boards stay (they hold their image's URL); the files
 * nothing references any more go with the uploads sweep.
 */
export async function removeSet(setId: string, userId: string): Promise<void> {
  const { set, role } = await setFor(setId, userId);
  if (!mayManage(set, userId, role)) throw forbidden('Only who made this set or a workspace admin can remove it');
  await repo.transaction(async () => {
    await repo.deleteSet(set.id);
    await recordAudit({
      action: 'stickers.set_removed',
      workspaceId: set.workspaceId,
      actorId: userId,
      target: { type: 'sticker_set', id: set.id, label: set.name },
    });
  });
}

export async function removeSticker(setId: string, stickerId: string, userId: string): Promise<void> {
  const { set, role } = await setFor(setId, userId);
  const sticker = await repo.getSticker(set.id, stickerId);
  if (!sticker) throw notFound('Sticker not found');
  if (!mayManage(set, userId, role) && sticker.createdBy !== userId) throw forbidden('Only who added this sticker, who made its set or a workspace admin can remove it');
  await repo.deleteSticker(set.id, sticker.id);
}
