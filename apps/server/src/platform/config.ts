import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  /** Root of the repository (used to locate apps/web/dist). */
  repoRoot: string;
  /** Directory holding the SQLite database and uploaded files. */
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  /** Built web app, served when it exists. */
  webDist: string;
  production: boolean;
  /** Idle time before an unused board doc is unloaded from memory. */
  docIdleMs: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// platform -> src -> server -> apps -> repo
const REPO_ROOT = path.resolve(here, '../../../..');

let current: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.FREERO_DATA_DIR || path.join(REPO_ROOT, 'data'));
  current = {
    port: Number(env.PORT) || 4000,
    repoRoot: REPO_ROOT,
    dataDir,
    dbFile: path.join(dataDir, 'freero.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    webDist: path.join(REPO_ROOT, 'apps/web/dist'),
    production: env.NODE_ENV === 'production',
    docIdleMs: Number(env.FREERO_DOC_IDLE_MS) || 30_000,
  };
  return current;
}

/** The config loaded by the composition root. */
export function getConfig(): Config {
  if (!current) throw new Error('Config not loaded: call loadConfig() from main.ts first');
  return current;
}
