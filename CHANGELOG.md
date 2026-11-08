# Changelog

Freero's releases. Each version is a git tag (`v0.1.0`) and a Docker image
(`ghcr.io/antonber/freero:0.1.0`); `:latest` follows `main`, which is what https://freero.app runs.

## 0.1.1 — 2026-11-08

A security and reliability release. Every self-hosted server should update; https://freero.app has
run these fixes since 2026-11-07.

### Security

Four advisories, published with this release:

- **High — accounts handed over without a proven address** (GHSA-r52x-62gm-fqxw). An account
  someone created with a work address they never verified could be adopted by SCIM provisioning
  or single sign-on with its creator's password and sessions still working. A password reset or
  change also left a pending email change running.
- **Medium — board access kept or gained after it ended** (GHSA-g744-qqqx-fvh8). A socket that
  connected while its access was being removed, or a board being trashed or taken down, could get
  in with the old role. One failed access refresh left a removed member connected.
- **Medium — workspace role changes authorised before the lock** (GHSA-wpr8-2wp8-v938). A person
  demoted a moment earlier could still act with their old role, two owners could deactivate each
  other and leave no active owner, and a removed admin's invitations kept working.
- **Medium — app tokens kept permissions the person took away** (GHSA-jr6r-fv35-w6p8). Reconnecting
  an app with fewer permissions didn't narrow its existing tokens, and two refreshes at once
  disconnected the app.

### Fixed

The rest of the 2026-11-06 state-machine audit (issues #186–#200; every machine, finding and fix is
in [docs/design/state-machines.md](docs/design/state-machines.md)):

- Background jobs no longer share lock keys, and shutdown waits for running jobs and queued mail
  (no more duplicate webhook deliveries on deploys).
- Export archives are kept out of public storage and a crashed export stops retrying.
- A board restored from the trash restarts its retention clock; delete forever and legal holds
  can't race.
- Ended timers, votes, retros and other sessions stay ended; reveals asked for offline are kept.
- Undo takes back exactly one of your own steps, never half of an older one.
- Tracker sends can't create duplicate issues; Slack, Figma and import connections can't undo a
  newer one; Cancel cancels an import.
- Leaving a board while recording a walkthrough stops the microphone.
- Moderation: one alert per first report, final decisions take no appeal, a suspended account's
  listings and templates are hidden.
- Realtime: reconnects back off, instances resync after a Redis gap, suggestion decisions are first
  come, first served.
- On a phone, a pan or pinch that starts on a kanban moves the view instead of opening focus mode,
  and the focus view's close button stays in sight.

### Upgrading

Six migrations run on startup; each only adds a column, a table or a constraint. During a rolling
update with several instances, the old instances keep the old behaviour until they are replaced.

## 0.1.0 — 2026-11-06

The first tagged release: the whiteboard as it runs on freero.app, packaged for self-hosting.

### Whiteboard

- Infinite canvas with pan and zoom, minimap, snapping and alignment guides, groups, locking,
  undo/redo and copy/paste across boards.
- Sticky notes, 21 shapes, rich text, connectors (straight, elbow, curved; labelled), pen,
  highlighter and eraser, images, emoji and stamps, frames, task cards and kanbans, tables, mind
  maps, tags, PDFs, video and audio that play on the board, and file cards.
- Docs next to boards, with links and backlinks between them.
- 586 original templates: retrospectives, planning, workshops, diagrams, strategy and more.
- Export to PNG, JPG and SVG, frames to PDF; offline copies of boards.
- Interface in 10 languages (machine-translated, not yet reviewed by people).

### Collaboration

- Live sync over Yjs CRDTs: cursors, selections, follow a collaborator, bring everyone to you.
- Comment threads, emoji reactions, voting sessions, a shared timer and presentation mode.
- Owner, editor, commenter and viewer roles; sharing by invite or link; guests without an account.

### AI agents (MCP)

- A built-in MCP server (Streamable HTTP) at `/mcp`, with OAuth 2.1 (PKCE, dynamic client
  registration) or personal access tokens.
- Agents read boards and propose changes by default; people accept or reject each proposal.
  Writing directly and commenting are separate permissions granted on the consent screen.
- Everything an agent does is labelled with the app and the person it acts for, and audited.
- Live board views inside Claude and ChatGPT (MCP Apps); extensions for Gemini CLI and Cursor.
- Built-in AI is off until an operator or workspace admin connects a provider (Anthropic, OpenAI
  or any OpenAI-compatible endpoint).

### Import and integrations

- Import Miro boards with your own Miro token, Mural and Lucid CSV exports, Visio, PowerPoint,
  draw.io, Excalidraw, Mermaid, PlantUML, CSV, images and PDFs.
- Two-way sync between board cards and issue trackers, including GitHub Issues, Jira and Linear.
- Chat and automation integrations, a REST API and signed webhooks.

### Teams and enterprise

- SAML and OpenID Connect single sign-on, SCIM provisioning, an audit log and an admin console,
  all under MIT, with no paid edition.
- Workspace encryption keys (instance key or AWS KMS, Google Cloud KMS, Azure Key Vault, Vault
  Transit), off by default (`WORKSPACE_KEYS`).
- Legal holds, retention and data export.

### Self-hosting

- One Docker image serving the app, real-time collaboration, the REST API, the MCP server and the
  marketing pages, smoke-tested in CI against a real PostgreSQL before it is published.
- `docker pull ghcr.io/antonber/freero:0.1.0`, or `:latest` for `main`.
- Needs PostgreSQL 15+; add Redis and S3-compatible storage to run more than one instance. See
  [docs/deployment.md](docs/deployment.md) and [docs/configuration.md](docs/configuration.md).
