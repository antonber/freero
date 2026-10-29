// Board backups (KAI-137): download a board as a `.freero` file, and restore one as a NEW board.
// This module owns no table and no board state: it reads and writes through the owning modules'
// indexes — boards (access, the downloads policy, the new board row + audit), realtime (content
// as the exporter may read it, a fresh document from JSON), uploads (files read and re-uploaded
// under the restorer's quota) and workspaces (where the restorer may create boards).
import type { RestoreBackupResponse } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log } from '../../platform/log';
import { authorizeBackup, boardSummaryFor, restoreBoard } from '../boards/index';
import { boardBackupContent, encodeBoardContent, withoutLeftOutFields } from '../realtime/index';
import { deleteUpload, readUpload, restoreUploadFile, uploadNamesIn } from '../uploads/index';
import { isFullMember, workspaceRole } from '../workspaces/index';
import { BackupFormatError, buildBackup, elementIdsOf, readBackup, remapContent, type ContentJson } from './format';

const MB = 1024 * 1024;

/** What a restore unpacks at most, given MAX_BACKUP_MB: the files (stored as they are) plus generous room for JSON. */
export function readLimits() {
  const max = getConfig().maxBackupBytes;
  return { maxFileBytes: max, maxUnpackedBytes: max + 256 * MB, maxJsonBytes: 128 * MB, maxEntries: 20_000, maxKeys: 200_000 };
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60).toLowerCase() || 'board';

/**
 * The board as a `.freero` file for `userId`: what they may take out (the workspace's downloads
 * policy) and what they may read (hidden frames' contents only for owners/editors; nobody's
 * private drafts), with the files it shows up to MAX_BACKUP_MB. Audited once built.
 */
export async function downloadBackup(boardId: string, userId: string, origin: string | null): Promise<{ data: Uint8Array; filename: string }> {
  const auth = await authorizeBackup(boardId, userId);
  const editorsLayer = auth.role === 'owner' || auth.role === 'editor';
  const content = await boardBackupContent(boardId, { editorsLayer });
  const jsonText = JSON.stringify(content.doc) + (content.editors ? JSON.stringify(content.editors) : '');
  // Files fill what MAX_BACKUP_MB leaves after the content (uncompressed: an upper bound) and room for
  // the manifest (a line per file), so the file restores on a server with the same limit.
  const budget = getConfig().maxBackupBytes - jsonText.length - 64 * 1024;
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const missingFiles: Array<{ name: string; reason: string }> = [];
  let used = 0;
  for (const name of [...uploadNamesIn(jsonText)].sort()) {
    const data = await readUpload(name);
    if (!data) missingFiles.push({ name, reason: 'the file is no longer stored' });
    else if (used + data.byteLength > budget) missingFiles.push({ name, reason: `over the ${Math.round(getConfig().maxBackupBytes / MB)} MB one backup carries` });
    else {
      used += data.byteLength;
      files.push({ name, data });
    }
  }
  const data = buildBackup({
    exportedAt: new Date(),
    origin,
    board: { id: auth.board.id, title: auth.board.title, description: auth.board.description, createdAt: new Date(auth.board.createdAt).toISOString() },
    doc: content.doc,
    editors: content.editors,
    files,
    missingFiles,
  });
  await auth.record({ files: files.length, missingFiles: missingFiles.length, hiddenContent: content.editors !== null, bytes: data.byteLength });
  return { data, filename: `${slug(auth.board.title)}-${new Date().toISOString().slice(0, 10)}.freero` };
}

/**
 * A new board for `userId` from a `.freero` file, in `place` (a workspace they are a full member
 * of, optionally a project there). Nothing is created unless everything checks out: the file is
 * read and verified first, files are re-uploaded under their quota (and deleted again if anything
 * after fails), every element gets a fresh id, and the board row and its content are written in
 * one transaction.
 */
export async function restoreBackup(
  userId: string,
  data: Uint8Array,
  place: { workspaceId: string | null; projectId: string | null },
): Promise<RestoreBackupResponse> {
  let backup;
  try {
    backup = readBackup(data, readLimits());
  } catch (e) {
    if (e instanceof BackupFormatError) throw badRequest(e.message);
    throw e;
  }
  // Where it goes is checked before anything is stored (createBoard checks it again, under its lock).
  if (place.workspaceId && !isFullMember(await workspaceRole(place.workspaceId, userId)))
    throw forbidden('You can’t create boards in that workspace');

  const doc = withoutLeftOutFields(backup.doc);
  const editors = backup.editors ? withoutLeftOutFields(backup.editors) : null;
  // Only files the content still references are brought back.
  const referenced = uploadNamesIn(JSON.stringify(doc) + (editors ? JSON.stringify(editors) : ''));
  const uploaded = new Map<string, string>();
  try {
    for (const [name, bytes] of backup.files) if (referenced.has(name)) uploaded.set(name, await restoreUploadFile(name, bytes, userId));

    const ids = new Map(elementIdsOf(doc, editors).filter((id) => id.length >= 8).map((id) => [id, newId(21)]));
    // A file the backup did not carry keeps its old reference (it may exist here: a restore on the
    // same Freero) — except attachments, which are only ever served from the board that holds
    // them: a restored board must not reach someone else's attachment by its name.
    const url = (name: string) => uploaded.get(name) ?? (name.endsWith('.bin') ? null : `/uploads/${name}`);
    const docOut: ContentJson = remapContent(doc, ids, url);
    const editorsOut = editors ? remapContent(editors, ids, url) : null;

    const m = backup.manifest;
    const board = await restoreBoard(
      userId,
      { title: m.board.title, description: typeof m.board.description === 'string' ? m.board.description : '', place: { workspaceId: place.workspaceId ?? undefined, projectId: place.projectId } },
      { state: encodeBoardContent(docOut), editors: editorsOut && Object.keys(editorsOut).length ? encodeBoardContent(editorsOut) : null },
      {
        boardId: String(m.board.id ?? ''),
        title: m.board.title,
        origin: typeof m.origin === 'string' ? m.origin : null,
        formatVersion: m.version,
        files: uploaded.size,
        missingFiles: referenced.size - uploaded.size,
      },
    );
    log(`backup: restored board ${board.id} for ${userId} (${uploaded.size} files)`);
    return {
      board: await boardSummaryFor(board.id, userId),
      report: {
        source: { title: m.board.title, origin: typeof m.origin === 'string' ? m.origin : null, exportedAt: String(m.exportedAt ?? ''), formatVersion: m.version },
        files: uploaded.size,
        missingFiles: referenced.size - uploaded.size,
        hiddenContent: editorsOut !== null && Object.keys(editorsOut).length > 0,
      },
    };
  } catch (e) {
    // Nothing half-restored: files uploaded for this attempt go again (they count toward the quota).
    for (const u of uploaded.values()) await deleteUpload(u).catch(() => undefined);
    throw e;
  }
}
