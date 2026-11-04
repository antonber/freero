// Shape packs (#4): who may see, upload and remove a workspace's packs, and how an upload becomes one.
//
// - See and place: anyone in the board's workspace (its guests too: they place icons on boards they
//   edit). Someone on a board through a board invite only sees none: the packs are the workspace's.
// - Upload, rename, remove: the workspace's owners and admins.
// - A person's own library (`personal`): anyone signed in uploads packs of their own from any board
//   they can open; those show to them on every board, to nobody else, and only they rename or
//   remove them (a workspace's admins never see them).
//
// The upload itself goes through modules/uploads like any file (its size cap, the uploader's quota
// and the upload rate limit): the app uploads a ZIP of SVGs (or one SVG) and names it here. It must
// be the caller's own upload; it is read once, every SVG in it reduced by `sanitizeSvg` to the
// primitives an icon element may draw, and deleted — nothing of the uploaded file is kept or served.
import { unzipSync } from 'fflate';
import {
  ICON_LIMITS,
  SHAPE_PACK_LIMITS,
  iconNameOf,
  sanitizeSvg,
  type ShapePack,
  type ShapePackCreated,
  type ShapePackIcon,
  type ShapePacksResponse,
} from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { boardWorkspaceId, requireBoardAccess } from '../boards/index';
import { deleteUpload, readUpload, uploadInfo } from '../uploads/index';
import { isManager, workspaceRole } from '../workspaces/index';
import * as repo from './repo';

/** Bytes a ZIP may unpack to (its SVGs together). */
const MAX_UNPACKED = 64 * 1024 * 1024;
const MAX_SKIPPED_LISTED = 50;

export interface ReadIcon {
  name: string;
  nodes: ShapePackIcon['nodes'];
  viewBox: string;
  art: 'mono' | 'color';
}

const isSvgEntry = (name: string) => /\.svg$/i.test(name) && !/(^|\/)(__MACOSX\/|\._)/.test(name);
const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * The icons in an uploaded file: every SVG of a ZIP (folders flattened, other files ignored), or the
 * file itself when it is one SVG (named `fallbackName`). SVGs that aren't readable or draw nothing
 * are skipped and listed. Pure.
 */
