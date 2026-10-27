# Miro ↔ Freero feature parity

What Miro offers, described in our own words, and where Freero stands on each item. Use it to plan the
"parity" work next to the enterprise phases in [ROADMAP.md](../ROADMAP.md).

- **Miro sources:** public product and feature pages, the public pricing page, Miro's monthly "what's
  new" posts (Jan–Apr 2026), Miro developer-platform pages, Miro community threads, and third-party
  reviews. Nothing behind a login was used. Miro's paid add-ons and plan gates are mentioned only
  where they help explain an item.
- **Freero status:** taken from the code in this repo on 2026-10-27 (feature manifests, element model in
  `packages/shared`, engine commands, server modules), not from the README alone. Some work was
  uncommitted in the working tree at the time: snap-to-grid and grid size, engine hooks for multi-text
  elements (table cells), `Host.unfurl` for link previews, and Phase 1 server work (Postgres
  migrations, Redis, object storage, rate limits). Those items are marked *in progress*, and they
  still count as Missing or Partial until they ship.

**Legend**

- **Status:**
  - **Have:** works today.
  - **Partial:** works in part; the note says what's missing.
  - **Missing:** not built.
- **Size** (remaining work, for one experienced agent or dev): **S** ≤ 1 day, **M** a few days,
  **L** 1–2 weeks, **XL** more than that or an ongoing effort. Items marked Have show "—".
- **Priority:**
  - **P0:** first-session expectations.
  - **P1:** weekly use.
  - **P2:** power or role-specific.
  - **P3:** niche, or depends on another vendor's ecosystem.
- **Phase:** the [ROADMAP.md](../ROADMAP.md) phase that already covers the item (1 foundation,
  2 accounts, 3 teams, 4 enterprise, 5 parity polish), **parity** for items the roadmap doesn't list
  yet, and "—" for items already done.

---

## 1. Canvas and navigation

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Infinite canvas | An unbounded 2D board that you pan and zoom freely | Have | — | P0 | — |
| Pan and zoom input | Wheel, trackpad, space-drag and a hand tool to move around | Have | — | P0 | — |
| Zoom shortcuts and controls | Zoom in or out, fit everything, fit the selection, back to 100% | Have | — | P0 | — |
| Touch gestures | Pinch to zoom and two-finger pan on touch screens | Have | — | P1 | — |
| Minimap | A small overview of the board for jumping to areas | Have | — | P1 | — |
| Board background and grid style | Pick the canvas colour, and show the grid as dots, lines or nothing | Have | — | P2 | — |
| Snap to grid | Moves and resizes land on grid steps; the grid size is adjustable | Missing (*in progress*: engine and settings changes uncommitted) | S | P1 | 5 |
| Alignment guides | Edges and centres snap to nearby items while dragging, with visible guides | Have | — | P0 | — |
| Equal-spacing hints | Shows and snaps to equal gaps between neighbours while dragging | Missing | S | P2 | parity |
| Arrow-key nudge | Moves the selection a little with the arrow keys | Have | — | P1 | — |
| Link to an item | Copies a URL that opens the board zoomed to one item or frame | Have | — | P1 | — |
| Board outline | A list of frames for jumping around big boards | Have (Frames panel) | — | P1 | — |
| Shortcut reference | A cheat sheet of keyboard shortcuts inside the app | Missing | S | P1 | parity |
| Large-board performance | Stays smooth with thousands of items | Have (viewport culling; level of detail from quantized zoom) | — | P0 | — |
| Accessibility on the board | Move through board items with the keyboard, have a screen reader describe them, high-contrast option | Partial: the chrome has labels and images have alt text; you can't step through board items with the keyboard or have their content read out | L | P2 | parity |
| Interface languages | The UI in several languages | Missing | M | P3 | parity |

## 2. Board content

