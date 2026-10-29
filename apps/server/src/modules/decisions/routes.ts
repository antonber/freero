// Decision snapshots (contract: @freero/shared decisions.ts).
import { Router } from 'express';
import type { Decision, DecisionChanges, DecisionResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { actorId, currentActor, currentUser, requireUser, requireUserOrGuest } from '../auth/index';
import { createDecision, decisionChanges, decisionState, deleteDecision, getDecision, listDecisions } from './service';

export default function decisionRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/boards/:id/decisions',
    requireUserOrGuest,
    handle(async (req, res) => {
      res.json({ decisions: await listDecisions(req.params.id, actorId(currentActor(req))) } satisfies { decisions: Decision[] });
    }),
  );

  // Each one keeps a full copy of the board, like naming a version.
  r.post(
    '/boards/:id/decisions',
    requireUser,
    rateLimit('version', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ decision: await createDecision(req.params.id, currentUser(req).id, req.body) } satisfies { decision: Decision });
    }),
  );

  r.get(
    '/decisions/:id',
    requireUserOrGuest,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json((await getDecision(req.params.id, actorId(currentActor(req)))) satisfies DecisionResponse);
    }),
  );

  r.get(
    '/decisions/:id/state',
    requireUserOrGuest,
    handle(async (req, res) => {
      const state = await decisionState(req.params.id, actorId(currentActor(req)));
      res.setHeader('Cache-Control', 'private, no-store');
      res.type('application/octet-stream').send(Buffer.from(state.buffer, state.byteOffset, state.byteLength));
    }),
  );

  r.get(
    '/decisions/:id/changes',
    requireUserOrGuest,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json((await decisionChanges(req.params.id, actorId(currentActor(req)))) satisfies DecisionChanges);
    }),
  );

  r.delete(
    '/decisions/:id',
    requireUser,
    handle(async (req, res) => {
      await deleteDecision(req.params.id, currentUser(req).id);
      res.status(204).end();
    }),
  );

  return r;
}
