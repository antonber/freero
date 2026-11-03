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
  stream: `GET`/`DELETE` answer 405). Any instance behind a load balancer answers any request. Both
  the 2025 protocol revisions and 2026-07-28 (per-request envelope) are served.
- **Sign-in:** OAuth 2.1 with Freero's own authorization server (MCP authorization spec): the client
  identifies itself by its client metadata document (an https URL as `client_id`) or registers
  itself, you sign in to Freero and approve it on the consent screen. Scripts can send a personal
  access token instead.
- **Default power: read + suggest.** Changing boards directly and commenting are opt-in, ticked by
  you on the consent screen.

## Connect

**In Freero: Settings → AI agents → Connect an agent** (`/settings/connect`; also on the empty
dashboard and in every board's "…" menu). It shows this server's MCP URL (built from `PUBLIC_URL`,
`GET /api/mcp/connect`) and, per client, the one click or one paste it takes with that URL filled
in; makes a personal token for plain HTTP; lists what is connected (apps and tokens, last used,
revoke), marking each **Connected** once its client has called the server; and offers starter
prompts. `/settings/connect#<client>` opens one client's tab (`claude`, `chatgpt`, `claude-code`,
`cursor`, `vscode`, `other`, `http`); the marketing site's /claude, /chatgpt and /agents link there.
Agents can read `/llms.txt` (and `/llms-full.txt`) for the endpoint, sign-in and tools. Everything
else that connects to Freero (trackers, chat, embeds, sign-in, the API) is listed in the app's
**Apps & agents** page (`/apps`, also in the board menu), each entry with its connect step.

The same steps by hand (formats as each vendor documents them, checked 2026-10-29):

### Claude (claude.ai, Claude Desktop)

