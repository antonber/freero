# Changelog

Freero's releases. Each version is a git tag (`v0.1.0`) and a Docker image
(`ghcr.io/antonber/freero:0.1.0`); `:latest` follows `main`, which is what https://freero.app runs.

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
