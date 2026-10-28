// One structured log line + one latency observation per HTTP request.
import type { Request, RequestHandler } from 'express';
import { logger } from './log';
import { httpDuration } from './metrics';
import { createRequestContext, runWithRequestContext } from './requestContext';

/** Low-cardinality route label: the matched route template, never the raw path. */
export function routeLabel(req: Request): string {
  const path = req.originalUrl.split('?')[0];
  const routePath: unknown = req.route?.path;
  if (typeof routePath === 'string') {
    // After an error left the router, Express has reset req.baseUrl: rebuild the mount prefix
    // from the path segments the route template did not match.
    const segments = path.split('/').filter(Boolean);
    const prefix = req.baseUrl || `/${segments.slice(0, Math.max(0, segments.length - routePath.split('/').filter(Boolean).length)).join('/')}`;
    return `${prefix === '/' ? '' : prefix}${routePath}`;
  }
  if (req.route) return '(spa)';
  if (path === '/healthz' || path === '/readyz' || path === '/metrics') return path;
  if (path.startsWith('/api/')) return '/api/(unmatched)';
  if (path.startsWith('/uploads/')) return '/uploads/:file';
  return '(static)';
}

const QUIET = new Set(['/healthz', '/readyz', '/metrics']);

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const ctx = createRequestContext(req);
    ctx.ip = (req.ip ?? req.socket.remoteAddress ?? null)?.slice(0, 64) ?? null; // audit events record it
    res.setHeader('X-Request-Id', ctx.reqId);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = routeLabel(req);
      httpDuration.observe({ method: req.method, route, status: String(res.statusCode) }, seconds);
      const quiet = QUIET.has(route) && res.statusCode < 400;
      const level = res.statusCode >= 500 ? 'error' : quiet || route === '(static)' ? 'debug' : 'info';
      logger[level](
        {
          reqId: ctx.reqId,
          ...(ctx.userId ? { userId: ctx.userId } : {}),
          method: req.method,
          route,
          path: req.originalUrl.split('?')[0], // no query string: it may carry search terms or tokens
          status: res.statusCode,
          ms: Math.round(seconds * 10000) / 10,
          ip: req.ip,
        },
        'request',
      );
    });
    runWithRequestContext(ctx, next);
  };
}
