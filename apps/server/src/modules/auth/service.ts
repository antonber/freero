import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { ACCOUNT_PENDING_DELETION, SESSION_COOKIE, type Account, type User } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, parseCookies, unauthorized } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { publish, subscribe } from '../../platform/pubsub';
import { clientIp } from '../../platform/rateLimit';
import { setRequestUser } from '../../platform/requestContext';
import { randomCursorColor } from './colors';
import { dummyHash, hashPassword, verifyPassword } from './password';
import * as repo from './repo';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often per session (per instance). */
const LAST_SEEN_RESOLUTION_MS = 60_000;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

const emailTaken = () => new HttpError(409, 'An account with that email already exists');

export function publicUser(u: User): User {
  return { id: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, createdAt: u.createdAt };
}

export function toAccount(u: Account): Account {
  return { ...publicUser(u), emailVerified: u.emailVerified, deletionScheduledFor: u.deletionScheduledFor };
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function validEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

export function validatePassword(password: unknown): string {
  const p = typeof password === 'string' ? password : '';
  if (p.length < 8) throw badRequest('Password must be at least 8 characters');
  if (p.length > 512) throw badRequest('Password is too long');
  return p;
}

export async function createUser(
  input: { name: unknown; email: unknown; password: unknown },
  opts: { emailVerified?: boolean } = {},
): Promise<Account> {
  const email = normalizeEmail(input.email);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!validEmail(email)) throw badRequest('Please enter a valid email address');
  const password = validatePassword(input.password);
  if (!name) throw badRequest('Please enter your name');
  if (name.length > 80) throw badRequest('Name is too long (max 80 characters)');
  if (await repo.findUserByEmail(email)) throw emailTaken(); // fast path; the unique index decides races
  const user: repo.UserWithHash = {
    id: newId(),
    email,
    name,
    color: randomCursorColor(),
    avatarUrl: null,
    createdAt: Date.now(),
    emailVerified: opts.emailVerified ?? false,
    deletionScheduledFor: null,
    passwordHash: await hashPassword(password),
  };
  try {
    await repo.insertUser(user);
  } catch (e) {
    // Lost a race against a concurrent signup with the same email.
    if (e instanceof repo.EmailTakenError) throw emailTaken();
    throw e;
  }
  return toAccount(user);
}

export async function checkCredentials(emailIn: unknown, passwordIn: unknown): Promise<Account> {
  const email = normalizeEmail(emailIn);
  const password = typeof passwordIn === 'string' ? passwordIn : '';
  const user = email ? await repo.findUserByEmail(email) : null;
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  return toAccount(user);
}

/** Re-checks the signed-in user's password before a sensitive change (403, not 401: they stay signed in). */
export async function confirmPassword(userId: string, password: unknown): Promise<repo.UserWithHash> {
  const user = await repo.findUserById(userId);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(typeof password === 'string' ? password : '', user.passwordHash)))
    throw new HttpError(403, 'That password is not correct');
  return user;
}

export async function updateProfile(userId: string, body: Record<string, unknown>): Promise<Account> {
  const patch: { name?: string; color?: string; avatarUrl?: string | null } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw badRequest('Name must be 1-80 characters');
    patch.name = name;
  }
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !HEX_COLOR_RE.test(body.color)) throw badRequest('Color must be a hex color like #1C7ED6');
    patch.color = body.color;
  }
  if (body.avatarUrl !== undefined) {
    const v = body.avatarUrl;
    if (v !== null && (typeof v !== 'string' || v.length > 2048 || !/^(\/uploads\/|https?:\/\/)/.test(v)))
      throw badRequest('avatarUrl must be an /uploads URL, an http(s) URL or null');
    patch.avatarUrl = v as string | null;
  }
  await repo.updateUserProfile(userId, patch);
  return getAccount(userId);
}

export async function getAccount(userId: string): Promise<Account> {
  const u = await repo.findUserById(userId);
  if (!u) throw unauthorized();
  return toAccount(u);
}

// ---- Email verification events ----

const verifiedListeners = new Set<(user: { id: string; email: string }) => Promise<void> | void>();

/**
 * Called after a user proves they read mail sent to `email` (verification link, password reset,
 * email change, an invite link sent to that address). Members converts pending invites here.
 */
export function onEmailVerified(fn: (user: { id: string; email: string }) => Promise<void> | void): () => void {
  verifiedListeners.add(fn);
  return () => verifiedListeners.delete(fn);
}

/** Marks `email` verified for the user if it is still their address; runs the listeners. */
export async function markEmailVerified(userId: string, email: string): Promise<boolean> {
  if (!(await repo.markEmailVerified(userId, email, Date.now()))) return false;
  await emailVerified(userId, email);
  return true;
}

export async function emailVerified(userId: string, email: string): Promise<void> {
  for (const fn of verifiedListeners) {
    try {
      await fn({ id: userId, email });
    } catch (e) {
      logError('auth: an email-verified listener failed', e);
    }
  }
}

// ---- Sessions (the cookie has one writer: this module) ----

