# Deploying Freero

Freero ships as one Docker image (the `Dockerfile` at the repo root) that serves the API, the
board WebSockets and the built web app on one port. It needs PostgreSQL; Redis and S3-compatible
storage are recommended for anything beyond a single instance. All configuration is environment
variables: [configuration.md](configuration.md). Backups and day-2 operations:
[operations.md](operations.md).

```
            ┌──────────────────────── TLS ───────────────────────┐
browser ──▶ │ reverse proxy / load balancer (Caddy, nginx, ALB…) │
            └──────────┬───────────────────────────┬─────────────┘
                       ▼                           ▼
                 freero app #1      …        freero app #N        (stateless, port 4000)
                       │  \                       /  │
                       │   └── Redis (rate limits, realtime fan-out)
                       ├── PostgreSQL 15+ (17 recommended)
                       └── S3-compatible bucket (uploads, thumbnails)
```

## Build the image

```bash
docker build -t freero:$(git rev-parse --short HEAD) .
```

Multi-stage: the web app is built with the full toolchain, the runtime stage holds only the
server's production dependencies, the TypeScript sources (run by `tsx`) and the built SPA, as the
unprivileged `node` user. The image has a `HEALTHCHECK` on `/healthz`. Pass `FREERO_RELEASE`
(e.g. the git SHA) so logs and error reports name the release.

## Option A — single VM with Docker Compose

Good for small teams and evaluation. `docker-compose.yml` runs the whole stack: Caddy on `:8080`
in front of two app replicas, Postgres 17, Redis 7, MinIO (bucket created and versioned by
`minio-init`) and Mailpit.

```bash
docker compose up --build -d
open http://localhost:8080          # sign up, create a board
docker compose logs -f app          # JSON logs of both replicas
docker compose down                 # stop (add -v to delete all data)
```

For a real server:

1. Point a DNS name at the VM.
2. Replace the secrets in the `x-app-env` block (or put them in `.env` next to the compose file):
   `SESSION_SECRET`, `METRICS_TOKEN`, the Postgres and MinIO passwords, and set
   `PUBLIC_URL=https://your.domain`.
3. TLS: in `deploy/Caddyfile` replace `:8080` with your domain (`whiteboard.example.com { … }`)
   and publish ports 80 and 443 instead of 8080. Caddy obtains and renews Let's Encrypt
   certificates automatically. Keep `TRUST_PROXY=1` (exactly one proxy in front of the app).
4. Don't publish Postgres, Redis or MinIO ports. The MinIO console and Mailpit UI are bound to
   `127.0.0.1` only; reach them through an SSH tunnel.
