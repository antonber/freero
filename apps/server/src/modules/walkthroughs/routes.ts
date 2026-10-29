// Async walkthroughs (contract: @freero/shared walkthroughs.ts).
import { Router } from 'express';
import type { Walkthrough, WalkthroughComment, WalkthroughSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { actorId, currentActor, currentUser, requireUser, requireUserOrGuest } from '../auth/index';
import { attachmentDisposition } from '../uploads/index';
import {
  addComment,
  captionsUnavailable,
  createWalkthrough,
  deleteComment,
  deleteWalkthrough,
  getWalkthrough,
  listComments,
  listWalkthroughs,
  openWalkthroughDownload,
  recordView,
  renameWalkthrough,
  setCaptions,
  transcribeWalkthrough,
} from './service';

export default function walkthroughRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const base = '/boards/:id/walkthroughs';
  const one = `${base}/:wid`;
  const who = (req: Parameters<typeof currentActor>[0]) => actorId(currentActor(req));

  r.get(
    base,
    requireUserOrGuest,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ walkthroughs: await listWalkthroughs(req.params.id, who(req)) } satisfies { walkthroughs: WalkthroughSummary[] });
    }),
  );

  r.post(
    base,
    requireUser,
    rateLimit('upload', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ walkthrough: await createWalkthrough(req.params.id, currentUser(req).id, req.body) } satisfies { walkthrough: Walkthrough });
    }),
  );

  // Not under /:wid: a walkthrough id could be anything.
  r.get(
    '/boards/:id/walkthroughs-captions',
    requireUserOrGuest,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const reason = await captionsUnavailable(req.params.id, who(req));
      res.json(reason ? { available: false, reason } : { available: true });
    }),
  );

  r.get(
    one,
    requireUserOrGuest,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ walkthrough: await getWalkthrough(req.params.id, req.params.wid, who(req)) } satisfies { walkthrough: Walkthrough });
    }),
  );

  r.patch(
    one,
    requireUser,
    handle(async (req, res) => {
      res.json({ walkthrough: await renameWalkthrough(req.params.id, req.params.wid, currentUser(req).id, req.body) } satisfies { walkthrough: Walkthrough });
    }),
  );

  r.delete(
    one,
    requireUser,
    handle(async (req, res) => {
      await deleteWalkthrough(req.params.id, req.params.wid, currentUser(req).id);
      res.status(204).end();
    }),
  );

  r.post(
    `${one}/views`,
    requireUserOrGuest,
    handle(async (req, res) => {
      res.json({ views: await recordView(req.params.id, req.params.wid, who(req)) });
    }),
  );

  r.get(
    `${one}/comments`,
    requireUserOrGuest,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ comments: await listComments(req.params.id, req.params.wid, who(req)) } satisfies { comments: WalkthroughComment[] });
    }),
  );

  r.post(
    `${one}/comments`,
    requireUser,
    rateLimit('walkthroughComment', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ comment: await addComment(req.params.id, req.params.wid, currentUser(req).id, req.body) } satisfies { comment: WalkthroughComment });
    }),
  );

  r.delete(
    `${one}/comments/:cid`,
    requireUser,
    handle(async (req, res) => {
      await deleteComment(req.params.id, req.params.wid, req.params.cid, currentUser(req).id);
      res.status(204).end();
    }),
  );

  r.put(
    `${one}/transcript`,
    requireUser,
    handle(async (req, res) => {
      res.json({ walkthrough: await setCaptions(req.params.id, req.params.wid, currentUser(req).id, req.body) } satisfies { walkthrough: Walkthrough });
    }),
  );

  r.post(
    `${one}/transcript`,
    requireUser,
    handle(async (req, res) => {
      res.json({ walkthrough: await transcribeWalkthrough(req.params.id, req.params.wid, currentUser(req).id) } satisfies { walkthrough: Walkthrough });
    }),
  );

  r.get(
    `${one}/download`,
    requireUserOrGuest,
    rateLimit('download', 'user'),
    handle(async (req, res) => {
      const file = await openWalkthroughDownload(req.params.id, req.params.wid, who(req));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', attachmentDisposition(file.name));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      if (file.size !== null) res.setHeader('Content-Length', String(file.size));
      file.body.on('error', () => res.destroy()).pipe(res);
    }),
  );

  return r;
}
