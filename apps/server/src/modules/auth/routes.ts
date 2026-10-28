import express, { Router } from 'express';
import type { AuthResponse, LoginResponse, SecurityInfo, SessionInfo, SessionResponse, TwoFactorRecoveryStarted } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle, notFound } from '../../platform/http';
import { logError } from '../../platform/log';
import { consumeRateLimit, rateLimit } from '../../platform/rateLimit';
import { deleteUpload, saveUpload } from '../uploads/index';
import { restoreAccount, scheduleAccountDeletion } from './account';
import { MAX_AVATAR_UPLOAD_BYTES, makeAvatar } from './avatar';
import {
  changePassword,
  confirmEmailChange,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  revertEmailChange,
  sendVerification,
  verifyEmail,
} from './emails';
import { locateIp, maskIp } from './geoip';
import { configuredProviders, disconnectIdentity, providerLabel, toLinkedIdentity } from './providers';
import * as repo from './repo';
import {
  cancelTwoFactorRecovery,
  cancelTwoFactorRecoveryByLink,
  finishTwoFactorRecovery,
  startTwoFactorRecovery,
  undoTwoFactor,
} from './recovery';
import { assertSignInAllowed } from './restrictions';
import { completeSignIn, finishTwoFactorSignIn, pendingSignIn, providerCallback, startProviderSignIn } from './signIn';
import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor, regenerateRecoveryCodes, twoFactorRequiredBy } from './twoFactor';
import {
  checkCredentials,
  clearSessionCookie,
  createUser,
  currentSessionAuthAt,
  currentSessionId,
  currentSessionKey,
  currentUser,
  endSession,
  endSessionsOf,
  getAccount,
  normalizeEmail,
  RECENT_AUTH_MS,
  requireSession,
  requireUser,
  sessionFromCookieHeader,
  sessionsEnded,
  startSession,
  updateProfile,
} from './service';

