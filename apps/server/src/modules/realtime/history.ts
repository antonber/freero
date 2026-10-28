// Version history (KAI-49): the board's snapshots as versions — automatic ones (compaction),
// named ones, and the board as it was before each restore.
//
// Who: editors and owners only, for everything (list, preview, name, restore). An older version
// can hold content someone removed before sharing the board with a view or comment link; showing
// history to viewers would hand that back to them.
//
// Restore = the version's content applied to the live doc as a NEW change on the instance
// handling the request (rooms.ts restoreBoardDoc), so every client on every instance converges
// and the change is saved like any edit. The board just before is kept as a 'before-restore'
// version first: restoring that one undoes the restore (and is itself listed and restorable).
import { MAX_VERSION_NAME, type BoardVersion } from '@freero/shared';
import { badRequest, notFound } from '../../platform/http';
import { getUsers } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import * as repo from './repo';
import { restoreBoardDoc, snapshotBoardDoc } from './rooms';

export async function requireVersionAccess(boardId: string, userId: string): Promise<{ workspaceId: string; title: string }> {
  return requireBoardAccess(boardId, userId, 'editor');
}

async function toVersions(infos: repo.SnapshotInfo[]): Promise<BoardVersion[]> {
  const users = await getUsers(infos.flatMap((i) => (i.createdBy ? [i.createdBy] : [])));
  return infos.map((i) => {
    const u = i.createdBy ? users.get(i.createdBy) : undefined;
    return { id: i.id, kind: i.kind, name: i.name, createdAt: i.createdAt, createdBy: u ? { id: u.id, name: u.name } : null };
  });
}

export function cleanVersionName(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('name must be a string');
  const name = v.replace(/\s+/g, ' ').trim().slice(0, MAX_VERSION_NAME);
  if (!name) throw badRequest('Give the version a name');
  return name;
}

export function parseVersionId(v: string): number {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound('Version not found');
  return id;
}

export async function listVersions(boardId: string): Promise<BoardVersion[]> {
  return toVersions(await repo.listSnapshots(boardId));
}

export async function versionState(boardId: string, versionId: number): Promise<Uint8Array> {
  const state = await repo.loadSnapshot(boardId, versionId);
  if (!state) throw notFound('Version not found');
  return state;
}

/** Keeps the board as it is right now (live, every instance) as a named version. */
export async function nameCurrentVersion(boardId: string, userId: string, name: string): Promise<BoardVersion> {
  const state = (await snapshotBoardDoc(boardId)) ?? new Uint8Array([0, 0]);
  const info = await repo.insertSnapshot(boardId, { state, kind: 'named', name, createdBy: userId }, Date.now());
  return (await toVersions([info]))[0];
}

export async function renameVersion(boardId: string, versionId: number, name: string): Promise<BoardVersion> {
  const info = await repo.nameSnapshot(boardId, versionId, name);
  if (!info) throw notFound('Version not found');
  return (await toVersions([info]))[0];
}

/** Restores a version; returns the 'before-restore' version (restore it to undo). */
export async function restoreVersion(boardId: string, versionId: number, userId: string): Promise<BoardVersion> {
  const state = await versionState(boardId, versionId);
  let before: repo.SnapshotInfo | null = null;
  await restoreBoardDoc(boardId, state, async (current) => {
    before = await repo.insertSnapshot(boardId, { state: current, kind: 'before-restore', name: null, createdBy: userId }, Date.now());
  });
  return (await toVersions([before!]))[0];
}
