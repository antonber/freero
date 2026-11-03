// Boards embedded live on other sites (#2; docs/integrations/embedding.md). Any site may frame
// /embed/b/:id while the board's owner allows embedding and its workspace's `boardEmbeds` policy is
// on (boards' `boardEmbedding`). What the frame shows follows the board's sharing exactly:
//
// - VISITORS (no account): the board read-only, only when its link would let a visitor without an
//   account in as a guest (no password). No identity, no presence, no private layer; at most
//   `EMBED_MAX_VISITORS_PER_BOARD` at a time per instance (#60).
// - MEMBERS: someone signs in through the first-party popup /embed/connect/:id, which mints a token
//   for THIS board and hands it to the frame (postMessage to Freero's own origin). The token acts
//   for the session that minted it — the socket carries that session's key, so signing out,
//   session policies and the live-session re-check close it like any board socket — with the
//   person's own role, capped at viewer for a read-only embed.
//
// Every socket re-checks on each access refresh that embedding is still allowed (realtime
// Admission.resolveRole): the owner turning it off, the policy turning off or the link closing
// disconnects the embeds at once, on every instance.
import { createHash, randomBytes } from 'node:crypto';
import { EMBED_NO_ACCESS, type Role } from '@freero/shared';
import { HttpError, notFound } from '../../platform/http';
import { userFromSessionKey } from '../auth/index';
import { boardEmbedding, getBoardAccess } from '../boards/index';
import * as repo from './repo';

export const MEMBER_TOKEN_PREFIX = 'frm_';
/** A member's embed token lasts this long at most (its session ending ends it sooner). */
export const MEMBER_TOKEN_MS = 7 * 24 * 60 * 60_000;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** What a visitor without an account may do on this board's embeds now: 'viewer', or null. */
export async function visitorRole(boardId: string): Promise<'viewer' | null> {
  return (await boardEmbedding(boardId))?.visitor ?? null;
}

/** A token for this board's embeds acting for the session `sessionKey` of `userId`, who must be able to open it. */
export async function mintMemberToken(boardId: string, userId: string, sessionKey: string, readonly: boolean): Promise<{ token: string; expiresAt: number }> {
  if (!(await boardEmbedding(boardId))) throw notFound('This board can’t be embedded');
  const { role } = await getBoardAccess(boardId, userId);
  if (!role) throw new HttpError(403, 'You don’t have access to this board', EMBED_NO_ACCESS);
  const token = MEMBER_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + MEMBER_TOKEN_MS;
  await repo.insertMemberToken(hash(token), { userId, sessionKey, boardId, maxRole: readonly ? 'viewer' : 'owner', expiresAt }, now);
  return { token, expiresAt };
}

/** Who a member token acts for, checked afresh (its session still live), or null. */
export async function memberOf(token: string): Promise<{ user: NonNullable<Awaited<ReturnType<typeof userFromSessionKey>>>; boardId: string; sessionKey: string; maxRole?: Role; expiresAt: number } | null> {
  if (typeof token !== 'string' || !token.startsWith(MEMBER_TOKEN_PREFIX) || token.length > 200) return null;
  const row = await repo.memberToken(hash(token), Date.now());
  if (!row) return null;
  const user = await userFromSessionKey(row.sessionKey);
  if (!user || user.id !== row.userId) return null;
  return { user, boardId: row.boardId, sessionKey: row.sessionKey, maxRole: row.maxRole === 'viewer' ? 'viewer' : undefined, expiresAt: row.expiresAt };
}

/** The member's own role on the board's embeds now (embedding still allowed), or null. */
export async function memberRole(boardId: string, userId: string): Promise<Role | null> {
  if (!(await boardEmbedding(boardId))) return null;
  return (await getBoardAccess(boardId, userId)).role;
}

export async function purgeExpiredMemberTokens(now = Date.now()): Promise<number> {
  return repo.deleteExpiredMemberTokens(now);
}
