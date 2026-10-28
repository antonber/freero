import express, { Router, type RequestHandler, type Response } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle, HttpError, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { storage, type ByteRange } from '../../platform/storage';
import { actorId, currentActor, currentUser, requireUser, requireUserOrGuest } from '../auth/index';
import { openBoardFile } from './download';
import { isUploadRemoved } from './moderation';
import { ATTACHMENT_EXT, FILE_NAME_RE, MEDIA_EXTS, TYPE_BY_EXT, saveUpload, tooLarge, uploadKindOf, uploadLimitFor, type UploadKind } from './store';

// Mounted at the root (not /api) because it also serves GET /uploads/:file.
export const mountPath = '/';

// User content: never let an uploaded SVG run script in our origin.
const SANDBOX_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

/**
 * A single "bytes=a-b" / "bytes=a-" / "bytes=-n" range against `size`: the bytes to send, 'none'
 * when no byte of it exists (416), or null to send the whole file (no header, several ranges or
 * one we don't understand — RFC 9110 lets a server ignore Range).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'none' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'none';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return 'none';
  return end < start ? null : { start, end };
}

/** "Q3 plan.xlsx" as an attachment, safe for any header parser (RFC 6266 + RFC 5987). */
export function attachmentDisposition(fileName: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = fileName.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200) || 'download';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["%;]/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Headers every streamed upload carries: nothing in it may be sniffed into, or run as, active content. */
function contentHeaders(res: Response) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', SANDBOX_CSP);
}

/** The request body as bytes, read up to the size cap of what is being uploaded. */
function uploadBody(): RequestHandler {
  const parsers = new Map<UploadKind, RequestHandler>();
  return (req, res, next) => {
    const kind = uploadKindOf(req.headers['content-type'], req.query.as === 'attachment');
    // Nothing of a type we don't take is read: saveUpload answers 415.
    if (!kind) return next();
    const limit = uploadLimitFor(kind);
    // Said up front (and true): refused before a byte is read, with the cap for this kind.
    if (Number(req.headers['content-length']) > limit) return next(tooLarge(kind));
    let parse = parsers.get(kind);
    if (!parse) parsers.set(kind, (parse = express.raw({ type: () => true, limit })));
    parse(req, res, (err?: unknown) => next((err as { type?: string } | undefined)?.type === 'entity.too.large' ? tooLarge(kind) : err));
  };
}

export default function uploadRoutes(_ctx: ServerContext): Router {
  const r = Router();

  // `?as=attachment`: any other file (a file card), stored as an opaque attachment. Otherwise the
  // declared type says what it is: an image / PDF, or video / audio (the bytes decide which).
  r.post(
    '/api/uploads',
    requireUser,
    rateLimit('upload', 'user'),
    uploadBody(),
    handle(async (req, res) => {
      const body: unknown = req.body;
      const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      const url = await saveUpload(data, req.headers['content-type'] ?? '', currentUser(req).id, { attachment: req.query.as === 'attachment' });
      res.status(201).json({ url });
    }),
  );

  // Streamed from storage (S3 or disk), so URLs stay same-origin and every response carries
  // nosniff + the sandbox CSP. With S3_PUBLIC_URL set, raster images, video and audio redirect to
  // the bucket instead (which answers byte ranges itself; SVGs are always streamed: the bucket
  // would not send the sandbox CSP; PDFs too: the board reads them with fetch(), which a
  // cross-origin bucket without CORS would refuse). Video and audio answer byte ranges (seeking).
  // Attachments are never served here (see store.ts): only from their board, below.
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
      if (ext === ATTACHMENT_EXT) throw notFound('Files attached to a board are downloaded from the board');
      const direct = ext === 'svg' || ext === 'pdf' ? null : storage().publicUrl(name);
      if (direct) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.redirect(302, direct);
      }
      res.setHeader('Content-Type', TYPE_BY_EXT[ext]);
      contentHeaders(res);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      let range: ByteRange | 'none' | null = null;
      let total: number | null = null;
      if (MEDIA_EXTS.has(ext)) {
        res.setHeader('Accept-Ranges', 'bytes');
        if (req.headers.range) {
          total = (await storage().stat(name))?.size ?? null;
          if (total === null) throw notFound('File not found');
          range = parseRange(req.headers.range, total);
        }
      }
      if (range === 'none') {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      const obj = await storage().get(name, range ?? undefined);
      if (!obj) throw notFound('File not found');
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
      } else if (obj.size !== null) res.setHeader('Content-Length', String(obj.size));
      if (req.method === 'HEAD') {
        obj.body.destroy();
        return res.end();
      }
      obj.body.on('error', () => res.destroy()).pipe(res);
    }),
  );

  // Downloading a file from a board (a file card, or a video / audio item): only for someone who
  // can open the board and whom its workspace's downloads policy lets download, only what that
  // person can see on it (hidden frames, others' drafts are not theirs), always as an attachment
  // under the item's name, and recorded in the workspace's audit log like an export.
  r.get(
    '/api/boards/:id/files/:elementId',
    requireUserOrGuest,
    rateLimit('download', 'user'),
    handle(async (req, res) => {
      const head = req.method === 'HEAD';
      const file = await openBoardFile(req.params.id, req.params.elementId, actorId(currentActor(req)), { audit: !head });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', attachmentDisposition(file.name));
      contentHeaders(res);
      res.setHeader('Cache-Control', 'private, no-store');
      if (file.size !== null) res.setHeader('Content-Length', String(file.size));
      if (head) {
        file.body.destroy();
        return res.end();
      }
      file.body.on('error', () => res.destroy()).pipe(res);
    }),
  );

  return r;
}
