# Events and webhooks

Everything that happens to a board — it is created, renamed, moved, trashed or restored; someone
is given access, or loses it; an item is added, changed or deleted; a comment is written — is
recorded **once** in Freero's event stream (server `modules/events`, KAI-150) and fanned out from
there. Today the stream feeds **workspace webhooks** (`modules/webhooks`, KAI-105): a team
workspace's owners and admins register endpoints in the admin console ("Webhooks") and pick the
event types they want.

The event types and their `data` are a **versioned contract** — they leave Freero through webhooks.
`version` is `1`; within it changes are additive only (new types, new optional fields). The
machine-readable form is [`events.schema.json`](events.schema.json); the server's tests check real
deliveries against it, so a field can't disappear unnoticed.

## How events are recorded

Every event goes through the transactional outbox (`platform/outbox.ts`): it is appended in the
same database transaction as the change that caused it, so an event exists exactly when its change
committed, and a crash at any point loses nothing (consumers replay from their cursor; a replay never
records an event twice).

| Source | Events | How |
|---|---|---|
| boards | `board.created`, `board.renamed`, `board.moved`, `board.trashed`, `board.restored` | appended with the change (`board.events` topic) |
| members | `member.added`, `member.role_changed`, `member.removed` | appended with the membership change, only when the role really changed (`board.members` topic) |
| realtime (saved board content) | `item.created`, `item.updated`, `item.deleted`, `comment.created` | every save of the shared doc raises `board.content`; once the board has been **quiet for `EVENTS_SETTLE_SECONDS`** (3 s; at the latest a minute after the first change) its saved content is compared with what the stream saw last |

So a drag of two seconds is one `item.updated`, a sticky created and typed into is one
`item.created` with its final text, and a burst of changes to one item never becomes sixty events.
A change of more than 500 items at once (a pasted template) reports the first 500.

**What the comparison sees** is the board's shared content as every reader of the board sees it:
never anyone's private drafts, never the contents of a hidden frame. A draft becomes `item.created`
when it is revealed; an item moved into a hidden frame reads as `item.deleted` (it left what
everyone sees), and comments pinned inside a hidden frame are no events at all.

