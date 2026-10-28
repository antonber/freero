// The one typed, validated configuration, read from the environment once by main.ts.
// Every variable is documented in docs/configuration.md (and .env.example). Invalid values fail in
// every environment; missing production requirements fail at startup with the full list.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RateLimitName =
  | 'api'
  | 'login'
  | 'loginAccount'
  | 'signup'
  | 'password'
  | 'emailVerify'
  | 'invite'
  | 'upload'
  | 'download'
  | 'remoteImage'
  | 'boardCreate'
  | 'templateSave'
  | 'version'
  | 'wsConnect'
  | 'twoFactor'
  | 'twoFactorRecovery'
  | 'auditExport'
  | 'oidc'
  | 'sso'
  | 'scim'
  | 'dataExport'
  | 'accessRequest'
  | 'guestJoin'
  | 'report'
  | 'appeal'
  | 'outline'
  | 'structure'
  | 'apiCredential'
  | 'agentWrite'
  | 'oauthToken'
  | 'oauthRegister';

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

/**
 * A "Sign in with …" provider: any OpenID Connect issuer (authorization code + PKCE). Google and
 * Microsoft are configured from OIDC_GOOGLE_* / OIDC_MICROSOFT_*; workspace SSO reuses the shape.
 */
export interface OidcProviderConfig {
  /** Stable id used in URLs and stored on identities ('google', 'microsoft'). */
  id: string;
  /** Shown on the button ("Continue with Google"). */
  label: string;
  /** Issuer URL; its /.well-known/openid-configuration is fetched on first use. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /**
   * Boolean id-token claims that, when true, count as the provider vouching for the email address
   * (besides the standard `email_verified`). Microsoft: `xms_edov` (an optional claim).
   */
  verifiedEmailClaims: string[];
}

/**
 * Local files (dev outbox, uploads) of a FREERO_DATA_DIR=memory process. Never just the pid: pids
 * are reused (quickly, on Windows), and a test reading the outbox of an earlier process with the
 * same pid found that run's mail to the same address and used its stale link.
 */
