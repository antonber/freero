// /ws/embed/boards/:id — the socket of a live board view in an AI assistant (routes.ts). The same
// y-websocket protocol, rooms, role filter and layers as /ws/boards (realtime), admitted with the
// view's token instead of a cookie: the token rides as the second WebSocket subprotocol
// ([EMBED_WS_PROTOCOL, token]; browsers can't set headers on a WebSocket, and a query string ends up
// in logs). It opens only the board it was minted for, as the person, at most `maxRole`, inside the
// team's API switch and blocks; it closes when the token expires, and init.ts closes it when the
// credential behind it is revoked.
import type { IncomingMessage } from 'node:http';
import { EMBED_WS_PROTOCOL, WS_CLOSE_BOARD_REMOVED } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { checkRateLimit } from '../../platform/rateLimit';
import type { WsRoute } from '../../platform/ws';
import { authenticateEmbed, useInWorkspace } from '../apiauth/index';
import { authorNamesOf } from '../auth/index';
import { boardWorkspaceId, getBoardAccess } from '../boards/index';
import { admitSocket, capRole } from '../realtime/index';

const PREFIX = '/ws/embed/boards/';

/** The token among the requested subprotocols (`freero.embed, fre_…`). */
export function embedTokenOf(req: IncomingMessage): string | null {
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return offered[0] === EMBED_WS_PROTOCOL && offered[1] ? offered[1] : null;
}

export default function embedWs(_ctx: ServerContext): WsRoute {
  return {
    prefix: PREFIX,
    handle(ws, req) {
      const token = embedTokenOf(req);
      let boardId = '';
      try {
        boardId = decodeURIComponent((req.url ?? '').split('?')[0].slice(PREFIX.length));
      } catch {
        /* refused below */
      }
      // The key is known only once the token is checked; until then the socket is just queued.
      void admitSocket(ws, null, async () => {
        const session = token ? await authenticateEmbed(token) : null;
        if (!session) return { code: 4401, reason: 'This live view has expired' };
        if (!boardId || boardId !== session.boardId) return { code: 4403, reason: 'No access to this board' };
        const user = session.cred.account;
        if (!(await checkRateLimit('wsConnect', `user:${user.id}`)).allowed) return { code: 4429, reason: 'Too many connections' };
        const { role, removed } = await getBoardAccess(boardId, user.id);
        if (removed) return { code: WS_CLOSE_BOARD_REMOVED, reason: 'Board removed for review' };
        if (!role) return { code: 4403, reason: 'No access to this board' };
        const workspaceId = await boardWorkspaceId(boardId);
        try {
          if (workspaceId) await useInWorkspace(session.cred, workspaceId);
        } catch {
          return { code: 4403, reason: 'API access is turned off for this board' };
        }
        // Expiry: the view asks the assistant for a fresh one (the close code says why).
        const left = session.expiresAt - Date.now();
        const timer = setTimeout(() => ws.close(4401, 'This live view has expired'), Math.max(0, left));
        timer.unref();
        ws.once('close', () => clearTimeout(timer));
        return {
          boardId,
          userId: user.id,
          role: capRole(role, session.maxRole),
          maxRole: session.maxRole,
          sessionKey: session.sessionKey,
          identity: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl },
          authorNames: await authorNamesOf(user.id),
        };
      });
    },
  };
}
