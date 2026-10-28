# Operating Freero

Day-2 operations for a production deployment ([deployment.md](deployment.md)). What lives where:

| Data | Where | Protect with |
|---|---|---|
| Accounts, sessions, boards, members, board documents (Yjs: compacted base + update log + snapshots), upload index | PostgreSQL | `scripts/backup.sh` (pg_dump) + provider PITR |
| Uploaded images, board thumbnails | S3 bucket under `uploads/` (or `FREERO_DATA_DIR/uploads`) | bucket versioning + replication |
| Rate-limit counters; realtime fan-out between instances (pub/sub, nothing stored) | Redis | nothing — disposable |
| Open boards | app memory, flushed to Postgres within ~10 s of an edit and on shutdown | — |

## Backups

### Database

`scripts/backup.sh` writes a compressed, consistent `pg_dump` (custom format), verifies it with
`pg_restore --list`, optionally uploads it to S3, and prunes old dumps:

```bash
DATABASE_URL=postgres://freero:…@db:5432/freero \
BACKUP_DIR=/var/backups/freero BACKUP_KEEP_DAYS=14 \
BACKUP_S3_URI=s3://acme-backups/freero/ \
  scripts/backup.sh
```

No local `pg_dump`? Use the Postgres image (its major version must be ≥ the server's):

```bash
PG_DUMP="docker run --rm --network host -e PGPASSWORD postgres:17-alpine pg_dump" scripts/backup.sh
# with the compose stack:
docker compose exec -T postgres pg_dump -U freero --format=custom freero > freero-$(date -u +%F).dump
```

Schedule it (cron: `15 3 * * * /opt/freero/scripts/backup.sh >> /var/log/freero-backup.log 2>&1`)
and **send the dumps off the machine**. On managed Postgres, also enable the provider's automated
backups with point-in-time recovery (7–35 days); pg_dump remains your provider-independent copy.

### Restore

1. Stop the app (or scale it to zero) so nothing writes during the restore.
2. Restore into an empty database:
   ```bash
   createdb -h db -U postgres freero_restored
   pg_restore --no-owner --no-privileges --jobs=4 \
     --dbname=postgres://postgres:…@db:5432/freero_restored freero-20261027T031500Z.dump
   ```
   (compose: `docker compose exec -T postgres pg_restore -U freero -d freero --clean --if-exists < file.dump`)
3. Point `DATABASE_URL` at the restored database (or rename databases) and start the app. Pending
   migrations newer than the dump are applied automatically at startup.
4. Check `/readyz`, sign in, open a few boards.

Test a restore regularly (e.g. monthly into a scratch database); an untested backup is a hope.

### Uploaded files

The database stores only `/uploads/<id>.<ext>` references; the files are in the bucket.

- **Enable bucket versioning** (`mc version enable`, `aws s3api put-bucket-versioning`; the compose
  stack does it for you). Deleted or overwritten objects stay recoverable as non-current versions.
- Add a **lifecycle rule** that expires non-current versions after e.g. 30 days, so deleted boards'
  thumbnails don't accumulate forever.
- For disaster recovery, enable **cross-region replication** (AWS/R2/B2) or mirror regularly:
  `mc mirror --overwrite src/freero dst/freero-backup` / `aws s3 sync s3://a s3://b`.
- Restoring a database dump from time T with today's bucket is safe: files referenced at T are still
  there (or recoverable as versions).
- The server deletes uploads nothing has referenced for 24 h (boards incl. trash and version
  history, templates, avatars, thumbnails), every 6 h on one instance; files in the bucket that the
  database doesn't know are adopted and follow the same rule. After restoring an old dump, restore
  the non-current versions of files it references within a day, or they show as broken images.

### Moving local uploads to object storage

Files written to `FREERO_DATA_DIR/uploads` before `S3_*` was configured keep working: the app
falls back to the local disk for keys the bucket lacks. To migrate them for good:

```bash
mc mirror /data/uploads local/freero/uploads        # or: aws s3 sync /data/uploads s3://bucket/uploads/
```

then the local copies can be removed.

## Monitoring

### Health

- `GET /healthz` — liveness: 200 whenever the process can answer.
- `GET /readyz` — readiness: `{"ok":true,"checks":{"db":"ok","redis":"ok","storage":"ok"}}`, 503
  when any dependency is unreachable (details in the log line `readiness check failed`) or while
  the instance drains for shutdown.

### Metrics

`GET /metrics` (Prometheus text format) with `Authorization: Bearer $METRICS_TOKEN`, or on
`METRICS_PORT`. Example scrape config:

```yaml
- job_name: freero
  metrics_path: /metrics
  authorization: { credentials: <METRICS_TOKEN> }
  static_configs: [{ targets: ['app-1:4000', 'app-2:4000'] }]
```

| Metric | Meaning |
|---|---|
| `freero_http_request_duration_seconds{method,route,status}` | Latency histogram per route template (`/api/boards/:id`) and status |
| `freero_websocket_connections{route}` | Open WebSockets |
| `freero_realtime_loaded_docs` | Board documents held in memory |
| `freero_realtime_persist_duration_seconds` | Time to persist a board document |
| `freero_realtime_persist_queue` | Boards with edits not yet persisted |
| `freero_realtime_persist_failures_total` | Failed persists (retried) |
| `freero_realtime_peer_messages_total{direction}` | Realtime messages sent to / received from other instances through Redis |
| `freero_rate_limited_total{limit}` | Requests refused with 429, per limit |
| `freero_process_*`, `freero_nodejs_*` | CPU, memory, event-loop lag, GC, handles |

Suggested alerts:

- `/readyz` failing on any instance for > 2 min.
- 5xx ratio: `sum(rate(freero_http_request_duration_seconds_count{status=~"5.."}[5m])) / sum(rate(freero_http_request_duration_seconds_count[5m])) > 0.02`.
- p95 API latency > 1 s for 10 min.
- `freero_realtime_persist_failures_total` increasing, or `freero_realtime_persist_queue` > 0 for 5 min.
- `freero_nodejs_eventloop_lag_p99_seconds` > 0.2.
- Memory (`freero_process_resident_memory_bytes`) near the container limit.
- `rate(freero_rate_limited_total{limit="login"}[5m])` spikes (credential stuffing).
- Postgres: connections near `max_connections`, disk > 80 %, replication lag; backup job age > 26 h.

### Logs

JSON lines on stdout, one `request` line per HTTP request (`reqId`, `userId`, `method`, `route`,
`path` without query string, `status`, `ms`, `ip`), plus application events. Every response
carries `X-Request-Id` (a well-formed incoming one from the proxy is reused), so a user's report
can be matched to its log lines. Cookies, authorization headers, passwords, tokens and secrets are
redacted. Ship stdout to your log stack (Loki, CloudWatch, Datadog…).

### Error reporting

Set `ERROR_REPORTING_DSN` to a Sentry-compatible DSN (Sentry, GlitchTip). 5xx errors, unhandled
rejections and uncaught exceptions are sent with the request id and user id, throttled to one
report per distinct message per minute. No data is sent when it is unset.

## Rotating SESSION_SECRET

`SESSION_SECRET` keys the server's HMACs (rate-limit counter keys, signed links in emails) and
encrypts every two-step verification (authenticator app) secret at rest. Session
cookies are random tokens and don't depend on it. Everything derived from it goes through
`apps/server/src/platform/secrets.ts`, which accepts the current secret and any listed in
`SESSION_SECRET_PREVIOUS`, and always makes new values with the current one.

Single instance:

1. Generate the new secret: `openssl rand -base64 48`.
2. Restart with `SESSION_SECRET=<new>` and `SESSION_SECRET_PREVIOUS=<old>`. Nothing breaks:
   authenticator codes still verify, and links mailed earlier still work.
3. Shortly after startup the re-sealing job logs
   `auth: every readable two-step verification secret is sealed under the current SESSION_SECRET …`
   (anyone signing in in the meantime is re-sealed on the spot). It repeats hourly while
   `SESSION_SECRET_PREVIOUS` is set.
4. Remove `SESSION_SECRET_PREVIOUS` and restart. Signed links made before step 2 (in emails sent
   earlier) stop working from then on, so keep the previous secret for a few days if that matters;
   keeping it longer costs nothing.

Several instances (rolling deploys): an instance that doesn't know the new secret yet can't open a
secret another instance re-sealed with it. Go in two deploys:

1. Deploy `SESSION_SECRET=<old>` with `SESSION_SECRET_PREVIOUS=<new>`: every instance now *accepts*
   the new secret while still making values with the old one.
2. When every instance runs that, deploy `SESSION_SECRET=<new>` with `SESSION_SECRET_PREVIOUS=<old>`.
3. Wait for the job's "sealed under the current SESSION_SECRET" log line after the rollout
   finished, then deploy without `SESSION_SECRET_PREVIOUS`.

What a rotation does not carry over:

- **Rate-limit counters** are keyed with the current secret only, so every window starts over once
  (an hour at most with the default limits). Deliberate: honouring old counters would cost a Redis
  round trip on every request.
- **A secret that is no longer listed**: authenticator secrets still sealed under it can't be
  opened. The job logs how many; those people sign in with a recovery code and turn two-step
  verification on again. Nothing else is lost.

## Workspace single sign-on and provisioning

Owners/admins of a team workspace set these up in Workspace settings; operators only need
`PUBLIC_URL` (the SAML/OIDC/SCIM URLs are built from it) and outbound DNS (`SSO_DNS_SERVERS` to pick
the resolver).

- **Domains** are verified by a TXT record `_freero-verification.<domain>` =
  `freero-verification=<token>`. One workspace at most holds a domain verified. To move a domain
  to another workspace, its current workspace removes it first.
- **A broken identity provider** (expired certificate, deleted app): the break-glass owner chosen
  when "Enforce SSO" was turned on still signs in with their password and fixes or disables the
  connection. If that person is gone too: `UPDATE sso_connections SET enforced = false WHERE
  workspace_id = '<id>';` (then everyone at the domain can use their password or a reset link).
- **Certificate rollover**: paste the IdP's new metadata (it may list both certificates); every
  listed signing certificate is accepted until the next save.
- **What is refused, and logged** (`sso:` lines at info level): responses that fail signature,
  audience, recipient, timestamps, InResponseTo or replay checks; IdP-initiated (unsolicited)
  responses; addresses outside the workspace's verified domains. The IdP's portal tile should
  point at `/api/sso/<workspace>/start` (SP-initiated).
- **SCIM tokens** are shown once and stored as sha256. A leaked token: revoke it in Workspace
  settings (takes effect on the next request) and generate a new one for the directory.
- **Deprovisioning** (SCIM `active: false` or DELETE) removes the person from the workspace, hands
  their boards there to an owner, closes their sockets on that workspace's boards on every
  instance and — for an address at a verified domain — ends all their sessions everywhere.

## Personal data: data map, exports and deletion (GDPR)

### Data map

What Freero stores about a person, where, which module owns it, and what happens on export and
deletion. "Purge" is the account deletion that runs after the grace period
(`ACCOUNT_DELETION_GRACE_DAYS`, modules/accounts); "workspace deletion" is an owner deleting a team
workspace (modules/workspaces).

| Data | Store (owner) | In the personal export | On account purge | On workspace deletion |
|---|---|---|---|---|
| Name, email, cursor colour, avatar, verified flag, created | `users` + avatar file (auth, uploads) | `account.json`, `uploads/` | deleted (row, avatar file) | — |
| Password hash, two-step secret (sealed), recovery codes (sha256) | `users`, `user_totp`, `user_recovery_codes` (auth) | only whether they are set — never the secrets | deleted (cascade) | — |
| Signed-in devices: user agent, IP, sign-in method, times | `sessions`, `auth_devices` (sha256 of a device cookie) (auth) | `account.json` (IP masked) | deleted (cascade) | — |
| Connected sign-in providers / SSO identities (issuer, subject, email) | `auth_identities` (auth) | `account.json` | deleted (cascade) | SSO identities of that workspace stay on the account (inert: the workspace's IdP is gone) |
| Emailed single-use tokens, pending sign-ins, OIDC/SSO flows | `auth_tokens`, `auth_challenges`, `auth_oidc_flows`, `sso_flows` | no (transient, minutes to days) | deleted (cascade) / expire | `sso_flows` deleted (cascade) |
| Workspaces, roles, project memberships, invitations sent/received | `workspaces`, `workspace_members`, `project_members`, `workspace_invites` (workspaces) | `memberships.json` | personal workspace deleted; sole-owned teams handed over (or deleted when empty) | deleted (cascade) |
| Board memberships and invitations | `board_members`, `board_invites` (members) | `memberships.json` | deleted (cascade) | deleted with the boards |
| Boards they own: content, comments, version history, layers (incl. their private drafts) | `boards`, `board_docs`, `board_doc_updates`, `board_doc_snapshots`, `board_layers`, `board_layer_updates` (boards, realtime) | `boards/<title>-<id>/board.json` + `board.yjs` + images | deleted (team boards: handed to a team owner first) | deleted (trash included) |
| Comments they wrote on others' boards | inside those boards' docs (realtime) | `comments.json` (with board, thread and pinned item) | author shown as "Deleted user" (name and colour replaced in every board they could reach) | deleted with the boards |
| Stars, last-opened times | `board_stars`, `board_opens` (boards) | `activity.json` | deleted (cascade) | deleted with the boards |
| Files they uploaded (images, PDFs) | object storage + `uploads` (uploads) | `uploads/` (up to 200 MB of files per export; the rest listed in `files-not-included.json`) | row deleted; the file stays while a board, template or avatar elsewhere uses it, then the uploads sweep deletes it (≤ 24 h after the last reference) | files only those boards used: swept within a day |
| Saved templates | `templates` (templates) | `templates/` | deleted (cascade); shared ones go too | shared-with-team link cleared (the owner's template stays) |
| Notifications and email preferences; pending mentions | `notifications`, `notification_prefs`, `pending_mentions` (notifications) | `notifications.json` | deleted (cascade) | notifications about its boards: deleted with the boards |
| What a directory sent about them (SCIM userName, externalId, name, email, active) | `scim_users`, `scim_group_members` (scim) | `memberships.json` → `directoryRecords` | deleted (cascade) | deleted (cascade) |
| Break-glass role | `sso_connections.break_glass_user_id` (sso) | `memberships.json` → `singleSignOn` | cleared (SET NULL) | deleted (cascade) |
| Data exports | `data_exports` + private ZIP files (privacy, uploads) | listed in `activity.json` | rows and files deleted by the export job within `DATA_EXPORT_INTERVAL_SECONDS` | workspace exports' rows and files deleted by the job |
| Request logs | stdout (pino) → your log pipeline | no | not touched: user ids (never emails, bodies or tokens) — expire them in your log retention | — |
| Rate-limit counters | Redis / memory, keys are HMACs | no | expire with their window | — |
| Mail | SMTP provider / dev outbox | no | outside Freero (provider retention) | — |
| Backups | your `pg_dump` / bucket copies | no | still contain the data until the backup expires: keep backup retention ≤ 35 days (or the period your privacy notice states) | same |

### Exports

- **Personal**: Account settings → Your data → Download my data (`POST /api/me/exports`). A job
  builds the ZIP (README.txt explains every file), stores it as a private file (key
  `private-<random>.zip`, never served at `/uploads/`, never swept), and mails the person a link to
  Account settings, where only they can download it while signed in. It expires after
  `DATA_EXPORT_TTL_HOURS`; the job then deletes the file.
- **Workspace** (owners/admins of a team): Workspace settings → Export workspace. Every board
  (trash included, with hidden frames' contents but never anyone's private drafts), members with
  emails, invitations, projects, SSO settings without secrets, SCIM records. Downloadable only by
  the admin who asked, and only while they still manage the workspace.
- Exports are rate limited (`RATE_LIMIT_DATA_EXPORT`), one at a time per person / workspace. A
  failed build is retried twice, then marked failed (logged with `privacy:`).

### Deletion

- **Account**: Account settings → Delete account. Grace period, then the purge (table above).
- **Workspace**: owners, in Workspace settings (type the name). Immediate; every owner is mailed a
  receipt of what was deleted. **Retention / legal holds**: a module registers
  `onWorkspaceDeletionHold` (`modules/workspaces/index.ts`); while any hold applies, deletion is
  refused (409) and nothing is removed. Nothing registers one yet (KAI-51 adds retention policies).
- **Audit trail**: export requests/downloads and workspace deletions are marked `AUDIT(KAI-48)` in
  the code, to emit audit events once the audit log ships; until then they are logged
  (`privacy:` / `workspaces:` lines).

## Incident basics

1. **Assess.** Is it everyone (proxy, DB, deploy) or some boards/users? Check `/readyz` on each
   instance, the 5xx rate and recent deploys. Search logs by the `X-Request-Id` users report.
2. **Mitigate first.** Roll back to the previous image tag (migrations are backward-compatible, so
   the previous release runs on the new schema); restart a stuck instance (open boards are flushed
   on SIGTERM); scale out if saturated.
3. **Common cases.**
   - *Database unreachable*: `/readyz` shows `db: error`, requests 500. Fix the DB; the pool
     reconnects on its own. Edits on open boards stay in memory and are persisted once it is back
     (watch `freero_realtime_persist_failures_total`).
   - *Redis down*: rate limits fail open (logged, not enforced), the app keeps working, but with
     several instances, collaborators on different instances stop seeing each other's live edits
     and cursors (every instance keeps saving its own edits). Restore Redis; open boards resync
     between instances on their own.
   - *Storage down*: uploads and image loads fail; boards keep working.
   - *Abuse / brute force*: tighten `RATE_LIMIT_*` and restart, or block at the proxy. Rate-limit
     events show in `freero_rate_limited_total` and as 429 lines in the log.
   - *Leaked secret*: rotate `SESSION_SECRET` (below; keep the leaked one as previous only until the
     re-sealing job reports done, minutes), `METRICS_TOKEN`, DB/S3 credentials; to sign everyone
     out, `DELETE FROM sessions;`.
4. **Data recovery.** Database: restore the latest dump into a new database and copy the affected
   rows across, or do a full restore (see above). Files: restore non-current object versions.
5. **Afterwards.** Write down timeline, impact, root cause and follow-ups; add a check or alert
   that would have caught it earlier.
