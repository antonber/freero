// Freero's Zoom App (#168; docs/integrations/zoom.md). Off unless the operator sets ZOOM_CLIENT_ID
// (platform/config `zoom`):
//
//   GET  /zoom/home                                      the app's home: the meeting's board, or a chooser
//   GET  /zoom/b/:id                                     the board: its public embed (while it allows embedding)
//   GET  /api/integrations/zoom                          HostAppInfo (the operator console)
//   GET  /api/integrations/zoom/app-settings             the build-flow values for this instance (settings.ts)
//   PUT  /api/integrations/zoom/meeting-board            { meetingUuid, boardId, token? } → { ok: true }
//                                                        (signed in, or the board's embed token)
//   POST /api/integrations/zoom/meeting-board/lookup     { meetingUuid } → ZoomMeetingBoard
//
// Zoom's desktop and mobile apps load the pages at the top level of their own browser (with its own
// cookies: people sign in to Freero right there); Zoom's web client frames them, so /zoom/home and
// /zoom/b/:id may be framed by Zoom's web origins only (the board page only while the board allows
// embedding). Framed, the pages see no session cookie (a third-party frame) and sign in through the
// public embed's first-party window instead. /zoom/installed (where Zoom sends people after they
// add the app) is an ordinary page. Every Freero response already carries the security headers Zoom
// asks of an app's pages (Content-Security-Policy, Strict-Transport-Security,
// X-Content-Type-Options, Referrer-Policy).
import { Router } from 'express';
import type { HostAppInfo, ZoomMeetingBoard } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { appPageReader, packageOrigin, sendAppPage } from '../../platform/hostApps';
import { handle, unauthorized } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { frameFromOrigins } from '../../platform/security';
import { userFromCookieHeader } from '../auth/index';
import { boardEmbedding } from '../boards/index';
import { memberOf } from '../embed/index';
import { meetingBoard, setMeetingBoard } from './service';
import { ZOOM_SETTINGS_PATH, zoomAppSettings } from './settings';

export const mountPath = '/';

/** Who may frame the Zoom pages: Zoom's web client, where Zoom Apps run in a frame. */
export const ZOOM_FRAME_ANCESTORS = ['https://zoom.us', 'https://*.zoom.us'] as const;

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export default function zoomRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { zoom } = ctx.config;

  r.get(
    '/api/integrations/zoom',
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ on: !!zoom, packageUrl: zoom ? ZOOM_SETTINGS_PATH : null } satisfies HostAppInfo);
    }),
  );
  if (!zoom) return r;
  const appPage = appPageReader(ctx.config);
  const framedByZoom = (req: Parameters<typeof frameFromOrigins>[0], res: Parameters<typeof frameFromOrigins>[1]) =>
    frameFromOrigins(req, res, ctx.config, ZOOM_FRAME_ANCESTORS, 'Zoom’s web client frames the Freero Zoom App’s pages; framed they see no session cookie and sign in with a board-bound embed token');

  r.get(
    '/zoom/home',
    handle(async (req, res, next) => {
      const html = await appPage();
      if (html === null) return next();
      framedByZoom(req, res);
      sendAppPage(res, html);
    }),
  );
  r.get(
    '/zoom/b/:id',
    handle(async (req, res, next) => {
      const html = await appPage();
      if (html === null) return next();
      if (BOARD_ID.test(req.params.id) && (await boardEmbedding(req.params.id))) framedByZoom(req, res);
      sendAppPage(res, html);
    }),
  );

  r.get(
    ZOOM_SETTINGS_PATH,
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.json(zoomAppSettings(packageOrigin(ctx.config.publicUrl, 'Zoom'), zoom.clientId));
    }),
  );

  r.put(
    '/api/integrations/zoom/meeting-board',
    rateLimit('zoomMeetingBoard', 'ip'),
    handle(async (req, res) => {
      const b = (req.body ?? {}) as { meetingUuid?: unknown; boardId?: unknown; token?: unknown };
      // Zoom's own browser has the session; Zoom's web client frames the page, which then has only
      // the embed's token for that board (a session in another window).
      const member = typeof b.token === 'string' ? await memberOf(b.token) : null;
      const user = (await userFromCookieHeader(req.headers.cookie)) ?? (member && member.boardId === b.boardId ? member.user : null);
      if (!user) throw unauthorized('Sign in to Freero to open a board for the meeting', 'zoom_sign_in');
      await setMeetingBoard(b.meetingUuid, b.boardId, user.id);
      res.json({ ok: true });
    }),
  );
  r.post(
    '/api/integrations/zoom/meeting-board/lookup',
    rateLimit('zoomMeetingBoard', 'ip'),
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ boardId: await meetingBoard((req.body as { meetingUuid?: unknown } | undefined)?.meetingUuid) } satisfies ZoomMeetingBoard);
    }),
  );
  return r;
}