const MEMORY_FILES_DIR = path.join(os.tmpdir(), `freero-memory-${process.pid}-${randomBytes(6).toString('hex')}`);

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
  /** Automatic versions: at most one per board this often (while it is open, and at compaction). */
  snapshotEveryMs: number;
  /** A facilitator gone this long ends their facilitation session (realtime/facilitation.ts). */
  facilitatorGraceMs: number;
  databaseUrl: string | null;
  /** Max Postgres connections per process (DATABASE_POOL_MAX). */
  dbPoolMax: number;
  redisUrl: string | null;
  s3: S3Config | null;
  smtpUrl: string | null;
  mailFrom: string;
  /** The current secret: keys HMACs and seals data at rest (see platform/secrets.ts). */
  sessionSecret: string;
  /** Secrets it replaced (SESSION_SECRET_PREVIOUS), still accepted while a rotation settles. */
  sessionSecretsPrevious: string[];
  /** Express `trust proxy` setting (false = use the socket address, never X-Forwarded-*). */
  trustProxy: boolean | number | string;
  logLevel: string;
  metricsToken: string | null;
  /** When set, /metrics is served only on this (internal) port instead of the public one. */
  metricsPort: number | null;
  errorReportingDsn: string | null;
  bodyLimitBytes: number;
  maxUploadBytes: number;
  /** Max size of one video or audio upload (played on the board). */
  maxMediaUploadBytes: number;
  /** Max size of one other file (a downloadable file card). */
  maxAttachmentUploadBytes: number;
  uploadQuotaBytes: number;
  maxBoardsPerUser: number;
  maxTemplatesPerUser: number;
  maxWorkspacesPerUser: number;
  /** On SIGTERM, how long /readyz reports 503 before the server stops accepting connections. */
  shutdownDrainMs: number;
  /** How long a deleted account can still be restored before it is purged. */
  accountDeletionGraceMs: number;
  /** How often each instance looks for accounts due to be purged. */
  accountPurgeIntervalMs: number;
  /**
   * How often each instance re-checks the sessions of its open board and notification sockets
   * against the database, closing those whose session ended anywhere (CLI, SQL, expiry).
   */
  sessionRecheckMs: number;
  /**
   * How long a "lost my authenticator" recovery waits before two-step verification can be removed
   * (the owner is mailed at the start and before the end, and can cancel). At least a day in production.
   */
  twoFactorRecoveryDelayMs: number;
  /** How long the "this wasn't me" link of the two-step-on notice works. */
  twoFactorUndoMs: number;
  /**
   * How long a notification waits before it is emailed: everything a person got meanwhile goes out
   * as one digest, and what they read in the app by then is not emailed at all.
   */
  notifyEmailDelayMs: number;
  /** How often each instance looks for notification digests that are due. */
  notifyEmailIntervalMs: number;
  /** Activity feed: a person's burst of changes on a board ends after this long without one. */
  activityIdleMs: number;
  rateLimits: Record<RateLimitName, RateLimitRule>;
  /** Configured sign-in providers (each needs its client id AND secret); empty = password only. */
  oidcProviders: OidcProviderConfig[];
  /** A MaxMind-format (.mmdb) GeoLite2/GeoIP2 City or Country database for session locations, or null. */
  geoipDbPath: string | null;
  /**
   * DNS servers ("ip" or "ip:port") that domain verification for single sign-on asks for TXT
   * records; empty = the system resolver. Never skips the lookup.
   */
  ssoDnsServers: string[];
  /** How long a finished data export can be downloaded before its file is deleted. */
  dataExportTtlMs: number;
  /** How often each instance looks for data exports to build. */
  dataExportIntervalMs: number;
  /**
   * Operators (moderation queue and actions): lower-cased addresses. An account is an operator
   * only while its address is listed AND verified.
   */
  operatorEmails: string[];
  /**
   * How long the kept copy of a file an operator removed is kept for a possible restore before it
   * is deleted for good (KAI-179); never while a report or appeal about it is open. 0: at the next run.
   */
  moderationKeepRemovedMs: number;
  /** How often the kept-copy retention runs (one instance at a time). */
  moderationRetentionIntervalMs: number;
  /**
   * How long browsers and caches may reuse an uploaded file without asking again (KAI-177): what
   * bounds how long a file an operator removed keeps showing where it was already loaded.
   */
  uploadCacheSeconds: number;
  /** Where people (and the notices Freero sends) can reach the people handling abuse reports, or null. */
  abuseContactEmail: string | null;
  /** RFC 9116 `Contact:` for /.well-known/security.txt (mailto: or https: URL); defaults to the abuse contact. */
  securityContact: string | null;
  /**
   * The public REST API (/api/v1) and OAuth apps. Off: every API call and token request is refused
   * (the instance-wide kill switch for integrations and agents); tokens are kept.
   */
  publicApi: boolean;
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
  password: '5/15m', // per IP and per email (password reset / change, account deletion)
  emailVerify: '5/1h', // verification / email-change messages per user
  invite: '60/1h', // per user
  upload: '60/10m', // per user
  download: '300/10m', // per user or guest: files downloaded from boards (file cards, media)
  remoteImage: '200/10m', // per user: images the server fetches from a URL (import + export)
  boardCreate: '100/1h', // per user (create + duplicate)
  templateSave: '60/1h', // per user (saving a board or selection as a template)
  version: '60/1h', // per user (naming or restoring a board version: each keeps a full copy)
  wsConnect: '200/1m', // per IP and per user
  twoFactor: '10/15m', // two-factor codes per IP and per account (sign-in second step, enrolment, disabling)
  twoFactorRecovery: '3/1d', // "lost my authenticator" recoveries started, per IP and per account
  auditExport: '20/1h', // per user: audit log exports (each reads up to 100k events)
  oidc: '60/10m', // "Sign in with …" starts and callbacks per IP
  sso: '120/10m', // workspace single sign-on: discovery, starts, assertion posts and callbacks per IP
  scim: '1200/1m', // SCIM requests per provisioning token (Okta and Entra sync in bursts)
  dataExport: '5/1d', // data exports requested per user (each builds a ZIP of everything)
  accessRequest: '20/1h', // per user: asking for access to boards
  guestJoin: '20/1h', // per IP: visitors joining a shared board without an account
  outline: '120/1m', // per user: board outlines (each reads and walks the whole board)
  structure: '60/10m', // per user: structure laid out and inserted into a board (KAI-167)
  apiCredential: '300/1m', // per API token / authorised app: every /api/v1 call and MCP request (KAI-104, KAI-107)
  agentWrite: '60/1m', // per API token / authorised app: changes it makes to boards (KAI-168), apart from the person's own editing
  oauthToken: '60/1m', // per IP: OAuth token and revocation requests
  oauthRegister: '20/1h', // per IP: OAuth apps registering themselves (dynamic client registration)
  report: '20/1h', // abuse reports per IP and per signed-in user
  appeal: '10/1h', // appeals against moderation actions per IP
};

