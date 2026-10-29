// The only writer of `events`, `event_board_states` and `event_pending_boards` [S4].
import type { EventData, FreeroEventType } from '@freero/shared';
import { isForeignKeyViolation, one, query, tx } from '../../platform/db';
import { appendOutbox } from '../../platform/outbox';
import type { StoredState } from './derive';

/**
 * Outbox topic of an event recorded in the stream (key `event:<id>`, payload `{ id }`), appended in
 * the transaction that records it: consumers of the stream (webhooks) keep their own cursor on it.
 */
export const EVENT_RECORDED_TOPIC = 'event.recorded';

export interface NewEvent {
  sourceKey: string;
  type: FreeroEventType;
  workspaceId: string;
  boardId: string;
  objectUri: string;
  actor: { kind: 'user' | 'agent' | 'system'; id: string | null; app?: string | null } | null;
  data: EventData;
  at: number;
}

export interface StoredEvent extends Omit<NewEvent, 'sourceKey'> {
  id: number;
}

/** Records events not recorded yet (by source key), each with its outbox event. Joins the caller's transaction. */
export async function recordEvents(events: NewEvent[]): Promise<number[]> {
  const ids: number[] = [];
  await tx(async () => {
    for (const e of events) {
      const r = await one<{ id: number }>(
        `INSERT INTO events (source_key, type, workspace_id, board_id, object_uri, actor_kind, actor_id, actor_app, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
        [e.sourceKey, e.type, e.workspaceId, e.boardId, e.objectUri, e.actor?.kind ?? null, e.actor?.id ?? null, e.actor?.app ?? null, JSON.stringify(e.data), new Date(e.at)],
      );
      if (!r) continue;
      ids.push(Number(r.id));
      await appendOutbox(EVENT_RECORDED_TOPIC, `event:${r.id}`, { id: Number(r.id) });
    }
  });
  return ids;
}

interface EventRow {
  id: number;
  type: FreeroEventType;
  workspace_id: string;
  board_id: string;
  object_uri: string;
  actor_kind: 'user' | 'agent' | 'system' | null;
  actor_id: string | null;
  actor_app: string | null;
  data: EventData | string;
  created_at: Date;
}

export async function eventsByIds(ids: number[]): Promise<StoredEvent[]> {
  if (!ids.length) return [];
  const rows = await query<EventRow>(`SELECT * FROM events WHERE id = ANY($1::bigint[]) ORDER BY id`, [ids]);
  return rows.map((r) => ({
    id: Number(r.id),
    type: r.type,
    workspaceId: r.workspace_id,
    boardId: r.board_id,
    objectUri: r.object_uri,
    actor: r.actor_kind ? { kind: r.actor_kind, id: r.actor_id, app: r.actor_app } : null,
    data: typeof r.data === 'string' ? (JSON.parse(r.data) as EventData) : r.data,
    at: r.created_at.getTime(),
  }));
}

/** A board's events, oldest first (tests; later the inbox and feeds). */
export async function eventsOfBoard(boardId: string): Promise<StoredEvent[]> {
  const ids = await query<{ id: number }>(`SELECT id FROM events WHERE board_id = $1 ORDER BY id`, [boardId]);
  return eventsByIds(ids.map((r) => Number(r.id)));
}

// ---- the item / comment deriver's state ----

/** A new board starts from nothing: its first items are news (an absent state is a silent baseline). */
export async function startEmptyState(boardId: string, now = Date.now()): Promise<void> {
  try {
    await query(`INSERT INTO event_board_states (board_id, items, messages, updated_at) VALUES ($1, '{}', '[]', $2) ON CONFLICT (board_id) DO NOTHING`, [boardId, new Date(now)]);
  } catch (e) {
    if (!isForeignKeyViolation(e)) throw e; // deleted meanwhile
  }
}

export async function stateOf(boardId: string): Promise<StoredState | null> {
  const r = await one<{ items: StoredState['items'] | string; messages: string[] | string }>(`SELECT items, messages FROM event_board_states WHERE board_id = $1`, [boardId]);
  if (!r) return null;
  return {
    items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items,
    messages: typeof r.messages === 'string' ? JSON.parse(r.messages) : r.messages,
  };
}

/**
 * Boards whose saved content changed: compared once they were quiet for `settleMs`, and at the
 * latest `maxWaitMs` after the first change (someone editing for an hour still produces events).
 */
export async function markPending(boardIds: string[], now: number, settleMs: number, maxWaitMs: number): Promise<void> {
  for (const id of boardIds) {
    try {
      await query(
        `INSERT INTO event_pending_boards (board_id, first_at, due_at) VALUES ($1, $2, $3)
         ON CONFLICT (board_id) DO UPDATE SET due_at = LEAST(event_pending_boards.first_at + make_interval(secs => $4::double precision / 1000), excluded.due_at)`,
        [id, new Date(now), new Date(now + settleMs), maxWaitMs],
      );
    } catch (e) {
      if (!isForeignKeyViolation(e)) throw e;
    }
  }
}

export async function duePending(now: number, limit: number): Promise<Array<{ boardId: string; dueAt: Date }>> {
  return (
    await query<{ board_id: string; due_at: Date }>(`SELECT board_id, due_at FROM event_pending_boards WHERE due_at <= $1 ORDER BY due_at LIMIT $2`, [new Date(now), limit])
  ).map((r) => ({ boardId: r.board_id, dueAt: r.due_at }));
}

/**
 * One comparison's outcome, atomically: its events, the new state, and the board leaves the
 * pending list — unless it changed again meanwhile (`due_at` moved: it stays, compared again).
 */
export async function applyDerivation(boardId: string, dueAt: Date, events: NewEvent[], state: StoredState | null, now = Date.now()): Promise<number[]> {
  try {
    return await tx(async () => {
      const ids = await recordEvents(events);
      if (state)
        await query(
          `INSERT INTO event_board_states (board_id, items, messages, updated_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (board_id) DO UPDATE SET items = excluded.items, messages = excluded.messages, updated_at = excluded.updated_at`,
          [boardId, JSON.stringify(state.items), JSON.stringify(state.messages), new Date(now)],
        );
      await query(`DELETE FROM event_pending_boards WHERE board_id = $1 AND due_at = $2`, [boardId, dueAt]);
      return ids;
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) return []; // the board was deleted meanwhile (its rows cascade)
    throw e;
  }
}

/** Retention: events older than `before` go. */
export async function pruneEventsBefore(before: number): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await query<{ id: number }>(`DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at < $1 LIMIT 5000) RETURNING id`, [new Date(before)]);
    total += rows.length;
    if (rows.length < 5000) return total;
  }
}
