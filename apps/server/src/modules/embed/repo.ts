// The only writer of `embed_member_tokens` [S4]: tokens that let a board embedded on another site
// (#2) act for the person who signed in from it, for that board only.
import { one, query } from '../../platform/db';

export interface MemberTokenRow {
  userId: string;
  /** auth's key of the session that made it: the token ends with that session. */
  sessionKey: string;
  boardId: string;
  /** 'viewer' for a read-only embed, else 'owner' (no cap beyond the person's own role). */
  maxRole: 'viewer' | 'owner';
  expiresAt: number;
}

interface Row {
  user_id: string;
  session_key: string;
  board_id: string;
  max_role: 'viewer' | 'owner';
  expires_at: Date;
}

const toRow = (r: Row): MemberTokenRow => ({
  userId: r.user_id,
  sessionKey: r.session_key,
  boardId: r.board_id,
  maxRole: r.max_role === 'viewer' ? 'viewer' : 'owner',
  expiresAt: r.expires_at.getTime(),
});

export async function insertMemberToken(tokenHash: string, t: MemberTokenRow, now: number): Promise<void> {
  await query(
    `INSERT INTO embed_member_tokens (token_hash, user_id, session_key, board_id, max_role, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tokenHash, t.userId, t.sessionKey, t.boardId, t.maxRole, new Date(now), new Date(t.expiresAt)],
  );
}

/** The live token with this hash, or null. */
export async function memberToken(tokenHash: string, now: number): Promise<MemberTokenRow | null> {
  const r = await one<Row>(`SELECT * FROM embed_member_tokens WHERE token_hash = $1 AND expires_at > $2`, [tokenHash, new Date(now)]);
  return r ? toRow(r) : null;
}

/** Deletes expired tokens; returns how many. */
export async function deleteExpiredMemberTokens(now: number): Promise<number> {
  return (await query(`DELETE FROM embed_member_tokens WHERE expires_at <= $1 RETURNING token_hash`, [new Date(now)])).length;
}
