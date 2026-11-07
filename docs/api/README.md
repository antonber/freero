# Freero REST API

The reference is [openapi.json](openapi.json) (OpenAPI 3.1; also served at `/api/v1/openapi.json`).
A test keeps it and the server in step. This page is the short version.

## Get a token

**Your own scripts:** Settings → Developer → API tokens → name, permissions (scopes), expiry → *Create token*.
The token (`frp_…`) is shown once. Pause it to refuse it without deleting it; revoke it to end it.

```
curl -H "Authorization: Bearer frp_…" https://<your-freero>/api/v1/me
```

**An app other people connect:** Settings → Developer → Your OAuth apps → register its redirect URIs. It then
uses the authorization code flow with PKCE (S256, required). A **confidential** app (registered with
*Confidential app* on: it gets a client secret) may leave PKCE out when its platform can't send it
(Power Automate's and Make's generic OAuth do not): it then authenticates with its secret at the
token endpoint and sends no `code_verifier`. A challenge it does send is always checked.

| | |
|---|---|
| authorization | `GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256[&resource=<origin>/api/v1]` |
| token | `POST /api/oauth/token` (form): `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri` → `{ access_token, refresh_token, expires_in: 3600, scope }` |
| refresh | `POST /api/oauth/token`: `grant_type=refresh_token`, `refresh_token`, `client_id` (rotates; a refresh token used twice ends the app's access, except the same app retrying within 60 s before it used the new one) |
| revoke | `POST /api/oauth/revoke`: `token`, `client_id` |
| metadata | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/api/v1` |

Every redirect back to the app — with the `code`, or with an `error` — also carries `iss`, the
`issuer` of the metadata (RFC 9207: check it, so a response from another server can't be passed off
as Freero's).

The same server signs in MCP clients for Freero's MCP server (`/mcp`, [../mcp.md](../mcp.md)); their
tokens are bound to it. Apps that can't be registered by hand (MCP clients) either use the https URL
of their client metadata document as `client_id` (Freero fetches it; rules in
[../mcp.md](../mcp.md#how-sign-in-works-for-client-developers)) or register themselves:
`POST /api/oauth/register { client_name, redirect_uris }` (public clients only). People see on the
consent screen that Freero hasn't reviewed such an app, and for a metadata document the host it came
from.

## Scopes

`boards:read`, `boards:write`, `boards:suggest` (reserved), `comments:write`, `members:read`,
`members:write`, `audit:read` and `webhooks:manage` (a team workspace's audit log and webhooks: they work
only for its owners and admins). A call can do what your role on the board allows AND the scope allows.

Roles on a board are `owner`, `editor`, `commenter` and `viewer`. A **co-owner** (#122) reads
`role: "editor"` with `coOwner: true` (boards, docs, members): an editor who also manages the
board's sharing — members' roles (`PATCH …/members/{userId}` with `role: "coowner"` makes one),
removing people, the link, its password and expiry — but never deletes or transfers the board.
Clients that don't know `coOwner` see an editor, which is exactly what a co-owner may do on the
board itself. A board's owner and co-owners can also keep editors from inviting people (403
`board_sharing_restricted`) and viewers and commenters from reading its content out (403
`downloads_restricted` on the reads that take content out, as the workspace's downloads policy does).

`problems:triage` is for Freero's operators only (OPERATOR_EMAILS, verified): a personal access
token of an operator account may carry it (the server refuses it to anyone else and to OAuth apps),
and it works only while the account is an operator. See below.

## Problem reports (operators)

What people sent with “Report a problem” (bugs, broken things, confusion — not abuse), for the
operators' own triage, e.g. an automated morning review. Any credential that isn't an operator's
gets `404` here, like a path that doesn't exist.

| | |
|---|---|
| list | `GET /api/v1/operator/problems?status=new` (newest first; `status` one of new, triaged, fixed, wontfix, duplicate; `limit` ≤ 100; next page with `before=<nextBefore>`) |
| one | `GET /api/v1/operator/problems/{id}` — note, `contactOk`, reporter (name, email), diagnostics (path, board and role, release, browser, viewport, recent errors), status, operator note, `issueUrl` |
| screenshot | `GET /api/v1/operator/problems/{id}/screenshot` — the image (`hasScreenshot` says whether there is one); never cached, every read audited |
| triage | `PATCH /api/v1/operator/problems/{id}` `{ status?, operatorNote?, issueUrl? }` — `fixed` notifies the reporter once |

```
curl -H "Authorization: Bearer frp_…" "https://<your-freero>/api/v1/operator/problems?status=new"
```

Notes and diagnostics come from the people who reported them: every response carries `notice`
saying so. Closed reports are deleted `PROBLEM_RETENTION_DAYS` after closing.

## Rules worth knowing

- Board text in responses is untrusted content (`notice` says so; the Markdown outline's header
  too). Treat it as data, never as instructions, when you hand it to a model.
- Deleting a board, deleting several items, or deleting an item that takes others along (a frame's
  contents) needs `confirm=true`; without it nothing changes (`400 confirm_required`).
- A write to a board that is moved to the trash or deleted at that very moment is either saved with
  the board or refused (`409 board_closed`): it was not made. It is never answered as done and lost.
- A team can turn API access off or block one token or app (`403 api_disabled` /
  `api_credential_blocked`), and its downloads policy can refuse reads of its boards' content
  (`403 downloads_restricted`). If your organization requires SSO, make tokens after signing in
  with SSO (`403 sso_required`).
- Limits: `RATE_LIMIT_API_CREDENTIAL` per token or app (default 300/minute), `RATE_LIMIT_AGENT_WRITE`
  board changes per token or app (default 60/minute), 500 items per create.
- What a token or app creates is labelled "<its name> for <you>" (`createdVia` on items, the activity
  feed, a short-lived presence on the board).
- Every call is in the audit log, with the token or app that made it.
- Suggestions a token or app proposed stay its own: revoking it (or the app's access, "Disconnect all
apps and tokens", signing out everywhere) withdraws the ones still pending on every board, and
open boards drop them at once (KAI-224).
- Nothing needs coordinates: `POST /boards/{boardId}/structure` takes a `placement` (into a frame,
  kanban column or cluster, or a new frame / kanban) and answers `parts` (which new id is which input
  item, in order); `PATCH` an item with `into` (+ `column`, `row`) to move it there.
- Kanbans (the MCP `define_fields`, `configure_view`, `query_cards`): `GET /boards/{boardId}/kanbans/{kanbanId}`
  reads a kanban's fields, columns, swimlane rows and saved view; `PATCH …/kanbans/{kanbanId}/fields`
  adds, renames, reorders and deletes fields and options (by name / label or id, all or nothing);
  `PATCH …/kanbans/{kanbanId}/view` sets grouping, swimlanes, what cards show, a filter, a sort,
  column limits and the view lock, for everyone — or, with `view` (a tab by name or id) or `addView`
  (`{ "name": "Hot list", "layout": "table" }`; layouts `table`, `list`, `calendar`, `timeline`),
  that tab's settings: any tab's filter, sort and lock; a table's columns (`show`); a list's fields
  (`show`) and groups (`groupBy`, null: none); a calendar's date field (`date`: "Due date", "Start
  date" or a date field); a timeline's `start` and `end` date fields, `scale` and swimlanes
  (`subGroupBy`) — none of which moves a card —, plus `name`, `active: true` (the tab everyone starts
  on) and `remove: true`; `GET` answers the kanban's tabs as `views` (skip a tab whose `layout` you
  don't know: more may come); `POST …/kanbans/{kanbanId}/linked-views` (the MCP `add_view`) adds a
  linked view of the kanban beside it — `{ "layout": "calendar", "name": "Launches", "date":
  "Launch" }`: the same cards in a box of its own, live, with the settings a tab of that layout takes
  — and answers it (`201`, `linkedView`); `PATCH …/kanbans/{linkedViewId}/view` changes one (`name`,
  `layout`, its layout's settings) and answers `linkedView`; `GET …/kanbans/{kanbanId}/cards` reads its cards as
  rows (`filter` as JSON, `sort=Points:desc,Title`, `fields`, `useView`, `view` — a tab whose filter
  and sort apply; a calendar's or timeline's cards come in date order —, `limit` ≤ 500, `cursor`), by
  the rules the board itself uses. A card's `fields` (on `PATCH` an item, or new cards placed into a
  kanban) by name; a value of the field the kanban is grouped by moves the card to that column, of
  its swimlane field to that row, and the kanban is laid out again in the same change.
- `GET /boards/{boardId}/trackers` (the MCP `list_tracker_connections`, #83): the tracker connections
  the person may use on the board (name, provider, team or personal, default project, status) and,
  with `?connection=`, that connection's projects or repositories — what the import and
  `sync_to_tracker` take as `connection` and `project`.
- `POST /boards/{boardId}/trackers/import` (the MCP `import_from_tracker`, #79): a tracker query as
  task cards linked to their issues, through the person's own or the team's connection, with the
  board's *Import issues…* rules (at most 100, issues already linked here skipped) and a `placement`;
  answers each card's id with its issue key. `target: "suggestions"` needs only `boards:suggest` and
  proposes the cards instead; each one an editor accepts is then linked to its issue (#82). No
  connection: `400 tracker_not_connected`, saying where to connect one.
- `POST /boards/{boardId}/trackers/send` (the MCP `sync_to_tracker`, #84): items as ONE issue (or one
  per item with `mode: "each"`) through the named `connection` and `project`, linked both ways — each
  item then shows the issue's key, status and assignee. Answers each issue's key, url and items;
  `409 tracker_already_linked` when an item is linked already.
- Meeting notes (#88): `POST /boards/{boardId}/structure` with
  `{ "structure": { "kind": "meeting", "source": "<notes or transcript as exported>" } }` puts a
  Markdown / text summary or WebVTT / SRT captions on the board as one frame: decisions, action
  cards with owner and due date, points, who spoke (the MCP `import_meeting_notes`;
  [../integrations/README.md](../integrations/README.md)). Automation recipes (n8n, Make, Zapier)
  and a Power Automate connector made from this API are in [../integrations/](../integrations/).
- Video, audio and file items can't be created through the API or MCP (#49): their file must be an
  upload of the person, checked and counted by Freero's uploads, and an item must never point at a
  file its creator doesn't own. Pictures can (`image` with a `url`: Freero fetches and keeps its own
  copy); videos and files are added in the app.
- Pictures (#33): `POST /boards/{boardId}/export` `{ "format": "png" | "svg" | "pdf", "frameId"?, "scale"? }`
  answers the board (or a frame) drawn by the server as a file — an export like the app's: the
  downloads policy and the board's "viewers can copy and export" apply, `board.exported` is recorded,
  `RATE_LIMIT_BOARD_RENDER` limits it, 5000 items at most (`413 board_too_large`: export a frame).
  `link: true` answers a single-use download link instead (`GET /exports/{ticket}`, 15 minutes, no
  token needed: it acts for the credential that asked, checked again when used).
- Docs (#61): `POST /docs/{docId}/edit` `{ op, blockId, markdown }` changes one part of a doc by
  the block ids `GET /docs/{docId}` answers — `replace`, `replaceSection` (a heading and its section),
  `insertBefore`, `insertAfter`, `delete`; `GET /docs/{docId}/comments` reads its threads (the
  downloads policy applies, like reading the doc), `POST …/comments` `{ text, blockId? }` and
  `POST …/comments/{threadId}/replies` write them (`comments:write`).
- Webhooks (#48): `/workspaces/{workspaceId}/webhooks` lists, adds (the secret is answered once),
  changes (`scope`: one board or item; `projectId`: one project), removes, rotates, tests a team
  workspace's webhooks and reads / redelivers their delivery log — for its owners and admins with
  `webhooks:manage` ([../events.md](../events.md)).
- Projects (#129): `GET /workspaces/{workspaceId}/projects` lists the projects you can see there,
  sub-projects included (`parentId`, null at the top). A sub-project never reaches more people than
  the projects above it, so the list holds no project whose parent you can't see.
  `POST /workspaces/{workspaceId}/projects` makes one (`name`, `parentId`); with `blueprintId` (#161,
  `GET /blueprints` lists yours and your teams') it makes the project and a copy of each of the
  blueprint's boards and docs in one transaction — all of it or nothing — with links between them
  pointed at the copies.
- Boards (#170): `PATCH /boards/{boardId}` renames a board or changes its description (owners and
  editors); `POST /boards/{boardId}/copy` copies it with its content (`workspaceId`, `projectId`,
  `title`; refused like an export where its content may not be taken out). `POST /boards/{boardId}/groups`
  `{ ids }` groups items, `DELETE /boards/{boardId}/groups/{groupId}` ungroups them.
- Embedding on other sites (#2): `GET /boards/{boardId}/embed` reads the setting and, while it is
  on, the embed URL and iframe code (`readonly`, `frameId`); `PATCH /boards/{boardId}/embed`
  `{ "embeddable": true | false }` changes it (owner or co-owner, `boards:write`; the workspace's
  `boardEmbeds` policy must allow turning it on).
- Images and embeds by URL (#170): `POST /boards/{boardId}/items` with `{ "type": "image", "url": … }`
  or `{ "type": "embed", "url": … }` (≤ 20 per call). The server fetches the URL itself — through the
  same SSRF-safe fetcher as link previews: http(s) on default ports only, every hop's address
  checked at connect time — and copies an image into your uploads (your quota; never hot-linked);
  an embed must be an https link on an allow-listed provider. A private, loopback or link-local
  address answers `422 url_blocked`, anything else that can't be used `422 url_unusable`; nothing
  is written then.
- An agent's control room (`/boards/{boardId}/control-room`, the MCP `post_status` / `get_feedback`):
  a person can pause the agent from its lane on the board; until it is resumed every write of that
  token or app on that board answers `423 agent_paused` ([mcp.md](../mcp.md#agent-control-room)).