**Who did it** (`actor`): a person (`user`), an app or token acting for a person (`agent`, with the
app's name — the public API and MCP), or Freero (`system`). Item updates and deletions are derived
from saved content, which doesn't record who made each change, so their `actor` is `null`;
`item.created` names the item's creator, `comment.created` the comment's author.

Events are kept `EVENTS_RETENTION_DAYS` (30). Notifications and the activity feed still run on the
in-process events they had before (they need the live socket attribution and per-instance bursts
those carry); moving them onto this stream is a later step.

## The event (format `json`)

```json
{
  "id": "evt_1042",
  "type": "item.created",
  "version": 1,
  "createdAt": "2026-10-28T23:41:07.512Z",
  "workspaceId": "w8f2…",
  "board": { "id": "Qx3…", "title": "Team roadmap", "url": "https://freero.example/board/Qx3…" },
  "actor": { "kind": "user", "id": "u_19…", "name": "Maria" },
  "data": { "item": { "id": "s1", "type": "sticky", "text": "Ship the importer" } }
}
```

`id` grows in the order Freero recorded events; deliveries to one endpoint are not guaranteed to
arrive in that order (retries), so order by `id` if it matters.

| type | `data` |
|---|---|
| `board.created` | `title`, `copyOf?` (the board it is a copy of) |
| `board.renamed` | `title` (new), `from`, `to` |
| `board.moved` | `title`, `to` (the project's name, or `null`: out of its project) |
| `board.trashed`, `board.restored` | `title` |
| `member.added` | `userId`, `role` (`viewer` / `commenter` / `editor`) |
| `member.role_changed` | `userId`, `role`, `previousRole` |
| `member.removed` | `userId` |
| `item.created`, `item.updated` | `item`: `{ id, type, text?, containerId? }` — up to 280 characters of the item's text; `containerId`: the frame or kanban it sits in directly (a card in an agent's control-room lane: the lane's kanban) |
| `item.deleted` | `item`: `{ id, type, containerId? }` (the container it was in) |
| `comment.created` | `threadId`, `messageId`, `itemId` (or `null`: on the board), `containerId?` (the container of that item), `text` (up to 280 characters; mentions read as `@Name`) |

Text in `title`, `text` and names was written by people: treat it as untrusted data.

## What a webhook is never told

Webhooks belong to a team workspace and are read by systems outside Freero, so an event is
delivered only about a board **every full member of that workspace can open through team access**:
never about personal boards, boards in a private project, or boards an operator took down — those
events are not delivered at all, not even as ids. Within a board, the stream already holds only what
every reader sees (above).

## Delivery

- `POST` to the endpoint with `content-type: application/json` and these headers:
  - `Freero-Signature: t=<unix seconds>,v1=<hex>` — HMAC-SHA256 with the endpoint's secret over
    `"<t>.<body>"`. Recompute it and compare in constant time; refuse timestamps more than a few
    minutes old (replays).
  - `Freero-Event` (the type, or `ping` for a test), `Freero-Event-Id` (`evt_…`), `Freero-Delivery`
    (unique per delivery; the same on its retries).
- Any `2xx` answer within `WEBHOOK_TIMEOUT_SECONDS` (10) is a success. Anything else — another
  status, no answer, a redirect (never followed) — is a failed attempt, retried after
  `WEBHOOK_RETRY_BASE_MS` × 4ⁿ (10 s, 40 s, 2.7 min, 11 min, 43 min, 2.8 h; at most 6 h apart) up to
  `WEBHOOK_MAX_ATTEMPTS` (7) attempts.
- After `WEBHOOK_DISABLE_AFTER_FAILURES` (15) failed attempts in a row Freero turns the endpoint
  off, records `webhook.disabled` in the audit log and emails whoever added it. Deliveries made
  meanwhile wait; turning the endpoint back on sends them.
- The delivery log (admin console → Webhooks → Delivery log) keeps 30 days: status, attempts, the
  receiver's answer, timing, and "Send again".

## Formats

- `json` — the event above, signed.
- `slack` — a ready-made message for a Slack *incoming webhook* URL: one sentence ("Maria added a
  sticky note to *Team roadmap*") with the item's text quoted and a link to the item. Board text is
  escaped, so it can't make links or `@channel` pings.
- `teams` — the same as an Adaptive Card for a Microsoft Teams *Workflows* webhook ("When a Teams
  webhook request is received" → post to a channel), with an "Open board" button.
- `discord` — a Discord channel webhook (Server settings → Integrations → Webhooks): one embed whose
  title is the board, linking to the item, with the sentence and the quoted text in its description
  (Markdown-escaped) and `allowed_mentions: { parse: [] }`, so it can never ping `@everyone`, a role
  or a person.
- `google-chat` — a Google Chat space webhook (Apps & integrations → Webhooks): a text message with
  the board's title as its link. Google Chat's webhook text has no escape for its markup, so angle
  brackets in board text become look-alike quotes (no link, no `<users/all>` mention can be made);
  `*`, `_` and `~` in board text may still show as emphasis.
- `mattermost` — a Mattermost incoming webhook: Markdown `text` with the board's title as its link.
  Not an alias of `slack`: Mattermost ignores Slack's `blocks` (so only the plain fallback would
  show) and pings on a plain `@channel` / `@all` / `@here` in text, which Slack's escaping doesn't
  stop. Here Markdown punctuation is escaped, `<`, `>`, `&` become entities and `@` its full-width
  twin, so board text can neither format, link nor ping.
- Matrix is not offered: Matrix has no standard incoming-webhook URL. Posting to a room is the
  client-server API's `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` with an
  access token, or a bridge such as a hookshot bot, each set up per homeserver. Use the `json`
  format with your own bridge, or one of the recipes in [integrations/](integrations/README.md).

A chat format never carries more than the `json` event would (the same rule about which boards send
anything at all), and the test delivery ("Send test") is a short message in the same format.

## Endpoints and their security

- Only owners and admins of a team workspace add, change, test or remove webhooks; every change is
  in the audit log (`webhook.created`, `webhook.updated`, `webhook.secret_rotated`,
  `webhook.deleted`) — never with the secret or the full URL.
- The signing secret (`whsec_…`) is shown once, when the endpoint is added or its secret rotated.
  Both the secret and the URL are sealed at rest (`platform/secrets`); admins see the URL shortened
  to its host and first path segment (a chat app's incoming-webhook URL is itself a credential).
- URLs are untrusted (like link previews and workspace AI endpoints): `https` only, no credentials,
  never to private, loopback, link-local or other reserved addresses — checked when the endpoint is
  added and again by the connection's own DNS lookup (no DNS rebinding), and redirects are never
  followed. An operator whose receivers live on their own network sets `WEBHOOK_PRIVATE_ENDPOINTS`.
- A workspace has at most 20 endpoints. `WEBHOOKS=false` turns the feature off for the instance.

## Scoping an endpoint to a board or an agent's lane (KAI-249)

"Only for" (`scope` in the admin API) takes a board link, an item's copied link
(`…/board/<id>?el=<item>`) or a `freero://board/<id>[#<item>]` address. A **board** scope delivers only
that board's events. An **item** scope — a frame, or an agent's *Tasks · <agent>* kanban (its
control-room lane; `post_status` returns it as `laneId`, [mcp.md](mcp.md#agent-control-room)) — delivers only
item and comment events about that item or what sits directly in it (`item.id` or `item.containerId`,
`comment.itemId` or `comment.containerId`), so an agent is pushed what people do in its lane and nothing
else. The board must be one of the workspace's boards its whole team can open (the only ones that
send webhooks at all); a scope never widens: if the board goes away, the endpoint simply gets nothing.

## Running a receiver locally

`node scripts/lib/webhook-receiver.mjs --port 4502` prints every delivery; with
`WEBHOOK_PRIVATE_ENDPOINTS=true` a development server may send to `http://127.0.0.1:4502/<path>`.
