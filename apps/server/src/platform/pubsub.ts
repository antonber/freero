// Publish/subscribe between app instances (binary messages on named channels), for live fan-out.
// Redis pub/sub when REDIS_URL is set: publishes go through the shared connection, subscriptions
// through one dedicated subscriber connection. Otherwise in-process: a single instance has nobody
// to fan out to, and every message reaches only the process's own subscribers.
//
// Delivery is at-most-once and only to instances subscribed at that moment (Redis pub/sub keeps
// nothing). Subscribers must be able to catch up: `resubscribed()` fires whenever a subscription
// becomes active again after it was not (Redis reconnected, or the first SUBSCRIBE was slow), so
// they can ask the other instances for what they missed. A publisher receives its own messages.
import type { Redis } from 'ioredis';
import { log, logError } from './log';
import { getRedis } from './redis';

export interface Subscriber {
  message(data: Uint8Array): void;
  /** The subscription is active again after a gap: messages may have been missed. */
  resubscribed?(): void;
}

export interface Subscription {
  /** True once the subscription is active; false if not confirmed within SUBSCRIBE_TIMEOUT_MS. */
  ready: Promise<boolean>;
  close(): void;
}

const SUBSCRIBE_TIMEOUT_MS = 2000;

const channels = new Map<string, Set<Subscriber>>();
let subscriber: Redis | null = null;
let lastError = 0;

function logThrottled(message: string, err: unknown): void {
  if (Date.now() - lastError > 30_000) logError(message, err);
  lastError = Date.now();
}

function deliver(channel: string, data: Uint8Array): void {
  const subs = channels.get(channel);
  if (!subs) return;
  for (const s of [...subs]) {
    try {
      s.message(data);
    } catch (err) {
      logError(`pubsub: subscriber of ${channel} failed`, err);
    }
  }
}

function notifyResubscribed(subs: Iterable<Subscriber>): void {
  for (const s of [...subs]) {
    try {
      s.resubscribed?.();
    } catch (err) {
      logError('pubsub: resubscribe handler failed', err);
    }
  }
}

/** The dedicated connection subscriptions live on (Redis forbids other commands on it). */
function subscriberFor(redis: Redis): Redis {
  if (subscriber) return subscriber;
  const sub = redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
  let connectedBefore = false;
  sub.on('messageBuffer', (channel: Buffer, message: Buffer) =>
    deliver(channel.toString(), new Uint8Array(message.buffer, message.byteOffset, message.byteLength)),
  );
  sub.on('error', (err) => logThrottled('pubsub: redis subscriber error', err));
  sub.on('ready', () => {
    if (connectedBefore) void catchUpAfterReconnect(redis, sub);
    connectedBefore = true;
  });
  // Publishes made while the shared connection was down were dropped: the same catch-up.
  let publisherConnectedBefore = redis.status === 'ready';
  redis.on('ready', () => {
    if (publisherConnectedBefore) void catchUpAfterReconnect(redis, sub);
    publisherConnectedBefore = true;
  });
  subscriber = sub;
  return sub;
}

const whenReady = (r: Redis) => (r.status === 'ready' ? Promise.resolve() : new Promise<void>((res) => r.once('ready', () => res())));
let catchingUp: Promise<void> | null = null;

/**
 * A connection came back: once BOTH are up (the catch-up requests subscribers send go out through
 * the publishing one), confirm every subscription and tell every subscriber it may have missed
 * messages. ioredis re-subscribes by itself; the explicit SUBSCRIBE makes sure that finished.
 */
function catchUpAfterReconnect(redis: Redis, sub: Redis): Promise<void> {
  if (catchingUp) return catchingUp;
  catchingUp = (async () => {
    await Promise.all([whenReady(redis), whenReady(sub)]);
    const names = [...channels.keys()];
    if (names.length) await sub.subscribe(...names);
    log(`pubsub: redis reconnected; ${names.length} channel(s) catching up`);
    notifyResubscribed([...channels.values()].flatMap((s) => [...s]));
  })()
    .catch((err) => logThrottled('pubsub: could not re-subscribe after reconnecting', err))
    .finally(() => (catchingUp = null));
  return catchingUp;
}

export function subscribe(channel: string, s: Subscriber): Subscription {
  let subs = channels.get(channel);
  if (!subs) channels.set(channel, (subs = new Set()));
  subs.add(s);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const set = channels.get(channel);
    if (!set?.delete(s) || set.size > 0) return;
    channels.delete(channel);
    subscriber?.unsubscribe(channel).catch((err) => logThrottled(`pubsub: could not unsubscribe from ${channel}`, err));
  };

  const redis = getRedis();
  if (!redis) return { ready: Promise.resolve(true), close };
  const sub = subscriberFor(redis);
  // Issued for every subscriber (idempotent in Redis), so each learns when it is really active.
  const confirmed = sub.subscribe(channel).then(
    () => true,
    (err) => {
      logThrottled(`pubsub: could not subscribe to ${channel}`, err);
      return false;
    },
  );
  let timedOut = false;
  const ready = Promise.race([
    confirmed,
    new Promise<boolean>((r) =>
      setTimeout(() => {
        timedOut = true;
        r(false);
      }, SUBSCRIBE_TIMEOUT_MS).unref(),
    ),
  ]);
  // Confirmed only after the caller gave up waiting: it may have missed messages meanwhile.
  void confirmed.then((ok) => {
    if (ok && timedOut && !closed) notifyResubscribed([s]);
  });
  return { ready, close };
}

/** Fire and forget: a message that cannot be sent is logged (subscribers resync on reconnect). */
export function publish(channel: string, data: Uint8Array): void {
  const redis = getRedis();
  if (!redis) {
    const copy = data.slice();
    queueMicrotask(() => deliver(channel, copy));
    return;
  }
  redis
    .publish(channel, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    .catch((err) => logThrottled(`pubsub: could not publish to ${channel}`, err));
}

/** True when messages reach other instances (Redis), false when in-process only. */
export function isShared(): boolean {
  return getRedis() !== null;
}

export async function closePubSub(): Promise<void> {
  const sub = subscriber;
  subscriber = null;
  channels.clear();
  if (sub) await sub.quit().catch(() => sub.disconnect());
}
