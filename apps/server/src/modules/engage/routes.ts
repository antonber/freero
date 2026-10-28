// Live audience activities (KAI-132): the REST side of answering (see @freero/shared api.ts). Open
// to anyone who can open the board, guests included (requireUserOrGuest; the board and the
// activity decide the rest), rate limited per person.
import { Router } from 'express';
import type { ActivityState } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentActor, requireUserOrGuest } from '../auth/index';
import * as service from './service';

const BASE = '/boards/:id/activities/:aid';

export default function engageRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const send = (res: { json(b: ActivityState): void }, s: ActivityState) => res.json(s);

  r.get(
    BASE,
    requireUserOrGuest,
    handle(async (req, res) => send(res, await service.activityState(req.params.id, req.params.aid, currentActor(req)))),
  );
  r.put(
    `${BASE}/answer`,
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => send(res, await service.answer(req.params.id, req.params.aid, currentActor(req), req.body?.answer))),
  );
  r.delete(
    `${BASE}/answer`,
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => send(res, await service.withdraw(req.params.id, req.params.aid, currentActor(req)))),
  );
  r.post(
    `${BASE}/questions`,
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => send(res, await service.ask(req.params.id, req.params.aid, currentActor(req), req.body?.text))),
  );
  r.put(
    `${BASE}/questions/:qid/upvote`,
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => send(res, await service.upvote(req.params.id, req.params.aid, req.params.qid, currentActor(req), req.body?.on))),
  );
  r.patch(
    `${BASE}/questions/:qid`,
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => send(res, await service.moderate(req.params.id, req.params.aid, req.params.qid, currentActor(req), req.body ?? {}))),
  );
  r.post(
    `${BASE}/reveal`,
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => send(res, await service.reveal(req.params.id, req.params.aid, currentActor(req), req.body?.revealed))),
  );
  r.delete(
    `${BASE}/answers`,
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => send(res, await service.clear(req.params.id, req.params.aid, currentActor(req)))),
  );
  return r;
}