export default function authRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.post(
    '/auth/signup',
    rateLimit('signup'),
    handle(async (req, res) => {
      // An organization that enforces single sign-on for the address makes its accounts itself.
      const email = normalizeEmail(req.body?.email);
      if (email) await assertSignInAllowed({ email, userId: null, method: 'password' });
      const user = await createUser(req.body ?? {});
      await startSession(req, res, user.id);
      // The account works without it; a mail outage must not fail the signup.
      sendVerification(req, user).catch((e) => logError('auth: could not send the verification email', e));
      res.status(201).json({ user } satisfies AuthResponse);
    }),
  );

  r.post(
    '/auth/login',
    rateLimit('login'), // per IP, ...
    handle(async (req, res) => {
      // ... and per account, so a botnet can't spray guesses at one email from many addresses.
      const email = normalizeEmail(req.body?.email);
      await consumeRateLimit('loginAccount', `email:${email}`);
      // Before the password is checked, so a refused account is no password oracle.
      if (email) await assertSignInAllowed({ email, userId: (await repo.findUserByEmail(email))?.id ?? null, method: 'password' });
      const user = await checkCredentials(req.body?.email, req.body?.password);
      res.json((await completeSignIn(req, res, user.id, 'password')) satisfies LoginResponse);
    }),
  );

  // The second step of a sign-in of an account with two-factor on (the pending sign-in is a cookie).
  r.post(
    '/auth/login/two-factor',
    rateLimit('twoFactor'), // per IP (and per account inside)
    handle(async (req, res) => {
      res.json({ user: await finishTwoFactorSignIn(req, res, req.body?.code) } satisfies AuthResponse);
    }),
  );

  // "Lost access to your authenticator?": starts a delayed recovery from the pending sign-in.
  r.post(
    '/auth/login/two-factor/recovery',
    rateLimit('twoFactorRecovery'), // per IP (and per account inside)
    handle(async (req, res) => {
      res.json((await startTwoFactorRecovery(req, await pendingSignIn(req))) satisfies TwoFactorRecoveryStarted);
    }),
  );

  // The link mailed once a recovery's waiting period is over: like a reset link, plus the second step goes.
  r.post(
    '/auth/two-factor/recovery/finish',
    rateLimit('password'),
    handle(async (req, res) => {
      const user = await finishTwoFactorRecovery(req, req.body?.token, req.body?.password);
      res.json((await completeSignIn(req, res, user.id, 'email_link')) satisfies LoginResponse);
    }),
  );

  // The cancel link of the recovery mails (whoever reads the address can stop a recovery).
  r.post(
    '/auth/two-factor/recovery/cancel-link',
    handle(async (req, res) => {
      await cancelTwoFactorRecoveryByLink(req, req.body?.token);
      res.json({ ok: true });
    }),
  );

  // "This wasn't me" from the two-step-on notice.
  r.post(
    '/auth/two-factor/undo',
    rateLimit('password'),
    handle(async (req, res) => {
      const user = await undoTwoFactor(req, req.body?.token, req.body?.password);
      res.json((await completeSignIn(req, res, user.id, 'email_link')) satisfies LoginResponse);
    }),
  );

  // ---- sign in with a provider (browser navigations) ----
  r.get('/auth/providers', (_req, res) => {
    res.json({ providers: configuredProviders() });
  });
  r.get('/auth/oidc/:provider/start', rateLimit('oidc'), handle(startProviderSignIn));
  r.get('/auth/oidc/:provider/callback', rateLimit('oidc'), handle(providerCallback));

  r.post(
    '/auth/logout',
    handle(async (req, res) => {
      await endSession(req, res);
      res.json({ ok: true });
    }),
  );

  // The app's startup check: always 200, so a signed-out visitor's browser logs no failed request.
  // An account awaiting deletion is returned too (with deletionScheduledFor), so the app can offer restore.
  r.get(
    '/auth/session',
    handle(async (req, res) => {
      res.json({ user: (await sessionFromCookieHeader(req.headers.cookie))?.user ?? null } satisfies SessionResponse);
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

  // ---- avatar ----
  r.put(
    '/auth/me/avatar',
    requireUser,
    rateLimit('upload', 'user'),
    express.raw({ type: () => true, limit: MAX_AVATAR_UPLOAD_BYTES }),
    handle(async (req, res) => {
      const me = currentUser(req);
      const body: unknown = req.body;
      const { bytes, type } = await makeAvatar(Buffer.isBuffer(body) ? body : Buffer.alloc(0));
      const url = await saveUpload(bytes, type, me.id);
      const previous = await repo.setAvatar(me.id, url);
      // The previous avatar as of THIS write; if the account vanished meanwhile, drop ours.
      await deleteUpload(previous === undefined ? url : previous);
      res.json({ user: await getAccount(me.id) } satisfies AuthResponse);
    }),
  );

  r.delete(
    '/auth/me/avatar',
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req);
      await deleteUpload(await repo.setAvatar(me.id, null));
      res.json({ user: await getAccount(me.id) } satisfies AuthResponse);
    }),
  );

  // ---- email verification ----
  r.post(
    '/auth/verify-email/send',
    requireUser,
    rateLimit('emailVerify', 'user'),
    handle(async (req, res) => {
      await sendVerification(req, currentUser(req));
      res.json({ ok: true });
    }),
  );

  // Redeeming a 256-bit single-use token can't be guessed; the global per-IP api limit applies.
  r.post(
    '/auth/verify-email',
    handle(async (req, res) => {
      await verifyEmail(req.body?.token);
      res.json({ ok: true });
    }),
  );

  // ---- password ----
  r.post(
    '/auth/password/forgot',
    rateLimit('password'), // per IP, ...
    handle(async (req, res) => {
      // ... and per address, so one inbox can't be flooded from many IPs.
      await consumeRateLimit('password', `email:${normalizeEmail(req.body?.email)}`);
      requestPasswordReset(req, req.body?.email);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/auth/password/reset',
    rateLimit('password'),
    handle(async (req, res) => {
      const user = await resetPassword(req, req.body?.token, req.body?.password);
      // The reset link proves the address, not the second factor.
      res.json((await completeSignIn(req, res, user.id, 'email_link')) satisfies LoginResponse);
    }),
  );

  r.post(
    '/auth/password',
    requireUser,
    rateLimit('password', 'user'),
    handle(async (req, res) => {
      await changePassword(
        req,
        currentUser(req).id,
        currentSessionKey(req),
        req.body?.currentPassword,
        req.body?.newPassword,
        currentSessionAuthAt(req),
      );
      res.json({ ok: true });
    }),
  );

  // ---- email change ----
  r.post(
    '/auth/email',
    requireUser,
    rateLimit('emailVerify', 'user'),
    handle(async (req, res) => {
      await requestEmailChange(req, currentUser(req).id, req.body?.email, req.body?.password, currentSessionAuthAt(req));
      res.json({ ok: true });
    }),
  );

  r.post(
    '/auth/email/confirm',
    handle(async (req, res) => {
      await confirmEmailChange(req, req.body?.token);
      res.json({ ok: true });
    }),
  );

  // "This wasn't me": the link an email change sent to the previous address.
  r.post(
    '/auth/email/revert',
    rateLimit('password'),
    handle(async (req, res) => {
      const user = await revertEmailChange(req.body?.token, req.body?.password);
      // Like a reset link: it proves the address, not a second factor that is still on.
      res.json((await completeSignIn(req, res, user.id, 'email_link')) satisfies LoginResponse);
    }),
  );

  // ---- sessions ----
  r.get(
    '/auth/sessions',
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req);
      const current = currentSessionId(req);
      const sessions: SessionInfo[] = (await repo.listSessions(me.id, Date.now())).map((s) => ({
        id: s.id,
        current: s.id === current,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        userAgent: s.userAgent,
        network: maskIp(s.ip),
        location: locateIp(s.ip),
        method: s.method,
        methodLabel: s.method === 'password' || s.method === 'email_link' ? null : providerLabel(s.method),
        twoFactor: s.twoFactor,
      }));
      res.json({ sessions });
    }),
  );

  r.delete(
    '/auth/sessions/:id',
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req);
      const key = await repo.deleteSessionById(me.id, req.params.id);
      if (!key) throw notFound('That session has already ended');
      sessionsEnded([key]);
      if (key === currentSessionKey(req)) clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/auth/sessions/revoke-others',
    requireUser,
    handle(async (req, res) => {
      res.json({ revoked: await endSessionsOf(currentUser(req).id, currentSessionKey(req)) });
    }),
  );

  // ---- sign-in methods and two-factor ----
  const security = async (req: express.Request): Promise<SecurityInfo> => {
    const me = currentUser(req);
    const user = await repo.findUserById(me.id);
    const recovery = await repo.findRecovery(me.id);
    return {
      hasPassword: !!user?.passwordHash,
      identities: (await repo.listIdentities(me.id)).map(toLinkedIdentity),
      providers: configuredProviders(),
      twoFactor: {
        enabled: await repo.twoFactorEnabled(me.id),
        recoveryCodesLeft: await repo.countRecoveryCodes(me.id),
        requiredBy: await twoFactorRequiredBy(me.id),
        recovery: recovery && { startedAt: recovery.startedAt, readyAt: recovery.readyAt },
      },
      recentAuthUntil: currentSessionAuthAt(req) + RECENT_AUTH_MS,
    };
  };

  r.get('/auth/security', requireUser, handle(async (req, res) => void res.json(await security(req))));

  r.delete(
    '/auth/identities/:id',
    requireUser,
    handle(async (req, res) => {
      await disconnectIdentity(req, currentUser(req).id, req.params.id);
      res.json(await security(req));
    }),
  );

  r.post(
    '/auth/two-factor/setup',
    requireUser,
    rateLimit('twoFactor', 'user'),
    handle(async (req, res) => {
      res.json(await beginTwoFactorSetup(currentUser(req).id, req.body?.password, currentSessionAuthAt(req)));
    }),
  );

  r.post(
    '/auth/two-factor/enable',
    requireUser,
    rateLimit('twoFactor', 'user'),
    handle(async (req, res) => {
      res.json({ recoveryCodes: await enableTwoFactor(req, currentUser(req).id, currentSessionKey(req), req.body?.code) });
    }),
  );

  r.post(
    '/auth/two-factor/disable',
    requireUser,
    rateLimit('twoFactor', 'user'),
    handle(async (req, res) => {
      await disableTwoFactor(req, currentUser(req).id, req.body?.password, req.body?.code, currentSessionAuthAt(req));
      res.json({ ok: true });
    }),
  );

  r.post(
    '/auth/two-factor/recovery-codes',
    requireUser,
    rateLimit('twoFactor', 'user'),
    handle(async (req, res) => {
      res.json({
        recoveryCodes: await regenerateRecoveryCodes(req, currentUser(req).id, req.body?.password, req.body?.code, currentSessionAuthAt(req)),
      });
    }),
  );

  // Anyone still signed in can stop a "lost my authenticator" recovery they didn't start.
  r.post(
    '/auth/two-factor/recovery/cancel',
    requireUser,
    handle(async (req, res) => {
      await cancelTwoFactorRecovery(req, currentUser(req).id, 'signed_in');
      res.json(await security(req));
    }),
  );

  // ---- account deletion ----
  r.post(
    '/auth/account/delete',
    requireUser,
    rateLimit('password', 'user'),
    handle(async (req, res) => {
      const deletionScheduledFor = await scheduleAccountDeletion(req, currentUser(req).id, req.body?.password, currentSessionAuthAt(req));
      clearSessionCookie(res);
      res.json({ deletionScheduledFor });
    }),
  );

  r.post(
    '/auth/account/restore',
    requireSession,
    handle(async (req, res) => {
      res.json({ user: await restoreAccount(currentUser(req).id) } satisfies AuthResponse);
    }),
  );

  return r;
}

