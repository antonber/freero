// Share-link password and expiry (KAI-145). The board's owner may protect its link:
//   - a password: the link then grants its role only to people (accounts, or guests joining)
//     who gave the CURRENT password. Who did is a row in board_link_unlocks bound to the
//     password's revision, so setting a new password cancels every earlier unlock at once, and
//     the rule is applied wherever access is resolved (REST, lists, socket admission, live access
//     refreshes) by service.ts `linkAsSeenBy` — never a cookie a reconnect could miss.
//   - an expiry: after it the link grants nothing (repo.toBoard reads it as 'none' for everyone);
//     a job re-checks the live sockets of links that just expired, so link-only visitors are
//     disconnected. Memberships, team access and ownership never depend on the link.
// Brute force: the password is stored with the account passwords' scrypt hash (slow), attempts
// are rate limited per IP and per board + person, and refusals are audited.
import type { Request } from 'express';
import { isGuestId, LINK_PASSWORD_MAX, LINK_PASSWORD_MIN } from '@freero/shared';
import { badRequest, forbidden, HttpError } from '../../platform/http';
import { clientIp, consumeRateLimit } from '../../platform/rateLimit';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { hashPassword, verifyPassword } from '../auth/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { Board } from './repo';
import { boardTarget } from './service';

/** What PATCH /boards/:id may change about the link's protection (owner only; checked by the caller). */
export interface LinkProtectionPatch {
  linkPassword?: unknown;
  linkExpiresAt?: unknown;
}

export const hasLinkProtectionPatch = (body: LinkProtectionPatch): boolean => body.linkPassword !== undefined || body.linkExpiresAt !== undefined;

/** Validates and applies the owner's change, audits it and drops live link-only access it ends. */
export async function changeLinkProtection(board: Board, actorId: string, body: LinkProtectionPatch, now = Date.now()): Promise<void> {
  const patch: { passwordHash?: string | null; expiresAt?: number | null } = {};
  if (body.linkPassword !== undefined) {
    if (body.linkPassword === null) patch.passwordHash = null;
    else {
      if (typeof body.linkPassword !== 'string') throw badRequest('linkPassword must be text or null');
      if (body.linkPassword.length < LINK_PASSWORD_MIN || body.linkPassword.length > LINK_PASSWORD_MAX)
        throw badRequest(`The link password needs ${LINK_PASSWORD_MIN} to ${LINK_PASSWORD_MAX} characters`);
      patch.passwordHash = await hashPassword(body.linkPassword);
    }
  }
  if (body.linkExpiresAt !== undefined) {
    if (body.linkExpiresAt === null) patch.expiresAt = null;
    else {
      const at = body.linkExpiresAt;
      if (typeof at !== 'number' || !Number.isFinite(at)) throw badRequest('linkExpiresAt must be a time (ms) or null');
      if (at <= now) throw badRequest('Pick an expiry in the future');
      patch.expiresAt = Math.round(at);
    }
  }
  if (patch.passwordHash === undefined && patch.expiresAt === undefined) return;
  // Removing a password that isn't there (or an expiry) changes nothing worth recording.
  const passwordChange = patch.passwordHash !== undefined && !(patch.passwordHash === null && board.linkPasswordHash === null);
  const expiryChange = patch.expiresAt !== undefined && patch.expiresAt !== board.linkExpiresAt;
  if (!passwordChange && !expiryChange) return;
  await repo.transaction(async () => {
    await repo.setLinkProtection(board.id, {
      ...(passwordChange ? { passwordHash: patch.passwordHash } : {}),
      ...(expiryChange ? { expiresAt: patch.expiresAt } : {}),
    });
    // Never the password, nor its hash.
    await recordAudit({
      action: 'board.link_protection_changed',
      workspaceId: board.workspaceId,
      actorId,
      target: boardTarget(board),
      metadata: {
        ...(passwordChange ? { password: patch.passwordHash === null ? 'removed' : board.linkPasswordHash ? 'changed' : 'set' } : {}),
        ...(expiryChange ? { expiresAt: patch.expiresAt ? new Date(patch.expiresAt).toISOString() : null } : {}),
      },
    });
  });
  // A new password (or an earlier expiry) can end the access of people connected through the link.
  await refreshBoardAccess(board.id);
}

/**
 * Checks a password given for the board's link by `principalId` (an account or a guest id) and
 * remembers it for the current password. Throws 429 when attempts run out, 403 when it is wrong.
 */
export async function unlockLink(req: Request, board: Board, principalId: string, password: unknown, now = Date.now()): Promise<void> {
  await consumeRateLimit('linkPassword', `ip:${clientIp(req)}`);
  await consumeRateLimit('linkPassword', `board:${board.id}:${principalId}`);
  if (!(await passwordMatches(board, password))) {
    await recordAuditQuietly({
      action: 'board.link_password_refused',
      workspaceId: board.workspaceId,
      actorId: isGuestId(principalId) ? null : principalId,
      target: boardTarget(board),
      metadata: isGuestId(principalId) ? { guestId: principalId } : {},
    });
    throw new HttpError(403, 'That password isn’t right', 'link_password_wrong');
  }
  await repo.recordUnlock(board.id, principalId, board.linkPasswordRev, now);
}

/** A visitor's password before they become a guest (no principal yet): rate limited per IP and board. */
export async function checkVisitorPassword(req: Request, board: Board, password: unknown): Promise<void> {
  await consumeRateLimit('linkPassword', `ip:${clientIp(req)}`);
  await consumeRateLimit('linkPassword', `board:${board.id}:ip:${clientIp(req)}`);
  if (await passwordMatches(board, password)) return;
  await recordAuditQuietly({ action: 'board.link_password_refused', workspaceId: board.workspaceId, actorId: null, target: boardTarget(board), metadata: { visitor: true } });
  throw new HttpError(403, password ? 'That password isn’t right' : 'This link asks for a password', password ? 'link_password_wrong' : 'link_password_required');
}

async function passwordMatches(board: Board, password: unknown): Promise<boolean> {
  if (!board.linkPasswordHash) throw forbidden('This board’s link has no password');
  if (typeof password !== 'string' || !password || password.length > LINK_PASSWORD_MAX) return false;
  return verifyPassword(password, board.linkPasswordHash);
}

/** Re-checks the live sockets of links that expired since the last run (the expiry job, every instance, one at a time). */
export async function applyExpiredLinks(now = Date.now()): Promise<number> {
  const ids = await repo.expiredLinksToApply(now, 200);
  for (const id of ids) {
    await refreshBoardAccess(id);
    await repo.markExpiryApplied(id, now);
  }
  return ids.length;
}
