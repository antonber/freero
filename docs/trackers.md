# Issue trackers (Jira, Linear, GitHub, Azure DevOps, Asana, monday.com, ClickUp, Trello)

Freero links board items to issues in the tracker a team already uses, and keeps both in step:
select sticky notes, a cluster or cards → **Send to tracker…** → one issue (or one per item) with
every field kept and a link back to each item; each item then shows the issue's key, status and
assignee, live. **Import issues…** (board menu) turns a JQL / search query into linked cards, or
— without writing a query — a project's current (or a chosen) sprint, Linear cycle or Azure DevOps
iteration, or an epic's issues (#119, #43) — or a whole Asana project, monday.com board, ClickUp
List or Trello board (#120, #121, #180, #181).
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
| Asana (#120) | `https://app.asana.com` (the default) | personal access token, or OAuth (when the operator registered an app: `TRACKER_ASANA_CLIENT_ID`) | webhooks Freero registers itself, one per project you send to or import from (nothing to paste in Asana), and polling (`modified_at`, ten tasks per batch call) as the fallback |
| monday.com (#121) | `https://monday.com` (the default) | API token (Developers → My access tokens), or OAuth (`TRACKER_MONDAY_CLIENT_ID`) | webhooks Freero registers itself on each board you send to or import from, and polling (`updated_at`) as the fallback |
| Trello (#181) | `https://trello.com` (the default) | a token, with the API key it was made for — the operator's (`TRACKER_TRELLO_KEY`: then the form links to Trello's page that issues one) or the person's own (and optionally its secret) | webhooks Freero registers itself on each board you send to or import from (Trello checks the address with a HEAD request first), and polling (`dateLastActivity`, ten cards per batch call) as the fallback |
| ClickUp (#180) | `https://app.clickup.com` (the default) | personal token (`pk_…`: ClickUp → Settings → Apps → API Token), or OAuth (`TRACKER_CLICKUP_CLIENT_ID`) | webhooks Freero registers itself, one per List you send to or import from (ClickUp names the secret it signs them with when it makes one), and polling (the Workspace's tasks updated since, `date_updated_gt`) as the fallback |

Freero tests every new connection before keeping it. The webhook secret is shown once (a new one
can be made at any time; the old one stops working at once — for Asana, monday.com, ClickUp and Trello, where Freero
registered the webhooks, it registers them again with the new secret). Switching an Asana, ClickUp, Trello or
monday.com connection to polling removes the webhooks Freero registered there; switching back
registers them again. A self-hosted tracker on a private
network needs `TRACKER_PRIVATE_ENDPOINTS=true` ([configuration.md](configuration.md)).

## What maps to what

| Board | Issue | Notes |
|---|---|---|
| a card's title / one note's first line / a cluster's heading (shared frame, or the title above the notes) | title | a cluster's title is made from the board and never written back into a note |
| a card's description / a note's text + a link back / a bullet per note with its link back | description | ADF on Jira Cloud, wiki markup on Data Center, Markdown on Linear and GitHub (only Freero's own section of a GitHub issue body, between markers) |
| tags (on notes and cards) | labels | Jira labels can't hold spaces: `checkout flow` ↔ `checkout-flow` |
| card status / kanban column | status | Jira moves through the workflow's transitions (or the card gets a note when none leads there); GitHub: open / closed, and the Project's Status (#42) |
| a kanban card's column (its Stage) | the status of that name | Jira / Linear: a card moved to "In review" asks for the "In review" status (case and spaces don't count) before falling back to the column's status category; a column the tracker has no status for sends only its category. From the tracker: the card moves to the column named after the status, else the first column of its category |
| a kanban card's Priority (a single select called "Priority") | priority | Jira: by name (the site's priority scheme); Linear: Urgent / High / Medium / Low. A level the field lacks is added to it. Not on GitHub |
| card assignee | assignee | matched by verified email address; nobody when there is no match (with a note). GitHub and Trello hide most addresses: a login is a Freero person when they connected their own account there (Settings → Your issue trackers), on GitHub also when their profile shows the address; anyone else stays on the badge only |
| card start date (a timeline bar's first day) | start date | Jira's "Start date" field is found by name; GitHub: the Project's Start date field (#42); not on Linear (issues have none) |
| card due date | due date | GitHub: the Project's Target date field, else the milestone's due date (#42) |
| card estimate (a number) | story points / estimate | Jira's story points field is found by name, Azure DevOps's by process (Story Points, Effort, Size), GitHub's in the Project (Estimate, Points, Story points, Size); a manager can pick another in the field map |
| a kanban card's Sprint (a single select called "Sprint", "Cycle" or "Iteration", #119) | Jira sprint, Linear cycle, Azure DevOps iteration path | by name. Jira: the issue's open sprint (closed ones it passed through are history), moved through Jira Software's agile API (the backlog for none); Linear: the team's cycles ("Cycle 12" when unnamed); Azure DevOps: the path below the project ("Sprint 3", "Release 1\Sprint 3"). A closed sprint is a read-only option: cards keep it, nobody picks it, and one set anyway (an old client, the API) stays in the tracker with a note. GitHub: the Project's Iteration field (#42) |
| a kanban field the connection's field map names (#43) | a custom field (Jira: select, multi-select, number, date, text, user; Azure DevOps: picklist, number, date, text, identity) | by the kanban field's name and kind, the tracker field's id. A kanban without a field of that name holds no value: nothing is sent or cleared, and what changes in the tracker meanwhile reaches the card once a field of that name is back (rename the field back, or point the map at its new name) |
| parent (send *One per cluster*, or *Under* an epic) | Jira parent (Data Center: Epic Link), Linear parent issue, Azure DevOps parent (Hierarchy-Reverse), GitHub sub-issue (#42) | not synced afterwards |
| each linked item | a remote link (Jira), an attachment (Linear), a line in Freero's section (GitHub), a Hyperlink relation (Azure DevOps), an external attachment (Asana), a line in Freero's “On a Freero board” update (monday.com) | removed when the item is deleted; the issue stays |

**GitHub Projects (#42).** A manager sets the connection's **planning Project** in its field map
(`acme/3`: the organization or user and the Project's number; the token needs Projects read &
write). An issue in it — or, without one, in any Project: the first it is in — syncs the Project's
fields, found by name unless the field map picks others: **Status** (single select) ↔ the kanban
column by name (an issue closed, or a Status like Done, is done; a card moved to Done closes the
issue and sets the Status), a number field (Estimate, Points, Story points, Size) ↔ the estimate,
**Iteration** ↔ the kanban's Iteration field (completed iterations read-only; *Import issues → An
iteration* imports the current one), **Start date** and **Target date** (End / Due date) ↔ the
card's dates — so a roadmap bar's start and end both sync. Project fields of other kinds map by id
in the field map. New issues join the planning Project. Without a Target date field the due date is
the **milestone's**: read from its due date, written by moving the issue to the open milestone due
that day (none: a note, the milestone stays). Writes add and remove just the labels and the
assignee that changed. *Under* puts new issues under a parent issue as **sub-issues** (`#12` or
`owner/name#12`), and **A parent issue** imports its sub-issues. A Project field change doesn't
reach a repository's webhooks: polling reads the planning Project's items updated since (switch
the connection to polling, or rely on the fallback poll).

Azure DevOps descriptions are HTML written from a fixed template (paragraphs, bullets, http(s)
links; every piece of board text escaped) and read back as text and links. Its state follows the
work item type's state categories (Proposed → to do, In progress and Resolved → in progress,
Completed and Removed → done); priority is 1–4; the due date is the Target Date.

**Asana (#120).** Tasks are the issues, projects the projects. A kanban card's column is the task's
**section** (by name; from Asana, the card goes to the column named after its section), and done is
Asana's *completed*: a card moved to Done completes the task and moves it to that section, one
moved out of Done reopens it. Elsewhere a section's name says where a task stands (In progress,
Review… → in progress; Done, Shipped… → done; else to do). Notes are Asana's rich text
(`html_notes`, from the same escaped template), the assignee is matched by email (Asana takes an
address), `start_on` / `due_on` are the start and due dates (Asana keeps a start date only with a
due date: one without is noted, not sent), tags are labels (made in the workspace when missing).
Custom fields (text, number, enum, multi-enum, date, people) map by gid in the field map; one the
task's project lacks is noted. *Under* / *One per cluster* make subtasks (`parent`), and **A parent
task** imports a task's subtasks (its id or link). Asana's own search needs a paid plan, so the
import query is a filter of a project: `project:Launch section:"In progress" assignee:me done:no
words` (without `project:` the connection's default project; with only words and no default, Asana's
search). No priority, estimate or sprint of Asana's own: map a custom field for those.

**monday.com (#121).** Items are the issues, boards the projects. On each item's board Freero uses
the first **Status** column (not one called Priority) as the card's column — by label; a label the
column marks done is done, a blank or "Not started" one to do, any other in progress — or, on a
board without a Status column, the item's **group**. The first People column is the assignee (by
email; writing it sets just that person), a Timeline column holds the start date (and the due date
when there is no Date column), the first Date column the due date. The description is an
**update** on the item: the one Freero wrote (edited in place, never a new one per change), else
the item's first; the links back to the board are one more update by Freero. Mapped fields are the
board's columns by id (text, long text, numbers, date, status and dropdown, people; a board without
that column is noted). *Under* makes subitems; **A parent item** imports an item's subitems. The
import query is a filter of a board: `board:Roadmap group:"This week" status:"Working on it"
assignee:me words`. GraphQL complexity: an exhausted budget that resets within a few seconds is
waited out, a longer one is handed back as a wait (the sync retries after it);
429s are retried like every tracker's.

**ClickUp (#180).** Tasks are the issues, **Lists** the projects (the import dialog lists them as
"Space / Folder / List"). A kanban card's column is the task's **status** in its List, by name
(ClickUp's statuses are lowercase: "in review"); a status of type closed / done is done, an open one
to do, any other in progress. The description is ClickUp's Markdown (`markdown_content` written,
`markdown_description` read), assignees are matched by email (ClickUp shows its members'
addresses: the card's assignee is the task's first assignee, the others stay), priority is
Urgent / High / Normal / Low, start and due dates are the task's, **sprint points** are the
estimate, tags are labels (made in the Space when missing), and custom fields (text, number,
drop-down, labels, date, people) map by id in the field map. Writes name only the fields that
changed (a PUT of just those; assignees as add / remove; a tag or custom field its own call).
*Under* / *One per cluster* make subtasks; **A parent task** imports a task's subtasks; **A List**
imports a whole List. The links back to the board are one comment by Freero, edited as items come
and go. The import query is a filter of a List: `list:"Sprint board" status:"in review"
assignee:me tag:web done:no words`.

**Trello (#181).** Cards are the issues, boards the projects. A kanban card's column is the card's
**list**, by name (a list's name says where a card stands: Doing, Review… → in progress; Done… →
done; else to do), and a card moved on the kanban moves to the list of that name (else the first
list of its kind). The description is Trello's Markdown (`desc`), labels are labels (made on the
board when missing), start and due dates are the card's, and custom fields (text, number, date,
drop-down) map by id in the field map (listed from the connection's default board). **Members:**
Trello never shows other members' addresses, so the card's first member is matched to a Freero
person only through that person's OWN Trello connection (Settings → Your issue trackers), which
Freero tested as that Trello username: a card assigned to them gets that member, a member added in
Trello assigns the card to them; anyone else shows as `~username` and is never guessed. No
priority, estimate, sprint or parent of Trello's own (map a custom field for those). The links back
are URL attachments, one per board item. The import query is a filter of a board:
`board:Launch list:"Doing" member:me label:web done:no words`; **A board** imports a whole board.

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
Linear: the team; GitHub: the repository), first label or quarter (the one each bar starts in,
"2026 Q4", lanes in date order). Lanes are matched by name; an empty
timeline's starter lanes give way to the groups; the range grows to hold the dates. Issues without
dates go to an "Unscheduled · <timeline>" frame below (skipped in presentations); drag one onto the
timeline to give it dates. Moving or resizing a bar writes the card's dates, which sync like any
field; a date changed in the tracker moves the bar in the same board change (the server lays the
timeline out with the shared `timelineLayout.planTimeline`). The timeline's "Now · Next · Later"
view shows the same bars by horizon.

**Start dates.** Jira's Start date field and, on GitHub, a Project's Start date field (#42) sync
both ways. Linear issues have no planned start date (only when work started, which Linear sets
itself), so a Linear bar's start stays on the board and the send preview lists it as not mapped.

**Dependencies (#50).** A connector between two linked task cards (two bars, or cards anywhere)
with one arrowhead — the Dependency style: dashed, an arrow at the end — is a dependency: the card
at the tail blocks the one at the arrow. It becomes the tracker's own "blocks" link: a Jira issue
link of type *Blocks*, a Linear *blocks* relation, a GitHub issue dependency (*blocked by*), a
ClickUp dependency (*waiting on*); one made in the tracker between two issues linked on the board
(through the same connection) draws such a connector, and one removed on either side is removed on
the other. Like fields, each pair is merged against what both sides last agreed on
(`tracker_relations`), so a dependency added on one side while it's removed on the other never
comes back by itself, and a change on either side while a sync runs waits for the next one.
Connectors without exactly one arrowhead, or touching notes, shapes or unlinked cards, mean nothing
to the tracker. Not on Asana, monday.com, Trello or Azure DevOps yet.

It is a per-connection switch, **Sync dependencies as blocks links** (Settings → Your issue
trackers, or the admin console; REST `PATCH /api/trackers/connections/:id` `{ "syncDependencies":
true }`): on for connections made from this release, **off for connections that existed before**,
so an upgrade never writes a link to anyone's tracker for arrows boards already had — nor draws
the tracker's. Turning it on sends the arrows already between that connection's linked cards and
draws the tracker's links from the next sync of each issue.

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
sides again and merges once more (#6). Asana and monday.com have no revision to name, so their writes
name only the fields that changed (a PUT of just those fields, a column write of just those
columns): what someone else changed meanwhile in another field is never written over.

## Security

- Credentials (tokens, OAuth tokens) and webhook secrets are sealed at rest with `SESSION_SECRET`
  (`platform/secrets`, rotatable), never sent back to a browser, never logged, never in the audit
  log. Signing out everywhere (password reset, "this wasn't me", suspension, deletion) erases the
  person's own tracker credentials: they connect again.
- Webhooks are verified with HMAC-SHA256 over the raw body and the connection's secret (Jira
  `X-Hub-Signature`, GitHub `X-Hub-Signature-256`, Linear `Linear-Signature` plus a timestamp no
  older than a minute); Azure DevOps service hooks, which can't sign, carry the secret as their
  basic authentication password (compared in constant time). Webhooks Freero registers itself
  (Asana, monday.com) post to an address that names the registration and carries a key (an HMAC
  of it with the connection's secret); Asana's handshake (`X-Hook-Secret`, echoed back) and
  monday.com's challenge are answered only while Freero is registering that webhook, and Asana's
  secret is kept only once — so nobody who learns an address can make it sign with their own
  secret. Asana deliveries are then verified with `X-Hook-Signature` (HMAC-SHA256 of the body
  with the secret Asana issued); monday.com doesn't sign deliveries of webhooks made with a token,
  so its address's key is the credential. ClickUp names the secret its deliveries are signed with
  in its answer when Freero makes a webhook (kept sealed, only while that registration is
  pending); deliveries carry `X-Signature` (HMAC-SHA256 hex of the body). Trello checks an
  address with a HEAD request before it makes a webhook: answered 200 only for an address Freero
  made while it is registering it. With the API key's secret known (the operator's, or one given
  with the connection) every Trello delivery must carry `X-Trello-Webhook`, base64 HMAC-SHA1 of the
  body followed by the registered address; without it, the address's key is the credential. A verified delivery only says WHICH
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
Patch with revision checks, iterations, service hooks —, `mock-asana.mjs` — sections, tags, an enum
custom field, external attachments, OAuth and webhooks with Asana's handshake and signatures — and
`mock-monday.mjs` — Status / People / Date / Timeline columns, groups, updates, subitems, webhooks
with the challenge, a spent complexity budget — and `mock-clickup.mjs` — Spaces, Folders and Lists
with statuses, members with addresses, a drop-down custom field, comments, OAuth and webhooks that
name their signing secret — and `mock-trello.mjs` — lists, labels, hidden member addresses, a
drop-down custom field, URL attachments, the HEAD check and signed webhooks). They also run standalone for the UI (`node
scripts/lib/mock-jira.mjs --port 4482`, `node scripts/lib/mock-azure.mjs --port 4484`, `node
scripts/lib/mock-asana.mjs --port 4485`, `node scripts/lib/mock-monday.mjs --port 4486`, `node scripts/lib/mock-clickup.mjs --port 4487`, `node scripts/lib/mock-trello.mjs --port 4488`, with
`TRACKER_PRIVATE_ENDPOINTS=true`).

Not done yet: Microsoft Entra OAuth for Azure DevOps Services (needs the operator's Entra app
registration; PATs work on both Services and Server), a GitHub App with installation tokens for
operators (#42: tokens work; an App also needs its own webhook route for Projects events), and the
manual checks against real trackers (a Jira Cloud site with Jira Software, a Linear workspace, an
Azure DevOps organization, an Asana workspace, a monday.com account) that #43, #119, #6, #120 and
#121 ask to record in their PRs, and the operator's Asana, monday.com and ClickUp OAuth apps (off
until registered: tokens work without them); real ClickUp Workspace and Trello board checks (#180, #181)
are still to be recorded. monday.com subitems sync their name, people and dates on
their own board (its columns); a whole project imported into a new kanban gets columns for the
sections / statuses its tasks have (an empty section gets none).