export function readPackFile(data: Uint8Array, fallbackName: string): { icons: ReadIcon[]; skipped: string[] } {
  const files: Array<[string, Uint8Array]> = [];
  const skipped: string[] = [];
  const isZip = data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  if (isZip) {
    let entries = 0;
    let unpacked = 0;
    let raw: Record<string, Uint8Array>;
    try {
      raw = unzipSync(data, {
        filter(f) {
          if (++entries > SHAPE_PACK_LIMITS.zipEntries) throw new HttpError(400, `A pack’s ZIP may hold at most ${SHAPE_PACK_LIMITS.zipEntries} files`, 'shape_pack_zip_too_many', { max: SHAPE_PACK_LIMITS.zipEntries });
          if (!isSvgEntry(f.name)) return false;
          if (f.originalSize > ICON_LIMITS.svgChars) {
            skipped.push(f.name);
            return false;
          }
          unpacked += f.originalSize;
          if (unpacked > MAX_UNPACKED) throw new HttpError(413, 'That ZIP unpacks to more than a pack may hold', 'shape_pack_too_large');
          return true;
        },
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw badRequest('That isn’t a ZIP file Freero can read', 'shape_pack_unreadable');
    }
    files.push(...Object.entries(raw));
  } else {
    files.push([`${fallbackName}.svg`, data]);
  }
  const icons: ReadIcon[] = [];
  for (const [path, bytes] of files.sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    const out = sanitizeSvg(decoder.decode(bytes));
    if (!out.ok) skipped.push(path);
    else icons.push({ name: iconNameOf(path), nodes: out.nodes, viewBox: out.viewBox, art: out.art });
  }
  return { icons, skipped };
}

function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('Give the pack a name', 'shape_pack_name');
  const t = v.replace(/\s+/g, ' ').trim().slice(0, SHAPE_PACK_LIMITS.name);
  if (!t) throw badRequest('Give the pack a name', 'shape_pack_name');
  return t;
}

/** The board's workspace and the caller's role in it, for someone who can open the board. */
async function boardWorkspace(boardId: string, userId: string) {
  await requireBoardAccess(boardId, userId, 'viewer');
  const workspaceId = await boardWorkspaceId(boardId);
  if (!workspaceId) throw notFound('Board not found');
  return { workspaceId, role: await workspaceRole(workspaceId, userId) };
}

/** A pack the caller may manage: their own, or their workspace's as its owner / admin; 404 unless they may see it. */
async function packFor(packId: string, userId: string) {
  const pack = await repo.getPack(packId);
  if (pack?.ownerId) {
    // Someone else's own library doesn't exist for anyone but them.
    if (pack.ownerId !== userId) throw notFound('Shape pack not found');
    return pack;
  }
  const role = pack?.workspaceId ? await workspaceRole(pack.workspaceId, userId) : null;
  if (!pack || !role) throw notFound('Shape pack not found');
  if (!isManager(role)) throw forbidden('Only this workspace’s owners and admins manage its shape packs', 'shape_pack_admins_only');
  return pack;
}

async function present(packs: repo.StoredPack[]): Promise<ShapePack[]> {
  const [icons, people] = await Promise.all([repo.iconsOf(packs.map((p) => p.id)), getUsers(packs.flatMap((p) => (p.createdBy ? [p.createdBy] : [])))]);
  const byPack = new Map<string, ShapePackIcon[]>();
  for (const ic of icons)
    byPack.set(ic.packId, [...(byPack.get(ic.packId) ?? []), { id: `${ic.packId}:${ic.position}`, name: ic.name, nodes: ic.nodes, viewBox: ic.viewBox, art: ic.art }]);
  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    createdBy: p.createdBy ? (people.get(p.createdBy)?.name ?? null) : null,
    createdAt: p.createdAt,
    icons: byPack.get(p.id) ?? [],
    personal: p.ownerId !== null,
  }));
}

/** The shape packs of the board's workspace, as `userId` may use them, then their own library. */
export async function listPacks(boardId: string, userId: string): Promise<ShapePacksResponse> {
  const { workspaceId, role } = await boardWorkspace(boardId, userId);
  // On the board through a board invite only: the workspace's packs aren't theirs to see.
  const shared = role ? await repo.packsIn({ workspaceId }) : [];
  return { packs: await present([...shared, ...(await repo.packsIn({ ownerId: userId }))]), canManage: isManager(role) };
}

/** The packs a workspace keeps, or a person keeps for themselves, with every drawing (data exports). */
export async function packsExportOf(home: repo.PackHome) {
  const packs = await present(await repo.packsIn(home));
  return packs.map(({ personal: _personal, ...p }) => ({ ...p, createdAt: new Date(p.createdAt).toISOString() }));
}

/**
 * A new pack in the board's workspace — or, with `personal: true`, in the caller's own library —
 * from the caller's upload (`{ name, upload: "/uploads/<name>", personal? }`).
 */
