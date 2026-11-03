// /ws/embed/boards/:id — the socket of a live board view in an AI assistant (routes.ts). The same
// y-websocket protocol, rooms, role filter and layers as /ws/boards (realtime), admitted with the
// view's token instead of a cookie: the token rides as the second WebSocket subprotocol
// ([EMBED_WS_PROTOCOL, token]; browsers can't set headers on a WebSocket, and a query string ends up
// in logs). It opens only the board it was minted for, as the person, writing at most `maxRole`
// (it READS the board's layers as the person: an owner's pending suggestions, #89), inside the
// team's API switch and blocks; it closes when the token expires, and init.ts closes it when the
// credential behind it is revoked.
//
// /ws/embed/b/:id — a board embedded on any other site (#2, public.ts): a visitor read-only, or
// the person who signed in from the embed with a token bound to this board and their session.
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import {
  EMBED_WS_PROTOCOL,
  GUEST_ID_PREFIX,
  PUBLIC_EMBED_VIEW_ONLY,
  PUBLIC_EMBED_WS_PROTOCOL,
  WS_CLOSE_BOARD_REMOVED,
  WS_CLOSE_EMBED_FULL,
} from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { checkRateLimit } from '../../platform/rateLimit';
import type { WsRoute } from '../../platform/ws';
import { authenticateEmbed, useInWorkspace } from '../apiauth/index';
import { authorNamesOf } from '../auth/index';
import { boardWorkspaceId, getBoardAccess } from '../boards/index';
import { admitSocket } from '../realtime/index';
import { MEMBER_TOKEN_PREFIX, memberOf, memberRole, visitorRole } from './public';

const PREFIX = '/ws/embed/boards/';
const PUBLIC_PREFIX = '/ws/embed/b/';

const offeredProtocols = (req: IncomingMessage): string[] =>
  String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

const boardIdOf = (req: IncomingMessage, prefix: string): string => {
  try {
    const id = decodeURIComponent((req.url ?? '').split('?')[0].slice(prefix.length));
    return id && !id.includes('/') ? id : '';
  } catch {
    return '';
  }
};

/** The token among the requested subprotocols (`freero.embed, fre_…`). */
export function embedTokenOf(req: IncomingMessage): string | null {
  const offered = offeredProtocols(req);
  return offered[0] === EMBED_WS_PROTOCOL && offered[1] ? offered[1] : null;
}

export default function embedWs(ctx: ServerContext): WsRoute[] {
  return [assistantView(), publicEmbed(ctx)];
}

function assistantView(): WsRoute {
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
          // The person's own role: the room caps what the socket writes at `maxRole`, and reads
          // the board's layers as the person (#89: an owner's pending suggestions show in the view).
          role,
          maxRole: session.maxRole,
          sessionKey: session.sessionKey,
          identity: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl },
          authorNames: await authorNamesOf(user.id),
        };
      });
    },
  };
}

/** Visitors watching each board's embeds through this instance (#60: at most EMBED_MAX_VISITORS_PER_BOARD). */
const visitors = new Map<string, number>();

/** Counts `ws` as a visitor of `boardId` until it closes; false when the board's embeds are full. */
function takeVisitorSeat(ws: WebSocket, boardId: string, max: number): boolean {
  const n = visitors.get(boardId) ?? 0;
  if (n >= max) return false;
  visitors.set(boardId, n + 1);
  ws.once('close', () => {
    const left = (visitors.get(boardId) ?? 1) - 1;
    if (left > 0) visitors.set(boardId, left);
    else visitors.delete(boardId);
  });
  return true;
}

/**
 * /ws/embed/b/:id — a board embedded on another site (#2, public.ts). Subprotocols
 * [PUBLIC_EMBED_WS_PROTOCOL] for a visitor without an account, [PUBLIC_EMBED_WS_PROTOCOL, token]
 * for someone who signed in from the embed, plus PUBLIC_EMBED_VIEW_ONLY while editing hasn't been
 * started in the frame. Never the session cookie.
 */
function publicEmbed(ctx: ServerContext): WsRoute {
  return {
    prefix: PUBLIC_PREFIX,
    handle(ws, req) {
      const offered = offeredProtocols(req);
      const token = offered.slice(1).find((p) => p.startsWith(MEMBER_TOKEN_PREFIX)) ?? null;
      const viewOnly = offered.includes(PUBLIC_EMBED_VIEW_ONLY);
      const boardId = boardIdOf(req, PUBLIC_PREFIX);
      // A visitor's session key only ties the socket to itself (nothing signs it out but closing).
      void admitSocket(ws, null, async () => {
        if (offered[0] !== PUBLIC_EMBED_WS_PROTOCOL || !boardId) return { code: 4403, reason: 'No access to this board' };
        if (token) {
          const m = await memberOf(token);
          if (!m) return { code: 4401, reason: 'Sign in again to see this board here' };
          if (m.boardId !== boardId) return { code: 4403, reason: 'No access to this board' };
          const user = m.user;
          if (!(await checkRateLimit('wsConnect', `user:${user.id}`)).allowed) return { code: 4429, reason: 'Too many connections' };
          const role = await memberRole(boardId, user.id);
          if (!role) return { code: 4403, reason: 'No access to this board' };
          return {
            boardId,
            userId: user.id,
            role,
            maxRole: viewOnly ? 'viewer' : m.maxRole,
            // The session that signed in: signing out (anywhere) closes this socket too.
            sessionKey: m.sessionKey,
            identity: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl },
            authorNames: await authorNamesOf(user.id),
            resolveRole: () => memberRole(boardId, user.id),
          };
        }
        if (!(await visitorRole(boardId))) return { code: 4403, reason: 'Sign in to see this board' };
        if (!takeVisitorSeat(ws, boardId, ctx.config.embedMaxVisitors)) return { code: WS_CLOSE_EMBED_FULL, reason: 'Too many people are watching this board here right now' };
        // No account, no guest session: an id no account or guest can have, and no presence.
        const id = `${GUEST_ID_PREFIX}embed${newId(16)}`;
        return {
          boardId,
          userId: id,
          role: 'viewer',
          sessionKey: `embed-visitor:${id}`,
          identity: { id, name: 'Visitor', color: '#8a8f98', avatarUrl: null },
          authorName: 'Visitor',
          visitor: true,
          resolveRole: () => visitorRole(boardId),
        };
      });
    },
  };
}
