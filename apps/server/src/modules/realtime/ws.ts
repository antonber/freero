import type { ServerContext } from '../../platform/context';
import type { WsRoute } from '../../platform/ws';
import { onSessionEnd, sessionKeyFromCookieHeader, userFromCookieHeader } from '../auth/index';
import { getBoardAccess } from '../boards/index';
import { endSessionSockets, flushAllRooms, joinRoom } from './rooms';

const PREFIX = '/ws/boards/';

/** /ws/boards/:id — y-websocket protocol; auth from the session cookie. */
export default function realtimeWs(ctx: ServerContext): WsRoute {
  ctx.onShutdown(flushAllRooms);
  const stopWatchingSessions = onSessionEnd(endSessionSockets);
  ctx.onShutdown(() => void stopWatchingSessions());
  return {
    prefix: PREFIX,
    handle(ws, req) {
      const user = userFromCookieHeader(req.headers.cookie);
      if (!user) return ws.close(4401, 'Not logged in');
      let boardId = '';
      try {
        boardId = decodeURIComponent((req.url ?? '').split('?')[0].slice(PREFIX.length));
      } catch {
        /* falls through to 4403 */
      }
      const { role } = boardId && !boardId.includes('/') ? getBoardAccess(boardId, user.id) : { role: null };
      if (!role) return ws.close(4403, 'No access to this board');
      joinRoom(boardId, ws, user.id, role, sessionKeyFromCookieHeader(req.headers.cookie)!);
    },
  };
}
