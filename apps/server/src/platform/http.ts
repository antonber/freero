import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { getConfig, type Config } from './config';
import { reportError } from './errorReporting';
import { healthRoutes } from './health';
import { logError } from './log';
import { metricsRoute } from './metrics';
import { requestLogger } from './requestLog';
import { csrfGuard, securityHeaders } from './security';

/** Throw from a handler to answer with { error } and the given status. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason sent as `code` next to `error` (e.g. 'reauth_required'). */
    public code?: string,
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

/**
 * The Express app with the platform middleware every route gets: request id + structured log +
 * latency metric, security headers, /healthz /readyz /metrics, CSRF origin check, JSON body limit.
 */
export function createApp(config: Config = getConfig()): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestLogger());
  app.use(securityHeaders(config));
  app.use(healthRoutes());
  app.use(metricsRoute(config));
  app.use(previousHostRedirect(config));
  app.use(csrfGuard(config));
  // The raw bytes are kept beside the parsed body: webhooks are signed over exactly those bytes.
  app.use(express.json({ limit: config.bodyLimitBytes, verify: (req, _res, buf) => void rawBodies.set(req as express.Request, buf) }));
  return app;
}

/**
 * After a domain move (PREVIOUS_PUBLIC_URLS), a page or file opened at an old address is sent on to
 * the same path and query at PUBLIC_URL. GET and HEAD only: a tracker webhook or token client still
 * posting to the old address keeps working until it is repointed (webhooks don't follow
 * redirects), and MCP there answers with where it moved (modules/mcp).
 */
export function previousHostRedirect(config: Config): RequestHandler {
  const old = new Set(config.previousPublicUrls.map((o) => new URL(o).hostname));
  return (req, res, next) => {
    if (!config.publicUrl || !old.has(req.hostname?.toLowerCase()) || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    res.redirect(301, config.publicUrl + req.originalUrl);
  };
}

const rawBodies = new WeakMap<express.Request, Buffer>();

/** The bytes of a JSON request body as received (verifying a signed webhook), or null. */
export const rawBody = (req: express.Request): Buffer | null => rawBodies.get(req) ?? null;

/** JSON 404 for unknown /api routes. */
export function apiNotFound(): RequestHandler {
  return (req, res) => {
    res.status(404).json({ error: `No route ${req.method} ${req.originalUrl}` });
  };
}

export function errorHandler() {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      const retryAfter = (err as { retryAfter?: unknown }).retryAfter;
      if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
      return res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    }
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
    reportError(err, { request: { method: req.method, url: req.path } });
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
