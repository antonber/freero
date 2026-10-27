// The only writer of `board_members` [S4].
import { sql } from '../../platform/db';
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
  created_at: number;
}

const toRow = (r: Row): MemberRow => ({ boardId: r.board_id, userId: r.user_id, role: r.role, createdAt: Number(r.created_at) });

export function getMembership(boardId: string, userId: string): MemberRow | null {
  const r = sql(`SELECT * FROM board_members WHERE board_id = ? AND user_id = ?`).get(boardId, userId) as Row | undefined;
  return r ? toRow(r) : null;
}

export function listByBoard(boardId: string): MemberRow[] {
  return (sql(`SELECT * FROM board_members WHERE board_id = ? ORDER BY created_at`).all(boardId) as unknown as Row[]).map(toRow);
}

export function listByUser(userId: string): MemberRow[] {
  return (sql(`SELECT * FROM board_members WHERE user_id = ?`).all(userId) as unknown as Row[]).map(toRow);
}

export function upsertMember(boardId: string, userId: string, role: MemberRole, now: number): void {
  sql(
    `INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(boardId, userId, role, now);
}

export function setRole(boardId: string, userId: string, role: MemberRole): void {
  sql(`UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?`).run(role, boardId, userId);
}

export function removeMember(boardId: string, userId: string): void {
  sql(`DELETE FROM board_members WHERE board_id = ? AND user_id = ?`).run(boardId, userId);
}

export function removeAllForBoard(boardId: string): void {
  sql(`DELETE FROM board_members WHERE board_id = ?`).run(boardId);
}
