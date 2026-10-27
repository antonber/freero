// Fixed-window rate limits. Backed by Redis when REDIS_URL is set (shared by every instance),
// in-process memory otherwise. Limits come from config (RATE_LIMIT_<NAME>, see configuration.md).
//
//   router.post('/auth/login', rateLimit('login'), …)                      per client IP
//   router.post('/boards', requireUser, rateLimit('boardCreate', 'user'), …) per user (after auth)
//   await consumeRateLimit('login', `email:${email}`)                     anything else (throws 429)
import { createHmac } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { getConfig, type RateLimitName, type RateLimitRule } from './config';
import { HttpError } from './http';
import { logError } from './log';
import { rateLimited } from './metrics';
import { getRedis } from './redis';
import { requestUserId } from './requestContext';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

/** Process-local store; expired windows are swept lazily. */
export class MemoryStore implements RateLimitStore {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  async hit(key: string, windowMs: number, now: number) {
    if (now - this.lastSweep > 60_000) {
      this.lastSweep = now;
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return { count: w.count, resetAt: w.resetAt };
  }
}

const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

export class RedisStore implements RateLimitStore {
  constructor(private redis: Redis) {}
  async hit(key: string, windowMs: number, now: number) {
    const [count, ttl] = (await this.redis.eval(HIT_SCRIPT, 1, `freero:rl:${key}`, windowMs)) as [number, number];
    return { count, resetAt: now + (ttl > 0 ? ttl : windowMs) };
  }
}

export async function hitLimit(store: RateLimitStore, key: string, rule: NonNullable<RateLimitRule>, now = Date.now()): Promise<RateLimitResult> {
  const { count, resetAt } = await store.hit(key, rule.windowMs, now);
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

const memory = new MemoryStore();
let lastStoreError = 0;
let redisStore: { redis: Redis; store: RedisStore } | null = null;

function store(): RateLimitStore {
  const redis = getRedis();
  if (!redis) return memory;
  if (redisStore?.redis !== redis) redisStore = { redis, store: new RedisStore(redis) };
  return redisStore.store;
}

/** Keys may contain emails: hash them so Redis never holds personal data in clear text. */
function keyFor(name: RateLimitName, key: string): string {
  const digest = createHmac('sha256', getConfig().sessionSecret).update(key).digest('base64url').slice(0, 22);
  return `${name}:${digest}`;
}

/**
 * Counts one hit against `name` for `key`. Fails open (allows) if the store is unreachable: an
 * outage of Redis must not lock everybody out; it is logged and /readyz reports it.
 */
export async function checkRateLimit(name: RateLimitName, key: string): Promise<RateLimitResult> {
  const rule = getConfig().rateLimits[name];
  if (!rule) return { allowed: true, remaining: Infinity, retryAfter: 0 };
  try {
    const result = await hitLimit(store(), keyFor(name, key), rule);
    if (!result.allowed) rateLimited.inc({ limit: name });
    return result;
  } catch (e) {
    if (Date.now() - lastStoreError > 30_000) logError(`rate limit store unavailable; allowing requests until it is back (${name})`, e);
    lastStoreError = Date.now();
    return { allowed: true, remaining: 0, retryAfter: 0 };
  }
}

export class RateLimitError extends HttpError {
  constructor(readonly retryAfter: number) {
    super(429, `Too many requests. Please try again in ${retryAfter < 120 ? `${retryAfter} seconds` : `${Math.ceil(retryAfter / 60)} minutes`}.`);
  }
}

/** Like checkRateLimit, but throws a 429 RateLimitError (with Retry-After) when exceeded. */
export async function consumeRateLimit(name: RateLimitName, key: string): Promise<void> {
  const r = await checkRateLimit(name, key);
  if (!r.allowed) throw new RateLimitError(r.retryAfter);
}

/** The client address (X-Forwarded-For is honoured only as far as TRUST_PROXY allows). */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Express middleware. `by: 'ip'` (default) limits per client address; `'user'` per authenticated
 * user (mount after requireUser; falls back to the IP for anonymous requests).
 */
export function rateLimit(name: RateLimitName, by: 'ip' | 'user' = 'ip'): RequestHandler {
  return (req, res, next) => {
    const user = by === 'user' ? requestUserId(req) : null;
    const key = user ? `user:${user}` : `ip:${clientIp(req)}`;
    checkRateLimit(name, key)
      .then((r) => {
        if (r.allowed) return next();
        next(new RateLimitError(r.retryAfter));
      })
      .catch(next);
  };
}
