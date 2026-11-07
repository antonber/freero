// A server that lets a board's socket in and then closes it: a refusal that will pass (too many
// connections, the board could not be loaded) is retried less and less often, never ten times a
// second from every tab; one that would only happen again (a change too large, sent again by every
// reconnect) ends the connection and says so. A real socket server that refuses, no Freero behind it.
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { BoardLayer } from '@freero/shared';
import type { OfflineCopy } from '../api';
import { BoardStore } from '../store/BoardStore';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

/** A server closing every socket with `code`, right away or once the client sent something. */
async function refusingServer(code: number, when: 'on open' | 'on first message'): Promise<{ url: string; connections: () => number }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  let n = 0;
  wss.on('connection', (ws) => {
    n++;
    if (when === 'on open') ws.close(code, 'refused');
    else ws.once('message', () => ws.close(code, 'refused'));
  });
  cleanup.push(() => new Promise<void>((r) => wss.close(() => r())));
  return { url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, connections: () => n };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('a board whose server keeps closing its socket right after letting it in is retried less and less often, not every 100 ms', async () => {
  const server = await refusingServer(4429, 'on open'); // too many connections
  const store = new BoardStore({ boardId: 'b1', syncUrl: server.url });
  cleanup.push(() => store.destroy());
  await sleep(3000);
  // y-websocket alone: about 25 in 3 s. Backing off from 0.25–0.5 s, doubling: at most 5.
  expect(server.connections()).toBeGreaterThanOrEqual(2);
  expect(server.connections()).toBeLessThanOrEqual(5);
  expect(store.status).not.toBe('refused'); // it will pass: still trying
});

it('a change the server refuses as too large stops the board reconnecting, says why, and is not kept on the device to fail again', async () => {
  const server = await refusingServer(1009, 'on first message');
  let forgotten = false;
  const store = new BoardStore({
    boardId: 'b1',
    syncUrl: server.url,
    persist: {
      load: async () => null,
      save: async (_copy: OfflineCopy) => {},
      forget: async () => void (forgotten = true),
      keeps: (_layer: BoardLayer) => true,
    },
  });
  cleanup.push(() => store.destroy());
  await sleep(1500);
  expect(server.connections()).toBe(1);
  expect(store.status).toBe('refused');
  expect(forgotten).toBe(true);
});
