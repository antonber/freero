// "Report a problem": the reporter's routes (session) and the operators' (session, 404 for anyone
// else — the same answer as an unknown path). Machine access for operators is modules/api's
// /api/v1/operator/problems with a `problems:triage` token.
import express, { Router, type RequestHandler } from 'express';
import { MAX_PROBLEM_SCREENSHOT_BYTES } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle, HttpError, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, isOperator, requireUser } from '../auth/index';
import { attachScreenshot, createProblem, listProblems, ownProblems, problemDetail, problemScreenshot, updateProblem } from './service';
import { sendScreenshot } from './screenshot';

/** 404 for everyone but operators: the operator API doesn't announce itself. */
const operatorOnly: RequestHandler = (req, _res, next) => (isOperator(currentUser(req)) ? next() : next(notFound()));

/** The raw image body, capped; over the cap is a 413 before the rest is read. */
const imageBody: RequestHandler = (req, res, next) =>
  express.raw({ type: () => true, limit: MAX_PROBLEM_SCREENSHOT_BYTES })(req, res, (err?: unknown) =>
    next((err as { type?: string } | undefined)?.type === 'entity.too.large' ? new HttpError(413, `The screenshot is too large (max ${MAX_PROBLEM_SCREENSHOT_BYTES / 1024 / 1024} MB)`) : err),
  );

const body = (req: express.Request) => (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {});

export default function problemRoutes(_ctx: ServerContext): Router {
  const r = Router();

  // ---- the reporter ----
  r.post(
    '/problems',
    requireUser,
    rateLimit('problemReport', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ problem: await createProblem(currentUser(req).id, body(req)) });
    }),
  );
  r.put(
    '/problems/:id/screenshot',
    requireUser,
    imageBody,
    handle(async (req, res) => {
      const data: unknown = req.body;
      res.json({ problem: await attachScreenshot(currentUser(req).id, req.params.id, Buffer.isBuffer(data) ? data : Buffer.alloc(0)) });
    }),
  );
  r.get(
    '/problems',
    requireUser,
    handle(async (req, res) => {
      res.json({ problems: await ownProblems(currentUser(req).id) });
    }),
  );

  // ---- operators ----
  r.get(
    '/operator/problems',
    requireUser,
    operatorOnly,
    handle(async (req, res) => {
      res.json(await listProblems(req.query));
    }),
  );
  r.get(
    '/operator/problems/:id',
    requireUser,
    operatorOnly,
    handle(async (req, res) => {
      res.json({ problem: await problemDetail(req.params.id) });
    }),
  );
  r.get(
    '/operator/problems/:id/screenshot',
    requireUser,
    operatorOnly,
    handle(async (req, res) => {
      sendScreenshot(res, await problemScreenshot(currentUser(req).id, req.params.id, 'app'));
    }),
  );
  r.patch(
    '/operator/problems/:id',
    requireUser,
    operatorOnly,
    handle(async (req, res) => {
      res.json({ problem: await updateProblem(currentUser(req).id, req.params.id, body(req), 'app') });
    }),
  );

  return r;
}