### 2a. Core items

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Sticky notes | Coloured notes whose text shrinks to fit; fast keyboard chaining | Have (12 colours, add-next-to and Tab chaining, auto-fit) | — | P0 | — |
| Paste a list as stickies | Pasting multi-line text makes one sticky per line | Have (sticky `importData`; ROADMAP Phase 5 still lists it) | — | P1 | — |
| Sticky author label | Optionally shows who wrote each sticky | Missing | S | P2 | parity |
| Capture paper stickies | Photograph physical notes and turn them into digital stickies | Missing | L | P3 | parity |
| Basic shapes | Rectangles, ellipses, polygons, arrows, callouts with fill, border and text | Have (21 shapes) | — | P0 | — |
| Change shape type | Swap an existing shape for another kind and keep its text and style | Have | — | P1 | — |
| Text boxes | Free text with font, size, colour, highlight, lists, links, bold/italic/underline/strike | Have | — | P0 | — |
| Connectors | Straight, elbow or curved lines that stay attached to items, with arrowheads, styles and a label | Have | — | P0 | — |
| Quick connect | Drag from a handle on an item to draw a line or create a linked item | Have | — | P1 | — |
| Richer connector labels | Several labels on one line, placed anywhere along it | Partial: one label per connector | S | P2 | parity |
| Attach anywhere on the outline | Connector ends fix to any point of a shape's edge, not only side midpoints | Partial: anchors are auto/top/right/bottom/left | S | P2 | parity |
| Pen and highlighter | Freehand pressure-sensitive ink and a translucent marker | Have | — | P0 | — |
| Eraser | Rubs out ink | Partial: deletes whole strokes; can't erase part of a stroke | M | P2 | 5 |
| Smart drawing | Turns rough hand-drawn shapes into clean shapes | Missing | M | P2 | parity |
| Images | Upload, paste, drag and drop, or paste an image link | Have (PNG/JPG/GIF/WebP/SVG) | — | P0 | — |
| Image crop | Trim an image on the board without editing the file | Missing | M | P1 | parity |
| Image alt text | A description of the image for accessibility | Have | — | P2 | — |
| Emoji and stickers | Place emoji and decorative stamps on the board | Have | — | P1 | — |
| Custom sticker sets | Save your own images as a reusable sticker palette | Missing | M | P3 | parity |
| Frames | Titled areas that hold items, with size presets and fit-to-content | Have | — | P0 | — |
| Hide frame contents | Keep a frame's contents hidden from others until the facilitator reveals them | Missing (the element model has a `hidden` field, but nothing reads it) | M | P2 | parity |
| Task cards | Cards with title, description, assignee, due date, status and tags | Have | — | P1 | — |
| Kanban widget | Columns that hold cards; moving a card to another column changes its status | Partial: there's a kanban *template* made of frames and cards; no column widget that updates status | M | P1 | parity |
| Tags | Named, coloured labels on items, for filtering and grouping | Have (stickies and cards) | — | P2 | — |
| Mind maps | A central topic with automatically laid out branches; add, collapse and tidy | Have | — | P1 | — |
| Mind map keyboard navigation | Arrow keys move between nodes | Missing | S | P2 | 5 |
| Outline to mind map | Paste an indented outline to build a map, and the reverse | Missing | S | P2 | parity |
| Item links | Any item can open a URL or jump to another item or frame when clicked | Partial: links only inside text; no item-level link or jump target | S | P1 | parity |

### 2b. Diagramming and shape libraries

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Flowchart set | The full set of standard flowchart symbols | Partial: decision, data, document, database, predefined process are there; no manual input, delay, off-page reference, merge, display or similar | S | P1 | parity |
| Shape library browser | A searchable panel of shape sets that you enable per board | Missing | M | P1 | parity |
| Icon library | Search a large icon set and place icons as items | Missing (`lucide-react` is already a dependency) | M | P1 | parity |
| UML shapes | Class, sequence, use-case, activity and state symbols | Missing | M | P2 | parity |
| BPMN shapes | Events, tasks, gateways, pools and lanes for business processes | Missing | M | P2 | parity |
| ERD shapes | Entity tables and crow's-foot line ends for data models | Missing (no crow's-foot caps) | M | P2 | parity |
| Cloud architecture icons | Provider icon sets for AWS, Azure, Google Cloud and Kubernetes | Missing | M | P2 | parity |
| Wireframe kit | Device frames and UI controls for low-fidelity mockups | Missing | L | P2 | parity |
| Interactive prototypes | Clickable screens linked into a flow you can play | Missing | XL | P3 | parity |
| Custom shape packs | Upload your own SVG shapes as a reusable library | Missing | M | P3 | parity |
| Diagrams as code | Build editable diagrams from Mermaid or PlantUML text | Missing | M | P2 | parity |
| Swimlanes and containers | Row and column lanes that hold and move diagram items | Missing | M | P2 | parity |
| Auto-layout and org charts | Arrange a connected diagram or hierarchy automatically | Missing (mind maps only) | L | P2 | parity |
| Obstacle-avoiding routing | Elbow connectors route around other items | Partial: elbow routing doesn't avoid other items | M | P2 | parity |
| Diagram layers | Named layers inside a diagram that you can show or hide | Missing | L | P3 | parity |