export async function createPack(boardId: string, userId: string, body: unknown): Promise<ShapePackCreated> {
  const b = (body ?? {}) as { name?: unknown; upload?: unknown; personal?: unknown };
  const { workspaceId, role } = await boardWorkspace(boardId, userId);
  const personal = b.personal === true;
  if (!personal && !isManager(role)) throw forbidden('Only this workspace’s owners and admins manage its shape packs', 'shape_pack_admins_only');
  const home: repo.PackHome = personal ? { ownerId: userId } : { workspaceId };
  const name = cleanName(b.name);
  const url = typeof b.upload === 'string' ? b.upload : '';
  const file = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : '';
  const info = file ? await uploadInfo(file) : null;
  // Someone else's upload is not theirs to turn into a pack (nor to delete): as if it didn't exist.
  if (!info || info.ownerId !== userId || info.removed) throw badRequest('Upload the pack’s SVGs (or a ZIP of them) first', 'shape_pack_upload');
  let read: ReturnType<typeof readPackFile>;
  try {
    const data = await readUpload(file);
    if (!data) throw badRequest('Upload the pack’s SVGs (or a ZIP of them) first', 'shape_pack_upload');
    read = readPackFile(data, name);
  } finally {
    // Read once: nothing of the uploaded file is kept, whatever happens next.
    await deleteUpload(url);
  }
  const icons = read.icons.slice(0, SHAPE_PACK_LIMITS.icons);
  if (!icons.length) throw badRequest('None of those files is an SVG Freero can draw', 'shape_pack_empty');
  if (read.icons.length > SHAPE_PACK_LIMITS.icons)
    throw badRequest(`A pack holds at most ${SHAPE_PACK_LIMITS.icons} icons: split these into several packs`, 'shape_pack_too_many', { max: SHAPE_PACK_LIMITS.icons });
  const chars = icons.reduce((n, ic) => n + JSON.stringify(ic.nodes).length, 0);
  const pack: repo.StoredPack = { id: newId(), workspaceId: personal ? null : workspaceId, ownerId: personal ? userId : null, name, createdBy: userId, createdAt: Date.now(), chars };
  const max = personal ? { packs: SHAPE_PACK_LIMITS.personalPacks, chars: SHAPE_PACK_LIMITS.personalChars } : { packs: SHAPE_PACK_LIMITS.packs, chars: SHAPE_PACK_LIMITS.workspaceChars };
  await repo.transaction(async () => {
    await repo.lockHome(home);
    const used = await repo.usage(home);
    if (used.packs >= max.packs)
      throw personal
        ? badRequest(`You can keep at most ${max.packs} shape packs of your own. Remove one you no longer use first.`, 'shape_pack_personal_limit', { max: max.packs })
        : badRequest(`A workspace can have at most ${max.packs} shape packs. Remove one you no longer use first.`, 'shape_pack_limit', { max: max.packs });
    if (used.chars + chars > max.chars)
      throw personal
        ? new HttpError(413, 'Your own shape packs are full. Remove a pack you no longer use first.', 'shape_pack_personal_full')
        : new HttpError(413, 'This workspace’s shape packs are full. Remove a pack you no longer use first.', 'shape_pack_workspace_full');
    await repo.insertPack(pack, icons.map((ic, position) => ({ ...ic, position })));
    await recordAudit({
      action: 'shape_pack.created',
      // A personal pack is the account's own business, not its workspace's.
      ...(personal ? { accountId: userId, fanOut: false } : { workspaceId }),
      actorId: userId,
      target: { type: 'shape_pack', id: pack.id, label: name },
      metadata: { icons: icons.length, skipped: read.skipped.length, ...(personal ? { personal: true } : {}) },
    });
  });
  const [out] = await present([pack]);
  return { pack: out, skipped: read.skipped.slice(0, MAX_SKIPPED_LISTED) };
}

export async function renamePack(packId: string, userId: string, body: unknown): Promise<ShapePack> {
  const pack = await packFor(packId, userId);
  const name = cleanName((body as { name?: unknown } | null)?.name);
  await repo.renamePack(pack.id, name);
  const [out] = await present([{ ...pack, name }]);
  return out;
}

/** Removes a pack. Icons already placed on boards stay: each holds its own drawing. */
export async function removePack(packId: string, userId: string): Promise<void> {
  const pack = await packFor(packId, userId);
  await repo.transaction(async () => {
    await repo.deletePack(pack.id);
    await recordAudit({
      action: 'shape_pack.removed',
      ...(pack.workspaceId ? { workspaceId: pack.workspaceId } : { accountId: userId, fanOut: false }),
      actorId: userId,
      target: { type: 'shape_pack', id: pack.id, label: pack.name },
    });
  });
}
