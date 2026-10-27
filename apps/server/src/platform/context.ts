import type { Config } from './config';
import { logError } from './log';

/** Passed to every module's reserved files (routes.ts, ws.ts, init.ts). */
export interface ServerContext {
  config: Config;
  /** Register work to run on graceful shutdown (SIGINT/SIGTERM), e.g. flushing in-memory state. */
  onShutdown(fn: () => void | Promise<void>): void;
}

export function createContext(config: Config): ServerContext & { shutdown(): Promise<void> } {
  const hooks: Array<() => void | Promise<void>> = [];
  return {
    config,
    onShutdown: (fn) => void hooks.push(fn),
    async shutdown() {
      for (const fn of [...hooks].reverse()) {
        try {
          await fn();
        } catch (e) {
          logError('shutdown hook failed', e);
        }
      }
    },
  };
}
