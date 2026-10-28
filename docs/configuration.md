# Configuration

Freero is configured only through environment variables, read once at startup by
`apps/server/src/platform/config.ts`. Invalid values (a malformed URL, a non-numeric port, a bad
rate-limit rule) stop the server in every environment. With `NODE_ENV=production`, missing required
variables stop it too, and the error lists **every** problem at once:

```
Invalid configuration:
  - DATABASE_URL is required in production
  - SESSION_SECRET is required in production
  - S3_ENDPOINT must be a http:// or https:// URL
See docs/configuration.md.
```

Every external service is optional and has a local fallback, so `npm run dev` needs nothing
installed. Copy [`.env.example`](../.env.example) as a starting point.

## Core

| Variable | Default | Required in prod | Description |
|---|---|---|---|
| `NODE_ENV` | — | — | `production` enables production checks, `Secure` cookies behind TLS, and disables the demo user. |
| `PORT` | `4000` | | HTTP + WebSocket port. |
| `PUBLIC_URL` | — | **yes** | The external origin users open, e.g. `https://whiteboard.example.com`. Used for CSRF origin checks (and links in emails, phase 2). Only the origin part is kept. |
| `SESSION_SECRET` | dev-only value | **yes** | ≥ 32 random characters (`openssl rand -base64 48`). Keys server-side HMACs (rate-limit keys, signed links) and encrypts two-step verification secrets at rest. Rotate it with `SESSION_SECRET_PREVIOUS` (see [operations.md](operations.md#rotating-session_secret)): sessions are unaffected either way, but without the previous secret every authenticator app enrolled before the rotation stops matching. |
| `SESSION_SECRET_PREVIOUS` | — | | During a rotation: the secret(s) `SESSION_SECRET` replaced, comma-separated, newest first (each ≥ 32 characters). Values made with them are still accepted; two-step verification secrets are sealed again under the current secret on their next use and by a job (at startup, then hourly) that logs when it is done. Remove it once the log says so. |
| `TRUST_PROXY` | `false` | when behind a proxy | How far to trust `X-Forwarded-For/-Proto/-Host`. `1` = one reverse proxy in front (Caddy, nginx, a cloud load balancer); `2` = CDN + LB; or a list of subnets (`loopback, 10.0.0.0/8`). `true` trusts any hop — only if the app is unreachable except through the proxy. Needed for real client IPs (rate limits, logs), HSTS and `Secure` cookies behind TLS. |
| `FREERO_DATA_DIR` | `./data` | | Local data: the PGlite database (when `DATABASE_URL` is unset), local uploads (when `S3_*` is unset). The Docker image uses `/data`. |
| `FREERO_ENV` | `NODE_ENV` | | Environment name on logs and error reports (`production`, `staging`, …). |
| `FREERO_RELEASE` | — | | Release/version tag on logs and error reports (e.g. the git SHA). |
| `FREERO_WEB_DIST` | `apps/web/dist` | | Built web app to serve. |
| `FREERO_DOC_IDLE_MS` | `30000` | | Idle time before a board without connections is unloaded from memory. |
| `FREERO_SNAPSHOT_EVERY_MS` | `1800000` | | Automatic versions (version history): a board that changed gets one at most this often, also while people keep it open. Retention thins old ones. |
| `SHUTDOWN_DRAIN_SECONDS` | `5` in prod, else `0` | | On SIGTERM, `/readyz` answers 503 for this long before connections close, so load balancers stop routing to the instance first. |

## Database

| Variable | Default | Required in prod | Description |
|---|---|---|---|
| `DATABASE_URL` | — | **yes** | `postgres://user:password@host:5432/db` (add `?sslmode=require` for managed Postgres). Unset: PGlite (in-process Postgres) under `FREERO_DATA_DIR/pg`, single process only. |
| `DATABASE_POOL_MAX` | `10` | | Max Postgres connections per app instance. Keep `instances × pool` below the server's `max_connections`. |

Migrations run automatically at startup (see [deployment.md](deployment.md#migrations)).

## Redis

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | — | `redis://host:6379` or `rediss://` (TLS). Shares rate-limit counters across instances and fans realtime board edits, presence, access changes and logouts out to every instance (pub/sub on `freero:rt:*` channels; nothing is stored), so any instance can serve any board. **Required for more than one instance.** Unset: in-process (one instance). If Redis goes down, rate limits fail open (logged), collaborators on different instances stop seeing each other's live edits until it is back (they resync then; nothing is lost) and `/readyz` reports `redis: error`. |

## Object storage (uploads and board thumbnails)

All-or-nothing: set at least `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, or none.
Without them, files are stored under `FREERO_DATA_DIR/uploads`.

| Variable | Default | Description |
|---|---|---|
| `S3_ENDPOINT` | AWS | Custom endpoint for MinIO, Cloudflare R2, GCS interop, Backblaze B2, DigitalOcean Spaces… e.g. `http://minio:9000`. |
| `S3_BUCKET` | — | Bucket name. Objects are stored under `uploads/<id>.<ext>`. |
| `S3_REGION` | `us-east-1` | Region (`auto` for R2). |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Credentials with Get/Put/Delete on the bucket and HeadBucket (readiness). |
| `S3_FORCE_PATH_STYLE` | `true` with `S3_ENDPOINT`, else `false` | Path-style addressing (MinIO and most non-AWS providers need it). |
| `S3_PUBLIC_URL` | — | Optional public base URL of the bucket (or a CDN in front of it), e.g. `https://cdn.example.com`. When set, raster images (`/uploads/x.png`) are served by a 302 redirect to `<S3_PUBLIC_URL>/uploads/x.png`; the bucket must then allow public reads of `uploads/*` and answer CORS for your `PUBLIC_URL` (image export reads pixels). SVGs are always streamed through the app so they keep the sandbox CSP. Unset (default): every file is streamed through the app. |

**Serving model.** Board content always references files as `/uploads/<id>.<ext>`, independent of
the backend, so switching backends never rewrites boards. By default the app streams each file from
storage with `X-Content-Type-Options: nosniff`, a sandbox CSP and a one-year immutable cache header
(file names are random and never reused) — put a CDN in front of the app to offload the bandwidth.
When S3 is configured, a file missing from the bucket is looked up on the local disk, so files
uploaded before the switch keep working (copy them over with `mc mirror` / `aws s3 sync`, see
[operations.md](operations.md#moving-local-uploads-to-object-storage)).

## Email

| Variable | Default | Description |
|---|---|---|
| `SMTP_URL` | — | `smtp://user:pass@host:587` or `smtps://…:465`. Unset: development outbox — every message (verification, password reset, email change, invites, security notices) is written as JSON to `<FREERO_DATA_DIR>/outbox/` and logged. |
| `MAIL_FROM` | `Freero <no-reply@freero.local>` | Sender address. |

Links in emails point at `PUBLIC_URL` (in development: the origin the request came through).

## Accounts

| Variable | Default | Description |
|---|---|---|
| `ACCOUNT_DELETION_GRACE_DAYS` | `14` | After someone deletes their account, how long they can log in and restore it before it is purged (`0` = at the next purge run). |
| `ACCOUNT_PURGE_INTERVAL_SECONDS` | `3600` | How often each instance looks for accounts to purge. One instance purges at a time (Postgres advisory lock); a purge cut short is finished by the next run. |
| `TWO_FACTOR_UNDO_HOURS` | `72` | How long the "This wasn't me" button in the "two-step verification is on" notice works (1–336). Meanwhile whoever reads the account's address can remove that new authenticator, so keep it short. See ARCHITECTURE.md, "Two-step verification recovery". |
| `TWO_FACTOR_RECOVERY_DELAY_SECONDS` | `604800` (7 days) | How long a "lost my authenticator" recovery waits before the link that removes two-step verification is mailed. The owner is mailed at the start and a day before the end, and using the authenticator cancels it. At least `86400` in production; shorter only for tests. |

## Sign in with Google / Microsoft (OpenID Connect)

Each provider shows its "Continue with …" button only when **both** its client id and secret are
set (one without the other stops the server). Register this redirect URI with the provider:
`<PUBLIC_URL>/api/auth/oidc/<google|microsoft>/callback`. Freero uses the authorization code flow
with PKCE, state and nonce, and validates the id token (signature against the provider's keys,
issuer, audience, expiry).

| Variable | Default | Description |
|---|---|---|
| `OIDC_GOOGLE_CLIENT_ID` / `OIDC_GOOGLE_CLIENT_SECRET` | — | A Google Cloud "OAuth client ID" of type *Web application*. |
| `OIDC_GOOGLE_ISSUER` | `https://accounts.google.com` | Only change it for a test provider. |
| `OIDC_MICROSOFT_CLIENT_ID` / `OIDC_MICROSOFT_CLIENT_SECRET` | — | A Microsoft Entra app registration ("Accounts in any organizational directory and personal Microsoft accounts") with a client secret. |
| `OIDC_MICROSOFT_ISSUER` | `https://login.microsoftonline.com/common/v2.0` | Multi-tenant by default; `…/organizations/v2.0` (work/school only) or `…/<tenant-id>/v2.0` (one organization). |

Issuers must be `https://` in production (plain `http://` is accepted elsewhere for local test
providers, e.g. `node scripts/lib/mock-oidc.mjs`).

**Accounts.** A provider account (issuer + subject) signs in to the Freero account it is connected
to. On a first sign-in it is connected automatically only to the account whose email the provider
asserts as **verified** (`email_verified`; for Microsoft also the optional `xms_edov` claim — add it
under *Token configuration* so work accounts can match existing Freero accounts; Microsoft's plain
`email` claim is not proof of ownership). If that account has two-step verification on, it is
connected only after its second step. If the account's own address had never been confirmed, the
provider's verified sign-in proves it, and any password, sessions and pending email links of the
unconfirmed account are removed (so nobody who registered someone else's address keeps access).
An address the provider doesn't vouch for never matches an existing account; it can start a new one
that confirms its address by email. New accounts from a provider have no password until their
owner sets one in settings; an account always keeps at least one way to log in. Signed-in users
connect and disconnect providers in Account settings.

## GeoIP (approximate session locations)

| Variable | Default | Description |
|---|---|---|
| `GEOIP_DB_PATH` | — | Path to a MaxMind-format database, e.g. GeoLite2-City.mmdb or GeoLite2-Country.mmdb. With it, the signed-in devices list shows "City, Country" (or the country); without it, the masked network (`203.0.113.x`). Lookups are local and in memory: addresses are never sent anywhere. The file is not shipped with Freero (license): download it from MaxMind with a free account (or use another `.mmdb` provider such as DB-IP Lite) and refresh it periodically (MaxMind's `geoipupdate`); the server reads it at startup, so restart after an update. A missing or unreadable file stops the server. Behind a proxy, set `TRUST_PROXY` so the real client address is used. |

## Workspace single sign-on, provisioning and data exports

Single sign-on (SAML 2.0 / OpenID Connect), domains and SCIM provisioning are configured per team
workspace by its owners/admins in the app (admin console), not here. Data exports are built in
the background and stored as private files in the uploads storage (S3 or the data dir).

| Variable | Default | Description |
|---|---|---|
| `SSO_DNS_SERVERS` | — (system resolver) | Comma-separated DNS servers (`ip` or `ip:port`) asked for the `_freero-verification.<domain>` TXT records that verify a workspace's domain. Set it to use a specific resolver (e.g. an internal one, or `1.1.1.1` to avoid stale caches). There is no way to skip the lookup. |
| `DATA_EXPORT_TTL_HOURS` | `168` | How long a finished data export (personal or workspace ZIP) can be downloaded before its file is deleted. |
| `DATA_EXPORT_INTERVAL_SECONDS` | `15` | How often each instance looks for queued exports to build (one instance builds at a time; a new request also starts one right away). |

`PUBLIC_URL` must be set in production: the SAML entity ID, assertion consumer service URL, OIDC
redirect URI and SCIM base URL that workspaces give their identity provider are built from it.

## Notifications

| Variable | Default | Description |
|---|---|---|
| `NOTIFY_EMAIL_DELAY_SECONDS` | `900` | How long a notification (mention, reply, board shared with you) waits before it is emailed. Everything a person gets meanwhile goes out as one digest; what they read in the app by then is not emailed. Only verified addresses get these emails; each person turns them off per type in `/settings`, or all at once with the unsubscribe link. |
| `NOTIFY_EMAIL_INTERVAL_SECONDS` | `60` | How often each instance looks for digests that are due. One instance sends at a time (Postgres advisory lock). |
| `ACTIVITY_IDLE_SECONDS` | `60` | Activity feed: a person's changes on a board are gathered into one entry ("added 12 sticky notes") until they pause this long (or for 10 minutes at most). |

## Moderation (abuse reports and operators)

| Variable | Default | Description |
|---|---|---|
| `OPERATOR_EMAILS` | — | Comma-separated addresses of Freero's operators: they get the moderation queue at `/operator` and its API (everyone else gets 404 there). An account is an operator only while its address is listed AND verified, so someone who signs up with an operator's address gets nothing. Changing the list takes a restart (it is reviewed and deployed like any other configuration). Empty: reports are still collected, nobody can review them (logged at startup in production). See [operations.md](operations.md#moderation). |
| `ABUSE_CONTACT_EMAIL` | — | Where people reach whoever handles abuse: named in every moderation notice ("questions about this decision") and in `/.well-known/security.txt`. |
| `SECURITY_CONTACT` | `mailto:<ABUSE_CONTACT_EMAIL>` | RFC 9116 `Contact:` of `/.well-known/security.txt`, a `mailto:` or `https://` URL (your vulnerability disclosure address). With neither set, the file isn't served. |

## Observability

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` (`warn` under test) | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Logs are JSON lines on stdout (pino) with `reqId`, `userId`, `route`, `status`, `ms`. Cookies, authorization headers, passwords, tokens and secrets are redacted. |
| `METRICS_TOKEN` | — | Bearer token for `GET /metrics` on the public port (`Authorization: Bearer <token>`). |
| `METRICS_PORT` | — | Serve `/metrics` on this internal port instead (not on the public port at all). Don't publish it. |
| `ERROR_REPORTING_DSN` | — | Sentry-compatible DSN (`https://<key>@<host>/<project>`: Sentry, GlitchTip, …). 5xx errors, unhandled rejections and uncaught exceptions are reported (throttled per message). No SDK involved. |

In production, `/metrics` is served only when `METRICS_TOKEN` or `METRICS_PORT` is set. In
development it is open on the main port unless a token is set. `/healthz` and `/readyz` are always
public and reveal only `ok`/`error` per dependency (details go to the log).

## Limits and abuse protection

| Variable | Default | Description |
|---|---|---|
| `BODY_LIMIT_KB` | `2048` | Max JSON request body (board thumbnails are the largest). |
| `MAX_UPLOAD_MB` | `15` | Max size of one uploaded file. |
| `UPLOAD_QUOTA_MB` | `1024` | Total upload storage per account (board thumbnails don't count). Over quota: `413`. |
| `MAX_BOARDS_PER_USER` | `5000` | Boards one account may own, counted across ALL its workspaces (boards in the trash don't count). Over it, creating/duplicating/restoring/receiving a board by transfer answers `403`. |
| `MAX_TEMPLATES_PER_USER` | `500` | Saved templates one account may own. Over it, saving another answers `403`. |
| `MAX_WORKSPACES_PER_USER` | `20` | Team workspaces one account may own. Over it, creating another answers `403`. |
| `RATE_LIMITS` | — | `off` disables every rate limit (tests, load tests). |
| `RATE_LIMIT_API` | `1200/1m` | All `/api` requests, per client IP. |
| `RATE_LIMIT_LOGIN` | `30/5m` | Login attempts per client IP. |
| `RATE_LIMIT_LOGIN_ACCOUNT` | `10/15m` | Login attempts per account email, from any IP (slows credential stuffing against one account). |
| `RATE_LIMIT_SIGNUP` | `20/1h` | Signups per IP. |
| `RATE_LIMIT_PASSWORD` | `5/15m` | Password-reset requests per IP and per email; reset submissions per IP; password changes and account deletions per user. |
| `RATE_LIMIT_EMAIL_VERIFY` | `5/1h` | Verification re-sends and email-change requests per user. |
| `RATE_LIMIT_INVITE` | `60/1h` | Board invitations per user. |
| `RATE_LIMIT_ACCESS_REQUEST` | `20/1h` | Requests for access to boards per user. |
| `RATE_LIMIT_GUEST_JOIN` | `20/1h` | Visitors without an account joining shared boards as guests, per IP. |
| `RATE_LIMIT_UPLOAD` | `60/10m` | Uploads per user. |
| `RATE_LIMIT_REMOTE_IMAGE` | `200/10m` | Images the server fetches from a URL per user (copying a pasted image link to uploads, and including such images in exports). |
| `RATE_LIMIT_BOARD_CREATE` | `100/1h` | Board creations + duplications per user. |
| `RATE_LIMIT_TEMPLATE_SAVE` | `60/1h` | Saving a board or selection as a template, per user. |
| `RATE_LIMIT_VERSION` | `60/1h` | Naming or restoring a board version (each keeps a full copy of the board), per user. |
| `RATE_LIMIT_WS_CONNECT` | `200/1m` | WebSocket connections per IP and, separately, per user. |
| `RATE_LIMIT_TWO_FACTOR` | `10/15m` | Two-step verification codes: the sign-in second step per IP and per account (each pending sign-in also allows only 5 wrong codes), and turning it on/off or renewing recovery codes per user. |
| `RATE_LIMIT_TWO_FACTOR_RECOVERY` | `3/1d` | "Lost my authenticator" recoveries started, per IP and per account (each start mails the owner). |
| `RATE_LIMIT_AUDIT_EXPORT` | `20/1h` | Audit log exports per user (admin console; each reads up to 100,000 events). |
| `RATE_LIMIT_OIDC` | `60/10m` | "Sign in with …" starts and callbacks per IP. |
| `RATE_LIMIT_SSO` | `120/10m` | Workspace single sign-on per IP: discovery by email domain, starts, assertion posts and callbacks (and domain verification checks per user). |
| `RATE_LIMIT_SCIM` | `1200/1m` | SCIM requests per provisioning token (directories sync in bursts). `/scim/v2` also counts against `RATE_LIMIT_API` per IP. |
| `RATE_LIMIT_DATA_EXPORT` | `5/1d` | Data exports requested per user (personal or workspace). |
| `RATE_LIMIT_OUTLINE` | `120/1m` | Board outlines (`GET /api/boards/:id/outline`, the semantic read model) per user. |
| `RATE_LIMIT_STRUCTURE` | `60/10m` | Structure laid out into a board (`POST /api/boards/:id/insert-structure`) per user. |
| `RATE_LIMIT_REPORT` | `20/1h` | Abuse reports per IP and, separately, per signed-in user. |
| `RATE_LIMIT_APPEAL` | `10/1h` | Appeals against moderation decisions per IP. |

Rule format: `<count>/<window>` with the window in `s`, `m`, `h` or `d` and an optional multiplier
(`10/5m` = 10 per 5 minutes), or `off`. Windows are fixed (they reset `window` after the first hit).
Counters live in Redis when `REDIS_URL` is set (shared by all instances), in memory otherwise.
Exceeding a limit answers `429` with a `Retry-After` header (seconds); refused WebSocket upgrades
get an HTTP 429 the client retries with backoff.

## Security behaviour (not configurable)

- **Headers** on every response: a Content-Security-Policy (scripts only from the app's origin; styles
  and fonts from Google Fonts; images from the app, `data:`, `blob:` and `https:` for linked images;
  connections to the app, its WebSocket origin and `https:` for "paste an image URL";
  `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` on HTTPS
  requests (as seen through `TRUST_PROXY`).
- **CSRF**: the session cookie is `HttpOnly; SameSite=Lax` (and `Secure` in production behind
  HTTPS). Every POST/PUT/PATCH/DELETE whose `Origin` (or `Referer`) is not this site — or that a
  browser marks `Sec-Fetch-Site: cross-site` — is refused with `403`. WebSocket upgrades get the same
  origin check (against cross-site WebSocket hijacking). One reviewed exception: the SAML assertion
  consumer service (`POST /api/sso/<workspace>/saml/acs`), which the identity provider's page posts
  to from its own origin; the signed response is the credential, and the sign-in only completes on a
  same-site request from the browser that started it.
- **Security notices**: the account's address gets a short mail (no opt-out) when its password is
  changed, set or reset, its email address changes (to the previous address, with a 7-day "this
  wasn't me" link when that address was verified), two-step verification is turned on or off,
  recovery codes are regenerated, a sign-in provider is connected or disconnected, deletion is
  scheduled, or someone signs in from a browser that hasn't signed in to the account before (it has
  no matching `freero_device` cookie, a random HttpOnly id kept 400 days). Each says when, from which
  device and roughly where (GeoIP city/country when configured, else the masked network), never a
  code or secret.
- **Uploads**: type allow-list (PNG, JPEG, GIF, WebP, SVG), magic-byte sniffing, random names,
  `nosniff`, and `default-src 'none'; sandbox` CSP on every served file so an SVG can never run script.
