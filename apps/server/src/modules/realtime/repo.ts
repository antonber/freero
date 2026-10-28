// The only writer of `board_docs` and `board_layers` [S4].
import { isForeignKeyViolation, one, query } from '../../platform/db';

const toBuffer = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

export async function loadState(boardId: string): Promise<Uint8Array | null> {
  const r = await one<{ state: Uint8Array }>(`SELECT state FROM board_docs WHERE board_id = $1`, [boardId]);
  return r ? new Uint8Array(r.state) : null;
}

/** Thrown by saveState when the board row is gone (deleted while its doc was open). */
export class BoardGoneError extends Error {}

export async function saveState(boardId: string, state: Uint8Array, now: number): Promise<void> {
  try {
    await query(
      `INSERT INTO board_docs (board_id, state, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (board_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      [boardId, toBuffer(state), new Date(now)],
    );
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new BoardGoneError(boardId);
    throw e;
  }
}

// ---- board_layers: server-held layer docs ('editors', 'u:<userId>') ----

export async function loadLayers(boardId: string): Promise<Array<{ layer: string; state: Uint8Array }>> {
  const rows = await query<{ layer: string; state: Uint8Array }>(`SELECT layer, state FROM board_layers WHERE board_id = $1`, [boardId]);
  return rows.map((r) => ({ layer: r.layer, state: new Uint8Array(r.state) }));
}

export async function loadLayer(boardId: string, layer: string): Promise<Uint8Array | null> {
  const r = await one<{ state: Uint8Array }>(`SELECT state FROM board_layers WHERE board_id = $1 AND layer = $2`, [boardId, layer]);
  return r ? new Uint8Array(r.state) : null;
}

export async function saveLayer(boardId: string, layer: string, state: Uint8Array, now: number): Promise<void> {
  try {
    await query(
      `INSERT INTO board_layers (board_id, layer, state, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id, layer) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      [boardId, layer, toBuffer(state), new Date(now)],
    );
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new BoardGoneError(boardId);
    throw e;
  }
}
