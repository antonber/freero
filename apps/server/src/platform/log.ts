// Structured JSON logs (pino). Every line logged while a request is handled carries its request id
// and, once authenticated, the user id (see requestContext.ts). Secrets are redacted by path.
import { format } from 'node:util';
import pino, { type Logger } from 'pino';
import { currentRequestContext } from './requestContext';

const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-metrics-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.secret',
  '*.sessionSecret',
  '*.secretAccessKey',
  'headers.cookie',
  'headers.authorization',
];

function create(level: string, base: Record<string, unknown>): Logger {
  return pino({
    level,
    base: { service: 'freero', ...base },
    redact: { paths: REDACT, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
      const ctx = currentRequestContext();
      return ctx ? { reqId: ctx.reqId, ...(ctx.userId ? { userId: ctx.userId } : {}) } : {};
    },
  });
}

export let logger: Logger = create(process.env.LOG_LEVEL?.toLowerCase() || 'info', {});

/** Called once by main.ts after the config is loaded. */
export function configureLogger(opts: { level: string; environment: string; release: string | null }): void {
  logger = create(opts.level, { env: opts.environment, ...(opts.release ? { release: opts.release } : {}) });
}

export function log(...args: unknown[]): void {
  logger.info(format(...args));
}

/** logError('what failed', err, ...more) — the error keeps its stack under `err`. */
export function logError(message: unknown, ...rest: unknown[]): void {
  const err = rest.find((r) => r instanceof Error);
  const others = rest.filter((r) => r !== err);
  logger.error(err ? { err } : {}, format(message, ...others));
}
