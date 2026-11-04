// Freero for Confluence and Jira (#166, #167; docs/integrations/atlassian.md): an Atlassian Forge
// app (forge.ts) whose macro and issue panel frame /atlassian/b/:id. Off unless the operator sets
// ATLASSIAN_APP_ID (platform/config `atlassian`):
//
//   GET /atlassian/b/:id                         the board: the public embed, framed by Atlassian's
//                                                hosts only, while the board allows embedding
//   GET /api/integrations/atlassian              HostAppInfo (the operator console)
//   GET /api/integrations/atlassian/forge-app    the Forge app's source (zip) for this instance
//
// Framing: Confluence and Jira pages (*.atlassian.net, older *.jira.com sites) hold the Forge app's
// own frame, served from Atlassian's Forge hosting (*.cdn.prod.atlassian-dev.net), which frames
// this page: frame-ancestors names exactly those, never '*'. The page acts on no session cookie: a
// reader signs in through the public embed's first-party window and its board-bound token
// (modules/embed). In development Vite serves the page and sets no framing headers.
import { Router, type Response } from 'express';
import type { HostAppInfo } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { appPageReader, packageOrigin, sendAppPage, sendPackage } from '../../platform/hostApps';
import { handle } from '../../platform/http';
import { frameFromOrigins } from '../../platform/security';
import { boardEmbedding } from '../boards/index';
import { FORGE_PACKAGE_PATH, forgeAppPackage } from './forge';

export const mountPath = '/';

/**
 * Who may frame /atlassian/b/: Atlassian Cloud sites, and Forge's hosting of the app's own frame
 * (developer.atlassian.com/platform/forge/custom-ui: Custom UI runs in an iframe Atlassian serves).
 */
export const ATLASSIAN_FRAME_ANCESTORS = ['https://*.atlassian.net', 'https://*.jira.com', 'https://*.cdn.prod.atlassian-dev.net'] as const;

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export default function atlassianRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { atlassian } = ctx.config;
  const appPage = appPageReader(ctx.config);

  r.get(
    '/api/integrations/atlassian',
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ on: !!atlassian, packageUrl: atlassian ? FORGE_PACKAGE_PATH : null } satisfies HostAppInfo);
    }),
  );
  if (!atlassian) return r;

  r.get(
    FORGE_PACKAGE_PATH,
    handle(async (_req, res: Response) => {
      const origin = packageOrigin(ctx.config.publicUrl, 'Atlassian');
      sendPackage(res, `freero-atlassian-${new URL(origin).hostname}.zip`, forgeAppPackage(origin, atlassian.appId));
    }),
  );

  r.get(
    '/atlassian/b/:id',
    handle(async (req, res, next) => {
      const html = await appPage();
      if (html === null) return next();
      // Exactly the public embed's rule: framed only while the board allows embedding.
      if (BOARD_ID.test(req.params.id) && (await boardEmbedding(req.params.id)))
        frameFromOrigins(req, res, ctx.config, ATLASSIAN_FRAME_ANCESTORS, 'Confluence and Jira frame the Freero Forge app’s board page; it uses no session cookie and signs in with a board-bound embed token');
      sendAppPage(res, html);
    }),
  );
  return r;
}
