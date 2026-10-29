# Freero REST API

The reference is [openapi.json](openapi.json) (OpenAPI 3.1; also served at `/api/v1/openapi.json`).
A test keeps it and the server in step. This page is the short version.

## Get a token

**Your own scripts:** Settings → API tokens → name, permissions (scopes), expiry → *Create token*.
The token (`frp_…`) is shown once. Pause it to refuse it without deleting it; revoke it to end it.

```
curl -H "Authorization: Bearer frp_…" https://<your-freero>/api/v1/me
```

**An app other people connect:** Settings → Your OAuth apps → register its redirect URIs. It then
uses the authorization code flow with PKCE (S256, required):

| | |
|---|---|
| authorization | `GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256[&resource=<origin>/api/v1]` |
| token | `POST /api/oauth/token` (form): `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri` → `{ access_token, refresh_token, expires_in: 3600, scope }` |
| refresh | `POST /api/oauth/token`: `grant_type=refresh_token`, `refresh_token`, `client_id` (rotates; a refresh token used twice ends the app's access) |
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
`members:write`. A call can do what your role on the board allows AND the scope allows.

## Rules worth knowing

- Board text in responses is untrusted content (`notice` says so; the Markdown outline's header
  too). Treat it as data, never as instructions, when you hand it to a model.
- Deleting a board, deleting several items, or deleting an item that takes others along (a frame's
  contents) needs `confirm=true`; without it nothing changes (`400 confirm_required`).
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
  item, in order); `PATCH` an item with `into` (+ `column`) to move it there.
- `GET /boards/{boardId}/trackers` (the MCP `list_tracker_connections`, #83): the tracker connections
  the person may use on the board (name, provider, team or personal, default project, status) and,
  with `?connection=`, that connection's projects or repositories — what the import and
  `sync_to_tracker` take as `connection` and `project`.
- `POST /boards/{boardId}/trackers/import` (the MCP `import_from_tracker`, #79): a tracker query as
  task cards linked to their issues, through the person's own or the team's connection, with the
  board's *Import issues…* rules (at most 100, issues already linked here skipped) and a `placement`;
  answers each card's id with its issue key. `target: "suggestions"` needs only `boards:suggest` and
  proposes the cards instead. No connection: `400 tracker_not_connected`, saying where to connect one.
- An agent's control room (`/boards/{boardId}/control-room`, the MCP `post_status` / `get_feedback`):
  a person can pause the agent from its lane on the board; until it is resumed every write of that
  token or app on that board answers `423 agent_paused` ([mcp.md](../mcp.md#agent-control-room)).
