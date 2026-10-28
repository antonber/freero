// The transactional outbox and its consumers (KAI-148): the one way a change in one module makes
// something ELSE happen reliably — a derived index (references, later search), a webhook, a
// cleanup another module owns.
//
// Producing: `appendOutbox(topic, key, payload?)` inside the transaction that makes the change
// (any repo query joins the caller's tx, see db.ts). The event commits with the change or not at
// all, so nothing is lost between "committed" and "told the listener" — the gap the in-process
// events (`onX(fn)` + a call after the transaction) have when the process dies right there.
//
// Consuming: `consumeOutbox(ctx, { name, topics, lockKey, handle })` from an init.ts. Every
// instance polls (and is woken right after a local commit that appended), but each consumer runs
// on one instance at a time (Postgres advisory lock, like platform/jobs). It reads events in
// (txid, id) order only up to the oldest transaction still running, so an event committed late
// by a slow transaction is never skipped; it keeps its position in `_outbox_cursors` and moves
// it only after `handle` returned, so a crash anywhere replays the batch (at-least-once).
//
// Rules for a consumer (what makes at-least-once safe):
// - Idempotent: handling the same event twice leaves the same state. Derivers recompute their
//   rows for the event's KEY from the CURRENT source (never apply deltas), and pass `version` to
//   the write so an older derivation never replaces a newer one (`version` grows with every batch
//   read, on every instance).
// - Re-check permissions on READ, never trust the derived rows for access: they lag by seconds.
// - Backpressure: a batch is at most `batchSize` events, coalesced to the newest per key; a run
//   handles a few batches then yields; a batch that keeps failing is retried event by event and
//   an event that still fails is skipped and counted (freero_outbox_skipped_total) — a rebuild
//   repairs what it would have derived.
import type { ServerContext } from './context';
import { afterCommit, one, query, withAdvisoryLock } from './db';
import { log, logError } from './log';
import { counter, gaugeFn } from './metrics';

export interface OutboxEvent {
  id: number;
  topic: string;
  key: string;
  payload: unknown;
  createdAt: number;
}

export interface OutboxConsumer {
  /** Stable name: its position is stored under it. Renaming it starts from the oldest kept event. */
  name: string;
  topics: readonly string[];
  /** Postgres advisory lock key, unique per consumer and constant across releases. */
  lockKey: number;
  /** Most events read per batch (default 200). */
  batchSize?: number;
  /**
   * How soon after a local commit that appended an event the consumer runs (default 20 ms).
   * Longer gathers a burst of changes to one key into one batch (one derivation).
   */
  wakeDelayMs?: number;
  /**
   * Handles one batch: the newest event per key, oldest first. Must be idempotent (see above).
   * `version` is higher than that of any batch read before, on any instance.
   */
  handle(events: OutboxEvent[], ctx: { version: number }): Promise<void>;
}

const POLL_MS = 1000;
const BATCHES_PER_RUN = 10;
const MAX_ATTEMPTS = 3;
const KEEP_CONSUMED_MS = 24 * 3600_000;
const KEEP_ANY_MS = 7 * 24 * 3600_000;
const PRUNE_LOCK_KEY = 7_202_611_030; // arbitrary, constant across releases

const appended = counter('freero_outbox_appended_total', 'Outbox events appended by this instance', ['topic'] as const);
const consumed = counter('freero_outbox_consumed_total', 'Outbox events consumed (cursor moved past them) by this instance', ['consumer'] as const);
const failed = counter('freero_outbox_failed_total', 'Outbox batches whose handler threw (retried)', ['consumer'] as const);
const skipped = counter('freero_outbox_skipped_total', 'Outbox events skipped after failing repeatedly', ['consumer'] as const);

interface Registered {
  consumer: OutboxConsumer;
  /** Oldest event still waiting when the last run ended (lag gauge), or null when caught up. */
  waitingSince: number | null;
  /** Failed attempts of the batch starting at this event id. */
  failures: { firstId: number; count: number } | null;
  wake?: (delayMs: number) => void;
}
const consumers = new Map<string, Registered>();

gaugeFn('freero_outbox_lag_seconds', 'Age of the oldest outbox event a consumer on this instance has not handled yet', () => {
  const now = Date.now();
  let max = 0;
  for (const r of consumers.values()) if (r.waitingSince !== null) max = Math.max(max, (now - r.waitingSince) / 1000);
  return max;
});

/** Appends an event in the caller's transaction (call it inside the tx that makes the change). */
export async function appendOutbox(topic: string, key: string, payload?: unknown): Promise<void> {
  await query(`INSERT INTO _outbox (topic, key, payload) VALUES ($1, $2, $3)`, [topic, key, payload === undefined ? null : JSON.stringify(payload)]);
  appended.inc({ topic });
  afterCommit(wakeAll);
}

