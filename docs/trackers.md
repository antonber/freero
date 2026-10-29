# Issue trackers (Jira, Linear, GitHub)

Freero links board items to issues in the tracker a team already uses, and keeps both in step:
select sticky notes, a cluster or cards → **Send to tracker…** → one issue (or one per item) with
every field kept and a link back to each item; each item then shows the issue's key, status and
assignee, live. **Import issues…** (board menu) turns a JQL / search query into linked cards.
Agents do the same through the MCP tool `sync_to_tracker` ([mcp.md](mcp.md)).

## Connecting

| Who | Where | Used by |
|---|---|---|
| A team's owners / admins | Admin console → Issue trackers | the team's full members (not guests), on the team's boards |
| Anyone, for themselves | Settings → Your issue trackers | only them, on any board they can edit |

| Tracker | Address | Credentials | Changes from the tracker |
|---|---|---|---|
| Jira Cloud | `https://<site>.atlassian.net` | API token + the account's email, or OAuth 2.0 (3LO, when the operator registered an app: `TRACKER_JIRA_CLIENT_ID`) | webhooks (a Jira admin adds one: System → WebHooks, the URL and secret Freero shows, events *Issue updated / deleted*); OAuth connections poll |
| Jira Data Center / Server | its base URL | personal access token | webhooks with a secret where the version supports them, otherwise polling (`updated >= -Nm` JQL) |
| Linear | `https://linear.app` | personal API key | webhooks (Settings → API → Webhooks, the URL and secret Freero shows, resource *Issues*) |
| GitHub / GitHub Enterprise Server | `https://github.com` or the GHES address | fine-grained token (Issues: read & write) | webhooks (repository → Webhooks, content type JSON, the secret Freero shows, event *Issues*) |

Freero tests every new connection before keeping it. The webhook secret is shown once (a new one
can be made at any time; the old one stops working at once). A self-hosted tracker on a private
network needs `TRACKER_PRIVATE_ENDPOINTS=true` ([configuration.md](configuration.md)).

## What maps to what

| Board | Issue | Notes |
|---|---|---|
| a card's title / one note's first line / a cluster's heading (shared frame, or the title above the notes) | title | a cluster's title is made from the board and never written back into a note |
| a card's description / a note's text + a link back / a bullet per note with its link back | description | ADF on Jira Cloud, wiki markup on Data Center, Markdown on Linear and GitHub (only Freero's own section of a GitHub issue body, between markers) |
| tags (on notes and cards) | labels | Jira labels can't hold spaces: `checkout flow` ↔ `checkout-flow` |
| card status / kanban column | status | Jira moves through the workflow's transitions (or the card gets a note when none leads there); GitHub: open / closed |
| card assignee | assignee | matched by verified email address; nobody when there is no match (with a note) — not on GitHub |
| card start date (a timeline bar's first day) | start date | Jira's "Start date" field is found by name; not on Linear (issues have none) or GitHub |
| card due date | due date | not on GitHub |
| card estimate (a number) | story points / estimate | Jira's story points field is found by name; not on GitHub |
| each linked item | a remote link (Jira), an attachment (Linear), a line in Freero's section (GitHub) | removed when the item is deleted; the issue stays |

## Roadmap mode (KAI-160)

"Import issues onto this timeline…" (a selected timeline's context menu) runs a query and puts each
issue on the timeline as a linked task card drawn as a bar from its start to its due date, in a lane
per epic (Jira: the parent; Linear: the project; GitHub: the milestone), team (Jira: the project;
Linear: the team; GitHub: the repository) or first label. Lanes are matched by name; an empty
timeline's starter lanes give way to the groups; the range grows to hold the dates. Issues without
dates go to an "Unscheduled · <timeline>" frame below (skipped in presentations); drag one onto the
timeline to give it dates. Moving or resizing a bar writes the card's dates, which sync like any
field; a date changed in the tracker moves the bar in the same board change (the server lays the
timeline out with the shared `timelineLayout.planTimeline`). The timeline's "Now · Next · Later"
view shows the same bars by horizon.

## Conflicts

Each field is merged against what both sides last agreed on: a change on one side flows to the
other (so the last writer wins across syncs). When the SAME field changed differently on both sides
within one sync, the tracker's value wins — it is the system of record other people and automation
read, and record timestamps are per issue / item, not per field, so "who was last" would be a guess —
and the board's value is kept in a comment on the item. Status follows the tracker in any conflict.

## Security

- Credentials (tokens, OAuth tokens) and webhook secrets are sealed at rest with `SESSION_SECRET`
  (`platform/secrets`, rotatable), never sent back to a browser, never logged, never in the audit
  log. Signing out everywhere (password reset, "this wasn't me", suspension, deletion) erases the
  person's own tracker credentials: they connect again.
- Webhooks are verified with HMAC-SHA256 over the raw body and the connection's secret (Jira
  `X-Hub-Signature`, GitHub `X-Hub-Signature-256`, Linear `Linear-Signature` plus a timestamp no
  older than a minute). A verified delivery only says WHICH issue changed: Freero reads the issue
  back with the connection's own credentials, so even a valid replay changes nothing by itself.
- A tracker's address is untrusted (typed by an admin): https only, no private addresses (checked
  when connecting), no redirects, answers capped in size, calls time out.
- The tracker's changes are written onto the board as the person who linked the issue ("Jira for
  Maria"); syncing pauses while they can no longer edit the board. Viewers and commenters get no
  tracker actions. The badge shows the issue's key, status and assignee to everyone who can see the
  board.

## Operations

- Every sync that changed something is in the workspace's audit log (`tracker.synced`, with the
  fields written each way), as are failures (`tracker.sync_failed`), new issues, imports,
  connections and unlinks; the activity feed shows them on the board.
- Rate limits: 429 / 503 answers are retried after the wait the tracker asks for; a longer wait
  pauses that connection and the sync is retried with backoff (up to six hours).
- Syncs run on one instance at a time (the `trackers` outbox consumer); polling and retries run as
  the `trackers:poll` job.
- Removing a connection stops its syncing at once; board items stay as they are and their badges
  say "disconnected".

## Testing without a tracker

`npm run verify -- --only tracker` runs everything above against local mock trackers
(`scripts/lib/mock-jira.mjs` — Cloud, Data Center and Atlassian OAuth — `mock-linear.mjs`,
`mock-github.mjs`). They also run standalone for the UI (`node scripts/lib/mock-jira.mjs --port
4482`, with `TRACKER_PRIVATE_ENDPOINTS=true`).
