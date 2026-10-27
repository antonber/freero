// Process-level platform services, started and stopped by the composition root: logger, error
// reporting, Redis, object storage, the internal metrics port, readiness of the database, and the
// graceful-shutdown drain.
import type { Server } from 'node:http';
import type { Config } from './config';
import { pingDb } from './db';
import { initErrorReporting, reportError } from './errorReporting';
import { addReadinessCheck, markDraining } from './health';
import { configureLogger, log, logError } from './log';
import { startMetricsServer } from './metrics';
import { closeRedis, initRedis } from './redis';
import { initStorage } from './storage';

let metricsServer: Server | null = null;

/** Time allowed for closing sockets, flushing open boards and closing connections after the drain. */
const SHUTDOWN_TIMEOUT_MS = 20_000;

export function startPlatform(config: Config): void {
  configureLogger({ level: config.logLevel, environment: config.environment, release: config.release });
  initErrorReporting(config);
  addReadinessCheck('db', pingDb);
  initRedis(config);
  const store = initStorage(config);
  metricsServer = startMetricsServer(config);
  log(
    `platform: db=${config.databaseUrl ? 'postgres' : 'pglite'} redis=${config.redisUrl ? 'on' : 'off (in-process)'} ` +
      `storage=${store.kind}${config.s3 ? ` (bucket ${config.s3.bucket})` : ''} trustProxy=${String(config.trustProxy)}`,
  );

  process.on('unhandledRejection', (reason) => {
    logError('unhandled promise rejection', reason);
    reportError(reason);
  });
  process.on('uncaughtException', (err) => {
    logError('uncaught exception; exiting', err);
    reportError(err);
    // The process state is unknown now: give the report a moment, then let the orchestrator restart us.
    setTimeout(() => process.exit(1), 500);
  });
}

/**
 * First half of a graceful shutdown: /readyz turns 503 so the load balancer stops routing here,
 * then we wait SHUTDOWN_DRAIN_SECONDS before the caller closes listeners and flushes state.
 */
export async function drain(config: Config): Promise<void> {
  markDraining();
  // Watchdog: a shutdown step that never settles must not keep a dead instance around until the
  // orchestrator's SIGKILL; exit non-zero (logged) instead.
  setTimeout(() => {
    logError(`graceful shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS / 1000}s after draining; exiting`);
    process.exit(1);
  }, config.shutdownDrainMs + SHUTDOWN_TIMEOUT_MS).unref();
  if (config.shutdownDrainMs > 0) await new Promise((r) => setTimeout(r, config.shutdownDrainMs));
}

export async function stopPlatform(): Promise<void> {
  metricsServer?.close();
  await closeRedis();
}
