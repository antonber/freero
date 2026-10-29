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
5. Derived indexes (backlinks, search) catch up by themselves from the outbox events in the dump; if
   the dump is older than a week (the outbox keeps a week) or an index looks wrong, rebuild them from
   the saved boards: `npm run admin -- references:rebuild` and `npm run admin -- search:rebuild`
   (safe while the app runs).

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
| `freero_outbox_lag_seconds` | Age of the oldest outbox event a consumer on this instance has not handled (0 when caught up) |
| `freero_outbox_appended_total{topic}` / `freero_outbox_consumed_total{consumer}` | Outbox events written / consumed (summed over instances, consumed never exceeds appended) |
| `freero_outbox_failed_total{consumer}` / `freero_outbox_skipped_total{consumer}` | Consumer batches that failed (retried), events skipped after repeated failures |
| `freero_process_*`, `freero_nodejs_*` | CPU, memory, event-loop lag, GC, handles |

Suggested alerts:

- `/readyz` failing on any instance for > 2 min.
- 5xx ratio: `sum(rate(freero_http_request_duration_seconds_count{status=~"5.."}[5m])) / sum(rate(freero_http_request_duration_seconds_count[5m])) > 0.02`.
- p95 API latency > 1 s for 10 min.
- `freero_realtime_persist_failures_total` increasing, or `freero_realtime_persist_queue` > 0 for 5 min.
- `freero_nodejs_eventloop_lag_p99_seconds` > 0.2.
- `max(freero_outbox_lag_seconds)` > 300 (a consumer stuck: backlinks, search, events or webhooks
  stale), or `freero_outbox_skipped_total` increasing (then fix the cause and run
  `references:rebuild` / `search:rebuild`).
- `rate(freero_webhooks_attempts_total{outcome="failed"}[15m])` high: receivers failing (workspaces
  see it in their delivery logs; endpoints that keep failing turn themselves off).
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