**Customize → Connectors** (Settings → Connectors in some versions) → **+ Add** → **Add custom
connector** → name it *Freero*, URL `https://<your-freero>/mcp` → **Continue**, **Add**, then
**Connect**. Claude opens Freero's consent screen: sign in, tick what it may do (see
[Permissions](#permissions)), **Allow**. In a chat, enable Freero in the tools menu. Claude connects
from Anthropic's servers, so the URL must be public https.

On Team and Enterprise plans an owner adds the connector for the organization first (Organization
settings → Connectors → Add → Custom → Web); members then select **Connect** under Customize →
Connectors. ([Anthropic's guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp))

### ChatGPT

[Plugins](https://chatgpt.com/plugins) → the plus button → **Add custom MCP server** → name *Freero*;
under **Connection**, the public endpoint `https://<your-freero>/mcp`; authentication **OAuth** →
review the risk warning → **Create as a plugin**, and finish the sign-in on Freero's consent screen.
In a chat, type **@** and pick Freero. OpenAI decides which plans can add custom MCP servers; in a
workspace an admin may have to allow them first.
([OpenAI's guide](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt))

### Claude Code

```sh
claude mcp add --transport http freero https://<your-freero>/mcp
```

Then run `/mcp` in Claude Code, pick *freero* and choose **Authenticate**: your browser opens the
consent screen (`--scope user` adds it to every project). For CI or a headless machine, use a
personal access token instead of OAuth:

```sh
claude mcp add --transport http freero https://<your-freero>/mcp --header "Authorization: Bearer frp_…"
```

([Claude Code MCP docs](https://code.claude.com/docs/en/mcp))

### Cursor

One click: `cursor://anysphere.cursor-deeplink/mcp/install?name=freero&config=<base64>`, where
`<base64>` is the base64 of `{"url":"https://<your-freero>/mcp"}` (the server's entry without its
name), URL-encoded; the Connect page builds it
([install links](https://cursor.com/docs/context/mcp/install-links)). By hand, `~/.cursor/mcp.json`
(all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "freero": { "url": "https://<your-freero>/mcp" }
  }
}
```

Cursor then asks you to sign in to Freero. With a token instead:
`"headers": { "Authorization": "Bearer frp_…" }`.

### VS Code (GitHub Copilot)

One click: `vscode:mcp/install?` followed by the URL-encoded JSON
`{"name":"freero","type":"http","url":"https://<your-freero>/mcp"}` (Insiders: `vscode-insiders:`;
[installation URL](https://code.visualstudio.com/docs/copilot/guides/mcp-developer-guide)), or
`code --add-mcp '{"name":"freero","type":"http","url":"https://<your-freero>/mcp"}'`, or
`.vscode/mcp.json`:

```json
{
  "servers": {
    "freero": { "type": "http", "url": "https://<your-freero>/mcp" }
  }
}
```

VS Code opens the browser to sign in the first time.

### Codex, Windsurf and other clients

- **Codex** (CLI, IDE extension, desktop): add to `~/.codex/config.toml`, then run `codex mcp login freero`
  ([Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp)):
  ```toml
  [mcp_servers.freero]
  url = "https://<your-freero>/mcp"
  ```
- **Windsurf** (Devin Desktop since 2026-06): in Cascade's raw MCP config,
  `{ "mcpServers": { "freero": { "serverUrl": "https://<your-freero>/mcp" } } }`
  ([docs](https://docs.devin.ai/desktop/cascade/mcp)).
- A client that runs only local (stdio) servers: the [mcp-remote](https://github.com/geelen/mcp-remote)
  bridge, `{ "command": "npx", "args": ["mcp-remote", "https://<your-freero>/mcp"] }`.

Any client that speaks Streamable HTTP and the MCP authorization spec works the same way. To try the
server from a terminal: `npx @modelcontextprotocol/inspector --cli https://<your-freero>/mcp --transport http
--method tools/list --header "Authorization: Bearer frp_…"`.

### Any HTTP client

Make a personal access token (Connect page → **Any HTTP client**, or Settings → **API tokens**: the
scopes and expiry you pick, shown once), then
`curl -H "Authorization: Bearer frp_…" https://<your-freero>/api/v1/me`. The same token works as a
bearer token on `/mcp`. Reference: [api/README.md](api/README.md).

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
  `confirm: true` (the assistant is told to ask you first). Every tool has a title and explicit
  `readOnlyHint`, `destructiveHint` and `openWorldHint` (and `idempotentHint`): anything that
  changes or deletes existing items, replaces a control-room lane or creates issues in a tracker is
  destructive, so clients ask before it runs (`mcp.test.ts` fails when a tool lacks one).
- **Browsers can't be turned against it.** `/mcp` answers only on `PUBLIC_URL`'s host (or
  loopback), so a page that rebinds its own name to the server's address is refused (DNS
  rebinding), and a browser `Origin` must be https (or http on loopback), never `null`: refused with
  403 before any token is looked at. Clients without a browser send no `Origin` and are unaffected.
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
  everything too. Disconnecting an app or revoking a token also **withdraws its pending suggestions** on
  every board (KAI-224), and a person on a board can **pause** an agent there from its control-room
  lane ([below](#agent-control-room)).
- **Workspace policies apply**: a team's downloads policy refuses reads of its boards' content
  (`downloads_restricted`, audited) — the outline and `export_board` included; enforced SSO refuses
  connections made without it.

## Tools

Item ids come from `get_board_outline` (in `[brackets]` in Markdown, `id` in JSON) and from what the
add tools return: each returns the new ids **in the order the items were sent** (per cluster / per
kanban column). Every `boardId` (and `docId`) also takes the board's link as the person pasted it
(`https://<your-freero>/board/<id>?item=…`, `freero://board/<id>`). A cluster's outline id
(`cluster:<id>`) works as `near`, as `add_comment`'s `itemId` (the comment goes on its title) and as
a placement target.

Freero places everything an agent adds — no coordinates. By default in free space (next to `near`
when given); with **`placement`** (add_stickies, add_clusters, add_cards, propose_changes,
import_from_tracker) somewhere people already have or a new container:

| `placement` | Where the items go |
|---|---|
| `{ "into": "<frame id>" }` | Inside that frame, clear of what is in it; the frame grows when it is full. |
| `{ "into": "<kanban id>", "column": "Doing", "row": "API" }` (or `"into": "<kanbanId>:<columnId>"`, `"<kanbanId>:<columnId>:<rowId>"`) | Into that column (title or id; without one, each card in the column of its value for the field the kanban is grouped by — its `fields` —, else of its status, else the first) and, on a kanban with swimlanes, that row (title or id; without one, the row of the card's value for the swimlane field, else the first). The kanban is laid out as the board lays it out after a drop (its sort, its filter, its card limits) and grows. A card takes a status column's status and its row's value. Only sticky notes and cards. |
| `{ "into": "cluster:<id>" }` (or any item in the cluster) | Right next to its items, so the outline reads them as one cluster under its title — never touching a neighbouring cluster. |
| `{ "newFrame": "Title" }` | A new frame around everything added. |
| `{ "newKanban": "Title" }` | A new To do / Doing / Done kanban, each card in the column of its status. |

`update_items` moves existing items the same way: `{ "id": …, "into": …, "column"?: …, "row"?: … }`.

| Tool | Needs | What it does |
|---|---|---|
| `list_workspaces` | read | Your workspaces (personal and teams) and your role in each. |
| `search_boards` | read | Boards you can open, newest change first; `query` searches titles; `workspaceId`, `limit`, `cursor`. Each with your role (`coOwner: true`: an editor who also manages its sharing, #122). |
| `search` | read | Words in what your boards say — titles, notes, text, shapes, cards, frame titles, table cells, tags, connector labels, comments — across the boards you can open (`workspaceId` or `boardId` to narrow it): each match with its board id, item id, a snippet and a link. Never private drafts or hidden frames; boards whose downloads policy keeps their content from you are left out. Changes are searchable within seconds (read a board you just changed with `get_board_outline`). |
| `resolve_links` | read | What Freero links (board / item URLs, `freero://` addresses; up to 200) point at — type, title, board, your access — or `unavailable` (no access and no such object read the same). |
| `find_backlinks` | read | Items and comments on boards you can open that link to a board or an item. |
| `search_docs` | read | Docs (collaborative documents next to boards) you can open, newest change first; `query` searches titles. `search` also finds words inside docs. |
| `read_doc` | read | A doc as Markdown: headings, lists, checklists, tables, code, quotes, images, links; a live board embedded in it reads as an image of its `freero://board/…` address. Refused by a downloads policy. `blocks: true` also lists its blocks with their ids (what `edit_doc` and `comment_on_doc` take), `comments: true` its comment threads. |
| `create_doc` | write | A new doc from Markdown (CommonMark with tables, task lists, strikethrough), personal or in a team workspace; its first heading names it unless `title` is given. `![Live board](freero://board/<id>)` on a line of its own embeds that board live. |
| `append_to_doc` | write | Adds Markdown at the end of a doc you can edit; everyone with it open sees it at once. |
| `edit_doc` | write | One part of a doc you can edit, by block id (#61): `replace` a block (with what is nested under it), `replaceSection` (a heading and everything up to the next heading of its level or higher), `insertBefore` / `insertAfter` a block, or `delete` it; Markdown in. Comments on a replaced block stay on its first new block. REST: `POST /api/v1/docs/{docId}/edit`. |
| `comment_on_doc` | comment | A comment on a doc's block (`blockId`) or on the whole doc, or a reply (`threadId`); @mentions notify like in the app. REST: `GET` / `POST /api/v1/docs/{docId}/comments`, `POST …/comments/{threadId}/replies`. |
| `list_templates` | read | Saved templates you can start a board from (yours and your teams'). |
| `open_board` | read | Shows the board **live** in the conversation where the assistant shows interactive views ([below](#live-boards-in-the-conversation-mcp-apps)): the person pans, zooms, sees your pending suggestions (if they may review them: owner or editor), edits and accepts or rejects them (if this connection may change boards), opens it in Freero or shares it. Elsewhere: the board link. |
| `share_board` | read (+ write to turn sharing on) | The live view's **Share with team** button — only the view calls it (`visibility: ["app"]`), never the model: returns the board link and, if needed, turns link sharing on (view / comment; guests without an account as the workspace allows). Turning it on needs `boards:write` and the board's owner; the share dialog's rules and audit event apply. |
| `post_status` | write | Long-running work in the open ([control room](#agent-control-room)): your plan, status and tasks (`todo` / `doing` / `done` / `blocked`, matched by your `externalId` or else by title — a retry never duplicates, a renamed task keeps its card) on your lane of a control-room board; creates the board without `boardId`. A task that moves into Blocked notifies the person you work for. Returns a `cursor` and the lane's `laneId`. Refused with `agent_paused` while a person has paused you there. |
| `get_feedback` | read | What people changed in your lane since your `cursor`: cards moved, added or removed, comments on your lane or the board — never your own changes — and `paused` (a person paused you on this board). |
| `get_board_outline` | read | The board as a semantic outline: frames, clusters, notes, shapes, cards, mind maps, tables, the connector graph, votes, comments, with item ids. `format` `markdown` (default) / `json`; `budget` (≈ tokens, default 8000) keeps frame titles and the shallowest, most recent items — when it cuts, the result says how many items were left out and gives a `cursor` to page through all of them (500 at a time); `scope` = an item id to read only inside it (a frame, kanban, `cluster:<id>`); `cursor` pages; `authors`. Format reference: [board-outline.md](board-outline.md). |
| `create_board` | write | A new board (personal or a team workspace), optionally from a saved template. |
| `add_stickies` | write | A grid of sticky notes, optional title, color, `shape` (square / rect) and `size` (s / m / l); each sticky is its text or `{ text, link?, color?, shape?, size? }` (a link to an issue, a doc, a page — in the same call). `placement`. Returns `ids` in the order sent (and `titleId`). |
| `add_clusters` | write | Titled groups side by side; an item is new text, `{ text, link?, color? }`, or `{ "id": … }` of an item already on the board, which moves into the cluster (affinity mapping). `placement` (into a frame, or `newFrame`). Returns `clusters: [{ titleId, ids }]` in the order sent. |
| `add_cards` | write | Task cards (`title`, `description`, `status`, `dueDate`, `link`, `color`, and with placement into a kanban its `fields` by name → value: `{ "Team": "API", "Points": 3 }`): `cards` in free space or with `placement` (a kanban column and swimlane row, a frame, a cluster, a new frame / kanban), or `columns` for a new kanban with its cards (a retro's columns, Now / Next / Later). In a status column a card takes its status; a value of the field the kanban is grouped by picks its column, of the swimlane field its row. Returns the ids in order (`kanbanId` and `columns: [{ column, ids }]` for a new kanban). |
| `add_diagram` | write | Exactly one of: `mermaid` (flowchart — subgraphs become frames —, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2 or mindmap), `outline` (nested `{ text, children }`, drawn as a mind map or, with `outlineAs: "tree"`, a tree), `orgchart` (people `{ name, title?, manager? }`: an org chart), or `graph` (nodes + edges). Laid out by Freero, connectors attached. A kanban is `add_cards` with `columns`. |
| `add_comment` | comment | A comment on the board or on an item (`itemId`), or a reply in a thread (`threadId`). |
| `update_items` | write | Changes several items in one step, all or nothing: text, card fields (a card’s `dueDate` and `startDate` too: a timeline’s bar runs from one to the other), colors, frame title / hidden, lock, link, and where they are — `into` a frame, kanban column (`column`) or cluster, placed by Freero (or exact `x` / `y` / `w` / `h`; a moved frame takes its contents). A card on a kanban takes `fields`: its kanban's fields (the outline lists them with the kanban) by name → value, a select by option label (`{ "Priority": "P1", "Points": 3 }`, null clears); an unknown field or option is refused with the valid ones. A value of the field the kanban is grouped by moves the card to that column (as choosing it in card details does), of its swimlane field to that row: the kanban is laid out again in the same change. |
| `define_fields` | write | A kanban's fields (Priority, Points, Owner, Team …) in one step, all or nothing: add (`{ "name": "Priority", "type": "select", "options": [{ "label": "P0" }] }` — types `select`, `multiselect`, `person`, `date`, `number`, `text`, `url`, `checkbox`), rename (`id` + `name`), delete (`delete: true`; values stay on the cards, unused), and options added / renamed / recoloured / deleted by `id` or `label` (`optionOrder`, and `order` for the fields, reorder). The options of the field the kanban is grouped by are its columns: deleting one moves its cards to the column beside it; the column field ("Stage") and the grouped field can't be deleted. Returns the kanban (fields, columns, rows, view). REST: `PATCH /api/v1/boards/{boardId}/kanbans/{kanbanId}/fields`. |
| `configure_view` | write | A kanban's saved board view, for everyone (an agent has no personal view): `groupBy` (a single select, person or checkbox field: the cards move to their columns), `subGroupBy` (swimlanes; `null` for none), `show` (fields on cards), `color` (`own`, `column`, `status` or a select field), `density`, `filter` (`{ "match": "all", "rules": [{ "field": "Priority", "op": "is", "value": "P0" }] }`: the cards it leaves out fold away below the board, still counted for WIP), `sort` (`[{ "field": "Points", "dir": "desc" }]`; `[]` puts every card back in the order people had them), `columns` (`wip`, `limit`, `collapsed` per column) and `locked` (only whoever locked it and the board's owners change the view then). Rule ops: `is`, `isNot`, `anyOf`, `noneOf`, `contains`, `notContains`, `gt` / `lt` (dates: after / before), `empty`, `notEmpty`, `checked`, `unchecked`; `isMe` only in `query_cards` (a saved filter can't depend on who looks). **Tabs** (`views` in the outline): `view` names the tab to change (by name or id; default the Board), `addView: { name, layout }` adds a tab — `table`, `list`, `calendar` or `timeline` (the rest of the call configures it; the answer's `views` carry its id and settings) —, `name` renames a tab, `active: true` makes it the tab everyone starts on, `remove: true` deletes any tab but the Board. Tabs other than the Board never move a card; each takes `filter` (which cards it shows), `sort` and `locked`, and: a table `show` (its columns after the title); a list `show` (fields on each row) and `groupBy` (its groups: a single select, person, checkbox, Status or Assignee; `null`: none); a calendar `date` (the date field cards sit on: `Due date` by default, `Start date` or a date field of the kanban); a timeline `start` and `end` (the date fields its bars run between: `Start date` and `Due date` by default), `scale` (`day`, `week`, `month`, `quarter`) and `subGroupBy` (swimlanes; `null`: none). Grouping the board, colour, density and column limits belong to the Board tab. **A linked view** (`add_view`): `kanbanId` its id; it takes `name`, `layout` (another layout; its filter, sort and lock carry over) and the settings of its layout, as a tab of that layout does, and answers with the linked view. REST: `PATCH /api/v1/boards/{boardId}/kanbans/{kanbanId}/view`. |
| `add_view` | write | A linked view of a kanban (step 3c): the same cards as a `table`, `list`, `calendar` or `timeline` (`layout`, default table) in a box of its own, placed by Freero beside the kanban — say a calendar of the sprint next to the roadmap. Live, not a copy: it shows the kanban's cards as they are, and edits made in it (by people) change them. It takes `name` and the settings a tab of its layout takes in `configure_view` (`show`, `groupBy`, `date`, `start`, `end`, `scale`, `subGroupBy`, `filter`, `sort`, `locked`). Returns `{ id, kind: "linked view", sourceId, name, layout, shows, …settings, link }`. Change it later with `configure_view` (`kanbanId`: the linked view's id; `layout` switches it, keeping its filter and sort), delete it with `delete_items`. The outline lists it as `linked view` with its kanban. Linked views stay on their kanban's board (a view pasted onto another board without its kanban is left out). REST: `POST /api/v1/boards/{boardId}/kanbans/{kanbanId}/linked-views`. |
| `query_cards` | read | A kanban's cards as rows — `{ id, title, column, row?, filtered?, fields: { name: value } }`, options as labels, people by name — filtered (`filter`, the same rules; `isMe` = the person you act for) and sorted (`sort`) by the rules the board itself uses, a page at a time (`limit` ≤ 500, `cursor`). `useView: true` applies the saved filter and sort first; `view` (a tab's name or id) applies that tab's instead — a table's or list's rows in its order, a calendar's or timeline's cards in date order unless it is sorted (those without dates last); `fields` limits what each row carries. How to read a 2,000-card kanban without the outline. REST: `GET /api/v1/boards/{boardId}/kanbans/{kanbanId}/cards` (and `GET …/kanbans/{kanbanId}` for its fields, columns and view). |
| `delete_items` | write | Deletes items (a frame with everything inside). Only with `confirm: true`. |
| `embed_board` | read (+ write to change it) | The board's *Embed on other sites* setting (#2): on or off, whether the workspace allows it, who sees an embed without signing in, and the iframe code and link (`readonly`, `frameId` to start at a frame). `enable` turns it on or off — owners and co-owners, with `boards:write`; only when the person asked, since an embed shows the live board on any site to whoever its sharing lets in. REST: `GET` / `PATCH /api/v1/boards/{boardId}/embed`. |
| `rename_board` | write | A board's new `title` and / or `description` (owners and editors). REST: `PATCH /api/v1/boards/{boardId}` (#170). |
| `copy_board` | write | A copy of a board with its content, as *Duplicate* makes it — in `workspaceId` / `projectId` (where you may create boards) or beside the original, optional `title`. Refused where the downloads policy or the board's "Viewers and commenters can copy and export" keeps its content in. REST: `POST /api/v1/boards/{boardId}/copy`. |
| `add_images` | write | Pictures from their links (PNG, JPEG, GIF, WebP, SVG; ≤ 20 per call, `alt`, `width`), `near` an item or inside `frameId`. Freero downloads each one through its SSRF-safe fetcher (links to private, loopback or link-local addresses are refused, also after a redirect) and keeps its own copy in the person's uploads — never hot-linked. REST: `POST /api/v1/boards/{boardId}/items` with `{ "type": "image", "url": … }`. |
| `add_embeds` | write | Live link cards (≤ 20 per call) for allow-listed providers — YouTube, Vimeo, Loom, Figma, Google Docs / Sheets / Slides / Forms, CodePen, CodeSandbox, and origins the operator added (`EMBED_EXTRA_ORIGINS`) — with the page's title and picture, opening live after a click as on the board. Other links go on an item's `link`. REST: items with `{ "type": "embed", "url": … }`. |
| `group_items` | write | Groups two or more items (`itemIds`) so people select and move them together, or dissolves a group (`ungroup`: its id; the outline shows groups as `group:<id>`). REST: `POST /api/v1/boards/{boardId}/groups`, `DELETE …/groups/{groupId}`. |
| `export_board` | read | The whole board as a file: Markdown or JSON (embedded resource), or a **picture** drawn by Freero's server (#33) — `png` (a preview up to 1600 px a side is shown in the conversation), `svg` or `pdf`, of the board or one frame (`frameId`, `scale`) — as a single-use download link (`resource_link`, 15 minutes; the checks run again when it is used; never your token or a session). Recorded as an export (`board.exported`); refused by a downloads policy or a board that keeps viewers from exporting. REST: `POST /api/v1/boards/{boardId}/export`. |
| `list_tracker_connections` | read | The issue-tracker connections the person may use on a board (#83): name (what `sync_to_tracker` and `import_from_tracker` take as `connection`), provider, scope (team or personal), site, default project and status; with `connection`, also its projects (Jira project keys, Linear team keys, GitHub `owner/repo`), read from the tracker. Only owners and editors use trackers on a board: anyone else gets an empty list and why; no connection gets how to connect one. REST: `GET /api/v1/boards/{boardId}/trackers?connection=…`. |
| `sync_to_tracker` | write | Sends items (sticky notes, cards, shapes, text) to the board's issue tracker as ONE issue — a cluster becomes one issue listing each note with a link back — or one per item (`mode: "each"`). `connection` names the tracker connection when there are several; `project` defaults to the connection's. The items and the issue stay linked and in sync ([trackers.md](trackers.md)). Without a tracker connection it says how the person connects one (`tracker_not_connected`). REST: `POST /api/v1/boards/{boardId}/trackers/send` (#84). |
| `import_from_tracker` | write (or suggest) | The other way (#79): a tracker query (JQL, a Linear search, a GitHub search such as `repo:owner/name is:open label:"area: agents"`, WIQL for Azure DevOps) — or, instead of one, `scope: { project, sprint: "current" | <id>, epic? }` for a project's sprint / Linear cycle / Azure DevOps iteration or an epic's issues (#119; into a kanban this gives it a Sprint field with the project's sprints) — becomes task cards **linked** to their issues — key, status and assignee on the card, synced both ways (closing the issue updates its card, through the webhook). The board menu's *Import issues…* rules: the person's own or the team's connection (`connection` names it when there are several), edit access, at most 100 issues (`limit`, default 50), issues already linked on this board skipped (importing again adds only new ones). In free space or with `placement`; placement never changes an issue's status (in a kanban a card goes to the column of its status if the named one has another). Attributed to "<app> for <you>". Returns `cards: [{ id, key, url }]` and `skipped`. A connection that may only suggest (or `propose: true`) proposes the cards instead: one suggestion group of cards linking to their issues; each card an editor accepts is then linked to its issue like an imported one (#82: badge, two-way sync, the issue's link back), through the connection of the person the app proposed it for. REST: `POST /api/v1/boards/{boardId}/trackers/import`. |
| `import_meeting_notes` | write (or suggest) | Meeting notes or a transcript, passed as exported — a Markdown or text summary (Granola, Otter, Fathom, Meetily …) or WebVTT / SRT captions — become ONE frame: decisions as a cluster, action items as task cards (owner in the description, due date from "by Nov 4" / "due Friday"), the other sections' points as notes under their headings, prose as a summary note and, for transcripts, who spoke (turns, talk time; `speakers: false` leaves it out). Read as written, no AI. `format` (default: recognised), `title` (when the notes have none), `date` (the meeting's, YYYY-MM-DD, when the notes don't say), `near` / `placement`. Returns the frame's id and, block by block (Decisions, Action items, each topic), the title's id and the new ids. Proposed instead with only permission to suggest, or `propose: true`. REST: `POST /api/v1/boards/{boardId}/structure` with `{ "structure": { "kind": "meeting", "source": … } }`. To pick the points yourself, use `add_clusters` and `add_cards`. |
| `propose_changes` | suggest | Proposes a structure (`{ kind, … }` as for the add tools — `stickies`, `clusters`, `kanban`, `items`, `note`, `table`, diagrams — with `placement`; optional `description` for reviewers) as ONE group of suggestions that people who can edit the board accept or reject (KAI-169). The board does not change until they do; the badge, the outline (`include=suggestions`) and the activity feed show it as "<app> for <you>". Your role must be owner or editor. |

**Resources:** `freero://board/{boardId}` — a board's outline (Markdown, ≈ 8000 tokens) in the
untrusted envelope. `ui://freero/board-preview.html` and `ui://freero/board-live.html` — the MCP Apps
views (static HTML, no board data in them).

**Prompts:** `control_room` (work on a goal in a control room: post, check feedback, repeat), `run_retro` (group a retro board's notes into themes with `add_clusters`, then action cards with `add_cards`, offered to the tracker),
`notes_to_diagram` (your notes → `add_diagram`), `summarize_board` (topics, decisions, open
questions, action items with ids).

## Agent control room

A long-running agent (a coding agent, a research agent, an automation) works where people can see
and steer it: its **lane** on a board — a *Plan · &lt;agent&gt;* note, a *Status · &lt;agent&gt;* note and
a *Tasks · &lt;agent&gt;* kanban with **To do / Doing / Done / Blocked**. Several agents can share a
board, one lane each (`agent` names it; default the app's name).

- **Post** with `post_status` after each step: the plan (replaced), a one-line status (stamped with
  the time), and tasks — a task the lane already has is updated and moved to its column, a new one is
  added. Tasks match by `externalId` (your own id for the task, kept on its card) when you send one,
  else by title; a task renamed under the same `externalId` keeps its card (a card you gave another
  id never matches by title). `blocked` puts it in Blocked with your question in its note, and the
  person the app or token acts for gets it in their inbox (and email digest) — once each time a task
  moves into Blocked, not on every re-post. Without `boardId` it
  creates the board. The template **Agent control room** (Engineering) builds a lane for a
  placeholder agent; the first agent that posts to that board claims it.
- **Steer**: people drag cards (back to To do = redo it, out of Blocked = go ahead), add cards and
  comment. The agent calls `get_feedback` with its cursor before each step and gets exactly what
  people changed — cards moved / added / removed, new comments — never its own changes (the cursor
  carries what the agent last saw: no clocks, nothing stored on the server). Pass the latest cursor
  to `post_status` too, so a change people made in between is still reported.
- **Pause**: a person who can edit the board selects the lane's Tasks kanban and presses **Pause
  agent** (the lane then says "Agent paused by …" to everyone). Until someone presses **Resume
  agent**, `post_status` to that lane and every other write of that app or token on the board (its
  lanes are the ones named like it or made by it) fail with `agent_paused` (REST: `423`), before
  anything changes or counts against its write budget; `get_feedback` keeps working and says
  `paused: true`. The pause is the person's, kept in the board (restoring a version doesn't lift it);
  the agent itself can't lift it.
- **Push instead of poll**: on a team workspace's board, the workspace's webhooks deliver the same
  changes as they happen (`item.updated`, `item.created`, `item.deleted`, `comment.created`,
  [events.md](events.md)), signed — an admin can scope an endpoint to the lane (its `laneId`, or the
  kanban's copied link), so the agent is pushed only what people do there.
- What people write reaches the agent as untrusted board content (the envelope), like every read.
- The REST API has the same operations: `POST /api/v1/boards/{boardId}/control-room` (post, needs
  `boards:write`) and `GET /api/v1/boards/{boardId}/control-room?cursor=…` (feedback,
  `boards:read`) — [openapi.json](api/openapi.json).

## How sign-in works (for client developers)

1. `POST /mcp` without a token → `401` with
   `WWW-Authenticate: Bearer realm="freero", resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"`.
2. Protected-resource metadata (RFC 9728) at that URL, also at the bare
   `/.well-known/oauth-protected-resource`: `resource` `https://<host>/mcp`, `authorization_servers`
   `["https://<host>"]`, `scopes_supported` `boards:read boards:suggest boards:write comments:write`.
3. Authorization-server metadata (RFC 8414) at `/.well-known/oauth-authorization-server`. Its
   `issuer` is `https://<host>` (exactly the `authorization_servers` entry above), with
   `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported:
   true` and `none` among `token_endpoint_auth_methods_supported`.
4. The client's identity, either way (#81):
   - **Client ID Metadata Document** (preferred by the MCP spec; what Claude, ChatGPT and Codex use
     when the metadata says so): the `client_id` is the https URL of a JSON document with at least
     `client_id` (that same URL, compared as a plain string), `client_name` and `redirect_uris`
     ([draft-ietf-oauth-client-id-metadata-document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/)).
     Freero fetches it when a signed-in person opens the consent screen: https only, a canonical URL
     with a path on the default port (no query, fragment, credentials or address literals), never a
     private / loopback / link-local address (checked when connecting), no redirects followed, at
     most 5 KB, a few seconds. It must answer `200` with JSON. A good document is kept as long as its
     `Cache-Control: max-age` says, within 5 minutes and a day (an hour without one); a refused one
     is never remembered. Public clients only: `token_endpoint_auth_method` `none` (or a document
     that also lists `none` in `token_endpoint_auth_methods_supported`, as ChatGPT's does); a
     shared secret is refused. The token endpoint uses the stored copy and never fetches.
   - **Dynamic client registration** (RFC 7591): `POST /api/oauth/register` — public clients only
     (`token_endpoint_auth_method: none`); the consent screen says the app registered itself.
5. Authorization code + PKCE (S256 required) at `/oauth/authorize` with
   `resource=https://<host>/mcp` (RFC 8707): the token is bound to the MCP server (the REST API
   refuses it, and the other way round). Loopback redirect URIs match on any port (Claude Code's
   document lists `http://localhost/callback` and `http://127.0.0.1/callback`). Every redirect back
   to the client — the code, a refusal, an error — carries `iss=https://<host>` (RFC 9207), so
   ChatGPT's stable redirect URI `https://chatgpt.com/connector_platform_oauth_redirect` works.
   The consent screen shows a metadata-document app's name next to the host its document came from
   (the name is the app's claim, the host is not), its `client_uri` only when it is on that host,
   never its logo, and warns when it sends you back to a program on this computer.
6. `POST /api/oauth/token`: access token `fro_…` (1 hour) + refresh token `frr_…` (30 days, rotating; a
   replayed refresh token ends the whole consent). The response's `scope` is what the person granted.

Personal access tokens (`frp_…`) are accepted as `Authorization: Bearer` too.

## Self-hosting

Nothing to configure: the MCP server, its OAuth metadata and the consent screen are part of every
Freero server. Set `PUBLIC_URL` to the address people use (the metadata and token audience are built
from it), serve it over HTTPS (ChatGPT and Claude only connect to https URLs), and give clients
`https://<your-host>/mcp`. `PUBLIC_API=false` turns the REST API and the MCP server off together.
Limits: `RATE_LIMIT_API_CREDENTIAL`, `RATE_LIMIT_AGENT_WRITE` ([configuration.md](configuration.md)).

## Live boards in the conversation (MCP Apps)

Freero implements the MCP Apps extension (`io.modelcontextprotocol/ui`, spec 2026-01-26): hosts that
render interactive views — Claude (web, desktop), ChatGPT, VS Code — show a Freero view next to the
tool result; every other host shows the text result as before. The server uses the v2 SDK
(`@modelcontextprotocol/server` 2.2.0) and `@modelcontextprotocol/ext-apps` 2.0.3, both pinned.

| View | Shown for | What it is |
|---|---|---|
| `ui://freero/board-preview.html` | `get_board_outline` | A read-only drawing of the outline the result already carries (frames, clusters, notes in their colours, shapes, cards, mind maps, tables, connectors with labels), with **Open in Freero**. Its resource declares **no domains**: the host lets it reach nothing on the network. Board text goes into it only as `textContent`. |
| `ui://freero/board-live.html` | `open_board` | The real board, live and multiplayer: it frames Freero's own board page for that one board. Header: access badge (Can edit / Can comment / View only), **Share with team**, **Full screen**, **Open in Freero**; **Reconnect** when the view ended. |

Both views follow the host's theme (light / dark) — the live view's board too (#89: `live.html` passes
the theme to the board page when it opens it and on every change; the chrome switches, and the board's
content keeps its own colours, drawn dark through one filter, as the canvas is) — report their height,
and work inline and in full screen. They are static, self-contained HTML in `apps/server/src/modules/mcp/views/` (no build step,
no third-party code, nothing fetched), so hosts can prefetch and review them.

### Security model of the live board

- **What the model sees.** `open_board`'s text and `structuredContent` carry the board id, link and
  access level only. The view's address — Freero's `/embed/board/<id>#ticket=…` — travels in the
  result's `_meta["freero/live"]`, which hosts hand to the view, not to the model.
- **A ticket per tool call, then a short-lived token.** The ticket (`frt_…`, 256 random bits, stored
  as sha256) is single-use and expires after 10 minutes. The page redeems it once
  (`POST /api/embed/redeem`) for a view token (`fre_…`, 1 hour) that opens **that board's socket
  only** (`/ws/embed/boards/<id>`, the token as a WebSocket subprotocol, never in a URL or log).
  Neither the person's session cookie nor the connection's OAuth / personal token ever reaches the
  view; the page drops the ticket from its address right away.
- **Audience and power.** The token acts for the person, through the connection that called the
  tool: it is the person's own role on the board, **capped by what the connection was granted**
  (`boards:write` → editor, `comments:write` → commenter, otherwise view only). So a read + suggest
  connection gets a read-only view, and no one can turn a ticket into more than the connection had.
  The cap is on what the view WRITES; it reads what the person reads, as the connection's
  `boards:read` already does over the API (#89): an owner's or editor's view shows pending suggestions
  (and receives the editors layer), a viewer's never does. Accepting or rejecting one is a write, so it
  needs `boards:write` here too (as `POST …/suggestions/accept` does); otherwise the view says to
  decide in Freero. A suggest-only connection can therefore never accept its own proposals, even
  though its holder could redeem the ticket itself.
  Edits made in the view are the person's own (their name, their undo).
- **Kill switches reach open views.** Every use re-checks the credential behind it: disconnecting
  the app, revoking or pausing the token, "Disconnect all apps and tokens", account suspension or
  deletion, enforced SSO, the team turning **API & apps** off or blocking the app. An open view is
  re-checked every `SESSION_RECHECK_SECONDS` and closed when any of those apply; it also closes when
  its token expires (the view offers **Reconnect**, which is a fresh `open_board` call through the
  host — so the same checks run again).
- **Where it may run.** The page under `/embed/` is the only Freero page that may be framed, and only
  by the assistants in `MCP_APP_FRAME_ANCESTORS` (CSP `frame-ancestors`; default Claude, ChatGPT and
  VS Code webviews); every other page keeps `frame-ancestors 'none'` + `X-Frame-Options: DENY`. The
  view's resource asks the host for exactly one network permission: framing Freero's origin
  (`_meta.ui.csp.frameDomains`), no `connectDomains`, no `resourceDomains`. The board inside runs on
  Freero's origin under Freero's own CSP; the host page can't read or script it.
- **Content rules are the board's.** The socket gets what the person's (capped) role gets: private
  drafts only their own, hidden frames' contents only for editors (a capped view receives them for an
  editor but draws them as a viewer: hidden), suggestions only for owners and editors.
  Exports, uploads, templates, history and sharing are not offered inside the view ("Open in
  Freero"). The team's downloads policy needs nothing extra here: the view shows the board to the
  person and gives the assistant no copy of it (the outline / export tools stay gated by it).
- **Share with team** is a button, not a model decision: `share_board` is `visibility: ["app"]`
  (hosts don't offer it to the model). A link that already lets people in is just returned; turning
  link sharing on or up needs `boards:write` and the board's owner, inside the workspace's link
  policies (maximum role, sharing outside the workspace, verified email, operator blocks) — the same
  rules and `board.link_sharing_changed` audit event as the share dialog.
- Every call (`MCP open_board`, `MCP share_board`) is in the audit log like any other tool call.

### Directory submission readiness

Status: **ready to file, not filed** (filing needs an organisation account and a public HTTPS
deployment). Requirements as published by both programmes in 2026-10; re-check the forms when filing.
Every field of both portals, the reviewer account, the carousel and what only the owner can do:
[marketing/directory-submissions.md](marketing/directory-submissions.md).

| | ChatGPT (OpenAI app directory) | Claude (Anthropic connectors directory) |
|---|---|---|
| Server | Public HTTPS MCP endpoint, Streamable HTTP — `https://<freero>/mcp` ✅ | Same ✅ |
| Sign-in | OAuth 2.1 with PKCE; client ID metadata documents and dynamic client registration ✅ (RFC 7591/8414/9728/8707); `iss` on every authorization response (RFC 9207) for the stable redirect URI ✅ | Same; callback `https://claude.ai/api/mcp/auth_callback` (and `claude.com`) accepted — any https redirect URI is ✅ |
| Tool metadata | Clear names / descriptions, accurate `readOnlyHint` / `destructiveHint` / `openWorldHint` on every tool ✅ | Annotations on every tool ✅; names ≤ 64 chars ✅ |
| Views | `text/html;profile=mcp-app` resources with a declared CSP ✅ (`openai/widgetCSP` mirrored too); a widget domain (`_meta.ui.domain`) if the reviewers ask for a stable origin — then add it to `MCP_APP_FRAME_ANCESTORS` | MCP Apps resources with CSP ✅; views render under `*.claudemcpcontent.com` (in the default `MCP_APP_FRAME_ANCESTORS`) ✅ |
| Safety | Destructive actions confirmed (`delete_items` needs `confirm`), least-privilege defaults (read + suggest), untrusted-content envelope ✅ | Same ✅ |
| Listing | App name, short + long description, Freero logo (`apps/web/public/freero.svg`, own brand), screenshots, 3–5 demo prompts | Name, description, logo, ≥ 3 example prompts, documentation link (this page) |
| Policies | `/privacy`, `/terms`, `/acceptable-use`, `/support` are on the site as **drafts for legal review** ("Draft: not in effect" until `SITE_LEGAL_OPERATOR` is set) | Same |
| Review | Test account with sample boards (no two-step verification), organisation verification in the OpenAI platform — **human step** | Test account, contact for the review — **human step** |

Demo prompts to submit: "Map out our Q1 launch risks on a Freero board and show it to me", "Turn
these meeting notes into a flowchart on my Sprint board", "Group the stickies on my retro board into
themes and propose action items", "What did the team decide on the Roadmap board?".

Screenshots: `scripts/directory-shots.mjs` renders the live view (read from the server) in a
minimal local MCP Apps host that hands it a real `open_board` result, against a server filled by
`scripts/seed-reviewer-account.mjs`; the carousel PNGs are in `marketing/directory-assets/`.

**Privacy notes for the submissions.** The views collect nothing: no analytics, no third-party
code, no cookies (the live board signs in with its own token). What an assistant receives is what
the tools return: board text in the untrusted envelope, ids and links; the live view's board content
goes to the person's browser only, never to the assistant. Every call is audited for the person or
their team; people can disconnect the app (Settings → Connected apps), and team admins can turn API
access off or block the app. Self-hosted operators register their own `https://<host>/mcp` as a
custom connector instead of the directory listing.

### Verifying

`npm run verify --only mcp` checks the views (`_meta.ui`, MIME type, CSP), the ticket (single use,
never in what the model reads), the socket (this board only, capped role, live edits) and that
revoking the token closes an open view. The UI is checked in a local MCP Apps host — a page using
the official `AppBridge` (`@modelcontextprotocol/ext-apps/app-bridge`) and MCP client against a real
server, with the view in a sandboxed iframe on another origin under the CSP its resource declares.

<!-- Sources checked 2026-10: modelcontextprotocol/ext-apps (spec 2026-01-26), npm @modelcontextprotocol/ext-apps 2.0.3 and @modelcontextprotocol/server 2.2.0 (MIT; 2.3+ is Apache-2.0). -->
