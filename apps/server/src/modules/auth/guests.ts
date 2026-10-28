// Guests: visitors without an account on a board's shared link. A guest session is one board, one
// name, a few hours: the cookie `freero_guest` (HttpOnly; only its sha256 is stored) identifies
// a guest id ('guest_…') that never collides with an account id and opens nothing but that board.
// WHETHER a board lets guests in, and as what, is decided by modules/boards (link + workspace
// policy, members/roles.ts resolveGuestRole); this module only keeps who they are.
import type { Request, RequestHandler, Response } from 'express';
import { GUEST_ID_PREFIX, GUEST_SESSION_HOURS, MAX_GUEST_NAME, type Account, type GuestInfo } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, parseCookies, unauthorized } from '../../platform/http';
import { newId } from '../../platform/ids';
import { clientIp } from '../../platform/rateLimit';
import { setRequestUser } from '../../platform/requestContext';
import { randomCursorColor } from './colors';
import * as repo from './repo';
import { hashToken, newToken, sessionFromCookieHeader, sessionsEnded } from './service';

export const GUEST_COOKIE = 'freero_guest';
export const GUEST_TTL_MS = GUEST_SESSION_HOURS * 60 * 60 * 1000;

const toInfo = (g: repo.GuestRow): GuestInfo => ({ id: g.id, name: g.name, color: g.color, boardId: g.boardId, expiresAt: g.expiresAt });

/** A guest name as typed: trimmed, single-spaced, without control characters, never empty. */
export function cleanGuestName(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('name is required');
  // Control and format characters (bidi overrides, zero-width) would let a name pose as another.
  const t = v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_GUEST_NAME);
  if (!t) throw badRequest('Enter a name so others know who you are');
  return t;
}

/**
 * Starts a guest session for one board (the caller has checked the board lets guests in) and sets
 * its cookie. Null when the board was deleted meanwhile.
 */
export async function startGuestSession(req: Request, res: Response, boardId: string, name: string): Promise<GuestInfo | null> {
  const token = newToken();
  const now = Date.now();
  const guest: repo.GuestRow = {
    id: GUEST_ID_PREFIX + newId(16),
    boardId,
    name: cleanGuestName(name),
    color: randomCursorColor(),
    createdAt: now,
    expiresAt: now + GUEST_TTL_MS,
  };
  if (!(await repo.insertGuest({ ...guest, tokenHash: hashToken(token), ip: clientIp(req).slice(0, 64) }))) return null;
  res.cookie(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: GUEST_TTL_MS,
    secure: getConfig().production && req.secure,
  });
  return toInfo(guest);
}

/** Opaque key of the guest session a request/upgrade carries (its token's sha256), or null. */
export function guestKeyFromCookieHeader(cookieHeader: string | undefined): string | null {
  const token = parseCookies(cookieHeader)[GUEST_COOKIE];
  return token ? hashToken(token) : null;
}

/** The live guest behind a cookie header, or null. */
export async function guestFromCookieHeader(cookieHeader: string | undefined): Promise<GuestInfo | null> {
  const key = guestKeyFromCookieHeader(cookieHeader);
  if (!key) return null;
  const g = await repo.findGuestByToken(key, Date.now());
  return g ? toInfo(g) : null;
}

/** Live guests by id (expired or unknown ids are left out). */
export async function getGuests(ids: Iterable<string>): Promise<Map<string, GuestInfo>> {
  const list = [...new Set(ids)].filter((id) => id.startsWith(GUEST_ID_PREFIX));
  return new Map((await repo.findGuests(list, Date.now())).map((g) => [g.id, toInfo(g)]));
}

/** Ends the request's guest session (its sockets close everywhere) and clears the cookie. */
export async function endGuestSession(req: Request, res: Response): Promise<void> {
  const key = guestKeyFromCookieHeader(req.headers.cookie);
  if (key && (await repo.deleteGuestByToken(key))) sessionsEnded([key]);
  res.clearCookie(GUEST_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

/** Deletes expired guest sessions and closes their sockets on every instance. Returns how many. */
export async function purgeExpiredGuests(now = Date.now()): Promise<number> {
  const keys = await repo.deleteExpiredGuests(now);
  sessionsEnded(keys);
  return keys.length;
}

/** Who is asking: an account (signed in) or a guest. Accounts win when a browser has both. */
export type Actor = { kind: 'user'; user: Account } | { kind: 'guest'; guest: GuestInfo };

const actors = new WeakMap<Request, Actor>();

/**
 * Express middleware for the few routes guests may use (their board's summary and people
 * lookup): a signed-in account (not pending deletion), else a live guest; 401 otherwise.
 */
export const requireUserOrGuest: RequestHandler = (req, res, next) => {
  void (async () => {
    const s = await sessionFromCookieHeader(req.headers.cookie);
    if (s && s.user.deletionScheduledFor === null) {
      setRequestUser(req, s.user.id);
      actors.set(req, { kind: 'user', user: s.user });
      return next();
    }
    const guest = await guestFromCookieHeader(req.headers.cookie);
    if (!guest) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    setRequestUser(req, guest.id);
    actors.set(req, { kind: 'guest', guest });
    next();
  })().catch(next);
};

/** The actor authenticated by requireUserOrGuest. */
export function currentActor(req: Request): Actor {
  const a = actors.get(req);
  if (!a) throw unauthorized();
  return a;
}

/** The id the actor acts under (an account id or a guest id). */
export const actorId = (a: Actor): string => (a.kind === 'user' ? a.user.id : a.guest.id);
