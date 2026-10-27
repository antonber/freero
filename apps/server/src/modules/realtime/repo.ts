// The only writer of `board_docs` [S4].
import { sql } from '../../platform/db';

export function loadState(boardId: string): Uint8Array | null {
  const r = sql(`SELECT state FROM board_docs WHERE board_id = ?`).get(boardId) as { state: Uint8Array } | undefined;
  return r ? new Uint8Array(r.state) : null;
}

export function saveState(boardId: string, state: Uint8Array, now: number): void {
  sql(
    `INSERT INTO board_docs (board_id, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (board_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ).run(boardId, state, now);
}

export function deleteState(boardId: string): void {
  sql(`DELETE FROM board_docs WHERE board_id = ?`).run(boardId);
}
