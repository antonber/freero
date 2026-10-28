// Files an operator removed (modules/moderation calls these through uploads' index).
//
// Removing a file makes its URL answer 410 Gone at once and for good, on every instance (the row
// is checked on every GET), while the bytes move to a kept copy under a key that is never an upload
// name, in storage's private area (with S3 outside the public `uploads/` prefix, KAI-179) — so it
// is neither served nor adopted by the sweep, and a mistaken removal can be undone (restore) until
// an operator purges the copy or its retention ends (modules/moderation, MODERATION_KEEP_REMOVED_DAYS). The row stays as a tombstone: the sweep skips
// removed rows, and since the name has a row its adoption step can never bring the file back.
import type { Readable } from 'node:stream';
import { newId } from '../../platform/ids';
import { readAll, storage } from '../../platform/storage';
import * as repo from './repo';
import { FILE_NAME_RE, TYPE_BY_EXT, uploadCacheControl } from './store';

/** Kept copies never sit where a public bucket URL could reach them. */
const PRIVATE = { area: 'private' } as const;

export interface ModerationUploadState {
  name: string;
  ownerId: string | null;
  contentType: string | null;
  bytes: number | null;
  removedAt: number | null;
  /** A kept copy exists, so the removal can be undone. */
  restorable: boolean;
  /** There is a file (or a record of one) under that name. */
  exists: boolean;
}

/** The upload name of a "/uploads/<name>" URL or a bare name; null when it isn't one. */
export function uploadName(urlOrName: string): string | null {
  const name = urlOrName.startsWith('/uploads/') ? urlOrName.slice('/uploads/'.length) : urlOrName;
  return FILE_NAME_RE.test(name) ? name : null;
}

async function stored(name: string): Promise<boolean> {
  const obj = await storage().get(name);
  obj?.body.destroy();
  return obj !== null;
}

export async function uploadForModeration(name: string): Promise<ModerationUploadState | null> {
  if (!FILE_NAME_RE.test(name)) return null;
  const row = await repo.getUploadRow(name);
  const exists = row !== null || (await stored(name));
  return {
    name,
    ownerId: row?.ownerId ?? null,
    contentType: row?.contentType ?? TYPE_BY_EXT[name.split('.').pop()!] ?? null,
    bytes: row?.bytes ?? null,
    removedAt: row?.removedAt ?? null,
    restorable: row?.quarantineKey != null,
    exists,
  };
}

/**
 * An upload's bytes for an operator to inspect before acting (KAI-205): the file itself, or the
 * kept copy of a removed one. Attachments (`.bin`) are never served at /uploads, so this is how an
 * operator opens a reported file card. null when there are no bytes (never stored, or purged).
 */
export async function openUploadForModeration(name: string): Promise<{ body: Readable; size: number | null; ownerId: string | null } | null> {
  if (!FILE_NAME_RE.test(name)) return null;
  const row = await repo.getUploadRow(name);
  const obj = row?.removedAt != null ? (row.quarantineKey ? await storage().get(row.quarantineKey, PRIVATE) : null) : await storage().get(name);
  return obj ? { body: obj.body, size: obj.size, ownerId: row?.ownerId ?? null } : null;
}

/** Whether an operator removed the file (its URL answers 410). */
export function isUploadRemoved(name: string): Promise<boolean> {
  return repo.isRemoved(name);
}

/**
 * Removes a file: 410 from now on, bytes kept aside for a possible restore. False when it was
 * already removed. Works for files without a row (thumbnails) and for names whose file is already
 * gone (the URL still turns into 410, with nothing to restore).
 */
export async function removeUpload(name: string): Promise<boolean> {
  if (!FILE_NAME_RE.test(name)) return false;
  const row = await repo.getUploadRow(name);
  if (row?.removedAt != null) return false;
  const contentType = row?.contentType ?? TYPE_BY_EXT[name.split('.').pop()!];
  const obj = await storage().get(name);
  const bytes = obj ? await readAll(obj) : null;
  // Never an upload name (FILE_NAME_RE has no '.' before the extension), so never served or adopted.
  const quarantineKey = bytes ? `removed.${newId(24)}.${name}` : null;
  if (bytes && quarantineKey) await storage().put(quarantineKey, bytes, contentType, PRIVATE);
  if (!(await repo.markRemoved({ name, bytes: bytes?.byteLength ?? row?.bytes ?? 0, contentType, quarantineKey }, Date.now()))) {
    if (quarantineKey) await storage().delete(quarantineKey, PRIVATE); // removed concurrently: theirs wins
    return false;
  }
  await storage().delete(name);
  return true;
}

/** Puts a removed file back under its name. False when it isn't removed or its copy was purged. */
export async function restoreUpload(name: string): Promise<boolean> {
  const row = FILE_NAME_RE.test(name) ? await repo.getUploadRow(name) : null;
  if (!row || row.removedAt === null || !row.quarantineKey) return false;
  const obj = await storage().get(row.quarantineKey, PRIVATE);
  if (!obj) return false;
  await storage().put(name, await readAll(obj), row.contentType, { cacheControl: uploadCacheControl() });
  if (!(await repo.clearRemoved(name, row.quarantineKey, Date.now()))) {
    // Changed meanwhile: restored by someone else (keep the file) or purged (don't bring it back).
    if (await repo.isRemoved(name)) await storage().delete(name);
    return false;
  }
  await storage().delete(row.quarantineKey, PRIVATE);
  return true;
}

/**
 * Account purge (KAI-178): the user's removed files outlive the account — tombstone (410) and kept
 * copy alike, with no owner — until an operator restores or purges them, or their retention ends.
 */
export function keepRemovedUploadsOf(userId: string): Promise<number> {
  return repo.detachRemovedOf(userId);
}

/** Kept copies of files removed before `before`, oldest first: what their retention may purge (KAI-179). */
export function keptCopiesRemovedBefore(before: number, limit = 200): Promise<Array<{ name: string; removedAt: number }>> {
  return repo.keptCopiesRemovedBefore(before, limit);
}

/** Deletes a removed file's kept copy for good (illegal content). The URL keeps answering 410. */
export async function purgeRemovedUpload(name: string): Promise<boolean> {
  if (!FILE_NAME_RE.test(name)) return false;
  const key = await repo.takeQuarantineKey(name);
  if (!key) return false;
  await storage().delete(key, PRIVATE);
  return true;
}
