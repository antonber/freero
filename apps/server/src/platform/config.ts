// The one typed, validated configuration, read from the environment once by main.ts.
// Every variable is documented in docs/configuration.md (and .env.example). Invalid values fail in
// every environment; missing production requirements fail at startup with the full list.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RateLimitName =
  | 'api'
  | 'login'
  | 'loginAccount'
  | 'signup'
  | 'password'
  | 'invite'
  | 'upload'
  | 'boardCreate'
  | 'wsConnect';

/** `limit` hits per `windowMs`; `null` = not limited. */
export type RateLimitRule = { limit: number; windowMs: number } | null;

export interface S3Config {
  endpoint: string | null;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL of the bucket; when set, raster uploads are served by redirect to it. */
  publicUrl: string | null;
  forcePathStyle: boolean;
}

export interface Config {
  port: number;
  /** External origin users reach the app at (https://freero.example.com), or null in dev. */
  publicUrl: string | null;
  /** Root of the repository (used to locate apps/web/dist). */
  repoRoot: string;
  /** Directory holding local data (dev database, local uploads, dev outbox). */
  dataDir: string;
  /** PGlite directory used when DATABASE_URL is unset (<data>/pg), or 'memory' (FREERO_DATA_DIR=memory). */
  pgliteDir: string | 'memory';
  uploadsDir: string;
  /** Built web app, served when it exists. */
  webDist: string;
  production: boolean;
  /** Environment name for logs and error reports (production, staging, development, test). */
  environment: string;
  release: string | null;
  /** Idle time before an unused board doc is unloaded from memory. */
  docIdleMs: number;
  databaseUrl: string | null;
  /** Max Postgres connections per process (DATABASE_POOL_MAX). */
  dbPoolMax: number;
  redisUrl: string | null;
  s3: S3Config | null;
  smtpUrl: string | null;
  mailFrom: string;
  sessionSecret: string;
  /** Express `trust proxy` setting (false = use the socket address, never X-Forwarded-*). */
  trustProxy: boolean | number | string;
  logLevel: string;
  metricsToken: string | null;
  /** When set, /metrics is served only on this (internal) port instead of the public one. */
  metricsPort: number | null;
  errorReportingDsn: string | null;
  bodyLimitBytes: number;
  maxUploadBytes: number;
  uploadQuotaBytes: number;
  maxBoardsPerUser: number;
  /** On SIGTERM, how long /readyz reports 503 before the server stops accepting connections. */
  shutdownDrainMs: number;
  rateLimits: Record<RateLimitName, RateLimitRule>;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\nSee docs/configuration.md.`);
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
// platform -> src -> server -> apps -> repo
const REPO_ROOT = path.resolve(here, '../../../..');

const MB = 1024 * 1024;
const DEV_SESSION_SECRET = 'dev-only-insecure-session-secret-change-me!!';

const RATE_LIMIT_DEFAULTS: Record<RateLimitName, string> = {
  api: '1200/1m', // every /api request, per client IP
  login: '30/5m', // login attempts per client IP
  loginAccount: '10/15m', // login attempts per account email (from any IP)
  signup: '20/1h', // per IP
  password: '5/15m', // per IP and per email (password reset / change, phase 2)
  invite: '60/1h', // per user
  upload: '60/10m', // per user
  boardCreate: '100/1h', // per user (create + duplicate)
  wsConnect: '200/1m', // per IP and per user
};

const ENV_NAME: Record<RateLimitName, string> = {
  api: 'RATE_LIMIT_API',
  login: 'RATE_LIMIT_LOGIN',
  loginAccount: 'RATE_LIMIT_LOGIN_ACCOUNT',
  signup: 'RATE_LIMIT_SIGNUP',
  password: 'RATE_LIMIT_PASSWORD',
  invite: 'RATE_LIMIT_INVITE',
  upload: 'RATE_LIMIT_UPLOAD',
  boardCreate: 'RATE_LIMIT_BOARD_CREATE',
  wsConnect: 'RATE_LIMIT_WS_CONNECT',
};

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "10/5m" -> 10 per 5 minutes; "off" -> null. */
export function parseRateLimit(text: string): RateLimitRule | undefined {
  const t = text.trim().toLowerCase();
  if (t === 'off' || t === 'none' || t === '0') return null;
  const m = /^(\d+)\s*\/\s*(\d*)\s*(s|m|h|d)$/.exec(t);
  if (!m) return undefined;
  const limit = Number(m[1]);
  const windowMs = (m[2] ? Number(m[2]) : 1) * UNIT_MS[m[3]];
  return limit > 0 && windowMs > 0 ? { limit, windowMs } : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const str = (name: string): string | null => {
    const v = env[name]?.trim();
    return v ? v : null;
  };
  const int = (name: string, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const v = str(name);
    if (v === null) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name} must be an integer between ${min} and ${max} (got "${v}")`);
      return def;
    }
    return n;
  };
  const url = (name: string, protocols: string[]): string | null => {
    const v = str(name);
    if (v === null) return null;
    try {
      const u = new URL(v);
      if (!protocols.includes(u.protocol)) throw new Error();
      return v;
    } catch {
      problems.push(`${name} must be a ${protocols.map((p) => p.replace(':', '://')).join(' or ')} URL`);
      return null;
    }
  };
  const bool = (name: string, def: boolean): boolean => {
    const v = str(name)?.toLowerCase();
    if (v === undefined || v === null) return def;
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    problems.push(`${name} must be true or false (got "${v}")`);
    return def;
  };

  const production = env.NODE_ENV === 'production';
  const environment = str('FREERO_ENV') ?? (production ? 'production' : (env.NODE_ENV ?? 'development'));
  // FREERO_DATA_DIR=memory: in-memory database (tests); local files go to a temp dir.
  const memory = env.FREERO_DATA_DIR?.trim() === 'memory';
  const dataDir = memory
    ? path.join(os.tmpdir(), `freero-memory-${process.pid}`)
    : path.resolve(env.FREERO_DATA_DIR || path.join(REPO_ROOT, 'data'));

  const publicUrlRaw = url('PUBLIC_URL', ['http:', 'https:']);
  const publicUrl = publicUrlRaw ? new URL(publicUrlRaw).origin : null;

  const sessionSecret = str('SESSION_SECRET');
  if (sessionSecret !== null && sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');

  // TRUST_PROXY: false (default) | true | <hop count> | comma-separated subnets ("loopback, 10.0.0.0/8").
  let trustProxy: boolean | number | string = false;
  const tp = str('TRUST_PROXY');
  if (tp !== null) {
    if (/^(true|yes|on)$/i.test(tp)) trustProxy = true;
    else if (/^(false|no|off)$/i.test(tp)) trustProxy = false;
    else if (/^\d+$/.test(tp)) trustProxy = Number(tp);
    else trustProxy = tp;
  }

  const logLevel = (str('LOG_LEVEL') ?? (environment === 'test' ? 'warn' : 'info')).toLowerCase();
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel))
    problems.push('LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent');

  // Object storage: all-or-nothing.
  let s3: S3Config | null = null;
  const s3Vars = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'];
  if (s3Vars.some((v) => str(v) !== null)) {
    const missing = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((v) => str(v) === null);
    if (missing.length) problems.push(`object storage is partly configured: also set ${missing.join(', ')}`);
    const endpoint = url('S3_ENDPOINT', ['http:', 'https:']);
    s3 = {
      endpoint,
      bucket: str('S3_BUCKET') ?? '',
      region: str('S3_REGION') ?? 'us-east-1',
      accessKeyId: str('S3_ACCESS_KEY_ID') ?? '',
      secretAccessKey: str('S3_SECRET_ACCESS_KEY') ?? '',
      publicUrl: url('S3_PUBLIC_URL', ['http:', 'https:'])?.replace(/\/+$/, '') ?? null,
      // Custom endpoints (MinIO, R2, most non-AWS providers) want path-style addressing.
      forcePathStyle: bool('S3_FORCE_PATH_STYLE', endpoint !== null),
    };
  }

  const rateLimits = {} as Record<RateLimitName, RateLimitRule>;
  const allOff = str('RATE_LIMITS')?.toLowerCase() === 'off';
  for (const name of Object.keys(RATE_LIMIT_DEFAULTS) as RateLimitName[]) {
    const raw = str(ENV_NAME[name]) ?? RATE_LIMIT_DEFAULTS[name];
    const rule = parseRateLimit(raw);
    if (rule === undefined) problems.push(`${ENV_NAME[name]} must look like "10/5m" (count/window, s|m|h|d) or "off"`);
    rateLimits[name] = allOff ? null : (rule ?? parseRateLimit(RATE_LIMIT_DEFAULTS[name])!);
  }

  const metricsPort = str('METRICS_PORT') === null ? null : int('METRICS_PORT', 0, 1, 65535);

  const config: Config = {
    port: int('PORT', 4000, 0, 65535),
    publicUrl,
    repoRoot: REPO_ROOT,
    dataDir,
    pgliteDir: memory ? 'memory' : path.join(dataDir, 'pg'),
    uploadsDir: path.join(dataDir, 'uploads'),
    webDist: path.resolve(env.FREERO_WEB_DIST || path.join(REPO_ROOT, 'apps/web/dist')),
    production,
    environment,
    release: str('FREERO_RELEASE'),
    docIdleMs: int('FREERO_DOC_IDLE_MS', 30_000, 100),
    databaseUrl: url('DATABASE_URL', ['postgres:', 'postgresql:']),
    dbPoolMax: int('DATABASE_POOL_MAX', 10, 1, 1000),
    redisUrl: url('REDIS_URL', ['redis:', 'rediss:']),
    s3,
    smtpUrl: url('SMTP_URL', ['smtp:', 'smtps:']),
    mailFrom: str('MAIL_FROM') ?? 'Freero <no-reply@freero.local>',
    sessionSecret: sessionSecret ?? DEV_SESSION_SECRET,
    trustProxy,
    logLevel,
    metricsToken: str('METRICS_TOKEN'),
    metricsPort,
    errorReportingDsn: url('ERROR_REPORTING_DSN', ['http:', 'https:']),
    bodyLimitBytes: int('BODY_LIMIT_KB', 2048, 16, 64 * 1024) * 1024,
    maxUploadBytes: int('MAX_UPLOAD_MB', 15, 1, 1024) * MB,
    uploadQuotaBytes: int('UPLOAD_QUOTA_MB', 1024, 1) * MB,
    maxBoardsPerUser: int('MAX_BOARDS_PER_USER', 5000, 1),
    shutdownDrainMs: int('SHUTDOWN_DRAIN_SECONDS', production ? 5 : 0, 0, 300) * 1000,
    rateLimits,
  };

  if (production) {
    const missing = [
      ['DATABASE_URL', config.databaseUrl ?? str('DATABASE_URL')],
      ['PUBLIC_URL', config.publicUrl ?? str('PUBLIC_URL')],
      ['SESSION_SECRET', sessionSecret],
    ]
      .filter(([, v]) => v === null)
      .map(([k]) => `${k} is required in production`);
    problems.unshift(...missing);
  }
  if (problems.length) throw new ConfigError(problems);
  current = config;
  return config;
}

let current: Config | null = null;

/** The config loaded by the composition root. */
export function getConfig(): Config {
  if (!current) throw new Error('Config not loaded: call loadConfig() from main.ts first');
  return current;
}
