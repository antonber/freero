// The only writer of `board_members`, `board_invites` and `board_access_requests` [S4].
import { isForeignKeyViolation, one, query, tx } from '../../platform/db';
import type { MemberRole } from './roles';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export interface MemberRow {
  boardId: string;
  userId: string;
  role: MemberRole;
  createdAt: number;
}

interface Row {
  board_id: string;
  user_id: string;
  role: MemberRole;
  created_at: Date;
}

const toRow = (r: Row): MemberRow => ({ boardId: r.board_id, userId: r.user_id, role: r.role, createdAt: r.created_at.getTime() });

export async function getMembership(boardId: string, userId: string): Promise<MemberRow | null> {
  const r = await one<Row>(`SELECT * FROM board_members WHERE board_id = $1 AND user_id = $2`, [boardId, userId]);
  return r ? toRow(r) : null;
}

export async function listByBoard(boardId: string): Promise<MemberRow[]> {
  return (await query<Row>(`SELECT * FROM board_members WHERE board_id = $1 ORDER BY created_at`, [boardId])).map(toRow);
}

export async function listByUser(userId: string): Promise<MemberRow[]> {
  return (await query<Row>(`SELECT * FROM board_members WHERE user_id = $1`, [userId])).map(toRow);
}

/** Adds (or re-roles) a member. Returns false if the board (or user) no longer exists. */
export async function upsertMember(boardId: string, userId: string, role: MemberRole, now: number): Promise<boolean> {
  try {
    await query(
      `INSERT INTO board_members (board_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role`,
      [boardId, userId, role, new Date(now)],
    );
    return true;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false; // deleted concurrently
    throw e;
  }
}

/** Returns false if there was no such membership. */
export async function setRole(boardId: string, userId: string, role: MemberRole): Promise<boolean> {
  const rows = await query(`UPDATE board_members SET role = $3 WHERE board_id = $1 AND user_id = $2 RETURNING 1`, [boardId, userId, role]);
  return rows.length > 0;
}

/** Returns false if there was no such membership. */
export async function removeMember(boardId: string, userId: string): Promise<boolean> {
  const rows = await query(`DELETE FROM board_members WHERE board_id = $1 AND user_id = $2 RETURNING 1`, [boardId, userId]);
  return rows.length > 0;
}

export async function removeMemberships(boardIds: string[], userId: string): Promise<void> {
  if (boardIds.length === 0) return;
  await query(`DELETE FROM board_members WHERE board_id = ANY($1::text[]) AND user_id = $2`, [boardIds, userId]);
}

/**
 * Adds a member only if they are not one yet (never changes an existing role). Returns the role
 * they now have, or null if the board (or user) no longer exists.
 */
