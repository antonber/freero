import { Router } from 'express';
import type { AuthResponse, SessionResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import {
  checkCredentials,
  createUser,
  currentUser,
  endSession,
  requireUser,
  startSession,
  updateProfile,
  userFromCookieHeader,
} from './service';

export default function authRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.post(
    '/auth/signup',
    handle(async (req, res) => {
      const user = await createUser(req.body ?? {});
      startSession(req, res, user.id);
      res.status(201).json({ user } satisfies AuthResponse);
    }),
  );

  r.post(
    '/auth/login',
    handle(async (req, res) => {
      const user = await checkCredentials(req.body?.email, req.body?.password);
      startSession(req, res, user.id);
      res.json({ user } satisfies AuthResponse);
    }),
  );

  r.post(
    '/auth/logout',
    handle((req, res) => {
      endSession(req, res);
      res.json({ ok: true });
    }),
  );

  // The app's startup check: always 200, so a signed-out visitor's browser logs no failed request.
  r.get('/auth/session', (req, res) => {
    res.json({ user: userFromCookieHeader(req.headers.cookie) } satisfies SessionResponse);
  });

  r.get('/auth/me', requireUser, (req, res) => {
    res.json({ user: currentUser(req) } satisfies AuthResponse);
  });

  r.patch(
    '/auth/me',
    requireUser,
    handle((req, res) => {
      res.json({ user: updateProfile(currentUser(req).id, req.body ?? {}) } satisfies AuthResponse);
    }),
  );

  return r;
}
