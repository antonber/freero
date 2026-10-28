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
| `SESSION_SECRET` | dev-only value | **yes** | ≥ 32 random characters (`openssl rand -base64 48`). Keys server-side HMACs (rate-limit keys today; OAuth state and 2FA secrets later). Rotating it resets rate-limit counters only; sessions survive. |
| `TRUST_PROXY` | `false` | when behind a proxy | How far to trust `X-Forwarded-For/-Proto/-Host`. `1` = one reverse proxy in front (Caddy, nginx, a cloud load balancer); `2` = CDN + LB; or a list of subnets (`loopback, 10.0.0.0/8`). `true` trusts any hop — only if the app is unreachable except through the proxy. Needed for real client IPs (rate limits, logs), HSTS and `Secure` cookies behind TLS. |
| `FREERO_DATA_DIR` | `./data` | | Local data: the PGlite database (when `DATABASE_URL` is unset), local uploads (when `S3_*` is unset). The Docker image uses `/data`. |
| `FREERO_ENV` | `NODE_ENV` | | Environment name on logs and error reports (`production`, `staging`, …). |
| `FREERO_RELEASE` | — | | Release/version tag on logs and error reports (e.g. the git SHA). |
| `FREERO_WEB_DIST` | `apps/web/dist` | | Built web app to serve. |
| `FREERO_DOC_IDLE_MS` | `30000` | | Idle time before a board without connections is unloaded from memory. |
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
| `SMTP_URL` | — | `smtp://user:pass@host:587` or `smtps://…:465`. Unset: development outbox — every message (verification, password reset, email change, invites, deletion notices) is written as JSON to `<FREERO_DATA_DIR>/outbox/` and logged. |
| `MAIL_FROM` | `Freero <no-reply@freero.local>` | Sender address. |

Links in emails point at `PUBLIC_URL` (in development: the origin the request came through).

## Accounts

| Variable | Default | Description |
|---|---|---|
| `ACCOUNT_DELETION_GRACE_DAYS` | `14` | After someone deletes their account, how long they can log in and restore it before it is purged (`0` = at the next purge run). |
| `ACCOUNT_PURGE_INTERVAL_SECONDS` | `3600` | How often each instance looks for accounts to purge. One instance purges at a time (Postgres advisory lock); a purge cut short is finished by the next run. |

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
| `MAX_BOARDS_PER_USER` | `5000` | Boards one account may own (boards in the trash don't count). Over it, creating/duplicating/restoring answers `403`. |
| `MAX_TEMPLATES_PER_USER` | `500` | Saved templates one account may own. Over it, saving another answers `403`. |
| `RATE_LIMITS` | — | `off` disables every rate limit (tests, load tests). |
| `RATE_LIMIT_API` | `1200/1m` | All `/api` requests, per client IP. |
| `RATE_LIMIT_LOGIN` | `30/5m` | Login attempts per client IP. |
| `RATE_LIMIT_LOGIN_ACCOUNT` | `10/15m` | Login attempts per account email, from any IP (slows credential stuffing against one account). |
| `RATE_LIMIT_SIGNUP` | `20/1h` | Signups per IP. |
| `RATE_LIMIT_PASSWORD` | `5/15m` | Password-reset requests per IP and per email; reset submissions per IP; password changes and account deletions per user. |
| `RATE_LIMIT_EMAIL_VERIFY` | `5/1h` | Verification re-sends and email-change requests per user. |
| `RATE_LIMIT_INVITE` | `60/1h` | Board invitations per user. |
| `RATE_LIMIT_UPLOAD` | `60/10m` | Uploads per user. |
| `RATE_LIMIT_REMOTE_IMAGE` | `200/10m` | Images the server fetches from a URL per user (copying a pasted image link to uploads, and including such images in exports). |
| `RATE_LIMIT_BOARD_CREATE` | `100/1h` | Board creations + duplications per user. |
| `RATE_LIMIT_TEMPLATE_SAVE` | `60/1h` | Saving a board or selection as a template, per user. |
| `RATE_LIMIT_WS_CONNECT` | `200/1m` | WebSocket connections per IP and, separately, per user. |

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
  origin check (against cross-site WebSocket hijacking).
- **Uploads**: type allow-list (PNG, JPEG, GIF, WebP, SVG), magic-byte sniffing, random names,
  `nosniff`, and `default-src 'none'; sandbox` CSP on every served file so an SVG can never run script.
