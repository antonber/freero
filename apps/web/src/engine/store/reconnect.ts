// How a store's socket comes back after the SERVER closed it (BoardStore, ObjectDocStore).
//
// y-websocket backs off only while a socket fails to open: one that opened resets its counter, so a
// server that accepts the upgrade and then refuses (4429 too many connections, 1011 the board could
// not be loaded, 1013 access changing) would be called again every 100 ms for as long as it keeps
// refusing, from every open tab, exactly when it is struggling. Here a socket that closes soon after
// it opened makes the next attempt wait, longer each time (with jitter, so tabs spread out); one
// that stayed open a while was healthy, and its close reconnects at once, as before.
//
// Some closes would only happen again the same way: 1009 means the server refused a change this
// client holds as too large, and every reconnect sends it again (sync step 2). The stores end the
// connection on those (`isRefusal`) and tell the person, like a lost access.
import type { WebsocketProvider } from 'y-websocket';

/** The server refused something this client holds (too large): reconnecting would send it again. */
export const WS_CLOSE_TOO_LARGE = 1009;
/** A socket open at least this long was healthy: its close reconnects at once (y-websocket's own). */
export const HEALTHY_AFTER_MS = 30_000;
/** The wait after the first quick close (doubling, up to MAX_RETRY_MS; each between half and all of it). */
export const FIRST_RETRY_MS = 500;
export const MAX_RETRY_MS = 30_000;

/** Close codes after which reconnecting would fail the same way. */
export const isRefusal = (code: number): boolean => code === WS_CLOSE_TOO_LARGE;

export interface Backoff {
  /** No more reconnects from here (the connection ended for good, or the store is gone). */
  stop(): void;
}

/**
 * Takes over reconnecting `provider` after a close that came soon after the socket opened (see
 * the header). Register it after the store's own close handler, which ends the connection for good
 * (shouldConnect = false) on the codes it treats as final.
 */
export function backOffQuickCloses(provider: WebsocketProvider, opts: { now?: () => number; random?: () => number } = {}): Backoff {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  let openedAt = 0;
  let quickCloses = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  provider.on('status', ({ status }: { status: string }) => {
    if (status === 'connected') openedAt = now();
  });
  provider.on('connection-close', (event: CloseEvent | null) => {
    // Null: closed on this side (disconnect, a silent connection); never opened: the network,
    // which y-websocket backs off from itself.
    if (stopped || !event || !provider.wsconnected || !provider.shouldConnect) return;
    if (now() - openedAt >= HEALTHY_AFTER_MS) {
      quickCloses = 0;
      return;
    }
    quickCloses++;
    const wait = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (quickCloses - 1)) * (0.5 + random() / 2);
    // y-websocket schedules its own reconnect right after this event: with shouldConnect off it does nothing.
    provider.shouldConnect = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) provider.connect();
    }, wait);
  });
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
