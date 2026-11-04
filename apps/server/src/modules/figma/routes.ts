// Figma (#171; contract in @freero/shared api.ts "Figma frames as images"):
//   GET    /api/integrations/figma/me                      the signed-in person's Figma connection (DELETE: disconnect)
//   GET    /api/integrations/figma/oauth/start, …/callback  "Connect Figma"
//   GET    /api/integrations/figma/files                   files they used through Freero
//   GET    /api/integrations/figma/files/:key/frames       a file's top-level frames, with previews
//   POST   /api/boards/:id/figma/place                     a frame rendered and copied into their uploads
//   GET    /api/integrations/figma/plugin/callback         the Figma plugin's OAuth redirect (#172)
//   POST   /api/integrations/figma/plugin/pickup           the plugin picks up its code with its state
import { Router } from 'express';
import type { FigmaFilesResponse, FigmaFramesResponse, FigmaPlaceResponse, FigmaStatus } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { allowCrossSiteApi } from '../../platform/security';
import { currentUser, requireUser } from '../auth/index';
import { finishFigmaConnect, startFigmaConnect } from './oauth';
import { pluginCallback, pluginPickup } from './plugin';
import { disconnectFigma, figmaFrames, figmaStatus, placeFigmaFrame, recentFigmaFiles } from './service';

const P = '/integrations/figma';
const noStore = { 'Cache-Control': 'private, no-store' };

export default function figmaRoutes(_ctx: ServerContext): Router {
  const r = Router();
  // The Figma plugin's pickup (#172) is called from the plugin's own page (any origin).
  r.use(
    allowCrossSiteApi(/^\/api\/integrations\/figma\/plugin\/pickup$/, 'The Figma plugin picks up its sign-in code with the secret state it made; no cookie is read', {
      methods: 'POST, OPTIONS',
      headers: 'Content-Type',
    }),
  );

  r.get(`${P}/me`, requireUser, handle(async (req, res) => res.set(noStore).json((await figmaStatus(currentUser(req).id)) satisfies FigmaStatus)));
  r.delete(
    `${P}/me`,
    requireUser,
    handle(async (req, res) => {
      if (!(await disconnectFigma(currentUser(req).id))) throw notFound('No Figma account is connected', 'figma_not_connected');
      res.json({ ok: true });
    }),
  );
  r.get(`${P}/oauth/start`, requireUser, rateLimit('oidc', 'ip'), handle((req, res) => startFigmaConnect(req, res, currentUser(req).id)));
  r.get(`${P}/oauth/callback`, requireUser, rateLimit('oidc', 'ip'), handle((req, res) => finishFigmaConnect(req, res, currentUser(req).id)));
  r.get(`${P}/files`, requireUser, handle(async (req, res) => res.set(noStore).json((await recentFigmaFiles(currentUser(req).id)) satisfies FigmaFilesResponse)));
  r.get(
    `${P}/files/:key/frames`,
    requireUser,
    rateLimit('figma', 'user'),
    handle(async (req, res) => res.set(noStore).json((await figmaFrames(currentUser(req).id, req.params.key)) satisfies FigmaFramesResponse)),
  );
  r.post(
    '/boards/:id/figma/place',
    requireUser,
    rateLimit('figma', 'user'),
    rateLimit('upload', 'user'),
    handle(async (req, res) => res.status(201).json((await placeFigmaFrame(req.params.id, currentUser(req).id, req.body)) satisfies FigmaPlaceResponse)),
  );

  // The plugin's sign-in (#172): open to every Freero, with or without the operator's Figma app.
  r.get(`${P}/plugin/callback`, rateLimit('oauthToken', 'ip'), handle(pluginCallback));
  r.post(`${P}/plugin/pickup`, rateLimit('oauthToken', 'ip'), handle(async (req, res) => res.set(noStore).json(await pluginPickup(req.body))));

  return r;
}
