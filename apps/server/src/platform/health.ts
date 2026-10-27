// Liveness (/healthz: the process answers) and readiness (/readyz: every dependency registered with
// addReadinessCheck answers, and we are not draining for shutdown).
import type { RequestHandler } from 'express';
import { logger } from './log';

type Check = () => Promise<void>;

const checks = new Map<string, Check>();
let draining = false;

const CHECK_TIMEOUT_MS = 3000;

export function addReadinessCheck(name: string, fn: Check): void {
  checks.set(name, fn);
}

/** From now on /readyz answers 503 so load balancers stop sending new traffic. */
export function markDraining(): void {
  draining = true;
}

async function runCheck(fn: Check): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS);
      }),
    ]);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }
}

export async function readiness(): Promise<{ ok: boolean; checks: Record<string, string> }> {
  const names = [...checks.keys()];
  const errors = await Promise.all(names.map((n) => runCheck(checks.get(n)!)));
  const out: Record<string, string> = {};
  // Details go to the log, not the (possibly public) response.
  names.forEach((n, i) => {
    out[n] = errors[i] === null ? 'ok' : 'error';
    if (errors[i] !== null) logger.warn({ check: n, error: errors[i] }, 'readiness check failed');
  });
  if (draining) out.shutdown = 'draining';
  return { ok: !draining && errors.every((e) => e === null), checks: out };
}

export function healthRoutes(): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/healthz') {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true });
      return;
    }
    if (req.path === '/readyz') {
      readiness()
        .then(({ ok, checks: result }) => {
          res.setHeader('Cache-Control', 'no-store');
          res.status(ok ? 200 : 503).json({ ok, checks: result });
        })
        .catch(next);
      return;
    }
    next();
  };
}
