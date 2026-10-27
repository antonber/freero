import { Router } from 'express';
import type { AuthResponse, SessionResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { consumeRateLimit, rateLimit } from '../../platform/rateLimit';
import {
  checkCredentials,
  createUser,
  currentUser,
  endSession,
  normalizeEmail,
  requireUser,
  startSession,
  updateProfile,
  userFromCookieHeader,
} from './service';

export default function authRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.post(
    '/auth/signup',
    rateLimit('signup'),
    handle(async (req, res) => {
      const user = await createUser(req.body ?? {});
      await startSession(req, res, user.id);
      res.status(201).json({ user } satisfies AuthResponse);
    }),
  );

  r.post(
    '/auth/login',
    rateLimit('login'), // per IP, ...
    handle(async (req, res) => {
      // ... and per account, so a botnet can't spray guesses at one email from many addresses.
      await consumeRateLimit('loginAccount', `email:${normalizeEmail(req.body?.email)}`);
      const user = await checkCredentials(req.body?.email, req.body?.password);
      await startSession(req, res, user.id);
      res.json({ user } satisfies AuthResponse);
    }),
  );

  r.post(
    '/auth/logout',
    handle(async (req, res) => {
      await endSession(req, res);
      res.json({ ok: true });
    }),
  );

  // The app's startup check: always 200, so a signed-out visitor's browser logs no failed request.
  r.get(
    '/auth/session',
    handle(async (req, res) => {
      res.json({ user: await userFromCookieHeader(req.headers.cookie) } satisfies SessionResponse);
    }),
  );

  r.get('/auth/me', requireUser, (req, res) => {
    res.json({ user: currentUser(req) } satisfies AuthResponse);
  });

  r.patch(
    '/auth/me',
    requireUser,
    handle(async (req, res) => {
      res.json({ user: await updateProfile(currentUser(req).id, req.body ?? {}) } satisfies AuthResponse);
    }),
  );

  return r;
}
