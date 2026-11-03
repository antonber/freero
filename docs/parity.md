# Miro ↔ Freero feature parity

What Miro offers, described in our own words, and where Freero stands on each item. Use it to plan the
"parity" work next to the enterprise phases in [ROADMAP.md](../ROADMAP.md). Open gaps are tracked as
[GitHub Issues](https://github.com/antonber/freero/issues?q=is%3Aissue+label%3Aparity) labelled
`parity`; the issue number (#N) is in the status note, and `priority: high` marks the fifteen gaps
ranked first in the 2026-11-03 re-check. KAI ids name work already shipped and live in the read-only
Linear archive ([docs/linear-to-github.md](linear-to-github.md) maps the ones that moved).

- **Miro sources:** public product and feature pages, the public pricing page, Miro's monthly "what's
  new" posts and blog (through October 2026), the public developer changelog (through October 2026,
  including the removal of experimental webhooks on 2025-12-05), Miro developer-platform pages, Miro
  help-center and community pages, and third-party reviews. Nothing behind a login was used. In the
  2026-11-03 re-check help.miro.com refused direct fetches, so help-center details come from
  search-engine excerpts of the cited articles; treat exact Miro limits as likely, not certain.
  Miro's paid add-ons and plan gates are mentioned only where they help explain an item.
- **Freero status:** taken from the code on `main` (feature folders and manifests, element model in
  `packages/shared`, engine commands, server modules and routes), not from the README alone. First
  checked on 2026-10-28; re-checked against `main` at de4d77c on 2026-11-03, with kanban steps 1–3c
  (fields, views, linked views; [docs/design/kanban-fields-and-views.md](design/kanban-fields-and-views.md))
  live. An issue marked Done counts only for what the code on `main` actually does.

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
| Shortcuts familiar from Miro | Ctrl/Cmd+K for the command palette, Alt+1 / Alt+2 to fit, Ctrl/Cmd+0 for 100%, PgUp / PgDn for front and back | Partial: Freero uses Mod+/, Shift+1 / Shift+2 / Shift+0 and Mod+] / Mod+[; Mod+K makes an item link, and Alt+arrows walk items for keyboard users, so they stay (#100) | S | P1 | parity |
| Dark mode | Dark interface and canvas, chosen by the user or following the system | Partial: dark tokens and a dark canvas exist but only the live board in AI assistants turns them on; no toggle in the app (#101). Miro has no dark mode, so this is ahead once shipped | S | P1 | parity |
| Large-board performance | Stays smooth with thousands of items | Partial: viewport culling with quantized zoom; low detail when zoomed out only for cards, code and kanbans; the only benchmark is the 5,000-card kanban (`npm run bench:kanban`), no mixed-board figure (#130, #131) | M | P0 | parity |
| Accessibility on the board | Move through board items with the keyboard, have a screen reader describe them, high-contrast option | Have: Tab and Alt+arrows walk items in reading order, a live region describes the selection and collaborators' edits, "Board as list" reads the whole board as a tree, forced colours and reduced motion are handled (KAI-108, docs/accessibility.md); items aren't DOM focus targets for browse mode (#29); no WCAG 2.2 review or published conformance report, which procurement asks for (#141) | L | P2 | parity |
| Interface languages | The UI in several languages (Miro has eight) | Missing (#5; site hreflang #77) | L | P1 | parity |

## 2. Board content

### 2a. Core items

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Sticky notes | Coloured notes whose text shrinks to fit; fast keyboard chaining | Have (12 colours, add-next-to and Tab chaining, auto-fit) | — | P0 | — |
| Sticky shapes, sizes and dark colours | Square and rectangle stickies, size presets, dark and saturated papers | Partial: one 200 px square with free resize, 12 pastels plus white (#98) | S | P1 | parity |
| Sticky pad | Drop a stack of blank stickies that people peel from | Missing (#132) | S | P3 | parity |
| Paste a list as stickies | Pasting multi-line text makes one sticky per line | Have (sticky `importData`) | — | P1 | — |
| Sticky author label | Optionally shows who wrote each sticky | Have: a board setting editors toggle; current names, none while private mode runs (KAI-112) | S | P2 | parity |
| Capture paper stickies | Photograph physical notes (or send tablet handwriting) and turn them into digital stickies | Missing | L | P3 | parity |
| Basic shapes | Rectangles, ellipses, polygons, arrows, callouts with fill, border and text | Have | — | P0 | — |
| Change shape type | Swap an existing shape for another kind and keep its text and style | Have | — | P1 | — |
| Text boxes | Free text with font, size, colour, highlight, lists, links, bold/italic/underline/strike | Have | — | P0 | — |
| Font choice | Twenty-odd fonts, including faces for CJK and right-to-left scripts | Partial: four families (sans, serif, mono, hand) (#99) | S | P1 | parity |
| Connectors | Straight, elbow or curved lines that stay attached to items, with arrowheads, styles and a label | Have | — | P0 | — |
| Quick connect | Drag from a handle on an item to draw a line or create a linked item | Have | — | P1 | — |
| Richer connector labels | Several labels on one line, placed anywhere along it | Have (`labels[]` with a position each; double-click the line to add one) | — | P2 | — |
| Attach anywhere on the outline | Connector ends fix to any point of a shape's edge, not only side midpoints | Have: an end dropped near an outline holds that spot as a fraction of the box, projected onto curves and slanted sides (KAI-113) | S | P2 | parity |
| Pen and highlighter | Freehand pressure-sensitive ink and a translucent marker | Have | — | P0 | — |
| Eraser | Rubs out ink | Have (cuts through strokes, or deletes whole strokes) | — | P2 | — |
| Smart drawing | Turns rough hand-drawn shapes into clean shapes | Missing (#3) | M | P2 | parity |
| Lasso | Draw a freeform loop to select ink and items | Missing: rectangular marquee only (#111) | S | P2 | parity |
| Images | Upload, paste, drag and drop, or paste an image link | Have (PNG/JPG/GIF/WebP/SVG) | — | P0 | — |
| Image crop | Trim an image on the board without editing the file | Have | — | P1 | — |
| Image alt text | A description of the image for accessibility | Have | — | P2 | — |
| Emoji and stickers | Place emoji and decorative stamps on the board | Partial: the full emoji set and five stamps; no sticker packs (#138) or GIF search (#139) | M | P1 | parity |
| Custom sticker sets | Save your own images as a reusable sticker palette | Missing (#138) | M | P3 | parity |
| Frames | Titled areas that hold items, with size presets and fit-to-content | Have (plus grid layouts) | — | P0 | — |
| Hide frame contents | Keep a frame's contents hidden from others until the facilitator reveals them | Have (server keeps contents from viewers and commenters) | — | P2 | — |
| Task cards | Cards with title, description, assignee, due date, status and tags | Have | — | P1 | — |
| Flip cards | Two-sided cards for quizzes and reveals | Missing (#142) | S | P3 | parity |
| Kanban widget | Columns that hold cards; moving a card to another column changes its status | Have (columns with status, WIP limits) | — | P1 | — |
| Tags | Named, coloured labels on items, for filtering and grouping | Have (stickies and cards) | — | P2 | — |
| Mind maps | A central topic with automatically laid out branches; add, collapse and tidy | Have | — | P1 | — |
| Mind map keyboard navigation | Arrow keys move between nodes | Have (arrows, Alt+arrows reorder, Space collapses) | — | P2 | — |
| Mind map AI and layouts | Expand a node with AI ideas, grow the map downwards, turn stickies into a map | Partial: right, left or both directions; AI only as the general text-to-diagram action (#134) | M | P2 | parity |
| Outline to mind map | Paste an indented outline to build a map, and the reverse | Have: paste a 2+ level outline (or Insert from text), "Copy as outline" back (KAI-115) | S | P2 | parity |
| Item links | Any item can open a URL or jump to another item or frame when clicked | Have | — | P1 | — |

### 2b. Diagramming and shape libraries

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Flowchart set | The full set of standard flowchart symbols | Have (manual input, delay, off-page reference, merge, display, junctions and more) | — | P1 | — |
| Shape library browser | A searchable panel of shape sets that you enable per board | Have | — | P1 | — |
| Icon library | Search a large icon set and place icons as items | Have (recolourable vector icons stored in the item) | — | P1 | — |
| UML shapes | Class, sequence, use-case, activity and state symbols | Have: class, actor, use case, package, note, component, node, state, a Sequence set (lifeline, activation, combined fragment) with call / async / reply line presets, hollow triangle and diamond ends for generalisation, composition, aggregation (KAI-116) | S | P2 | parity |
| BPMN shapes | Events, tasks, gateways, pools and lanes for business processes | Have: tasks, subprocess, start/intermediate/end events incl. message, timer and error, four gateways, data object and store, message-flow and data-association presets, pools and lanes as swimlanes (KAI-116, KAI-117) | S | P2 | parity |
| ERD shapes | Entity tables and crow's-foot line ends for data models | Have: ERD set with an entity table shape, crow's-foot ends (exactly one, zero or one, many, one or many, zero or many) and one-to-many / one-to-one / many-to-many presets (KAI-116) | M | P2 | parity |
| Cloud architecture icons | Provider icon sets for AWS, Azure, Google Cloud and Kubernetes | Partial: an original generic network set (server, firewall, router, switch, devices, users); provider sets need their owners' terms (see §16; #4) | M | P2 | parity |
| Engineering shape packs | Symbol sets for electrical circuits and process (P&ID) diagrams; Miro added circuit, electrical, P&ID and about 600 general shapes between Nov 2025 and Apr 2026 | Missing (custom packs are the route; #4) | M | P3 | parity |
| Value-stream and data-flow sets | Symbols for value-stream mapping and data-flow diagrams | Missing (#133) | M | P3 | parity |
| Wireframe kit | Device frames and UI controls for low-fidelity mockups | Have: shape library "Wireframe" set (4 devices, 17 controls) + icon library, Tablet frame preset (KAI-120) | L | P2 | parity |
| Interactive prototypes | Clickable screens linked into a flow you can play, increasingly generated by AI | Missing (item links give simple click-through between frames) | XL | P3 | parity |
| Custom shape packs | Upload your own SVG shapes as a reusable library | Missing (#4) | M | P3 | parity |
| Diagrams as code | Build editable diagrams from Mermaid or PlantUML text | Have for Mermaid flowchart / sequence / mind map: paste or Insert from text, edit the source to re-lay out (KAI-119); no PlantUML, class, ER, state or gantt diagrams (#38) | M | P2 | parity |
| Swimlanes and containers | Row and column lanes that hold and move diagram items | Have: swimlane pools with row or column lanes and phases that hold and move their items (KAI-117) | M | P2 | parity |
| Auto-layout and org charts | Arrange a connected diagram or hierarchy automatically | Have: Auto-layout ▸ top-down / left to right / tree / org chart; org charts from "Name, Title, Manager" rows (KAI-118) | L | P2 | parity |
| Obstacle-avoiding routing | Elbow connectors route around other items | Have: elbows without a user bend detour around items in the way (KAI-113) | M | P2 | parity |
| Line jumps | A small hop where two connectors cross, on by default in Miro since 2023 | Missing (#115) | M | P2 | parity |
| Diagram container and focus mode | A diagram as one object that owns its shapes, keeps its layout live and opens in a focus mode; Miro's Diagrams format | Missing: shapes sit on the open canvas, auto-layout is one-shot, swimlanes are the only diagram container (#117) | L | P2 | parity |
| Diagram layers | Named layers inside a diagram that you can show or hide | Missing (#118, after the diagram container) | M | P2 | parity |

### 2c. Structured content

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Tables | A grid of editable cells on the board; add or remove rows and columns | Have (rich-text cells stored one per key, header row, fills, spreadsheet paste, CSV export) | — | P1 | — |
| Data tables | Typed columns (status, person, date), several views (table, kanban, timeline, tree), rows linked to board items | Partial: kanbans cover the card case: typed fields, Table, List, Calendar and Timeline tabs, and linked views placed anywhere on the board, all showing the same (also tracker-synced) cards ([kanban fields and views](design/kanban-fields-and-views.md)). The plain table has typed columns (text, number, date, select, person, checkbox) with sort, filter and a board view of its rows, but no timeline or tree view of them, and its rows aren't linked to board items or trackers (KAI-123, follow-ups #51) | L | P2 | parity |
| Timeline / Gantt | Bars on a date axis with lanes, for roadmaps and plans | Have: day/week/month/quarter axis, lanes, bars and milestones; dragging edits dates, cards join as bars, connectors are dependencies; tracker issues as a roadmap (KAI-122, KAI-160) | L | P2 | parity |
| Docs | Long-form rich documents (headings, lists, tables) that live on the board, with Markdown import and export | Have (KAI-124, KAI-162: a doc placed on the board shows live; Markdown in and out) | L | P2 | parity |
| Code blocks | Monospaced code with syntax highlighting | Have: syntax highlighting, line numbers, language picker, copy; pasted code fences become blocks (KAI-125) | S | P2 | parity |
| Charts | Bar, line or pie charts from entered data | Missing (#137) | M | P3 | parity |
| Slides | A deck view built from board content, with slide layouts | Have: a slide deck built from frames, with layouts, skip, duplicate and speaker notes; presentation mode and PDF export follow the deck (KAI-126; follow-ups #52); no single-slide focus editor (#135), PowerPoint import (#136) or AI decks (#1) | L | P2 | parity |

### 2d. Media, files and embeds

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Link previews | A pasted URL becomes a card with title, description and image | Have (server `unfurl` module with SSRF guards) | — | P1 | — |
| PDF on the board | Upload a PDF and page through it or place its pages on the board | Have | — | P1 | — |
| Video embeds | Play YouTube or Vimeo videos inside an item | Have (YouTube, Vimeo and Loom, click to play) | — | P2 | — |
| Generic embeds | Live iframes of other web tools (design files, docs, spreadsheets) | Have: live, sandboxed frames for Figma, Google Docs/Sheets/Slides/Forms, CodePen, CodeSandbox and operator-allowed origins, under a workspace policy; other links stay preview cards (KAI-127) | M | P2 | parity |
| Video and audio upload | Upload a media file and play it on the board | Have: video and audio play on the board, served with byte ranges so they seek (KAI-128) | M | P2 | parity |
| File attachments | Any file as a downloadable card | Have: any other file becomes a file card, downloaded only from its board (KAI-128) | S | P2 | parity |
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
| Protected lock | A second lock that only board owners can undo | Missing: one lock kind, which any editor can undo (#140) | S | P2 | parity |
| Stacking order | Bring to front, send to back | Have: front, back, one step forward or backward (Mod+Alt+↑/↓), and drag to restack in the Layers panel (KAI-110, KAI-175) | S | P2 | parity |
| Align | Line up the selection's left, centre, right, top, middle or bottom edges | Have | — | P1 | — |
| Distribute | Space the selection evenly across or down | Have | — | P1 | — |
| Tidy into a grid | Arrange a messy pile of items into a neat grid | Have (plus cluster stickies by colour or tag) | — | P2 | — |
| Find on board | Search all text on the board and step through the matches | Have (items, frame titles, connector labels, table cells, comments) | — | P1 | — |
| Find and replace | Replace text across the board | Have | — | P2 | — |
| Layers / object list | A panel listing items in stacking order to select, hide or lock them | Have | — | P2 | — |
| Copy style | Copy one item's formatting onto others | Have (format painter) | — | P2 | — |
| Edit mixed selections | Change colour or text size across a selection of different item types | Have: shared fill, line, font, size, text colour and alignment for mixed selections (KAI-111) | M | P2 | parity |
| Selection filter | Narrow a selection to one item type (e.g. only stickies) | Have: "Select only ▸ <type> (count)" narrows the current selection; "select similar" still selects every item of a type (KAI-110) | S | P2 | parity |
| Exact size and position | Type width, height, position and rotation for the selection | Have: "Size and position" in the format toolbar (KAI-110) | S | P2 | parity |
| Command palette | Search for any action by name and run it from the keyboard | Have: Mod+/ palette runs every action and says why one is unavailable (KAI-109) | S | P2 | parity |
| Version history | Browse, preview and restore earlier states of the board; name versions | Have | — | P1 | — |
| Activity feed | Who changed what on the board, and when | Partial: a board activity panel and workspace recent activity, API and agent writes included (KAI-44, KAI-207); entries keep no element ids, so they can't take you to what changed (#125); no "since your last visit" view (#103) | S | P2 | 3 |

## 4. Collaboration

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Real-time co-editing | Everyone's changes appear live and merge without conflicts | Have (Yjs) | — | P0 | — |
| Live cursors | Named, coloured cursors for each collaborator | Have | — | P0 | — |
| Remote selections | See what others have selected and who is typing | Have | — | P1 | — |
| Presence list | An avatar stack of who is on the board | Have | — | P0 | — |
| Follow someone | Your view tracks a collaborator's view | Have | — | P1 | — |
| Bring everyone to me | Move all participants' views to yours | Have | — | P1 | — |
| Live reactions | Emoji bursts on everyone's screen | Partial: six fixed emoji, no picker and no count for the presenter (#144) | S | P2 | parity |
| Hide cursors | Turn other people's cursors off to reduce noise | Have: for yourself, or the facilitator hides them for everyone (KAI-129) | S | P2 | parity |
| Comments | Threads on the board or on an item; replies, reactions, resolve, unread, filters | Have (authorship enforced by the server) | — | P0 | — |
| Comment filters and anchors | Filter threads by mentions of me, unread or author; pin a thread to an area; attach files | Partial: open, resolved and mine filters; threads anchor to a point or one item; no attachments (#143) | S | P2 | parity |
| @mentions | Tag people in comments to pull them in | Have (member picker; inviting by address from the picker) | — | P1 | — |
| Notifications | In-app and email alerts for mentions, replies and invites, also in Slack or Teams | Partial: inbox, live bell, email digests, one-click unsubscribe; no personal Slack (#105) or Teams (#113) messages, no board-change digest (#104), and due reminders count UTC days (#106) | M | P1 | parity |
| Recent changes since your last visit | Coming back to a board, see and highlight what others changed while you were away | Missing (#103) | M | P1 | parity |
| Board-change digest | An email summary of changes on boards you own or follow | Missing (#104; builds on #46) | M | P2 | parity |
| Assignment notifications | Tell people when work is assigned to them or is about to be due | Have: card assigned and due-date notifications, a reminder the day before, also in email digests (KAI-135) | S | P2 | parity |
| Private mode | Participants add content that others can't see until it's revealed | Have (server-side private layers; whole board or one frame) | — | P1 | — |
| Attention management | The facilitator keeps everyone in their view and stops people wandering off | Have: the facilitator leads everyone's view with a locked follow (KAI-129) | M | P2 | parity |
| Async video walkthroughs | Record a narrated tour of the board (camera plus pointer) for others to watch later, with a summary, chapters and reactions | Partial: voice and optional camera over the live board with the narrator's view and pointer, comments at moments, captions typed or by the board's AI (KAI-133); decision snapshots freeze a board or frame (KAI-161). Against Miro's Talktrack: no AI summary, chapters or timeline reactions (#127), no tab capture (#69), no multi-person recording (#128) | M | P2 | parity |
| Audio and video calls | Talk and see each other inside the board | Partial: a per-board call link (the team's meeting URL or a Jitsi room) with "Join call" and who is in it; no built-in audio or video, by design (KAI-134; see §16); an optional embed of an operator's own Jitsi or LiveKit server is #149 | M | P2 | parity |

## 5. Facilitation and presentation

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Shared timer | One countdown everyone sees, with presets and a sound at zero | Have | — | P1 | — |
| Dot voting | Facilitator-run voting with per-person limits, chosen items, hidden results and a ranking; anonymous by default in Miro | Partial: hidden votes stay on the server until results are shown, but commenters and link guests can't vote (#96); each ballot carries the voter's name in the shared doc, so who voted for what is readable after the reveal; at most 20 votes per person, no per-item cap, timer or past results (#102) | M | P1 | parity |
| Estimation / planning poker | Everyone estimates stories privately, then the estimates are revealed together | Have: planning poker with sealed picks, estimates saved on cards (KAI-131); commenters and link guests can't estimate (#96); estimates on stickies and tracker write-back are #25 | M | P2 | parity |
| Live polls, Q&A, word clouds | Audience activities (polls, word clouds, rankings, rating scales, Q&A) answered from the board or a phone, with results on the board | Have: polls, word clouds, rankings, rating scales and Q&A; answers stay on the server, sealed until revealed, guests and phones answer through a link (KAI-132) | L | P2 | parity |
| Join by QR code | Participants scan a code on the shared screen to answer from a phone | Missing: the answer link exists, but no QR code is drawn (#40) | S | P2 | parity |
| Quiz and 2×2 activities | A quiz with right answers and a leaderboard; a 2×2 matrix that everyone places items on | Missing (#147) | M | P3 | parity |
| AI report from activity results | Turn a finished poll or Q&A into a short report with next steps | Missing (#148) | S | P3 | parity |
| Presentation mode | Step through frames full screen without the editing chrome | Have | — | P1 | — |
| Presenter handoff | Pass the presenter role to someone else mid-presentation; notes in a separate window | Missing (#146) | S | P2 | parity |
| Audience follows presenter | Viewers' screens follow the presenter, with a banner showing who is presenting | Have | — | P1 | — |
| Laser pointer | A temporary pointer trail everyone sees while presenting | Have (KAI-130) | S | P2 | parity |
| Presenter notes | Private notes for each slide or frame | Have (KAI-130) | S | P3 | parity |
| Facilitator controls | Lock the board for non-facilitators, or restrict tools during a session | Have: facilitator bar to lock the board and limit tools, enforced by the server (KAI-129) | M | P2 | parity |
| Timer music | Optional background music while the timer runs | Missing (#145; needs licensed audio) | S | P3 | parity |
| Icebreaker widgets | Dice, spinners and other playful session helpers | Missing (#150) | M | P3 | parity |

## 6. Templates

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Template picker | A searchable gallery that inserts an editable layout, also offered when you create a board | Have (grouped by category, ranked search) | — | P0 | — |
| Template breadth | A large library across agile, strategy, research, UX, diagramming, education and meetings | Have: 584 original templates in 18 categories (KAI-100, the third batch in b6eaac2); new ones are data (specs rendered by 13 layout archetypes), so the catalog grows without new code | M | P1 | parity |
| Save as template | Turn a board or selection into your own reusable template | Have | — | P1 | — |
| Team templates | Templates shared across a team or workspace | Have: shared with the workspace, showing who shared them; workspace admins can unshare (KAI-42, KAI-96); no company-wide sets or publishing permission (#155) | M | P2 | 3 |
| Community gallery | Publish templates publicly and browse other people's | Missing (#162) | L | P3 | parity |
| Guided board setups | Reusable board structures (several boards, docs and tools) with steps and instructions for a whole process | Missing (#161) | L | P3 | parity |

## 7. AI

Miro sells AI on credits per plan and spent most of 2026 on agent-style assistants and repeatable AI
workflows. For Freero, every row here needs a model provider that the operator or workspace configures
(KAI-101, see §16).

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Generate ideas | Make a set of stickies from a prompt | Done with a configured provider: previewed, inserted as one undo step (KAI-102, docs/ai.md) | M | P2 | parity |
| Cluster and sort | Group stickies by theme or sentiment | Done for themes: selected notes move into named groups (KAI-102); non-AI clustering by colour or tag exists too; no sentiment option (#148) | M | P2 | parity |
| Summarise | Turn a selection or a board into a written summary | Done: a written note beside the selection (KAI-102) | M | P2 | parity |
| Text to diagram | Make a flowchart, mind map or sequence diagram from a description | Done: via Mermaid / outline → layout, connectors attached (KAI-102) | M | P2 | parity |
| Image generation | Make an image from a prompt | Missing | M | P3 | parity |
| Board-aware assistant | A chat assistant that reads the board, answers questions about it and proposes edits | Missing (#1); outside agents already read and write through MCP with suggestions people accept, which matches Miro's 2026 Sidekicks and Connectors pitch | L | P3 | parity |
| AI workflows | Reusable multi-step AI pipelines run on board content (Miro's Flows, May 2026) | Missing (#1) | XL | P3 | parity |
| AI slides | Build a presentation from board content automatically | Missing (#1) | L | P3 | parity |
| AI catch-up | A written summary of what changed on a board since your last visit or a chosen date | Missing (#126, after #103) | M | P3 | parity |
| AI on meeting and activity results | Summarise an imported meeting transcript in one step; a report from live-activity answers | Missing: the meeting-notes import lays out the transcript without AI (#148) | S | P3 | parity |
| Natural-language search | Find content across all boards by describing it | Missing (plain full-text search shipped with KAI-141; semantic search is #47) | L | P3 | parity |
| Screenshot to prototype | Turn a UI screenshot into an editable mockup | Missing | XL | P3 | parity |
| AI admin controls | Turn AI on or off for the org, choose the model, use your own key | Done: operator provider (env) and per-workspace on/off, own provider and sealed key, who may use it, monthly budget, usage, audit (KAI-101) | M | P3 | parity |

## 8. Import, export and backup

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Image export | Board, selection or visible area as PNG or JPG, with a scale option | Have | — | P0 | — |
| Vector export | The same areas as SVG | Have | — | P2 | — |
| PDF export | Frames as pages of a PDF | Have | — | P1 | — |
| Copy as image | Put the selection on the clipboard as a picture | Have | — | P1 | — |
| CSV export | Text of stickies and cards as rows | Have: stickies and cards as formula-safe CSV, tables too (KAI-136) | S | P2 | parity |
| CSV / spreadsheet import | Rows become stickies or cards | Have: CSV rows become stickies or cards, as a grid or a kanban by status, in one undo step; spreadsheet paste fills tables (KAI-136) | S | P2 | parity |
| Board backup and restore | Download a full-fidelity board file and restore it later or elsewhere | Have: a `.freero` file (content, comments, files; layers and the downloads policy respected) restored as a new board on any Freero (KAI-137) | M | P2 | 4 |
| Diagram import | Bring in Visio, draw.io or Lucid diagrams as editable shapes | Partial: draw.io (KAI-138); Visio and Lucid `.vsdx` not yet (#116); PlantUML text is #38 | L | P2 | parity |
| Import from Miro | Bring a team's Miro boards over with stickies, shapes, connectors and frames | Missing: through the person's own Miro token (#62), after a check of Miro's API terms (§16) | M | P1 | parity |
| Import from other whiteboards | Bring boards over from Mural, FigJam, Lucidspark, Excalidraw and similar tools | Partial: Excalidraw and draw.io (KAI-138, `features/import/lib/drawio.ts`); Mural (#163), FigJam (#164), Lucidspark and Whimsical (#165) not yet | M | P2 | parity |
| Print | Print the board or its frames | Partial: through PDF export only | S | P3 | parity |

## 9. Integrations, developer platform and embeds

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Public REST API | Read and write boards, items and members from code | Have (`/api/v1`, docs/api/; KAI-104) | L | P2 | parity |
| REST API depth | Rename and copy boards, image, file and embed items, groups, webhook and audit endpoints | Partial: six creatable item types, bulk up to 500, kanbans with fields and views, comments, docs, search, trackers; no board rename or copy, image or embed items, or groups (#170); webhooks (#48), the audit log (#17) and image export (#33) aren't in the API | M | P2 | parity |
| Webhooks | Push board and item events to other systems | Have, ahead of Miro, which removed its experimental webhooks on 2025-12-05 with no replacement: workspace endpoints from the admin console, event filters, HMAC-signed, retries and delivery log, formats for Slack, Teams, Discord, Google Chat and Mattermost (KAI-105, docs/events.md); managing them through the API is #48 | — | P2 | parity |
| API tokens and OAuth apps | Credentials that let third-party apps act for a user | Have (tokens, OAuth 2.1 + PKCE, dynamic registration; KAI-104) | M | P2 | parity |
| Embed a live board | Put a viewable or editable board in other sites (iframe, oEmbed) | Partial: a live board inside ChatGPT and Claude through MCP Apps (KAI-171); no iframe or oEmbed for other sites (#2), which Confluence, Jira, Notion, Teams, Zoom and Meet all wait on | M | P1 | parity |
| Confluence and Jira embeds | A live board in a Confluence page or a Jira issue | Missing: tracker sync writes a remote link back to the issue, not an embed (#166, #167; after #2) | L | P2 | parity |
| In-board app SDK | Third-party apps that run on the canvas and add items or panels | Missing (API and webhooks first, see §16; #179) | XL | P3 | parity |
| App marketplace | Browse and install third-party apps | Partial: Apps & agents (`/apps`, #87) lists every integration with its connect step, plus community integrations built on the API, webhooks or MCP, shown after an operator's review with a Community label (reportable, removable); none runs inside Freero, so there is nothing to install (no in-board apps, see §16) | XL | P3 | parity |
| MCP server | Let AI coding and agent tools read and write boards | Have, and deeper than the tools Miro's MCP page describes: remote MCP server at `/mcp` with OAuth 2.1, about 33 scoped tools (kanban fields and views, tracker import and sync, meeting notes), suggestions people accept or reject, an agent control room and a live board in ChatGPT and Claude (KAI-107, KAI-169, KAI-171; docs/mcp.md). Miro now ships MCP on all plans | M | P2 | parity |
| Microsoft Copilot app | Make diagrams, stickies and tables on a board from Microsoft 365 Copilot (Miro, April 2026) | Missing: MCP serves Claude, ChatGPT, Cursor, VS Code and others, not Copilot (#114) | M | P3 | parity |
| Chat integrations | Board notifications and link previews in Slack or Teams | Partial: channel posts through webhooks in Slack, Teams, Discord, Google Chat and Mattermost formats (KAI-105); an operator-installed Slack app unfurls board links (docs/integrations/slack.md); no personal Slack messages (#105), and no link previews or personal messages in Teams (#113) | M | P2 | parity |
| Work-tracker sync | Two-way sync between cards or table rows and Jira, Asana, Azure DevOps, monday.com, ClickUp or Trello items | Partial: two-way sync of stickies, cards and kanban cards with Jira (Cloud and Data Center), Linear and GitHub issues, live badges, issue import and roadmap timelines (KAI-153–KAI-157, KAI-160; docs/trackers.md); kanban Table, List, Calendar and Timeline tabs and linked views show the synced cards. No sprint field (#119), custom-field map (#43) or issue links as connectors (#50); no Asana (#120), monday.com (#121), ClickUp (#180) or Trello (#181); the plain table's rows don't sync. Miro's Tables now sync with Asana, monday.com, ClickUp and Trello | XL | P2 | parity |
| Azure DevOps Boards | Two-way sync between cards and Azure work items | Missing (#6) | M | P2 | parity |
| Cloud file pickers | Insert files from Google Drive, OneDrive or Dropbox | Missing | M | P3 | parity |
| Meeting-app integrations | Open a board inside Zoom, Teams or Meet calls | Missing: Teams tab and meeting app (#112), Zoom (#168), Meet (#169), all after #2 | L | P2 | parity |
| Automation directories | Listed apps in Zapier, Make and Power Automate | Partial: recipes for Zapier, Make and n8n and a generated Power Automate custom connector (docs/integrations/); no listed apps (#173, #174, #175) | M | P3 | parity |
| Figma depth | Pick Figma frames after signing in and place them as images; a plugin that sends frames to a board | Partial: live Figma embeds from a pasted link (#171, #172) | M | P3 | parity |

## 10. Apps and platforms

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Desktop browsers | Full editing in current Chrome, Edge, Firefox and Safari | Have | — | P0 | — |
| Tablet and stylus | Touch-friendly editing with pen input | Have: pinch zoom, long-press context menu, bigger handles and controls on touch, palm rejection while a pen is down, "pen draws, finger pans" (KAI-139) | M | P2 | parity |
| Phone web | Usable view-and-comment experience on a small screen | Have: a view-and-comment phone layout — bottom bar with select, hand and comment, comments as a bottom sheet, the full toolbar behind "Edit board" (KAI-139) | M | P2 | parity |
| Installable app (PWA) | Install from the browser with an icon, a window and file handling | Have: installs with its own icons and window, an app-shell service worker and offline page (KAI-140); opens `.freero` backups and takes images and links from the system share sheet (KAI-218) | S | P2 | parity |
| Native mobile apps | iOS and Android apps | Missing (store-wrapped apps with push are #177) | XL | P3 | parity |
| Native desktop apps | Windows and macOS apps | Missing (#176) | M | P3 | parity |
| Offline work | Edit without a connection and sync later | Partial: Yjs merges edits made during short disconnects; nothing survives a reload while offline (the `/board/local` sandbox is dev-only) (#178; Miro has no offline mode either) | L | P3 | parity |

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
| Admin trash and archive | Admins see and restore everyone's deleted boards; finished boards can be archived | Partial: trash belongs to each owner, with workspace retention of 1–365 days; no archive state (#153) | S | P2 | parity |
| Board roles | Owner, editor, commenter and viewer per board | Have; no co-owner (below) | — | P0 | — |
| Co-owner | A second owner-level role that manages sharing, the link and backups without ownership passing | Missing: only the owner changes roles, link access, password and expiry (#122) | M | P2 | parity |
| Per-board sharing settings | The owner stops editors from sharing, or viewers and commenters from copying and exporting | Missing: editors can always invite; copy and export follow only the workspace's downloads policy (#123) | S | P2 | parity |
| Invite existing users | Add people by email with a role | Have | — | P0 | — |
| Invite people without an account | Email invite → sign up → land on the board | Have | — | P0 | — |
| Share by link | Anyone with the link gets a chosen role | Have (signed-in people, or guests without an account where allowed) | — | P0 | — |
| Anonymous visitors | Open a shared link without an account, with a guest name | Have: named guests on a shared link, one board each, at most commenter; a workspace can require sign-in (KAI-43). Because they stop at commenter, guests can't vote, estimate or write private drafts (#96) or add stickies (#97): the most-felt facilitation gap, hit in the first minutes of an outside workshop | M | P1 | 3 |
| Request access | Ask the owner for access from a locked board | Have: the owner or workspace admins approve or decline from the inbox or the share dialog (KAI-40) | S | P2 | 3 |
| Transfer ownership | Hand a board to someone else | Have: boards and team workspaces (KAI-41) | S | P2 | 3 |
| Link password or expiry | Protect public links | Have: a password and an expiry date on a board's link, for members and guests (KAI-145); admins can't require them (#39) | S | P3 | parity |
| Workspaces and teams | Shared spaces with members and team-wide boards | Have: personal and team workspaces, every query scoped by membership; team access level per workspace or project (KAI-37, KAI-93); nothing sits above a workspace (below) | L | P1 | 3 |
| Organisation above workspaces | One organisation over many teams, with SSO, SCIM, domains, policies and audit set up once | Missing: each team workspace has its own SSO, SCIM, policies and audit log (#108) | L | P2 | parity |
| Move boards between workspaces | Move a board into another workspace, or duplicate it there | Partial: moves stay inside one workspace and duplicates land in the source workspace (#124) | M | P2 | parity |
| Projects / folders | Group boards inside a workspace | Have (KAI-39); flat, with no nesting, landing page or pinning (#129) | M | P1 | 3 |
| Team roles | Workspace owner, admin, member and guest | Have (KAI-38) | M | P2 | 3 |
| Sharing policies | Rules for who may share, export or invite guests | Have: outside sharing, link sharing and guest links, guest invites, downloads and exports, team access level, live embeds (KAI-42) | M | P2 | 3 |
| User groups | Named groups of people to share boards with | Partial: directory (SCIM) groups grant a workspace role or a project's membership (KAI-46); no groups made in Freero, and a board can't be shared with a group directly (#63) | M | P3 | 4 |
| Per-user time zone | Reminders and email dates follow each person's own time zone | Partial: due reminders count UTC days and emails show UTC dates (#106) | S | P2 | parity |

## 12. Admin, security and compliance

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Transport and app hardening | TLS, security headers, rate limits, upload quotas | Have (CSP and HSTS, per-route rate limits, upload and board quotas, TLS through the Caddy deploy config) | — | P1 | — |
| Backups and disaster recovery | Operator backups and restores of the database and files | Have (`scripts/backup.sh`, restore runbook in `docs/operations.md`, bucket versioning for files) | — | P1 | — |
| Horizontal realtime scale | Many app instances share board updates | Have (Redis fan-out, append-only update log with snapshots) | — | P1 | — |
| Encryption at rest | Stored data encrypted | Have: S3 server-side encryption (`S3_SSE`), encrypted database backups, every stored credential sealed or hashed by the app, a documented baseline for database storage encryption (KAI-143) | S | P2 | 1 |
| SSO | SAML 2.0 / OIDC per workspace, verified domains, enforced SSO | Have: SAML 2.0 and OIDC per workspace, DNS-verified domains, just-in-time membership, Enforce SSO with a break-glass owner (KAI-45); service-provider-initiated only (next row), no single logout or encrypted assertions (#13), and no org-wide SSO (#108) | L | P2 | 4 |
| IdP-initiated SSO | Open Freero from the identity provider's app tile and land signed in | Missing (#107) | S | P2 | parity |
| SCIM provisioning | Create and remove users automatically from the identity provider | Have: SCIM 2.0 users and groups per workspace, rotatable tokens, groups map to roles or projects, deprovisioning deactivates (KAI-46) | L | P3 | 4 |
| Admin console | Manage members, roles, security settings and usage | Have: members with two-step status and deactivation, security and retention settings, sharing policies, single sign-on and provisioning, issue trackers, usage, audit log (KAI-47) | L | P2 | 4 |
| Granular admin roles | Separate admins for members, content and security | Missing: owner and admin only, and every admin can do everything (#151) | M | P2 | parity |
| Admin content inventory | Every board in the workspace with owner, sharing and last activity, re-shared from the console (Miro's Content Explorer, in beta) | Missing: the console shows members and usage counts, not boards (#152) | M | P2 | parity |
| Audit log | Record of security-relevant events, with export and SIEM streaming | Partial: append-only, hash-chained per workspace, filters, CSV/JSON export, integrity check (KAI-48); no SIEM streaming and not in the REST API (#17) | L | P2 | 4 |
| Data export and erasure | Per-user and org export and deletion (GDPR) | Have: personal data export, workspace export for admins, self-service account deletion with purge, workspace deletion (KAI-50) | M | P2 | 4 |
| Retention policies | Delete or archive content automatically after a set time | Partial: per-workspace trash, version-history and audit-log retention (KAI-51); no content expiry (#154) | M | P3 | 4 |
| Session policies | Idle timeouts and session length rules | Have: per-workspace session lifetime and idle timeout, strictest wins across a person's teams (KAI-51) | S | P3 | 4 |
| Domain control | Claim a domain, capture accounts, block personal sign-ups | Partial: a workspace claims and DNS-verifies domains, and Enforce SSO sends every sign-in at them through its identity provider (KAI-45); existing accounts aren't moved into the workspace and personal sign-ups aren't blocked without SSO (#64) | M | P2 | 4 |
| Admin usage analytics | Activity and adoption reports | Partial: the admin console shows boards, members by role, people active in the last 7 and 30 days and storage (KAI-47); no trends over time or reports (#65) | M | P3 | 4 |
| IP allowlisting | Allow access to a workspace only from listed networks | Missing (#156) | S | P3 | parity |
| eDiscovery and legal hold | Keep and export a person's board history for legal cases | Missing (#157) | L | P3 | parity |
| Data classification / DLP | Scan boards for personal or payment data and apply rules | Missing (#158) | XL | P3 | parity |
| Customer-managed keys | Encrypt an org's data with keys the org controls | Missing (#159) | XL | P3 | parity |
| Data residency | Choose the region where data is stored | Missing on the hosted service (#160); self-hosting picks any region | XL | P3 | parity |
| Compliance certifications | Independent audits (SOC 2, ISO 27001) and the paperwork that goes with them | Missing: no security overview, subprocessor list or DPA for freero.app yet (#109), and no attestation (#110); self-hosting runs under the customer's own certifications | XL | P2 | parity |
| Abuse reporting and moderation | Report and take down harmful public boards | Have: report a board, item, file or comment (also without an account); operator queue, link block / take-down / file removal / suspension, appeals, legal hold (KAI-142, KAI-178, KAI-181) | M | P2 | 1 |

## 13. Plans and limits (context only, not counted)

| Topic | Miro (public pricing page and help center, 2026) | Freero |
|---|---|---|
| Free tier | 3 editable boards, low-resolution export, view-only visitors, a small AI trial, no private boards, timer/voting/private mode on paid plans only | Everything is free; no plan gates |
| Paid gates | Guests, SSO and data tables from the mid tier; SCIM, audit logs, domain control, extra residency regions, AI workflows and enterprise APIs at the top tier | None planned; limits are operator quotas |
| Paid add-ons | Data classification, key management, lifecycle management, eDiscovery, AI blocking, prototyping, live audience engagement | n/a |
| Usage limits | AI credits per member per month; MCP calls per day | Upload quota per user, request and WebSocket rate limits (see `docs/configuration.md`) |

---

## 14. Summary

Counts cover every capability row in §1–§12 (§13 isn't counted). AI rows marked "Done" count as
Have. In the 2026-11-03 re-check: 7 rows moved from Have to Partial because the feature exists but
stops early (large-board performance, emoji and stickers, notifications, activity feed, live
reactions, walkthroughs, dot voting), 38 rows were added for gaps the doc didn't list, and 10 rows
moved up in priority (interface languages, live embeds, MCP, chat, tracker sync, diagram
import and layers, meeting apps, domain control, certifications).

**By status**

| Status | Count |
|---|---|
| Have | 157 |
| Partial | 35 |
| Missing | 56 |
| **Total** | **248** |

**By priority and status**

| Priority | Have | Partial | Missing | Total |
|---|---|---|---|---|
| P0 | 30 | 1 | 0 | 31 |
| P1 | 48 | 8 | 3 | 59 |
| P2 | 74 | 18 | 19 | 111 |
| P3 | 5 | 8 | 34 | 47 |

<!-- counts generated from the tables above; regenerate when rows change -->

**Takeaways**

- Freero has a counterpart for almost every Miro primitive. What's left is mostly about who can take
  part, where a board can be shown, and how content gets in: link guests stop at commenter
  (#96, #97), a live board can be embedded only in ChatGPT and Claude (#2), and there is no
  Miro import (#62). Each is cheaper than its impact, because the features it unlocks (the guided
  retro, sealed voting, Engage, tracker sync) already exist.
- First-hour gaps a switcher notices are small: sticky shapes and dark colours, fonts, Miro-style
  shortcuts and a dark-mode toggle (all S). The one P0 gap is large-board performance, which is
  unmeasured rather than known to be slow (#130).
- Several "Have" rows were shallow in the way the kanban was: voting, notifications and catch-up,
  diagramming, walkthroughs, Jira depth and sharing. §15 lists the ranked order.
- Enterprise gaps (an organisation layer, domain capture, SIEM, attestation, languages) block only
  one kind of buyer, and self-hosting answers residency, keys and certification for most of them.
- Freero is ahead on webhooks (Miro removed its own), MCP depth, free two-way Jira, Linear and GitHub
  sync, server-sealed facilitation, free version history, phone-browser editing and self-hosting.

## 15. Recommended build order (web parity work)

The 2026-10-27 batches (arrange, find, shortcuts, item links, crop, kanban, shape and icon libraries,
tables, link previews, PDF, the collaboration loop, save as template, version history and trash) have
all shipped. The batches below cover what's left at P1 and P2, plus the P3 items worth doing because
they're cheap or strategic. Each follows the Dune layout: a new `apps/web/src/features/<name>/` folder
made with `npm run new:feature`, a server module per area, and engine changes only when a capability
cuts across types. Batches A–D are independent and can run in parallel; E and F follow the teams merge.

Status: the teams merge and batches A–F have shipped except #3 (smart drawing), #4 (custom packs),
#5 (interface languages), #2 (embeds in other sites) and #1 (assistant). Follow-ups are filed as their
own issues (named in the rows). The batch lists below keep their Linear ids as a record of what
shipped.

**Next: the 2026-11-03 ranking.** The re-check ranked the remaining gaps by who hits them, how soon,
whether they block a buyer or a migration, and cost. The top fifteen carry `priority: high` in GitHub
Issues:

1. Commenters and link guests take part in votes, estimates and private drafts (#96), then optional
   guest editing (#97).
2. A public live embed and oEmbed (#2), which Confluence, Jira, Notion, Teams, Zoom and Meet wait on.
3. Miro import (#62), after the Miro API terms check.
4. First-hour polish: sticky shapes, sizes and dark colours (#98), fonts (#99), Miro-style shortcut
   aliases (#100), dark mode (#101).
5. Voting depth: anonymous ballots, up to 99 votes, per-item cap, timer, past results (#102).
6. Notifications and catch-up: since your last visit (#103), board-change digest (#104), personal
   Slack messages (#105), per-user time zone (#106).
7. Enterprise identity: domain capture (#64), IdP-initiated SAML (#107), SIEM streaming (#17).
8. An organisation above team workspaces (#108).
9. Hosted-service assurance: security overview, subprocessor list and DPA (#109), then SOC 2 or
   ISO 27001 (#110).
10. Interface languages (#5).
11. Pen tools: smart drawing (#3) and lasso (#111).
12. Microsoft surface: Teams app (#112), Teams bot (#113), Copilot app (#114).
13. Diagramming depth: line jumps (#115), Mermaid class/ER/state (#38), `.vsdx` import (#116),
    custom shape packs for cloud icons (#4), a diagram container (#117) with layers (#118).
14. Tracker depth and breadth: sprint field (#119), custom-field map (#43), Azure DevOps (#6),
    Asana (#120), monday.com (#121).
15. Sharing depth: co-owner (#122), per-board sharing settings (#123), admin-required link
    password and expiry (#39), moves between workspaces (#124).

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
  KAI-119 (Mermaid), KAI-120 (wireframe kit), #3 (smart drawing); later #4 (custom packs).
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
  KAI-108 (accessibility), KAI-143 (encryption at rest), #5 (interface languages).

**Batch F: Platform and AI**
- **Issues:** KAI-104 (REST API, tokens, OAuth) → KAI-105 (webhooks), #2 (embeds), KAI-107
  (MCP server); KAI-101 (AI foundation) → KAI-102 (AI board actions) → #1 (assistant);
  KAI-137 (board backup) and KAI-138 (import from draw.io and Excalidraw).
- **Fit:** new server modules (`api`, `webhooks`, `mcp`, `ai`) that reach board content only through
  `modules/realtime`'s exported functions, so private layers and hidden frames are respected everywhere.

Filed in the 2026-11-03 re-check (each row names its issue; most at `priority: low`, diagram layers
higher with the diagram container), so the gap is tracked even where §16 keeps it a non-goal for now:
timer music (needs licensed audio), icebreaker widgets,
custom sticker sets, charts, diagram layers, offline editing, native apps, in-board app SDK,
meeting-app integrations, community gallery, guided board setups, eDiscovery, DLP, customer-managed
keys, data residency and certifications. Still not filed, on purpose: office document previews,
interactive prototypes, image generation, screenshot to prototype, capture of paper stickies, the
installable app marketplace (it needs the SDK first) and cloud file pickers. Revisit paper capture
after the AI foundation.

## 16. Unrealistic for a free product, or needs third-party agreements

| Item | Why it's hard | Pragmatic alternative |
|---|---|---|
| Official integrations with Jira, Asana, Azure DevOps, Slack, Teams, Zoom | Marketplace listings, partner reviews and OAuth app approval with each vendor, plus upkeep as their APIs change | Public REST API, webhooks with Slack/Teams-ready payloads and generic embeds (KAI-104, KAI-105, KAI-127); issue sync with Jira, Linear and GitHub through each user's or team's own credentials, no marketplace listing needed (KAI-153–KAI-157); documented recipes for no-code automation tools. Freero now ships an operator-installed Slack app (per-instance manifest, `docs/integrations/slack.md`), so vendor apps aren't unrealistic: the same approach can cover a Teams app (#112, #113) and an Atlassian app (#166, #167). Listing them in each vendor's store still needs the owner's developer accounts and reviews (named in each issue) |
| In-board app SDK and app marketplace | A security review process and sandboxing for third-party code on everyone's boards | Start with API, webhooks and an MCP server (KAI-107); maybe a sandboxed iframe app model later (#179) |
| Built-in audio/video calls | TURN/SFU servers cost money per minute at scale | A per-board call link to Jitsi or the team's meeting tool (KAI-134); optionally a self-hosted Jitsi or LiveKit when the operator provides one (#149) |
| AI features at Miro's level | Model inference costs money per request; a free tier is open to abuse | Bring your own API key per workspace, or an operator-configured endpoint, including self-hosted open models (KAI-101). AI stays off unless configured. Strict rate limits |
| Cloud provider icon sets (AWS, Azure, GCP) | Each provider has its own usage terms for its icons; we can't redistribute them as Freero assets without checking those terms | Generic, original infrastructure icons (shipped) plus custom SVG shape packs that users upload themselves (#4) |
| Data residency in several regions | One deployment per region, plus routing and operations staff | Freero is open and Docker-based: organisations that need a region self-host there. The hosted service states its single region |
| Customer-managed keys, DLP scanning, eDiscovery and legal hold | Need KMS integrations, content scanning pipelines and legal processes | Encryption at rest through the storage provider (KAI-143), audit log and data export (Phase 4); self-hosting for regulated organisations |
| SOC 2 / ISO 27001 / HIPAA certification | Expensive yearly audits by outside firms | Publish the security architecture, a subprocessor list, a DPA, a responsible disclosure policy and the audit log (#109); self-hosting as the compliance path; an attestation for the hosted service once the owner funds an auditor (#110) |
| Native mobile and desktop apps | Separate codebases, store fees and reviews | A PWA plus touch-optimised web chrome (KAI-140, KAI-139) |
| Importing Miro's own board files | The backup format is proprietary; use of Miro's API is under Miro's terms | Import from open formats (CSV, draw.io XML, Excalidraw JSON; KAI-136, KAI-138). A Miro import through the user's own API token, after checking the terms (#62) |
| Community template marketplace and moderation | Moderation work and legal exposure for user uploads | Shared team templates first (Phase 3); public gallery only with abuse reporting in place (KAI-142) |