function wakeAll(): void {
  for (const r of consumers.values()) r.wake?.(r.consumer.wakeDelayMs ?? 20);
}

/** Registers a consumer without scheduling it (tests drive it with drainOutbox). */
export function registerOutboxConsumer(consumer: OutboxConsumer): void {
  const known = consumers.get(consumer.name);
  if (known) known.consumer = consumer;
  else consumers.set(consumer.name, { consumer, waitingSince: null, failures: null });
}

interface Row {
  id: number;
  txid: number;
  topic: string;
  key: string;
  payload: unknown;
  created_at: Date;
}

/** The newest event per key, ordered by where that newest one sits. */
function coalesce(rows: Row[]): OutboxEvent[] {
  const newest = new Map<string, Row>();
  for (const r of rows) {
    newest.delete(r.key);
    newest.set(r.key, r);
  }
  return [...newest.values()].map((r) => ({
    id: Number(r.id),
    topic: r.topic,
    key: r.key,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    createdAt: new Date(r.created_at).getTime(),
  }));
}

async function deliver(reg: Registered, events: OutboxEvent[], version: number): Promise<void> {
  const c = reg.consumer;
  const firstId = events[0].id;
  try {
    await c.handle(events, { version });
    reg.failures = null;
    return;
  } catch (e) {
    failed.inc({ consumer: c.name });
    const count = reg.failures?.firstId === firstId ? reg.failures.count + 1 : 1;
    reg.failures = { firstId, count };
    if (count < MAX_ATTEMPTS) {
      logError(`outbox: ${c.name} failed a batch (attempt ${count}); it will be retried`, e);
      throw e;
    }
  }
  // The batch keeps failing: one event at a time, so one bad event can't hold up the rest.
  for (const ev of events) {
    try {
      await c.handle([ev], { version });
    } catch (e) {
      skipped.inc({ consumer: c.name });
      logError(`outbox: ${c.name} skipped event ${ev.id} (${ev.topic} ${ev.key}) after ${MAX_ATTEMPTS} failures; a rebuild repairs it`, e);
    }
  }
  reg.failures = null;
}

/**
 * One run of a consumer: up to `maxBatches` batches. Null when another instance (or another run
 * here) holds its lock right now. `more`: it stopped with events still waiting.
 */
async function runConsumer(reg: Registered, maxBatches = BATCHES_PER_RUN): Promise<{ handled: number; more: boolean } | null> {
  const c = reg.consumer;
  const batch = c.batchSize ?? 200;
  return withAdvisoryLock(c.lockKey, async () => {
    const cur = (await one<{ txid: number; event_id: number }>(`SELECT txid, event_id FROM _outbox_cursors WHERE consumer = $1`, [c.name])) ?? {
      txid: 0,
      event_id: 0,
    };
    let at = { txid: Number(cur.txid), id: Number(cur.event_id) };
    let handled = 0;
    for (let i = 0; i < maxBatches; i++) {
      const rows = await query<Row>(
        `SELECT id, txid, topic, key, payload, created_at FROM _outbox
         WHERE topic = ANY($1::text[]) AND (txid, id) > ($2::bigint, $3::bigint)
           AND txid < pg_snapshot_xmin(pg_current_snapshot())::text::bigint
         ORDER BY txid, id LIMIT $4`,
        [[...c.topics], at.txid, at.id, batch],
      );
      if (rows.length === 0) {
        reg.waitingSince = null;
        return { handled, more: false };
      }
      reg.waitingSince = new Date(rows[0].created_at).getTime();
      const version = Number((await one<{ v: number }>(`SELECT nextval('_outbox_derive_version') AS v`))!.v);
      await deliver(reg, coalesce(rows), version);
      const last = rows[rows.length - 1];
      at = { txid: Number(last.txid), id: Number(last.id) };
      await query(
        `INSERT INTO _outbox_cursors (consumer, txid, event_id, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (consumer) DO UPDATE SET txid = excluded.txid, event_id = excluded.event_id, updated_at = now()`,
        [c.name, at.txid, at.id],
      );
      consumed.inc({ consumer: c.name }, rows.length);
      handled += rows.length;
      if (rows.length < batch) {
        reg.waitingSince = null;
        return { handled, more: false };
      }
    }
    return { handled, more: true };
  });
}

/**
 * Runs a registered consumer until it is caught up (tests, admin rebuilds, shutdown-free one-offs).
 * Waits for its lock if another run holds it. Rethrows a failing handler's error. Returns the
 * number of events consumed.
 */
export async function drainOutbox(name: string, { timeoutMs = 30_000 } = {}): Promise<number> {
  const reg = consumers.get(name);
  if (!reg) throw new Error(`outbox: no consumer named ${name}`);
  const end = Date.now() + timeoutMs;
  let total = 0;
  for (;;) {
    const r = await runConsumer(reg, 1000);
    if (r) {
      total += r.handled;
      if (!r.more) return total;
    } else if (Date.now() > end) throw new Error(`outbox: ${name} stayed busy for ${timeoutMs}ms`);
    else await new Promise((res) => setTimeout(res, 20));
  }
}

