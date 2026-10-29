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
  | 'ai'
  | 'aiWorkspace'
  | 'apiCredential'
  | 'agentWrite'
  | 'oauthToken'
  | 'oauthRegister'
  | 'oauthClientMetadata'
  | 'linkPassword'
  | 'engage'
  | 'search'
  | 'trackerSend'
  | 'backup'
  | 'walkthroughComment'
  | 'slackUnfurl'
  | 'listingSubmit';

/** Issue-tracker sync (KAI-153; docs/trackers.md). */
export interface TrackersConfig {
  /** Trackers may be at private / loopback addresses (a self-hosted Jira Data Center on the LAN). */
  privateEndpoints: boolean;
  /** How often connections that poll (no webhooks) ask their tracker what changed. */
  pollMs: number;
  /** How often connections with webhooks poll anyway, to catch a delivery that never came. */
  fallbackPollMs: number;
  /** Jira Cloud OAuth 2.0 (3LO) app the operator registered at developer.atlassian.com, or null. */
  jiraOAuth: { clientId: string; clientSecret: string } | null;
  /** Atlassian's authorization server and API gateway (overridden only to test against a mock). */
  jiraAuthUrl: string;
  jiraApiUrl: string;
}

/** A model endpoint Freero calls for AI features (docs/ai.md). */
export interface AiProviderConfig {
  provider: 'anthropic' | 'openai';
  /** API root: https://api.anthropic.com, https://api.openai.com/v1, http://localhost:11434/v1 … */
  baseUrl: string;
  /** Empty for endpoints that need none (a local Ollama). */
  apiKey: string;
  model: string;
}

/** AI (KAI-101): off unless configured. */
export interface AiConfig {
  /** Freero's own provider (AI_PROVIDER …), or null. */
  instance: AiProviderConfig | null;
  /** Who may use the instance provider: boards in personal workspaces, team workspaces whose admins turn it on. */
  instanceFor: { personal: boolean; teams: boolean };
  /** Team admins may configure their workspace's own provider and key (AI_WORKSPACE_KEYS). */
  workspaceKeys: boolean;
  /** Workspace-configured endpoints may resolve to private / loopback addresses (self-hosted LAN models). */
  workspacePrivateEndpoints: boolean;
  /** Tokens per person per calendar month through the instance provider (0: no cap). */
  instanceMonthlyTokensPerUser: number;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Approximate tokens of board content one action may send. */
  maxInputTokens: number;
  /**
   * Speech-to-text model for walkthrough captions (KAI-133), called on the board's own AI
   * endpoint when that is OpenAI-compatible (`/audio/transcriptions`). Null: no AI transcripts.
   */
  transcribeModel: string | null;
}

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
  /**
   * Server-side encryption asked for on every object written (S3_SSE, KAI-143): SSE-S3 (`AES256`,
   * the bucket's own keys) or SSE-KMS (`aws:kms`, optionally with S3_SSE_KMS_KEY_ID). Null: whatever
   * the bucket's default encryption does.
   */
  sse: { mode: 'AES256' | 'aws:kms'; kmsKeyId: string | null } | null;
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
  /** Max size of a board backup file (`.freero`) made or restored (MAX_BACKUP_MB, KAI-137). */
  maxBackupBytes: number;
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
  ai: AiConfig;
  trackers: TrackersConfig;
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
  /**
   * The ChatGPT app directory's domain-verification token (OPENAI_APPS_CHALLENGE), served as plain
   * text at /.well-known/openai-apps-challenge while it is set; null: that path is a 404.
   */
  openaiAppsChallenge: string | null;
  /**
   * Development and tests only (refused in production, #81): an OAuth client may also be identified
   * by a client metadata document at a plain-http LOOPBACK address (`http://127.0.0.1:<port>/…`), the
   * loopback exception of draft-ietf-oauth-client-id-metadata-document §8.6. Off: https and public
   * addresses only.
   */
  oauthClientMetadataLoopback: boolean;
  /**
   * The marketing site (apps/site, served by modules/site). Off: `/` sends everyone to `/app`, no
   * marketing page is served and robots.txt keeps crawlers off the whole instance.
   */
  site: {
    enabled: boolean;
    /** The built site (`npm run build -w @freero/site`), served when it exists. */
    dist: string;
    /** An operator's privacy-friendly analytics script (https), added to marketing pages only; null = none. */
    analytics: { src: string; attrs: Record<string, string> } | null;
    /**
     * Who runs this service, for the legal pages (/privacy, /terms, /acceptable-use) and /support:
     * SITE_LEGAL_*. Until `operator` is set those pages say "Draft: not in effect" and are noindex,
     * and sign-up doesn't ask anyone to agree to them.
     */
    legal: {
      operator: string | null;
      contactEmail: string | null;
      address: string | null;
      jurisdiction: string | null;
      /** Who hosts the servers and where ("Railway Corp., US West"): the privacy policy's hosting provider. */
      hosting: string | null;
      /** A status page people can check when the service is down (https), for /support. */
      statusUrl: string | null;
    };
  };
  /**
   * A Jitsi deployment (https://meet.jit.si, or the operator's own) where boards may get a call
   * room of their own (KAI-134), or null: only meeting links people paste.
   */
  jitsiBaseUrl: string | null;
  /** The event stream (modules/events, KAI-150). */
  events: {
    /** A board's item and comment events wait until its saved content was quiet this long (a drag is one update). */
    settleMs: number;
    retentionDays: number;
  };
  /** Workspace webhooks (modules/webhooks, KAI-105). */
  webhooks: {
    /** Off: no endpoint can be added and nothing is delivered (the instance-wide switch). */
    enabled: boolean;
    /** Endpoints may be plain http and private / loopback addresses (receivers on the operator's own network). */
    privateEndpoints: boolean;
    timeoutMs: number;
    /** First retry delay; each further one is 4× longer, capped at 6 hours. */
    retryBaseMs: number;
    maxAttempts: number;
    /** Failed attempts in a row after which Freero turns an endpoint off (and tells who made it). */
    disableAfterFailures: number;
  };
  /**
   * Slack link unfurls (modules/slack, #88; docs/integrations/slack.md): the operator's Slack app.
   * Off (null) unless both its signing secret and its bot token are set.
   */
  slack: { signingSecret: string; botToken: string; apiUrl: string } | null;
  /**
   * Further https origins boards may frame as live embeds (KAI-127), besides the built-in providers
   * (`EMBED_PROVIDERS` in @freero/shared): a link on one of them is framed as given, sandboxed.
   * Added to the CSP `frame-src`.
   */
  embedExtraOrigins: string[];
  /**
   * Who may frame Freero's live board view (/embed/…, KAI-171): the AI assistants that show MCP
   * Apps, as CSP `frame-ancestors` sources (every ancestor must match: the host's sandbox origin
   * and its app). Empty: nobody (the live view then can't load anywhere).
   */
  appFrameAncestors: string[];
}

