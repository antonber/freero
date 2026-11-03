// Live board views framed by other pages.
//
// 1) Inside an AI assistant (MCP Apps, KAI-171; docs/mcp.md "Live board"). The view the assistant
//    shows frames Freero's own page /embed/board/:id (apps/web app/embed), which redeems the
//    single-use ticket a tool call minted (modules/apiauth embed.ts) for a short-lived token, and
//    opens the board's socket with it (ws.ts). No cookie is involved: the page is a third-party
//    frame, and the person's session never reaches the assistant.
//
// 2) On any other site (#2, public.ts; docs/integrations/embedding.md): /embed/b/:id, framable
//    from anywhere exactly while the board allows it, its first-party sign-in popup
//    /embed/connect/:id, oEmbed, and the oEmbed discovery tag on public boards' pages.
//
// Mounted at '/' (the pages are app routes, not /api): every API route below spells its /api.
//   POST /api/embed/redeem { ticket } -> EmbedRedeemResponse     (404 for any ticket that won't do)
//   GET  /api/embed/b/:id             -> PublicEmbedInfo
//   POST /api/embed/b/:id/token       -> PublicEmbedToken         (session; same-origin popup)
//   POST /api/embed/b/:id/me          -> PublicEmbedMember        (401: sign in again)
//   GET  /api/oembed?url=…            -> OEmbedResponse           (404: not an embeddable board)
//   GET  /embed/b/:id, /board/:id     -> the web app's page (headers / discovery decided per board)
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { oembedDiscoveryTag, type EmbedRedeemResponse, type PublicEmbedInfo, type PublicEmbedMember, type PublicEmbedToken } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle, HttpError, notFound, unauthorized } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { allowFraming, allowOpener, frameFromAnySite } from '../../platform/security';
import { redeemEmbedTicket, useInWorkspace } from '../apiauth/index';
import { currentSessionKey, currentUser, requireUser } from '../auth/index';
import { boardEmbedding, boardSummaryFor } from '../boards/index';
import { capRole } from '../realtime/index';
import { oembedFor, parseBoardUrl } from './oembed';
import { memberOf, mintMemberToken } from './public';

export const mountPath = '/';

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export default function embedRoutes(ctx: ServerContext): Router {
  // The page the assistant's view frames (served by the web app's SPA fallback).
  allowFraming(
    /^\/embed\/board\//,
    'The live board view of MCP Apps runs framed inside AI assistants (MCP_APP_FRAME_ANCESTORS only); it signs in with its own short-lived token, never the session cookie',
  );
  // The sign-in popup of a board embedded on another site gives its token to the frame that opened it.
  allowOpener(
    /^\/embed\/connect\//,
    'The embed sign-in popup posts the board-bound token to window.opener, a Freero-origin frame, with targetOrigin set to Freero itself',
  );

  const origin = (req: Request) => appUrl(req, '');
  const indexHtml = path.join(ctx.config.webDist, 'index.html');
  /** The built web app's page, read like main.ts's SPA fallback sends it (null in development, where Vite serves it). */
  const appPage = () => fs.readFile(indexHtml, 'utf8').catch(() => null);

  const r = Router();
  r.post(
    '/api/embed/redeem',
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

  // ---- boards embedded on other sites (#2) ----

  r.get(
    '/api/embed/b/:id',
    handle(async (req, res) => {
      const e = BOARD_ID.test(req.params.id) ? await boardEmbedding(req.params.id) : null;
      res.setHeader('Cache-Control', 'no-store');
      if (!e) return void res.json({ status: 'off' } satisfies PublicEmbedInfo);
      res.json({
        status: 'on',
        boardId: e.id,
        // A private board's embed never names it to someone who has not signed in.
        title: e.visitor ? e.title : null,
        visitor: e.visitor,
        boardUrl: appUrl(req, `/board/${encodeURIComponent(e.id)}`),
      } satisfies PublicEmbedInfo);
    }),
  );

  // From the first-party popup only: the session cookie proves who, the CSRF guard that it is our own page.
  r.post(
    '/api/embed/b/:id/token',
    requireUser,
    handle(async (req, res) => {
      const readonly = (req.body as { readonly?: unknown } | undefined)?.readonly === true;
      const out = await mintMemberToken(req.params.id, currentUser(req).id, currentSessionKey(req), readonly);
      res.setHeader('Cache-Control', 'no-store');
      res.json(out satisfies PublicEmbedToken);
    }),
  );

  r.post(
    '/api/embed/b/:id/me',
    handle(async (req, res) => {
      const token = (req.body as { token?: unknown } | undefined)?.token;
      const m = typeof token === 'string' ? await memberOf(token) : null;
      if (!m || m.boardId !== req.params.id) throw unauthorized('Sign in again to see this board here');
      if (!(await boardEmbedding(m.boardId))) throw notFound('This board can’t be embedded');
      const board = await boardSummaryFor(m.boardId, m.user.id).catch((e: unknown) => {
        // Access gone since the sign-in: the frame offers to sign in (and ask) again.
        if (e instanceof HttpError && (e.status === 403 || e.status === 404)) throw unauthorized('You no longer have access to this board');
        throw e;
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        user: { id: m.user.id, name: m.user.name, color: m.user.color, avatarUrl: m.user.avatarUrl },
        board: { ...board, role: capRole(board.role, m.maxRole) },
        boardUrl: appUrl(req, `/board/${encodeURIComponent(m.boardId)}`),
        expiresAt: m.expiresAt,
      } satisfies PublicEmbedMember);
    }),
  );

  r.get(
    '/api/oembed',
    handle(async (req, res) => {
      const format = req.query.format;
      if (format !== undefined && format !== 'json') throw new HttpError(501, 'Only format=json is offered');
      if (typeof req.query.url !== 'string') throw badRequest('url is required');
      const target = parseBoardUrl(req.query.url, origin(req));
      const e = target ? await boardEmbedding(target.boardId) : null;
      if (!target || !e) throw notFound('Not an embeddable Freero board');
      res.setHeader('Cache-Control', 'public, max-age=300');
      // Unfurlers fetch it from their servers, and in-browser consumers read it cross-origin.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(oembedFor(origin(req), target, e.visitor ? e.title : null, { maxwidth: req.query.maxwidth, maxheight: req.query.maxheight }));
    }),
  );

  // The embed page: framable from anywhere exactly while the board allows embedding. Development
  // (no built app) falls through to Vite, which sets no framing headers at all.
  r.get(
    '/embed/b/:id',
    handle(async (req, res, next) => {
      const html = await appPage();
      if (html === null) return next();
      if (BOARD_ID.test(req.params.id) && (await boardEmbedding(req.params.id)))
        frameFromAnySite(req, res, ctx.config, 'The board’s owner and its workspace allow embedding it on other sites; the page uses no session cookie');
      sendPage(res, html);
    }),
  );

  // A public board's page names its oEmbed endpoint, for unfurlers that read only the HTML.
  r.get(
    '/board/:id',
    handle(async (req, res, next) => {
      const html = await appPage();
      if (html === null || !BOARD_ID.test(req.params.id)) return next();
      const e = await boardEmbedding(req.params.id);
      if (!e?.visitor) return next();
      sendPage(res, html.replace('</head>', `${oembedDiscoveryTag(origin(req), e.id, e.title)}</head>`));
    }),
  );
  return r;
}

/** The app page as main.ts's SPA fallback sends it. */
function sendPage(res: Response, html: string): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
}
