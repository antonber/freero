import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle, HttpError } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { fetchRemoteImage, importRemoteImage } from './image';
import { unfurl, UnfurlError } from './service';

// A fetched image is never rendered as a page in our origin (same policy as /uploads).
const SANDBOX_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

function imageUrlParam(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url || url.length > 2048) throw badRequest('Pass the image link as url');
  return url;
}

/** Fetch failures (blocked address, not an image, timeout…) are the link's fault: 422. */
async function remote<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof HttpError) throw err; // e.g. 413 upload quota
    if (err instanceof UnfurlError) throw new HttpError(422, err.message);
    throw new HttpError(422, 'That image could not be fetched.');
  }
}

// Outbound fetches cost time and bandwidth: a modest per-user budget (in-process, per instance).
const WINDOW_MS = 60_000;
const PER_WINDOW = 30;
const windows = new Map<string, { n: number; resetAt: number }>();

function allow(userId: string, now = Date.now()): boolean {
  if (windows.size > 10_000) for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  const w = windows.get(userId);
  if (!w || w.resetAt <= now) {
    windows.set(userId, { n: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  return ++w.n <= PER_WINDOW;
}

/** GET /api/unfurl?url=… → UnfurlResponse (see @freero/shared api.ts). */
export default function unfurlRoutes(ctx: ServerContext): Router {
  const r = Router();
  const maxBytes = () => ctx.config.maxUploadBytes;
  r.get(
    '/unfurl',
    requireUser,
    handle(async (req, res) => {
      const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
      if (!url || url.length > 2048) throw badRequest('Pass the link as ?url=');
      if (!allow(currentUser(req).id)) throw new HttpError(429, 'Too many link previews; try again in a minute.');
      try {
        const preview = await unfurl(url);
        res.setHeader('Cache-Control', 'private, max-age=600');
        res.json(preview);
      } catch (err) {
        if (err instanceof UnfurlError) throw new HttpError(422, err.message);
        throw new HttpError(422, 'That link could not be previewed.');
      }
    }),
  );

  // POST /api/unfurl/image { url } -> 201 { url: "/uploads/<key>" }: copies an image placed by URL
  // into the user's uploads, so viewers and exports never load it from the third party.
  r.post(
    '/unfurl/image',
    requireUser,
    rateLimit('remoteImage', 'user'),
    rateLimit('upload', 'user'),
    handle(async (req, res) => {
      const url = imageUrlParam(req.body?.url);
      const stored = await remote(() => importRemoteImage(url, currentUser(req).id, maxBytes()));
      res.status(201).json({ url: stored });
    }),
  );

  // GET /api/unfurl/image?url=… -> the image bytes: exports include images that boards still link
  // from hosts without CORS (nothing is stored).
  r.get(
    '/unfurl/image',
    requireUser,
    rateLimit('remoteImage', 'user'),
    handle(async (req, res) => {
      const url = imageUrlParam(req.query.url);
      const img = await remote(() => fetchRemoteImage(url, maxBytes()));
      res.setHeader('Content-Type', img.type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', SANDBOX_CSP);
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.send(img.body);
    }),
  );
  return r;
}
