// WebSocket upgrade dispatch by path prefix + heartbeat. Modules register routes through their ws.ts.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Express, Request } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Config } from './config';
import { logError } from './log';
import { wsConnections } from './metrics';
import { checkRateLimit } from './rateLimit';
import { requestOriginKind } from './security';

export interface WsRoute {
  /** Path prefix, e.g. '/ws/boards/'. */
  prefix: string;
  /** Called with an accepted socket. Close it with an application code (4xxx) to refuse. */
  handle(ws: WebSocket, req: IncomingMessage): void;
}

const HEARTBEAT_MS = 30_000;

function refuse(socket: Duplex, status: string, extra = ''): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n${extra}\r\n`);
  socket.destroy();
}

/** The upgrade request seen through Express's request API (client ip/protocol under TRUST_PROXY). */
function asExpressRequest(app: Express, req: IncomingMessage): Request {
  return Object.create(app.request, {
    app: { value: app },
    headers: { value: req.headers },
    socket: { value: req.socket },
    connection: { value: req.socket },
  }) as Request;
}

/**
 * `opts` (from main.ts) enables the upgrade guards: cross-site Origin refused (403, against
 * cross-site WebSocket hijacking) and the per-IP `wsConnect` rate limit (429 + Retry-After).
 */
export function attachWebSockets(server: Server, routes: WsRoute[], opts?: { app: Express; config: Config }): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();
  // Longest prefix first so more specific routes win.
  const sorted = [...routes].sort((a, b) => b.prefix.length - a.prefix.length);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const route = sorted.find((r) => pathname.startsWith(r.prefix));
    if (!route) return refuse(socket, '404 Not Found');
    socket.on('error', () => socket.destroy());
    void (async () => {
      if (opts) {
        const xreq = asExpressRequest(opts.app, req);
        if (requestOriginKind(req, opts.config, xreq.secure) === 'cross') return refuse(socket, '403 Forbidden');
        const limit = await checkRateLimit('wsConnect', `ip:${xreq.ip ?? 'unknown'}`);
        if (!limit.allowed) return refuse(socket, '429 Too Many Requests', `Retry-After: ${limit.retryAfter}\r\n`);
      }
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        alive.set(ws, true);
        ws.on('pong', () => alive.set(ws, true));
        wsConnections.inc({ route: route.prefix });
        ws.once('close', () => wsConnections.dec({ route: route.prefix }));
        route.handle(ws, req);
      });
    })().catch((e) => {
      logError('websocket upgrade failed', e);
      refuse(socket, '500 Internal Server Error');
    });
  });

  // Ping every client; terminate those that did not answer the previous ping.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  timer.unref();

  return {
    close() {
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
