import { WS_CLOSE_BOARD_REMOVED } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { gaugeFn } from '../../platform/metrics';
import { checkRateLimit } from '../../platform/rateLimit';
import type { WsRoute } from '../../platform/ws';
import { onSessionEnd, sessionKeyFromCookieHeader, trackLiveSessions, userFromCookieHeader } from '../auth/index';
import { getBoardAccess } from '../boards/index';
import { admitSocket, endSessionSockets, flushAllRooms, listenToOtherInstances, liveSessionKeys, loadedRoomCount, pendingPersistCount } from './rooms';

const PREFIX = '/ws/boards/';

/** /ws/boards/:id — y-websocket protocol; auth from the session cookie. */
export default function realtimeWs(ctx: ServerContext): WsRoute {
  // Graceful shutdown: every loaded doc is saved before the database closes.
  ctx.onShutdown(flushAllRooms);
  // Ended sessions close their sockets here, wherever and however they ended (auth, KAI-146).
  const stopWatchingSessions = onSessionEnd(endSessionSockets);
  const stopTracking = trackLiveSessions(liveSessionKeys);
  ctx.onShutdown(() => {
    stopWatchingSessions();
    stopTracking();
  });
  // Access changes, deleted boards and logouts handled by other instances (REDIS_URL).
  ctx.onShutdown(listenToOtherInstances());
  gaugeFn('freero_realtime_loaded_docs', 'Board documents loaded in memory', loadedRoomCount);
  gaugeFn('freero_realtime_persist_queue', 'Loaded board documents with changes not yet persisted', pendingPersistCount);
  return {
    prefix: PREFIX,
    handle(ws, req) {
      const cookie = req.headers.cookie;
      const sessionKey = sessionKeyFromCookieHeader(cookie);
      // Synchronously: admitSocket starts queueing the client's first messages right away.
      void admitSocket(ws, sessionKey, async () => {
        const user = sessionKey ? await userFromCookieHeader(cookie) : null;
        if (!user || !sessionKey) return { code: 4401, reason: 'Not logged in' };
        // Per-user connect limit (the per-IP one runs at the upgrade); the client retries with backoff.
        if (!(await checkRateLimit('wsConnect', `user:${user.id}`)).allowed) return { code: 4429, reason: 'Too many connections' };
        let boardId = '';
        try {
          boardId = decodeURIComponent((req.url ?? '').split('?')[0].slice(PREFIX.length));
        } catch {
          /* falls through to 4403 */
        }
        const { role, removed } = boardId && !boardId.includes('/') ? await getBoardAccess(boardId, user.id) : { role: null, removed: false };
        if (removed) return { code: WS_CLOSE_BOARD_REMOVED, reason: 'Board removed for review' };
        if (!role) return { code: 4403, reason: 'No access to this board' };
        return {
          boardId,
          userId: user.id,
          role,
          sessionKey,
          identity: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl },
        };
      });
    },
  };
}
