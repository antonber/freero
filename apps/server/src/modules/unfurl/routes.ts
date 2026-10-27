import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle, HttpError } from '../../platform/http';
import { currentUser, requireUser } from '../auth/index';
import { unfurl, UnfurlError } from './service';

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
export default function unfurlRoutes(_ctx: ServerContext): Router {
  const r = Router();
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
  return r;
}
