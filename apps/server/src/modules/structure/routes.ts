// POST /api/boards/:id/insert-structure — lay out a structure (outline, list, clusters, graph,
// Mermaid, table) and place it on free space of the board (contract: @freero/shared api.ts
// "Insert structure"). Owners and editors only.
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { insertStructure } from './service';

export default function structureRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.post(
    '/boards/:id/insert-structure',
    requireUser,
    rateLimit('structure', 'user'),
    handle(async (req, res) => {
      const result = await insertStructure(req.params.id, currentUser(req).id, req.body);
      res.status(result.target === 'board' ? 201 : 200).json(result);
    }),
  );
  return r;
}
