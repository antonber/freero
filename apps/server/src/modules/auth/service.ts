import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { ACCOUNT_PENDING_DELETION, REAUTH_REQUIRED, SESSION_COOKIE, type Account, type AuditAction, type User } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, parseCookies, unauthorized } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { clientIp } from '../../platform/rateLimit';
import { setRequestUser } from '../../platform/requestContext';
import { recordAuditQuietly, type AuditInput } from '../audit/index';
import { randomCursorColor } from './colors';
import { maskIp } from './geoip';
import { dummyHash, hashPassword, verifyPassword } from './password';
import * as repo from './repo';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often per session (per instance). */
const LAST_SEEN_RESOLUTION_MS = 60_000;
/**
 * How long after signing in (or re-confirming with its provider) a session of a passwordless
 * account may make sensitive changes (set a password, two-factor, email, deletion).
 */
export const RECENT_AUTH_MS = 10 * 60_000;
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
  return insertAccount({ name, email, passwordHash: await hashPassword(password), emailVerified: opts.emailVerified ?? false });
}

/**
 * Inserts a new account (signup, or a first sign-in with a provider: no password). Every new
 * account goes through here. Throws 409 if the address is taken (the unique index decides races).
 */
export async function insertAccount(
  input: { name: string; email: string; passwordHash: string | null; emailVerified: boolean },
  identity?: { provider: string; issuer: string; subject: string; email: string | null; emailVerified: boolean },
): Promise<Account> {
  const user: repo.UserWithHash = {
    id: newId(),
    email: input.email,
    name: input.name,
    color: randomCursorColor(),
    avatarUrl: null,
    createdAt: Date.now(),
    emailVerified: input.emailVerified,
    deletionScheduledFor: null,
    passwordHash: input.passwordHash,
    passwordViaLink: false,
  };
  try {
    await repo.insertUser(user, identity && { ...identity, id: newId() });
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
  // Accounts without a password (provider sign-in only) still cost one hash: uniform timing.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !user.passwordHash || !ok) {
    // Attempts on an existing account are audited (its owner's workspaces see them); guesses at
    // addresses without an account are only rate limited.
    if (user) await recordAuditQuietly({ action: 'auth.login_failed', accountId: user.id, actorId: null, target: { type: 'user', id: user.id, label: user.email }, metadata: { reason: 'password' } });
    throw unauthorized('Incorrect email or password');
  }
  return toAccount(user);
}

/**
 * Re-checks who is asking before a sensitive change (403, not 401: they stay signed in): the
 * password, or — for an account without one — that this session signed in or re-confirmed with
 * its provider within RECENT_AUTH_MS (`sessionAuthAt`, see currentSessionAuthAt).
 */
