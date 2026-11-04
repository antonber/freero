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
| `PREVIOUS_PUBLIC_URLS` | — | no | Other origins that should send people to `PUBLIC_URL`, comma-separated: where the instance answered before a domain move, or a `www.` name (`https://old.example.com,https://www.example.com`). Pages opened there redirect (301) to the same path at `PUBLIC_URL`; POSTs (tracker webhooks, API clients) are still served there until repointed; links to them in saved content still count as Freero links. MCP clients must reconnect at the new address. |
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
| `S3_SSE` | — | Server-side encryption asked for on every object Freero writes (KAI-143): `AES256` (SSE-S3, the provider's keys) or `aws:kms` (SSE-KMS). Needs `S3_*`. Unset: whatever the bucket's default encryption does — at startup Freero logs a warning when the bucket says it has none. See docs/deployment.md, "Encryption at rest". |
| `S3_SSE_KMS_KEY_ID` | — | With `S3_SSE=aws:kms`: the KMS key (id, ARN or alias) to encrypt with; unset uses the account's default `aws/s3` key. The credentials then need `kms:GenerateDataKey` and `kms:Decrypt` on it. |

**Serving model.** Board content always references files as `/uploads/<id>.<ext>`, independent of
the backend, so switching backends never rewrites boards. By default the app streams each file from
storage with `X-Content-Type-Options: nosniff`, a sandbox CSP, `Cache-Control: public, max-age=<UPLOAD_CACHE_SECONDS>`
and the file name as its ETag (names are random and never reused, so revalidating costs a 304) —
put a CDN in front of the app to offload the bandwidth. The short lifetime instead of a year is
what makes a file an operator removed stop showing where it was already loaded (operations.md).
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
| `SIGNUPS` | `open` | Who may create an account on this server. `open`: anyone. `invite-only`: an address with a live board or workspace invite, at one of `SIGNUP_DOMAINS`, at a domain a workspace here verified with "Add new sign-ups" on, or an operator's (`OPERATOR_EMAILS`); applies to signup with a password and to a first sign-in with Google / Microsoft. Accounts a workspace's own identity provider or directory makes (SSO, SCIM) are vouched for by a workspace that proved the domain, so they pass. Everyone else is told the server is by invitation. |
| `SIGNUP_DOMAINS` | — | Comma-separated domains (`example.com`) whose addresses may always sign up on an `invite-only` server (your own organization's). |
| `ACCOUNT_DELETION_GRACE_DAYS` | `14` | After someone deletes their account, how long they can log in and restore it before it is purged (`0` = at the next purge run). |
| `ACCOUNT_PURGE_INTERVAL_SECONDS` | `3600` | How often each instance looks for accounts to purge. One instance purges at a time (Postgres advisory lock); a purge cut short is finished by the next run. |
| `SESSION_RECHECK_SECONDS` | `60` | How often each instance re-checks the sessions behind its open board and notification sockets against the database and closes those whose session is gone (deleted by the admin CLI or SQL, expired, account suspended). Sessions ended through the app close their sockets at once; this bounds the delay for everything else. |
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
| `PROBLEM_RETENTION_DAYS` | `90` | How long a problem report (“Report a problem”: the note, the screenshot, the diagnostics) is kept after an operator closed it (fixed, won't fix or duplicate). Then the retention job (every `MODERATION_RETENTION_INTERVAL_SECONDS`) deletes the report and its screenshot. Reopening a report stops the clock; open reports are kept until closed; a person's reports are deleted with their account. Shown in the privacy policy. `0`: at the next run. See [operations.md](operations.md#problem-reports-report-a-problem). |
| `MODERATION_KEEP_REMOVED_DAYS` | `30` | How long the kept copy of a file an operator removed stays restorable. After that the retention job deletes it for good (recorded as an automatic "delete kept copy" action); never while a report or appeal about the file is open. The file's URL keeps answering 410 either way. `0`: at the next run. |
| `MODERATION_RETENTION_INTERVAL_SECONDS` | `3600` | How often that retention runs (one instance at a time). |
| `ABUSE_CONTACT_EMAIL` | — | Where people reach whoever handles abuse: named in every moderation notice ("questions about this decision") and in `/.well-known/security.txt`. |
| `SECURITY_CONTACT` | `mailto:<ABUSE_CONTACT_EMAIL>` | RFC 9116 `Contact:` of `/.well-known/security.txt`, a `mailto:` or `https://` URL (your vulnerability disclosure address). With neither set, the file isn't served. |

## AI

Off unless configured; with none of these set there is no AI in the app and the AI routes answer 404.
What is sent where, and the safety rules: [ai.md](ai.md).

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | — | The server's own model provider: `anthropic` (Messages API) or `openai` (any OpenAI-compatible chat completions endpoint: OpenAI, Azure OpenAI's v1 API, Ollama, vLLM, LM Studio). `off` or unset: none. |
| `AI_API_KEY` | — | Its API key. Required for the provider's public API; may be empty for a local endpoint (`AI_BASE_URL` set). Never logged or sent to browsers. |
| `AI_BASE_URL` | `https://api.anthropic.com` / `https://api.openai.com/v1` | API root of the provider (an operator's endpoint may be local or private, e.g. `http://localhost:11434/v1`). |
| `AI_MODEL` | `claude-sonnet-5-5` (anthropic) | Model id. Required with `AI_PROVIDER=openai`. |
| `AI_INSTANCE_FOR` | `teams` | Who may use the server's provider: `teams` (team workspaces whose admins turn AI on with it), `personal` (boards in personal workspaces), both (`personal,teams`) or `none`. |
| `AI_WORKSPACE_KEYS` | `false` | Team workspace admins may configure their own provider, endpoint, model and key (sealed at rest) in the admin console. |
| `AI_WORKSPACE_PRIVATE_ENDPOINTS` | `false` | Workspace-configured endpoints may use plain http and private / loopback addresses (self-hosted models on your network). Off: https only, private addresses refused when connecting. |
| `AI_INSTANCE_MONTHLY_TOKENS_PER_USER` | `200000` | Tokens (input + output) one person may use per calendar month (UTC) through the server's provider, across all workspaces. `0`: no cap. Workspace budgets are set by their admins. |
| `AI_MAX_INPUT_TOKENS` | `12000` | About how much board content one action may send (the outline is cut to it). |
| `AI_MAX_OUTPUT_TOKENS` | `4096` | `max_tokens` of each model call. |
| `AI_TIMEOUT_SECONDS` | `90` | Deadline of one model call. |
| `AI_TRANSCRIBE_MODEL` | — | Speech-to-text model for walkthrough captions (e.g. `whisper-1`), called on the board's own AI endpoint when that endpoint is OpenAI-compatible (`/audio/transcriptions`). Unset, or an Anthropic endpoint: no AI captions (people can still type them). |

## Issue trackers

Jira (Cloud and Data Center), Linear and GitHub, connected by a team's admins (admin console →
Issue trackers) or by a person for themselves (Settings). How it works and what is stored:
[trackers.md](trackers.md).

| Variable | Default | Description |
|---|---|---|
| `TRACKER_PRIVATE_ENDPOINTS` | `false` | Tracker addresses may use plain http and private / loopback addresses (a self-hosted Jira Data Center on your network). Off: https only, private addresses refused when connecting. |
| `TRACKER_POLL_SECONDS` | `60` | How often connections set to polling (no webhooks reach Freero) ask their tracker what changed. |
| `TRACKER_FALLBACK_POLL_SECONDS` | `900` | How often connections with webhooks poll anyway, to catch a delivery that never arrived. |
| `TRACKER_JIRA_CLIENT_ID` / `TRACKER_JIRA_CLIENT_SECRET` | — | An OAuth 2.0 (3LO) app you registered at developer.atlassian.com (callback `<PUBLIC_URL>/api/trackers/oauth/jira/callback`; scopes `read:jira-work write:jira-work read:jira-user offline_access`). Set: "Connect with Atlassian" is offered next to API tokens. Both or neither. |
| `TRACKER_JIRA_AUTH_URL` / `TRACKER_JIRA_API_URL` | `https://auth.atlassian.com` / `https://api.atlassian.com` | Atlassian's authorization server and API gateway. Only changed to test against a mock. |
| `TRACKER_TRELLO_KEY` / `TRACKER_TRELLO_SECRET` | — | The operator's Trello API key and its secret (#181). Trello has no OAuth 2.0 app: register a Power-Up at <https://trello.com/power-ups/admin> → **New** (name "Freero", your Trello Workspace, an email; the iframe connector URL may stay empty), accept Atlassian's Developer Terms, open it → **API key** → **Generate a new API key**, and copy the **API key** and the **Secret**. Set: connecting Trello needs only a token, and the connect form links to Trello's authorize page (`/1/authorize?key=…&scope=read,write&expiration=never&response_type=token`) where people allow Freero and copy theirs; the secret verifies every webhook delivery (`X-Trello-Webhook`). Unset: people give their own API key with their token (and optionally its secret). The key alone is fine; the secret needs the key. |
| `TRACKER_CLICKUP_URL` / `TRACKER_CLICKUP_API_URL` | `https://app.clickup.com` / `https://api.clickup.com` | ClickUp's app (its consent page, `/api`) and API host (`/api/v2`, the token exchange too). Only changed to test against a mock. |
| `TRACKER_TRELLO_URL` / `TRACKER_TRELLO_API_URL` | `https://trello.com` / `https://api.trello.com` | Trello's site (its authorize page) and API host (`/1`). Only changed to test against a mock. |
| `TRACKER_ASANA_CLIENT_ID` / `TRACKER_ASANA_CLIENT_SECRET` | — | An Asana OAuth app you registered in the Asana developer console (redirect URL `<PUBLIC_URL>/api/trackers/oauth/asana/callback`; full permissions, or the `default` scope). Set: "Connect with Asana" is offered next to personal access tokens. Both or neither. |
| `TRACKER_MONDAY_CLIENT_ID` / `TRACKER_MONDAY_CLIENT_SECRET` | — | A monday.com app with OAuth you registered in the monday.com Developer Center (redirect URL `<PUBLIC_URL>/api/trackers/oauth/monday/callback`; scopes `boards:read boards:write users:read updates:read updates:write webhooks:write me:read`). Set: "Connect with monday.com" is offered next to API tokens. Both or neither. |
| `TRACKER_CLICKUP_CLIENT_ID` / `TRACKER_CLICKUP_CLIENT_SECRET` | — | A ClickUp OAuth app (#180). Register it in ClickUp: Settings → Apps (Workspace owner or admin) → **Create new app**; name "Freero", redirect URL `<PUBLIC_URL host>` (ClickUp matches the redirect's host: e.g. `freero.app`; Freero sends `<PUBLIC_URL>/api/trackers/oauth/clickup/callback`); copy the Client ID and Client Secret here. ClickUp's OAuth has no scopes: the person picks the Workspaces Freero may reach on the consent page. Set: "Connect with ClickUp" is offered next to personal tokens. Both or neither. |
| `TRACKER_ASANA_URL` / `TRACKER_MONDAY_AUTH_URL` / `TRACKER_MONDAY_API_URL` | `https://app.asana.com` / `https://auth.monday.com` / `https://api.monday.com` | Asana's app (its OAuth endpoints and `/api/1.0`), monday.com's authorization server and API. Only changed to test against a mock. |

## Public API and OAuth apps

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_API` | `true` | The public REST API (`/api/v1`, reference: [api/openapi.json](api/openapi.json)) and the OAuth endpoints apps use. `false` is the instance-wide kill switch for integrations and agents: every API call and token request is refused at once; tokens and app authorisations are kept, so turning it back on restores them. Workspace admins have their own switch in the admin console ("API & apps"). |
| `OPENAI_APPS_CHALLENGE` | — | The domain-verification token the ChatGPT app directory's portal shows when you connect the MCP server; served as plain text (exactly the token) at `/.well-known/openai-apps-challenge`. Unset: that path is a 404. |
| `OAUTH_CLIENT_METADATA_LOOPBACK` | `false` | Development and tests only (refused in production): an OAuth client may be identified by a client metadata document served over plain http from this machine (`http://127.0.0.1:<port>/…`, `http://localhost:<port>/…`). Off: metadata documents only over https from public addresses ([mcp.md](mcp.md#how-sign-in-works-for-client-developers)). |

## Events and webhooks

The event stream and workspace webhooks: [events.md](events.md).

| Variable | Default | Description |
|---|---|---|
| `EVENTS_SETTLE_SECONDS` | `3` | A board's item and comment events are worked out once its saved content has been quiet this long (at the latest a minute after the first change), so a drag or a burst of typing is one event. `0`: at the next save. |
| `EVENTS_RETENTION_DAYS` | `30` | How long recorded events are kept. |
| `WEBHOOKS` | `true` | Workspace webhooks. `false` is the instance-wide switch: the admin console's Webhooks tab and its routes are gone (404) and nothing is delivered; endpoints are kept. |
| `WEBHOOK_PRIVATE_ENDPOINTS` | `false` | Endpoints may be plain `http` and private / loopback addresses (receivers on your own network, local development). Off: `https` only, private addresses refused when an endpoint is added and again when connecting. |
| `WEBHOOK_TIMEOUT_SECONDS` | `10` | How long one delivery attempt waits for the receiver's answer. |
| `WEBHOOK_RETRY_BASE_MS` | `10000` | The first retry's delay; each further one is 4× longer, at most 6 hours. |
| `WEBHOOK_MAX_ATTEMPTS` | `7` | Attempts per delivery before it is marked failed (it stays in the delivery log, and admins can send it again). |
| `WEBHOOK_DISABLE_AFTER_FAILURES` | `15` | Failed attempts in a row (any delivery) after which an endpoint is turned off, audited and its creator emailed. |

## Audit log streaming to a SIEM

Owners/admins of a team workspace stream its audit log to Splunk (HTTP Event Collector), Microsoft Sentinel (Logs Ingestion API), an HTTPS collector or syslog over TLS from the admin console (Audit log tab). SIEMs that pull use `GET /api/v1/workspaces/<id>/audit` with an `audit:read` token instead.

| Variable | Default | Description |
|---|---|---|
| `SIEM` | `true` | Audit log streaming. `false` is the instance-wide switch: the admin console's streams and their routes are gone (404) and nothing is sent; streams are kept. |
| `SIEM_PRIVATE_ENDPOINTS` | `false` | Streams may go to plain `http` and private / loopback addresses (a SIEM on your own network). Off: `https` / TLS only, private addresses refused when a stream is added and again when connecting. |
| `SIEM_TIMEOUT_SECONDS` | `15` | How long one attempt waits for the SIEM. |
| `SIEM_RETRY_BASE_MS` | `10000` | The first retry's delay after a failed batch; each further one is 4× longer, at most 6 hours. A failed batch is never skipped: the stream waits and resends from the same event. |
| `SIEM_AZURE_AUTHORITY` | `https://login.microsoftonline.com` | Where Microsoft Sentinel streams get their Entra ID token (`<authority>/<tenant>/oauth2/v2.0/token`). Change it only for tests (sovereign clouds are not supported yet: their Azure Monitor scope differs). |

## Slack link unfurls, direct messages and /freero

Previews of Freero board links in Slack, and "Connect Slack" (notifications as direct messages,
previews of private boards for the people who can open them, `/freero`), through a Slack app you
create: [integrations/slack.md](integrations/slack.md). Previews are off unless the first two are
set; Connect Slack needs the client id and secret as well.

| Variable | Default | Description |
|---|---|---|
| `SLACK_SIGNING_SECRET` | — | Your Slack app's signing secret (Basic Information → App Credentials). Every request to `/api/integrations/slack/events` and `/api/integrations/slack/commands` must carry a valid signature from the last five minutes. |
| `SLACK_BOT_TOKEN` | — | Your Slack app's bot token (`xoxb-…`, OAuth & Permissions), used for `chat.unfurl` in your workspace. One without the other refuses to start. |
| `SLACK_CLIENT_ID` | — | Your Slack app's client id (Basic Information → App Credentials). With `SLACK_CLIENT_SECRET`, turns on Connect Slack in everyone's settings (#105). Needs the two above; one without the other refuses to start. |
| `SLACK_CLIENT_SECRET` | — | Your Slack app's client secret, used only to redeem the code Slack sends people back with (`oauth.v2.access`). |
| `SLACK_API_URL` | `https://slack.com/api` | Slack's Web API (tests point it at a stand-in). Slack's consent page is taken from the same origin (`/oauth/v2/authorize`). |

## Microsoft Teams and Microsoft 365 Copilot

A Teams app (a board as a tab and in meetings, link previews with a bot) and a Copilot agent, packaged
for your instance: [integrations/teams.md](integrations/teams.md). Each is off unless its ids are set;
`PUBLIC_URL` must be https.

| Variable | Default | Description |
|---|---|---|
| `TEAMS_APP_ID` | — | The GUID of your Teams app. Turns on the app package (`/api/integrations/teams/app-package`, `npm run admin -- teams:package`) and lets Teams — only Teams — frame `/teams/config` and `/teams/b/<board>` (the latter while the board allows embedding). |
| `TEAMS_BOT_ID` | — | Your Azure Bot's Microsoft App ID (needs `TEAMS_APP_ID`): link previews at `/api/integrations/teams/messages`, every request checked against the Bot Connector's signed JWT. No secret is needed. |
| `TEAMS_BOT_OPENID_METADATA_URL` | `https://login.botframework.com/v1/.well-known/openidconfiguration` | The Bot Connector's OpenID metadata (tests point it at a stand-in). |
| `COPILOT_APP_ID` | — | The GUID of your Copilot agent app. With the next one, turns on the agent package (`/api/integrations/copilot/agent-package`, `npm run admin -- copilot:package`). |
| `COPILOT_OAUTH_REFERENCE_ID` | — | The OAuth client registration ID from the Teams Developer Portal, for Freero's OAuth app registered for Copilot. One without the other refuses to start. |

## Board calls

| Variable | Default | Description |
|---|---|---|
| `JITSI_BASE_URL` | — | An https Jitsi deployment (`https://meet.jit.si`, or your own) where a board can get a call room of its own ("Call link…" → Jitsi room). The room name is derived from the board id with `SESSION_SECRET` (`Freero` + 24 hex characters), so nobody can guess another board's room; rotating the secret gives every board a new room. Unset: boards only use meeting links their editors paste (Meet, Zoom, Teams…, https only). Freero carries no audio or video itself. |

## Marketing site

The public pages at `/`, `/claude`, `/chatgpt`, `/agents`, `/security`, `/open-source`, `/pricing`, `/support`, the legal pages,
`/docs`, `/integrations` (one page per integration, `/integrations/*`) and `/vs/*` (built by `npm run build` from `apps/site`; ARCHITECTURE.md, "Marketing site").
They are static HTML: canonical links, Open Graph tags, structured data and the sitemaps carry
`PUBLIC_URL`, put in when they are served. A signed-in person who opens `/` goes to their boards
(`/app`).

| Variable | Default | Description |
|---|---|---|
| `SITE` | `true` | Serve the marketing site. `false` (most self-hosted instances): `/` sends everyone to `/app` (sign-in first when signed out), no marketing page is served, and `robots.txt` asks search engines to stay off the whole instance (`Disallow: /`). The app's own pages are `noindex` either way. |
| `FREERO_SITE_DIST` | `apps/site/dist` | The built site to serve. Without a build there, `/` behaves as with `SITE=false`. |
| `SITE_ANALYTICS_SRC` | — | Privacy-friendly analytics for the marketing pages only (never the app): an `https` script URL (Plausible, Umami, a self-hosted counter…), added with `defer` at the end of each page's `<head>`. Its origin is added to those pages' CSP `script-src` and `connect-src`. Unset: no analytics, no third-party request at all. |
| `SITE_ANALYTICS_ATTRS` | — | `data-*` attributes for that script, comma-separated `key=value` (`domain=whiteboard.example.com` → `data-domain="whiteboard.example.com"`; Umami: `website-id=…`). |
| `GA_MEASUREMENT_ID` | — | Google Analytics 4 for the marketing pages and the app: a GA4 web stream's measurement id (`G-…`; a `UA-…` id is refused at startup). Analytics runs by default, with no banner (the operator's decision: the privacy policy names legitimate interests as the basis; in the EEA and UK the ePrivacy rules generally expect consent before analytics cookies, so weigh that before setting it), with Consent Mode v2 (analytics storage granted; ad storage, ad user data and ad personalisation always denied, Google signals off, cookies at most 13 months). A browser that opted out, or sends Global Privacy Control or Do Not Track, loads nothing. The app reports pages by route with ids removed (`/board/<id>` → `/board`) and generic titles, from a hidden same-origin frame (`/analytics-frame`), never from the page that shows boards; it never runs on embedded boards (`/embed/*`, `/teams/*`), the operators' console or the OAuth consent screen. Events: `sign_up` and `login` (method only), `board_created`, `template_used` (the public template id). "Turn off analytics" in the site's footer, the privacy policy and the app's Help menu opts this browser out (its `_ga` cookies deleted, remembered) and back in. The pages' CSP adds `https://www.googletagmanager.com` to `script-src`, Google's collection hosts to `connect-src` and `'self'` to `frame-src`. The privacy policy describes it (and the cookies) when it is set. Unset: no Google script, opt-out control, frame or CSP change anywhere. In GA's stream settings you may leave enhanced measurement on: in the app it only sees the empty analytics frame. |
| `SITE_INDEXNOW_KEY` | — | An [IndexNow](https://www.indexnow.org/) key (8–128 letters, digits or dashes; generate one with `openssl rand -hex 16`). The server answers `/<key>.txt` with it, which proves to Bing, Yandex, Seznam, Naver and the other IndexNow engines that you control this host; then `node scripts/indexnow.mjs --site <PUBLIC_URL> [--since YYYY-MM-DD]` after a deploy submits the sitemap's pages (or only those changed since a day). Unset: nothing is served. Google doesn't use IndexNow: submit the sitemap in Search Console. |

### Legal pages and support (`/privacy`, `/terms`, `/acceptable-use`, `/support`, `/security`, `/subprocessors`, `/dpa`)

The privacy policy, terms of service and acceptable use policy are **drafts for legal review**,
written from what the code does; they describe the hosted service. They are built with tokens for
the facts below and filled in when served (`modules/site/legal.ts`), together with facts the server
derives from its own configuration: retention periods (`ACCOUNT_DELETION_GRACE_DAYS`,
`DATA_EXPORT_TTL_HOURS`, `EVENTS_RETENTION_DAYS`, `MODERATION_KEEP_REMOVED_DAYS`, `PROBLEM_RETENTION_DAYS`), the email
provider's host (`SMTP_URL`), the storage (`S3_*`), the AI provider (`AI_PROVIDER`, `AI_BASE_URL`,
`AI_WORKSPACE_KEYS`), error tracking (`ERROR_REPORTING_DSN`'s host) and analytics
(`GA_MEASUREMENT_ID`, `SITE_ANALYTICS_SRC`). Abuse and security contacts come from `ABUSE_CONTACT_EMAIL` and
`SECURITY_CONTACT`.

**The guard:** until `SITE_LEGAL_OPERATOR` is set, the three legal pages show a "Draft: not in
effect" banner, carry `noindex` (meta and `X-Robots-Tag`), and the sign-up page asks nobody to
agree to anything (`GET /api/site/legal` answers `{ "legal": null }`). Set it only once the text has
been reviewed and adapted by a lawyer. If you run your own Freero with the marketing site on, these
pages describe the hosted service, not yours: write your own, or leave the operator unset.

The subprocessor list and the data processing addendum (`/subprocessors`, `/dpa`) are legal pages
under the same guard. A page marked `underReview: true` (`apps/site/src/lib/define.ts`) also
carries a "Draft — under review" line and stays `noindex` and out of the sitemap, which no setting
changes: that ends, with every "to confirm by the operator" mark, when the operator has approved
the text and removes the flag and its `<ToConfirm />` marks (`apps/site/src/lib/legal.tsx`). The
hosted service's `/security`, `/subprocessors` and `/dpa` were approved on 2026-11-03.

| Variable | Default | Description |
|---|---|---|
| `SITE_LEGAL_OPERATOR` | — | The legal name of whoever operates the service, e.g. `Kaiten Gaming LLC`. Setting it puts the legal pages in effect (no draft banner, indexable) and adds "By signing up you agree to…" to sign-up. |
| `SITE_LEGAL_CONTACT_EMAIL` | `ABUSE_CONTACT_EMAIL` | Where people send privacy requests and questions; also the contact on `/support`. |
| `SITE_LEGAL_ADDRESS` | — | The operator's postal address, one line. |
| `SITE_LEGAL_JURISDICTION` | — | The law that governs the terms, as it reads in "governed by the laws of …", e.g. `the State of Delaware, USA`. |
| `SITE_LEGAL_HOSTING` | — | Who hosts the servers and where, as the privacy policy names it, e.g. `Railway Corporation (United States, US West region)`. |
| `SITE_LEGAL_STORAGE` | — | Who stores uploaded files and where, as the privacy policy and `/subprocessors` name it, e.g. `Example Storage Inc. (United States)` (the hosted service: `Railway Corporation (Railway Storage Buckets, run on Tigris Data's servers; United States, US West, California)`). Shown before the bucket's host, which the server always adds itself (`S3_ENDPOINT`). Unset: only the host. |
| `SITE_LEGAL_MAIL` | — | Who delivers email and where, e.g. `Example Mail Inc. (United States)`. Shown before the SMTP server's host (`SMTP_URL`). Unset: only the host. |
| `SITE_LEGAL_BACKUP_DAYS` | — | The longest a database backup is kept, in days, as the privacy policy states it. Freero doesn't take these backups, your hosting does: set the real number (on Railway, the longest-kept backup schedule, including point-in-time recovery). |
| `SITE_LEGAL_LOG_DAYS` | — | The longest the hosting keeps request logs, in days, as the privacy policy states it. |
| `SITE_STATUS_URL` | — | An `https` status page, linked from `/support` ("Service status"). Unset: `/support` says to write to the contact address. |

Unset values show as a visible "[…: not set yet]" placeholder; the server logs which ones are missing
at startup once the operator is set.

## Live embeds

| Variable | Default | Description |
|---|---|---|
| `EMBED_EXTRA_ORIGINS` | — | Comma-separated https origins (no path, e.g. `https://embed.example.com`) whose links boards may show as live, sandboxed frames after a click, besides the built-in providers (YouTube, Vimeo, Loom, Figma, Google Docs / Sheets / Slides / Forms, CodePen, CodeSandbox — `EMBED_PROVIDERS` in `packages/shared`). A link on such an origin is framed as given, so list only sites whose every page you are happy to show (an internal wiki's embed host, a maps or dashboard host). Added to the CSP `frame-src`; never this server's own origin. Workspace admins can turn live embeds off for their boards (admin console → Sharing, "Live embeds"). |
| `EMBED_MAX_VISITORS_PER_BOARD` | `200` | Visitors without an account one instance lets watch one board through its embeds on other sites at a time (#60); later ones see a card with a link to the board instead. Signed-in people are not counted. `0`: embeds show visitors no board at all. See [integrations/embedding.md](integrations/embedding.md). |
| `MCP_APP_FRAME_ANCESTORS` | Claude, ChatGPT, VS Code | Who may frame the live board view AI assistants show for `open_board` (MCP Apps, [mcp.md](mcp.md#live-boards-in-the-conversation-mcp-apps)): CSP `frame-ancestors` sources for `/embed/board/…` only — every other page refuses all framing (except a board's own embed page `/embed/b/…`, which any site may frame while the board allows embedding: [integrations/embedding.md](integrations/embedding.md)). Space- or comma-separated https origins (`https://*.host` wildcards allowed), `http://localhost` / `http://127.0.0.1` for local testing, or a `*-webview:` scheme. Default `https://claude.ai https://*.claude.ai https://*.claudemcpcontent.com https://chatgpt.com https://*.chatgpt.com https://*.oaiusercontent.com vscode-webview:`. `none`: the live view loads nowhere. |

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
| `MAX_UPLOAD_MB` | `15` | Max size of one uploaded image or PDF. |
| `MAX_MEDIA_UPLOAD_MB` | `100` | Max size of one video or audio file (played on the board). Uploads are held in memory while they are checked, so keep it well below the instance's memory. |
| `MAX_ATTACHMENT_UPLOAD_MB` | `50` | Max size of any other file (a file card on the board, downloaded on click). Same memory note. |
| `MAX_BACKUP_MB` | `200` | Max size of a board backup (`.freero`, KAI-137): a download carries the board's files up to this much (the rest are listed in the file as missing), and a restore refuses a larger file before reading it. Both are built in memory, so size the container for it; restored files still count toward `UPLOAD_QUOTA_MB`. |
| `UPLOAD_QUOTA_MB` | `1024` | Total upload storage per account: images, documents, video, audio and other files alike (board thumbnails don't count). Over quota: `413`. |
| `UPLOAD_CACHE_SECONDS` | `3600` | How long browsers, proxies and a CDN may reuse an uploaded file before revalidating it (a 304 by ETag). Also stored on S3 objects. It bounds how long a file an operator removed keeps showing where it was already loaded. `0`: revalidate every time. |
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
| `RATE_LIMIT_DOWNLOAD` | `300/10m` | Files downloaded from boards (file cards, video and audio items) per user or guest. Each download is also checked against the workspace's downloads policy and audited. |
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
| `RATE_LIMIT_AI` | `20/10m` | AI actions (and admin connection tests) per user: each one calls a paid model. |
| `RATE_LIMIT_AI_WORKSPACE` | `300/1h` | AI actions per workspace, all its people together. |
| `RATE_LIMIT_REPORT` | `20/1h` | Abuse reports per IP and, separately, per signed-in user. |
| `RATE_LIMIT_APPEAL` | `10/1h` | Appeals against moderation decisions per IP. |
| `RATE_LIMIT_PROBLEM_REPORT` | `10/1h` | Problem reports (“Report a problem”) per signed-in person. |
| `RATE_LIMIT_LISTING_SUBMIT` | `5/1d` | Community listings submitted to Apps & agents for review, per person (each mails the operators; at most 10 waiting or live per person at once). |
| `RATE_LIMIT_LINK_PASSWORD` | `10/15m` | Attempts at a board link's password, per IP and, separately, per board and person (or, before a visitor joins as a guest, per board and IP). The password is stored with the account passwords' slow hash. |
| `RATE_LIMIT_ENGAGE` | `120/1m` | Answers, questions and upvotes in live activities (polls, word clouds, rankings, ratings, Q&A) per person or guest. |
| `RATE_LIMIT_SEARCH` | `120/1m` | Searches of board content per person (the dashboard's "Inside boards") and, separately, per API token or authorised app (`/api/v1/search`, MCP `search`). |
| `RATE_LIMIT_API_CREDENTIAL` | `300/1m` | Public API calls and MCP requests per API token, or per authorised app and person (its refreshed tokens share the count). Outline, structure, invite and board-creation calls also count against the person's own limits for those. |
| `RATE_LIMIT_AGENT_WRITE` | `60/1m` | Changes to boards per API token, or per authorised app and person (the per-agent write limit, KAI-168): creating, changing or deleting items, inserting structure, comments, new boards — through the REST API or MCP. Separate from the person's own editing in the app, which it never slows down. With at most 500 items per call it also bounds how many items an agent writes per minute. |
| `RATE_LIMIT_OAUTH_TOKEN` | `60/1m` | OAuth token and revocation requests per IP. |
| `RATE_LIMIT_OAUTH_REGISTER` | `20/1h` | Apps registering themselves (OAuth dynamic client registration) per IP. |
| `RATE_LIMIT_OAUTH_CLIENT_METADATA` | `30/10m` | OAuth client metadata documents fetched for a person's consent screens (only when no fresh copy is stored). |
| `RATE_LIMIT_TRACKER_SEND` | `60/10m` | Per user: issues created or imported in a tracker, and tracker connections added or tested (each calls the tracker's API). |
| `RATE_LIMIT_BOARD_RENDER` | `30/10m` | Per user: boards drawn as an image or PDF on the server (`POST /api/v1/boards/:id/export`, MCP `export_board` with png / svg / pdf, its download links) — each reads a whole board and its pictures and rasterises it (#33). |
| `RATE_LIMIT_BACKUP` | `30/1h` | Per user: board backups (`.freero`) downloaded or restored — each reads or writes a whole board and its files (KAI-137). |
| `RATE_LIMIT_WALKTHROUGH_COMMENT` | `120/10m` | Per person: comments on walkthroughs (each may notify the people it mentions and the walkthrough's author). |
| `RATE_LIMIT_SLACK_UNFURL` | `50/1m` | Per Slack workspace: link previews Freero posts with `chat.unfurl` (Slack's own limit for it is about 50 a minute); past it, links stay without a preview. |
| `RATE_LIMIT_TEAMS_UNFURL` | `120/1m` | Per Microsoft 365 tenant: link previews Freero answers in Teams (each reads a board; Teams caches one for 30 minutes); past it, links get no card. |

Rule format: `<count>/<window>` with the window in `s`, `m`, `h` or `d` and an optional multiplier
(`10/5m` = 10 per 5 minutes), or `off`. Windows are fixed (they reset `window` after the first hit).
Counters live in Redis when `REDIS_URL` is set (shared by all instances), in memory otherwise.
Exceeding a limit answers `429` with a `Retry-After` header (seconds); refused WebSocket upgrades
get an HTTP 429 the client retries with backoff.

## Security behaviour (not configurable)

- **Headers** on every response: a Content-Security-Policy (scripts only from the app's origin, plus
  Google's tag script where `GA_MEASUREMENT_ID` is set; styles and fonts only from the app; images from the app, `data:`, `blob:` and `https:` for linked images;
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
