// Freero's Google Meet add-on (#169; docs/integrations/google-meet.md). Off unless the operator sets
// GOOGLE_MEET_CLOUD_PROJECT_NUMBER (platform/config `meet`):
//
//   GET /meet/sidepanel                          the side panel: pick a board, open it for everyone
//   GET /meet/stage/:id                          the main stage: the board's public embed, while the
//                                                board allows embedding
//   GET /api/integrations/meet                   MeetAddOnInfo (the operator console; the pages' project number)
//   GET /api/integrations/meet/deployment.json   the add-on's deployment manifest for this instance
//   GET /api/integrations/meet/logo.png          its logo (Freero's mark)
//
// Framing: only Google Meet (https://meet.google.com) may frame the two pages, and they may load
// Google's Meet add-ons SDK from Google (https://www.gstatic.com): its terms let nobody bundle it, so
// the pages load it where Google serves it, and only these pages' CSP names that origin. They act on
// no session cookie: people sign in through the public embed's first-party window and its
// board-bound token (modules/embed). In development Vite serves the pages and sets no headers.
import { Router } from 'express';
import type { MeetAddOnInfo } from '@freero/shared';
import { colorIcon } from '../../platform/brandIcons';
import type { ServerContext } from '../../platform/context';
import { appPageReader, packageOrigin, sendAppPage } from '../../platform/hostApps';
import { handle } from '../../platform/http';
import { frameFromOrigins } from '../../platform/security';
import { boardEmbedding } from '../boards/index';
import { MEET_DEPLOYMENT_PATH, MEET_LOGO_PATH, MEET_SDK_ORIGIN, meetDeployment } from './deployment';

export const mountPath = '/';

/** Who may frame the add-on's pages: Google Meet on the web, where add-ons run. */
export const MEET_FRAME_ANCESTORS = ['https://meet.google.com'] as const;

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export default function meetRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { meet } = ctx.config;
  const appPage = appPageReader(ctx.config);
  const framedByMeet = (req: Parameters<typeof frameFromOrigins>[0], res: Parameters<typeof frameFromOrigins>[1]) =>
    frameFromOrigins(req, res, ctx.config, MEET_FRAME_ANCESTORS, 'Google Meet frames the add-on’s side panel and main stage; they use no session cookie and sign in with a board-bound embed token', { scripts: [MEET_SDK_ORIGIN] });

  r.get(
    '/api/integrations/meet',
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ on: !!meet, packageUrl: meet ? MEET_DEPLOYMENT_PATH : null, cloudProjectNumber: meet?.cloudProjectNumber ?? null } satisfies MeetAddOnInfo);
    }),
  );
  if (!meet) return r;

  r.get(
    MEET_DEPLOYMENT_PATH,
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.json(meetDeployment(packageOrigin(ctx.config.publicUrl, 'Google Meet')));
    }),
  );
  // Google shows the logo in Meet's activities panel and the Marketplace: public, like the site's own.
  const logo = colorIcon(256);
  r.get(MEET_LOGO_PATH, (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type('png').send(logo);
  });

  r.get(
    '/meet/sidepanel',
    handle(async (req, res, next) => {
      const html = await appPage();
      if (html === null) return next();
      framedByMeet(req, res);
      sendAppPage(res, html);
    }),
  );
  r.get(
    '/meet/stage/:id',
    handle(async (req, res, next) => {
      const html = await appPage();
      if (html === null) return next();
      // Exactly the public embed's rule: framed only while the board allows embedding.
      if (BOARD_ID.test(req.params.id) && (await boardEmbedding(req.params.id))) framedByMeet(req, res);
      sendAppPage(res, html);
    }),
  );
  return r;
}
