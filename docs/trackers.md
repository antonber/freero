# Issue trackers (Jira, Linear, GitHub, Azure DevOps)

Freero links board items to issues in the tracker a team already uses, and keeps both in step:
select sticky notes, a cluster or cards → **Send to tracker…** → one issue (or one per item) with
every field kept and a link back to each item; each item then shows the issue's key, status and
assignee, live. **Import issues…** (board menu) turns a JQL / search query into linked cards, or
— without writing a query — a project's current (or a chosen) sprint, Linear cycle or Azure DevOps
iteration, or an epic's issues (#119, #43).
Agents do the same through the MCP tool `sync_to_tracker` (REST:
`POST /api/v1/boards/{boardId}/trackers/send`, #84), and import with `import_from_tracker` (REST:
`POST /api/v1/boards/{boardId}/trackers/import`) — the same rules as *Import issues…*, placed into a
frame, kanban column or cluster if asked, attributed to the app for the person ([mcp.md](mcp.md)).
Before either, an agent finds the connections it may use on a board, their default projects and one
connection's projects or repositories with `list_tracker_connections` (REST:
`GET /api/v1/boards/{boardId}/trackers`, #83).

An agent that may only suggest (read + suggest, the MCP default) proposes the issues as cards
instead, for people who can edit to review. Each proposed card an editor accepts is then linked to
its issue exactly as an imported card is (#82): the badge, two-way sync and the issue's link back,
through the connection of the person the agent acted for (while they can still edit the board and
use it). The first sync brings the issue's own values onto the card (its title, labels as tags,
assignee); a rejected card is never linked, and an issue someone imported meanwhile leaves the
accepted card plain. The link is made by the server from its own record of what was proposed, so
nobody can link an item to an issue by editing the board.

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
| Azure DevOps Services (#6) | `https://dev.azure.com/<organization>` | personal access token (Work Items: read & write) | service hooks (Project settings → Service hooks → Web Hooks, event *Work item updated*, the URL Freero shows, basic authentication with any user name and the webhook secret as the password — Azure DevOps doesn't sign deliveries), or polling |
| Azure DevOps Server 2020 or later | the collection's address (`https://tfs.acme.internal/tfs/DefaultCollection`) | personal access token | service hooks as above where the server can reach Freero, otherwise polling (`System.ChangedDate`) |

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
| a kanban card's column (its Stage) | the status of that name | Jira / Linear: a card moved to "In review" asks for the "In review" status (case and spaces don't count) before falling back to the column's status category; a column the tracker has no status for sends only its category. From the tracker: the card moves to the column named after the status, else the first column of its category |
| a kanban card's Priority (a single select called "Priority") | priority | Jira: by name (the site's priority scheme); Linear: Urgent / High / Medium / Low. A level the field lacks is added to it. Not on GitHub |
| card assignee | assignee | matched by verified email address; nobody when there is no match (with a note) — not on GitHub |
| card start date (a timeline bar's first day) | start date | Jira's "Start date" field is found by name; not on Linear (issues have none) or GitHub |
| card due date | due date | not on GitHub |
| card estimate (a number) | story points / estimate | Jira's story points field is found by name, Azure DevOps's by process (Story Points, Effort, Size); a manager can pick another in the field map; not on GitHub |
| a kanban card's Sprint (a single select called "Sprint", "Cycle" or "Iteration", #119) | Jira sprint, Linear cycle, Azure DevOps iteration path | by name. Jira: the issue's open sprint (closed ones it passed through are history), moved through Jira Software's agile API (the backlog for none); Linear: the team's cycles ("Cycle 12" when unnamed); Azure DevOps: the path below the project ("Sprint 3", "Release 1\Sprint 3"). A closed sprint is a read-only option: cards keep it, nobody picks it, and one set anyway (an old client, the API) stays in the tracker with a note. Not on GitHub (GitHub Projects iterations are #42) |
| a kanban field the connection's field map names (#43) | a custom field (Jira: select, multi-select, number, date, text, user; Azure DevOps: picklist, number, date, text, identity) | by the kanban field's name and kind, the tracker field's id. A kanban without a field of that name holds no value: nothing is sent or cleared, and what changes in the tracker meanwhile reaches the card once a field of that name is back (rename the field back, or point the map at its new name) |
| parent (send *One per cluster*, or *Under* an epic) | Jira parent (Data Center: Epic Link), Linear parent issue, Azure DevOps parent (Hierarchy-Reverse) | not synced afterwards; not on GitHub |
| each linked item | a remote link (Jira), an attachment (Linear), a line in Freero's section (GitHub), a Hyperlink relation (Azure DevOps) | removed when the item is deleted; the issue stays |

Azure DevOps descriptions are HTML written from a fixed template (paragraphs, bullets, http(s)
links; every piece of board text escaped) and read back as text and links. Its state follows the
work item type's state categories (Proposed → to do, In progress and Resolved → in progress,
Completed and Removed → done); priority is 1–4; the due date is the Target Date.

## The field map (#43)

The people who manage a connection (Admin console → Issue trackers, or Settings for your own) open
**Field map** on it to pick the tracker fields that hold story points and the start date (found by
name when connecting; a pick is kept through later tests), the issue type per project (the send
dialog then offers the project's types, that one first), and custom fields paired with kanban
fields by name: "Team" ↔ `customfield_10050`. A mapped field syncs on every kanban that has a field
of that name and a kind that holds it, with the same merge rule as every other field; an import
into a kanban without one adds it (options from the issues' values) and shows it on the cards.

**Send → One per cluster** (a selection of several clusters, such as a frame of them): a new
epic (Jira; a parent issue on Linear, an Epic work item on Azure DevOps) named after the frame,
listing the clusters, and one issue under it per cluster of items close together (as the board
outline groups them), each linked to its items and called by the cluster's own heading. **Under**
puts new issues under an existing one by its key.

## Importing into a kanban

Imported into a kanban (*Import issues into this kanban…* in a selected kanban's context menu, or
`placement.into` a kanban for agents and the API),
each issue goes to the column named after its status, else the first column of its status's
category ("Sets card status"), else a new column named after it (placed with its category, before
Done for work in progress) — so a board with "In review" gets its In Review issues there, and a
board with only "Ideas / Maybe / Yes" columns gets the tracker's statuses as columns. Into a NEW
kanban (`placement.newKanban`) the columns are the statuses the issues have, in category order.
Issues with a priority give the kanban a **Priority** field when it has none (a single select whose
options are the tracker's levels, most pressing first, shown on the cards); a kanban that has one
gets each card's level, adding a level it lacks. A column the import names (`placement.column`)
keeps its own rule (the column, unless the issue's status category says otherwise). Labels,
assignee and dates stay the card's own tags, assignee and dates (the kanban shows them as fields).
While a kanban is grouped by another field, Stage and Priority are stored values the same rules
set, and the card goes to the column of the field it is grouped by.
Imports and pulls lay the kanban out in the same change, by the board's own rule: a pulled value
of its swimlane field (Priority, say) moves the card into that row, its filter and sort apply to
what comes in, and a column an import opens between others carries the cards already there along.

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

## Sprints (#119)

*Import issues…* → **A sprint** (Cycle on Linear, Iteration on Azure DevOps) picks the project and
"Current sprint" or one from the list; into a kanban, the kanban gets a **Sprint** field (single
select, shown on the cards) whose options are the project's open sprints plus any closed one an
issue holds (read-only). Planning on the board — changing a card's sprint in its details, the
table view, or by dragging while the board is grouped by Sprint — moves the issue in the tracker;
a sprint changed there shows on the next sync (a sprint the field lacks is added, one closed since
turns read-only). **An epic** brings the issues under an epic / parent issue the same way. Agents
use `import_from_tracker` with `scope` (REST: `scope` on `POST …/trackers/import`); the picker's
list is `GET /api/boards/{id}/trackers/connections/{conn}/sprints?project=KEY`.

## Conflicts

Each field is merged against what both sides last agreed on: a change on one side flows to the
other (so the last writer wins across syncs). When the SAME field changed differently on both sides
within one sync, the tracker's value wins — it is the system of record other people and automation
read, and record timestamps are per issue / item, not per field, so "who was last" would be a guess —
and the board's value is kept in a comment on the item. Status follows the tracker in any conflict.
A change on either side while a sync runs is never taken as agreed: a board change that lands
during the sync is sent by the next one, and a tracker change that lands between Freero's write and
its read-back is pulled by the next one. Azure DevOps writes name the revision the sync read, so a
work item someone changed meanwhile is refused instead of overwritten; the sync then reads both
sides again and merges once more (#6).

## Security

- Credentials (tokens, OAuth tokens) and webhook secrets are sealed at rest with `SESSION_SECRET`
  (`platform/secrets`, rotatable), never sent back to a browser, never logged, never in the audit
  log. Signing out everywhere (password reset, "this wasn't me", suspension, deletion) erases the
  person's own tracker credentials: they connect again.
- Webhooks are verified with HMAC-SHA256 over the raw body and the connection's secret (Jira
  `X-Hub-Signature`, GitHub `X-Hub-Signature-256`, Linear `Linear-Signature` plus a timestamp no
  older than a minute); Azure DevOps service hooks, which can't sign, carry the secret as their
  basic authentication password (compared in constant time). A verified delivery only says WHICH
  issue changed: Freero reads the issue back with the connection's own credentials, so even a
  valid replay changes nothing by itself.
- Data exports: a person's own connections (tracker, name, address, account, field map) and the
  issues they linked are in their data export (`trackers.json`); a team's connections are in the
  workspace export. Credentials, OAuth tokens and webhook secrets never are.
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
(`scripts/lib/mock-jira.mjs` — Cloud, Data Center, Atlassian OAuth and the agile API's sprints —
`mock-linear.mjs` with cycles, `mock-github.mjs`, `mock-azure.mjs` — Services and Server, JSON
Patch with revision checks, iterations, service hooks). They also run standalone for the UI (`node
scripts/lib/mock-jira.mjs --port 4482`, `node scripts/lib/mock-azure.mjs --port 4484`, with
`TRACKER_PRIVATE_ENDPOINTS=true`).

Not done yet: Microsoft Entra OAuth for Azure DevOps Services (needs the operator's Entra app
registration; PATs work on both Services and Server), GitHub Projects iterations (#42), and the
manual checks against real trackers (a Jira Cloud site with Jira Software, a Linear workspace, an
Azure DevOps organization) that #43, #119 and #6 ask to record in their PRs.