### 2c. Structured content

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Tables | A grid of editable cells on the board; add or remove rows and columns | Missing (*in progress*: engine hooks for multi-text elements and undoable collections uncommitted) | L | P1 | 5 |
| Data tables | Typed columns (status, person, date), several views, rows linked to board items | Missing | XL | P2 | parity |
| Timeline / Gantt | Bars on a date axis with lanes, for roadmaps and plans | Missing | L | P2 | parity |
| Docs | Long-form rich documents (headings, lists, tables) that live on the board | Missing | L | P2 | parity |
| Code blocks | Monospaced code with syntax highlighting | Missing (text has a mono font only) | S | P2 | parity |
| Charts | Bar, line or pie charts from entered data | Missing | M | P3 | parity |
| Slides | A deck view built from board content, with slide layouts | Partial: frames act as slides in presentation mode; no deck editor or layouts | L | P2 | parity |

### 2d. Media, files and embeds

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Link previews | A pasted URL becomes a card with title, description and image | Missing (*in progress*: `Host.unfurl` contract uncommitted) | M | P1 | parity |
| PDF on the board | Upload a PDF and page through it or place its pages on the board | Missing | L | P1 | parity |
| Video embeds | Play YouTube or Vimeo videos inside an item | Missing | M | P2 | parity |
| Generic embeds | Live iframes of other web tools (design files, docs, spreadsheets) | Missing | M | P2 | parity |
| Video and audio upload | Upload a media file and play it on the board | Missing | M | P2 | parity |
| File attachments | Any file as a downloadable card | Missing | S | P2 | parity |
| Office documents | Preview Word, PowerPoint or Excel files on the board | Missing | L | P3 | parity |

## 3. Editing productivity

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Selection | Click, Shift-click and marquee selection, select all | Have | — | P0 | — |
| Move, resize, rotate | Transform handles, keeping aspect ratio where it applies | Have | — | P0 | — |
| Undo and redo | Per-user history that never undoes other people's changes | Have | — | P0 | — |
| Copy, paste, duplicate | Including between boards and tabs | Have | — | P0 | — |
| Paste and drop from outside | Text, images and image links from the clipboard or drag and drop | Have | — | P0 | — |
| Group | Select and move several items as one | Have | — | P1 | — |
| Lock items | Pin items so they can't be moved or edited by accident | Have | — | P1 | — |
| Stacking order | Bring to front, send to back | Partial: front and back only; no one step forward or back | S | P2 | parity |
| Align | Line up the selection's left, centre, right, top, middle or bottom edges | Missing | S | P1 | 5 |
| Distribute | Space the selection evenly across or down | Missing | S | P1 | 5 |
| Tidy into a grid | Arrange a messy pile of items into a neat grid | Missing | S | P2 | parity |
| Find on board | Search all text on the board and step through the matches | Missing | M | P1 | 5 |
| Find and replace | Replace text across the board | Missing | S | P2 | parity |
| Layers / object list | A panel listing items in stacking order to select, hide or lock them | Missing | M | P2 | 5 |
| Copy style | Copy one item's formatting onto others | Missing | S | P2 | 5 |
| Edit mixed selections | Change colour or text size across a selection of different item types | Partial: format controls appear only when every selected item has the same type | M | P2 | parity |
| Selection filter | Narrow a selection to one item type (e.g. only stickies) | Missing | S | P2 | parity |
| Version history | Browse, preview and restore earlier states of the board; name versions | Missing | L | P1 | 4 |
| Activity feed | Who changed what on the board, and when | Missing | M | P2 | parity |

## 4. Collaboration

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Real-time co-editing | Everyone's changes appear live and merge without conflicts | Have (Yjs) | — | P0 | — |
| Live cursors | Named, coloured cursors for each collaborator | Have | — | P0 | — |
| Remote selections | See what others have selected and who is typing | Have | — | P1 | — |
| Presence list | An avatar stack of who is on the board | Have | — | P0 | — |
| Follow someone | Your view tracks a collaborator's view | Have | — | P1 | — |
| Bring everyone to me | Move all participants' views to yours | Have | — | P1 | — |
| Live reactions | Emoji bursts on everyone's screen | Have | — | P2 | — |
| Hide cursors | Turn other people's cursors off to reduce noise | Missing | S | P2 | parity |
| Comments | Threads on the board or on an item; replies, reactions, resolve, unread, filters | Have | — | P0 | — |
| @mentions | Tag people in comments to pull them in | Missing | M | P1 | 2 |
| Notifications | In-app and email alerts for mentions, replies and invites | Missing | L | P1 | 2 |
| Private mode | Participants add content that others can't see until it's revealed | Missing | L | P1 | parity |
| Attention management | The facilitator keeps everyone in their view and stops people wandering off | Partial: follow and bring-everyone exist; there's no enforced follow or locked view | M | P2 | parity |
| Async video walkthroughs | Record a narrated tour of the board (camera plus pointer) for others to watch later | Missing | L | P2 | parity |
| Audio and video calls | Talk and see each other inside the board | Missing | XL | P2 | parity |

