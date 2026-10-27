// The shared Redis connection (REDIS_URL). Null when Redis is not configured: every user of it has
// an in-process fallback (rate limits today; realtime fan-out next).
import { Redis } from 'ioredis';
import type { Config } from './config';
import { addReadinessCheck } from './health';
import { logError } from './log';

let client: Redis | null = null;

export function initRedis(config: Config): Redis | null {
  if (!config.redisUrl) return null;
  client = new Redis(config.redisUrl, {
    lazyConnect: false,
    enableOfflineQueue: false, // fail fast instead of piling commands up while Redis is down
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  let lastError = 0;
  client.on('error', (err) => {
    if (Date.now() - lastError > 30_000) logError('redis error', err);
    lastError = Date.now();
  });
  addReadinessCheck('redis', async () => {
    if ((await client!.ping()) !== 'PONG') throw new Error('unexpected PING reply');
  });
  return client;
}

export function getRedis(): Redis | null {
  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await c.quit().catch(() => c.disconnect());
}