/**
 * Takes the consumer's lock (waiting for a run in progress) and runs `fn` under it: nothing of the
 * consumer runs meanwhile, on any instance. For rebuilds that recompute everything the consumer
 * derives, so a live batch can't interleave with them.
 */
export async function whileConsumerPaused<T>(name: string, fn: () => Promise<T>, { timeoutMs = 60_000 } = {}): Promise<T> {
  const reg = consumers.get(name);
  if (!reg) throw new Error(`outbox: no consumer named ${name}`);
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ran = false;
    const out = await withAdvisoryLock(reg.consumer.lockKey, async () => {
      ran = true;
      return fn();
    });
    if (ran) return out as T;
    if (Date.now() > end) throw new Error(`outbox: ${name} stayed busy for ${timeoutMs}ms`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

/** A fresh derive version (higher than any handed out before), for rebuilds outside a batch. */
export async function nextDeriveVersion(): Promise<number> {
  return Number((await one<{ v: number }>(`SELECT nextval('_outbox_derive_version') AS v`))!.v);
}

let pruneScheduled = false;

/**
 * Registers a consumer and runs it on this instance: every POLL_MS, right after a local commit
 * that appended an event, and straight on while a backlog remains. Stops on shutdown.
 */
export function consumeOutbox(ctx: ServerContext, consumer: OutboxConsumer): void {
  registerOutboxConsumer(consumer);
  const reg = consumers.get(consumer.name)!;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let dueAt = Infinity;
  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (running) {
      again = true; // woken mid-run: run once more right after
      return;
    }
    // Only ever earlier: repeated wakes (a burst of saves) must not keep postponing the run.
    if (timer && Date.now() + delayMs >= dueAt) return;
    if (timer) clearTimeout(timer);
    dueAt = Date.now() + delayMs;
    timer = setTimeout(tick, delayMs);
    timer.unref();
  };
  const tick = () => {
    timer = null;
    dueAt = Infinity;
    if (stopped || running) return;
    again = false;
    running = runConsumer(reg)
      .then((r) => {
        if (r?.more) again = true;
      })
      .catch(() => {
        /* logged in deliver; retried on the next tick */
      })
      .finally(() => {
        running = null;
        schedule(again ? 0 : POLL_MS);
      });
  };
  reg.wake = schedule;
  schedule(250);
  ctx.onShutdown(async () => {
    stopped = true;
    reg.wake = undefined;
    if (timer) clearTimeout(timer);
    await running;
  });
  if (!pruneScheduled) {
    pruneScheduled = true;
    schedulePrune(ctx);
  }
}

function schedulePrune(ctx: ServerContext): void {
  const run = () => withAdvisoryLock(PRUNE_LOCK_KEY, pruneOutbox).catch((e) => logError('outbox: prune failed', e));
  let running: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => (running = run()), 3600_000);
  timer.unref();
  const first = setTimeout(() => (running = run()), 60_000);
  first.unref();
  ctx.onShutdown(async () => {
    clearInterval(timer);
    clearTimeout(first);
    await running;
  });
}

/**
 * Deletes events every consumer known to this release has consumed and that are a day old, and
 * any event older than a week (a consumer that far behind is broken; its rebuild repairs it).
 */
export async function pruneOutbox(now = Date.now()): Promise<number> {
  const names = [...consumers.keys()];
  const cursors = new Map(
    (await query<{ consumer: string; txid: number; event_id: number }>(`SELECT consumer, txid, event_id FROM _outbox_cursors WHERE consumer = ANY($1::text[])`, [names])).map(
      (r) => [r.consumer, { txid: Number(r.txid), id: Number(r.event_id) }],
    ),
  );
  let min: { txid: number; id: number } | null = null;
  for (const n of names) {
    const c = cursors.get(n) ?? { txid: 0, id: 0 };
    if (!min || c.txid < min.txid || (c.txid === min.txid && c.id < min.id)) min = c;
  }
  let removed = 0;
  for (;;) {
    const rows = await query<{ id: number }>(
      `DELETE FROM _outbox WHERE id IN (
         SELECT id FROM _outbox
         WHERE created_at < $1 OR (created_at < $2 AND (txid, id) <= ($3::bigint, $4::bigint))
         LIMIT 5000)
       RETURNING id`,
      [new Date(now - KEEP_ANY_MS), new Date(now - KEEP_CONSUMED_MS), min?.txid ?? 0, min?.id ?? 0],
    );
    removed += rows.length;
    if (rows.length < 5000) break;
  }
  if (removed) log(`outbox: pruned ${removed} consumed event(s)`);
  return removed;
}
