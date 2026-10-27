import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { SESSION_COOKIE, type User } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, parseCookies, unauthorized } from '../../platform/http';
import { newId } from '../../platform/ids';
import { randomCursorColor } from './colors';
import { dummyHash, hashPassword, verifyPassword } from './password';
import * as repo from './repo';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function publicUser(u: User): User {
  return { id: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, createdAt: u.createdAt };
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export async function createUser(input: { name: unknown; email: unknown; password: unknown }): Promise<User> {
  const email = normalizeEmail(input.email);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest('Please enter a valid email address');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');
  if (password.length > 512) throw badRequest('Password is too long');
  if (!name) throw badRequest('Please enter your name');
  if (name.length > 80) throw badRequest('Name is too long (max 80 characters)');
  if (repo.findUserByEmail(email)) throw new HttpError(409, 'An account with that email already exists');
  const user: repo.UserWithHash = {
    id: newId(),
    email,
    name,
    color: randomCursorColor(),
    avatarUrl: null,
    createdAt: Date.now(),
    passwordHash: await hashPassword(password),
  };
  try {
    repo.insertUser(user);
  } catch (e) {
    // Lost a race against a concurrent signup with the same email.
    if (repo.findUserByEmail(email)) throw new HttpError(409, 'An account with that email already exists');
    throw e;
  }
  return publicUser(user);
}

export async function checkCredentials(emailIn: unknown, passwordIn: unknown): Promise<User> {
  const email = normalizeEmail(emailIn);
  const password = typeof passwordIn === 'string' ? passwordIn : '';
  const user = email ? repo.findUserByEmail(email) : null;
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  return publicUser(user);
}

export function updateProfile(userId: string, body: Record<string, unknown>): User {
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
  repo.updateUserProfile(userId, patch);
  const u = repo.findUserById(userId);
  if (!u) throw unauthorized();
  return publicUser(u);
}

// ---- Sessions (the cookie has one writer: this module) ----

export function startSession(req: Request, res: Response, userId: string): void {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  repo.insertSession(hashToken(token), userId, now, now + SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
    secure: getConfig().production && req.secure,
  });
}

export function endSession(req: Request, res: Response): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) repo.deleteSession(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export function userFromCookieHeader(cookieHeader: string | undefined): User | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const u = repo.findSessionUser(hashToken(token), Date.now());
  return u ? publicUser(u) : null;
}

const requestUsers = new WeakMap<Request, User>();

/** Express middleware: 401 unless the request carries a valid session cookie. */
export const requireUser: RequestHandler = (req, res, next) => {
  const user = userFromCookieHeader(req.headers.cookie);
  if (!user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  requestUsers.set(req, user);
  next();
};

/** The user authenticated by requireUser. */
export function currentUser(req: Request): User {
  const u = requestUsers.get(req);
  if (!u) throw unauthorized();
  return u;
}

export function getUser(id: string): User | null {
  const u = repo.findUserById(id);
  return u ? publicUser(u) : null;
}

export function findUserByEmail(email: string): User | null {
  const u = repo.findUserByEmail(normalizeEmail(email));
  return u ? publicUser(u) : null;
}
