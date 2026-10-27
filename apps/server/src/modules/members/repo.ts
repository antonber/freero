// The only writer of `board_members` [S4].
import { isForeignKeyViolation, one, query } from '../../platform/db';
import type { MemberRole } from './roles';

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