## 5. Facilitation and presentation

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Shared timer | One countdown everyone sees, with presets and a sound at zero | Have | — | P1 | — |
| Dot voting | Facilitator-run voting with per-person limits, chosen items, hidden results and a ranking | Have | — | P1 | — |
| Estimation / planning poker | Everyone estimates stories privately, then the estimates are revealed together | Missing | M | P2 | parity |
| Live polls, Q&A, word clouds | Audience activities whose results land on the board | Missing | L | P2 | parity |
| Presentation mode | Step through frames full screen without the editing chrome | Have | — | P1 | — |
| Audience follows presenter | Viewers' screens follow the presenter, with a banner showing who is presenting | Have | — | P1 | — |
| Laser pointer | A temporary pointer trail everyone sees while presenting | Missing | S | P2 | parity |
| Presenter notes | Private notes for each slide or frame | Missing | S | P3 | parity |
| Facilitator controls | Lock the board for non-facilitators, or restrict tools during a session | Missing | M | P2 | parity |
| Timer music | Optional background music while the timer runs | Missing | S | P3 | parity |
| Icebreaker widgets | Dice, spinners and other playful session helpers | Missing | M | P3 | parity |

## 6. Templates

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Template picker | A searchable gallery that inserts an editable layout, also offered when you create a board | Have | — | P0 | — |
| Template breadth | A large library across agile, strategy, research, UX, diagramming, education and meetings | Partial: 13 original templates; Miro advertises thousands | L | P1 | parity |
| Save as template | Turn a board or selection into your own reusable template | Missing | M | P1 | parity |
| Team templates | Templates shared across a team or workspace | Missing | M | P2 | 3 |
| Community gallery | Publish templates publicly and browse other people's | Missing | L | P3 | parity |
| Guided board setups | Reusable board structures with steps and instructions for a whole process | Missing | L | P3 | parity |

## 7. AI

Miro sells AI on credits per plan. For Freero, every row here needs a model provider (see §15).

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Generate ideas | Make a set of stickies from a prompt | Missing | M | P2 | parity |
| Cluster and sort | Group stickies by theme or sentiment | Missing | M | P2 | parity |
| Summarise | Turn a selection or a board into a written summary | Missing | M | P2 | parity |
| Text to diagram | Make a flowchart, mind map or sequence diagram from a description | Missing | M | P2 | parity |
| Image generation | Make an image from a prompt | Missing | M | P3 | parity |
| Board-aware assistant | A chat assistant that reads and edits the board | Missing | L | P3 | parity |
| AI workflows | Reusable multi-step AI pipelines run on board content | Missing | XL | P3 | parity |
| AI slides | Build a presentation from board content automatically | Missing | L | P3 | parity |
| Natural-language search | Find content across all boards by describing it | Missing | L | P3 | parity |
| Screenshot to prototype | Turn a UI screenshot into an editable mockup | Missing | XL | P3 | parity |
| AI admin controls | Turn AI on or off for the org, choose the model, use your own key | Missing | M | P3 | parity |

## 8. Import, export and backup

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Image export | Board, selection or visible area as PNG or JPG, with a scale option | Have | — | P0 | — |
| Vector export | The same areas as SVG | Have | — | P2 | — |
| PDF export | Frames as pages of a PDF | Have | — | P1 | — |
| Copy as image | Put the selection on the clipboard as a picture | Have | — | P1 | — |
| CSV export | Text of stickies and cards as rows | Missing | S | P2 | parity |
| CSV / spreadsheet import | Rows become stickies or cards | Missing | S | P2 | parity |
| Board backup and restore | Download a full-fidelity board file and restore it later or elsewhere | Missing | M | P2 | 4 |
| Diagram import | Bring in Visio, draw.io or Lucid diagrams as editable shapes | Missing | L | P3 | parity |
| Import from other whiteboards | Bring boards over from Miro, Mural and similar tools | Missing | L | P2 | parity |
| Print | Print the board or its frames | Partial: through PDF export only | S | P3 | parity |

