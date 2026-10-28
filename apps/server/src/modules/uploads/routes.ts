import express, { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle, HttpError, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { storage } from '../../platform/storage';
import { currentUser, requireUser } from '../auth/index';
import { isUploadRemoved } from './moderation';
import { FILE_NAME_RE, TYPE_BY_EXT, maxUploadBytes, saveUpload, uploadCacheControl } from './store';

// Mounted at the root (not /api) because it also serves GET /uploads/:file.
export const mountPath = '/';

// User content: never let an uploaded SVG run script in our origin.
const SANDBOX_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

export default function uploadRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.post(
    '/api/uploads',
    requireUser,
    rateLimit('upload', 'user'),
    express.raw({ type: () => true, limit: maxUploadBytes() }),
    handle(async (req, res) => {
      const body: unknown = req.body;
      const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      const url = await saveUpload(data, req.headers['content-type'] ?? '', currentUser(req).id);
      res.status(201).json({ url });
    }),
  );

  // Streamed from storage (S3 or disk), so URLs stay same-origin and every response carries
  // nosniff + the sandbox CSP. With S3_PUBLIC_URL set, raster images redirect to the bucket
  // instead (SVGs are always streamed: the bucket would not send the sandbox CSP; PDFs too: the
  // board reads them with fetch(), which a cross-origin bucket without CORS would refuse).
  r.get(
    '/uploads/:file',
    handle(async (req, res) => {
      const name = req.params.file;
      if (!FILE_NAME_RE.test(name)) throw notFound('File not found');
      // Removed by an operator: gone for good, whatever caches or the bucket still hold.
      if (await isUploadRemoved(name)) {
        res.setHeader('Cache-Control', 'no-store');
        throw new HttpError(410, 'This file was removed by Freero’s moderators');
      }
      const ext = name.split('.').pop()!;
      // Cached for UPLOAD_CACHE_SECONDS, then revalidated (KAI-177): a name's bytes never change,
      // so the name is the ETag and asking again costs a 304 — or a 410 once the file was removed.
      res.setHeader('Cache-Control', uploadCacheControl());
      const direct = ext === 'svg' || ext === 'pdf' ? null : storage().publicUrl(name);
      if (direct) return res.redirect(302, direct);
      const etag = `"${name}"`;
      res.setHeader('ETag', etag);
      if ((req.headers['if-none-match'] ?? '').split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) return res.status(304).end();
      const obj = await storage().get(name);
      if (!obj) throw notFound('File not found');
      res.setHeader('Content-Type', TYPE_BY_EXT[ext]);
      if (obj.size !== null) res.setHeader('Content-Length', String(obj.size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', SANDBOX_CSP);
      obj.body.on('error', () => res.destroy()).pipe(res);
    }),
  );

  return r;
}
