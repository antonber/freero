# Miro ↔ Freero feature parity

What Miro offers, described in our own words, and where Freero stands on each item. Use it to plan the
"parity" work next to the enterprise phases in [ROADMAP.md](../ROADMAP.md). Open gaps are tracked as
Linear issues (team KAI, project "Freero · Miro parity" unless a roadmap project fits better); the
issue id is in the status note.

- **Miro sources:** public product and feature pages, the public pricing page, Miro's monthly "what's
  new" posts (Jan–May 2026) and public changelog (through June 2026), Miro developer-platform pages,
  Miro help-center and community pages, and third-party reviews. Nothing behind a login was used.
  Miro's paid add-ons and plan gates are mentioned only where they help explain an item.
- **Freero status:** taken from the code on `main` on 2026-10-28 (feature folders and manifests,
  element model in `packages/shared`, engine commands, server modules and routes), not from the README
  alone. Teams & workspaces (KAI-37, KAI-38, KAI-39, KAI-41, KAI-42) is in review on a branch: those
  rows are marked *in review* and still count as Missing until they merge.

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
| Snap to grid | Moves and resizes land on grid steps; the grid size is adjustable | Have (also creation tools, ghosts and arrow nudges) | — | P1 | — |
| Alignment guides | Edges and centres snap to nearby items while dragging, with visible guides | Have | — | P0 | — |
| Equal-spacing hints | Shows and snaps to equal gaps between neighbours while dragging | Have (`engine/geometry/snap.ts`) | — | P2 | — |
| Arrow-key nudge | Moves the selection a little with the arrow keys | Have | — | P1 | — |
| Link to an item | Copies a URL that opens the board zoomed to one item or frame | Have | — | P1 | — |
| Board outline | A list of frames for jumping around big boards | Have (Frames panel; Layers panel groups every item by frame) | — | P1 | — |
| Shortcut reference | A cheat sheet of keyboard shortcuts inside the app | Have (searchable sheet generated from live bindings, incl. element keys) | — | P1 | — |
| Large-board performance | Stays smooth with thousands of items | Have (viewport culling; level of detail from quantized zoom) | — | P0 | — |
| Accessibility on the board | Move through board items with the keyboard, have a screen reader describe them, high-contrast option | Partial: chrome has labels, images have alt text, and the Layers panel is a keyboard-navigable item list; board items can't take focus, nothing is announced, no forced-colours or reduced-motion handling (KAI-108) | L | P2 | parity |
| Interface languages | The UI in several languages | Missing (KAI-144) | M | P3 | parity |

## 2. Board content

### 2a. Core items

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Sticky notes | Coloured notes whose text shrinks to fit; fast keyboard chaining | Have (12 colours, add-next-to and Tab chaining, auto-fit) | — | P0 | — |
| Paste a list as stickies | Pasting multi-line text makes one sticky per line | Have (sticky `importData`) | — | P1 | — |
| Sticky author label | Optionally shows who wrote each sticky | Missing (KAI-112) | S | P2 | parity |
| Capture paper stickies | Photograph physical notes (or send tablet handwriting) and turn them into digital stickies | Missing | L | P3 | parity |
| Basic shapes | Rectangles, ellipses, polygons, arrows, callouts with fill, border and text | Have | — | P0 | — |
| Change shape type | Swap an existing shape for another kind and keep its text and style | Have | — | P1 | — |
| Text boxes | Free text with font, size, colour, highlight, lists, links, bold/italic/underline/strike | Have | — | P0 | — |
| Connectors | Straight, elbow or curved lines that stay attached to items, with arrowheads, styles and a label | Have | — | P0 | — |
| Quick connect | Drag from a handle on an item to draw a line or create a linked item | Have | — | P1 | — |
| Richer connector labels | Several labels on one line, placed anywhere along it | Have (`labels[]` with a position each; double-click the line to add one) | — | P2 | — |
| Attach anywhere on the outline | Connector ends fix to any point of a shape's edge, not only side midpoints | Partial: anchors are auto/top/right/bottom/left (*in review*: an end dropped near an outline holds that spot as a fraction of the box, projected onto curves and slanted sides; KAI-113) | S | P2 | parity |
| Pen and highlighter | Freehand pressure-sensitive ink and a translucent marker | Have | — | P0 | — |
| Eraser | Rubs out ink | Have (cuts through strokes, or deletes whole strokes) | — | P2 | — |
| Smart drawing | Turns rough hand-drawn shapes into clean shapes | Missing (KAI-114) | M | P2 | parity |
| Images | Upload, paste, drag and drop, or paste an image link | Have (PNG/JPG/GIF/WebP/SVG) | — | P0 | — |
| Image crop | Trim an image on the board without editing the file | Have | — | P1 | — |
| Image alt text | A description of the image for accessibility | Have | — | P2 | — |
| Emoji and stickers | Place emoji and decorative stamps on the board | Have | — | P1 | — |
| Custom sticker sets | Save your own images as a reusable sticker palette | Missing | M | P3 | parity |
| Frames | Titled areas that hold items, with size presets and fit-to-content | Have (plus grid layouts) | — | P0 | — |
| Hide frame contents | Keep a frame's contents hidden from others until the facilitator reveals them | Have (server keeps contents from viewers and commenters) | — | P2 | — |
| Task cards | Cards with title, description, assignee, due date, status and tags | Have | — | P1 | — |
| Kanban widget | Columns that hold cards; moving a card to another column changes its status | Have (columns with status, WIP limits) | — | P1 | — |
| Tags | Named, coloured labels on items, for filtering and grouping | Have (stickies and cards) | — | P2 | — |
| Mind maps | A central topic with automatically laid out branches; add, collapse and tidy | Have | — | P1 | — |
| Mind map keyboard navigation | Arrow keys move between nodes | Have (arrows, Alt+arrows reorder, Space collapses) | — | P2 | — |
| Outline to mind map | Paste an indented outline to build a map, and the reverse | Have: paste a 2+ level outline (or Insert from text), "Copy as outline" back (KAI-115) | S | P2 | parity |
| Item links | Any item can open a URL or jump to another item or frame when clicked | Have | — | P1 | — |

