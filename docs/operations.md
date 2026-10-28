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
   - *Leaked secret*: rotate `SESSION_SECRET`, `METRICS_TOKEN`, DB/S3 credentials; to sign everyone
     out, `DELETE FROM sessions;`.
4. **Data recovery.** Database: restore the latest dump into a new database and copy the affected
   rows across, or do a full restore (see above). Files: restore non-current object versions.
5. **Afterwards.** Write down timeline, impact, root cause and follow-ups; add a check or alert
   that would have caught it earlier.