const ENV_NAME: Record<RateLimitName, string> = {
  api: 'RATE_LIMIT_API',
  login: 'RATE_LIMIT_LOGIN',
  loginAccount: 'RATE_LIMIT_LOGIN_ACCOUNT',
  signup: 'RATE_LIMIT_SIGNUP',
  password: 'RATE_LIMIT_PASSWORD',
  emailVerify: 'RATE_LIMIT_EMAIL_VERIFY',
  invite: 'RATE_LIMIT_INVITE',
  upload: 'RATE_LIMIT_UPLOAD',
  download: 'RATE_LIMIT_DOWNLOAD',
  remoteImage: 'RATE_LIMIT_REMOTE_IMAGE',
  boardCreate: 'RATE_LIMIT_BOARD_CREATE',
  templateSave: 'RATE_LIMIT_TEMPLATE_SAVE',
  version: 'RATE_LIMIT_VERSION',
  wsConnect: 'RATE_LIMIT_WS_CONNECT',
  twoFactor: 'RATE_LIMIT_TWO_FACTOR',
  twoFactorRecovery: 'RATE_LIMIT_TWO_FACTOR_RECOVERY',
  auditExport: 'RATE_LIMIT_AUDIT_EXPORT',
  oidc: 'RATE_LIMIT_OIDC',
  sso: 'RATE_LIMIT_SSO',
  scim: 'RATE_LIMIT_SCIM',
  dataExport: 'RATE_LIMIT_DATA_EXPORT',
  accessRequest: 'RATE_LIMIT_ACCESS_REQUEST',
  guestJoin: 'RATE_LIMIT_GUEST_JOIN',
  outline: 'RATE_LIMIT_OUTLINE',
  structure: 'RATE_LIMIT_STRUCTURE',
  apiCredential: 'RATE_LIMIT_API_CREDENTIAL',
  agentWrite: 'RATE_LIMIT_AGENT_WRITE',
  oauthToken: 'RATE_LIMIT_OAUTH_TOKEN',
  oauthRegister: 'RATE_LIMIT_OAUTH_REGISTER',
  report: 'RATE_LIMIT_REPORT',
  appeal: 'RATE_LIMIT_APPEAL',
};