5. Schedule `scripts/backup.sh` (see [operations.md](operations.md#backups)).

Mailpit only catches mail. For real email, set `SMTP_URL` to your provider.

## Option B — any cloud with managed services

Run the image on any container platform (ECS/Fargate, Cloud Run, Azure Container Apps, Fly.io,
Kubernetes, Nomad, a plain VM with `docker run`) and use managed backing services:

| Need | AWS | GCP | Azure | Others |
|---|---|---|---|---|
| Postgres 15+ | RDS / Aurora | Cloud SQL | Database for PostgreSQL | Neon, Crunchy, Supabase, DO |
| Redis 7 | ElastiCache | Memorystore | Cache for Redis | Upstash, Redis Cloud |
| S3 | S3 | GCS (interop keys + `S3_ENDPOINT=https://storage.googleapis.com`) | via MinIO gateway / S3 proxy | R2, B2, Spaces, Wasabi |

Minimum environment: `NODE_ENV=production`, `PUBLIC_URL`, `SESSION_SECRET`, `DATABASE_URL`
(with `?sslmode=require` for managed Postgres), `TRUST_PROXY` (number of proxies in front),
`METRICS_TOKEN` or `METRICS_PORT`; plus `REDIS_URL` and `S3_*` for more than one instance.

Container settings:

- Port `4000` (HTTP + WebSocket on the same port). The load balancer must allow WebSocket upgrades
  and an idle timeout of at least 60 s (the server pings every 30 s).
- Liveness probe: `GET /healthz`. Readiness probe: `GET /readyz` (checks the database, Redis and
  storage; 503 while any is unreachable or while draining for shutdown).
- Stop signal `SIGTERM` with a grace period ≥ `SHUTDOWN_DRAIN_SECONDS` + 10 s.
- Memory: start with 512 MB per instance; each open board holds its document in memory.
- `/data` can stay ephemeral when `DATABASE_URL` and `S3_*` are set.

## TLS and the reverse proxy

Terminate TLS at the proxy/load balancer and forward plain HTTP to the app. The proxy must:

- forward `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` (Caddy and nginx with
  the usual `proxy_set_header` lines do), and the app's `TRUST_PROXY` must equal the number of
  proxies in front of it. That is what makes `req.secure` true, which turns on `Secure` session
  cookies and HSTS, and what gives rate limits the real client IP;
- pass WebSocket upgrades on `/ws/` (nginx: `proxy_http_version 1.1; proxy_set_header Upgrade
  $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 3600s;`);
- not buffer large request bodies below `MAX_UPLOAD_MB` (nginx: `client_max_body_size 16m;`), or
  below `MAX_BACKUP_MB` for `/api/boards/restore-backup` (board backups, default 200 MB) and
  `/api/share-target` (images shared into the installed app: four uploads' worth).

Never expose the app port directly while `TRUST_PROXY` is set: a client could then forge
`X-Forwarded-For` and dodge per-IP rate limits.

## Encryption at rest

What Freero stores, where, and how it is encrypted (KAI-143). Short enough to paste into a
security questionnaire; the operator's steps are in [operations.md](operations.md#encryption-baseline).

| Data | Store | In transit | At rest |
|---|---|---|---|
| Accounts, boards (Yjs documents, update log, version history, layers), comments, audit log, everything else in tables | PostgreSQL | TLS between app and database (`DATABASE_URL` with `sslmode=require`) | **Storage encryption of the database**: managed Postgres (RDS, Cloud SQL, Azure, Neon…) encrypts its disks and snapshots with the provider's keys (or yours, in its KMS); self-hosted: an encrypted volume (LUKS / dm-crypt, BitLocker, an encrypted EBS / persistent disk). Freero does not encrypt board content itself — see below |
| Secrets in the database: two-step verification secrets, workspace AI keys, SSO client secrets, tracker credentials and webhook secrets, webhook URLs, board call links | PostgreSQL | as above | **Also sealed by Freero** (AES-256-GCM, key derived from `SESSION_SECRET` per purpose, rotatable): unreadable in a database copy without the app's secret |
| Passwords, session / API / OAuth / SCIM tokens, recovery codes, emailed links | PostgreSQL | as above | **Never stored**: only a scrypt hash (passwords) or a sha256 |
| Uploaded files (images, PDFs, video, attachments), board thumbnails, data-export archives | S3-compatible bucket (`uploads/`, `private/`) or `FREERO_DATA_DIR/uploads` | TLS to the bucket (an `https` `S3_ENDPOINT`; AWS by default) | **Server-side encryption**: `S3_SSE=AES256` (SSE-S3) or `S3_SSE=aws:kms` (+ `S3_SSE_KMS_KEY_ID`) is sent with every write; AWS S3 also encrypts every new object with SSE-S3 by default. MinIO: enable KES/KMS auto-encryption; R2 / B2 / GCS encrypt at rest by default. Local disk: an encrypted volume. Freero logs a warning at startup when the bucket reports no default encryption and `S3_SSE` is unset |
| Database dumps | `scripts/backup.sh` → `BACKUP_DIR` and optionally `BACKUP_S3_URI` | the aws CLI's TLS | **Encrypted before they leave the machine** with `BACKUP_GPG_RECIPIENT` (GnuPG) or `BACKUP_AGE_RECIPIENT` (age), to a public key whose private half stays offline; the plain dump is deleted right after. The backup bucket should have its own SSE and versioning |
| Board backups people download (`.freero`) | their own computer | HTTPS | Theirs to keep: a `.freero` holds the board as that person may read it (never others' drafts). Workspaces that must keep content inside turn off downloads (admin console → Sharing), which refuses backups too |
| Rate-limit counters, realtime fan-out | Redis | `rediss://` for TLS | Nothing durable worth encrypting (counters keyed by HMACs; pub/sub stores nothing) |
| Logs | stdout → your log pipeline | your pipeline's | Your pipeline's; Freero never logs bodies, cookies, tokens or secrets |
| Everything in transit to browsers | — | TLS at the proxy (Caddy obtains certificates automatically), HSTS, `Secure` cookies | — |

**Why board content is not sealed by the app.** Encrypting board documents with an application key
would add little over storage encryption (the key has to sit next to the app that decrypts every
board on every load) and would break what reads stored content in SQL: the uploads sweep and the
account purge find files by pattern in stored documents, search and backlinks index board text, and
operators restore `pg_dump`s. The threat it would address — someone with a copy of the database
files or a snapshot — is what storage encryption covers. What a database copy must never yield is
a working credential, so every credential is hashed or sealed (rows above), whatever the disk.

**Customer-managed keys per workspace** are out of scope: an operator can use their own KMS key
for the bucket (`S3_SSE_KMS_KEY_ID`) and for the database volume, which covers the whole service.

## Scaling

The app is stateless over HTTP: sessions, boards and uploads live in Postgres and object storage,
and rate-limit counters in Redis, so any instance can serve any REST request.

**Realtime.** With `REDIS_URL` set, any instance can serve any board WebSocket, so plain
round-robin (or least-connections) balancing is correct; no stickiness is needed
(`deploy/Caddyfile` uses `lb_policy round_robin`). Each instance that has a board open keeps its
own copy of the Yjs document and:

- publishes the edits and presence (cursors, selections) of its own sockets on the board's Redis
  channel and applies the other instances' — collaborators on different instances see each other
  within milliseconds;
- when it opens a board, loads it from Postgres and then asks the other instances for anything not
  saved yet, so a client never misses an edit made moments earlier elsewhere; it asks again after a
  Redis outage, so the copies converge once Redis is back;
- saves only the edits made through its own sockets (to the board's update log, see
  [operations.md](operations.md)); before dropping a board it saves whatever the other instances
  relayed and the database still lacks, so an instance killed before saving loses nothing that
  another instance saw;
- broadcasts membership/role and link-sharing changes, board deletions and logouts, so they apply
  to sockets on every instance at once.

Redis pub/sub keeps no messages, so Redis needs no persistence or backup for this. While Redis is
down, collaborators on different instances stop seeing each other's live changes (each instance
keeps saving its own; nothing is lost) and `/readyz` reports `redis: error`. Without `REDIS_URL`,
run a single instance (or route all sockets of a board to one instance by URI hash).

Size Postgres connections as `instances × DATABASE_POOL_MAX` < `max_connections`.

## Zero-downtime deploys

Rolling deploys work out of the box:

1. Start the new version's instances. They apply pending migrations at startup (see below) and
   report ready on `/readyz` only once listening.
2. Send `SIGTERM` to an old instance. It immediately reports `503` on `/readyz` so the balancer
   stops sending new requests, waits `SHUTDOWN_DRAIN_SECONDS`, closes WebSockets (clients
   reconnect to a new instance and resync — no edits are lost: clients keep unsent changes and the
   server flushes every open board to Postgres before exiting), then exits.
3. Repeat. Keep the old and new versions running side by side only briefly.

Migrations therefore must stay **backward-compatible with the previous release** (expand →
migrate → contract): add columns/tables in one release, start using them, and drop old ones a
release later. Never rename or drop something the running version still reads.

## Migrations

Each server module owns versioned SQL migrations in `apps/server/src/modules/<module>/migrations/`
named `<YYYYMMDDHHMM>_<name>.sql`. At startup every instance applies the ones not yet recorded in
the `_migrations` table, in timestamp order, in a single transaction holding a Postgres advisory
lock: instances starting together wait for each other, a failing migration leaves nothing behind
(the instance exits and the old version keeps serving), and an edited, already-applied migration
stops startup with an explanatory error. There is no separate migrate command; to apply
migrations ahead of a deploy, start one instance of the new version first.

## Checklist

- [ ] `NODE_ENV=production`, `PUBLIC_URL` (https), strong `SESSION_SECRET`
- [ ] `DATABASE_URL` with TLS; backups scheduled, encrypted (`BACKUP_GPG_RECIPIENT` / `BACKUP_AGE_RECIPIENT`) and a restore tested
- [ ] Encryption at rest: database storage encrypted; `S3_SSE` set (or the bucket's default encryption on)
- [ ] `TRUST_PROXY` matches the proxy chain; app port not publicly reachable
- [ ] `REDIS_URL` and `S3_*` when running more than one instance; bucket versioning on
- [ ] More than one instance: `REDIS_URL` set (realtime fan-out); any balancing policy
- [ ] `/metrics` protected (`METRICS_TOKEN` or `METRICS_PORT`) and scraped; alerts set up
- [ ] `ERROR_REPORTING_DSN` set (optional)
- [ ] Readiness/liveness probes, SIGTERM grace period configured
