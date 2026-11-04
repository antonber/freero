import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { deleteBlueprint, listBlueprints, saveFromProject, updateBlueprint, useBlueprint } from './service';

export default function blueprintRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/blueprints',
    requireUser,
    handle(async (req, res) => {
      res.json({ blueprints: await listBlueprints(currentUser(req).id) });
    }),
  );

  r.post(
    '/projects/:id/blueprints',
    requireUser,
    rateLimit('templateSave', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ blueprint: await saveFromProject(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );

  r.patch(
    '/blueprints/:id',
    requireUser,
    handle(async (req, res) => {
      res.json({ blueprint: await updateBlueprint(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );

  r.delete(
    '/blueprints/:id',
    requireUser,
    handle(async (req, res) => {
      await deleteBlueprint(req.params.id, currentUser(req).id);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/blueprints/:id/use',
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      res.status(201).json(await useBlueprint(req.params.id, currentUser(req).id, req.body ?? {}));
    }),
  );

  return r;
}