export async function addMemberIfAbsent(boardId: string, userId: string, role: MemberRole, now: number): Promise<MemberRole | null> {
  try {
    await query(
      `INSERT INTO board_members (board_id, user_id, role, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [boardId, userId, role, new Date(now)],
    );
  } catch (e) {
    if (isForeignKeyViolation(e)) return null;
    throw e;
  }
  return (await getMembership(boardId, userId))?.role ?? null;
}

/**
 * Grants `role` through an invite: adds the member, or raises an existing member's role — an
 * invite never lowers access someone already has. Returns false if the board (or user) is gone.
 */
export async function grantAtLeast(boardId: string, userId: string, role: MemberRole, now: number): Promise<boolean> {
  try {
    await query(
      `INSERT INTO board_members (board_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role
         WHERE (CASE board_members.role WHEN 'viewer' THEN 1 WHEN 'commenter' THEN 2 ELSE 3 END)
             < (CASE excluded.role WHEN 'viewer' THEN 1 WHEN 'commenter' THEN 2 ELSE 3 END)`,
      [boardId, userId, role, new Date(now)],
    );
    return true;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

// ---- pending invites (board_invites) ----

export interface InviteRow {
  id: string;
  boardId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

interface InviteDbRow {
  id: string;
  board_id: string;
  email: string;
  role: MemberRole;
  invited_by: string;
  created_at: Date;
  expires_at: Date;
}

const toInvite = (r: InviteDbRow): InviteRow => ({
  id: r.id,
  boardId: r.board_id,
  email: r.email,
  role: r.role,
  invitedBy: r.invited_by,
  createdAt: r.created_at.getTime(),
  expiresAt: r.expires_at.getTime(),
});

/** Result of saveInvite: the invite as stored, 'role-conflict' or 'board-gone'. */
export type SaveInviteResult = InviteRow | 'role-conflict' | 'board-gone';

/**
 * Creates the pending invite for (board, email), or renews an existing one with a new token and
 * expiry (the old link stops working). With `mayChangeRole` false (editors) an existing invite
 * with another role is left alone: 'role-conflict'. One statement, so concurrent invites can't
 * interleave between a check and the write.
 */
export async function saveInvite(
  i: { id: string; boardId: string; email: string; role: MemberRole; tokenHash: string; invitedBy: string; now: number; expiresAt: number },
  mayChangeRole: boolean,
): Promise<SaveInviteResult> {
  try {
    const r = await one<InviteDbRow>(
      `INSERT INTO board_invites (id, board_id, email, role, token_hash, invited_by, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (board_id, email) DO UPDATE
         SET role = excluded.role, token_hash = excluded.token_hash, invited_by = excluded.invited_by,
             created_at = excluded.created_at, expires_at = excluded.expires_at
         WHERE $9 OR board_invites.role = excluded.role
       RETURNING *`,
      [i.id, i.boardId, i.email, i.role, i.tokenHash, i.invitedBy, new Date(i.now), new Date(i.expiresAt), mayChangeRole],
    );
    return r ? toInvite(r) : 'role-conflict';
  } catch (e) {
    if (isForeignKeyViolation(e)) return 'board-gone';
    throw e;
  }
}

export async function listInvites(boardId: string): Promise<InviteRow[]> {
  return (await query<InviteDbRow>(`SELECT * FROM board_invites WHERE board_id = $1 ORDER BY created_at`, [boardId])).map(toInvite);
}

/** A live (unexpired) invite by its token hash, without using it. */
export async function findLiveInvite(tokenHash: string, now: number): Promise<InviteRow | null> {
  const r = await one<InviteDbRow>(`SELECT * FROM board_invites WHERE token_hash = $1 AND expires_at > $2`, [tokenHash, new Date(now)]);
  return r ? toInvite(r) : null;
}

/** Uses a live invite: deletes and returns it. Two concurrent uses: exactly one gets it. */
export async function takeInvite(tokenHash: string, now: number): Promise<InviteRow | null> {
  const r = await one<InviteDbRow>(`DELETE FROM board_invites WHERE token_hash = $1 AND expires_at > $2 RETURNING *`, [
    tokenHash,
    new Date(now),
  ]);
  return r ? toInvite(r) : null;
}

/** Uses every live invite sent to `email` (the address was just proven). */
export async function takeInvitesForEmail(email: string, now: number): Promise<InviteRow[]> {
  return (
    await query<InviteDbRow>(`DELETE FROM board_invites WHERE email = $1 AND expires_at > $2 RETURNING *`, [email, new Date(now)])
  ).map(toInvite);
}

/** New token + expiry for an existing invite (resend). Null if it was revoked or used meanwhile. */
export async function renewInvite(boardId: string, id: string, tokenHash: string, now: number, expiresAt: number): Promise<InviteRow | null> {
  const r = await one<InviteDbRow>(
    `UPDATE board_invites SET token_hash = $3, created_at = $4, expires_at = $5 WHERE board_id = $1 AND id = $2 RETURNING *`,
    [boardId, id, tokenHash, new Date(now), new Date(expiresAt)],
  );
  return r ? toInvite(r) : null;
}

/** Revokes an invite; `onlyIfSentBy` restricts it to one inviter. Returns false if nothing was deleted. */
export async function deleteInvite(boardId: string, id: string, onlyIfSentBy: string | null): Promise<boolean> {
  const rows = await query(
    `DELETE FROM board_invites WHERE board_id = $1 AND id = $2 AND ($3::text IS NULL OR invited_by = $3) RETURNING 1`,
    [boardId, id, onlyIfSentBy],
  );
  return rows.length > 0;
}

// ---- access requests (board_access_requests) ----

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

export interface AccessRequestRow {
  boardId: string;
  userId: string;
  role: MemberRole;
  message: string;
  status: AccessRequestStatus;
  createdAt: number;
  decidedBy: string | null;
  decidedRole: MemberRole | null;
  decidedAt: number | null;
}

interface RequestDbRow {
  board_id: string;
  user_id: string;
  role: MemberRole;
  message: string;
  status: AccessRequestStatus;
  created_at: Date;
  decided_by: string | null;
  decided_role: MemberRole | null;
  decided_at: Date | null;
}

const toRequest = (r: RequestDbRow): AccessRequestRow => ({
  boardId: r.board_id,
  userId: r.user_id,
  role: r.role,
  message: r.message,
  status: r.status,
  createdAt: r.created_at.getTime(),
  decidedBy: r.decided_by,
  decidedRole: r.decided_role,
  decidedAt: r.decided_at?.getTime() ?? null,
});

export async function getAccessRequest(boardId: string, userId: string): Promise<AccessRequestRow | null> {
  const r = await one<RequestDbRow>(`SELECT * FROM board_access_requests WHERE board_id = $1 AND user_id = $2`, [boardId, userId]);
  return r ? toRequest(r) : null;
}

/**
 * Files a request unless one is already pending, or one was denied after `deniedSince` (asking
 * again right after a "no" would only pester the approvers). One statement, so two tabs asking at
 * once file it once. Returns 'created', 'pending' (one already was), 'denied' (too soon) or
 * 'board-gone'.
 */
export async function fileAccessRequest(
  r: { boardId: string; userId: string; role: MemberRole; message: string },
  now: number,
  deniedSince: number,
): Promise<'created' | 'pending' | 'denied' | 'board-gone'> {
  try {
    const rows = await query(
      `INSERT INTO board_access_requests (board_id, user_id, role, message, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (board_id, user_id) DO UPDATE
         SET role = excluded.role, message = excluded.message, status = 'pending', created_at = excluded.created_at,
             decided_by = NULL, decided_role = NULL, decided_at = NULL
         WHERE board_access_requests.status = 'approved'
            OR (board_access_requests.status = 'denied' AND board_access_requests.decided_at < $6)
       RETURNING 1`,
      [r.boardId, r.userId, r.role, r.message, new Date(now), new Date(deniedSince)],
    );
    if (rows.length > 0) return 'created';
  } catch (e) {
    if (isForeignKeyViolation(e)) return 'board-gone';
    throw e;
  }
  return (await getAccessRequest(r.boardId, r.userId))?.status === 'pending' ? 'pending' : 'denied';
}

/** Withdraws the user's own pending request; false if there was none. */
export async function withdrawAccessRequest(boardId: string, userId: string): Promise<boolean> {
  const rows = await query(`DELETE FROM board_access_requests WHERE board_id = $1 AND user_id = $2 AND status = 'pending' RETURNING 1`, [
    boardId,
    userId,
  ]);
  return rows.length > 0;
}

export async function pendingAccessRequests(boardId: string): Promise<AccessRequestRow[]> {
  return (
    await query<RequestDbRow>(`SELECT * FROM board_access_requests WHERE board_id = $1 AND status = 'pending' ORDER BY created_at`, [boardId])
  ).map(toRequest);
}

/**
 * Decides a PENDING request: only one decision wins when two approvers act at once. Returns the
 * decided request, or null if it was not pending (any more).
 */
export async function decideAccessRequest(
  boardId: string,
  userId: string,
  d: { status: 'approved' | 'denied'; by: string; role: MemberRole | null },
  now: number,
): Promise<AccessRequestRow | null> {
  const r = await one<RequestDbRow>(
    `UPDATE board_access_requests SET status = $3, decided_by = $4, decided_role = $5, decided_at = $6
     WHERE board_id = $1 AND user_id = $2 AND status = 'pending' RETURNING *`,
    [boardId, userId, d.status, d.by, d.role, new Date(now)],
  );
  return r ? toRequest(r) : null;
}

/** The requests behind these (board, requester) pairs, for showing their outcome. */
export async function accessRequestsFor(pairs: Array<{ boardId: string; userId: string }>): Promise<AccessRequestRow[]> {
  if (pairs.length === 0) return [];
  return (
    await query<RequestDbRow>(
      `SELECT r.* FROM board_access_requests r
       JOIN unnest($1::text[], $2::text[]) AS p(board_id, user_id) ON p.board_id = r.board_id AND p.user_id = r.user_id`,
      [pairs.map((p) => p.boardId), pairs.map((p) => p.userId)],
    )
  ).map(toRequest);
}