const SESSION_END = 'auth:session-end';

/**
 * Called with the opaque session key (see sessionKeyFromCookieHeader) whenever a session ends —
 * logout, revoked from another device, password reset, account deletion — on EVERY instance, so
 * long-lived connections opened with it (board sockets) close too.
 */
export function onSessionEnd(fn: (sessionKey: string) => void): () => void {
  return subscribe(SESSION_END, fn);
}

export function sessionsEnded(keys: string[]): void {
  for (const key of keys) {
    lastSeen.delete(key);
    publish(SESSION_END, key);
  }
}

export async function startSession(req: Request, res: Response, userId: string): Promise<void> {
  const token = newToken();
  const now = Date.now();
  await repo.insertSession({
    id: newId(20),
    tokenHash: hashToken(token),
    userId,
    now,
    expiresAt: now + SESSION_TTL_MS,
    userAgent: (req.get('user-agent') ?? '').slice(0, 400),
    ip: clientIp(req).slice(0, 64),
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
    secure: getConfig().production && req.secure,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const key = sessionKeyFromCookieHeader(req.headers.cookie);
  if (key) {
    await repo.deleteSession(key);
    sessionsEnded([key]);
  }
  clearSessionCookie(res);
}

/** Ends every session of the user except `keepKey`; returns how many ended. */
export async function endSessionsOf(userId: string, keepKey: string | null = null): Promise<number> {
  const keys = await repo.deleteSessionsOf(userId, keepKey);
  sessionsEnded(keys);
  return keys.length;
}

/** Opaque, stable key of the session a request/upgrade carries (never the raw token), or null. */
export function sessionKeyFromCookieHeader(cookieHeader: string | undefined): string | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  return token ? hashToken(token) : null;
}

const lastSeen = new Map<string, number>();

/** The session's account (even while deletion is scheduled), or null. Records "last seen". */
export async function sessionFromCookieHeader(
  cookieHeader: string | undefined,
): Promise<{ user: Account; key: string; sessionId: string } | null> {
  const key = sessionKeyFromCookieHeader(cookieHeader);
  if (!key) return null;
  const now = Date.now();
  const found = await repo.findSessionUser(key, now);
  if (!found) return null;
  if (now - (lastSeen.get(key) ?? 0) > LAST_SEEN_RESOLUTION_MS) {
    if (lastSeen.size > 50_000) lastSeen.clear();
    lastSeen.set(key, now);
    repo.touchSession(key, now).catch((e) => logError('auth: could not record session activity', e));
  }
  return { user: toAccount(found.user), key, sessionId: found.sessionId };
}

/** The signed-in user of a cookie, or null — also null while the account awaits deletion. */
export async function userFromCookieHeader(cookieHeader: string | undefined): Promise<User | null> {
  const s = await sessionFromCookieHeader(cookieHeader);
  return s && s.user.deletionScheduledFor === null ? publicUser(s.user) : null;
}

const requestSessions = new WeakMap<Request, { user: Account; key: string; sessionId: string }>();

function sessionMiddleware(allowPendingDeletion: boolean): RequestHandler {
  return (req, res, next) => {
    sessionFromCookieHeader(req.headers.cookie).then((s) => {
      if (!s) {
        res.status(401).json({ error: 'Not logged in' });
        return;
      }
      if (!allowPendingDeletion && s.user.deletionScheduledFor !== null) {
        res.status(403).json({ error: 'Your account is scheduled for deletion. Restore it to keep using Freero.', code: ACCOUNT_PENDING_DELETION });
        return;
      }
      requestSessions.set(req, s);
      setRequestUser(req, s.user.id); // request logs + per-user rate limits
      next();
    }, next);
  };
}

/** Express middleware: 401 unless the request carries a valid session (403 while deletion is scheduled). */
export const requireUser: RequestHandler = sessionMiddleware(false);

/** Like requireUser, but also lets an account in its deletion grace period through (restore, sessions). */
export const requireSession: RequestHandler = sessionMiddleware(true);

/** The user authenticated by requireUser / requireSession. */
export function currentUser(req: Request): Account {
  const s = requestSessions.get(req);
  if (!s) throw unauthorized();
  return s.user;
}

/** The session key of the request authenticated by requireUser / requireSession. */
export function currentSessionKey(req: Request): string {
  const s = requestSessions.get(req);
  if (!s) throw unauthorized();
  return s.key;
}

export function currentSessionId(req: Request): string {
  const s = requestSessions.get(req);
  if (!s) throw unauthorized();
  return s.sessionId;
}

export async function getUser(id: string): Promise<User | null> {
  const u = await repo.findUserById(id);
  return u ? publicUser(u) : null;
}

/** id -> user for every id that exists (one query). */
export async function getUsers(ids: Iterable<string>): Promise<Map<string, User>> {
  const users = await repo.findUsersByIds([...new Set(ids)]);
  return new Map(users.map((u) => [u.id, publicUser(u)]));
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const u = await repo.findUserByEmail(normalizeEmail(email));
  return u ? publicUser(u) : null;
}
