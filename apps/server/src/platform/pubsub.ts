// Instance-wide events: a message published on one instance reaches the subscribers of every
// instance (Redis pub/sub when REDIS_URL is set; in-process otherwise). Delivery is best effort —
// use it to tell other instances to drop in-memory state (close a revoked session's sockets),
// never as the record of anything.
//
//   const off = subscribe('auth:session-end', (key) => …);
//   publish('auth:session-end', key);
import type { Redis } from 'ioredis';
import { newId } from './ids';
import { logError } from './log';
import { getRedis } from './redis';

type Listener = (message: string) => void;

const INSTANCE = newId(12);
const PREFIX = 'freero:bus:';
const listeners = new Map<string, Set<Listener>>();
let subscriber: { redis: Redis; sub: Redis } | null = null;

function deliver(channel: string, message: string): void {
  for (const fn of listeners.get(channel) ?? []) {
    try {
      fn(message);
    } catch (e) {
      logError(`pubsub: a listener of ${channel} failed`, e);
    }
  }
}

function redisSubscriber(): Redis | null {
  const redis = getRedis();
  if (!redis) return null;
  if (subscriber?.redis !== redis) {
    // A subscribed connection can't run other commands: use a dedicated one that queues while down.
    const sub = redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, lazyConnect: false });
    sub.on('error', () => {}); // the main connection logs Redis outages
    sub.on('message', (ch: string, raw: string) => {
      if (!ch.startsWith(PREFIX)) return;
      try {
        const { from, message } = JSON.parse(raw) as { from: string; message: string };
        if (from !== INSTANCE) deliver(ch.slice(PREFIX.length), message);
      } catch {
        /* not ours */
      }
    });
    subscriber = { redis, sub };
  }
  return subscriber.sub;
}

export function subscribe(channel: string, fn: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    redisSubscriber()
      ?.subscribe(PREFIX + channel)
      .catch((e) => logError(`pubsub: could not subscribe to ${channel}`, e));
  }
  set.add(fn);
  return () => void set.delete(fn);
}

/** Delivers to this instance's subscribers now, and to every other instance through Redis. */
export function publish(channel: string, message: string): void {
  deliver(channel, message);
  getRedis()
    ?.publish(PREFIX + channel, JSON.stringify({ from: INSTANCE, message }))
    .catch((e) => logError(`pubsub: could not publish on ${channel}`, e));
}

export async function closePubSub(): Promise<void> {
  const s = subscriber;
  subscriber = null;
  await s?.sub.quit().catch(() => s.sub.disconnect());
}
