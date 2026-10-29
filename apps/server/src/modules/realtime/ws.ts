import { WS_CLOSE_BOARD_REMOVED, type ObjectKind } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { gaugeFn } from '../../platform/metrics';
import { checkRateLimit } from '../../platform/rateLimit';
import type { WsRoute } from '../../platform/ws';
import { guestDisplayName } from '@freero/shared';
import { authorNamesOf, guestFromCookieHeader, guestKeyFromCookieHeader, onProfileChanged, onSessionEnd, sessionKeyFromCookieHeader, trackLiveSessions, userFromCookieHeader } from '../auth/index';
import { getBoardAccess } from '../boards/index';
import { admitSocket, endSessionSockets, flushAllRooms, listenToOtherInstances, liveSessionKeys, loadedRoomCount, pendingPersistCount, profileChanged } from './rooms';

/**
 * One socket route per kind of object doc (KAI-162): a board's canvas and a doc's document are
 * both a Yjs doc in a room of this module, keyed by the container's id, admitted by the same
 * access rules. A socket of one kind never opens the other kind's doc (a board client would write
 * its maps into a document, and the other way round).
 */
const PREFIXES: Record<ObjectKind, string> = { board: '/ws/boards/', doc: '/ws/docs/' };

/** /ws/boards/:id and /ws/docs/:id — y-websocket protocol; auth from the session cookie. */
export default function realtimeWs(ctx: ServerContext): WsRoute[] {
  // Graceful shutdown: every loaded doc is saved before the database closes.
  ctx.onShutdown(flushAllRooms);
  // Ended sessions close their sockets here, wherever and however they ended (auth, KAI-146).
  const stopWatchingSessions = onSessionEnd(endSessionSockets);
  const stopTracking = trackLiveSessions(() => [...liveSessionKeys()].filter((k) => !k.includes(':')));
  // Renames reach open sockets at once (presence, and the names comments may carry: KAI-187).
  const stopWatchingProfiles = onProfileChanged(profileChanged);
  ctx.onShutdown(() => {
    stopWatchingSessions();
    stopTracking();
    stopWatchingProfiles();
  });
  // Access changes, deleted boards and logouts handled by other instances (REDIS_URL).
  ctx.onShutdown(listenToOtherInstances());
  gaugeFn('freero_realtime_loaded_docs', 'Board documents loaded in memory', loadedRoomCount);
  gaugeFn('freero_realtime_persist_queue', 'Loaded board documents with changes not yet persisted', pendingPersistCount);
  return (Object.keys(PREFIXES) as ObjectKind[]).map((kind) => objectDocRoute(kind, PREFIXES[kind]));
}

function objectDocRoute(kind: ObjectKind, PREFIX: string): WsRoute {
  return {
    prefix: PREFIX,
    handle(ws, req) {
      const cookie = req.headers.cookie;
      const accountKey = sessionKeyFromCookieHeader(cookie);
      // A signed-in browser connects as its account; otherwise a guest session may (its one board).
      const sessionKey = accountKey ?? guestKeyFromCookieHeader(cookie);
      // Synchronously: admitSocket starts queueing the client's first messages right away.
      void admitSocket(ws, sessionKey, async () => {
        const account = accountKey ? await userFromCookieHeader(cookie) : null;
        const guest = account ? null : await guestFromCookieHeader(cookie);
        const user = account
          ? { id: account.id, name: account.name, color: account.color, avatarUrl: account.avatarUrl }
          : guest
            ? { id: guest.id, name: guestDisplayName(guest.name), color: guest.color, avatarUrl: null }
            : null;
        const key = account ? accountKey : guest ? guestKeyFromCookieHeader(cookie) : null;
        if (!user || !key) return { code: 4401, reason: 'Not logged in' };
        // Per-user connect limit (the per-IP one runs at the upgrade); the client retries with backoff.
        if (!(await checkRateLimit('wsConnect', `user:${user.id}`)).allowed) return { code: 4429, reason: 'Too many connections' };
        let boardId = '';
        try {
          boardId = decodeURIComponent((req.url ?? '').split('?')[0].slice(PREFIX.length));
        } catch {
          /* falls through to 4403 */
        }
        const access = boardId && !boardId.includes('/') ? await getBoardAccess(boardId, user.id) : { role: null, removed: false, kind: null };
        if (access.removed) return { code: WS_CLOSE_BOARD_REMOVED, reason: 'Board removed for review' };
        // The other kind's id reads like no access: a socket never learns what a container is.
        const role = access.kind === kind ? access.role : null;
        if (!role) return { code: 4403, reason: kind === 'doc' ? 'No access to this doc' : 'No access to this board' };
        return {
          boardId,
          kind,
          userId: user.id,
          role,
          sessionKey: key,
          identity: user,
          // Comments must carry the author's own name (realtime/commentRules.ts, KAI-187): a guest's
          // the one others see them by; an account's current or a previous one.
          ...(guest ? { authorName: user.name } : { authorNames: await authorNamesOf(user.id) }),
        };
      });
    },
  };
}
