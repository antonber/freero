// Data exports (GDPR): requested in the app, built one at a time by a background job (any
// instance; platform/jobs), stored as a private file, announced by email with a link to the app,
// downloadable by the person who asked (signed in; for a workspace export only while they are
// still its owner/admin) until it expires, then deleted.
import type { Request } from 'express';
import type { AuditAction, DataExportInfo } from '@freero/shared';
import { recordAudit, type AuditInput } from '../audit/index';
import { getConfig } from '../../platform/config';
import { HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { appUrl, renderMail, sendMail } from '../../platform/mail';
import { getUser } from '../auth/index';
import { deletePrivateFile, openPrivateFile, savePrivateFile } from '../uploads/index';
import { getWorkspaceInfo, workspaceRole } from '../workspaces/index';
import { buildUserArchive, buildWorkspaceArchive } from './archive';
import * as repo from './repo';

export const EXPORT_LOCK_KEY = 7_202_610_302; // arbitrary, constant across releases
const MAX_ATTEMPTS = 3;
const STALE_MS = 30 * 60_000;

const info = (e: repo.ExportRecord): DataExportInfo => ({
  id: e.id,
  kind: e.kind,
  status: e.status,
  createdAt: e.createdAt,
  readyAt: e.readyAt,
  expiresAt: e.expiresAt,
  bytes: e.bytes,
});

/**
 * A workspace export is the workspace's event; a person's own export goes to their account's log
 * only (their teams have no business knowing they asked for their data).
 */
const exportEvent = (action: AuditAction, exportId: string, userId: string, workspaceId: string | null): AuditInput =>
  workspaceId
    ? { action, workspaceId, actorId: userId, target: { type: 'export', id: exportId } }
    : { action, accountId: userId, fanOut: false, actorId: userId, target: { type: 'export', id: exportId } };

/** Queues an export; 409 while one for the same subject is still being built. */
export async function requestExport(by: string, workspaceId: string | null): Promise<DataExportInfo> {
  const id = newId(20);
  await repo.transaction(async () => {
    const ok = await repo.insertExport({ id, kind: workspaceId ? 'workspace' : 'user', requestedBy: by, workspaceId }, Date.now());
    if (!ok) throw new HttpError(409, 'An export is already being prepared. You’ll get an email when it’s ready.');
    await recordAudit(exportEvent(workspaceId ? 'workspace.export_requested' : 'account.export_requested', id, by, workspaceId));
  });
  return info((await repo.getExport(id))!);
}

export async function listExports(by: { requestedBy: string } | { workspaceId: string }): Promise<DataExportInfo[]> {
  const rows = await repo.listExports('requestedBy' in by ? { kind: 'user', requestedBy: by.requestedBy } : { kind: 'workspace', workspaceId: by.workspaceId });
  return rows.map(info);
}

/** The archive for its requester, or 404 (also when it is someone else's, expired or not ready). */
export async function openExport(id: string, userId: string) {
  const e = await repo.getExport(id);
  if (!e || e.requestedBy !== userId || e.status !== 'ready' || !e.fileKey || (e.expiresAt ?? 0) <= Date.now()) throw notFound('That export is not available (it may have expired)');
  if (e.kind === 'workspace') {
    // Only while they still manage the workspace.
    const role = e.workspaceId ? await workspaceRole(e.workspaceId, userId) : null;
    if (role !== 'owner' && role !== 'admin') throw notFound('That export is not available');
  }
  const file = await openPrivateFile(e.fileKey);
  if (!file) throw notFound('That export is not available (it may have expired)');
  await recordAudit(exportEvent(e.kind === 'workspace' ? 'workspace.export_downloaded' : 'account.export_downloaded', id, userId, e.workspaceId));
  return { ...file, filename: `freero-${e.kind === 'workspace' ? 'workspace' : 'my-data'}-${new Date(e.readyAt ?? Date.now()).toISOString().slice(0, 10)}.zip` };
}

/** One job round: drop expired / orphaned files, retry stale ones, build every pending export. */
export async function processExports(req: Request | null = null): Promise<number> {
  const now = Date.now();
  for (const f of await repo.filesToDrop(now)) {
    if (f.fileKey) await deletePrivateFile(f.fileKey);
    if (f.orphan) await repo.deleteExport(f.id);
    else await repo.markExpired(f.id);
  }
  await repo.requeueStale(now - STALE_MS);
  let built = 0;
  for (;;) {
    const e = await repo.claimNext(Date.now());
    if (!e) return built;
    try {
      await build(req, e);
      built++;
    } catch (err) {
      logError(`privacy: data export ${e.id} failed (attempt ${e.attempts})`, err);
      await repo.markFailed(e.id, err instanceof Error ? err.message : String(err), MAX_ATTEMPTS);
    }
  }
}

async function build(req: Request | null, e: repo.ExportRecord): Promise<void> {
  if (!e.requestedBy) throw new Error('the requester is gone');
  const origin = appUrl(req, '');
  const zip = e.kind === 'workspace' ? await buildWorkspaceArchive(e.workspaceId!, origin) : await buildUserArchive(e.requestedBy, origin);
  const key = await savePrivateFile(zip);
  const now = Date.now();
  const expiresAt = now + getConfig().dataExportTtlMs;
  if (!(await repo.markReady(e.id, key, zip.byteLength, now, expiresAt))) {
    await deletePrivateFile(key); // requeued meanwhile (taken for stale): the other run's file wins
    return;
  }
  log(`privacy: data export ${e.id} ready (${zip.byteLength} bytes)`);
  const user = await getUser(e.requestedBy);
  if (!user) return;
  const ws = e.workspaceId ? await getWorkspaceInfo(e.workspaceId) : null;
  const what = ws ? `the ${ws.name} workspace` : 'your Freero data';
  await sendMail({
    to: user.email,
    ...renderMail({
      subject: ws ? `Your export of ${ws.name} is ready` : 'Your Freero data export is ready',
      title: `Your export of ${what} is ready`,
      paragraphs: [
        `The ZIP file you asked for is ready to download until ${new Date(expiresAt).toUTCString()}. After that it is deleted.`,
        'Only you can download it, signed in to Freero as yourself.',
      ],
      // The page lists it with its Download button (signing in first if needed).
      action: { label: 'Download the export', url: ws ? `${origin}/admin/${encodeURIComponent(ws.id)}?tab=retention#data` : `${origin}/settings#data` },
      outro: 'If you didn’t ask for this export, change your password and review your signed-in devices in Account settings.',
    }),
  });
}
