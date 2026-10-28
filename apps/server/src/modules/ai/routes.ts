// AI routes (contract: @freero/shared api.ts "AI"). While AI is off on this instance (no AI_PROVIDER
// and no workspace keys) every route answers 404 — except the board status the board page loads on
// every open, which answers `{ ai: null }` so a server without AI logs no error on each board load.
import { Router } from 'express';
import type { AiActionResponse, BoardAiStatus, WorkspaceAiAdmin } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { aiOffered, decideAi, requireAiOffered, statusOf } from './access';
import { runAiAction } from './service';
import { getAiAdmin, testAiSettings, updateAiSettings } from './settings';

export default function aiRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/boards/:id/ai',
    requireUser,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      if (!aiOffered()) {
        res.json({ ai: null });
        return;
      }
      res.json({ ai: statusOf(await decideAi(req.params.id, currentUser(req).id)) satisfies BoardAiStatus });
    }),
  );

  r.post(
    '/boards/:id/ai/actions',
    requireUser,
    // Off: 404 before anything is counted.
    (_req, _res, next) => {
      try {
        requireAiOffered();
        next();
      } catch (e) {
        next(e);
      }
    },
    rateLimit('ai', 'user'),
    handle(async (req, res) => {
      const result: AiActionResponse = await runAiAction(req.params.id, currentUser(req).id, req.body);
      res.status(result.target === 'preview' ? 200 : 201).json(result);
    }),
  );

  r.get(
    '/workspaces/:id/admin/ai',
    requireUser,
    handle(async (req, res) => {
      res.json((await getAiAdmin(req.params.id, currentUser(req).id)) satisfies WorkspaceAiAdmin);
    }),
  );

  r.patch(
    '/workspaces/:id/admin/ai',
    requireUser,
    handle(async (req, res) => {
      res.json((await updateAiSettings(req.params.id, currentUser(req).id, req.body)) satisfies WorkspaceAiAdmin);
    }),
  );

  r.post(
    '/workspaces/:id/admin/ai/test',
    requireUser,
    rateLimit('ai', 'user'),
    handle(async (req, res) => {
      res.json(await testAiSettings(req.params.id, currentUser(req).id));
    }),
  );

  return r;
}