/** The built-in providers: env prefix, button label, default issuer, extra verified-email claims. */
const OIDC_PROVIDERS = [
  { id: 'google', env: 'OIDC_GOOGLE', label: 'Google', issuer: 'https://accounts.google.com', verifiedEmailClaims: [] },
  {
    id: 'microsoft',
    env: 'OIDC_MICROSOFT',
    label: 'Microsoft',
    // Multi-tenant: work/school accounts of any organization and personal Microsoft accounts.
    issuer: 'https://login.microsoftonline.com/common/v2.0',
    verifiedEmailClaims: ['xms_edov'],
  },
] as const;

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
  // FREERO_DATA_DIR=memory: in-memory database (tests); local files go to a temp dir of this process.
  const memory = env.FREERO_DATA_DIR?.trim() === 'memory';
  const dataDir = memory
    ? MEMORY_FILES_DIR
    : path.resolve(env.FREERO_DATA_DIR || path.join(REPO_ROOT, 'data'));

  const publicUrlRaw = url('PUBLIC_URL', ['http:', 'https:']);
  const publicUrl = publicUrlRaw ? new URL(publicUrlRaw).origin : null;

  const sessionSecret = str('SESSION_SECRET');
  if (sessionSecret !== null && sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  // Comma-separated (a rotation can still be settling when the next one starts); newest first.
  const sessionSecretsPrevious = (str('SESSION_SECRET_PREVIOUS') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (sessionSecretsPrevious.some((v) => v.length < 32)) problems.push('SESSION_SECRET_PREVIOUS: each secret must be at least 32 characters');
  if (sessionSecret !== null && sessionSecretsPrevious.includes(sessionSecret))
    problems.push('SESSION_SECRET_PREVIOUS must not contain the current SESSION_SECRET');

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

  // Sign-in providers: client id and secret together, or neither (then the button is hidden).
  const oidcProviders: OidcProviderConfig[] = [];
  for (const p of OIDC_PROVIDERS) {
    const clientId = str(`${p.env}_CLIENT_ID`);
    const clientSecret = str(`${p.env}_CLIENT_SECRET`);
    if (!clientId && !clientSecret) continue;
    if (!clientId || !clientSecret) {
      problems.push(`${p.label} sign-in is partly configured: set both ${p.env}_CLIENT_ID and ${p.env}_CLIENT_SECRET`);
      continue;
    }
    // Plain http issuers only outside production (a local test identity provider).
    const issuer = url(`${p.env}_ISSUER`, production ? ['https:'] : ['https:', 'http:']) ?? p.issuer;
    oidcProviders.push({ id: p.id, label: p.label, issuer, clientId, clientSecret, verifiedEmailClaims: [...p.verifiedEmailClaims] });
  }

  const geoipDbPath = str('GEOIP_DB_PATH') === null ? null : path.resolve(str('GEOIP_DB_PATH')!);
  if (geoipDbPath !== null && !fs.existsSync(geoipDbPath))
    problems.push(`GEOIP_DB_PATH points to ${geoipDbPath}, which does not exist (download a GeoLite2 City or Country .mmdb there, or unset it)`);

  const metricsPort = str('METRICS_PORT') === null ? null : int('METRICS_PORT', 0, 1, 65535);

  const ssoDnsServers = (str('SSO_DNS_SERVERS') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const s of ssoDnsServers)
    if (!/^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])(:\d{1,5})?$|^[0-9a-fA-F:]+$/.test(s))
      problems.push(`SSO_DNS_SERVERS: "${s}" is not an IP address (optionally with :port)`);
  // Moderation (KAI-142): operators by address; the abuse / security contacts people see.
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const operatorEmails = (str('OPERATOR_EMAILS') ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  for (const e of operatorEmails) if (!EMAIL.test(e)) problems.push(`OPERATOR_EMAILS: "${e}" is not an email address`);
  const abuseContactEmail = str('ABUSE_CONTACT_EMAIL');
  if (abuseContactEmail !== null && !EMAIL.test(abuseContactEmail)) problems.push('ABUSE_CONTACT_EMAIL must be an email address');
  let securityContact = str('SECURITY_CONTACT');
  if (securityContact !== null && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(securityContact)) {
    problems.push('SECURITY_CONTACT must be a mailto: or https:// URL');
    securityContact = null;
  }

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
    snapshotEveryMs: int('FREERO_SNAPSHOT_EVERY_MS', 30 * 60_000, 100),
    facilitatorGraceMs: int('FREERO_FACILITATOR_GRACE_MS', 30_000, 100),
    databaseUrl: url('DATABASE_URL', ['postgres:', 'postgresql:']),
    dbPoolMax: int('DATABASE_POOL_MAX', 10, 1, 1000),
    redisUrl: url('REDIS_URL', ['redis:', 'rediss:']),
    s3,
    smtpUrl: url('SMTP_URL', ['smtp:', 'smtps:']),
    mailFrom: str('MAIL_FROM') ?? 'Freero <no-reply@freero.local>',
    sessionSecret: sessionSecret ?? DEV_SESSION_SECRET,
    sessionSecretsPrevious,
    trustProxy,
    logLevel,
    metricsToken: str('METRICS_TOKEN'),
    metricsPort,
    errorReportingDsn: url('ERROR_REPORTING_DSN', ['http:', 'https:']),
    bodyLimitBytes: int('BODY_LIMIT_KB', 2048, 16, 64 * 1024) * 1024,
    maxUploadBytes: int('MAX_UPLOAD_MB', 15, 1, 1024) * MB,
    maxMediaUploadBytes: int('MAX_MEDIA_UPLOAD_MB', 100, 1, 1024) * MB,
    maxAttachmentUploadBytes: int('MAX_ATTACHMENT_UPLOAD_MB', 50, 1, 1024) * MB,
    uploadQuotaBytes: int('UPLOAD_QUOTA_MB', 1024, 1) * MB,
    maxBoardsPerUser: int('MAX_BOARDS_PER_USER', 5000, 1),
    maxTemplatesPerUser: int('MAX_TEMPLATES_PER_USER', 500, 1),
    maxWorkspacesPerUser: int('MAX_WORKSPACES_PER_USER', 20, 1),
    shutdownDrainMs: int('SHUTDOWN_DRAIN_SECONDS', production ? 5 : 0, 0, 300) * 1000,
    accountDeletionGraceMs: int('ACCOUNT_DELETION_GRACE_DAYS', 14, 0, 365) * 86_400_000,
    accountPurgeIntervalMs: int('ACCOUNT_PURGE_INTERVAL_SECONDS', 3600, 1, 7 * 86_400) * 1000,
    sessionRecheckMs: int('SESSION_RECHECK_SECONDS', 60, 1, 3600) * 1000,
    // Shorter than a day only outside production (tests); see docs/configuration.md.
    twoFactorRecoveryDelayMs: int('TWO_FACTOR_RECOVERY_DELAY_SECONDS', 7 * 86_400, production ? 86_400 : 1, 90 * 86_400) * 1000,
    twoFactorUndoMs: int('TWO_FACTOR_UNDO_HOURS', 72, 1, 14 * 24) * 3_600_000,
    notifyEmailDelayMs: int('NOTIFY_EMAIL_DELAY_SECONDS', 900, 0, 7 * 86_400) * 1000,
    notifyEmailIntervalMs: int('NOTIFY_EMAIL_INTERVAL_SECONDS', 60, 1, 86_400) * 1000,
    activityIdleMs: int('ACTIVITY_IDLE_SECONDS', 60, 1, 3600) * 1000,
    rateLimits,
    oidcProviders,
    geoipDbPath,
    ssoDnsServers,
    dataExportTtlMs: int('DATA_EXPORT_TTL_HOURS', 168, 1, 24 * 90) * 3_600_000,
    dataExportIntervalMs: int('DATA_EXPORT_INTERVAL_SECONDS', 15, 1, 86_400) * 1000,
    operatorEmails,
    moderationKeepRemovedMs: int('MODERATION_KEEP_REMOVED_DAYS', 30, 0, 3650) * 86_400_000,
    moderationRetentionIntervalMs: int('MODERATION_RETENTION_INTERVAL_SECONDS', 3600, 1, 86_400) * 1000,
    uploadCacheSeconds: int('UPLOAD_CACHE_SECONDS', 3600, 0, 31_536_000),
    abuseContactEmail,
    securityContact: securityContact ?? (abuseContactEmail ? `mailto:${abuseContactEmail}` : null),
    publicApi: bool('PUBLIC_API', true),
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