### 2b. Diagramming and shape libraries

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Flowchart set | The full set of standard flowchart symbols | Have (manual input, delay, off-page reference, merge, display, junctions and more) | — | P1 | — |
| Shape library browser | A searchable panel of shape sets that you enable per board | Have | — | P1 | — |
| Icon library | Search a large icon set and place icons as items | Have (recolourable vector icons stored in the item) | — | P1 | — |
| UML shapes | Class, sequence, use-case, activity and state symbols | Partial: class, actor, use case, package, note, component, node, state (*in review*: Sequence set — lifeline, activation, combined fragment — and call / async / reply line presets; hollow triangle and diamond ends for generalisation, composition, aggregation; KAI-116) | S | P2 | parity |
| BPMN shapes | Events, tasks, gateways, pools and lanes for business processes | Partial: tasks, subprocess, start/intermediate/end events, four gateways, data object and store (*in review*: message, timer and error events, message-flow and data-association presets, pools and lanes; KAI-116, KAI-117) | S | P2 | parity |
| ERD shapes | Entity tables and crow's-foot line ends for data models | Missing (*in review*: ERD set with an entity table shape, crow's-foot ends — exactly one, zero or one, many, one or many, zero or many — and one-to-many / one-to-one / many-to-many presets; KAI-116) | M | P2 | parity |
| Cloud architecture icons | Provider icon sets for AWS, Azure, Google Cloud and Kubernetes | Partial: an original generic network set (server, firewall, router, switch, devices, users); provider sets need their owners' terms (see §16; KAI-121) | M | P2 | parity |
| Engineering shape packs | Symbol sets for electrical circuits and process (P&ID) diagrams | Missing (custom packs are the route; KAI-121) | M | P3 | parity |
| Wireframe kit | Device frames and UI controls for low-fidelity mockups | Have: shape library "Wireframe" set (4 devices, 17 controls) + icon library, Tablet frame preset (KAI-120) | L | P2 | parity |
| Interactive prototypes | Clickable screens linked into a flow you can play, increasingly generated by AI | Missing (item links give simple click-through between frames) | XL | P3 | parity |
| Custom shape packs | Upload your own SVG shapes as a reusable library | Missing (KAI-121) | M | P3 | parity |
| Diagrams as code | Build editable diagrams from Mermaid or PlantUML text | Have for Mermaid flowchart / sequence / mind map: paste or Insert from text, edit the source to re-lay out (KAI-119); no PlantUML, class, ER or state diagrams | M | P2 | parity |
| Swimlanes and containers | Row and column lanes that hold and move diagram items | Missing (*in review*: swimlane pools with row or column lanes and phases; lanes grow to fit, resize by their edge, reorder and carry their items; KAI-117) | M | P2 | parity |
| Auto-layout and org charts | Arrange a connected diagram or hierarchy automatically | Have: Auto-layout ▸ top-down / left to right / tree / org chart; org charts from "Name, Title, Manager" rows (KAI-118) | L | P2 | parity |
| Obstacle-avoiding routing | Elbow connectors route around other items | Partial: elbow routing doesn't avoid other items (*in review*: elbows without a user bend detour around items in the way, deterministic A* over the nearest 40 items; KAI-113) | M | P2 | parity |
| Diagram layers | Named layers inside a diagram that you can show or hide | Missing | L | P3 | parity |

