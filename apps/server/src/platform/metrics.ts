// Prometheus metrics. Platform owns the registry and the HTTP/WebSocket metrics; modules add their
// own through the helpers below (e.g. realtime's loaded docs and persist latency).
import http from 'node:http';
import type { RequestHandler } from 'express';
import client from 'prom-client';
import type { Config } from './config';
import { log } from './log';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'freero_' });

export const httpDuration = new client.Histogram({
  name: 'freero_http_request_duration_seconds',
  help: 'HTTP request latency by method, route template and status code',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const wsConnections = new client.Gauge({
  name: 'freero_websocket_connections',
  help: 'Open WebSocket connections by route prefix',
  labelNames: ['route'] as const,
  registers: [registry],
});

export const rateLimited = new client.Counter({
  name: 'freero_rate_limited_total',
  help: 'Requests rejected with 429 by rate limit name',
  labelNames: ['limit'] as const,
  registers: [registry],
});

/** A gauge whose value is read at scrape time. */
export function gaugeFn(name: string, help: string, read: () => number | Promise<number>): void {
  if (registry.getSingleMetric(name)) return;
  new client.Gauge({
    name,
    help,
    registers: [registry],
    async collect() {
      this.set(await read());
    },
  });
}

export function histogram<L extends string>(
  name: string,
  help: string,
  labelNames: readonly L[] = [],
  buckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
): client.Histogram<L> {
  const existing = registry.getSingleMetric(name);
  if (existing) return existing as client.Histogram<L>;
  return new client.Histogram({ name, help, labelNames, buckets, registers: [registry] });
}

export function counter<L extends string>(name: string, help: string, labelNames: readonly L[] = []): client.Counter<L> {
  const existing = registry.getSingleMetric(name);
  if (existing) return existing as client.Counter<L>;
  return new client.Counter({ name, help, labelNames, registers: [registry] });
}

async function render(res: http.ServerResponse): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(await registry.metrics());
}

/**
 * GET /metrics on the public app. Needs `Authorization: Bearer <METRICS_TOKEN>`; without a token
 * it is open only outside production. With METRICS_PORT set it is not served here at all.
 */
export function metricsRoute(config: Config): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' || req.path !== '/metrics') return next();
    if (config.metricsPort !== null || (config.production && !config.metricsToken)) return next();
    if (config.metricsToken && req.headers.authorization !== `Bearer ${config.metricsToken}`) {
      res.status(401).json({ error: 'metrics token required' });
      return;
    }
    render(res).catch(next);
  };
}

/** Serves /metrics on an internal-only port (METRICS_PORT). */
export function startMetricsServer(config: Config): http.Server | null {
  if (config.metricsPort === null) return null;
  const server = http.createServer((req, res) => {
    if (req.url?.split('?')[0] !== '/metrics') {
      res.statusCode = 404;
      return res.end();
    }
    if (config.metricsToken && req.headers.authorization !== `Bearer ${config.metricsToken}`) {
      res.statusCode = 401;
      return res.end();
    }
    render(res).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  server.listen(config.metricsPort, () => log(`metrics on internal port ${config.metricsPort}`));
  return server;
}
