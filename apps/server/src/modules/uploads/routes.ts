import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle, notFound } from '../../platform/http';
import { requireUser } from '../auth/index';
import { FILE_NAME_RE, MAX_UPLOAD_BYTES, TYPE_BY_EXT, saveUpload, uploadsDir } from './store';

// Mounted at the root (not /api) because it also serves GET /uploads/:file.
export const mountPath = '/';

export default function uploadRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.post(
    '/api/uploads',
    requireUser,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    handle((req, res) => {
      const body: unknown = req.body;
      const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      const url = saveUpload(data, req.headers['content-type'] ?? '');
      res.status(201).json({ url });
    }),
  );

  r.get(
    '/uploads/:file',
    handle((req, res) => {
      const name = req.params.file;
      if (!FILE_NAME_RE.test(name)) throw notFound('File not found');
      const file = path.join(uploadsDir(), name);
      if (!fs.existsSync(file)) throw notFound('File not found');
      res.setHeader('Content-Type', TYPE_BY_EXT[name.split('.').pop()!]);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // User content: never let an uploaded SVG run script in our origin.
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }),
  );

  return r;
}