### 2c. Structured content

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Tables | A grid of editable cells on the board; add or remove rows and columns | Have (rich-text cells stored one per key, header row, fills, spreadsheet paste, CSV export) | — | P1 | — |
| Data tables | Typed columns (status, person, date), several views (table, kanban, timeline, tree), rows linked to board items | Missing (KAI-123) | XL | P2 | parity |
| Timeline / Gantt | Bars on a date axis with lanes, for roadmaps and plans | Missing (KAI-122) | L | P2 | parity |
| Docs | Long-form rich documents (headings, lists, tables) that live on the board, with Markdown import and export | Missing (KAI-124) | L | P2 | parity |
| Code blocks | Monospaced code with syntax highlighting | Missing (text has a mono font only; KAI-125) | S | P2 | parity |
| Charts | Bar, line or pie charts from entered data | Missing | M | P3 | parity |
| Slides | A deck view built from board content, with slide layouts | Partial: frames act as slides in presentation mode and PDF export; no deck editor or layouts (KAI-126) | L | P2 | parity |

### 2d. Media, files and embeds

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Link previews | A pasted URL becomes a card with title, description and image | Have (server `unfurl` module with SSRF guards) | — | P1 | — |
| PDF on the board | Upload a PDF and page through it or place its pages on the board | Have | — | P1 | — |
| Video embeds | Play YouTube or Vimeo videos inside an item | Have (YouTube, Vimeo and Loom, click to play) | — | P2 | — |
| Generic embeds | Live iframes of other web tools (design files, docs, spreadsheets) | Missing (other links stay preview cards; KAI-127) | M | P2 | parity |
| Video and audio upload | Upload a media file and play it on the board | Missing (uploads accept images and PDF only; KAI-128) | M | P2 | parity |
| File attachments | Any file as a downloadable card | Missing (KAI-128) | S | P2 | parity |
| Office documents | Preview Word, PowerPoint or Excel files on the board | Missing | L | P3 | parity |

