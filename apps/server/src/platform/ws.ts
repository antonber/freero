// WebSocket upgrade dispatch by path prefix + heartbeat. Modules register routes through their ws.ts.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

export interface WsRoute {
  /** Path prefix, e.g. '/ws/boards/'. */
  prefix: string;
  /** Called with an accepted socket. Close it with an application code (4xxx) to refuse. */
  handle(ws: WebSocket, req: IncomingMessage): void;
}

const HEARTBEAT_MS = 30_000;

export function attachWebSockets(server: Server, routes: WsRoute[]): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();
  // Longest prefix first so more specific routes win.
  const sorted = [...routes].sort((a, b) => b.prefix.length - a.prefix.length);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const route = sorted.find((r) => pathname.startsWith(r.prefix));
    if (!route) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      route.handle(ws, req);
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
