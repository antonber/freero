# Compliance: legal holds, classification labels, workspace keys and SAML hardening

Status: **built** (with the gaps each section's "Built / left" lists) for #157 (eDiscovery and
legal holds), #158 (classification labels), #159 (per-workspace encryption keys) and #13 (SAML
encrypted assertions, signed AuthnRequests, single logout). The sections are independent and
shipped as separate commits.

Shared ground: organisations (docs/design/organisations.md) are directory-only `workspaces` rows
whose policies are floors for their workspaces; admin roles (#151) split admins into `members`,
`content` and `security` scopes; the audit log (`recordAudit`) is append-only and hash-chained.
Every feature below follows the same three rules:

1. **Enforced where the work is done, by the module that owns the data.** A UI hides what it
   can't do; the server refuses it. The REST API, MCP, embeds, guests and jobs reach the same
   checks because they call the same functions.
2. **Fail closed.** A check that throws keeps the data (holds), refuses the access (labels) or
   refuses to decrypt (keys) — never the opposite.
3. **Audited in the transaction of the change**, in the workspace's chain (and so its
   organisation's).

---

## 1. Legal holds and eDiscovery cases (#157)

### What we want

A workspace's legal or compliance team opens a **case**, names the **custodians** (people) and/or
**boards** it covers, and from then on nothing in scope can be purged by anyone — not the trash,
not retention rules, not an owner's "delete forever", not the account purge, not workspace
deletion, not version thinning, not audit retention. The case exports everything in scope for
review. Releasing the hold is audited, and normal retention resumes.

### Model

```
modules/ediscovery          legal_cases (id, workspace_id → workspaces, name, description,
                              created_by, created_at, released_at, released_by)
                            legal_case_exports (id, case_id, upload, status, requested_by, …)
modules/boards              board_legal_holds (hold_id, board_id → boards ON DELETE RESTRICT)
  (the enforcer)            board_owner_legal_holds (hold_id, workspace_id, owner_id)
                            boards.discarded_at  ("deleted forever" while held: hidden, kept)
```

- **A case belongs to one team workspace or one organisation** (its place). A case of an
  organisation covers the workspaces attached to it when the hold is placed (one owner row per
  workspace and custodian); "Refresh scope" re-places it after a workspace was attached.
- **Scope**: custodians (every board the person owns in the case's workspaces — now, later, trash
  included) and explicit boards. Both are rows in boards' tables, keyed by an opaque hold id (=
  the case id), so the case module never duplicates the board list.
- **Why boards owns the hold rows**: only `modules/boards` deletes boards, so the hold must be
  checkable in boards' own SQL — and, as the last line, in the database itself:
  - `BEFORE DELETE ON boards` trigger: refuses (raises) when the board has a `board_legal_holds`
    row or its `(owner_id, workspace_id)` is under a `board_owner_legal_holds` row. This catches
    every path, including ON DELETE CASCADE from a deleted account or workspace, raw SQL in a
    future module, and the operator CLI.
  - `BEFORE UPDATE OF owner_id, workspace_id ON boards` trigger: a board leaving a held owner (a
    transfer, the account purge's hand-over, a move to another workspace) gets its own
    `board_legal_holds` row first, so a custodian's board stays held wherever it goes.
  - Both triggers only read and write boards' own tables, so [S3]/[S4] hold.
- **Single writers**: the hold rows — boards' repo (`placeLegalHold(holdId, scope)`,
  `releaseLegalHold(holdId)`), called only by ediscovery's service; the case rows — ediscovery's
  repo.

### Every purge path, and what it does with a held board

| Path | Owner of the path | Behaviour while held |
|---|---|---|
| Trash purge job (`boards:trash-purge`) | boards | Skips held boards (SQL `NOT EXISTS`), purges them on the first round after release |
| "Delete forever" (owner, admin trash) | boards | Answers as if done; the board gets `discarded_at` and disappears for everyone but the case |
| Inactive-board retention (`boards:retention`) | boards | Held boards are never archived or trashed (`heldAmong` reads the hold rows itself) |
| Account purge (`accounts`) | accounts | Waits (`'held'`, like a moderation hold) while the person is a custodian or owns a held board; the account stays signed out |
| Workspace / organisation deletion | workspaces | 409 `legal_hold` naming no case (the reason is "a legal hold"), through `onWorkspaceDeletionHold` |
| Version thinning and version-history retention (`realtime` prune) | realtime | Skips held boards entirely (seam `onSnapshotRetentionHold`, registered by ediscovery; a failing check skips every board) |
| Audit retention (`audit:retention`) | audit | Skips the chains of workspaces with an open case and the account chains of custodians (seam `onAuditRetentionHold`) |
| Operator "delete for good" of a taken-down board | boards (moderation) | Refused with the case's id in the CLI output; the operator releases or narrows the case first |
| Uploads sweep | uploads | Nothing new: a held board's stored doc and versions keep referencing its files |

