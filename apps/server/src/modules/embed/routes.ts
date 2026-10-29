// A live board view inside an AI assistant (MCP Apps, KAI-171; docs/mcp.md "Live board"). The view
// the assistant shows frames Freero's own page /embed/board/:id (apps/web app/embed), which redeems
// the single-use ticket a tool call minted (modules/apiauth embed.ts) for a short-lived token, and
// opens the board's socket with it (ws.ts). No cookie is involved: the page is a third-party frame,
// and the person's session never reaches the assistant.
//
//   POST /api/embed/redeem { ticket } -> EmbedRedeemResponse     (404 for any ticket that won't do)
import { Router } from 'express';
import type { EmbedRedeemResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle, HttpError, notFound } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { allowFraming } from '../../platform/security';
import { redeemEmbedTicket, useInWorkspace } from '../apiauth/index';
import { boardSummaryFor } from '../boards/index';
import { capRole } from '../realtime/index';

export default function embedRoutes(_ctx: ServerContext): Router {
  // The page the assistant's view frames (served by the web app's SPA fallback).
  allowFraming(
    /^\/embed\//,
    'The live board view of MCP Apps runs framed inside AI assistants (MCP_APP_FRAME_ANCESTORS only); it signs in with its own short-lived token, never the session cookie',
  );
  const r = Router();
  r.post(
    '/embed/redeem',
    handle(async (req, res) => {
      const ticket = (req.body as { ticket?: unknown } | undefined)?.ticket;
      const redeemed = typeof ticket === 'string' ? await redeemEmbedTicket(ticket) : null;
      // Unknown, used, late, revoked: one answer, so a ticket's fate tells nobody anything.
      if (!redeemed) throw notFound('This live view has expired. Ask the assistant to show the board again.');
      const { token, session } = redeemed;
      const user = session.cred.account;
      // The board as the person sees it now (access may have changed since the tool call), within
      // what the connection may do, and only where the team's API switch and blocks let it.
      const board = await boardSummaryFor(session.boardId, user.id);
      try {
        await useInWorkspace(session.cred, board.workspaceId);
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(403, e.message, e.code);
        throw e;
      }
      const role = capRole(board.role, session.maxRole);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        token,
        expiresAt: session.expiresAt,
        user: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl },
        board: { ...board, role },
        boardUrl: appUrl(req, `/board/${encodeURIComponent(board.id)}`),
        app: session.cred.label,
      } satisfies EmbedRedeemResponse);
    }),
  );
  return r;
}
