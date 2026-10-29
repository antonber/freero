# Freero MCP server

Freero is a remote [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude, ChatGPT, Claude
Code, Cursor, VS Code and any other MCP client can find your boards, read them, and add to them —
acting as you, with only the permissions you give the connection.

```
https://<your-freero>/mcp
```

`<your-freero>` is the address you open Freero at — the hosted service's, or your own server's (see
[Self-hosting](#self-hosting)).

- **Transport:** Streamable HTTP, stateless (`POST /mcp`, JSON responses; no session, no server-sent
  stream: `GET`/`DELETE` answer 405). Any instance behind a load balancer answers any request.
- **Sign-in:** OAuth 2.1 with Freero's own authorization server (MCP authorization spec): the client
  registers itself, you sign in to Freero and approve it on the consent screen. Scripts can send a
  personal access token instead.
- **Default power: read + suggest.** Changing boards directly and commenting are opt-in, ticked by
  you on the consent screen.

## Connect

### Claude (claude.ai, Claude Desktop)

Settings → **Connectors** → **Add custom connector** → name it *Freero*, URL `https://<your-freero>/mcp`
→ **Add**, then **Connect**. Claude opens Freero's consent screen: sign in, tick what it may do
(see [Permissions](#permissions)), **Allow**. In a chat, enable Freero in the tools menu.

On Team and Enterprise plans an owner adds the connector for the organization first (Admin settings →
Connectors); members then connect their own Freero account.

### ChatGPT

Settings → **Apps & Connectors** → **Advanced settings** → turn on **Developer mode**. Then **Create**
(Apps & Connectors) → name *Freero*, MCP server URL `https://<your-freero>/mcp`, authentication
**OAuth** → **Create**, and finish the sign-in on Freero's consent screen. In a chat, pick Freero from
the developer-mode tools. (Workspace admins of Business / Enterprise / Edu may have to allow custom
connectors first.)

### Claude Code

```sh
claude mcp add --transport http freero https://<your-freero>/mcp
```

Then run `/mcp` in Claude Code and choose **Authenticate**: your browser opens the consent screen.
For CI or a headless machine, use a personal access token instead of OAuth:

```sh
claude mcp add --transport http freero https://<your-freero>/mcp --header "Authorization: Bearer frp_…"
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "freero": { "url": "https://<your-freero>/mcp" }
  }
}
```

Cursor shows *Needs login* next to the server: click it to sign in. With a token instead:
`"headers": { "Authorization": "Bearer frp_…" }`.

### VS Code (GitHub Copilot) and other clients

`.vscode/mcp.json`:

```json
{
  "servers": {
    "freero": { "type": "http", "url": "https://<your-freero>/mcp" }
  }
}
```

Any client that speaks Streamable HTTP and the MCP authorization spec works the same way. To try the
server from a terminal: `npx @modelcontextprotocol/inspector --cli https://<your-freero>/mcp --transport http
--method tools/list --header "Authorization: Bearer frp_…"`.

## Permissions

What a connection can do is **your role on the board AND what you granted it** — a commenter's
connection never adds stickies, whatever it was granted.

| Permission (scope) | Default | Lets the assistant |
|---|---|---|
| `boards:read` | on | find boards, read them (outline, export) |
| `boards:suggest` | on | propose changes for people to accept, never changing the board itself ([propose_changes](#propose_changes)) |
| `boards:write` | **off — tick it** | create boards and add, change and delete items directly |
| `comments:write` | **off — tick it** | comment and reply |

The consent screen lists the defaults and offers the others unticked; the token gets exactly what you
ticked. To change it later, disconnect the app (Settings → **Connected apps**) and connect again. A
personal token (Settings → **API tokens**) carries the scopes you picked when you made it.

A write tool called without its permission changes nothing and answers with the permission it needs
(`insufficient_scope`), so the assistant can tell you what to turn on.

## Safety

- **Board text is untrusted.** Everything people wrote on a board reaches the assistant only inside an
  `untrusted_board_content` envelope (a JSON field, or `<untrusted_board_content>` tags around Markdown,
  which board text can't close early), next to a notice saying to treat it as data, never as
  instructions. Tool names, descriptions, the server's instructions and error messages are Freero's
  own words and never contain board text; boards are not listed as resources by title for the same reason.
- **Destructive tools need confirmation.** `delete_items` deletes nothing unless called with
  `confirm: true` (the assistant is told to ask you first). Tools carry MCP annotations
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`).
- **Limits.** 500 items per call; `RATE_LIMIT_API_CREDENTIAL` requests and `RATE_LIMIT_AGENT_WRITE`
  board changes per minute per connection — apart from your own editing, which an agent never slows
  down.
- **Everything is visible.** What an app adds is labelled "*App* for *you*" on the items (and in the
  outline's authors), in the board's activity feed, and — while it writes — as a participant with its
  own cursor. Every tool call is in the audit log (`api.call`, endpoint `MCP <tool>`, with the app and
  the outcome): the team's log for team boards, else your account's.
- **Kill switches**, all effective on the next request (every request is authenticated afresh; there is
  no session to outlive them): disconnect the app or pause / revoke the token (Settings); "Disconnect
  all apps and tokens" (Settings); a team admin turns **API & apps** off or blocks one app (admin
  console); the operator sets `PUBLIC_API=false`. Signing out everywhere (password reset, …) revokes
  everything too.
- **Workspace policies apply**: a team's downloads policy refuses reads of its boards' content
  (`downloads_restricted`, audited) — the outline and `export_board` included; enforced SSO refuses
  connections made without it.

## Tools

Item ids come from `get_board_outline` (in `[brackets]` in Markdown, `id` in JSON). Freero places
everything an agent adds in free space (next to `near` when given): no coordinates.

| Tool | Needs | What it does |
|---|---|---|
| `list_workspaces` | read | Your workspaces (personal and teams) and your role in each. |
| `search_boards` | read | Boards you can open, newest change first; `query` searches titles; `workspaceId`, `limit`, `cursor`. |
| `search` | read | Words in what your boards say — titles, notes, text, shapes, cards, frame titles, table cells, tags, connector labels, comments — across the boards you can open (`workspaceId` or `boardId` to narrow it): each match with its board id, item id, a snippet and a link. Never private drafts or hidden frames; boards whose downloads policy keeps their content from you are left out. |
| `resolve_links` | read | What Freero links (board / item URLs, `freero://` addresses; up to 200) point at — type, title, board, your access — or `unavailable` (no access and no such object read the same). |
| `find_backlinks` | read | Items and comments on boards you can open that link to a board or an item. |
| `list_templates` | read | Saved templates you can start a board from (yours and your teams'). |
| `get_board_outline` | read | The board as a semantic outline: frames, clusters, notes, shapes, cards, mind maps, tables, the connector graph, votes, comments, with item ids. `format` `markdown` (default) / `json`; `budget` (≈ tokens, default 8000) keeps frame titles and the shallowest, most recent items; `scope` = an item id to read only inside it; `cursor` pages; `authors`. Format reference: [board-outline.md](board-outline.md). |
| `create_board` | write | A new board (personal or a team workspace), optionally from a saved template. |
| `add_stickies` | write | A grid of sticky notes, optional title and color. |
| `add_clusters` | write | Titled groups side by side; an item is new text or `{ "id": … }` of a note already on the board, which moves into the cluster (affinity mapping). |
| `add_diagram` | write | Exactly one of: `mermaid` (flowchart — subgraphs become frames — or sequenceDiagram), `outline` (nested `{ text, children }`, drawn as a mind map or, with `outlineAs: "tree"`, a tree), or `graph` (nodes + edges). Laid out by Freero, connectors attached. |
| `add_comment` | comment | A comment on the board or on an item (`itemId`), or a reply in a thread (`threadId`). |
| `update_items` | write | Changes several items in one step, all or nothing: text, card fields, colors, frame title / hidden, lock, link, position / size (a moved frame takes its contents). |
| `delete_items` | write | Deletes items (a frame with everything inside). Only with `confirm: true`. |
| `export_board` | read | The whole board as a file (embedded resource): Markdown or JSON. Recorded as an export (`board.exported`); refused by a downloads policy. |
| `propose_changes` | suggest | Proposes a structure (`{ kind, … }` as for the add tools; optional `description` for reviewers) as ONE group of suggestions that people who can edit the board accept or reject (KAI-169). The board does not change until they do; the badge, the outline (`include=suggestions`) and the activity feed show it as "<app> for <you>". Your role must be owner or editor. |

**Resources:** `freero://board/{boardId}` — a board's outline (Markdown, ≈ 8000 tokens) in the
untrusted envelope.

**Prompts:** `run_retro` (group a retro board's notes into themes with `add_clusters`, then actions),
`notes_to_diagram` (your notes → `add_diagram`), `summarize_board` (topics, decisions, open
questions, action items with ids).

## How sign-in works (for client developers)

1. `POST /mcp` without a token → `401` with
   `WWW-Authenticate: Bearer realm="freero", resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"`.
2. Protected-resource metadata (RFC 9728) at that URL, also at the bare
   `/.well-known/oauth-protected-resource`: `resource` `https://<host>/mcp`, `authorization_servers`
   `["https://<host>"]`, `scopes_supported` `boards:read boards:suggest boards:write comments:write`.
3. Authorization-server metadata (RFC 8414) at `/.well-known/oauth-authorization-server`.
4. Dynamic client registration (RFC 7591): `POST /api/oauth/register` — public clients only
   (`token_endpoint_auth_method: none`); the consent screen says the app registered itself.
5. Authorization code + PKCE (S256 required) at `/oauth/authorize` with
   `resource=https://<host>/mcp` (RFC 8707): the token is bound to the MCP server (the REST API
   refuses it, and the other way round). Loopback redirect URIs match on any port.
6. `POST /api/oauth/token`: access token `fro_…` (1 hour) + refresh token `frr_…` (30 days, rotating; a
   replayed refresh token ends the whole consent). The response's `scope` is what the person granted.

Personal access tokens (`frp_…`) are accepted as `Authorization: Bearer` too.

## Self-hosting

Nothing to configure: the MCP server, its OAuth metadata and the consent screen are part of every
Freero server. Set `PUBLIC_URL` to the address people use (the metadata and token audience are built
from it), serve it over HTTPS (ChatGPT and Claude only connect to https URLs), and give clients
`https://<your-host>/mcp`. `PUBLIC_API=false` turns the REST API and the MCP server off together.
Limits: `RATE_LIMIT_API_CREDENTIAL`, `RATE_LIMIT_AGENT_WRITE` ([configuration.md](configuration.md)).

## Interactive board previews (MCP Apps) — plan (KAI-171)

The MCP Apps extension (`io.modelcontextprotocol/ui`, spec 2026-01-26) lets a tool result render an
interactive HTML view in the chat. Claude (web and desktop), ChatGPT and VS Code render it; other
hosts show the text result. What it takes:

- A `ui://` resource with MIME type `text/html;profile=mcp-app` (one self-contained HTML document),
  declared up front so hosts can prefetch and review it; tools point to it with
  `_meta.ui.resourceUri` (the flat `_meta["ui/resourceUri"]` form is deprecated).
- The host renders it in a sandboxed iframe under a CSP built from the resource's `_meta.ui.csp`
  (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`; omitted = no network at
  all) and optional `permissions`; `_meta.ui.prefersBorder`.
- The view talks to the host over `postMessage` JSON-RPC: `ui/initialize` →
  `ui/notifications/initialized`, then the host sends `ui/notifications/tool-input` and
  `…/tool-result`; the view may call server tools back through the host and update the model's context.
- The extension must be negotiated in the client's capabilities, or hosts silently show text only.

Status: Freero pins the stable `@modelcontextprotocol/sdk` 1.x, which has no MCP Apps support; the
official `@modelcontextprotocol/ext-apps` 2.x requires the split v2 SDK packages
(`@modelcontextprotocol/server` 2.x). So no UI resource ships yet. Next steps (KAI-171):

1. Move `modules/mcp` to `@modelcontextprotocol/server` 2.x (same tools; `server.ts` and `routes.ts`
   change) and add `@modelcontextprotocol/ext-apps` (pinned).
2. A read-only **board preview** view: a small, separately built bundle (`apps/web` entry, no Freero
   chrome) that draws the outline JSON the tool result already carries (frames, notes, shapes,
   connectors as boxes and lines), so it needs **no network** (`csp` omitted) and no credentials;
   board text rendered with `textContent` only. `get_board_outline` and the `add_` tools point to it
   via `_meta.ui.resourceUri`; text-only hosts keep today's results.
3. Then the live, editable board of KAI-171: a short-lived, board-scoped token minted per tool call,
   the realtime socket allowed in `connectDomains` (Freero's origin only), "Open in Freero" / "Share".

<!-- Sources checked 2026-10: modelcontextprotocol/ext-apps (spec 2026-01-26), npm @modelcontextprotocol/ext-apps 2.0.4 (peer @modelcontextprotocol/server ^2). -->