/** The MCP Apps hosts Freero's live board view runs in by default: Claude, ChatGPT, VS Code. */
export const DEFAULT_APP_FRAME_ANCESTORS = [
  'https://claude.ai',
  'https://*.claude.ai',
  'https://*.claudemcpcontent.com',
  'https://chatgpt.com',
  'https://*.chatgpt.com',
  'https://*.oaiusercontent.com',
  'vscode-webview:',
];

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
  ai: '20/10m', // per user: AI actions (each one calls a paid model)
  aiWorkspace: '300/1h', // per workspace: AI actions of all its people together
  apiCredential: '300/1m', // per API token / authorised app: every /api/v1 call and MCP request (KAI-104, KAI-107)
  agentWrite: '60/1m', // per API token / authorised app: changes it makes to boards (KAI-168), apart from the person's own editing
  oauthToken: '60/1m', // per IP: OAuth token and revocation requests
  oauthRegister: '20/1h', // per IP: OAuth apps registering themselves (dynamic client registration)
  oauthClientMetadata: '30/10m', // per user: OAuth client metadata documents fetched for the consent screen (cache misses only, #81)
  trackerSend: '60/10m', // per user: issues created or imported in a tracker (each calls the tracker's API)
  report: '20/1h', // abuse reports per IP and per signed-in user
  appeal: '10/1h', // appeals against moderation actions per IP
  linkPassword: '10/15m', // per IP and per board + person: attempts at a board link's password (KAI-145)
  engage: '120/1m', // per person or guest: answers, questions and upvotes in live activities (KAI-132)
  search: '120/1m', // per person (app) or credential (API, MCP): searches of board content (KAI-151)
  backup: '30/1h', // per user: board backups downloaded or restored (each reads or writes a whole board and its files, KAI-137)
  walkthroughComment: '120/10m', // per person: comments on walkthroughs (each may notify people, KAI-133)
  slackUnfurl: '50/1m', // per Slack workspace: link previews Freero posts there (chat.unfurl is Slack's tier 3, about 50 a minute; #88)
  listingSubmit: '5/1d', // per person: community listings submitted for review (each mails the operators, #87)
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
  ai: 'RATE_LIMIT_AI',
  aiWorkspace: 'RATE_LIMIT_AI_WORKSPACE',
  apiCredential: 'RATE_LIMIT_API_CREDENTIAL',
  agentWrite: 'RATE_LIMIT_AGENT_WRITE',
  oauthToken: 'RATE_LIMIT_OAUTH_TOKEN',
  oauthRegister: 'RATE_LIMIT_OAUTH_REGISTER',
  oauthClientMetadata: 'RATE_LIMIT_OAUTH_CLIENT_METADATA',
  trackerSend: 'RATE_LIMIT_TRACKER_SEND',
  report: 'RATE_LIMIT_REPORT',
  appeal: 'RATE_LIMIT_APPEAL',
  linkPassword: 'RATE_LIMIT_LINK_PASSWORD',
  engage: 'RATE_LIMIT_ENGAGE',
  search: 'RATE_LIMIT_SEARCH',
  backup: 'RATE_LIMIT_BACKUP',
  walkthroughComment: 'RATE_LIMIT_WALKTHROUGH_COMMENT',
  slackUnfurl: 'RATE_LIMIT_SLACK_UNFURL',
  listingSubmit: 'RATE_LIMIT_LISTING_SUBMIT',
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

  // SITE_ANALYTICS_SRC=https://…/script.js, SITE_ANALYTICS_ATTRS="domain=example.com,…" (data-* attributes).
  const analyticsSrc = url('SITE_ANALYTICS_SRC', ['https:']);
  const analyticsAttrs: Record<string, string> = {};
  for (const pair of (str('SITE_ANALYTICS_ATTRS') ?? '').split(',').filter((p) => p.trim())) {
    const i = pair.indexOf('=');
    const key = (i < 0 ? pair : pair.slice(0, i)).trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(key)) problems.push(`SITE_ANALYTICS_ATTRS: "${key}" is not a valid attribute name (letters, digits, -)`);
    else analyticsAttrs[key] = i < 0 ? '' : pair.slice(i + 1).trim();
  }
  const siteAnalytics = analyticsSrc ? { src: analyticsSrc, attrs: analyticsAttrs } : null;
  // The legal pages' operator and contacts (apps/site legal pages, modules/site): plain text, one line.
  const legalText = (name: string, max: number) => {
    const v = str(name);
    if (v !== null && (v.length > max || /[\r\n\t]/.test(v))) {
      problems.push(`${name} must be one line of at most ${max} characters`);
      return null;
    }
    return v;
  };
  const siteLegal = {
    operator: legalText('SITE_LEGAL_OPERATOR', 200),
    contactEmail: legalText('SITE_LEGAL_CONTACT_EMAIL', 320),
    address: legalText('SITE_LEGAL_ADDRESS', 400),
    jurisdiction: legalText('SITE_LEGAL_JURISDICTION', 200),
    hosting: legalText('SITE_LEGAL_HOSTING', 300),
    statusUrl: url('SITE_STATUS_URL', ['https:']),
  };
  if (siteLegal.contactEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(siteLegal.contactEmail)) problems.push('SITE_LEGAL_CONTACT_EMAIL must be an email address');

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
      sse: null,
    };
  }
  // Server-side encryption of every object written (KAI-143): only meaningful with S3.
  const sseRaw = str('S3_SSE');
  const kmsKeyId = str('S3_SSE_KMS_KEY_ID');
  if (sseRaw !== null || kmsKeyId !== null) {
    const mode = sseRaw === null ? null : sseRaw.toLowerCase() === 'aes256' ? 'AES256' : sseRaw.toLowerCase() === 'aws:kms' ? 'aws:kms' : undefined;
    if (mode === undefined) problems.push('S3_SSE must be AES256 or aws:kms');
    else if (!s3) problems.push('S3_SSE / S3_SSE_KMS_KEY_ID need object storage (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
    else if (kmsKeyId !== null && mode !== 'aws:kms') problems.push('S3_SSE_KMS_KEY_ID needs S3_SSE=aws:kms');
    else if (mode) s3.sse = { mode, kmsKeyId };
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
  // Live embeds (KAI-127): extra origins the operator lets boards frame. Origins only (no path),
  // https only, never this app's own origin (a framed page of ours would run with our cookies).
  const embedExtraOrigins: string[] = [];
  for (const v of (str('EMBED_EXTRA_ORIGINS') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    let u: URL | null = null;
    try {
      u = new URL(v);
    } catch {
      u = null;
    }
    if (!u || u.protocol !== 'https:' || !/^[a-z0-9.-]+$/i.test(u.hostname) || u.origin !== v.replace(/\/+$/, '') || u.username || u.password)
      problems.push(`EMBED_EXTRA_ORIGINS: "${v}" must be an https origin such as https://embed.example.com (no path)`);
    else if (publicUrl && u.origin === publicUrl) problems.push('EMBED_EXTRA_ORIGINS must not contain PUBLIC_URL (Freero never frames itself)');
    else if (!embedExtraOrigins.includes(u.origin)) embedExtraOrigins.push(u.origin);
  }
  // Live board views in AI assistants (KAI-171): https origins (a leading `*.` wildcard allowed),
  // http only for local testing (localhost / 127.0.0.1), or a bare scheme such as vscode-webview:.
  const appFrameAncestors: string[] = [];
  const ancestorsRaw = str('MCP_APP_FRAME_ANCESTORS');
  for (const v of ancestorsRaw === null ? DEFAULT_APP_FRAME_ANCESTORS : ancestorsRaw === 'none' ? [] : ancestorsRaw.split(/[\s,]+/).filter(Boolean)) {
    if (/^[a-z][a-z0-9+.-]*-webview:$/.test(v) || /^https:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v)) {
      if (!appFrameAncestors.includes(v)) appFrameAncestors.push(v);
    } else problems.push(`MCP_APP_FRAME_ANCESTORS: "${v}" must be an https origin (https://host or https://*.host), a local http origin, or a *-webview: scheme`);
  }
  let securityContact = str('SECURITY_CONTACT');
  if (securityContact !== null && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(securityContact)) {
    problems.push('SECURITY_CONTACT must be a mailto: or https:// URL');
    securityContact = null;
  }

  // AI (docs/ai.md): an instance provider only when AI_PROVIDER is set.
  let aiInstance: AiProviderConfig | null = null;
  const aiProvider = str('AI_PROVIDER')?.toLowerCase() ?? null;
  if (aiProvider !== null && aiProvider !== 'off') {
    if (aiProvider !== 'anthropic' && aiProvider !== 'openai') problems.push('AI_PROVIDER must be anthropic, openai (any OpenAI-compatible endpoint) or off');
    else {
      const baseUrl = (url('AI_BASE_URL', ['https:', 'http:']) ?? (aiProvider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')).replace(/\/+$/, '');
      const model = str('AI_MODEL') ?? (aiProvider === 'anthropic' ? 'claude-sonnet-5-5' : null);
      const apiKey = str('AI_API_KEY') ?? '';
      if (!model) problems.push('AI_MODEL is required with AI_PROVIDER=openai (the model id your endpoint serves)');
      if (!apiKey && str('AI_BASE_URL') === null) problems.push('AI_API_KEY is required for the provider’s public API (set AI_BASE_URL for a local endpoint without a key)');
      aiInstance = { provider: aiProvider, baseUrl, apiKey, model: model ?? '' };
    }
  }
  const aiFor = (str('AI_INSTANCE_FOR') ?? 'teams').toLowerCase().split(',').map((v) => v.trim()).filter(Boolean);
  if (aiFor.some((v) => !['personal', 'teams', 'none'].includes(v))) problems.push('AI_INSTANCE_FOR is a comma-separated list of personal, teams (or none)');
  const jiraClientId = str('TRACKER_JIRA_CLIENT_ID');
  const jiraClientSecret = str('TRACKER_JIRA_CLIENT_SECRET');
  if (!!jiraClientId !== !!jiraClientSecret) problems.push('TRACKER_JIRA_CLIENT_ID and TRACKER_JIRA_CLIENT_SECRET go together (the Jira Cloud OAuth app)');
  const trackers: TrackersConfig = {
    privateEndpoints: bool('TRACKER_PRIVATE_ENDPOINTS', false),
    pollMs: int('TRACKER_POLL_SECONDS', 60, 5, 86_400) * 1000,
    fallbackPollMs: int('TRACKER_FALLBACK_POLL_SECONDS', 900, 5, 7 * 86_400) * 1000,
    jiraOAuth: jiraClientId && jiraClientSecret ? { clientId: jiraClientId, clientSecret: jiraClientSecret } : null,
    jiraAuthUrl: (url('TRACKER_JIRA_AUTH_URL', ['https:', 'http:']) ?? 'https://auth.atlassian.com').replace(/\/+$/, ''),
    jiraApiUrl: (url('TRACKER_JIRA_API_URL', ['https:', 'http:']) ?? 'https://api.atlassian.com').replace(/\/+$/, ''),
  };
  // Slack link unfurls: both halves of the operator's Slack app, or off. One without the other is a
  // mistake worth saying out loud rather than a silently missing feature.
  const slackApp = () => {
    const signingSecret = str('SLACK_SIGNING_SECRET');
    const botToken = str('SLACK_BOT_TOKEN');
    if (!signingSecret !== !botToken) problems.push('SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN go together (Slack link unfurls need both)');
    if (botToken && !botToken.startsWith('xoxb-')) problems.push('SLACK_BOT_TOKEN must be the app’s bot token (xoxb-…)');
    const apiUrl = (url('SLACK_API_URL', ['https:', 'http:']) ?? 'https://slack.com/api').replace(/\/+$/, '');
    return signingSecret && botToken ? { signingSecret, botToken, apiUrl } : null;
  };
  const ai: AiConfig = {
    instance: aiInstance,
    instanceFor: { personal: aiFor.includes('personal'), teams: aiFor.includes('teams') },
    workspaceKeys: bool('AI_WORKSPACE_KEYS', false),
    workspacePrivateEndpoints: bool('AI_WORKSPACE_PRIVATE_ENDPOINTS', false),
    instanceMonthlyTokensPerUser: int('AI_INSTANCE_MONTHLY_TOKENS_PER_USER', 200_000, 0),
    maxOutputTokens: int('AI_MAX_OUTPUT_TOKENS', 4096, 256, 64_000),
    timeoutMs: int('AI_TIMEOUT_SECONDS', 90, 5, 600) * 1000,
    maxInputTokens: int('AI_MAX_INPUT_TOKENS', 12_000, 1000, 500_000),
    transcribeModel: str('AI_TRANSCRIBE_MODEL') ?? null,
  };

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
    maxBackupBytes: int('MAX_BACKUP_MB', 200, 1, 2048) * MB,
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
    ai,
    trackers,
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
    openaiAppsChallenge: str('OPENAI_APPS_CHALLENGE'),
    oauthClientMetadataLoopback: bool('OAUTH_CLIENT_METADATA_LOOPBACK', false),
    site: {
      enabled: bool('SITE', true),
      dist: path.resolve(env.FREERO_SITE_DIST || path.join(REPO_ROOT, 'apps/site/dist')),
      analytics: siteAnalytics,
      legal: siteLegal,
    },
    jitsiBaseUrl: url('JITSI_BASE_URL', ['https:'])?.replace(/\/+$/, '') ?? null,
    events: {
      settleMs: int('EVENTS_SETTLE_SECONDS', 3, 0, 600) * 1000,
      retentionDays: int('EVENTS_RETENTION_DAYS', 30, 1, 3650),
    },
    webhooks: {
      enabled: bool('WEBHOOKS', true),
      privateEndpoints: bool('WEBHOOK_PRIVATE_ENDPOINTS', false),
      timeoutMs: int('WEBHOOK_TIMEOUT_SECONDS', 10, 1, 60) * 1000,
      retryBaseMs: int('WEBHOOK_RETRY_BASE_MS', 10_000, 10, 3_600_000),
      maxAttempts: int('WEBHOOK_MAX_ATTEMPTS', 7, 1, 20),
      disableAfterFailures: int('WEBHOOK_DISABLE_AFTER_FAILURES', 15, 1, 1000),
    },
    slack: slackApp(),
    embedExtraOrigins,
    appFrameAncestors,
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
    if (config.oauthClientMetadataLoopback) problems.push('OAUTH_CLIENT_METADATA_LOOPBACK is for development and tests only: never set it in production');
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