export async function confirmPassword(userId: string, password: unknown, sessionAuthAt?: number): Promise<repo.UserWithHash> {
  const user = await repo.findUserById(userId);
  if (!user) throw unauthorized();
  if (user.passwordHash === null) {
    if (sessionAuthAt === undefined || Date.now() - sessionAuthAt > RECENT_AUTH_MS)
      throw new HttpError(403, 'Please confirm it’s you by signing in again', REAUTH_REQUIRED);
    return user;
  }
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

const sessionEndListeners = new Set<(sessionKey: string) => void>();

/**
 * Called on the instance that ended a session — logout, signed out from another device, password
 * reset or change, account deletion — with its opaque key (see sessionKeyFromCookieHeader).
 * Realtime listens here and closes that session's board sockets on every instance (its
 * 'end-session' control message): the one way to drop a session's live connections.
 */
export function onSessionEnd(fn: (sessionKey: string) => void): () => void {
  sessionEndListeners.add(fn);
  return () => sessionEndListeners.delete(fn);
}

export function sessionsEnded(keys: string[]): void {
  for (const key of keys) {
    lastSeen.delete(key);
    for (const fn of sessionEndListeners) {
      try {
        fn(key);
      } catch (e) {
        logError('auth: a session-end listener failed', e);
      }
    }
  }
}

/**
 * Signs the browser in. `method`: 'password', 'email_link' or a provider id; `twoFactor`: it passed
 * the second step. Sign-ins of accounts with two-factor go through signIn.ts (completeSignIn).
 * `knownDevice`: this browser had signed in to the account before (see rememberDevice).
 */
export async function startSession(
  req: Request,
  res: Response,
  userId: string,
  how: { method?: string; twoFactor?: boolean } = {},
): Promise<{ knownDevice: boolean }> {
  const token = newToken();
  const now = Date.now();
  const knownDevice = await rememberDevice(req, res, userId, now); // before this session exists
  await repo.insertSession({
    id: newId(20),
    tokenHash: hashToken(token),
    userId,
    now,
    expiresAt: now + SESSION_TTL_MS,
    userAgent: (req.get('user-agent') ?? '').slice(0, 400),
    ip: clientIp(req).slice(0, 64),
    method: how.method ?? 'password',
    twoFactor: how.twoFactor ?? false,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
    secure: getConfig().production && req.secure,
  });
  return { knownDevice };
}

// ---- Devices: which browsers have signed in to an account (new sign-in notices) ----

/** A random id per browser (not per account or session), kept across sign-outs. */
const DEVICE_COOKIE = 'freero_device';
/** Browsers cap cookie lifetimes at 400 days; device records unseen for longer are pruned. */
export const DEVICE_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{43}$/; // newToken()

/**
 * Records that this browser signed in to the account and says whether it is RECOGNISED: it brings
 * a device cookie it already signed in to this account with. An account with no browser on record
 * (created before device records existed, or no sign-in for 400 days) recognises a browser that
 * matches one of its live sessions in User-Agent and network instead, so nobody gets a notice
 * for the first sign-in after an upgrade from a browser they already use.
 */
async function rememberDevice(req: Request, res: Response, userId: string, now: number): Promise<boolean> {
  const sent = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
  const device = sent && DEVICE_ID_RE.test(sent) ? sent : newToken();
  res.cookie(DEVICE_COOKIE, device, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_TTL_MS,
    secure: getConfig().production && req.secure,
  });
  const { known, devicesBefore } = await repo.rememberDevice(userId, hashToken(device), now);
  if (known) return true;
  if (devicesBefore > 0) return false;
  const userAgent = (req.get('user-agent') ?? '').slice(0, 400);
  const network = maskIp(clientIp(req));
  return (await repo.listSessions(userId, now)).some((s) => s.userAgent === userAgent && maskIp(s.ip) === network);
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const key = sessionKeyFromCookieHeader(req.headers.cookie);
  if (key) {
    const userId = await repo.deleteSessionReturningUser(key);
    sessionsEnded([key]);
    if (userId) await recordAuditQuietly({ action: 'auth.logout', accountId: userId, actorId: userId });
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

/** Records activity of a session (at most once per LAST_SEEN_RESOLUTION_MS per instance). */
function touch(key: string, now: number): void {
  if (now - (lastSeen.get(key) ?? 0) <= LAST_SEEN_RESOLUTION_MS) return;
  if (lastSeen.size > 50_000) lastSeen.clear();
  lastSeen.set(key, now);
  repo.touchSession(key, now).catch((e) => logError('auth: could not record session activity', e));
}

/**
 * Activity that doesn't go through a REST request (editing a board over its socket) keeps the
 * session from idling out. Cheap: a map lookup, and a write at most once a minute.
 */
export function noteSessionActivity(sessionKey: string): void {
  touch(sessionKey, Date.now());
}

/**
 * Audits a change someone made to their own account (password, two-step, providers…): it lands in
 * their account's log and their team workspaces'. Recorded after the change; never fails it.
 */
export function auditOwnAccount(action: AuditAction, userId: string, metadata?: AuditInput['metadata']): Promise<void> {
  return recordAuditQuietly({ action, accountId: userId, actorId: userId, metadata });
}

// ---- Session policies (workspace session lifetime / idle timeout, KAI-51) ----

/** Limits on a person's sessions (null: none). */
export interface SessionLimits {
  maxHours: number | null;
  idleMinutes: number | null;
}
type SessionLimitsFor = (userId: string) => Promise<SessionLimits> | SessionLimits;
let sessionLimitsFor: SessionLimitsFor = () => ({ maxHours: null, idleMinutes: null });
const limitsCache = new Map<string, { at: number; limits: SessionLimits }>();
/** A changed policy reaches requests within this long (the enforcement job ends sessions on time anyway). */
const LIMITS_CACHE_MS = 30_000;

/**
 * Where the session limits of a person come from (auth/init.ts sets it from modules/workspaces:
 * the strictest limits of the team workspaces they are a member of). A session belongs to the
 * person, not to a workspace, so one limit applies to all of their sessions.
 */
export function setSessionLimits(fn: SessionLimitsFor): void {
  sessionLimitsFor = fn;
  limitsCache.clear();
}

async function limitsOf(userId: string, now: number): Promise<SessionLimits> {
  const hit = limitsCache.get(userId);
  if (hit && now - hit.at < LIMITS_CACHE_MS) return hit.limits;
  const limits = await sessionLimitsFor(userId);
  if (limitsCache.size > 50_000) limitsCache.clear();
  limitsCache.set(userId, { at: now, limits });
  return limits;
}

/** Why a session is over under these limits, or null. */
export function sessionLimitReached(
  s: { createdAt: number; lastSeenAt: number },
  limits: SessionLimits,
  now: number,
): 'max_age' | 'idle' | null {
  if (limits.maxHours !== null && now - s.createdAt >= limits.maxHours * 3_600_000) return 'max_age';
  if (limits.idleMinutes !== null && now - s.lastSeenAt >= limits.idleMinutes * 60_000) return 'idle';
  return null;
}

/**
 * The enforcement job: ends every session of these people that their limits end (on every
 * instance: their sockets close too). Idempotent. Returns how many sessions it ended.
 */
export async function endSessionsBeyondLimits(people: Array<{ userId: string } & SessionLimits>, now = Date.now()): Promise<number> {
  let ended = 0;
  for (const p of people) {
    const keys = await repo.deleteSessionsBeyond(
      p.userId,
      p.maxHours === null ? null : now - p.maxHours * 3_600_000,
      p.idleMinutes === null ? null : now - p.idleMinutes * 60_000,
    );
    if (!keys.length) continue;
    ended += keys.length;
    sessionsEnded(keys);
    await recordAuditQuietly({ action: 'auth.session_expired', accountId: p.userId, actorId: null, target: { type: 'user', id: p.userId }, metadata: { sessions: keys.length } });
  }
  return ended;
}

/** The session's account (even while deletion is scheduled), or null. Records "last seen". */
export async function sessionFromCookieHeader(
  cookieHeader: string | undefined,
): Promise<{ user: Account; key: string; sessionId: string; authAt: number } | null> {
  const key = sessionKeyFromCookieHeader(cookieHeader);
  if (!key) return null;
  const now = Date.now();
  const found = await repo.findSessionUser(key, now);
  if (!found) return null;
  // A workspace's session policy: the session ends here and now (forced re-login).
  const reason = sessionLimitReached(found, await limitsOf(found.user.id, now), now);
  if (reason) {
    await repo.deleteSession(key);
    sessionsEnded([key]);
    await recordAuditQuietly({ action: 'auth.session_expired', accountId: found.user.id, actorId: null, target: { type: 'user', id: found.user.id, label: found.user.email }, metadata: { reason } });
    return null;
  }
  touch(key, now);
  return { user: toAccount(found.user), key, sessionId: found.sessionId, authAt: found.authAt };
}

/** The signed-in user of a cookie, or null — also null while the account awaits deletion. */
export async function userFromCookieHeader(cookieHeader: string | undefined): Promise<User | null> {
  const s = await sessionFromCookieHeader(cookieHeader);
  return s && s.user.deletionScheduledFor === null ? publicUser(s.user) : null;
}

const requestSessions = new WeakMap<Request, { user: Account; key: string; sessionId: string; authAt: number }>();

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

/** When the request's session last proved who it is (for confirmPassword on passwordless accounts). */
export function currentSessionAuthAt(req: Request): number {
  const s = requestSessions.get(req);
  if (!s) throw unauthorized();
  return s.authAt;
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