## 3. Editing productivity

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Selection | Click, Shift-click and marquee selection, select all | Have (plus select similar by type, colour or tag) | — | P0 | — |
| Move, resize, rotate | Transform handles, keeping aspect ratio where it applies | Have | — | P0 | — |
| Undo and redo | Per-user history that never undoes other people's changes | Have | — | P0 | — |
| Copy, paste, duplicate | Including between boards and tabs | Have | — | P0 | — |
| Paste and drop from outside | Text, images and image links from the clipboard or drag and drop | Have | — | P0 | — |
| Group | Select and move several items as one | Have | — | P1 | — |
| Lock items | Pin items so they can't be moved or edited by accident | Have | — | P1 | — |
| Stacking order | Bring to front, send to back | Partial: front and back, and drag to restack in the Layers panel; no one step forward or back (*in review*: Bring forward / Send backward, KAI-110) | S | P2 | parity |
| Align | Line up the selection's left, centre, right, top, middle or bottom edges | Have | — | P1 | — |
| Distribute | Space the selection evenly across or down | Have | — | P1 | — |
| Tidy into a grid | Arrange a messy pile of items into a neat grid | Have (plus cluster stickies by colour or tag) | — | P2 | — |
| Find on board | Search all text on the board and step through the matches | Have (items, frame titles, connector labels, table cells, comments) | — | P1 | — |
| Find and replace | Replace text across the board | Have | — | P2 | — |
| Layers / object list | A panel listing items in stacking order to select, hide or lock them | Have | — | P2 | — |
| Copy style | Copy one item's formatting onto others | Have (format painter) | — | P2 | — |
| Edit mixed selections | Change colour or text size across a selection of different item types | Partial: format controls appear only when every selected item has the same type (*in review*: shared fill, line, font, size, text colour and alignment for mixed selections, KAI-111) | M | P2 | parity |
| Selection filter | Narrow a selection to one item type (e.g. only stickies) | Partial: "select similar" selects every item of a type on the board, but can't narrow the current selection (*in review*: "Select only ▸ <type> (count)", KAI-110) | S | P2 | parity |
| Exact size and position | Type width, height, position and rotation for the selection | Missing (*in review*: "Size and position" in the format toolbar, KAI-110) | S | P2 | parity |
| Command palette | Search for any action by name and run it from the keyboard | Missing (the shortcut sheet lists actions but can't run them; *in review*: Mod+/ palette, KAI-109) | S | P2 | parity |
| Version history | Browse, preview and restore earlier states of the board; name versions | Have | — | P1 | — |
| Activity feed | Who changed what on the board, and when | Missing (KAI-44) | M | P2 | 3 |

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
| Hide cursors | Turn other people's cursors off to reduce noise | Missing (KAI-129) | S | P2 | parity |
| Comments | Threads on the board or on an item; replies, reactions, resolve, unread, filters | Have (authorship enforced by the server) | — | P0 | — |
| @mentions | Tag people in comments to pull them in | Have (member picker; inviting by address from the picker) | — | P1 | — |
| Notifications | In-app and email alerts for mentions, replies and invites | Have (inbox, live bell, email digests, one-click unsubscribe) | — | P1 | — |
| Assignment notifications | Tell people when work is assigned to them or is about to be due | Missing (KAI-135) | S | P2 | parity |
| Private mode | Participants add content that others can't see until it's revealed | Have (server-side private layers; whole board or one frame) | — | P1 | — |
| Attention management | The facilitator keeps everyone in their view and stops people wandering off | Partial: follow and bring-everyone exist; there's no enforced follow or locked view (KAI-129) | M | P2 | parity |
| Async video walkthroughs | Record a narrated tour of the board (camera plus pointer) for others to watch later | Missing (KAI-133) | L | P2 | parity |
| Audio and video calls | Talk and see each other inside the board | Missing (KAI-134 proposes a per-board call link instead; see §16) | M | P2 | parity |

## 5. Facilitation and presentation

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Shared timer | One countdown everyone sees, with presets and a sound at zero | Have | — | P1 | — |
| Dot voting | Facilitator-run voting with per-person limits, chosen items, hidden results and a ranking | Have (hidden votes stay on the server until results are shown) | — | P1 | — |
| Estimation / planning poker | Everyone estimates stories privately, then the estimates are revealed together | Missing (KAI-131) | M | P2 | parity |
| Live polls, Q&A, word clouds | Audience activities (polls, word clouds, rankings, rating scales, Q&A) answered from the board or a phone, with results on the board | Missing (KAI-132) | L | P2 | parity |
| Presentation mode | Step through frames full screen without the editing chrome | Have | — | P1 | — |
| Audience follows presenter | Viewers' screens follow the presenter, with a banner showing who is presenting | Have | — | P1 | — |
| Laser pointer | A temporary pointer trail everyone sees while presenting | Missing (KAI-130) | S | P2 | parity |
| Presenter notes | Private notes for each slide or frame | Missing (KAI-130) | S | P3 | parity |
| Facilitator controls | Lock the board for non-facilitators, or restrict tools during a session | Missing (KAI-129) | M | P2 | parity |
| Timer music | Optional background music while the timer runs | Missing | S | P3 | parity |
| Icebreaker widgets | Dice, spinners and other playful session helpers | Missing | M | P3 | parity |

## 6. Templates

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Template picker | A searchable gallery that inserts an editable layout, also offered when you create a board | Have (grouped by category, ranked search) | — | P0 | — |
| Template breadth | A large library across agile, strategy, research, UX, diagramming, education and meetings | Partial: 41 original templates in 10 categories; several categories have only 2–3 (KAI-100) | M | P1 | parity |
| Save as template | Turn a board or selection into your own reusable template | Have | — | P1 | — |
| Team templates | Templates shared across a team or workspace | Missing (*in review* on the teams branch, KAI-42; follow-up KAI-96) | M | P2 | 3 |
| Community gallery | Publish templates publicly and browse other people's | Missing | L | P3 | parity |
| Guided board setups | Reusable board structures (several boards, docs and tools) with steps and instructions for a whole process | Missing | L | P3 | parity |

## 7. AI

Miro sells AI on credits per plan and spent most of 2026 on agent-style assistants and repeatable AI
workflows. For Freero, every row here needs a model provider that the operator or workspace configures
(KAI-101, see §16).

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Generate ideas | Make a set of stickies from a prompt | Done with a configured provider: previewed, inserted as one undo step (KAI-102, docs/ai.md) | M | P2 | parity |
| Cluster and sort | Group stickies by theme or sentiment | Done: selected notes move into named groups (KAI-102); non-AI clustering by colour or tag exists too | M | P2 | parity |
| Summarise | Turn a selection or a board into a written summary | Done: a written note beside the selection (KAI-102) | M | P2 | parity |
| Text to diagram | Make a flowchart, mind map or sequence diagram from a description | Done: via Mermaid / outline → layout, connectors attached (KAI-102) | M | P2 | parity |
| Image generation | Make an image from a prompt | Missing | M | P3 | parity |
| Board-aware assistant | A chat assistant that reads the board, answers questions about it and proposes edits | Missing (KAI-103) | L | P3 | parity |
| AI workflows | Reusable multi-step AI pipelines run on board content | Missing (KAI-103) | XL | P3 | parity |
| AI slides | Build a presentation from board content automatically | Missing (KAI-103) | L | P3 | parity |
| Natural-language search | Find content across all boards by describing it | Missing (plain content search first: KAI-141) | L | P3 | parity |
| Screenshot to prototype | Turn a UI screenshot into an editable mockup | Missing | XL | P3 | parity |
| AI admin controls | Turn AI on or off for the org, choose the model, use your own key | Done: operator provider (env) and per-workspace on/off, own provider and sealed key, who may use it, monthly budget, usage, audit (KAI-101) | M | P3 | parity |

## 8. Import, export and backup

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Image export | Board, selection or visible area as PNG or JPG, with a scale option | Have | — | P0 | — |
| Vector export | The same areas as SVG | Have | — | P2 | — |
| PDF export | Frames as pages of a PDF | Have | — | P1 | — |
| Copy as image | Put the selection on the clipboard as a picture | Have | — | P1 | — |
| CSV export | Text of stickies and cards as rows | Partial: tables export CSV; stickies and cards don't (KAI-136) | S | P2 | parity |
| CSV / spreadsheet import | Rows become stickies or cards | Partial: spreadsheet paste fills tables, multi-line text becomes stickies; no rows-to-cards import (KAI-136) | S | P2 | parity |
| Board backup and restore | Download a full-fidelity board file and restore it later or elsewhere | Missing (operators can back up the whole database; KAI-137) | M | P2 | 4 |
| Diagram import | Bring in Visio, draw.io or Lucid diagrams as editable shapes | Missing (draw.io first: KAI-138) | L | P3 | parity |
| Import from other whiteboards | Bring boards over from Miro, Mural, Excalidraw and similar tools | Missing (KAI-138) | L | P2 | parity |
| Print | Print the board or its frames | Partial: through PDF export only | S | P3 | parity |

## 9. Integrations, developer platform and embeds

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Public REST API | Read and write boards, items and members from code | Have (`/api/v1`, docs/api/; KAI-104) | L | P2 | parity |
| Webhooks | Push board and item events to other systems | Have (workspace endpoints from the admin console, event filters, HMAC-signed, retries and delivery log; KAI-105, docs/events.md) | — | P2 | parity |
| API tokens and OAuth apps | Credentials that let third-party apps act for a user | Have (tokens, OAuth 2.1 + PKCE, dynamic registration; KAI-104) | M | P2 | parity |
| Embed a live board | Put a viewable or editable board in other sites (iframe, oEmbed) | Missing (KAI-106) | M | P2 | parity |
| In-board app SDK | Third-party apps that run on the canvas and add items or panels | Missing (API and webhooks first, see §16) | XL | P3 | parity |
| App marketplace | Browse and install third-party apps | Missing (see §16) | XL | P3 | parity |
| MCP server | Let AI coding and agent tools read and write boards | Missing (KAI-107) | M | P3 | parity |
| Chat integrations | Board notifications and link previews in Slack or Teams | Partial: channel posts through webhooks in Slack / Teams format (KAI-105); no link previews inside Slack or Teams | M | P3 | parity |
| Work-tracker sync | Two-way sync between cards or table rows and Jira, Asana, Azure DevOps, monday.com or Trello items | Missing (see §16) | XL | P3 | parity |
| Cloud file pickers | Insert files from Google Drive, OneDrive or Dropbox | Missing | M | P3 | parity |
| Meeting-app integrations | Open a board inside Zoom, Teams or Meet calls | Missing | L | P3 | parity |

## 10. Apps and platforms

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Desktop browsers | Full editing in current Chrome, Edge, Firefox and Safari | Have | — | P0 | — |
| Tablet and stylus | Touch-friendly editing with pen input | Partial: pinch and touch are handled and the pen is pressure-aware; no tablet layout, long-press menu or palm rejection (KAI-139) | M | P2 | parity |
| Phone web | Usable view-and-comment experience on a small screen | Partial: one responsive breakpoint for the chrome; the board UI isn't designed for phones (KAI-139) | M | P2 | parity |
| Installable app (PWA) | Install from the browser with an icon, a window and file handling | Missing (KAI-140) | S | P2 | parity |
| Native mobile apps | iOS and Android apps | Missing | XL | P3 | parity |
| Native desktop apps | Windows and macOS apps | Missing | M | P3 | parity |
| Offline work | Edit without a connection and sync later | Partial: Yjs merges edits made during short disconnects; nothing survives a reload while offline (the `/board/local` sandbox is dev-only) | L | P3 | parity |

## 11. Accounts, teams, sharing

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Email sign-up and login | Create an account with email and password | Have | — | P0 | — |
| Profile | Name and cursor colour; avatar picture | Have (photo upload) | — | P2 | — |
| Password reset and email verification | Recover access; prove you own the address | Have | — | P1 | — |
| Google / Microsoft sign-in | Sign in with an existing work account | Have (OIDC) | — | P1 | — |
| Two-factor auth | One-time codes plus recovery codes | Have (TOTP; security notices by email) | — | P2 | — |
| Sessions and devices | See and revoke signed-in devices | Have (with approximate location) | — | P2 | — |
| Account deletion | Delete your account and its data yourself | Have (grace period, then purge) | — | P2 | — |
| Board dashboard | Grid or list of boards, search, sort, owner filter, stars, recent, shared with me, thumbnails | Have | — | P0 | — |
| Search inside boards | Find the boards whose content mentions something, from the dashboard | Have ("Inside boards": titles, items, frames, tables, tags, comments, opening the item; also the API and MCP; KAI-141, KAI-151) | — | P2 | parity |
| Board lifecycle | Create (blank or from a template), rename, duplicate, delete, leave | Have | — | P0 | — |
| Trash and restore | Recover deleted boards for a while | Have | — | P1 | — |
| Board roles | Owner, editor, commenter and viewer per board | Have | — | P0 | — |
| Invite existing users | Add people by email with a role | Have | — | P0 | — |
| Invite people without an account | Email invite → sign up → land on the board | Have | — | P0 | — |
| Share by link | Anyone with the link gets a chosen role | Have (signed-in users only) | — | P0 | — |
| Anonymous visitors | Open a shared link without an account, with a guest name | Missing (every board route needs a session; KAI-43) | M | P1 | 3 |
| Request access | Ask the owner for access from a locked board | Missing (KAI-40) | S | P2 | 3 |
| Transfer ownership | Hand a board to someone else | Missing (*in review*, KAI-41) | S | P2 | 3 |
| Link password or expiry | Protect public links | Missing (KAI-145) | S | P3 | parity |
| Workspaces and teams | Shared spaces with members and team-wide boards | Missing (*in review*, KAI-37) | L | P1 | 3 |
| Projects / folders | Group boards inside a workspace | Missing (*in review*, KAI-39) | M | P1 | 3 |
| Team roles | Workspace owner, admin, member and guest | Missing (*in review*, KAI-38) | M | P2 | 3 |
| Sharing policies | Rules for who may share, export or invite guests | Missing (*in review*, KAI-42) | M | P2 | 3 |
| User groups | Named groups of people to share boards with | Missing (with SCIM groups, KAI-46) | M | P3 | 4 |

## 12. Admin, security and compliance

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Transport and app hardening | TLS, security headers, rate limits, upload quotas | Have (CSP and HSTS, per-route rate limits, upload and board quotas, TLS through the Caddy deploy config) | — | P1 | — |
| Backups and disaster recovery | Operator backups and restores of the database and files | Have (`scripts/backup.sh`, restore runbook in `docs/operations.md`, bucket versioning for files) | — | P1 | — |
| Horizontal realtime scale | Many app instances share board updates | Have (Redis fan-out, append-only update log with snapshots) | — | P1 | — |
| Encryption at rest | Stored data encrypted | Partial: depends on the Postgres and S3 provider; sign-in secrets are sealed by the app (KAI-143) | S | P2 | 1 |
| SSO | SAML 2.0 / OIDC per workspace, verified domains, enforced SSO | Missing (KAI-45) | L | P2 | 4 |
| SCIM provisioning | Create and remove users automatically from the identity provider | Missing (KAI-46) | L | P3 | 4 |
| Admin console | Manage members, roles, security settings and usage | Have (*in review*, KAI-47: members with two-step status and deactivation, security and retention settings, sharing policies, usage, audit log) | L | P2 | 4 |
| Audit log | Record of security-relevant events, with export and SIEM streaming | Partial (*in review*, KAI-48: append-only, hash-chained per workspace, filters, CSV/JSON export, integrity check; no SIEM streaming yet) | L | P2 | 4 |
| Data export and erasure | Per-user and org export and deletion (GDPR) | Partial: self-service account deletion purges personal data; no personal data export, no org-level export or deletion (KAI-50) | M | P2 | 4 |
| Retention policies | Delete or archive content automatically after a set time | Partial (*in review*, KAI-51: per-workspace trash, version-history and audit-log retention; no content expiry) | M | P3 | 4 |
| Session policies | Idle timeouts and session length rules | Have (*in review*, KAI-51: per-workspace session lifetime and idle timeout, strictest wins across a person's teams) | S | P3 | 4 |
| Domain control | Claim a domain, capture accounts, block personal sign-ups | Missing (with verified domains, KAI-45) | M | P3 | 4 |
| Admin usage analytics | Activity and adoption reports | Missing (in the admin console, KAI-47) | M | P3 | 4 |
| eDiscovery and legal hold | Keep and export a person's board history for legal cases | Missing | L | P3 | parity |
| Data classification / DLP | Scan boards for personal or payment data and apply rules | Missing | XL | P3 | parity |
| Customer-managed keys | Encrypt an org's data with keys the org controls | Missing | XL | P3 | parity |
| Data residency | Choose the region where data is stored | Missing | XL | P3 | parity |
| Compliance certifications | Independent audits (SOC 2, ISO 27001) and the paperwork that goes with them | Missing | XL | P3 | parity |
| Abuse reporting and moderation | Report and take down harmful public boards | Missing (*in review*, KAI-142: reports, operator queue, link block / take-down / file removal / suspension, appeals) | M | P2 | 1 |

## 13. Plans and limits (context only, not counted)

| Topic | Miro (public pricing page and help center, 2026) | Freero |
|---|---|---|
| Free tier | 3 editable boards, low-resolution export, view-only visitors, a small AI trial, no private boards, timer/voting/private mode on paid plans only | Everything is free; no plan gates |
| Paid gates | Guests, SSO and data tables from the mid tier; SCIM, audit logs, domain control, extra residency regions, AI workflows and enterprise APIs at the top tier | None planned; limits are operator quotas |
| Paid add-ons | Data classification, key management, lifecycle management, eDiscovery, AI blocking, prototyping, live audience engagement | n/a |
| Usage limits | AI credits per member per month; MCP calls per day | Upload quota per user, request and WebSocket rate limits (see `docs/configuration.md`) |

---

## 14. Summary

Counts cover every capability row in §1–§12 (§13 isn't counted). Since 2026-10-27: 40 rows moved
to Have (32 from Missing, 8 from Partial), 7 moved from Missing to Partial, and 5 rows were added
from Miro's 2026 releases and feature pages (engineering shape packs, exact size and position,
command palette, assignment notifications, search inside boards).

**By status**

| Status | Count |
|---|---|
| Have | 97 |
| Partial | 20 |
| Missing | 93 |
| **Total** | **210** |

**By priority and status**

| Priority | Have | Partial | Missing | Total |
|---|---|---|---|---|
| P0 | 31 | 0 | 0 | 31 |
| P1 | 47 | 1 | 3 | 51 |
| P2 | 19 | 17 | 47 | 83 |
| P3 | 0 | 2 | 43 | 45 |

<!-- counts generated from the tables above; regenerate when rows change -->

**Takeaways**

- Every first-session (P0) expectation is met.
- Only four weekly-use (P1) gaps remain: workspaces and projects (in review), anonymous visitors on
  shared links (KAI-43), and template breadth (KAI-100).
- The P2 gaps cluster into six themes: diagramming depth (UML/BPMN/ERD, swimlanes, auto-layout,
  routing, Mermaid, wireframes), structured content (docs, timeline, data tables, slides, code),
  facilitation (facilitator controls, polls, estimation, laser, walkthroughs), the developer platform
  (API, webhooks, embeds), AI (bring-your-own model), and reach (accessibility, tablet and phone, PWA).
- Enterprise governance (SSO, admin console, audit log, GDPR export) is already tracked in the
  Enterprise project and follows the teams merge.

## 15. Recommended build order (web parity work)

The 2026-10-27 batches (arrange, find, shortcuts, item links, crop, kanban, shape and icon libraries,
tables, link previews, PDF, the collaboration loop, save as template, version history and trash) have
all shipped. The batches below cover what's left at P1 and P2, plus the P3 items worth doing because
they're cheap or strategic. Each follows the Dune layout: a new `apps/web/src/features/<name>/` folder
made with `npm run new:feature`, a server module per area, and engine changes only when a capability
cuts across types. Batches A–D are independent and can run in parallel; E and F follow the teams merge.

**Batch A: Editing polish (all S–M, engine and small features)**
- **Issues:** KAI-110 (step forward/back, select only a type, exact size and position), KAI-109
  (command palette), KAI-111 (edit mixed selections), KAI-115 (outline to mind map), KAI-112 (sticky
  author labels), KAI-136 (CSV for stickies and cards).
- **Fit:** stacking and the size/position popover are engine chrome next to `bringToFront`; the palette
  extends `features/shortcuts/` and runs `editor.runCommand`; mixed editing adds an optional
  `styleFields`/`applyStyle` pair to `ElementDefinition` so each feature stays the writer of its fields.

**Batch B: Diagramming depth**
- **Issues:** KAI-116 (UML sequence, BPMN events, ERD and crow's-foot caps), KAI-113 (outline
  anchors and obstacle-avoiding elbows), KAI-117 (swimlanes), KAI-118 (auto-layout and org charts),
  KAI-119 (Mermaid), KAI-120 (wireframe kit), KAI-114 (smart drawing); later KAI-121 (custom packs).
- **Fit:** new `ShapeKind`s and `CapStyle`s in shared, drawn in `features/shape` and
  `features/connector`; swimlanes are a container element like kanban; layout lives in
  `features/arrange`.

**Batch C: Facilitation**
- **Issues:** KAI-129 (facilitator controls, enforced follow, hide cursors), KAI-130 (laser and presenter
  notes), KAI-131 (planning poker), KAI-132 (polls, word clouds, rankings, Q&A), KAI-133 (async
  walkthroughs), KAI-134 (call link).
- **Fit:** session collections like `voting` and `privateMode`; anything that must stay secret uses the
  private layers and server reveal, and board locks are enforced in `modules/realtime`, not only in the
  UI.

**Batch D: Structured content and media**
- **Issues:** KAI-125 (code blocks), KAI-128 (video, audio and file uploads), KAI-127 (live embeds),
  KAI-124 (docs with Markdown), KAI-126 (slides), KAI-122 (timeline), KAI-123 (data tables).
- **Fit:** owned per-key collections (`docBlocks`, `timelineBars`, `dataRows`) so concurrent edits to
  different parts merge; media types and range requests in `modules/uploads`.

**Batch E: Reach and trust (after the teams merge)**
- **Issues:** KAI-142 (abuse reporting) before KAI-43 (anonymous visitors), then KAI-145 (link
  password and expiry), KAI-141 (search inside boards), KAI-140 (PWA), KAI-139 (tablet and phone),
  KAI-108 (accessibility), KAI-143 (encryption at rest), KAI-144 (interface languages).

**Batch F: Platform and AI**
- **Issues:** KAI-104 (REST API, tokens, OAuth) → KAI-105 (webhooks), KAI-106 (embeds), KAI-107
  (MCP server); KAI-101 (AI foundation) → KAI-102 (AI board actions) → KAI-103 (assistant);
  KAI-137 (board backup) and KAI-138 (import from draw.io and Excalidraw).
- **Fit:** new server modules (`api`, `webhooks`, `mcp`, `ai`) that reach board content only through
  `modules/realtime`'s exported functions, so private layers and hidden frames are respected everywhere.

Not filed, on purpose: P3 items that are costly and niche, or that §16 replaces with an alternative.
That covers timer music (needs licensed audio), icebreaker widgets, custom sticker sets, charts, office
document previews, diagram layers, interactive prototypes, image generation, screenshot to prototype,
capture of paper stickies, offline editing, native apps, in-board app SDK, app marketplace,
work-tracker sync, cloud file pickers, meeting-app integrations, community gallery, guided board
setups, eDiscovery, DLP, customer-managed keys, data residency and certifications. Revisit offline
editing after the PWA, and paper capture after the AI foundation.

## 16. Unrealistic for a free product, or needs third-party agreements

| Item | Why it's hard | Pragmatic alternative |
|---|---|---|
| Official integrations with Jira, Asana, Azure DevOps, Slack, Teams, Zoom | Marketplace listings, partner reviews and OAuth app approval with each vendor, plus upkeep as their APIs change | Public REST API, webhooks with Slack/Teams-ready payloads and generic embeds (KAI-104, KAI-105, KAI-106); documented recipes for no-code automation tools; let the community build the connectors |
| In-board app SDK and app marketplace | A security review process and sandboxing for third-party code on everyone's boards | Start with API, webhooks and an MCP server (KAI-107); maybe a sandboxed iframe app model later |
| Built-in audio/video calls | TURN/SFU servers cost money per minute at scale | A per-board call link to Jitsi or the team's meeting tool (KAI-134); optionally a self-hosted Jitsi when the operator provides one |
| AI features at Miro's level | Model inference costs money per request; a free tier is open to abuse | Bring your own API key per workspace, or an operator-configured endpoint, including self-hosted open models (KAI-101). AI stays off unless configured. Strict rate limits |
| Cloud provider icon sets (AWS, Azure, GCP) | Each provider has its own usage terms for its icons; we can't redistribute them as Freero assets without checking those terms | Generic, original infrastructure icons (shipped) plus custom SVG shape packs that users upload themselves (KAI-121) |
| Data residency in several regions | One deployment per region, plus routing and operations staff | Freero is open and Docker-based: organisations that need a region self-host there. The hosted service states its single region |
| Customer-managed keys, DLP scanning, eDiscovery and legal hold | Need KMS integrations, content scanning pipelines and legal processes | Encryption at rest through the storage provider (KAI-143), audit log and data export (Phase 4); self-hosting for regulated organisations |
| SOC 2 / ISO 27001 / HIPAA certification | Expensive yearly audits by outside firms | Publish the security architecture, a responsible disclosure policy and the audit log; self-hosting as the compliance path |
| Native mobile and desktop apps | Separate codebases, store fees and reviews | A PWA plus touch-optimised web chrome (KAI-140, KAI-139) |
| Importing Miro's own board files | The backup format is proprietary; use of Miro's API is under Miro's terms | Import from open formats (CSV, draw.io XML, Excalidraw JSON; KAI-136, KAI-138). A Miro import through the user's own API token can come later, after checking the terms |
| Community template marketplace and moderation | Moderation work and legal exposure for user uploads | Shared team templates first (Phase 3); public gallery only with abuse reporting in place (KAI-142) |
