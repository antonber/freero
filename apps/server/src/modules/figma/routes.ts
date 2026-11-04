// Figma (#171; contract in @freero/shared api.ts "Figma frames as images"):
//   GET    /api/integrations/figma/me                      the signed-in person's Figma connection (DELETE: disconnect)
//   GET    /api/integrations/figma/oauth/start, …/callback  "Connect Figma"
//   GET    /api/integrations/figma/files                   files they used through Freero
//   GET    /api/integrations/figma/files/:key/frames       a file's top-level frames, with previews
//   POST   /api/boards/:id/figma/place                     a frame rendered and copied into their uploads
import { Router } from 'express';
import type { FigmaFilesResponse, FigmaFramesResponse, FigmaPlaceResponse, FigmaStatus } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { finishFigmaConnect, startFigmaConnect } from './oauth';
import { disconnectFigma, figmaFrames, figmaStatus, placeFigmaFrame, recentFigmaFiles } from './service';

const P = '/integrations/figma';
const noStore = { 'Cache-Control': 'private, no-store' };

export default function figmaRoutes(_ctx: ServerContext): Router {
  const r = Router();

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

  return r;
}
