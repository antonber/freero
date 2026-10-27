# Freero roadmap — enterprise-grade, free hosted whiteboard

Goal: Freero runs as a **hosted SaaS** (free for everyone) with enterprise-grade accounts, teams,
security and operations. Deployment is **cloud-agnostic Docker + Postgres** (plus Redis and
S3-compatible storage), runnable on any cloud or a single VM.

## Decisions

| Topic | Decision |
|---|---|
| Database | PostgreSQL everywhere. Production: `pg` against `DATABASE_URL`. Dev/tests (no `DATABASE_URL`): PGlite — real Postgres compiled to WASM, in-process, so `npm run dev` needs no Docker. Same SQL dialect in all environments. |
| Schema | Versioned migrations per module: `modules/<m>/migrations/<YYYYMMDDHHMM>_<name>.sql`, applied once in global timestamp order and tracked in `_migrations`. Only the owning module's migrations create/alter its tables. |
| Realtime scale | Stateless app instances behind a load balancer; Yjs updates + awareness fan out through Redis when `REDIS_URL` is set (in-process otherwise). Docs persist as an append-only update log with periodic compaction + snapshots (powers version history). |
| Files | S3-compatible object storage when `S3_*` is set; local disk otherwise. |
| Email | SMTP when `SMTP_URL` is set; dev outbox (files under the data dir + log line) otherwise. |
| Optional services | Every external service has a local fallback, so dev and `npm run verify` need nothing installed. CI additionally runs `verify` against real Postgres + Redis containers. |
| Tenancy | Every board belongs to a workspace. Each user gets a personal workspace; teams are shared workspaces. All queries are scoped by workspace membership. |

## Phases

### 1. Production foundation
Postgres data layer + migrations · Docker image + docker-compose (app, postgres, redis, minio,
mailpit) · health/readiness · structured logs · metrics · graceful shutdown · security headers ·
rate limiting (auth, API, WebSocket, uploads) · upload quotas · object storage · backups ·
horizontal realtime via Redis · incremental doc persistence + snapshots · server-side comment
authorship enforcement · deployment docs.

### 2. Real accounts
Email service · email verification · password reset · Google + Microsoft sign-in (OIDC) · TOTP 2FA
with recovery codes · session management (list/revoke devices) · invite people without an account
(email → sign up → land on the board) · notifications (in-app + email: invites, mentions, replies)
· @mentions in comments · account deletion.

### 3. Teams & workspaces
Workspaces (personal + team) · team members and roles (owner/admin/member/guest) · projects
(folders) · team-wide board access · team dashboard + workspace switcher · request access ·
transfer ownership · sharing policies (who may share/export/invite guests).

### 4. Enterprise
SSO: SAML 2.0 + OIDC per workspace, verified domains, enforced SSO · SCIM 2.0 provisioning ·
admin console (members, roles, security settings, usage) · audit log (with export) · version
history (browse, preview, restore, named versions) · data export + deletion (GDPR) · retention
policies · session/idle policies.

### 5. Parity polish (continuous)
Align/distribute · find on board · tables · layers panel · format painter · grid snap · paste
list as stickies · mind-map keyboard navigation · partial erase.