The trigger turns any path missed in this table into a failed transaction (500), never a lost
board.

**Silence.** Custodians are not told. A held board behaves normally for its people — trashing,
restoring and "delete forever" all appear to work — so a hold can't be inferred from the app,
except that a workspace with a held board can't be deleted (unavoidable; the message says "a
legal hold", not which).

### Who

Owners, and admins with **both** `security` and `content` scopes (a case reveals and exports all
of its boards' content, so a security-only admin, who counts as a member for content, can't open
one). For an organisation: its owners and admins with both scopes. Case actions are audited in
the place's chain: `legal_hold.created`, `legal_hold.scope_changed`, `legal_hold.released`,
`legal_hold.exported`, plus `board.discarded` when a held board is "deleted forever".

### Case export

A zip (`fflate`), built in the background and stored as uploads' private file (never served at
`/uploads/`, like data exports), downloadable by whoever may manage the case for 7 days:

- `case.json` — the case, its custodians and boards, when it was exported and by whom;
- per board `boards/<id>/board.json` (row metadata, members) and `content.json` (the shared doc
  AND every layer — an eDiscovery export is not "as one person sees it"; drafts are part of the
  record), `versions/<snapshotId>.json` for every kept version, `comments.json`;
- `audit.json` — the events of the place's chain naming a board in scope or a custodian.

Every file's sha256 is listed in `manifest.json`, so a reviewer can show the export wasn't altered.

### Release

`POST …/cases/:id/release` deletes the case's hold rows in one transaction with `released_at` and
the audit event; a board still held by another case stays held. Released cases stay listed (and
exportable) for the record.

### Built / left

