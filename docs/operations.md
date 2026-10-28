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

## Admin CLI

Operator commands run in their own process against the same configuration and database as the
server, with no HTTP endpoint behind them:

```bash
npm run admin -- <command> [args]                                       # a checkout
docker compose exec app node --import tsx apps/server/src/admin.ts <command> [args]   # the image (no npm in it)
npm run admin                                                           # lists the commands
```

Give it the server's environment (`DATABASE_URL`, `SESSION_SECRET`, `SMTP_URL`, `PUBLIC_URL`, …) —
`exec` into a running container does. On Postgres it runs next to the instances; with the
built-in PGlite database (no `DATABASE_URL`) stop the server first (one process at a time).

Every command that changes an account writes an `"audit"` log line (action, the operator's name,
their stated reason, the account id). Ship the log; an audit trail kept in the database comes with
Enterprise (`platform/audit.ts` is the seam).

## Account recovery: someone is locked out by two-step verification

Most people never need you (ARCHITECTURE.md, "Two-step verification recovery", has the threat
model):

- **Someone else turned it on** (they knew the password): the "Two-step verification is on" notice
  to the account's verified address has a "This wasn't me" button that works for 72 hours
  (`TWO_FACTOR_UNDO_HOURS`). If the intruder also changed the email address, the owner first uses
  "restore my address" from the email-change notice, then that button.
- **Lost the phone and the recovery codes**: after logging in with the password, on the code screen
  "Can't use your app? Use a recovery code" → "Lost your recovery codes too?" starts a recovery. After 7 days
  (`TWO_FACTOR_RECOVERY_DELAY_SECONDS`) the address gets a link that removes two-step verification.
  Using the authenticator meanwhile cancels it.

Use the operator reset only when neither works — typically: the intruder also changed the password
and the 72 hours are over, or the owner lost both the password and the authenticator.

### 1. Check who is asking — out of band, never on the mailbox alone

The reset hands the account to whoever reads its address, so first convince yourself the person
asking is the owner AND controls that address:

1. Look at the account (changes nothing):
   ```bash
   npm run admin -- account:show owner@example.com
   ```
   Note when two-step verification was turned on, whether a recovery is in progress, and any
   **WARNING** that the address changed recently (then the current address may be the intruder's:
   the owner must use "restore my address" from the change notice first; don't reset).
2. Have them write from the account's address, and answer from your side to that address with a
   one-time phrase they repeat back on your support channel (proves they read it now).
3. Ask for things only the owner knows and the notices never contained: names of boards they own,
   roughly when the account was created, people they share boards with, when and from where they
   last signed in successfully. Billing details once there are paid plans.
4. Prefer a cooling-off period for high-value accounts (e.g. a day, with a mail to the address
   saying a reset was requested). A request that pushes for urgency is a warning sign.
5. Write down what you checked: it goes into `--reason`.

### 2. Reset

```bash
npm run admin -- two-factor:reset owner@example.com --operator "Your Name" --reason "TICKET-123: phrase + 3 board names"
# shows the account and changes nothing; then, to do it:
npm run admin -- two-factor:reset owner@example.com --operator "Your Name" --reason "TICKET-123: phrase + 3 board names" --yes
```

It removes the authenticator and recovery codes, a recovery in progress, the password and every
connected sign-in provider (whoever locked the owner out may know the password or have connected
their own provider), cancels pending emailed links (except an email change's way back to the
previous address), ends every session and mails the address a notice with a link to choose a new
password. The owner then sets a password through that address, signs in and turns two-step
verification on again.

Open board tabs of the ended sessions stay connected until they reload (the CLI can't reach the
running instances' sockets). If the intruder may still have a board open, restart the app
instances (a rolling restart is fine) to drop every socket at once.

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
