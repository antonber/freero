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
  live. Updated against `main` at 10fb4ee on 2026-11-03, after the day's merges since the rewrite
  (918fb01): 61 issues closed, most of the ranked fifteen among them. Checked against `main` at
  6e7bba8 on 2026-11-03, after the merges since that update (af4f7b0): interface languages,
  offline copies, desktop and phone shells, the board assistant and saved AI workflows, the
  community gallery, enterprise compliance (legal holds, labels and the sensitive-data scan,
  workspace keys for content and files, SAML single logout), personal Slack messages, apps for
  Confluence, Jira, Zoom, Meet, Zapier, Make, Power Automate and Figma, ClickUp and Trello sync, and
  the remaining P3 polish. An issue marked Done counts only for what the code on `main` actually
  does, and an issue still open counts for what has shipped against it. Code that ships off until
  the operator registers an app or gets a key from another vendor, or that has only been tried
  against stand-ins of a vendor's service, counts as Partial, and its note names the step that's
  left.

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
| Shortcuts familiar from Miro | Ctrl/Cmd+K for the command palette, Alt+1 / Alt+2 to fit, Ctrl/Cmd+0 for 100%, PgUp / PgDn for front and back | Have: Mod+K, Alt+1, Alt+2, Mod+0 and Page Up / Down work as aliases beside Freero's own keys; an alias never shadows a key another command owns (Mod+K on a selected item still makes its link), and Alt+arrows stay item navigation (#100) | — | P1 | — |
| Dark mode | Dark interface and canvas, chosen by the user or following the system | Have, ahead of Miro, which has no dark mode: light, dark or system in the app and account settings, a Theme toggle in the board menu, board content kept as authored with readable ink chosen at paint (#101) | — | P1 | — |
| Large-board performance | Stays smooth with thousands of items | Have, with published numbers ([docs/performance.md](performance.md)): `npm run bench:board` seeds a 10,000-item mixed board and drives it in a real browser; below zoom 0.18 items draw on low-detail canvases, so panning at zoom to fit went from about 3.7 s to 7.6 ms a frame (p95 17 ms) and select all from 1,455 to 122 ms (#130, #131). The follow-ups shipped: the board loads in 0.55–0.6 s instead of 3.3–4.6 s with 17 MB of JS heap, selected items off screen no longer mount, low detail is left gradually, and kanbans, diagrams and frames draw in low detail too (#182–#185) | — | P0 | — |
| Accessibility on the board | Move through board items with the keyboard, have a screen reader describe them, high-contrast option | Have: Tab and Alt+arrows walk items in reading order, a live region describes the selection and collaborators' edits, "Board as list" reads the whole board as a tree, forced colours and reduced motion are handled (KAI-108, docs/accessibility.md); items aren't DOM focus targets for a screen reader's browse mode (#29); the WCAG 2.2 review is the next row | — | P2 | — |
| Accessibility review and conformance report | A WCAG 2.2 AA review of the product and a published conformance report (ACR / VPAT) that procurement asks for | Partial: `npm run a11y` runs axe-core's WCAG 2.2 AA rules in 17 states of the real app plus keyboard checks, with no violations on its last run; the fixes it found shipped (label in name, contrast in the dark theme, reflow at 320 px, hover content, target size), and a draft VPAT 2.5 report is at /accessibility, kept out of search engines until the owner approves it. A pass with real screen readers (NVDA, JAWS, VoiceOver, TalkBack) and speech input and an independent audit are owed before it can say more than "self-assessment" (#141) | S | P2 | parity |
| Interface languages | The UI in several languages (Miro has eight) | Partial: ten languages live, English, German, French, Spanish, Portuguese (Brazil), Japanese, Korean, Simplified Chinese, and Arabic and Hebrew right to left with the chrome mirrored, chosen in the account, from the browser or by `?lang=`; emails and notifications are translated too, and `check:i18n` in `npm run check` stops new hard-coded text (#5, [docs/design/i18n.md](design/i18n.md)). Every translation is machine-made and listed as unreviewed until a person checks it; some server text (activity summaries, security and admin emails, uncoded errors) and sentences assembled from English words are still English, and the marketing site has no translated pages (#77) | M | P1 | parity |

## 2. Board content

### 2a. Core items

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Sticky notes | Coloured notes whose text shrinks to fit; fast keyboard chaining | Have (12 colours, add-next-to and Tab chaining, auto-fit) | — | P0 | — |
| Sticky shapes, sizes and dark colours | Square and rectangle stickies, size presets, dark and saturated papers | Have: square and rectangle stickies in S, M and L, 24 papers incl. dark and saturated ones with readable ink chosen at paint; shape and size also in MCP `add_stickies` and the REST API (#98) | — | P1 | — |
| Sticky pad | Drop a stack of blank stickies that people peel from | Have: a sticky pad people peel blank stickies from, with a low-detail drawing on big boards (#132) | — | P3 | — |
| Paste a list as stickies | Pasting multi-line text makes one sticky per line | Have (sticky `importData`) | — | P1 | — |
| Sticky author label | Optionally shows who wrote each sticky | Have: a board setting editors toggle; current names, none while private mode runs (KAI-112) | S | P2 | parity |
| Capture paper stickies | Photograph physical notes (or send tablet handwriting) and turn them into digital stickies | Missing | L | P3 | parity |
| Basic shapes | Rectangles, ellipses, polygons, arrows, callouts with fill, border and text | Have | — | P0 | — |
| Change shape type | Swap an existing shape for another kind and keep its text and style | Have | — | P1 | — |
| Text boxes | Free text with font, size, colour, highlight, lists, links, bold/italic/underline/strike | Have | — | P0 | — |
| Font choice | Twenty-odd fonts, including faces for CJK and right-to-left scripts | Have: fifteen self-hosted, openly licensed families in Sans, Serif, Mono and Handwritten groups, fetched per script the first time they're drawn, no font CDN; Chinese, Japanese and Korean fall back to system faces rather than bundled ones (#99) | — | P1 | — |
| Connectors | Straight, elbow or curved lines that stay attached to items, with arrowheads, styles and a label | Have | — | P0 | — |
| Quick connect | Drag from a handle on an item to draw a line or create a linked item | Have | — | P1 | — |
| Richer connector labels | Several labels on one line, placed anywhere along it | Have (`labels[]` with a position each; double-click the line to add one) | — | P2 | — |
| Attach anywhere on the outline | Connector ends fix to any point of a shape's edge, not only side midpoints | Have: an end dropped near an outline holds that spot as a fraction of the box, projected onto curves and slanted sides (KAI-113) | S | P2 | parity |
| Pen and highlighter | Freehand pressure-sensitive ink and a translucent marker | Have | — | P0 | — |
| Eraser | Rubs out ink | Have (cuts through strokes, or deletes whole strokes) | — | P2 | — |
| Smart drawing | Turns rough hand-drawn shapes into clean shapes | Have: pen strokes become clean shapes, lines and arrows through Freero's own deterministic recogniser (no AI provider needed), switched in the pen flyout; undo brings the ink back, a scribble erases, holding at the end straightens (#3) | — | P2 | — |
| Lasso | Draw a freeform loop to select ink and items | Have: a Lasso tool and Alt+drag freeform selection, picking items inside or touching the loop (#111) | — | P2 | — |
| Images | Upload, paste, drag and drop, or paste an image link | Have (PNG/JPG/GIF/WebP/SVG) | — | P0 | — |
| Image crop | Trim an image on the board without editing the file | Have | — | P1 | — |
| Image alt text | A description of the image for accessibility | Have | — | P2 | — |
| Emoji and stickers | Place emoji, decorative stamps and animated GIFs on the board | Partial: the full emoji set, stamps and original sticker packs in a Stickers / Emoji picker (#138); GIF search is built, every search and preview going through Freero's server so the key never reaches a browser, a placed GIF copied into the placer's uploads, and a per-workspace rating policy, but it's off until the operator gets a GIPHY or Tenor API key and sets `GIF_PROVIDER` and `GIF_API_KEY` (#139) | S | P1 | parity |
| Custom sticker sets | Save your own images as a reusable sticker palette | Have: team sticker sets uploaded through the usual upload checks, drawn as their pictures in server-side exports too (#138) | — | P3 | — |
| Frames | Titled areas that hold items, with size presets and fit-to-content | Have (plus grid layouts) | — | P0 | — |
| Hide frame contents | Keep a frame's contents hidden from others until the facilitator reveals them | Have (server keeps contents from viewers and commenters) | — | P2 | — |
| Task cards | Cards with title, description, assignee, due date, status and tags | Have | — | P1 | — |
| Flip cards | Two-sided cards for quizzes and reveals | Have: two-sided cards; low detail draws the side that shows (#142) | — | P3 | — |
| Kanban widget | Columns that hold cards; moving a card to another column changes its status | Have (columns with status, WIP limits) | — | P1 | — |
| Tags | Named, coloured labels on items, for filtering and grouping | Have (stickies and cards) | — | P2 | — |
| Mind maps | A central topic with automatically laid out branches; add, collapse and tidy | Have | — | P1 | — |
| Mind map keyboard navigation | Arrow keys move between nodes | Have (arrows, Alt+arrows reorder, Space collapses) | — | P2 | — |
| Mind map AI and layouts | Expand a node with AI ideas, grow the map downwards, turn stickies into a map | Have: right, left, both directions or downwards; Expand with AI on a node (with a configured provider) and selected stickies into a map (#134) | — | P2 | — |
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
| Cloud architecture icons | Provider icon sets for AWS, Azure, Google Cloud and Kubernetes | Partial: an original generic network set (server, firewall, router, switch, devices, users), and a team can upload a provider's published icons as its own shape pack (Custom shape packs, below); none are bundled, since each provider's terms need the owner's reading first (see §16; #4) | S | P2 | parity |
| Engineering shape packs | Symbol sets for electrical circuits and process (P&ID) diagrams; Miro added circuit, electrical, P&ID and about 600 general shapes between Nov 2025 and Apr 2026 | Partial: teams and people upload their own symbol sets as shape packs (#4); no original circuit or P&ID sets ship with Freero | M | P3 | parity |
| Value-stream and data-flow sets | Symbols for value-stream mapping and data-flow diagrams | Have: original value-stream and data-flow shape sets, each with templates (#133) | — | P3 | — |
| Wireframe kit | Device frames and UI controls for low-fidelity mockups | Have: shape library "Wireframe" set (4 devices, 17 controls) + icon library, Tablet frame preset (KAI-120) | L | P2 | parity |
| Interactive prototypes | Clickable screens linked into a flow you can play, increasingly generated by AI | Missing (item links give simple click-through between frames) | XL | P3 | parity |
| Custom shape packs | Upload your own SVG shapes as a reusable library | Have: workspace shape packs and personal libraries from uploaded SVGs, sanitised by one shared rule for the board, exports and the server render, and kept in data exports with sticker sets (#4) | — | P3 | — |
| Diagrams as code | Build editable diagrams from Mermaid or PlantUML text | Have: Mermaid flowchart, sequence, mind map, class, ER and state diagrams (class and ER as real UML and ERD elements) and PlantUML sequence, class, activity, state, use case and component; paste, Insert from text or drop a `.mmd` / `.puml` file, edit the source to re-lay out; they land as a diagram container (KAI-119, #38, #116, #117); AI and MCP draw class, ER, state, org charts and kanbans. No gantt text | — | P2 | — |
| Swimlanes and containers | Row and column lanes that hold and move diagram items | Have: swimlane pools with row or column lanes and phases that hold and move their items (KAI-117) | M | P2 | parity |
| Auto-layout and org charts | Arrange a connected diagram or hierarchy automatically | Have: Auto-layout ▸ top-down / left to right / tree / org chart; org charts from "Name, Title, Manager" rows (KAI-118) | L | P2 | parity |
| Obstacle-avoiding routing | Elbow connectors route around other items | Have: elbows without a user bend detour around items in the way (KAI-113) | M | P2 | parity |
| Line jumps | A small hop where two connectors cross, on by default in Miro since 2023 | Have: the line on top hops, a per-board setting on for new boards, drawn in exports too, with its own benchmark (`npm run bench:line-jumps`) (#115) | — | P2 | — |
| Diagram container and focus mode | A diagram as one object that owns its shapes, keeps its layout live and opens in a focus mode; Miro's Diagrams format | Have: a Diagram item owns its steps and lines and re-lays out live when its structure changes (a step moved by hand stays pinned, one undo step), opens in focus mode (which can hide the rest of the board), and MCP `add_diagram` can draw into it (#117) | — | P2 | — |
| Diagram layers | Named layers inside a diagram that you can show or hide | Have: per-diagram layers to show, hide, lock and reorder (#118) | — | P2 | — |

### 2c. Structured content

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Tables | A grid of editable cells on the board; add or remove rows and columns | Have (rich-text cells stored one per key, header row, fills, spreadsheet paste, CSV export) | — | P1 | — |
| Data tables | Typed columns (status, person, date), several views (table, kanban, timeline, tree), rows linked to board items | Partial: kanbans cover the card case: typed fields, Table, List, Calendar and Timeline tabs, and linked views placed anywhere on the board, all showing the same (also tracker-synced) cards ([kanban fields and views](design/kanban-fields-and-views.md)). The plain table has typed columns (text, number, date, select, person, checkbox) with sort, a filter that hides what it leaves out, a grid grouped by a column, a board view and a timeline of its rows (KAI-123, #51); it takes one filter condition, has no tree view, and its rows can't be pinned as cards or synced with trackers (#51) | M | P2 | parity |
| Timeline / Gantt | Bars on a date axis with lanes, for roadmaps and plans | Have: day/week/month/quarter axis, lanes, bars and milestones; dragging edits dates, cards join as bars, connectors are dependencies; tracker issues as a roadmap (KAI-122, KAI-160) | L | P2 | parity |
| Docs | Long-form rich documents (headings, lists, tables) that live on the board, with Markdown import and export | Have (KAI-124, KAI-162: a doc placed on the board shows live; Markdown in and out) | L | P2 | parity |
| Code blocks | Monospaced code with syntax highlighting | Have: syntax highlighting, line numbers, language picker, copy; pasted code fences become blocks (KAI-125) | S | P2 | parity |
| Charts | Bar, line or pie charts from entered data | Have: bar, stacked bar, line, area and pie charts from an editable data grid with spreadsheet paste (concurrent edits merge per cell), also from MCP `add_diagram` and in server-side exports (#137) | — | P3 | — |
| Slides | A deck view built from board content, with slide layouts | Have: a slide deck built from frames with a filmstrip of real slide thumbnails, layouts incl. Big number and Quote that replace rather than pile up, image areas a dropped picture fills, skip, duplicate and speaker notes, a single-slide editor; presentation mode and PDF export follow the deck (KAI-126, #52, #135); PowerPoint import is in §8 (#136); no AI decks (#1) | — | P2 | — |

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
| Protected lock | A second lock that only board owners can undo | Have: a protected lock only owners and co-owners can set or undo, enforced by the server (#140) | — | P2 | — |
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
| Activity feed | Who changed what on the board, and when | Have: a board activity panel and workspace recent activity, API and agent writes included (KAI-44, KAI-207); an entry opens and highlights what it changed (#125); "since your last visit" is in §4 (#103) | — | P2 | — |

## 4. Collaboration

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Real-time co-editing | Everyone's changes appear live and merge without conflicts | Have (Yjs) | — | P0 | — |
| Live cursors | Named, coloured cursors for each collaborator | Have | — | P0 | — |
| Remote selections | See what others have selected and who is typing | Have | — | P1 | — |
| Presence list | An avatar stack of who is on the board | Have | — | P0 | — |
| Follow someone | Your view tracks a collaborator's view | Have | — | P1 | — |
| Bring everyone to me | Move all participants' views to yours | Have | — | P1 | — |
| Live reactions | Emoji bursts on everyone's screen | Have: any emoji from a picker, with a running count for the presenter (#144) | — | P2 | — |
| Hide cursors | Turn other people's cursors off to reduce noise | Have: for yourself, or the facilitator hides them for everyone (KAI-129) | S | P2 | parity |
| Comments | Threads on the board or on an item; replies, reactions, resolve, unread, filters | Have (authorship enforced by the server) | — | P0 | — |
| Comment filters and anchors | Filter threads by mentions of me, unread or author; pin a thread to an area; attach files | Have: open, resolved, mine, Unread, @Me and author filters; a thread anchors to a point, an item or an area of the board, and a comment takes up to four files through the checked attachment routes (#143) | — | P2 | — |
| @mentions | Tag people in comments to pull them in | Have (member picker; inviting by address from the picker) | — | P1 | — |
| Notifications | In-app and email alerts for mentions, replies, invites and new comments | Have: inbox, live bell, email digests, one-click unsubscribe, an opt-in board-changes digest, opt-in alerts for new comment threads on boards you own or starred, reminders and email dates in each person's time zone (#104, #106); the same alerts in Slack or Teams are the next row | — | P1 | — |
| Personal Slack and Teams messages | Your own mentions, replies and assignments as direct messages in Slack or Teams, and a command to find or start a board from chat | Partial: personal Slack is built: Connect Slack in settings, notification messages that don't repeat an email you already get, previews of private boards for connected people who can open them, and `/freero` to create or find boards, with team workspace policies respected; it's off until the operator gives its Slack app the new scopes and sets `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`, and then needs a check in a real Slack workspace (#105, docs/integrations/slack.md). Personal Teams messages aren't built (#113) | M | P1 | parity |
| Recent changes since your last visit | Coming back to a board, see and highlight what others changed while you were away | Have: a marker per person and board, See recent changes with highlights and stepping through them (#103); an AI written catch-up is in §7 (#126) | — | P1 | — |
| Board-change digest | An email summary of changes on boards you own or follow | Have: an opt-in email digest of changes on your boards (#104); comment alerts, the rest of #104, are under Notifications | — | P2 | — |
| Assignment notifications | Tell people when work is assigned to them or is about to be due | Have: card assigned and due-date notifications, a reminder the day before, also in email digests (KAI-135) | S | P2 | parity |
| Private mode | Participants add content that others can't see until it's revealed | Have (server-side private layers; whole board or one frame) | — | P1 | — |
| Attention management | The facilitator keeps everyone in their view and stops people wandering off | Have: the facilitator leads everyone's view with a locked follow (KAI-129) | M | P2 | parity |
| Async video walkthroughs | Record a narrated tour of the board (camera plus pointer) for others to watch later, with a summary, chapters and reactions | Partial: voice and optional camera over the live board with the narrator's view and pointer, comments at moments, captions typed or by the board's AI (KAI-133); decision snapshots freeze a board or frame (KAI-161); an AI summary and chapters from the captions and emoji reactions on the timeline (#127); several people record one walkthrough together, in step (#128). Against Miro's Talktrack: no tab or screen capture (#69) | S | P2 | parity |
| Audio and video calls | Talk and see each other inside the board | Partial: a per-board call link (the team's meeting URL or a Jitsi room) with "Join call" and who is in it; no built-in audio or video, by design (KAI-134; see §16); an optional embed of an operator's own Jitsi or LiveKit server is #149 | M | P2 | parity |

## 5. Facilitation and presentation

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Shared timer | One countdown everyone sees, with presets and a sound at zero | Have | — | P1 | — |
| Dot voting | Facilitator-run voting with per-person limits, chosen items, hidden results and a ranking; anonymous by default in Miro | Have: hidden votes stay on the server until results are shown; anonymous by default, 1–99 votes per person, a per-item cap, a deadline on the server clock and past votes kept as totals (#102); commenters and link guests vote too, own entries only, behind a per-board switch (#96) | — | P1 | — |
| Estimation / planning poker | Everyone estimates stories privately, then the estimates are revealed together | Have: planning poker with sealed picks, estimates saved on cards (KAI-131); commenters and link guests estimate too (#96); estimates on stickies and tracker write-back are #25 | — | P2 | — |
| Live polls, Q&A, word clouds | Audience activities (polls, word clouds, rankings, rating scales, Q&A) answered from the board or a phone, with results on the board | Have: polls, word clouds, rankings, rating scales and Q&A; answers stay on the server, sealed until revealed, guests and phones answer through a link (KAI-132) | L | P2 | parity |
| Join by QR code | Participants scan a code on the shared screen to answer from a phone | Have: a QR code for the answer link and a phone answer page that needs no board (#40) | — | P2 | — |
| Quiz and 2×2 activities | A quiz with right answers and a leaderboard; a 2×2 matrix that everyone places items on | Have: a 2×2 matrix and a quiz with scores by place; the answer key stays on the server and follows copies only for editors (#147) | — | P3 | — |
| AI report from activity results | Turn a finished poll or Q&A into a short report with next steps | Have with a configured provider: a report from the visible results of polls, Q&A, the 2×2 matrix and the quiz, never its answer key or anyone's name (#148) | — | P3 | — |
| Presentation mode | Step through frames full screen without the editing chrome | Have | — | P1 | — |
| Presenter handoff | Pass the presenter role to someone else mid-presentation; notes in a separate window | Have: hand off to another presenter, and presenter notes in their own window (#146) | — | P2 | — |
| Audience follows presenter | Viewers' screens follow the presenter, with a banner showing who is presenting | Have | — | P1 | — |
| Laser pointer | A temporary pointer trail everyone sees while presenting | Have (KAI-130) | S | P2 | parity |
| Presenter notes | Private notes for each slide or frame | Have (KAI-130) | S | P3 | parity |
| Facilitator controls | Lock the board for non-facilitators, or restrict tools during a session | Have: facilitator bar to lock the board and limit tools, enforced by the server (KAI-129) | M | P2 | parity |
| Timer music | Optional background music while the timer runs | Have: original music synthesised in the browser, so there are no audio files to license, playing in step with the server clock (#145) | — | P3 | — |
| Icebreaker widgets | Dice, spinners and other playful session helpers | Have: a wheel of names, dice and a random speaking order, all on the server clock so everyone sees the same result (#150) | — | P3 | — |

## 6. Templates

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Template picker | A searchable gallery that inserts an editable layout, also offered when you create a board | Have (grouped by category, ranked search) | — | P0 | — |
| Template breadth | A large library across agile, strategy, research, UX, diagramming, education and meetings | Have: 584 original templates in 18 categories (KAI-100, the third batch in b6eaac2); new ones are data (specs rendered by 13 layout archetypes), so the catalog grows without new code | M | P1 | parity |
| Save as template | Turn a board or selection into your own reusable template | Have | — | P1 | — |
| Team templates | Templates shared across a team or workspace | Have: shared with the workspace, showing who shared them; workspace admins can unshare (KAI-42, KAI-96); organisation-wide company template sets with a choice of who may publish them (#155) | — | P2 | — |
| Community gallery | Publish templates publicly and browse other people's | Have: submit a board to the public gallery under CC BY or CC0; Freero copies only what a stranger may see (no private drafts, hidden frames, comments, names or links to other boards), and nothing is public until an operator approves it; approved templates are on the dashboard, on a board and on the site's indexable /gallery pages, and anyone can report one (#162) | — | P3 | — |
| Guided board setups | Reusable board structures (several boards, docs and tools) with steps and instructions for a whole process | Have: blueprints save a project's boards and docs and start new projects from them in one step, with links between them rewritten to the new copies (#161) | — | P3 | — |

## 7. AI

Miro sells AI on credits per plan and spent most of 2026 on agent-style assistants and repeatable AI
workflows. For Freero, every row here needs a model provider that the operator or workspace configures
(KAI-101, see §16).

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Generate ideas | Make a set of stickies from a prompt | Done with a configured provider: previewed, inserted as one undo step (KAI-102, docs/ai.md) | M | P2 | parity |
| Cluster and sort | Group stickies by theme or sentiment | Done: selected notes move into named groups by theme (KAI-102) or by sentiment (#148); non-AI clustering by colour or tag exists too | — | P2 | — |
| Summarise | Turn a selection or a board into a written summary | Done: a written note beside the selection (KAI-102) | M | P2 | parity |
| Text to diagram | Make a flowchart, mind map or sequence diagram from a description | Done: via Mermaid / outline → layout, connectors attached (KAI-102) | M | P2 | parity |
| Image generation | Make an image from a prompt | Missing | M | P3 | parity |
| Board-aware assistant | A chat assistant that reads the board, answers questions about it and proposes edits | Done with a configured provider: a chat beside the board that reads it with the asker's own access (never others' private drafts), answers with citations that zoom to the items, and proposes changes only as pending suggestions people accept or reject, so text on the board can't make it write anything; conversations are kept per person per board and are in the personal export (#1, docs/ai.md). Outside agents read and write through MCP the same way | — | P3 | — |
| AI workflows | Reusable multi-step AI pipelines run on board content (Miro's Flows, May 2026) | Done with a configured provider: saved workflows, a named instruction run on the whole board or the selection, kept for yourself or shared with a team workspace, whose result is always one group of pending suggestions (#1); a run is one assistant turn, not a chain of steps | — | P3 | — |
| AI slides | Build a presentation from board content automatically | Missing (#1) | L | P3 | parity |
| AI catch-up | A written summary of what changed on a board since your last visit or a chosen date | Done: Catch me up summarises the changes since your last visit or a chosen period (#126) | — | P3 | — |
| AI on meeting and activity results | Summarise an imported meeting transcript in one step; a report from live-activity answers | Done: an imported meeting's Summary box is filled by the board's AI, and live-activity results become a report (#148); AI actions say why when they're unavailable | — | P3 | — |
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
| Diagram import | Bring in Visio, draw.io or Lucid diagrams as editable shapes | Have: draw.io (KAI-138) and `.vsdx` files from Visio or Lucidchart with shapes, masters, connectors glued to shapes, groups, containers and swimlanes as frames, pages as frames, and pictures, behind zip and XML safety limits (#116); PlantUML and Mermaid text and files (#38) | — | P2 | — |
| PowerPoint import | Bring a `.pptx` deck in as slides | Have: `.pptx` files become slides with their formatting, theme colours, pictures, tables, master artwork and notes (#136) | — | P2 | — |
| Import from Miro | Bring a team's Miro boards over with stickies, shapes, connectors and frames | Missing: through the person's own Miro token (#62), after a check of Miro's API terms (§16) | M | P1 | parity |
| Import from other whiteboards | Bring boards over from Mural, FigJam, Lucidspark, Excalidraw and similar tools | Partial: Excalidraw and draw.io (KAI-138, `features/import/lib/drawio.ts`); Mural (#163), FigJam (#164), Lucidspark and Whimsical (#165) not yet | M | P2 | parity |
| Print | Print the board or its frames | Partial: through PDF export only | S | P3 | parity |
| Export from code | Get a board or frame as a picture or PDF through the API, for reports and agents | Have: `POST /boards/{id}/export` and MCP `export_board` draw PNG, SVG or PDF on the server without a headless browser, charts and team stickers included; the downloads policy and the board's copy-and-export setting apply (#33) | — | P2 | — |

## 9. Integrations, developer platform and embeds

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Public REST API | Read and write boards, items and members from code | Have (`/api/v1`, docs/api/; KAI-104) | L | P2 | parity |
| REST API depth | Rename and copy boards, image, file and embed items, groups, webhook and audit endpoints | Have: bulk writes up to 500, kanbans with fields and views, comments, docs with block edits and doc comments, search, trackers; rename, copy and group boards, image and embed items by URL through the SSRF-safe fetcher, embed settings (#170, #61); webhook management (`webhooks:manage`, #48), the audit log (`audit:read`, #17) and server-side export (#33). Video, audio and file items stay app-only by decision: their file must be the person's own checked upload (#49) | — | P2 | — |
| Webhooks | Push board and item events to other systems | Have, ahead of Miro, which removed its experimental webhooks on 2025-12-05 with no replacement: workspace endpoints from the admin console or the API with a project filter (#48), event filters, HMAC-signed, retries and delivery log, formats for Slack, Teams, Discord, Google Chat and Mattermost (KAI-105, docs/events.md) | — | P2 | — |
| API tokens and OAuth apps | Credentials that let third-party apps act for a user | Have (tokens, OAuth 2.1 + PKCE, dynamic registration; KAI-104) | M | P2 | parity |
| Embed a live board | Put a viewable or editable board in other sites (iframe, oEmbed) | Have: a live board inside ChatGPT and Claude through MCP Apps (KAI-171), and on any site through a per-board Embed on other sites switch: view only or click to edit (with an occlusion check), start at a frame, never wider than the board's sharing, a sign-in popup with board-scoped tokens, a visitor cap, oEmbed and discovery, a `boardEmbeds` workspace policy, also in the API and MCP (#2); in-place doc editing under zoom is #60 | — | P1 | — |
| Confluence and Jira embeds | A live board in a Confluence page or a Jira issue | Partial: built as a generated Forge app with a `/Freero board` macro for Confluence pages and a board panel in Jira issues, on top of the public embed (#2), framed only by Atlassian's hosts and only while the board allows embedding; off until the operator registers the Forge app and sets `ATLASSIAN_APP_ID`, and not yet tried on a real Atlassian site (#166, #167, docs/integrations/atlassian.md) | S | P2 | parity |
| In-board app SDK | Third-party apps that run on the canvas and add items or panels | Missing (API and webhooks first, see §16; #179) | XL | P3 | parity |
| App marketplace | Browse and install third-party apps | Partial: Apps & agents (`/apps`, #87) lists every integration with its connect step, plus community integrations built on the API, webhooks or MCP, shown after an operator's review with a Community label (reportable, removable); none runs inside Freero, so there is nothing to install (no in-board apps, see §16) | XL | P3 | parity |
| MCP server | Let AI coding and agent tools read and write boards | Have, and deeper than the tools Miro's MCP page describes: remote MCP server at `/mcp` with OAuth 2.1, about 40 scoped tools (kanban fields and views, diagrams into a diagram container, charts, docs with block edits and comments, board rename, copy, share and embed, server-side export, tracker import and sync, meeting notes), suggestions people accept or reject, an agent control room and a live board in ChatGPT and Claude (KAI-107, KAI-169, KAI-171, #33, #61, #117, #137, #170; docs/mcp.md). Miro now ships MCP on all plans | — | P2 | — |
| Microsoft Copilot app | Make diagrams, stickies and tables on a board from Microsoft 365 Copilot (Miro, April 2026) | Partial: a generated Copilot agent package that reaches the MCP server through OAuth, labelled and audited like any agent; off until the operator registers it with Microsoft, and not yet tried against a real Microsoft 365 tenant (#114, docs/integrations/teams.md) | S | P3 | parity |
| Chat integrations | Board notifications and link previews in Slack or Teams | Partial: channel posts through webhooks in Slack, Teams, Discord, Google Chat and Mattermost formats (KAI-105); an operator-installed Slack app unfurls board links (docs/integrations/slack.md); Teams link previews through a Bot Framework endpoint with verified tokens, off until registered and not yet tried in a real tenant (#113); personal messages are their own row in §4 (#105, #113) | S | P2 | parity |
| Work-tracker sync | Two-way sync between cards or table rows and Jira, Asana, Azure DevOps, monday.com, ClickUp or Trello items | Partial: two-way sync of stickies, cards and kanban cards with Jira (Cloud and Data Center), Linear, GitHub issues, Azure DevOps (#6), Asana (#120), monday.com (#121), ClickUp (#180) and Trello (#181), live badges, issue import and roadmap timelines with quarter lanes (KAI-153–KAI-157, KAI-160; docs/trackers.md); a sprint, cycle or iteration field synced both ways with import by sprint or epic (#119), a per-connection field map, epic per cluster and tracker data in exports (#43); GitHub Projects status, estimate, iteration and dates, milestones, assignees and sub-issues (#42); timeline dependencies sent as "blocks" links to Jira, Linear, GitHub and ClickUp behind a per-connection switch (#50); kanban Table, List, Calendar and Timeline tabs and linked views show the synced cards. Asana, monday.com, ClickUp and Trello work with personal tokens, and their OAuth apps (a Power-Up key for Trello) are off until the operator registers them; these four, and the Jira, Linear and GitHub paths, haven't been tried against a real account (#43, #120, #121, #180, #181). Left in code: a GitHub App with installation tokens (#42), dependencies for Asana, monday.com, Trello and Azure DevOps, and syncing the plain table's rows (#51). Miro's Tables sync with Asana, monday.com, ClickUp and Trello; Freero's sync is free | M | P2 | parity |
| Azure DevOps Boards | Two-way sync between cards and Azure work items | Have: Azure DevOps Services and Server, revision-checked writes, iterations as the sprint field (#6) | — | P2 | — |
| Cloud file pickers | Insert files from Google Drive, OneDrive or Dropbox | Missing | M | P3 | parity |
| Meeting-app integrations | Open a board inside Zoom, Teams or Meet calls | Partial: all three are built on the public embed, framed only by each host's origins and only while the board allows embedding: a Teams tab, meeting side panel and share to stage from a generated app package, without Teams single sign-on (#112); a Zoom app with Invite everyone (#168); a Google Meet add-on with a side panel and a shared stage (#169). Each is off until the operator registers it (the Teams package, `ZOOM_CLIENT_ID`, `GOOGLE_MEET_CLOUD_PROJECT_NUMBER`), and none has been tried in a real tenant, Zoom client or Meet call (docs/integrations/teams.md, zoom.md, google-meet.md) | S | P2 | parity |
| Automation directories | Listed apps in Zapier, Make and Power Automate | Partial: a Zapier app and a Make app with triggers and actions, and a certification-ready Power Automate connector with a webhook trigger, next to the recipes for Zapier, Make and n8n (docs/integrations/); until the owner publishes the Zapier and Make apps and Microsoft certifies the connector, they work only for people invited to them or who import the connector, and none has had a live run against the real service (#173, #174, #175) | S | P3 | parity |
| Figma depth | Pick Figma frames after signing in and place them as images; a plugin that sends frames to a board | Partial: Place from Figma (each person connects their own Figma account, picks frames, and they land as pictures through the upload checks and refresh in place) and a Figma plugin that sends selected frames to a board and updates them when sent again, next to live Figma embeds; off until the operator registers a Figma OAuth app (`FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`) and Figma approves it for use outside the owner's team, the plugin isn't published in the Figma Community yet, and both were built against a stand-in of Figma's API, so they need a check with a real Figma account (#171, #172, docs/integrations/figma.md) | S | P3 | parity |

## 10. Apps and platforms

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Desktop browsers | Full editing in current Chrome, Edge, Firefox and Safari | Have | — | P0 | — |
| Tablet and stylus | Touch-friendly editing with pen input | Have: pinch zoom, long-press context menu, bigger handles and controls on touch, palm rejection while a pen is down, "pen draws, finger pans" (KAI-139) | M | P2 | parity |
| Phone web | Usable view-and-comment experience on a small screen | Have: a view-and-comment phone layout — bottom bar with select, hand and comment, comments as a bottom sheet, the full toolbar behind "Edit board" (KAI-139) | M | P2 | parity |
| Installable app (PWA) | Install from the browser with an icon, a window and file handling | Have: installs with its own icons and window, an app-shell service worker and offline page (KAI-140); opens `.freero` backups and takes images and links from the system share sheet (KAI-218) | S | P2 | parity |
| Native mobile apps | iOS and Android apps | Partial: a Capacitor shell for iOS / iPadOS and Android around the server's own web app, with `freero://` and https links that open boards, docs and comments, and push notifications through APNs and FCM tied to the device's session, chosen per device; CI makes debug and unsigned builds. Not in the stores until the owner has Apple Developer Program and Google Play Console accounts, signing keys, an APNs key and a Firebase project and passes both reviews, and push hasn't run on real devices (#177, docs/mobile.md) | S | P3 | parity |
| Native desktop apps | Windows and macOS apps | Partial: a Tauri shell for Windows and macOS (installers of a few MB) around the server's own web app, with `freero://` links, native menus and notifications and a choice of server; CI builds unsigned installers, which SmartScreen and Gatekeeper warn about, until the owner adds an Apple Developer ID with notarisation, a Windows code-signing certificate and an updater key (#176, docs/desktop.md) | S | P3 | parity |
| Offline work | Edit without a connection and sync later | Have, ahead of Miro, which has no offline mode: boards kept on the device, sealed in IndexedDB, open and take edits without a connection and sync on reconnect; copies are wiped on sign-out, lost access or a workspace's `offlineCopies` policy (off for workspaces with their own key unless they allow it), and private drafts and hidden frames are kept only for people who may see them (#178) | — | P3 | — |

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
| Admin trash and archive | Admins see and restore everyone's deleted boards; finished boards can be archived | Have: a workspace trash for content admins next to each owner's own, with retention of 1–365 days, and an archive state for finished boards (#153) | — | P2 | — |
| Board roles | Owner, editor, commenter and viewer per board | Have, plus co-owner (below) | — | P0 | — |
| Co-owner | A second owner-level role that manages sharing, the link and backups without ownership passing | Have: co-owners manage sharing, may set the protected lock and are told of access requests (#122) | — | P2 | — |
| Per-board sharing settings | The owner stops editors from sharing, or viewers and commenters from copying and exporting | Have: per board, whether editors can share and whether viewers and commenters can copy and export, on top of the workspace's downloads policy (#123) | — | P2 | — |
| Invite existing users | Add people by email with a role | Have | — | P0 | — |
| Invite people without an account | Email invite → sign up → land on the board | Have | — | P0 | — |
| Share by link | Anyone with the link gets a chosen role | Have (signed-in people, or guests without an account where allowed) | — | P0 | — |
| Anonymous visitors | Open a shared link without an account, with a guest name | Have: named guests on a shared link, one board each, at most commenter; a workspace can require sign-in (KAI-43). Guests now vote, estimate and write private drafts, server-enforced and own entries only (#96), but still can't add stickies: owner-allowed guest editing with abuse controls is #97 | M | P1 | 3 |
| Request access | Ask the owner for access from a locked board | Have: the owner or workspace admins approve or decline from the inbox or the share dialog (KAI-40) | S | P2 | 3 |
| Transfer ownership | Hand a board to someone else | Have: boards and team workspaces (KAI-41) | S | P2 | 3 |
| Link password or expiry | Protect public links | Have: a password and an expiry date on a board's link, for members and guests (KAI-145); a workspace link policy can require a password and a maximum lifetime, with a list of boards that don't comply (#39) | — | P3 | — |
| Workspaces and teams | Shared spaces with members and team-wide boards | Have: personal and team workspaces, every query scoped by membership; team access level per workspace or project (KAI-37, KAI-93); an organisation can sit above them (below) | L | P1 | 3 |
| Organisation above workspaces | One organisation over many teams, with SSO, SCIM, domains, policies and audit set up once | Have: one organisation with org-level SSO, SCIM, domains, SIEM and a merged audit log; its policies are floors that attached workspaces can only tighten; an org console, attach and detach, org-wide deactivation (#108) | — | P2 | — |
| Move boards between workspaces | Move a board into another workspace, or duplicate it there | Have: move a board into another workspace, or choose where a duplicate goes (#124) | — | P2 | — |
| Projects / folders | Group boards inside a workspace | Have: projects (KAI-39) nest up to three levels, where access can only narrow on the way down, with a landing page per project and pinned projects (#129); blueprints start a project from a saved one (§6, #161) | — | P1 | — |
| Team roles | Workspace owner, admin, member and guest | Have (KAI-38) | M | P2 | 3 |
| Sharing policies | Rules for who may share, export or invite guests | Have: outside sharing, link sharing and guest links, guest invites, downloads and exports, team access level, live embeds (KAI-42) | M | P2 | 3 |
| User groups | Named groups of people to share boards with | Have: directory (SCIM) groups grant a workspace role or a project's membership (KAI-46); groups made in Freero, and boards or projects shared with a group (#63) | — | P3 | — |
| Per-user time zone | Reminders and email dates follow each person's own time zone | Have: a time zone per person for due reminders and dates in emails (#106) | — | P2 | — |

## 12. Admin, security and compliance

| Capability | What it does | Freero status | Size | Priority | Phase |
|---|---|---|---|---|---|
| Transport and app hardening | TLS, security headers, rate limits, upload quotas | Have (CSP and HSTS, per-route rate limits, upload and board quotas, TLS through the Caddy deploy config) | — | P1 | — |
| Backups and disaster recovery | Operator backups and restores of the database and files | Have (`scripts/backup.sh`, restore runbook in `docs/operations.md`, bucket versioning for files) | — | P1 | — |
| Horizontal realtime scale | Many app instances share board updates | Have (Redis fan-out, append-only update log with snapshots) | — | P1 | — |
| Encryption at rest | Stored data encrypted | Have: S3 server-side encryption (`S3_SSE`), encrypted database backups, every stored credential sealed or hashed by the app, a documented baseline for database storage encryption (KAI-143) | S | P2 | 1 |
| SSO | SAML 2.0 / OIDC per workspace, verified domains, enforced SSO | Have: SAML 2.0 and OIDC per workspace, DNS-verified domains, just-in-time membership, Enforce SSO with a break-glass owner (KAI-45); IdP-initiated sign-in, single logout and encrypted assertions (next rows) and org-wide SSO (#108) | L | P2 | 4 |
| IdP-initiated SSO | Open Freero from the identity provider's app tile and land signed in | Have: behind a per-workspace switch, with signed InResponseTo, a Destination check, an assertion replay cache and same-origin RelayState (#107) | — | P2 | — |
| SAML single logout and encrypted assertions | Signing out at the identity provider ends the Freero session too (and the reverse); assertions encrypted to Freero's key; signed sign-in requests | Have: per-workspace (or organisation) service-provider key pairs with rotation, published in Freero's own metadata; encrypted assertions, optionally required; signed AuthnRequests; single logout started from either side over Redirect and POST, with signature, Destination, age and replay checks; the private key is sealed at rest and never in an answer (#13). Checked against a stand-in IdP with real signatures and XML Encryption; no SOAP back channel, like most SaaS providers | — | P2 | — |
| SCIM provisioning | Create and remove users automatically from the identity provider | Have: SCIM 2.0 users and groups per workspace, rotatable tokens, groups map to roles or projects, deprovisioning deactivates (KAI-46) | L | P3 | 4 |
| Admin console | Manage members, roles, security settings and usage | Have: members with two-step status and deactivation, security and retention settings, sharing policies, single sign-on and provisioning, issue trackers, usage, audit log (KAI-47) | L | P2 | 4 |
| Granular admin roles | Separate admins for members, content and security | Have: admin roles by area (members, content, security) next to owner and full admin (#151) | — | P2 | — |
| Admin content inventory | Every board in the workspace with owner, sharing and last activity, re-shared from the console (Miro's Content Explorer, in beta) | Have: a board inventory with owner, sharing and last activity, and re-sharing from the console (#152) | — | P2 | — |
| Audit log | Record of security-relevant events, with export and SIEM streaming | Have: append-only, hash-chained per workspace, filters, CSV/JSON export, integrity check (KAI-48); streaming to Splunk HEC, Sentinel, signed HTTPS or syslog over TLS with signed chain-head anchors kept outside the database, and in REST API v1 (`audit:read`) (#17); an organisation merges its workspaces' logs (#108) | — | P2 | — |
| Data export and erasure | Per-user and org export and deletion (GDPR) | Have: personal data export, workspace export for admins, self-service account deletion with purge, workspace deletion (KAI-50) | M | P2 | 4 |
| Retention policies | Delete or archive content automatically after a set time | Have: per-workspace trash, version-history and audit-log retention (KAI-51); rules that archive or delete boards inactive for a set time, warning owners first; legal holds override every one of them (#154, #157) | — | P3 | — |
| Session policies | Idle timeouts and session length rules | Have: per-workspace session lifetime and idle timeout, strictest wins across a person's teams (KAI-51) | S | P3 | 4 |
| Domain control | Claim a domain, capture accounts, block personal sign-ups | Have: a workspace claims and DNS-verifies domains, and Enforce SSO sends every sign-in at them through its identity provider (KAI-45); without SSO it captures verified accounts with notice, adds new sign-ups and blocks other team workspaces on the domain; an operator can make sign-up invite-only (#64) | — | P2 | — |
| Admin usage analytics | Activity and adoption reports | Have: boards, members by role, people active in the last 7 and 30 days and storage (KAI-47); 90-day trends of active people, boards created and guests, with CSV export (#65) | — | P3 | — |
| IP allowlisting | Allow access to a workspace only from listed networks | Have: per-workspace allowlists applied to the web app, board sockets and the API (#156) | — | P3 | — |
| eDiscovery and legal hold | Keep and export a person's board history for legal cases | Have: legal holds per person or per case, enforced in the database on every purge path (trash, retention, version and audit pruning, account and workspace deletion, destroying a workspace key) and failing closed; a case export with a manifest of hashes; managed in the admin console's Legal holds tab (#157, [docs/design/compliance.md](design/compliance.md)). The organisation console has no tab of its own yet; organisations manage cases through the API | — | P3 | — |
| Classification labels | Mark boards Public, Internal, Confidential and so on, with sharing rules tied to the label | Have: workspace (and organisation) labels whose caps on links, guests, exports, embeds and API or MCP sharing apply wherever a board is reached and can't be shed by copying or moving it; required and default labels; the label shows beside the board's title, on dashboard cards and in the share dialog (#158) | — | P3 | — |
| Data classification / DLP | Scan boards for personal or payment data and apply rules | Have: an opt-in scan per workspace of what every reader of a board sees, for payment card numbers, IBANs, US SSNs, UK NI numbers and leaked credentials (emails and phone numbers optional), which notifies the workspace's admins, suggests a label or requires one; it stores where and what kind, never the matched text, and nothing leaves the instance (#158). Organisations can't run it for all their workspaces, and findings are listed in the console only | — | P3 | — |
| Customer-managed keys | Encrypt an org's data with keys the org controls | Partial: built and off by default: with `WORKSPACE_KEYS` on, a team workspace's security admins turn on a key, and its board content and the files uploaded to its boards are stored sealed under data keys wrapped by the instance's key or the workspace's own key in AWS KMS, Google Cloud KMS, Azure Key Vault or Vault Transit; rotation, suspension and destruction close boards at once, even with a cached data key (#159). The four key services have been tested only against stand-ins and AWS's published test vectors, so each needs a check with a real customer key; files uploaded without a board (avatars, sticker images) stay under storage encryption only, and organisations can't hold one key for all their workspaces | S | P3 | parity |
| Data residency | Choose the region where data is stored | Missing on the hosted service (#160); self-hosting picks any region | XL | P3 | parity |
| Compliance certifications | Independent audits (SOC 2, ISO 27001) and the paperwork that goes with them | Partial: the paperwork is published for freero.app: /security, /subprocessors and /dpa (GDPR Art. 28 with the 2021 SCCs and UK Addendum), approved by the operator, plus SECURITY.md and a security questionnaire (#109); no independent attestation yet (#110); self-hosting runs under the customer's own certifications | XL | P2 | parity |
| Abuse reporting and moderation | Report and take down harmful public boards | Have: report a board, item, file, comment or community gallery template (also without an account); operator queue, gallery review (#162), link block / take-down / file removal / suspension, appeals, legal hold (KAI-142, KAI-178, KAI-181) | M | P2 | 1 |

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
import and layers, meeting apps, domain control, certifications). In the update at 10fb4ee the same
day, 48 rows moved to Have (20 from Partial, 28 from Missing), 3 Missing rows became Partial
because what shipped still waits on the operator's Microsoft registrations and a real-tenant check
(Copilot app, meeting apps) or on an independent audit (certifications), and 2 rows were added for
shipped work that had none (PowerPoint import, export from code). In the update at 6e7bba8,
11 rows moved to Have (8 from Missing: custom shape packs, timer music, community gallery, guided
board setups, board assistant, AI workflows, eDiscovery, DLP; 3 from Partial: comment filters and
anchors, notifications, offline work); 6 Missing rows became Partial, five because what shipped
waits on the owner (Confluence and Jira on an Atlassian registration, the desktop and phone apps on
signing and store accounts, customer-managed keys on a check with real key services, interface
languages on a translation review, with some English still to move) and one because it's answered
in part (engineering symbols through uploaded shape packs); and 4 rows were added: two split out of
rows that mixed shipped and unshipped work (accessibility review and conformance report, personal
Slack and Teams messages) and two for shipped work that had none (classification labels, SAML
single logout and encrypted assertions). Several rows that stay Partial now wait only on the owner
(GIF search, automation directories, Figma, and the meeting apps but for Teams sign-on).

**By status**

| Status | Count |
|---|---|
| Have | 220 |
| Partial | 23 |
| Missing | 11 |
| **Total** | **254** |

**By priority and status**

| Priority | Have | Partial | Missing | Total |
|---|---|---|---|---|
| P0 | 31 | 0 | 0 | 31 |
| P1 | 56 | 3 | 1 | 60 |
| P2 | 104 | 11 | 0 | 115 |
| P3 | 29 | 9 | 10 | 48 |

<!-- counts generated from the tables above; regenerate when rows change -->

**Takeaways**

- Every P0 row is Have, and 220 of 254 rows in all; no P2 row is Missing. What's left at P1 is
  four rows, three of them built: interface languages (#5; ten languages live, the machine
  translations unreviewed and some server text still English), GIF search (#139; off until the
  operator gets a provider key), personal Slack messages (#105; off until the operator updates the
  Slack app) next to personal Teams messages, which aren't built (#113), and Miro import (#62),
  which waits on a check of Miro's API terms. Link guests vote, estimate and draft (#96) but still
  can't add stickies (#97).
- The first-hour gaps a switcher noticed (sticky shapes and dark colours, fonts, Miro-style
  shortcuts, dark mode) have shipped, and large-board performance is measured rather than assumed:
  a 10,000-item board loads in about 0.6 s and pans at zoom to fit in 7.6 ms a frame (p95 17 ms)
  with 17 MB of JS heap after load ([performance.md](performance.md)).
- Most of the 23 Partial rows wait on the owner rather than on code. Built and off until the
  operator registers them with each vendor: the Teams app, Teams bot and Copilot agent
  (#112–#114), the Confluence and Jira Forge app (#166, #167), the Zoom app and Meet add-on (#168,
  #169), the Zapier, Make and Power Automate listings (#173–#175), Place from Figma and the Figma
  plugin (#171, #172), personal Slack (#105), GIF search (#139), and the Asana, monday.com,
  ClickUp and Trello OAuth apps (#120, #121, #180, #181). The desktop and phone apps need signing
  certificates and store accounts (#176, #177), workspace keys a check against real key services
  (#159), the conformance report a screen-reader pass and an audit (#141), and SOC 2 or ISO 27001
  a funded auditor (#110). §15 ends with the full list.
- Enterprise controls that Miro sells at its top tier or as paid add-ons are free: an organisation
  layer, domain capture, SIEM streaming with anchored chain heads, admin roles by area, board
  inventory, retention rules, IP allowlists, usage trends, legal holds with case export,
  classification labels, the sensitive-data scan, SAML single logout and encrypted assertions, and
  per-workspace keys in four key services. Hosted data residency (#160) is still missing and is
  answered by self-hosting.
- Freero is ahead of Miro on: webhooks, managed through the API too (Miro removed its own); MCP
  depth (about 40 scoped tools, suggestions, a control room) and a board assistant that can only
  propose; free two-way tracker sync with Jira, Linear, GitHub, Azure DevOps, Asana, monday.com,
  ClickUp and Trello, sprint field and dependencies included; server-sealed facilitation (votes,
  drafts, activity answers and quiz keys stay on the server until revealed, icebreakers and timer
  music on the server clock); free enterprise controls (above); offline copies and dark mode,
  which Miro lacks; published, reproducible large-board
  numbers; server-side export without a headless browser; free version history; phone-browser
  editing; and self-hosting. Line jumps and smart drawing match Miro's and add to them: jumps
  appear in exports, and the pen recogniser runs without AI, with scribble to erase and hold to
  straighten.

## 15. Recommended build order (web parity work)

The 2026-10-27 batches (arrange, find, shortcuts, item links, crop, kanban, shape and icon libraries,
tables, link previews, PDF, the collaboration loop, save as template, version history and trash) have
all shipped. The batches below cover what's left at P1 and P2, plus the P3 items worth doing because
they're cheap or strategic. Each follows the Dune layout: a new `apps/web/src/features/<name>/` folder
made with `npm run new:feature`, a server module per area, and engine changes only when a capability
cuts across types. Batches A–D are independent and can run in parallel; E and F follow the teams merge.

Status: the teams merge and batches A–F have shipped, #4 (custom packs), #5 (interface languages)
and #1 (assistant) among them by 6e7bba8; #3 (smart drawing) and #2 (embeds in other sites) shipped
on 2026-11-03. Follow-ups are filed as their own issues (named in the rows). The batch lists below
keep their Linear ids as a record of what shipped.

**The 2026-11-03 ranking, and where it stands at 6e7bba8.** The re-check ranked the remaining gaps
by who hits them, how soon, whether they block a buyer or a migration, and cost. The top fifteen
carry `priority: high` in GitHub Issues. Eight are done; four are done but for owner steps (6, 9,
10, 14); two are partly done (1, 12); one is open (3):

1. Partly done. Commenters and link guests take part in votes, estimates and private drafts
   (#96, done); optional guest editing (#97) is open.
2. Done. A public live embed and oEmbed (#2).
3. Open. Miro import (#62), after the owner's check of Miro's API terms.
4. Done. First-hour polish: sticky shapes, sizes and dark colours (#98), fonts (#99), Miro-style
   shortcut aliases (#100), dark mode (#101).
5. Done. Voting depth: anonymous ballots, up to 99 votes, per-item cap, timer, past results (#102).
6. Done except owner steps. Since your last visit (#103), the board-change digest and comment
   alerts (#104) and per-user time zone (#106) shipped; personal Slack messages (#105) are built
   and off until the operator updates its Slack app and sets its client id and secret.
7. Done. Enterprise identity: domain capture (#64), IdP-initiated SAML (#107), SIEM streaming (#17).
8. Done. An organisation above team workspaces (#108).
9. Done except the audit. Security overview, subprocessor list and DPA are published (#109); SOC 2
   or ISO 27001 (#110) needs the owner to fund an auditor.
10. Done except the review. Ten interface languages with right-to-left chrome (#5); the machine
    translations wait for a person's review, some server text is still English, and the site's
    translated pages (#77) are open.
11. Done. Pen tools: smart drawing (#3) and lasso (#111).
12. Partly done. Teams app (#112), Teams bot (#113) and Copilot app (#114) ship off until
    configured; they need the operator's Microsoft registrations and a check in a real tenant, and
    personal Teams messages and Teams sign-on aren't built.
13. Done. Line jumps (#115), Mermaid class/ER/state and PlantUML (#38), `.vsdx` import (#116), a
    diagram container (#117) with layers (#118), and workspace and personal shape packs (#4).
14. Done except owner steps. Sprint field (#119), custom-field map (#43), Azure DevOps (#6); Asana
    (#120) and monday.com (#121) work with personal tokens and need the operator's OAuth app
    registrations and a real-account check, as do the Jira, Linear and GitHub paths (#43).
15. Done. Sharing depth: co-owner (#122), per-board sharing settings (#123), admin-required link
    password and expiry (#39), moves between workspaces (#124).

Also shipped on 2026-11-03 outside the fifteen, by 10fb4ee: flip cards (#142), sticky pads (#132),
live reactions (#144), QR join (#40), 2×2 and quiz (#147), icebreakers (#150), presenter handoff
(#146), AI catch-up (#126), sentiment clustering and activity reports (#148), mind map AI (#134),
walkthrough summaries (#127), charts (#137), stickers (#138), value-stream and data-flow sets
(#133), slides depth and PowerPoint import (#52, #135, #136), the activity feed's jump to a change
(#125), protected lock (#140), admin roles, trash and archive, retention, inventory, user groups,
company templates, usage trends and IP allowlists (#151–#156, #63, #65), API breadth (#170, #48,
#49, #61, #33) and the large-board work (#130, #131). Between 10fb4ee and 6e7bba8: the board
assistant and saved AI workflows (#1), nested projects, area comments with files and blueprints
(#129, #143, #161), table views (#51), the large-board follow-ups (#182–#185), legal holds (#157),
classification labels and the sensitive-data scan (#158), workspace keys for content and files
with four key services (#159), SAML single logout and encrypted assertions (#13), the community
gallery (#162), offline copies (#178), ClickUp, Trello and GitHub Projects sync with dependencies
(#180, #181, #42, #50), timer music (#145), group walkthroughs (#128), the accessibility review
(#141), and, off until the owner registers them, GIF search (#139), personal Slack (#105), the
Confluence, Jira, Zoom, Meet, Zapier, Make and Power Automate apps (#166–#169, #173–#175), the
Figma picker and plugin (#171, #172) and the desktop and phone shells (#176, #177).

**Next.** Ranked the same way among what's left in code:

1. Guest editing on owner-chosen boards, with abuse controls (#97): the last piece of the
   outside-workshop gap.
2. Miro import through the person's own token (#62), once the owner has checked the API terms: the
   migration path.
3. Personal Teams messages (#113) and Teams single sign-on (#112), so Teams matches Slack.
4. The English that's left in the interface: server emails and activity summaries, uncoded
   errors, sentences assembled from English words (docs/design/i18n.md), then the site's
   translated pages (#77).
5. Imports from Mural (#163), FigJam (#164), Lucidspark and Whimsical (#165).
6. Data tables: rows pinned as synced cards and several filter conditions (#51); a GitHub App with
   installation tokens (#42); dependencies for the trackers that lack them.
7. AI decks and re-planning a proposal that failed (#1); semantic search (#47).
8. Walkthrough screen capture and captions in search (#69), and board items a screen reader's
   browse mode can reach (#29).
9. Optional in-board audio and video on an operator's Jitsi or LiveKit (#149).
10. The in-board app SDK (#179), and hosted data residency (#160) if the owner decides to run a
    second region.

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
keys, data residency and certifications. Of these, icebreakers, custom sticker sets, charts and
diagram layers shipped the same day; by 6e7bba8 timer music, offline editing, the community
gallery, guided board setups, eDiscovery and DLP have shipped too, and the native apps, the
meeting apps and customer-managed keys are built and wait on the owner (below). Still open: the
in-board app SDK, data residency and certifications. Still not filed, on purpose: office document
previews, interactive prototypes, image generation, screenshot to prototype, capture of paper
stickies, the installable app marketplace (it needs the SDK first) and cloud file pickers. Revisit
paper capture after the AI foundation.

**What only the owner can do now.** None of this is code: each item is a choice, or a step outside
the repo that turns on or proves something already built. Each issue (and the doc it names) has the
exact steps.

- **Decisions**
  - Whether Miro's developer terms allow an importer that uses each person's own token, before
    #62 is built (§16).
  - Funding a SOC 2 Type II or ISO 27001 auditor for freero.app (#110).
  - Whether freero.app runs a second region for data residency (#160).
  - Which features to turn on for freero.app once their vendor steps are done: workspace keys
    (`WORKSPACE_KEYS`, #159), GIF search and its provider, GIPHY or Tenor (#139).
  - Whether to bundle any cloud provider's icon set, after reading its terms; until then teams
    upload their own as shape packs (#4).
  - Approving the draft accessibility conformance report so /accessibility can be indexed (#141).
- **Registrations** (developer accounts, app registrations, keys and store reviews)
  - Microsoft: the Teams app, the Teams bot and the Copilot agent in the Teams Developer Portal
    (`TEAMS_APP_ID`, `TEAMS_BOT_ID`, `COPILOT_APP_ID`, `COPILOT_OAUTH_REFERENCE_ID`;
    #112–#114, docs/integrations/teams.md), and certifying the Power Automate connector (#175).
  - Slack: the new scopes on the operator's Slack app and `SLACK_CLIENT_ID` /
    `SLACK_CLIENT_SECRET` (#105, docs/integrations/slack.md).
  - Atlassian: the Forge app for Confluence and Jira (`ATLASSIAN_APP_ID`, #166, #167).
  - Zoom: the Zoom App and its Marketplace review (`ZOOM_CLIENT_ID`, #168).
  - Google: the Meet add-on's Cloud project and Workspace Marketplace listing
    (`GOOGLE_MEET_CLOUD_PROJECT_NUMBER`, #169), and a Firebase project for Android push (#177).
  - Zapier and Make: publishing the two apps (#173, #174).
  - Figma: the OAuth app and Figma's approval of it (`FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET`,
    #171), and publishing the plugin in the Figma Community (#172).
  - Trackers: OAuth apps for Asana, monday.com and ClickUp and a Trello Power-Up key
    (`TRACKER_ASANA_CLIENT_ID`, `TRACKER_MONDAY_CLIENT_ID`, `TRACKER_CLICKUP_CLIENT_ID`,
    `TRACKER_TRELLO_KEY`; #120, #121, #180, #181).
  - GIF search: a GIPHY or Tenor API key (`GIF_PROVIDER`, `GIF_API_KEY`; #139).
  - Desktop: an Apple Developer ID with notarisation, a Windows code-signing certificate and an
    updater key (#176, docs/desktop.md).
  - Phone and tablet: Apple Developer Program and Google Play Console accounts, signing keys, an
    APNs key and both stores' reviews (#177, docs/mobile.md).
- **Real-account checks** (once registered; each was built against stand-ins)
  - Teams, the Teams bot and Copilot in a real Microsoft 365 tenant (#112–#114).
  - Slack messages and `/freero` in a real Slack workspace (#105).
  - Confluence and Jira on a real Atlassian site, the Zoom app in a Zoom client, the add-on in a
    Meet call (#166–#169).
  - Live runs of the Zapier, Make and Power Automate apps (#173–#175).
  - Place from Figma and the plugin with a real Figma account (#171, #172).
  - Two-way sync against real Jira, Linear, GitHub, Asana, monday.com, ClickUp and Trello accounts
    (#43, #120, #121, #180, #181).
  - Workspace keys against real AWS KMS, Google Cloud KMS, Azure Key Vault and Vault Transit keys
    (#159).
  - Push notifications and deep links on real iPhones, iPads and Android devices (#177), and the
    signed desktop installers on Windows and macOS (#176).
- **Audits**
  - SOC 2 Type II or ISO 27001 for freero.app (#110).
  - An independent accessibility audit, with passes in NVDA, JAWS, VoiceOver and TalkBack and with
    speech input, before the conformance report says more than "self-assessment" (#141).
- **Translation review**
  - A fluent reader for each of the nine non-English languages (German, French, Spanish,
    Portuguese (Brazil), Japanese, Korean, Simplified Chinese, Arabic, Hebrew) to check the machine
    translations, removing each checked key from its catalogue's `"@@unreviewed"` list;
    `npm run i18n:status` shows what's left, and Arabic and Hebrew also need a right-to-left check
    of the mirrored chrome (#5, docs/design/i18n.md).

## 16. Unrealistic for a free product, or needs third-party agreements

| Item | Why it's hard | Pragmatic alternative |
|---|---|---|
| Official integrations with Jira, Asana, Azure DevOps, Slack, Teams, Zoom | Marketplace listings, partner reviews and OAuth app approval with each vendor, plus upkeep as their APIs change | Public REST API, webhooks with Slack/Teams-ready payloads and generic embeds (KAI-104, KAI-105, KAI-127); issue sync with Jira, Linear, GitHub, Azure DevOps, Asana, monday.com, ClickUp and Trello through each user's or team's own credentials, no marketplace listing needed (KAI-153–KAI-157, #6, #120, #121, #180, #181); documented recipes for no-code automation tools. Freero ships operator-installed vendor apps, all off until configured: a Slack app with personal messages (per-instance manifest, `docs/integrations/slack.md`, #105), generated Teams and Copilot packages (`docs/integrations/teams.md`, #112–#114), a generated Forge app for Confluence and Jira (#166, #167), a Zoom app and a Meet add-on (#168, #169), Zapier and Make apps and a Power Automate connector (#173–#175), and a Figma app and plugin (#171, #172). Registering them, and listing them in each vendor's store, still needs the owner's developer accounts and reviews (§15's last list, and each issue) |
| In-board app SDK and app marketplace | A security review process and sandboxing for third-party code on everyone's boards | Start with API, webhooks and an MCP server (KAI-107); maybe a sandboxed iframe app model later (#179) |
| Built-in audio/video calls | TURN/SFU servers cost money per minute at scale | A per-board call link to Jitsi or the team's meeting tool (KAI-134); optionally a self-hosted Jitsi or LiveKit when the operator provides one (#149) |
| AI features at Miro's level | Model inference costs money per request; a free tier is open to abuse | Bring your own API key per workspace, or an operator-configured endpoint, including self-hosted open models (KAI-101). AI stays off unless configured. Strict rate limits |
| Cloud provider icon sets (AWS, Azure, GCP) | Each provider has its own usage terms for its icons; we can't redistribute them as Freero assets without checking those terms | Generic, original infrastructure icons and workspace and personal SVG shape packs that users upload themselves, sanitised on the way in (both shipped; #4) |
| Data residency in several regions | One deployment per region, plus routing and operations staff | Freero is open and Docker-based: organisations that need a region self-host there. The hosted service states its single region |
| Customer-managed keys, DLP scanning, eDiscovery and legal hold | Need KMS integrations, content scanning pipelines and legal processes | Built after all, without SDKs or outside scanners: legal holds with case export (#157), labels and an on-instance sensitive-data scan (#158), and per-workspace keys in AWS KMS, Google Cloud KMS, Azure Key Vault or Vault Transit (#159), next to storage encryption (KAI-143), the audit log and data export. The key services still need checks against real customer keys; self-hosting stays the path for organisations that want everything in their own estate |
| SOC 2 / ISO 27001 / HIPAA certification | Expensive yearly audits by outside firms | The security overview, subprocessor list, DPA and responsible disclosure policy are published, next to the hash-chained audit log with SIEM streaming (#109, #17); self-hosting as the compliance path; an attestation for the hosted service once the owner funds an auditor (#110) |
| Native mobile and desktop apps | Separate codebases, store fees and reviews | A PWA plus touch-optimised web chrome (KAI-140, KAI-139), and thin Tauri (desktop) and Capacitor (phone and tablet) shells that load the server's own web app, so there is no second codebase (#176, #177); signing and store listings need the owner's developer accounts, certificates and fees |
| Importing Miro's own board files | The backup format is proprietary; use of Miro's API is under Miro's terms | Import from open formats (CSV, draw.io XML, Excalidraw JSON, Visio `.vsdx`, PowerPoint `.pptx`, Mermaid and PlantUML; KAI-136, KAI-138, #116, #136, #38). A Miro import through the user's own API token, after checking the terms (#62) |
| Community template marketplace and moderation | Moderation work and legal exposure for user uploads | Shared team templates first (Phase 3), then a public gallery built on abuse reporting (KAI-142): submissions are stripped copies, operators approve each one before it's public, listings are CC BY or CC0 and can be reported (#162) |