## 9. Integrations, developer platform and embeds

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Public REST API | Read and write boards, items and members from code | Missing | L | P2 | parity |
| Webhooks | Push board and item events to other systems | Missing | M | P2 | parity |
| API tokens and OAuth apps | Credentials that let third-party apps act for a user | Missing | M | P2 | parity |
| Embed a live board | Put a viewable or editable board in other sites (iframe, oEmbed) | Missing | M | P2 | parity |
| In-board app SDK | Third-party apps that run on the canvas and add items or panels | Missing | XL | P3 | parity |
| App marketplace | Browse and install third-party apps | Missing | XL | P3 | parity |
| MCP server | Let AI coding and agent tools read and write boards | Missing | M | P3 | parity |
| Chat integrations | Board notifications and link previews in Slack or Teams | Missing | M | P3 | parity |
| Work-tracker sync | Two-way sync between cards and Jira, Asana or Azure DevOps issues | Missing | XL | P3 | parity |
| Cloud file pickers | Insert files from Google Drive, OneDrive or Dropbox | Missing | M | P3 | parity |
| Meeting-app integrations | Open a board inside Zoom, Teams or Meet calls | Missing | L | P3 | parity |

## 10. Apps and platforms

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Desktop browsers | Full editing in current Chrome, Edge, Firefox and Safari | Have | — | P0 | — |
| Tablet and stylus | Touch-friendly editing with pen input | Partial: pinch and touch are handled and the pen is pressure-aware; no tablet-specific layout | M | P2 | parity |
| Phone web | Usable view-and-comment experience on a small screen | Partial: some responsive chrome rules; the board UI isn't designed for phones | M | P2 | parity |
| Installable app (PWA) | Install from the browser with an icon, a window and file handling | Missing | S | P2 | parity |
| Native mobile apps | iOS and Android apps | Missing | XL | P3 | parity |
| Native desktop apps | Windows and macOS apps | Missing | M | P3 | parity |
| Offline work | Edit without a connection and sync later | Partial: Yjs merges edits made during short disconnects; nothing survives a reload while offline (the `/board/local` sandbox is dev-only) | L | P3 | parity |

