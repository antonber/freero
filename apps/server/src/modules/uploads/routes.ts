import express, { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { storage } from '../../platform/storage';
import { currentUser, requireUser } from '../auth/index';
import { FILE_NAME_RE, TYPE_BY_EXT, maxUploadBytes, saveUpload } from './store';

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
      const ext = name.split('.').pop()!;
      const direct = ext === 'svg' || ext === 'pdf' ? null : storage().publicUrl(name);
      if (direct) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.redirect(302, direct);
      }
      const obj = await storage().get(name);
      if (!obj) throw notFound('File not found');
      res.setHeader('Content-Type', TYPE_BY_EXT[ext]);
      if (obj.size !== null) res.setHeader('Content-Length', String(obj.size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', SANDBOX_CSP);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      obj.body.on('error', () => res.destroy()).pipe(res);
    }),
  );

  return r;
}