Built as designed: `modules/ediscovery` (cases, scope changes, release, the export job and its
archive), boards' hold rows and trigger (migration `202611301000_board_legal_holds.sql`), the purge
paths in the table, the realtime and audit retention holds, and the admin console's Legal holds
tab. One path was added to the table while building: destroying a workspace's encryption key
(#159) is crypto-shredding, so it is refused (409 `legal_hold`) while anything there is held.
Tests: `boards/legalHolds.test.ts` (every purge path, a raw DELETE, hand-overs, who manages cases,
scope), `realtime/retention.test.ts` (versions kept; a failing check keeps them),
`audit/audit.test.ts` (held chains; fail closed), `ediscovery/cases.test.ts` (export content and
manifest hashes).

Left: the organisation console has no Legal holds tab yet (the API serves organisations; cases of
an organisation are created through `POST /api/workspaces/:orgId/legal-cases`); comments of a
custodian whose account is purged after release are anonymised as usual (the export made while
held keeps their names); a case's custodian list is limited to members of the covered workspaces
(former members' boards were handed over and are reached as explicit boards).

---

## 2. Classification labels (#158)

### What we want

Admins define labels — "Public", "Internal", "Confidential" — each with **caps**: the most a board
carrying it may allow, whatever its workspace allows. Owners pick a board's label; admins can
require one. The caps are enforced on the server, for every way in: the app, the public API, MCP,
the embed page and oEmbed, guests and links.

### Model

```
modules/workspaces   workspace_labels (id, workspace_id → workspaces (team or organisation),
                       name, color, description, caps jsonb, position, created_at)
                     workspace_label_settings (required, default_label_id; an org's required is a floor)
modules/boards       boards.label_id → workspace_labels ON DELETE RESTRICT
```

- **Caps are a partial set of the floored policies** — `linkSharing`, `publicLinks`,
  `externalSharing`, `downloads`, `boardEmbeds`, `liveEmbeds`, `linkPassword`, `linkMaxDays` —
  plus one board-level cap, `viewerExports: 'off'` (viewers and commenters may never copy or
  export, whatever the board's own switch says).
- **One place applies them**: `boardAccessLoader` (the one function every access decision, list,
  search, API, MCP, embed and socket admission goes through) raises the board's effective policies
  by its label's caps with the same `strictestPolicies` an organisation's floors use. Every
  enforcement point already reads `access.policies` / `maxLink` / `anonymousLinks` /
  `outsidersBlocked`, so a label is enforced wherever the policy is — including on links and
  embeds that were turned on before the label was set (the resolved role is capped, the stored
  setting is left alone so removing the label restores it).
- **Labels of an organisation** are available to all its workspaces (listed after the workspace's
  own); an organisation can require a label in all of them (a floor). Only the place that defines
  a label edits it.
- **Picking a label**: whoever manages the board's sharing (owner, co-owner) and the workspace's
  content admins: `PUT /boards/:id/label { labelId }`. Any change is audited `board.label_changed`
  (from → to). While the workspace requires a label, a board can't be left without one, and new
  boards there get the default label.
- **Copying or moving a board** (#124) keeps its label. Where the label doesn't apply (another
  workspace that neither defines it nor belongs to its organisation) the copy or move is refused
  (403 `label_restricted`) — otherwise duplicating a Confidential board into a personal workspace
  would shed its caps. A label that caps nothing simply drops (the target's default applies).
- **Deleting a label** in use is refused (409, with how many boards carry it): relabel first.

### Sensitive-data scan (optional, lower priority)

A workspace setting (off by default) runs a detector over board text when boards change (the
outbox, like search): payment card numbers (Luhn-checked), IBANs (mod-97), US SSNs and UK NI
numbers in their formats. Findings — board, item, kind, never the matched text — go to the
workspace's admins (a notification and a list in the console). Nothing leaves the instance.

### Built / left

Built: labels with caps (`workspaces/labels.ts`; the required-label and default settings live in
their own table, `workspace_label_settings`, rather than as `WorkspaceSettings` columns), the caps in
`boardAccessLoader` (`withLabelCaps`; an unknown label id caps everything), `viewerExports` in
`boardLetsCopy`, `PUT /boards/:id/label`, defaults on new boards, copies and moves that keep the
label (or are refused), re-resolved sockets when a board's label or a label's caps change, the
admin console's Classification tab (workspace and organisation) and the label in the share dialog.
Tests: `boards/labels.test.ts` (every way in capped at once — link, visitors, API/MCP export and
share, embed — for settings made before the label; copies, moves, required labels, who may relabel,
the audit record).

Left: **the sensitive-data scan is not built** (the issue marks it optional and lower priority;
the design above stands). The label is shown in the share dialog only — not yet as a badge on the
board's top bar or the dashboard cards.

---

## 3. Workspace encryption keys (#159)

### What we want

On a shared instance, a regulated workspace's board content is encrypted with keys only usable
through a key it controls: an instance-managed key by default, its own cloud KMS key (AWS KMS
first) when it brings one. Revoking the key makes the content unreadable — the app says so — and
rotating it never takes the workspace down.

### Envelope

```
KEK  key-encryption key   per workspace; never leaves its provider
       provider 'instance': platform/secrets seal (HKDF of SESSION_SECRET, purpose
                            'workspace-kek-v1'), the workspace id sealed in with the DEK;
                            rotates with SESSION_SECRET (re-wrapped on first use)
       provider 'aws-kms':  the workspace's CMK (ARN); Encrypt/Decrypt with encryption context
                            { freero_workspace: <id> }; credentials = the operator's AWS principal
                            (KMS_AWS_*), which the customer's key policy grants (cross-account)
DEK  data-encryption key  per workspace, versioned (workspace_data_keys: workspace_id, version,
                            wrapped DEK, kek ref, created_at); 256-bit, AES-256-GCM
data                     each sealed row names its DEK (`sealed_with` = '<workspaceId>:<version>');
                            the blob is SEALED_PREFIX | nonce | tag | ciphertext, and its additional
                            data binds it to (workspace, board, table, layer): a blob copied to
                            another board, table, workspace or person's private layer never opens
```

- **Covered**: every Yjs blob realtime stores — `board_docs.state`, `board_doc_updates.data`,
  `board_doc_snapshots.state`, `board_layers.state`, `board_layer_updates.data` — so documents,
  comments, version history, private drafts and the editors layer. All of it goes through
  `realtime/repo.ts`, which seals on write (`realtime/sealing.ts`) and opens on read; a write for a
  keyed workspace whose key can't be used throws and writes nothing.
- **Not covered (metadata)**: board titles and descriptions, members, the audit log, and uploaded
  files (still storage-encrypted only; see "Left"). Thumbnails are not stored for keyed
  workspaces. Derived plaintext — the search index, backlinks — exists while the key is usable;
  when it is suspended, destroyed or refused (not on a mere network blip, which throws and is
  retried), realtime's stored readers read the board as empty and every state change re-raises
  each board's content event in its transaction, so those indexes derive nothing (and rebuild
  when the key is back). The event stream derives no events meanwhile (an unreadable board is no
  deletion of every item); events already recorded, with their item texts, stay until
  `EVENTS_RETENTION_DAYS`. Copies people make on purpose
  — duplicates into other workspaces, templates, `.freero` backups, exports — are content leaving
  the workspace and follow the downloads policy as before.
- **What used to need plaintext** (docs/deployment.md "Why board content is not sealed by the
  app"): the uploads sweep, usage and account purge find files by SQL pattern in stored docs —
  sealed rows add the file names they reference to `board_sealed_refs` in the same transaction,
  which those scans read, whether or not the key is usable now (grows with the board, goes with it;
  over-keeping a file is the safe side); search and backlinks index through the outbox from the
  opened doc as before; `pg_dump` restores work as long as the KEK does.
- **Moves**: moving a board into another workspace reseals every stored row for the target's DEK
  (or opens it, for a target without a key) before the move commits, and again after it for saves
  in between; refused (`workspace_key_unavailable`) when either key can't be used. A row is only
  ever opened with the key it names, so a save racing a move stays readable — under the source's
  key until the `keys:seal` job or the next move reseals it.
- **Rolling deploys**: `SEALED_PREFIX` is nine 0xFF bytes, a Yjs varint no decoder accepts, so an
  older release reading a sealed row fails at once instead of applying ciphertext as content (and
  compacting it away). Turn the feature on after every instance runs it (`WORKSPACE_KEYS`).

### Rotation and revocation

- **KEK rotation** ("Rotate key", optionally naming a new KMS key ARN, or switching between the
  instance's key and a KMS key): every DEK version is unwrapped and wrapped again under the new KEK
  and a new DEK version is added for new writes, in one transaction — no content touched, no
  downtime. `SESSION_SECRET` rotation rotates the instance KEK: a DEK unwrapped under a previous
  secret is wrapped again on the spot.
- **DEK rotation**: part of every rotation. Old blobs keep opening with their version; the
  `keys:seal` job (every minute, a few boards per round) seals them again under the newest one —
  also content stored before the key was turned on.
- **Revocation**: in Freero ("Suspend", security admins; reversible with "Resume", which first
  proves the KEK still answers) or at the customer's KMS (disable / delete the key, revoke the
  grant: the next unwrap or the `keys:check` probe — every half `WORKSPACE_KEY_CACHE_SECONDS` —
  marks it `unavailable`; it turns `active` again by itself once the KMS answers). Either way the
  workspace's `blocked` is `key_unavailable` (REST, lists, search, MCP, embeds, sockets), boards
  answer 403 `workspace_key_unavailable`, and the dashboard and board page say why. A state change
  invalidates every instance's key rows (pubsub), so opening stops at once everywhere; a DEK
  already cached may still seal an open room's last save as it closes (sealing exposes nothing).
- **Destroy** (crypto-shredding): deletes every wrapped DEK. Irreversible: the content is gone for
  good, backups included; the workspace stays closed. Owners only, with the workspace's name typed.

### Failure modes and costs

| Situation | Behaviour |
|---|---|
| KMS unreachable, DEK cached | Works until the cache expires |
| KMS unreachable, not cached | Boards don't open (`workspace_key_unavailable`, try again); the key's state doesn't change on a network error; open rooms keep edits in memory and retry saving; nothing is written in plaintext |
| Key disabled / grant revoked at the KMS | `unavailable` within one probe period; open again by itself when the customer restores access; a deleted CMK means the content is lost |
| `SESSION_SECRET` lost ('instance') | Every instance-keyed workspace is lost — as every sealed secret is today; keep it in a secret manager |
| Cost (measured, Node 22, one core) | Sealing ~0.4 ms per 200 KB (≈ 3.3 ms per 2 MB), opening ≈ 0.3 / 1.8 ms; one extra indexed read per write (the board's workspace); one KMS Decrypt per DEK version per instance per cache period, plus the probe |

### Built / left

Built: `modules/keys` (tables, envelope, instance and AWS KMS providers with SigV4, DEK cache,
pubsub invalidation, `keys:check` and `keys:seal` jobs, console routes, audit), sealing in
`realtime/repo.ts` with `sealed_with` and `board_sealed_refs`, the `key_unavailable` block, moves,
no thumbnails, the admin console's Encryption key card (Security tab), dashboard and board-page
messages, docs (configuration, deployment, operations, ARCHITECTURE).

Tests (scenario, named after the failure they prevent): `realtime/sealing.test.ts` (nothing in
the clear at rest and still opens; an older release fails on sealed rows; a blob copied to another
board / workspace / private layer never opens; suspension closes everywhere with no plaintext
fallback or write; destroy is final even with a cached DEK; rotation keeps everything readable and
reseals; turning a key on seals existing content; the sweep keeps a file only a sealed board
references, also while suspended), `boards/keyedMove.test.ts` (A→B is under B's key, A's suspension
doesn't touch it; out to an unkeyed workspace), `keys/kms.test.ts` (a customer's KMS revocation
closes boards despite a cached DEK and recovery reopens them; an unusable KMS key can't be turned
on; SigV4 against AWS's published test vectors).

Left:
- **Uploaded files under the workspace key.** Uploads are made without a board (`POST /api/uploads`),
  are shared between boards and workspaces by URL, and raster images are served by redirect to the
  bucket; sealing them needs a board context on upload, serving through the server with ranges,
  and a rule for a file pasted into another workspace. Files stay under storage encryption
  (`S3_SSE`, possibly `aws:kms` with the operator's key).
- **Other external KMSs** (Google Cloud KMS, Azure Key Vault, HashiCorp Vault Transit): the
  provider interface (`keys/kek.ts` wrap / unwrap, refused vs unreachable) takes them; none built.
- A workspace's own key can't be turned off again (only destroyed); organisations can't hold a key
  for all their workspaces.

---

## 4. SAML: encrypted assertions, signed AuthnRequests and single logout (#13)

### What we want

IdPs that require it can encrypt assertions to Freero and insist on signed AuthnRequests, and
signing out ends the session at both ends: the IdP's logout ends the Freero sessions it started,
and signing out of Freero signs out at the IdP.

### Model

- **An SP key pair per connection** (RSA-2048, self-signed X.509 certificate, made on request in
  the admin console): the private key sealed (`seal('sso-sp-key-v1')`), the certificate published
  in the SP metadata as both `signing` and `encryption` KeyDescriptor. Rotation: a new pair is
  added next to the current one (both published, both decrypt) and then made current; the old one
  is removed when the IdP has the new certificate.
- **Encrypted assertions**: with a key pair, node-saml gets `decryptionPvk` (each key tried).
  "Require encrypted assertions" refuses a response whose assertion arrived in the clear. The
  signature on the assertion is still required (decryption is not authentication).
- **Signed AuthnRequests**: "Sign requests" signs the redirect binding (`SigAlg`, `Signature`,
  RSA-SHA256) with the current key; the metadata says `AuthnRequestsSigned="true"`.
- **Single logout** (`/api/sso/:workspaceId/saml/slo`, HTTP-Redirect and HTTP-POST bindings; the
  IdP's `SingleLogoutService` from its metadata or typed in):
  - IdP-initiated: the LogoutRequest's signature must verify against the IdP's certificates
    (redirect binding: over the original query string), its Issuer must be the IdP, its ID is
    remembered until it expires (one use). It ends the Freero sessions that SAML sign-in started
    for that workspace with that NameID (and SessionIndex, when it names one) — never another
    workspace's or a password session — through auth's `sessionsEnded` (sockets close everywhere).
    The answer is a LogoutResponse to the IdP, signed when the connection has a key.
  - SP-initiated: signing out of a session that came from a SAML connection with an SLO URL
    redirects to the IdP with a (signed) LogoutRequest after the Freero session is already gone;
    the IdP's LogoutResponse (InResponseTo must be one we sent) lands on `/login`.
  - `sso_sessions` (sso's table): sha256 of the session key, workspace, NameID, SessionIndex,
    written when a SAML sign-in completes; cascades with the session.
- The SLO endpoint is cross-site POST (`allowCrossSitePost`, stated reason), like the ACS.

### Built / left

Built (`modules/sso`: `spKeys.ts`, `logout.ts`, `saml.ts`, `signIn.ts`; auth seams; admin console
"Signing, encryption and single logout" card in the Single sign-on tab):

- **Keys**: `sso_sp_keys` per workspace (or organisation), at most two. The first is current; a
  second waits as "next" until promoted; only a non-current key — or the last one while neither
  switch needs it — can be removed. The certificate (10 years, self-signed, CN "Freero SAML service
  provider <workspace>") is DER-encoded by hand and checked with `X509Certificate.verify`. Audited
  `sso.sp_key_created` / `sso.sp_key_rotated` / `sso.sp_key_removed`.
- **Metadata** is built by us, not node-saml (which publishes one encryption key and one logout
  binding): every key as `signing` and `encryption` KeyDescriptor, `AuthnRequestsSigned` = "Sign
  requests" with a current key, `WantAssertionsSigned="true"`, SingleLogoutService for
  HTTP-Redirect and HTTP-POST, the ACS.
- **Encrypted assertions**: one node-saml instance per key; an encrypted assertion is tried with
  each (the first failure is the one recorded). Nothing is consumed before decryption succeeds, so
  a wrong key costs only the attempt. "Require encrypted assertions" is checked on the raw
  response before validation (a top-level `Assertion` → refused); it and "Sign requests" refuse to
  turn on without a key. With "Sign requests" on and the key unopenable (secret lost) sign-in is
  refused rather than sent unsigned.
- **Single logout, IdP-initiated**: besides node-saml's signature (the one-argument
  `validateRedirectAsync`, which requires one; we check there is exactly one Signature and SigAlg
  too) and issuer checks, we require `Destination` = this workspace's SLO URL (node-saml only warns),
  `IssueInstant` within 10 minutes (+1 min skew), and record the request ID until it could no longer
  be accepted (`slo:<ID>` in `sso_saml_cache`, `cacheSaveIfAbsent`). Refusals: `sso.logout_refused`
  and `/login?error=sso_failed`. Ended: `sso.logout` per person (`initiatedBy: identity_provider`,
  count). The LogoutResponse goes to the IdP's SLO URL over HTTP-Redirect (signed with "Sign
  requests"); without an SLO URL the browser lands on `/login`.
- **Single logout, SP-initiated**: `POST /api/auth/logout` answers `{ ok, redirect? }`; the web app
  follows `redirect` after it signed out locally. The IdP's LogoutResponse is validated
  (InResponseTo must be one we sent; signature) for the record only — the browser lands on
  `/login` either way, since the session here is already gone.
- **Auth seams** (auth stays the only writer of sessions): `completeSignIn(…, { sessionTag })`
  (kept on `auth_challenges.session_tag` across the second step), `onSessionStarted` (awaited
  before the cookie is set: if recording fails the sign-in fails, so no session SLO can't reach),
  `endSessionsByKeys`, `onSignOutRedirect` (asked just before the session row is deleted).
- **`sso_sessions`** stores auth's session key itself (already a sha256 of the cookie, the same
  value `sessions.token_hash` holds) with `REFERENCES sessions ON DELETE CASCADE`, so rows go with
  their session and need no cleanup job.
- Tests (`sso/samlKeysAndLogout.test.ts`, real signatures and XML Encryption from
  `scripts/lib/mock-saml.mjs`): NameID scoping (not a password session, not another workspace's
  same NameID), SessionIndex scoping over HTTP-POST, refusals (unsigned redirect and POST, another
  key, another issuer, another Destination, old, replayed), SP-initiated LogoutRequest signed with
  the published certificate, signed AuthnRequest verified with the published certificate, encrypted
  assertion with the right / wrong key and across a rotation, required encryption, private key
  never in an answer and sealed at rest.

Left:

- Organisation consoles show the same card (connections keyed by the organisation id work
  unchanged), but SLO through an organisation's connection was only covered by the shared code
  path, not a dedicated test.
- LogoutRequests with an encrypted NameID (`EncryptedID`) are decrypted with the current key only.
- No SOAP back-channel binding (browser bindings only), like most SaaS service providers.
- IdPs must be given the new SP metadata (or certificate) after a key is created; an IdP that
  starts requiring signed requests before "Sign requests" is on refuses sign-ins until it is.