## 11. Accounts, teams, sharing

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Email sign-up and login | Create an account with email and password | Have | — | P0 | — |
| Profile | Name and cursor colour; avatar picture | Partial: name and colour only (the `avatar_url` column isn't used) | S | P2 | 2 |
| Password reset and email verification | Recover access; prove you own the address | Missing | M | P1 | 2 |
| Google / Microsoft sign-in | Sign in with an existing work account | Missing | M | P1 | 2 |
| Two-factor auth | One-time codes plus recovery codes | Missing | M | P2 | 2 |
| Sessions and devices | See and revoke signed-in devices | Missing | S | P2 | 2 |
| Account deletion | Delete your account and its data yourself | Missing | S | P2 | 2 |
| Board dashboard | Grid or list of boards, search, sort, owner filter, stars, recent, shared with me, thumbnails | Have | — | P0 | — |
| Board lifecycle | Create (blank or from a template), rename, duplicate, delete, leave | Have | — | P0 | — |
| Trash and restore | Recover deleted boards for a while | Missing | S | P1 | parity |
| Board roles | Owner, editor, commenter and viewer per board | Have | — | P0 | — |
| Invite existing users | Add people by email with a role | Have | — | P0 | — |
| Invite people without an account | Email invite → sign up → land on the board | Missing ("No Freero account with that email") | M | P0 | 2 |
| Share by link | Anyone with the link gets a chosen role | Have (signed-in users only) | — | P0 | — |
| Anonymous visitors | Open a shared link without an account, with a guest name | Missing (every board route needs a session) | M | P1 | parity |
| Request access | Ask the owner for access from a locked board | Missing | S | P2 | 3 |
| Transfer ownership | Hand a board to someone else | Missing | S | P2 | 3 |
| Link password or expiry | Protect public links | Missing | S | P3 | parity |
| Workspaces and teams | Shared spaces with members and team-wide boards | Missing | L | P1 | 3 |
| Projects / folders | Group boards inside a workspace | Missing | M | P1 | 3 |
| Team roles | Workspace owner, admin, member and guest | Missing | M | P2 | 3 |
| Sharing policies | Rules for who may share, export or invite guests | Missing | M | P2 | 3 |
| User groups | Named groups of people to share boards with | Missing | M | P3 | parity |

## 12. Admin, security and compliance

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Transport and app hardening | TLS, security headers, rate limits, upload quotas | Partial (*in progress*: Phase 1 platform work uncommitted; TLS through the Caddy deploy config) | M | P1 | 1 |
| Backups and disaster recovery | Operator backups and restores of the database and files | Missing | M | P1 | 1 |
| Horizontal realtime scale | Many app instances share board updates | Partial (*in progress*: a Redis client exists; realtime fan-out not wired yet) | L | P1 | 1 |
| Encryption at rest | Stored data encrypted | Partial: depends on the Postgres and S3 provider; nothing at app level | S | P2 | 1 |
| SSO | SAML 2.0 / OIDC per workspace, verified domains, enforced SSO | Missing | L | P2 | 4 |
| SCIM provisioning | Create and remove users automatically from the identity provider | Missing | L | P3 | 4 |
| Admin console | Manage members, roles, security settings and usage | Missing | L | P2 | 4 |
| Audit log | Record of security-relevant events, with export and SIEM streaming | Missing | L | P2 | 4 |
| Data export and erasure | Per-user and org export and deletion (GDPR) | Missing | M | P2 | 4 |
| Retention policies | Delete or archive content automatically after a set time | Missing | M | P3 | 4 |
| Session policies | Idle timeouts and session length rules | Missing | S | P3 | 4 |
| Domain control | Claim a domain, capture accounts, block personal sign-ups | Missing | M | P3 | 4 |
| Admin usage analytics | Activity and adoption reports | Missing | M | P3 | 4 |
| eDiscovery and legal hold | Keep and export a person's board history for legal cases | Missing | L | P3 | parity |
| Data classification / DLP | Scan boards for personal or payment data and apply rules | Missing | XL | P3 | parity |
| Customer-managed keys | Encrypt an org's data with keys the org controls | Missing | XL | P3 | parity |
| Data residency | Choose the region where data is stored | Missing | XL | P3 | parity |
| Compliance certifications | Independent audits (SOC 2, ISO 27001) and the paperwork that goes with them | Missing | XL | P3 | parity |
| Abuse reporting and moderation | Report and take down harmful public boards | Missing | M | P2 | parity |

## 13. Plans and limits (context only, not counted)

| Topic | Miro (public pricing page, 2026) | Freero |
|---|---|---|
| Free tier | 3 editable boards, low-resolution export, view-only visitors, a small AI trial, no private boards, timer/voting/private mode on paid plans only | Everything is free; no plan gates |
| Paid gates | Guests, SSO and data tables from the mid tier; SCIM, audit logs, domain control, extra residency regions and enterprise APIs at the top tier | None planned; limits are operator quotas |
| Paid add-ons | Data classification, key management, lifecycle management, eDiscovery, AI blocking, prototyping add-on | n/a |
| Usage limits | AI credits per member per month; MCP calls per day | Upload quota per user, request and WebSocket rate limits (see `docs/configuration.md`) |

---

## 14. Summary

Counts cover every capability row in §1–§12 (§13 isn't counted).

**By status**

| Status | Count |
|---|---|
| Have | 57 |
| Partial | 21 |
| Missing | 127 |
| **Total** | **205** |

**By priority and status**

| Priority | Have | Partial | Missing | Total |
|---|---|---|---|---|
| P0 | 30 | 0 | 1 | 31 |
| P1 | 22 | 6 | 23 | 51 |
| P2 | 5 | 13 | 61 | 79 |
| P3 | 0 | 2 | 42 | 44 |

<!-- counts generated from the tables above; regenerate when rows change -->

**Takeaways**

- Freero already covers nearly all first-session expectations. The one P0 gap is inviting someone who has no
  account yet.
- The weekly-use (P1) gaps are mostly the editing basics (align/distribute, find, snap to grid,
  version history), diagramming breadth, richer content (tables, link previews, PDFs, crop,
  kanban), and the social loop (mentions, notifications, private mode, anonymous visitors, teams).
- The long tail (P2/P3) is diagram libraries, structured content, AI, the developer platform and
  enterprise governance.

## 15. Recommended build order (web parity work)

These batches cover the P0 and P1 items, plus a few P2 items that come almost for free inside the same
batch. Each batch is sized for one agent and follows the Dune layout: a new
`apps/web/src/features/<name>/` folder made with `npm run new:feature`, and engine changes only when a
capability cuts across types. Batches 1–3 are independent and can run in parallel. Batch 7 is
server-heavy and follows the ROADMAP phases rather than this list.

**Batch 1: Arrange (align, distribute, tidy, snap)**
- **Items:** align, distribute, tidy into a grid (P2), snap to grid (finish the in-progress engine
  change), one-step forward and back (P2).
- **Fit:**
  - New feature `features/arrange/`. Its `format.tsx` has `appliesTo: sel.length >= 2`, so it appears
    for mixed selections, and its `commands.ts` adds shortcuts and context-menu entries.
  - All writes go through one `editor.updateMany` inside a gesture (one undo step). Use
    `editor.getBounds` so frames' visual outsets are respected.
  - Snap-to-grid stays in the engine (`geometry/snap.ts`, settings map: the engine is the single
    writer), as the working tree already does. One step forward or back belongs next to
    `bringToFront` in the engine.

**Batch 2: Find, shortcuts and item links**
- **Items:** find on board (plus find and replace, P2), shortcut cheat sheet, item-level links
  (URL or jump to an item or frame).
- **Fit:**
  - Find needs every type's searchable text without features knowing each other. Add an additive
    engine hook, `ElementDefinition.searchText?(el)`, implement it in sticky, shape, text, card,
    mindmap, frame (title) and connector (label), then build `features/find/` as a `dock-right`
    panel that selects and zooms with `editor.select` and `zoomToRect`.
  - The cheat sheet is `features/shortcuts/`, a `dialog` panel. It needs a read-only
    `editor.listCommands()` in `@engine`.
  - Item links apply to every type, so they're an engine change: add a `link?` field on
    `BaseElement` in `packages/shared`, a common control in the engine format toolbar, and open or
    jump on click with the select tool (`?el=` already resolves item targets).

**Batch 3: Board content gaps**
- **Items:** image crop, kanban widget, mind-map arrow-key navigation (P2), richer connector
  labels and outline anchors (P2).
- **Fit:**
  - Crop: add a `crop` rect to `ImageElement` in shared; the `image` feature renders with
    `object-view-box` or a clip and adds a crop mode in `format.tsx`.
  - Kanban: new `features/kanban/` element with `container: true`, so the engine's existing
    "innermost container" membership rule assigns a dropped card to its column (`frameId`). Each
    column maps to a status. The kanban feature changes a card's status only through a new
    `card.setStatus` command (`editor.runCommand`), so `card` stays the single writer of card fields.
  - Mind-map arrows: `onKeyDown` in the `mindmap` element definition.

**Batch 4: Diagramming**
- **Items:** full flowchart set, a shape library browser, an icon library; then UML, BPMN and ERD
  sets with crow's-foot caps (P2) as follow-ups in the same pattern.
- **Fit:**
  - Extend `ShapeKind` in `packages/shared` (shape geometry lives in `features/shape/lib/geometry.ts`).
  - The library browser is a `dock-right` panel in `features/shape/`, because it inserts shapes, and
    shape is the single writer.
  - Icons are a new `features/icon/` element that renders `lucide-react` glyphs by name (tintable,
    connectable), with its own picker panel.
  - Crow's-foot caps are a `CapStyle` addition in `connector`.

**Batch 5: Tables**
- **Items:** tables (the P1 basics: cells, rows and columns, resize, cell text formatting).
  Data-table columns and views come later.
- **Fit:**
  - New `features/table/`. The in-progress engine work (`textPartAt`, `startEditing({ part })`,
    `copyContent`/`pasteContent`, `undoable` collections) exists for exactly this.
  - Store the grid shape on the element and the cells in an owned `tables` collection with one key
    per cell. Then two people editing different cells merge instead of overwriting each other, which
    is the LWW-per-key guidance in ARCHITECTURE.md.

**Batch 6: Web content (link previews, PDF)**
- **Items:** link previews, PDF on the board; video and generic embeds (P2) fit the same feature.
- **Fit:**
  - Server: a new `modules/unfurl/` behind `Host.unfurl`, which is in progress. It needs SSRF
    protection (block private IPs and check again after redirects), timeouts, size caps and a cache.
  - Web: `features/embed/` with an element plus `importData` at a priority above `text`, so a pasted
    URL becomes a card. Allow-listed providers (YouTube, Vimeo, design tools) render a sandboxed
    iframe behind a click-to-activate overlay.
  - PDF: `features/document/` renders pages in the browser with pdf.js, uploads them through
    `host.uploadImage`, and places them with `editor.findFreeSpot`. It's a new dependency, so say so.

**Batch 7: Collaboration loop (follows ROADMAP Phase 2)**
- **Items:** @mentions, notifications, private mode, invite people without an account (P0),
  anonymous visitors, password reset and verification, Google/Microsoft sign-in.
- **Fit:**
  - Mentions: the comment composer in `features/comments/` gets an autocomplete from
    `Host.listMembers()`. Store mentioned user ids on the message record (`CommentRecord` in
    shared). Delivery is a server module `notifications` that watches comment writes in
    `realtime`, or that the comments feature reaches through a new Host method. Email goes through
    the Phase 2 mail service.
  - Private mode can't just hide items in the browser, because every client receives the whole Yjs
    doc. Store private contributions per user on the server (a new module plus a WebSocket route)
    and move them into `elements` when the facilitator reveals them. The UI is
    `features/private-mode/`, owning a `privateMode` session collection like `voting` does.
  - Invites, visitors and auth are `app/` plus `modules/auth` and `modules/members` work, not features.

**Batch 8: Templates**
- **Items:** template breadth, save as template.
- **Fit:**
  - Breadth is content work: add catalog files under `features/templates/lib/catalog/` with the
    existing `kit`. Several agents can each take a category (research, UX, meetings, diagramming,
    education), using original layouts and copy only.
  - Save as template needs a server module `templates` (per-user templates now, per-workspace in
    Phase 3) and Host methods `listTemplates`/`saveTemplate`. The insert path reuses `copyContent`
    so tables keep their cells.

**Batch 9: History and safety nets (follows ROADMAP Phase 4 and Phase 1)**
- **Items:** version history, trash and restore.
- **Fit:**
  - Version history depends on Phase 1's append-only update log and snapshots in
    `modules/realtime`. The UI is an `app/` route or a `dialog` panel that renders a read-only engine
    replica of a snapshot, plus a restore command that writes a new update (never rewinding the log).
  - Trash is a soft delete in `modules/boards` plus a dashboard view.

Workspaces and projects (P1) are ROADMAP Phase 3. They're server and dashboard work, done after Batch 7.

## 16. Unrealistic for a free product, or needs third-party agreements

| Item | Why it's hard | Pragmatic alternative |
|---|---|---|
| Official integrations with Jira, Asana, Azure DevOps, Slack, Teams, Zoom | Marketplace listings, partner reviews and OAuth app approval with each vendor, plus upkeep as their APIs change | Public REST API, webhooks and generic embeds; documented recipes for no-code automation tools; let the community build the connectors |
| In-board app SDK and app marketplace | A security review process and sandboxing for third-party code on everyone's boards | Start with API, webhooks and an MCP server; maybe a sandboxed iframe app model later |
| Built-in audio/video calls | TURN/SFU servers cost money per minute at scale | "Start a call" links to Jitsi, Meet or Teams; optionally a self-hosted Jitsi when the operator provides one |
| AI features at Miro's level | Model inference costs money per request; a free tier is open to abuse | Bring your own API key per workspace, or an operator-configured endpoint, including self-hosted open models. AI stays off unless configured. Strict rate limits |
| Cloud provider icon sets (AWS, Azure, GCP) | Each provider has its own usage terms for its icons; we can't redistribute them as Freero assets without checking those terms | Generic, original infrastructure icons plus custom SVG shape packs that users upload themselves |
| Data residency in several regions | One deployment per region, plus routing and operations staff | Freero is open and Docker-based: organisations that need a region self-host there. The hosted service states its single region |
| Customer-managed keys, DLP scanning, eDiscovery and legal hold | Need KMS integrations, content scanning pipelines and legal processes | Encryption at rest through the storage provider, audit log and data export (Phase 4); self-hosting for regulated organisations |
| SOC 2 / ISO 27001 / HIPAA certification | Expensive yearly audits by outside firms | Publish the security architecture, a responsible disclosure policy and the audit log; self-hosting as the compliance path |
| Native mobile and desktop apps | Separate codebases, store fees and reviews | A PWA plus touch-optimised web chrome |
| Importing Miro's own board files | The backup format is proprietary; use of Miro's API is under Miro's terms | Import from open formats (CSV, SVG, draw.io XML, VSDX). A Miro import through the user's own API token can come later, after checking the terms |
| Community template marketplace and moderation | Moderation work and legal exposure for user uploads | Shared team templates first (Phase 3); public gallery only with abuse reporting in place |
