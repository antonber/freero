import type { Config } from './config';
import { logError } from './log';
import { mailSettled } from './mail';

/** Passed to every module's reserved files (routes.ts, ws.ts, init.ts). */
export interface ServerContext {
  config: Config;
  /** Register work to run on graceful shutdown (SIGINT/SIGTERM), e.g. flushing in-memory state. */
  onShutdown(fn: () => void | Promise<void>): void;
}

/**
 * How long a shutdown waits for mail queued with sendMailLater (notices, appeal links, alerts kept
 * only in memory) after the hooks ran. Within the watchdog in platform/runtime.ts.
 */
const MAIL_WAIT_MS = 5_000;

export function createContext(config: Config): ServerContext & { shutdown(): Promise<void> } {
  const hooks: Array<() => void | Promise<void>> = [];
  return {
    config,
    onShutdown: (fn) => void hooks.push(fn),
    /** Runs the hooks (last registered first), then lets queued mail go out. The caller closes the database after. */
    async shutdown() {
      for (const fn of [...hooks].reverse()) {
        try {
          await fn();
        } catch (e) {
          logError('shutdown hook failed', e);
        }
      }
      await mailSettled(MAIL_WAIT_MS);
    },
  };
}
