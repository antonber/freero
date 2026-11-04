// Board import from another whiteboard's API (#62; contract in @freero/shared api.ts "Board import
// from Miro"; docs/design/importers.md):
//   POST /api/boards/:id/import/miro   body { board, token }   a Miro board read with the person's own token
import { Router } from 'express';
import type { MiroImportResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { importFromMiro } from './service';

export default function importersRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.post(
    '/boards/:id/import/miro',
    requireUser,
    rateLimit('boardImport', 'user'),
    handle(async (req, res) => res.set('Cache-Control', 'private, no-store').json((await importFromMiro(req.params.id, currentUser(req).id, req.body)) satisfies MiroImportResponse)),
  );
  return r;
}
