import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { logError } from './log';

/** Throw from a handler to answer with { error } and the given status. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Not logged in') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to this board') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/** Wraps a (possibly async) handler so thrown errors and rejections reach the error handler. */
export function handle(fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).catch(next);
    } catch (e) {
      next(e);
    }
  };
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  return app;
}

/** JSON 404 for unknown /api routes. */
export function apiNotFound(): RequestHandler {
  return (req, res) => {
    res.status(404).json({ error: `No route ${req.method} ${req.originalUrl}` });
  };
}

export function errorHandler() {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    const e = (err ?? {}) as { status?: number; statusCode?: number; type?: string; expose?: boolean; message?: string };
    const status = e.status ?? e.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message =
        e.type === 'entity.too.large'
          ? 'Payload too large'
          : e.type === 'entity.parse.failed'
            ? 'Invalid JSON body'
            : e.expose && e.message
              ? e.message
              : 'Bad request';
      return res.status(status).json({ error: message });
    }
    logError('unhandled error', err);
    res.status(500).json({ error: 'Internal server error' });
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}
