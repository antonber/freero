// Board backups (KAI-137): GET /api/boards/:id/backup downloads a `.freero` file;
// POST /api/boards/restore-backup?workspace=&project= (the file as the body) makes a new board.
import express, { Router } from 'express';
import { BACKUP_MEDIA_TYPE, type RestoreBackupResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { getConfig } from '../../platform/config';
import { handle, HttpError } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { downloadBackup, restoreBackup } from './service';

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export default function backupRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/boards/:id/backup',
    requireUser,
    rateLimit('backup', 'user'),
    handle(async (req, res) => {
      const { data, filename } = await downloadBackup(req.params.id, currentUser(req).id, appUrl(req, ''));
      res.setHeader('Content-Type', BACKUP_MEDIA_TYPE);
      // The name is ASCII already (slugged title + date).
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Length', String(data.byteLength));
      res.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }),
  );

  // The body is read only up to MAX_BACKUP_MB, and refused up front when Content-Length says more.
  const body: express.RequestHandler = (req, res, next) => {
    const limit = getConfig().maxBackupBytes;
    const tooLarge = () => new HttpError(413, `The backup is larger than ${Math.round(limit / 1024 / 1024)} MB, the most this server restores`);
    if (Number(req.headers['content-length']) > limit) return next(tooLarge());
    express.raw({ type: () => true, limit })(req, res, (err?: unknown) => next((err as { type?: string } | undefined)?.type === 'entity.too.large' ? tooLarge() : err));
  };

  r.post(
    '/boards/restore-backup',
    requireUser,
    rateLimit('backup', 'user'),
    body,
    handle(async (req, res) => {
      const data: unknown = req.body;
      if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Choose a .freero backup file to restore');
      const out = await restoreBackup(currentUser(req).id, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), {
        workspaceId: str(req.query.workspace),
        projectId: str(req.query.project),
      });
      res.status(201).json(out satisfies RestoreBackupResponse);
    }),
  );

  return r;
}
