// Shape pack routes (contract: @freero/shared api.ts "Shape packs").
import { Router } from 'express';
import type { ShapePack, ShapePackCreated, ShapePacksResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { createPack, listPacks, removePack, renamePack } from './service';

type Out = ShapePacksResponse | ShapePackCreated | { pack: ShapePack } | { ok: true };

export default function shapePackRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/boards/:id/shape-packs',
    requireUser,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json((await listPacks(req.params.id, currentUser(req).id)) satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/shape-packs',
    requireUser,
    // Reading and sanitising a ZIP of SVGs is real work: counted like an upload.
    rateLimit('upload', 'user'),
    handle(async (req, res) => {
      res.status(201).json((await createPack(req.params.id, currentUser(req).id, req.body)) satisfies Out);
    }),
  );

  r.patch(
    '/shape-packs/:id',
    requireUser,
    handle(async (req, res) => {
      res.json({ pack: await renamePack(req.params.id, currentUser(req).id, req.body) } satisfies Out);
    }),
  );

  r.delete(
    '/shape-packs/:id',
    requireUser,
    handle(async (req, res) => {
      await removePack(req.params.id, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  return r;
}