Owners/admins of a team workspace set these up in the admin console (`/admin/<workspace>`, tabs
Single sign-on and Provisioning); operators only need
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
- **What is refused** (`sso.login_refused` in the workspace's audit log, with the reason):
  responses that fail signature, audience, recipient, timestamps, InResponseTo or replay checks;
  IdP-initiated (unsolicited) responses; addresses outside the workspace's verified domains;
  deactivated members. The IdP's portal tile should point at `/api/sso/<workspace>/start`
  (SP-initiated).
- **Session length** is the workspace's session policy (Security tab), applied to the person like
  every other sign-in; a SAML `SessionNotOnOrAfter` can only shorten one SSO sign-in.
- **SCIM tokens** are shown once and stored as sha256. A leaked token: Rotate it in the admin
  console (the old one stops at once; give the directory the new one), or Revoke it.
- **Deprovisioning** (SCIM `active: false` or DELETE) is the same deactivation as the Members tab:
  the person keeps role and boards but opens nothing in the workspace (sockets close on every
  instance), and — for an address at a verified domain — all their sessions end everywhere. The
  directory's `active: true` lifts it; an admin's own deactivation stands through directory syncs.

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
| Boards they own: content, comments, version history, layers (incl. their private drafts) | `boards`, `board_docs`, `board_doc_updates`, `board_doc_snapshots`, `board_layers`, `board_layer_updates` (boards, realtime) | `boards/<title>-<id>/board.json` + `board.yjs` + images (docs, KAI-162: the same, plus `doc.md`) | deleted (team boards: handed to a team owner first) | deleted (trash included) |
| Comments they wrote on others' boards | inside those boards' docs (realtime) | `comments.json` (with board, thread and pinned item) | author shown as "Deleted user" (name and colour replaced in every board they could reach) | deleted with the boards |
| Stars, last-opened times | `board_stars`, `board_opens` (boards) | `activity.json` | deleted (cascade) | deleted with the boards |
| Files they uploaded (images, PDFs) | object storage + `uploads` (uploads) | `uploads/` (up to 200 MB of files per export; the rest listed in `files-not-included.json`) | row deleted; the file stays while a board, template or avatar elsewhere uses it, then the uploads sweep deletes it (≤ 24 h after the last reference) | files only those boards used: swept within a day |
| Walkthroughs they recorded (their voice, maybe their face: the recording is an upload; the camera path, title, captions), their comments on walkthroughs, which ones they watched | `walkthroughs`, `walkthrough_comments`, `walkthrough_views` (walkthroughs) | `walkthroughs.json` (recordings under `uploads/`) | their walkthroughs deleted (cascade), so the recordings are swept within a day; their comments stay unattributed ("Deleted user"); views deleted | deleted with the boards |
| Decision snapshots they made (title, note) | `decisions` (decisions; the content is a board version) | `decisions.json` | kept, maker cleared (SET NULL): a decision is the board's record | deleted with the boards |
| Saved templates | `templates` (templates) | `templates/` | deleted (cascade); shared ones go too | shared-with-team link cleared (the owner's template stays) |
| Notifications and email preferences; pending mentions; task cards assigned to them with a due date (reminders) | `notifications`, `notification_prefs`, `pending_mentions`, `card_due_watch` (notifications) | `notifications.json` (the reminder list is not: it mirrors the boards' cards) | deleted (cascade) | notifications about its boards: deleted with the boards |
| Answers, questions and upvotes in live activities (anonymous ones too: kept by the server only, never in the board) | `engage_answers`, `engage_questions`, `engage_upvotes` (engage) | `activities.json` | answers and upvotes deleted; questions stay on the boards without a name | deleted with the boards |
| What boards say, as a search index (board titles, item text, comments — never private drafts or hidden frames) | `search_entries`, `search_sources` (search; derived from the boards) | no (a copy of the boards) | comment rows re-derived on the next save of each board (the author is not stored) | deleted with the boards |
| Events about boards (who did what, item and comment text up to 280 characters), webhook delivery bodies | `events` (events), `webhook_deliveries` (webhooks) | no | kept until retention (`EVENTS_RETENTION_DAYS`, deliveries 30 days); no foreign keys, like the audit log | events kept until retention; endpoints and deliveries deleted (cascade) |
| Board links unlocked with their password (when) | `board_link_unlocks` (boards) | no (an access fact, not content) | deleted | deleted with the boards |
| What a directory sent about them (SCIM userName, externalId, name, email, active) | `scim_users`, `scim_group_members` (scim) | `memberships.json` → `directoryRecords` | deleted (cascade) | deleted (cascade) |
| Break-glass role | `sso_connections.break_glass_user_id` (sso) | `memberships.json` → `singleSignOn` | cleared (SET NULL) | deleted (cascade) |
| Abuse reports they filed, moderation actions about their content or account (suspension) | `moderation_items`, `moderation_actions` (moderation; reporter address only as an HMAC), `users.suspended_at` (auth) | not yet (follow-up: KAI-191) | person references cleared (SET NULL); the records stay as the operators' trail | items about its boards stay with their recorded target |
| API tokens (sha256 only, name, scopes, times), apps they authorised (consents, codes, access/refresh tokens), apps they registered; where their credentials were used in team workspaces | `api_tokens`, `oauth_grants`, `oauth_codes`, `oauth_clients`, `api_workspace_credentials` (apiauth) | `api.json` (never a secret or hash) | deleted (cascade); revoked already when deletion is scheduled (signed out everywhere) | usage rows deleted (cascade) |
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
- **Workspace** (owners/admins of a team): admin console → Data → Export workspace. Every board
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
  refused (409) and nothing is removed. Nothing registers one yet (legal holds; time-based
  retention is the Data tab's settings).
- **Audit trail** (the workspace's audit log, admin console): workspace export requests and
  downloads, workspace deletion, every SSO configuration change, SSO sign-ins and refusals,
  just-in-time joins, SCIM tokens, group mappings, provisioning and deprovisioning. A person's own
  export requests and downloads go to their account's log only.

## Moderation

A free service with public links will be abused. Anyone who can open a board — signed in or, once
anonymous visitors exist, on its public link — can report the board, an item on it, an uploaded
file it shows, or a comment ("Report board…" in the board menu, "Report…" on the right-click menu,
the flag on a comment). Operators review reports and act on them.

### Who is an operator

Operators are configured, not stored: `OPERATOR_EMAILS` lists their addresses
([configuration.md](configuration.md#moderation-abuse-reports-and-operators)), and an account is an
operator only while its address is listed **and verified**. Adding or removing one is a config
change and a restart, reviewed like any other deploy. There is no database flag and no
[admin CLI](#admin-cli) command for it, so nobody can make themselves an operator through the app,
the CLI or a database write. (Moderation operators are signed-in accounts; the admin CLI's
`--operator` is just the name a person gives when running a command on a server.)

Also set `ABUSE_CONTACT_EMAIL` (named in every notice and in `/.well-known/security.txt`) and,
if vulnerability reports go elsewhere, `SECURITY_CONTACT`. In production the server logs at
startup when either operators or the contact are missing.

### The queue

Signed in as an operator, open **Moderation queue** in the account menu (`/operator`). Each open
item is a report (reason, the reporter's note, who reported — a signed-in user or a visitor with an
optional contact address — and what it is about) or an **appeal** against an earlier decision.
Operators get an email when a board gets its first open report and for every appeal.

- **Preview** opens a read-only snapshot of the board as collaborators see it right now (never
  anyone's private drafts or sealed ballots), zoomed to the reported item or comment thread. It
  works for boards that are taken down too. Looking changes nothing and nobody sees you.
- **History** lists every action on the board and every report and appeal about it.
- **Dismiss** / **Keep decision** closes the item with no action; **Mark handled** closes it as
  dealt with. Reporters are emailed the outcome; an appellant whose appeal is not granted hears
  that the decision stands.
- The side panel finds an **account** by email (suspend / lift) and an **uploaded file** by its
  URL (remove / restore / delete the kept copy).

### Actions

Every action asks for a reason, a **statement** for the person affected (required for actions
against someone: it is the statement of reasons they get by email, and what they can appeal) and
an optional internal note. Every action is recorded with who, when, why and what was said
(`moderation_actions`, append-only) and logged as an audit event (`"audit"` log line, action
`moderation.<action>`, which the audit log picks up through `platform/audit.ts`). Each can be undone, and undoing is recorded too.

| Action | What happens at once (every instance) | Undo |
|---|---|---|
| Turn off link | The board's link access reads "no access": people who only had the link lose it and their sockets close; the owner, invited members and the team keep theirs. The owner can't turn the link back on. | Restore link — the owner's previous setting comes back |
| Take down | The board is "removed for review" for everyone, owner included: open sockets close (the board shows a banner), REST answers 451 to anyone who could open it and 404 to everyone else, it leaves every list, its link is dead. Its content is kept unchanged and nothing deletes it meanwhile (see "Legal hold"). | Restore board — back exactly as it was. **Delete for good** ends the review the other way: the board and its content are deleted (recorded, and the owner is told). |
| Remove file | `/uploads/<name>` answers 410 Gone wherever the file is used. The bytes move to a kept copy under a name that is never served (with S3, under the bucket's `private/` prefix, outside the `uploads/*` a public bucket exposes); the uploads sweep neither deletes the record nor brings the file back. The kept copy is deleted automatically after `MODERATION_KEEP_REMOVED_DAYS` (30), unless a report or appeal about the file is still open — recorded as an automatic "Delete kept copy". | Restore file — the same bytes, same URL, while the kept copy exists. **Delete kept copy** removes them for good at once (e.g. illegal content); the URL keeps answering 410. |
| Suspend account | Every session ends (board and notification sockets close on every instance), and every way of signing in is refused with "this account has been suspended". **Their boards**: leave them, take down every board the account owns, or turn off the link of every board it shares — each board is recorded as its own action under the suspension, and the suspension notice mentions them (one email, not one per board). | Lift suspension — also brings back every board the suspension took down or closed to its link, except those you restored or deleted separately since |

**Legal hold.** A taken-down board is kept until you restore it or delete it for good: owners
can't trash or delete it, the trash purge skips it, deleting a team workspace that holds one is
refused ("under review"), and an account deletion waits — the account stays signed out and nothing
of it is deleted — while it owns one or is the last member of a team holding one. Removed files
outlive the account that uploaded them (their tombstone and kept copy, with no owner). The action
record keeps the name and address of the person each action was about, also after their account is
gone.

The person affected gets an email with what happened, the reason, your statement and a **signed
appeal link** (`/appeal?t=…`, no sign-in needed, so suspended accounts can appeal) — plus a bell
notification for board and file actions. Restorations are announced the same way. An appeal goes
into the queue (one open appeal per decision); grant it by undoing the action from its card.

Caches: a removed file's URL answers 410 from the app at once. Browsers, proxies and a CDN may
reuse a copy they already hold for at most `UPLOAD_CACHE_SECONDS` (an hour by default); after that
they ask again (`If-None-Match` with the file's ETag, a cheap 304 while it is served) and get the
410, so a removed file stops showing within that time without any purge. Purge `/uploads/<name>`
on your CDN only to make it faster than that. With a public bucket (`S3_PUBLIC_URL`) the bucket's
copy is deleted at removal and the kept copy sits under `private/`, outside what the bucket
exposes. Objects uploaded to S3 before this release still carry a one-year `immutable` header: to
bound them too, rewrite their metadata (`aws s3 cp s3://<bucket>/uploads/ s3://<bucket>/uploads/
--recursive --metadata-directive REPLACE --cache-control "public, max-age=3600"`, once per
content type with `--content-type`, or the equivalent for your provider), or purge a CDN in front
of the bucket when you remove one of them.

### Reports, abuse of the report form, and privacy

Reports are rate-limited per address and per account (`RATE_LIMIT_REPORT`, appeals
`RATE_LIMIT_APPEAL`). A report about a board the sender can't open is refused exactly like one
about a board that doesn't exist, so reports can't probe for private boards. A repeated report of
the same thing by the same person (or address) while the first is open adds nothing. Reporter
addresses are never stored; a keyed hash of the address lets you see one source flooding the
queue. Reporters stay anonymous to the board's owner.

### `/.well-known/security.txt`

Served by the app (RFC 9116) from `SECURITY_CONTACT` / `ABUSE_CONTACT_EMAIL`, with an `Expires`
always about six months ahead and `Canonical` from `PUBLIC_URL`. If a proxy serves static files
in front of the app, make sure `/.well-known/` reaches it.

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
their stated reason, the account id) and records the same event in the audit log: the account's
own chain and the logs of its team workspaces, where their admins see it.

`npm run admin -- api:revoke-all <user id | email>` revokes every API token and app authorisation of an
account at once (a compromised integration, an account being taken back): their next API call is
refused, and it is audited on the account. Turning the whole API off is `PUBLIC_API=false` (restart).

`npm run admin -- references:rebuild [<board id>]` re-derives the references index (backlinks,
"Linked from") from saved board content — every board, or one. For repair after a restore or a
fixed extraction bug; safe while the servers run (their live updates pause meanwhile).

`npm run admin -- search:rebuild [<board id>]` re-derives the search index (dashboard "Inside boards",
`/api/v1/search`, MCP `search`) the same way.

`npm run admin -- audit:verify <workspace id>` re-checks a workspace's audit log chain (also
`u:<user id>` for an account's own chain, `freero` for operator actions on unowned content) and
exits non-zero when it is not intact. Workspace admins run the same check from the admin console
(Audit log → Integrity) and can export the log as CSV or JSON; each export carries every event's
chain position and hashes, so it can be re-checked independently.

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

Open board tabs and notification bells of the ended sessions are disconnected on every instance:
at once when the CLI runs with `REDIS_URL` (it announces the ended sessions there), and in any case
within `SESSION_RECHECK_SECONDS` (default 60), when every instance re-checks the sessions of its
open sockets against the database. No restart is needed.

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
   - *A leaked API token or a misbehaving agent*: the person revokes it (Settings → API tokens /
     Connected apps), a workspace admin blocks it or turns API access off (admin console → API &
     apps), you run `npm run admin -- api:revoke-all <email>`, or `PUBLIC_API=false` stops every
     integration on the instance. Each takes effect on the next call (nothing is cached).
   - *Leaked secret*: rotate `SESSION_SECRET` (below; keep the leaked one as previous only until the
     re-sealing job reports done, minutes), `METRICS_TOKEN`, DB/S3 credentials; to sign everyone
     out, `DELETE FROM sessions;` (open board tabs disconnect within `SESSION_RECHECK_SECONDS`).
4. **Data recovery.** Database: restore the latest dump into a new database and copy the affected
   rows across, or do a full restore (see above). Files: restore non-current object versions.
5. **Afterwards.** Write down timeline, impact, root cause and follow-ups; add a check or alert
   that would have caught it earlier.
