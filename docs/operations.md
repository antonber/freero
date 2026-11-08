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

#### Encrypted dumps

With `BACKUP_GPG_RECIPIENT` (or `BACKUP_AGE_RECIPIENT`) set, `scripts/backup.sh` keeps and uploads
only `freero-<stamp>.dump.gpg` (`.age`): the dump is encrypted to a public key, and the plain file is
deleted right after it was checked. The script refuses to run (before dumping) when the tool or the
public key is missing — it never falls back to a plain dump.

```bash
# once, on the backup host: import the PUBLIC key only
gpg --import freero-backups.pub.asc
BACKUP_GPG_RECIPIENT=backups@example.com DATABASE_URL=… scripts/backup.sh

# restore, on a machine that has the PRIVATE key (keep it offline, e.g. a hardware token):
gpg --decrypt freero-20261027T031500Z.dump.gpg > freero.dump      # age: age -d -i key.txt file.dump.age > freero.dump
pg_restore --no-owner --no-privileges --dbname=… freero.dump && shred -u freero.dump
```

A dump encrypted this way can't be restored, or read, without the private key: test the
decryption as part of the monthly restore test, and keep at least two holders of the key.

### Board backups people make themselves (`.freero`)

Anyone who may export a board ("Download board backup (.freero)" in the board menu) gets a single
file with its content, comments, table cells and the files it shows, and anyone can restore one as
a new board on any Freero ("Restore backup" on the dashboard; the installed app opens `.freero`
files directly). Format, limits and what a restore changes: [board-backup.md](board-backup.md).
Operators only need `MAX_BACKUP_MB` (size, memory) and `RATE_LIMIT_BACKUP`. Downloads follow the
workspace's downloads policy and are in its audit log (`board.exported`, format `freero`); restores
are `board.backup_restored`. They complement, never replace, the database backups above.

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
seals the secrets kept in the database (two-step verification secrets, workspace AI keys, SSO
client secrets, tracker credentials, webhook URLs and secrets, board call links; see
"Encryption baseline"). Session
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
   `SESSION_SECRET_PREVIOUS` is set. Workspace encryption keys on the instance's key (#159) work the
   same way: their data keys open under the previous secret, are wrapped again on use and by the
   `keys:rewrap-instance` job, which logs `keys: every readable workspace data key is wrapped under
   the current SESSION_SECRET …` (and an error naming how many open with no configured secret —
   then put the missing secret back before going on: those workspaces' content depends on it).
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

## Encryption baseline

The data-store table (what is encrypted where, by whom) is in
[deployment.md, "Encryption at rest"](deployment.md#encryption-at-rest). The operator's part:

1. **Database storage.** Managed Postgres: confirm storage encryption is on (it is the default on
   RDS, Cloud SQL, Azure and most others; it can't be turned on for an existing RDS instance —
   restore a snapshot into an encrypted one). Self-hosted / the compose stack: put the Postgres
   volume (`FREERO_DATA_DIR` for PGlite) on an encrypted disk — LUKS (`cryptsetup luksFormat`),
   BitLocker, or the cloud's encrypted block storage — and its snapshots too. Connect with TLS
   (`DATABASE_URL=…?sslmode=require`).
2. **Uploads.** Set `S3_SSE=AES256`, or `S3_SSE=aws:kms` with `S3_SSE_KMS_KEY_ID` to use a key you
   control (grant the app's credentials `kms:GenerateDataKey` and `kms:Decrypt`). Also turn on the
   bucket's default encryption, so objects written by other tools (`mc mirror`, a restore) are
   covered. A startup log line warns when the bucket says it has no default encryption and
   `S3_SSE` is unset. Existing objects keep how they were written: re-encrypt them by copying in
   place (`aws s3 cp s3://b/uploads/ s3://b/uploads/ --recursive --sse AES256`).
3. **Backups.** `BACKUP_GPG_RECIPIENT` or `BACKUP_AGE_RECIPIENT` ("Encrypted dumps" above), and
   SSE + versioning on the backup bucket.
4. **Keys.**
   - `SESSION_SECRET` is the app's one key: everything Freero seals or signs is derived from it
     (HKDF per purpose, `platform/secrets.ts`). Keep it in a secrets manager (not in the image or
     the repository), give it only to the app, and rotate it as described above —
     `SESSION_SECRET_PREVIOUS` keeps old values readable while each owner re-seals them (sign-ins
     for two-step secrets, on use for AI keys / webhooks / tracker credentials, the hourly
     `boards:seal-call-links` job for call links). **Losing it** loses what it sealed: two-step
     secrets (people sign in with a recovery code and set it up again), AI keys, SSO client secrets,
     SAML service-provider keys (admins create a new key and give its certificate to their IdP),
     tracker connections and webhook secrets (admins enter them again), call links (editors paste
     them again). Board content, accounts and files are not affected.
   - The backup private key (GPG / age) never goes on the servers; store it offline with at least
     two holders.
   - KMS keys (bucket, database volume): the provider's key policies; disabling the key makes the
     data unreadable, which is also how to crypto-shred a decommissioned deployment.

What is sealed by the app today (audit, KAI-143):

| Column | Protection |
|---|---|
| `user_totp.secret` (two-step), `ai_workspace_settings` API key, `sso_connections.oidc_client_secret`, `sso_sp_keys.private_key` (SAML service-provider keys, #13), `tracker_connections` credentials + webhook secret, `webhook_endpoints` URL + signing secret, `siem_sinks.secrets_sealed` (HEC token / Entra client secret / bearer token, the HTTPS collector URL, the signing secret), `boards.call_url` | sealed (AES-256-GCM under `SESSION_SECRET`) |
| `users.password_hash`, board link passwords | scrypt |
| `sessions`, `guest_sessions`, `auth_tokens`, `auth_challenges`, `auth_devices`, `api_tokens`, `embed_member_tokens`, `oauth_codes`, OAuth client secrets, `scim_tokens`, `user_recovery_codes`, OIDC / SSO flow `state` | sha256 only |
| `auth_oidc_flows` / `sso_flows` PKCE verifier and nonce | plain, by decision: single use, deleted within minutes, and useless without the authorization code, which is never stored |
| Board documents, layers, comments, search index, events, audit log, notifications, emails and names | plain in the database, protected by storage encryption (deployment.md explains why) — except board documents, update logs, versions and layers of workspaces with an encryption key (next section) |
| `workspace_data_keys.wrapped` | wrapped by the workspace's KEK: sealed under `SESSION_SECRET` (purpose `workspace-kek-v1`) or encrypted by the workspace's AWS KMS key |

## Workspace encryption keys

A team workspace may turn on its own encryption key (admin console → Security → Encryption key;
design: [design/compliance.md §3](design/compliance.md)). Its board content is then stored sealed
(AES-256-GCM) under versioned data keys, each wrapped by the workspace's key-encryption key: the
instance's (derived from `SESSION_SECRET`) or the workspace's own key at AWS KMS, Google Cloud KMS,
Azure Key Vault or Vault Transit (`KMS_*` in [configuration.md](configuration.md#workspace-encryption-keys)).
Files uploaded to its boards are sealed with the same data keys (in 64 KiB chunks, so video still
seeks) and served only through the server, never by a bucket URL.

- **Rolling out.** Turn the feature on only once every instance runs a release that has it: an
  older instance can't open sealed rows (it fails on them — the stored form starts with bytes no
  Yjs decoder accepts, so it never mistakes them for content), so boards of a keyed workspace
  wouldn't open there. `WORKSPACE_KEYS` is off by default: leave it off through the rollout, then set it to `true`.
- **A customer's own key.** They create a symmetric KMS key and allow your `KMS_AWS_*` principal
  `kms:Encrypt` and `kms:Decrypt` on it, conditioned on `kms:EncryptionContext:freero_workspace`
  = their workspace id; then paste its ARN. Freero checks the key both ways before it seals anything.
  Every use shows in their CloudTrail with that context. Google Cloud KMS: a symmetric key, its
  resource name pasted, `roles/cloudkms.cryptoKeyEncrypterDecrypter` for your service account.
  Azure Key Vault: an RSA key (2048+), its URL pasted, wrap key / unwrap key for your app; a key URL
  without a version wraps with its current version and keeps unwrapping older data keys with the
  version that wrapped them. Vault Transit (your own Vault, e.g. self-hosted): one Transit key per
  workspace, its path (`transit/keys/<name>`) pasted.
- **Files.** A file uploaded to a keyed workspace's board is sealed when it is stored; files uploaded
  before the key was turned on, or under an older data key, are sealed again by the `uploads:seal`
  job (every minute, a batch at a time). A board moved to another workspace takes the files only it
  uses to the target's key (a file other boards of the source still show stays the source's). Old
  clients upload without naming the board: those files stay under storage encryption only.
- **Rotation, no downtime.** "Rotate key" re-wraps every data key (under a new KMS key, if one is
  given) and adds a new data key for new content; older content keeps opening and is sealed again
  under the newest data key by the `keys:seal` job (a few boards a minute). Rotating `SESSION_SECRET`
  ("Rotating SESSION_SECRET" above) rotates the instance key: data keys wrapped under the previous
  secret are wrapped again the first time they are used, so keep `SESSION_SECRET_PREVIOUS` until
  every keyed workspace's boards were opened (or rotate those keys from the console).
- **Revocation.** A security admin suspends the key in the console (reversible: Resume), or the
  customer disables the key / revokes the grant at their KMS. Either way the workspace's boards
  close (`key_unavailable` on the dashboard, `workspace_key_unavailable` from the API) and the
  search index and backlinks drop their content. In-app suspension takes effect at once on every
  instance (with `REDIS_URL`); a KMS-side revocation within `WORKSPACE_KEY_CACHE_SECONDS` (the
  `keys:check` probe). When the KMS answers again, the key becomes active by itself.
- **Destroying** (owners, typing the workspace's name) deletes every wrapped data key: the
  workspace's sealed content can never be read again, by anyone, from any backup. That is the
  intended crypto-shredding of a workspace; there is no undo.
- **Loss.** For 'instance' keys, losing `SESSION_SECRET` loses every keyed workspace's content —
  keep it in a secrets manager with a recovery copy. For a KMS key, a key the customer deletes (after
  KMS's waiting period) is gone with everything sealed under it; disabling it only pauses.
- **Database restores** (`pg_dump`) carry the wrapped keys with the content: a restored keyed
  workspace opens as long as its KEK still works (the same `SESSION_SECRET`, or the KMS key).

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
- **Freero's own SAML key** (#13; encrypted assertions, signed requests): created per workspace in
  the console, 10-year self-signed certificate in the SP metadata. Rotation needs no downtime: add
  the next key (both are published and both decrypt), give its certificate to the IdP, make it
  current, remove the old one. Nothing for operators to do, except that the private keys are sealed
  under `SESSION_SECRET` (rotating it re-seals them on use; losing it loses them — see "Keys").
- **Single logout** (#13): the IdP's LogoutRequest at `/api/sso/<workspace>/saml/slo` ends the
  Freero sessions that its SAML sign-in started for that NameID (refusals: `sso.logout_refused`,
  with the reason — unsigned, another key or issuer, another Destination, too old, replayed); signing
  out of Freero sends the browser to the IdP's SingleLogoutService when the connection has one.
- **What is refused** (`sso.login_refused` in the workspace's audit log, with the reason):
  responses that fail signature, audience, recipient, timestamps, InResponseTo or replay checks;
  IdP-initiated (unsolicited) responses unless the workspace turned on "Allow sign-in from the
  identity provider" (then also those not addressed to its ACS by `Destination`, and any second
  post of an assertion ID until its `NotOnOrAfter`); addresses outside the workspace's verified
  domains; deactivated members. With the switch off, the IdP's portal tile can point at
  `/api/sso/<workspace>/start` (SP-initiated); with it on, the tile posts to the ACS and its
  RelayState may name a same-origin path (`/board/<id>`) to land on.
- **Domain control** (Single sign-on tab, any verified domain, SSO or not): "Add new sign-ups",
  "Block other team workspaces", and bringing existing accounts at the domain in after an emailed
  grace period (the `sso:domain-capture` job, every 10 minutes). Only accounts that verified their
  address are listed or taken in. Someone whose account isn't a work account changes its address
  before the date. All of it is in the workspace's audit log (`sso.domain_*`,
  `sso.workspace_creation_refused`).
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
| "How did you find Freero?" answer at sign-up (optional; one of `DISCOVERY_SOURCES`) | `users.discovery_source` (auth) | `account.json` → `profile.discoverySource` | deleted (row) | — |
| Password hash, two-step secret (sealed), recovery codes (sha256) | `users`, `user_totp`, `user_recovery_codes` (auth) | only whether they are set — never the secrets | deleted (cascade) | — |
| Signed-in devices: user agent, IP, sign-in method, times | `sessions`, `auth_devices` (sha256 of a device cookie) (auth) | `account.json` (IP masked) | deleted (cascade) | — |
| Connected sign-in providers / SSO identities (issuer, subject, email) | `auth_identities` (auth) | `account.json` | deleted (cascade) | SSO identities of that workspace stay on the account (inert: the workspace's IdP is gone) |
| Emailed single-use tokens, pending sign-ins, OIDC/SSO flows | `auth_tokens`, `auth_challenges`, `auth_oidc_flows`, `sso_flows` | no (transient, minutes to days) | deleted (cascade) / expire | `sso_flows` deleted (cascade) |
| Workspaces, organisations (#108), roles, project memberships, groups (#63), invitations sent/received | `workspaces`, `workspace_members`, `project_members`, `workspace_groups` / `workspace_group_members` / `project_groups`, `workspace_invites` (workspaces); boards shared with groups: `board_group_grants` (members) | `memberships.json` | personal workspace deleted; sole-owned teams and organisations handed over (or deleted / dissolved when empty) | deleted (cascade) |
| Board memberships and invitations | `board_members`, `board_invites` (members) | `memberships.json` | deleted (cascade) | deleted with the boards |
| Boards they own: content, comments, version history, layers (incl. their private drafts) | `boards`, `board_docs`, `board_doc_updates`, `board_doc_snapshots`, `board_layers`, `board_layer_updates` (boards, realtime) | `boards/<title>-<id>/board.json` + `board.yjs` + images (docs, KAI-162: the same, plus `doc.md`) | deleted (team boards: handed to a team owner first) | deleted (trash included) |
| Comments they wrote on others' boards | inside those boards' docs (realtime) | `comments.json` (with board, thread and pinned item) | author shown as "Deleted user" (name and colour replaced in every board they could reach) | deleted with the boards |
| Stars, last-opened times | `board_stars`, `board_opens` (boards) | `activity.json` | deleted (cascade) | deleted with the boards |
| Files they uploaded (images, PDFs) | object storage + `uploads` (uploads) | `uploads/` (up to 200 MB of files per export; the rest listed in `files-not-included.json`) | row deleted; the file stays while a board, template or avatar elsewhere uses it, then the uploads sweep deletes it (≤ 24 h after the last reference) | files only those boards used: swept within a day |
| Walkthroughs they recorded (their voice, maybe their face: the recording is an upload; the camera path, title, captions), their comments on walkthroughs, which ones they watched | `walkthroughs`, `walkthrough_comments`, `walkthrough_views` (walkthroughs) | `walkthroughs.json` (recordings under `uploads/`) | their walkthroughs deleted (cascade), so the recordings are swept within a day; their comments stay unattributed ("Deleted user"); views deleted | deleted with the boards |
| Issue-tracker connections they made for themselves (tracker, name, address, the tracker account, field map; credentials sealed) and the issues they linked to board items (key, address, board, items) | `tracker_connections` (owner_id), `tracker_links`, `tracker_link_sources` (trackers) | `trackers.json` — never tokens, OAuth tokens or webhook secrets (#43) | deleted (cascade); their credentials are erased already when they are signed out everywhere | a team's connections are in the workspace export (`workspace.json` → `trackers`, same rule) and deleted with it (cascade) |
| Decision snapshots they made (title, note) | `decisions` (decisions; the content is a board version) | `decisions.json` | kept, maker cleared (SET NULL): a decision is the board's record | deleted with the boards |
| Saved templates | `templates` (templates) | `templates/` | deleted (cascade); shared ones go too | shared-with-team link cleared (the owner's template stays) |
| Notifications and email preferences; pending mentions; task cards assigned to them with a due date (reminders) | `notifications`, `notification_prefs`, `pending_mentions`, `card_due_watch` (notifications) | `notifications.json` (the reminder list is not: it mirrors the boards' cards) | deleted (cascade) | notifications about its boards: deleted with the boards |
| The Slack account they connected (#105: Slack workspace and user ids, names, the app's direct-message channel with them; never a token of theirs) and their Slack switches per notification type | `slack_user_links` (slack), `notification_prefs.slack` (notifications) | `slack.json`, `notifications.json` → `slackSettings` | deleted (cascade) | — |
| Answers, questions and upvotes in live activities (anonymous ones too: kept by the server only, never in the board) | `engage_answers`, `engage_questions`, `engage_upvotes` (engage) | `activities.json` | answers and upvotes deleted; questions stay on the boards without a name | deleted with the boards |
| What boards say, as a search index (board titles, item text, comments — never private drafts or hidden frames) | `search_entries`, `search_sources` (search; derived from the boards) | no (a copy of the boards) | comment rows re-derived on the next save of each board (the author is not stored) | deleted with the boards |
| Events about boards (who did what, item and comment text up to 280 characters), webhook delivery bodies | `events` (events), `webhook_deliveries` (webhooks) | no | kept until retention (`EVENTS_RETENTION_DAYS`, deliveries 30 days); no foreign keys, like the audit log | events kept until retention; endpoints and deliveries deleted (cascade) |
| Board links unlocked with their password (when) | `board_link_unlocks` (boards) | no (an access fact, not content) | deleted | deleted with the boards |
| What a directory sent about them (SCIM userName, externalId, name, email, active) | `scim_users`, `scim_group_members` (scim) | `memberships.json` → `directoryRecords` | deleted (cascade) | deleted (cascade) |
| Break-glass role | `sso_connections.break_glass_user_id` (sso) | `memberships.json` → `singleSignOn` | cleared (SET NULL) | deleted (cascade) |
| A workspace's pending capture of their account (domain control: the address, when they join, who started it) | `sso_domain_captures` (sso) | `memberships.json` → `singleSignOn` (`joinsAt`) | deleted (cascade) | deleted (cascade) |
| Community listings they submitted to Apps & agents (name, description, links, category, the OAuth app named, the contact address for reviewers, review status and the reviewer's note) | `marketplace_listings` (marketplace) | `listings.json` | deleted (cascade) | — |
| Abuse reports they filed, moderation actions about their content or account (suspension) | `moderation_items`, `moderation_actions` (moderation; reporter address only as an HMAC), `users.suspended_at` (auth) | not yet (follow-up: KAI-191) | person references cleared (SET NULL); the records stay as the operators' trail | items about its boards stay with their recorded target |
| Problem reports they sent with “Report a problem”: the note, whether they may be contacted, a screenshot of their screen (unless they removed it), diagnostics (page path, board and role, release, browser, window size, scrubbed recent errors), the status and operators' note | `problem_reports` (problems) + screenshots in the private storage area (`confidential.<random>.<ext>`, never under `/uploads/`) | `problems/index.json` + `problems/<id>.<ext>` (the operators' note is not included) | deleted with their screenshots | — |
| API tokens (sha256 only, name, scopes, times), apps they authorised (consents, codes, access/refresh tokens), apps they registered; where their credentials were used in team workspaces | `api_tokens`, `oauth_grants`, `oauth_codes`, `oauth_clients`, `api_workspace_credentials` (apiauth) | `api.json` (never a secret or hash) | deleted (cascade); revoked already when deletion is scheduled (signed out everywhere) | usage rows deleted (cascade) |
| Legal holds (#157): eDiscovery cases naming them as a custodian (case name, notes, who opened / released it), the holds on their boards, and case exports (every board in scope in full, with versions and the audit events about it and the custodians) | `legal_cases`, `legal_case_subjects`, `legal_case_workspaces`, `legal_case_exports` + private ZIP files (ediscovery); `board_legal_holds`, `board_owner_legal_holds` (boards) | no: a legal matter of the workspace, not the person's data (a hold is kept silent from its custodians) | **waits** while a hold names them or keeps a board they own: nothing is deleted or handed over until the case is released; the account stays signed out | refused (409 `legal_hold`) while anything there is held; a case's own record has no foreign key and outlives the workspace |
| Data exports | `data_exports` + private ZIP files (privacy, uploads) | listed in `activity.json` | rows and files deleted by the export job within `DATA_EXPORT_INTERVAL_SECONDS` | workspace exports' rows and files deleted by the job |
| Request logs | stdout (pino) → your log pipeline | no | not touched: user ids and IP addresses (never emails, bodies, query strings or tokens) — expire them in your log retention | — |
| Audit log (sign-ins, sharing, exports, every API / MCP call: actor, IP, target, outcome) — and what was streamed to a workspace's SIEM (a copy outside Freero, under the customer's retention) | `audit_events`, `audit_chains`, `audit_anchors` (audit) | no (team admins read and export the workspace's log in the admin console) | kept until retention (`DEFAULT_AUDIT_RETENTION_DAYS`, a workspace's `auditRetentionDays`); actor read as "Deleted user"; no foreign keys | the workspace's chain kept until the default retention |
| Board activity feed (who changed what kind of item, when) | `board_activity` (activity) | no | 90 days | deleted with the boards |
| Guest sessions (a name, the board, sha256 of the cookie) | `guest_sessions` (auth) | — | — (no account) | expire after `GUEST_SESSION_HOURS` |
| Boards they signed in to from an embed on another site (the board, which session, sha256 of the token; #2) | `embed_member_tokens` (embed) | no (a sign-in fact, like a session) | useless once their sessions are deleted; rows purged within an hour of expiry (7 days at most) | — |
| Error reports (`ERROR_REPORTING_DSN`): the error, request method and path, account id | the Sentry-compatible service you configure | no | outside Freero (that service's retention) | — |
| Google Analytics (`GA_MEASUREMENT_ID`, unless the browser opted out or sends GPC / Do Not Track): pseudonymous `_ga` / `_ga_<id>` cookies, the route with ids removed (`/board`), a generic title, the referring origin, browser, device and coarse location, events `sign_up` / `login` (method), `board_created`, `template_used` (public template id); an opt-out in the browser's local storage (`freero:analytics-off`) | Google (processor) via `/analytics.js` and the app's `/analytics-frame` (modules/analytics, web `app/analytics`) | no (Freero holds none of it) | outside Freero: no account id is ever sent, so nothing links it to the account; GA's own data retention setting applies | — |
| PostHog product events (`POSTHOG_KEY`, unless the account opted out or the request's browser opted out or sends GPC / Do Not Track): the closed event list with its properties (ARCHITECTURE.md "Product analytics"), keyed by an HMAC of the account id (and a workspace's id) under `SESSION_SECRET`; no IP, no GeoIP | PostHog (processor), sent by the server (modules/analytics `productEvents.ts`); the account's opt-out in `analytics_opt_outs` (analytics) | no (the opt-out is a preference) | the opt-out row goes with the account; events stay in PostHog under a pseudonym the deleted id can no longer be matched to from Freero's data (backups aside); PostHog's retention applies — delete the person there for an erasure request (`npm run admin` has no command for it; the pseudonym is `HMAC-SHA256(SESSION_SECRET, 'analytics.account:<id>')`) | — |
| Fonts | self-hosted by the app and the marketing site (`scripts/fonts.mjs`): no font request leaves the deployment | no | — | — |
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
  refused (409) and nothing is removed — ediscovery registers it for organisations with an open
  case. **Legal holds** (#157, admin console → Legal holds; owners and admins with both the
  security and content scopes): while a case keeps a board, no path deletes it — the trash purge
  and retention rules skip it, "delete forever" only hides it, version thinning and audit
  retention keep everything, the account purge waits, a team workspace holding it can't be deleted
  and its encryption key can't be destroyed; the database itself refuses `DELETE FROM boards` of a
  held board (trigger `boards_legal_hold_guard`, error code `FH001`). An operator who must remove a
  held board (illegal content) takes it down — nobody sees it then — and has the case released or
  narrowed by the workspace's admins before deleting it for good (`board.delete` answers 409
  `legal_hold` meanwhile).
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
- **Listings** (`/operator?view=listings`, #87): community integrations submitted for the Apps &
  agents page. A submission is seen by nobody but its submitter and operators until you
  **Approve** it (it is then live, labelled Community) or **Decline** it (with a statement saying
  why; the submitter can withdraw it and submit again). Live ones can be **Featured** (listed
  first in the app) or **Removed** (a statement is required, and the developer can appeal);
  **Restore** undoes a removal. Each card shows the submitter, their contact address for
  reviewers, the website and docs links, the OAuth app it names (one the submitter registered:
  its redirect addresses are listed) and its open reports. Operators are mailed for every new
  submission. Reports about a live listing arrive in the queue like any report.
  Submissions need a verified address and are limited per person (`RATE_LIMIT_LISTING_SUBMIT`,
  and at most 10 waiting or live at once). Every decision is an action like the others below:
  recorded, audited (`moderation.listing.*`, in the submitter's account log and their teams'),
  and emailed to the developer.
- **Community templates** (#162, the **Templates** tab): boards people submitted to the public
  template gallery. Each card shows the preview drawn from the copy Freero made (only the board's
  shared content: no comments, hidden frames, private drafts or people's names), its title,
  description, category, licence (CC BY 4.0 or CC0), who to credit, the submitter and open reports.
  **Approve** puts it on the public `/gallery` pages (indexable, in `/sitemap-community.xml`) and
  lets anyone install a copy; **Decline** (with a statement) keeps it hidden; **Remove** takes a
  public one down — its page, preview and install answer 404 at once — and is appealable;
  **Restore** undoes it. Reports about public templates arrive in the queue. Submissions need a
  verified address and are limited per person (`RATE_LIMIT_GALLERY_SUBMIT`, at most 20 waiting or
  public at once). Decisions are audited as `moderation.gallery.*` and emailed to the submitter.
  Nothing is public on a server whose operators never approve anything (no `OPERATOR_EMAILS`).

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

While an account is suspended, its community listings and templates are not shown to anyone (lists,
pages, previews, installs, reports answer as if they didn't exist); your decisions on them are kept,
and they are back as they were when the suspension is lifted. An appeal against a decision that
can't be undone any more — the file's kept copy or the board was deleted for good, the listing or
template withdrawn — is refused with that explanation.

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

### Problem reports (“Report a problem”)

Bugs and confusion, not abuse: people send them from the board menu, the help menu (dashboard,
settings), the account menu or Ctrl+Alt+P (⌘⌥P). Each holds the note, an optional screenshot of
what they saw (private storage area, never under `/uploads/`), and diagnostics the dialog lists
(scrubbed of query strings, tokens and email addresses, in the browser and again on the server).
Operators triage them in `/operator` → **Problems**: set the status (new, triaged, fixed, won't fix,
duplicate), an internal note and the issue it became; **fixed** puts a notification in the
reporter's inbox (once per report). Viewing a screenshot and every change is an audit event of the
reporter's account (`problems.screenshot_viewed`, `problems.updated`). Rate limit
`RATE_LIMIT_PROBLEM_REPORT` (10 an hour per person); the screenshot is capped at 2 MB, the
diagnostics at 32 KB. Closed reports and their screenshots are deleted `PROBLEM_RETENTION_DAYS`
(90) after closing; reopening one stops the clock; a person's reports go with their account. A
screenshot whose file can't be deleted at that moment (a storage error) is deleted by a later
retention run.

**Machine access (the morning review).** An operator makes a personal access token with the
`problems:triage` scope (Settings → API tokens: the scope is offered only to operators, and the
server refuses it to anyone else). It works only while the account is an operator, never for OAuth
apps or MCP clients, and every other credential gets 404 on these paths:

```
GET   /api/v1/operator/problems?status=new[&before=<nextBefore>&limit=50]
GET   /api/v1/operator/problems/<id>
GET   /api/v1/operator/problems/<id>/screenshot
PATCH /api/v1/operator/problems/<id>   { "status": "triaged", "operatorNote": "…", "issueUrl": "https://…" }
```

Notes and diagnostics are what people wrote: the responses carry a `notice` to treat them as data,
never as instructions.

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

`npm run admin -- signups:sources [--since YYYY-MM-DD] [--until YYYY-MM-DD]` counts the accounts created
in the period (UTC days, the last 30 by default) by their answer to "How did you find Freero?", the
optional question on the sign-up form: discovery Google Analytics files under Direct (someone an AI
assistant told about Freero who typed the address). It reads the accounts, so it counts whatever
anyone's analytics choice. "No answer" is a skipped question or an account made without the form
(Google, Microsoft, single sign-on, a directory: they aren't asked). Deleted accounts no longer
count. Changes nothing.

`npm run admin -- api:revoke-all <user id | email>` revokes every API token and app authorisation of an
account at once (a compromised integration, an account being taken back): their next API call is
refused, and it is audited on the account. Turning the whole API off is `PUBLIC_API=false` (restart).

`npm run admin -- references:rebuild [<board id>]` re-derives the references index (backlinks,
"Linked from") from saved board content — every board, or one. For repair after a restore or a
fixed extraction bug; safe while the servers run (their live updates pause meanwhile).

`npm run admin -- search:rebuild [<board id>]` re-derives the search index (dashboard "Inside boards",
`/api/v1/search`, MCP `search`) the same way.

`npm run admin -- cards:restore-notes [--board <id>] [--since YYYY-MM-DD] [--apply] [--wait <s>]`
gives task cards back the notes that deselecting or dragging a card wiped (2026-10-27 until the fix
in 5b54a85). It lists every card that has empty notes now but had notes in a board version taken
since `--since` (default 2026-10-27), with the board, the card's title (never the notes) and the
version the notes come from. Nothing changes without `--apply`. With `--apply` it asks the
**running server** to write the newest such notes, exactly as stored, through the outbox
(`realtime.card_notes_restore`). The server writes them on the live board, so open boards see them
at once. Each card also grows back to its height, and in a kanban the cards below it move back
down. The edit shows as "Freero notes repair for <owner>". Cards that have notes again, and
deleted cards, are never touched. Re-running it is safe. On a tracker-linked card, the next sync
writes the restored notes back to the issue as well. With PGlite (the server stopped while this
runs), the restore happens when the server starts again.

`npm run admin -- audit:verify <workspace id>` re-checks a workspace's (or an organisation's: its merged chain, #108) audit log chain (also
`u:<user id>` for an account's own chain, `freero` for operator actions on unowned content) and
exits non-zero when it is not intact. Workspace admins run the same check from the admin console
(Audit log → Integrity) and can export the log as CSV or JSON; each export carries every event's
chain position and hashes, so it can be re-checked independently. Every hour the `audit:anchor`
job signs the head of each chain that moved (HMAC under `SESSION_SECRET`, kept in
`audit_anchors`); the check compares every checkpoint still in retention with the stored event,
so a log rewritten wholesale by someone with database access (events and head consistent) fails
unless they also hold the server's secret. Rotating `SESSION_SECRET` keeps old checkpoints valid
while the previous secret is listed in `SESSION_SECRET_PREVIOUS`. Workspaces that stream to a
SIEM also hold the chain (every event's hashes plus hourly signed `freero.audit.head` records)
outside this database.

### Audit log streams (SIEM)

Workspace admins add streams in the admin console (Audit log tab). The `siem:deliver` job (every
5 s, one instance at a time) sends each stream the events after its cursor in order; a failure
is retried with backoff (`SIEM_RETRY_BASE_MS`, at most 6 h apart) from the same event, so a SIEM
that was down gets the backlog in order once it is back. Formats:

- **Splunk**: HEC events (`POST <url>/services/collector/event`, `Authorization: Splunk <token>`),
  `sourcetype` `freero:audit` unless set, `event` = the record below.
- **Microsoft Sentinel**: an Entra ID app (client credentials) with the *Monitoring Metrics
  Publisher* role on a data collection rule whose stream has the columns `TimeGenerated`,
  `RecordType`, `EventId`, `Action`, `Description`, `WorkspaceId`, `ActorId`, `ActorName`,
  `ActorEmail`, `TargetType`, `TargetId`, `TargetLabel`, `IpAddress`, `UserAgent`, `Metadata`
  (dynamic), `Chain`, `Seq` (long), `PrevHash`, `Hash`, `Signature`.
- **HTTPS**: `POST` of `{ source, workspaceId, records: [...] }` with
  `Freero-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">` (the secret is shown once) and
  an optional bearer token.
- **Syslog over TLS** (RFC 5425, port 6514 by default): one RFC 5424 message per record, facility
  13 (log audit), the record as JSON. The server certificate is verified (public CAs, or the CA
  PEM given). Syslog has no acknowledgement: a record counts as sent once TLS accepted it.

A record is `{ type: "freero.audit.event", time, description, ...AuditEvent }` (id, action, actor,
target, ip, userAgent, metadata, chain, seq, prevHash, hash), or `{ type: "freero.audit.head",
chain, seq, hash, time, signature }` (the head, signed like the checkpoints above), or
`freero.audit.test` from "Send test". A new stream starts at the current end of the log (export
the history from the console).

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
