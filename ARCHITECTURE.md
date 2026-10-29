# Freero — architecture

Freero is an original real-time collaborative whiteboard: infinite canvas, sticky notes, shapes,
text, connectors, pen, frames, images, cards, mind maps, comments, voting, timer, templates,
presentation mode, export. The layout is familiar for whiteboard users (left vertical toolbar, top
bar with board name + share, zoom controls bottom-right), but **all branding, colors, icons and copy
are Freero's own. Never copy assets, icons, illustrations, text or code from Miro or any other
product.** Icons come from `lucide-react`.

## The Dune method

This repo follows the Dune method (github.com/Dahhrk/dark-factory/blob/main/docs/dune-method.md).
Contributors — human or agent — usually see a narrow slice of the code, so the repo is shaped so the
**locally obvious change is the globally correct change**:

1. **The conventional path takes fewer decisions than a shortcut.** `npm run new:feature` scaffolds
   a feature; features are discovered automatically.
2. **Forbidden dependencies fail mechanically.** `npm run check:dune` (in `npm run check`) fails
   with an error naming the supported path. Docs are not the enforcement.
3. **Every durable value has one obvious writer** (see "Single writers").
4. **New work adds isolated files**, not branches in shared roots. No central registries: features
   are found through reserved file names, server modules through reserved files too.
5. **Exceptions are narrow, explicit and reviewed** — `dune.exceptions.json`, each with a reason.
   If the same review comment appears twice, encode it as a check, type, test or directory.

## Stack

- npm workspaces. Node 22, no native deps. `npm run dev` starts both apps (no Docker needed).
- `packages/shared` — pure types/constants shared by client + server (no imports). Element model
  (`elements.ts`), Yjs doc layout + presence (`ydoc.ts`), REST/WS contract (`api.ts`).
- `apps/server` — Express 4 + `ws` + Yjs (y-protocols), PostgreSQL, run with `tsx`. Port 4000.
  Database: `pg` against `DATABASE_URL`; without it PGlite (Postgres in WASM, in-process) under
  `<FREERO_DATA_DIR>/pg`, or in memory with `FREERO_DATA_DIR=memory` (tests). Same SQL everywhere.
- `apps/web` — Vite 5 + React 18 + TS, react-router 6, zustand 4, yjs + y-websocket 2,
  lucide-react, perfect-freehand, dompurify, html-to-image + jspdf. Dev on 5173, proxies
  `/api`, `/uploads`, `/ws` to :4000.
- `apps/site` — the public marketing site: TSX pages rendered once at build time with
  `react-dom/server` into static HTML (no client JavaScript), plus OG images (resvg WASM) and
  sitemaps; served by the server's `modules/site`. See "Marketing site" below.

Dependencies are pre-installed. Adding one: `npm install <pkg> -w @freero/<web|server|site>`, and say so.

## Web layers (`apps/web/src`) — enforced by `scripts/dune-check.mjs`

```
ui/                 Design-system primitives. Imports only ui/, @freero/shared, packages.      [W1]
engine/             Board framework: store (Yjs), camera, canvas, selection/transform, text
                    editing, tool runtime, chrome slots. NEVER imports features/ or app/.      [W2]
features/<name>/    Product units. Import only '@engine', '@ui', @freero/shared, packages and
                    their own folder. Never other features, never app/.                        [W3]
app/                Shell: routing, pages, auth, REST client, Host implementation, and the
                    feature discovery root app/board/features.ts. Never imports features
                    directly.                                                                  [W4]
```

- `@engine` (= `engine/index.ts`) and `@ui` (= `ui/index.ts`) are the only entry points into those
  layers from outside. Deep imports fail [W0].
- `yjs`, `y-websocket`, `y-protocols`, `lib0` may only be imported in `engine/store/` [W5].
- `import.meta.glob` is only allowed in `app/board/features.ts` [W6].
- Only the app talks to Freero's server: `'/api/…'` / `'/ws/…'` paths in `features/`, `engine/` or
  `ui/` fail [W9]. Need server data? Add a typed method to `Host` (e.g. `serverNow()`).
- Raw HTML sinks (`innerHTML =`, `dangerouslySetInnerHTML`, `insertAdjacentHTML`, …) are allowed only
  in `engine/text/`, which sanitizes; board content is untrusted input from other users [W11].
  Parse untrusted HTML only in an inert document (`document.implementation.createHTMLDocument`).
- CSS classes are owned: Vite never unloads CSS on route changes, so board styles stay active on
  the dashboard. A `.fr-*` class styled by two sibling owners (app vs engine/feature, or two
  features) fails [W12]. ui/ and engine classes may be styled in context above them; otherwise
  prefix by owner (`fr-<feature>-…`, `fr-dash-…`).
- Features show toasts with `editor.host.notify(message, kind?, { action? })`; `useToast()` in
  `features/` fails [W10].

### Features — owned folders discovered through reserved files

```
features/<name>/
  feature.ts     REQUIRED  export default defineFeature({ name, description, owns? })
  element.tsx    optional  export default defineElement({...})  (or an array of them)
  tool.tsx       optional  export default defineTool({...})     (or an array)
  format.tsx     optional  export default defineFormat({...})   (contextual toolbar section)
  panel.tsx      optional  export default definePanel({...})    (or an array; mounts into a slot)
  commands.ts    optional  export default defineCommands([...]) (shortcuts + menu entries)
  decoration.tsx optional  export default defineDecoration({ id, appliesTo(el), Component }) (or an
                           array): drawn INSIDE other features' element wrappers (sticky tag chips),
                           so it moves, rotates, culls and exports with the element
  outline.ts     optional  export default defineOutline({ kinds?, annotate? }) (@freero/shared): how
                           its element types read in the board outline, and what its collections
                           add to items (votes, tags, comments). Runs on the SERVER and in the
                           browser (Editor.getOutline, "Board as list"), so it is pure:
                           '@freero/shared', files of its own feature, type-only imports [W13]
  importer.ts    optional  export default defineImporter({ id, importPriority, importData }) (or an
                           array): pasted / dropped data no single element type owns — a whole file
                           of another tool (features/import), offered in the same priority order and
                           with the same contract as ElementDefinition.importData
  *.css, *.test.ts(x)      allowed at the root
  lib/                     any helpers
```

Any other file at a feature root fails [W7]. The manifest `name` must equal the folder name.
The contract for all of these is `apps/web/src/engine/api.ts`. Scaffold with
`npm run new:feature <name> -- [--element <type>] [--tool] [--format] [--panel <slot>] [--commands] [--decoration] [--outline] [--importer] [--owns a,b]`
(`--element` scaffolds `outline.ts` too: a new element type reads in the outline from day one).
Something drawn ON another feature's elements that must appear in image exports is a
`decoration.tsx`, never a `world-overlay` panel (overlays aren't part of exports).

Features talk to each other only through the engine: elements, `editor.collection(name)` reads,
`editor.runCommand('<feature>.<verb>')`, and presence.

### Single writers

| Durable value | Single writer | How others change it |
|---|---|---|
| Yjs doc, provider, awareness | `engine/store/` | `Editor` methods |
| Layer docs (`private`, `editors`; see "Board layers") | `engine/store/` (placement: `engine/editor/layers.ts`); reveal: server `realtime` | `Editor` writes, `privateCollection`, `revealPrivate` |
| Suggestion records (editors layer `suggestions`; see "Suggestions") | server `realtime` creates them (`proposeSuggestions`) and withdraws them when their credential is revoked (KAI-224); a socket may only set its own `decision` | `Editor.acceptSuggestions` / `rejectSuggestions`, API accept / reject |
| `elements` map | engine (`editor.create/update/remove/transact`) | same |
| `settings` map (background, grid) | engine | `editor` settings API |
| feature collection (e.g. `comments`) | the feature whose `feature.ts` `owns` it | `editor.runCommand` of the owner. Writes from a non-owner throw at runtime [W8 checks unique claims] |
| camera, selection, active tool, dock | engine | `editor.setCamera/select/setTool/openDock` |
| presence ext | each feature writes `ext[<its name>]` only | — |
| Database table | the server module whose `migrations/` create it; only its `repo.ts` writes it, only its migrations alter it [S4] | that module's exported functions |
| auth session cookie | server `modules/auth` | — |
| `_outbox`, `_outbox_cursors` (platform tables) | `platform/outbox.ts` | `appendOutbox` in the change's transaction; consumers through `consumeOutbox` |
| Derived indexes (`object_references`, `search_entries`) | their module's outbox consumer | never written directly: change the source; `references:rebuild` / `search:rebuild` repair |
| A doc's document (Yjs fragment `document-store`, KAI-162) | the doc editor (`engine/docs`, through `engine/store/ObjectDocStore`); on requests, realtime's `docContent.ts` (`appendDocBlocks`, `initDocContent`) | the editor, or `modules/docs` / the public API |
| The event stream (`events`) | `modules/events` (from outbox topics only) | append to the outbox in your change's transaction (`board.events`, `board.members`, `board.content`); consumers follow `event.recorded` |
| API tokens, OAuth apps / consents, a team's API switch, live-view tickets (`api_embed_tokens`) | server `modules/apiauth` | its index: `authenticate`, `requireScope`, `useInWorkspace`, `mintEmbedTicket` / `redeemEmbedTicket` |
| Tracker connections, links to issues, what both sides last agreed on | server `modules/trackers` | its routes / index (`sendToTracker`, `importIssues`); syncs only through its outbox consumer |
| `trackers` collection (issue badges) and items' `trackerLink` | server `modules/trackers` (through realtime's `changeBoard`) | — (the web feature only reads them) |
| `walkthroughs` collection (one summary per recording) | server `modules/walkthroughs` (realtime's `writeServerCollection`) | `Host.walkthroughs` (REST); the web feature only reads it |
| Decision snapshots (`decisions`) and their content (board versions of kind `decision`) | server `modules/decisions` / `modules/realtime` (`freezeBoard`) | `Host.decisions`; never written again once frozen |

### Host — the one typed contract between app and engine

`Host` (in `engine/api.ts`) carries user, board meta and services (`uploadImage`, `renameBoard`,
`saveThumbnail`, `openShareDialog`, `navigate`, `notify`). The app builds it in `app/board/`; the
engine and features use `editor.host`. Features never import the REST client or router.

### Board chrome (owned by the engine; filled by features through panel slots)

- Left floating vertical toolbar: built-in select (V) + hand (H), then `tool.tsx` tools with
  `placement: 'main'` by `order`; a "+" button opens a grid of `placement: 'more'` tools.
  Undo/redo sit at the bottom of the toolbar.
- Top-left: logo button (back to dashboard), board title (inline rename), board "…" menu
  (`commands` with `menus: ['board']`), then `topbar-left` panels.
- Top-right: `topbar-right` panels (presence avatars, timer, voting, present, …) + Share button.
- Bottom-right: `bottom-right` panels + zoom controls (−, %, +, fit) + minimap toggle.
- Contextual format toolbar floats above the selection (`format.tsx` sections + engine's common
  controls: z-order, lock, link, more ⋯). Right-click menu: engine items + `menus: ['context']`.
- `dock-right` panels render in a right side panel opened with `editor.openDock(id)`.
  The dock has a fixed header strip with its close button; a panel puts its own header (title,
  filters) there by wrapping it in `<DockHeader>` (`@engine`), and its content scrolls below the
  strip, never under the button. Panels never reserve room for the close button themselves.
- `dialog` panels mount only while opened with `editor.openPanel(id, props?)` (one at a time,
  also while the chrome is hidden); the component gets `props` and closes with
  `editor.closePanel(id)`. Commands that open feature UI (export, start voting) use this — never a
  feature-local store + `screen-overlay` panel.

### Rendering

DOM/SVG. One "world" layer transformed by the camera (`translate() scale()`), each element an
absolutely positioned memoized component; off-screen elements are culled. Screen-space UI
(handles, toolbars, cursors) lives in overlays so it stays constant size. Text editing is shared
(`ElementText`). Frames render beneath other elements.

- The engine renders remote cursors and remote selection/"is typing" outlines itself (from
  presence). Presence features add avatars/follow, not cursors.
- `ElementRenderProps.zoom` is quantized (half-octave steps) so zooming doesn't re-render every
  element each frame — use it for level-of-detail only, never for layout.
- Element components render inside their feature's scope, so `useEditor()` there is scoped.
  Offscreen exports (`renderToDataUrl`, thumbnails) re-render the same components without
  editors or selection.
- The world layer ignores pointer events: hit-testing is geometric (`hitTest`, rotation-aware).
  Mark a node inside an element with `data-fr-interactive` to receive native pointer events.

### Gestures and undo

- One undo step per gesture. The engine wraps every tool pointer-down → pointer-up in a gesture,
  and every text edit session (startEditing → stopEditing) in another; nested gestures merge.
  So a tool that creates on pointer-down and resizes on pointer-move (drag-create) is one undo
  step without doing anything. Other continuous interactions (a slider) call
  `editor.beginGesture()/endGesture()`.
- Only local writes are undoable; undo never reverts another user's change.
- Role guard: viewers never write the doc; commenters only write `comments`. Every Editor write
  (including undo/redo, paste, settings) checks the live role (server role message) first and
  shows a toast instead — the server would otherwise reject the update and everything after it.

### Engine contract additions (additive, `engine/api.ts` / `@engine`)

- `ElementDefinition.rotatable?` (default true; frames false) and `removeWhenEmpty?` (text boxes
  that vanish when an edit ends empty).
- `Editor.beginGesture()` / `endGesture()` (see "Gestures and undo").
- `ElementDefinition.anchorPoint` returns element-local (unrotated) coordinates; the engine applies
  position and rotation. `outlinePoint(el, toward)` (same coordinates) is "attach anywhere": where
  a line aimed from the center toward a local point meets the drawn outline (shapes project onto
  their real curve; default the box). A connector end dropped on an outline away from the four
  dots stores `ConnectorEndpoint.at = { u, v }` (fractions of the box, so it scales with resizes)
  plus the nearest side as `anchor` (older clients attach there).
- Elbow connectors without a user bend route around other items (`features/connector/lib/router.ts`:
  A* over a sparse grid of the obstacles' keep-out edges, deterministic, at most 40 nearest items,
  only when the simple route would cross one). Obstacles come from a grid index built once per
  board state; the renderer subscribes with `useElementsQuery(select, isEqual)` (`@engine`), which
  re-renders a component only when its derived value changes — never re-render every line on every
  edit elsewhere. `follow` refreshes an elbow line's cache when a connectable item lands on it.
- `@engine` hooks: `usePointer()` (world pointer for tool `Preview`s), `useTextFormatState()`,
  `useSettings()`, `useCanEdit()`; `plainToRichText()`; types `ElementTextProps`, `TextFormatState`.
- `useCollection(name)` returns the collection's entries (`Array<[key, value]>`).
- `CommandDefinition.minRole` defaults to `'editor'`; engine view-safe commands set `'viewer'`.
- `CommandDefinition.extraShortcuts?: string[]`: further bindings for the same command (listed in
  the shortcut reference; menus show `shortcut`). Punctuation shortcuts match the typed character,
  and outside text editing AltGr + that character (Windows reports AltGr as Ctrl+Alt) also answers
  `mod+<character>`, so Ctrl+[ / Ctrl+] work where brackets need AltGr; Bring to front / Send to
  back also have Ctrl+Shift+↑ / ↓ on every layout.
  While text is being edited, only command shortcuts using Tab or a modifier (outside the
  editor's own Mod+B/I/U/Z/C/V/X/A/K) are dispatched.
- Engine commands are ordinary commands (`engine.copy`, `engine.duplicate`, `engine.lock`,
  `engine.zoomToFit`, …) so features can `runCommand('engine.<verb>')`.
- URL params: `?el=<id>` selects and zooms to an element (copy-link target); `?dock=<panelId>`
  opens a dock panel on load. `/board/local` (dev only) is an offline sandbox persisted in
  localStorage; `?role=viewer|commenter|editor` and `?name=` preview roles there.
- `Editor.setChromeHidden(hidden)` / `isChromeHidden()` + hook `useChromeHidden()` (presentation
  mode): hides the whole board chrome (toolbar, top bar, zoom/minimap, format toolbar, context
  menu, dock) and the local selection/hover/guide overlays. Local UI state, not synced.
  `screen-overlay` / `world-overlay` panels and remote cursors stay, so the presenting feature
  mounts its own controls there.
- `ElementDefinition.follow?(element, { editor, changed, removed })` (`engine/editor/followers.ts`):
  for elements whose stored fields derive from OTHER elements (connector endpoints). The engine
  calls it inside the same transaction as every LOCAL `update`/`updateMany`/`remove` (so the
  refresh shares the change's undo step and network update) and never for remote changes, so
  exactly one client — the one making the change — rewrites the derived fields. Renderers should
  still derive from the live elements (`useElement`) and treat the stored fields as a cache.
- `Host.uploadFile(blob)`: documents (PDF) through the same `/api/uploads` endpoint, checks and
  per-account quota as images (`modules/uploads` accepts `application/pdf` after a `%PDF-`
  signature check and always streams PDFs itself, never via the bucket redirect, so `fetch()`
  stays same-origin). Rejections carry the server's message (too large, quota reached).
  `features/pdf` lazy-loads pdf.js (`pdfjs-dist`, pinned exactly) with its worker as a same-origin
  asset (CSP `worker-src 'self'`) and `isEvalSupported: false` (no `unsafe-eval` needed).
- Video, audio and any other file (KAI-128, `features/media`: element types `media` and `file`).
  `Host.uploadFile` also takes video/audio (`file.type` video/* or audio/*; the server keeps it
  only when the BYTES are a container it serves for playback, else 415 — `status` on the Error);
  `Host.uploadAttachment?(blob)` stores any other file as an opaque attachment; and
  `Host.downloadFile?({ id, src, name })` saves an item's file under its name through
  `GET /api/boards/:id/files/:elementId` (see "Uploads: what is served how"). A drop runs the
  importers by priority: images (100), PDFs (15), then media (12) takes every other real file —
  video / audio this browser plays (probed locally, with a JPEG poster frame captured from a
  `blob:` URL and uploaded as an image) become players, the rest (and media the server refuses
  with 415) file cards. A drop of several kinds is SPLIT (KAI-204): an importer returns the
  `File[]` it took and the rest flows on with `data.alongside`, to be placed in a free spot near
  the drop point; the group on the drop point holds its area with `Editor.reserveSpace(rects)`
  while it uploads, so the others never land on it. `Editor.importData(data, at)` (additive) is
  the same path for "upload" buttons, so a picked image still becomes an image. Playback is each viewer's own, never synced:
  a remote "play" would hit every browser's autoplay rules (unmuted playback needs that person's
  own gesture), and buffering makes synced positions drift; presenters bring people to the item
  with follow / "Bring everyone to me" and press play. The player mounts on the first play only
  (a board of videos loads nothing until then), Space plays / pauses the selected item, and
  exports render the poster and the cards (a fresh copy never plays).
- `Host.listMembers()`: everyone with access to the board (owner + invited members), including
  people never seen online — for assignee pickers etc. (`/board/local`: just the local user).
- `Host.lookupUsers(ids)`: current profiles (name, color, photo) for ids the board shows — people
  with access and anyone who wrote or is @mentioned in its comments, also after they left
  (`GET /api/boards/:id/people`, members module; unrelated ids are never answered). The engine
  keeps one people directory per board over it and presence, `usePeople(ids)` (KAI-201): comments
  (author photos, mention names) and find read the same current names through it. `Host.inviteMember(email, role)`: the share flow from inside a feature (the
  @mention picker invites a non-member as commenter); someone who already has access keeps
  their role.
- Comment @mentions are `<@userId>` tokens in the message text (`MENTION_RE`, `mentionedUserIds`,
  `mentionsAsNames` in `@freero/shared`); readers show the person's current name, so a typed
  "@Name" can never pose as a mention. Only names picked from the member list become tokens.
- `CommandDefinition.urlParam`: deep links into features. With `?<param>=<value>` in the board
  URL the engine runs the command (args `{ [param]: value }`) once synced — on load and on every
  in-app navigation while the board is open (`BoardEngineProps.location` = the router location).
  `comments.openThread` declares `'thread'`: `/board/<id>?thread=<threadId>` (notification links).
- `BoardEngineProps.topbarAccessory`: an app-owned control the engine places next to Share (the
  notifications bell). It is app UI (REST, router), not a feature, and gets no Editor.
- `Editor.findFreeSpot(size, { near?, gap? })`: top-left of a box that keeps `gap` clear of
  every element, nearest to `near` (default: viewport center). Every "insert" action that
  isn't aimed at a point (templates, the image upload button) places content with it. The rule
  itself is `@freero/shared` `findFreeSpot`, so the server places inserted structure the same way;
  `richTextToPlain` / `plainToRichText` live there too (the server reads board text identically).
- `createTestBoard({ users, features, members?, now? })` (tests only): several real engine
  replicas of one board — real Yjs docs and guarded Editors — that exchange updates only on
  `sync()`. Writes between two syncs are concurrent; use it to prove concurrent writes merge.
- Collections hold LWW values per key. When several people may change the same logical thing
  at once, give each independent change its own key (one record per message / reaction /
  vote) instead of read-modify-writing one big value. Example: `comments` (layout in
  `@freero/shared` `CommentRecord`).
- Safe area: `Editor.getSafeArea()` is the screen rect the chrome leaves free (toolbar, top bar,
  bottom-right controls, open dock; chrome regions mark themselves `data-fr-occludes`). The whole
  viewport while the chrome is hidden. `zoomToFit`/`zoomToRect` fit into it by default
  (`FitOptions.area: 'viewport'` opts out); never subtract dock/toolbar widths in a feature.
  `zoomToFit` includes `ElementDefinition.visualOutset` (frame titles), as does the format
  toolbar's placement.
- Camera events: `'camera'` on every change; `'camera-user'` only for the user's own moves (wheel,
  pan, pinch, zoom controls/shortcuts, minimap), never for `setCamera`.
- Following: `Editor.follow({ userId, clientId? } | null)` / `getFollowing()` / `useFollowing()` /
  event `'follow'` (`engine/camera/follow.ts`). The engine eases the camera toward the followed
  tab's view every frame, publishes `PresenceState.following` (the followed user id) and, while
  anyone follows this user, publishes its viewport every 50 ms instead of 200 ms. Any other camera
  write (user move, a feature's `setCamera`), a canvas click, Esc, or the person leaving ends it.
  Presence (avatars) and present (the "is presenting" banner) both use it; presence owns the
  "Following … · Stop" pill and "Bring everyone to me" (`presence.bringEveryone`).
- `ToolDefinition.onCanvasDoubleClick?(editor, point)`: double-click on empty canvas (or a frame's
  empty area) with the select tool = "write here". The first tool by `order` that defines it runs
  (the text tool: a text box with the caret ready), inside the click's gesture.
- Frame membership has one rule, applied by the engine on drop, create, duplicate and paste: an
  element belongs to the innermost container under its center (`frameId`), unless it already
  names an existing container. Features never compute membership for new elements themselves.
- Typing a character with one EMPTY text item selected starts editing it with that character —
  AltGr characters too (`isPrintableKey`: Windows reports AltGr as Ctrl+Alt, so a Ctrl+Alt press
  that typed something other than its key's own letter/digit is text, and on an empty note AltGr+9
  types "]" instead of Bring to front; Ctrl+Alt+T stays a shortcut);
  items that already have text keep single letters as tool shortcuts (Enter / double-click edit).
  Undo/redo shortcuts also work while a non-modal popover has focus.
- Screen/world UI that must stay visible next to a selection (comment pins, the top quick-connect
  "+") marks its node `data-fr-keep-clear`; the format toolbar steps above it, or flips below the
  selection. The toolbar also steps past unselected items it would cover (a mind-map sibling right
  above), but only to a free spot within 160 px; otherwise it covers them (dense sticky grids).
- `ToolDefinition.onSelect?(editor)`: act-now tools (upload image, templates) run when picked and
  never become the active tool. `ToolPointerEvent.button` is -1 on every move (drag or hover);
  `buttons` is the pressed-buttons bitmask.
- `CommandDefinition.icon?` (shown in the context and board menus) and `group?` (commands sharing
  a group fold into one "<group> ▸" submenu, e.g. emoji's "React with ▸" stamps).
- `editor.runCommand(id, args?)` → `run(editor, args)`: how a feature asks another to act on
  something specific without importing it (find → `comments.openThread { threadId, quiet }`,
  `comments.replaceText`). Shortcuts and menus pass no args; validate them in `run`.
- `Host.notify(message, kind?, { action?: { label, run } })` — features never call `useToast`.
- Panel slot `'top-center'`: session bars under the top bar (an active vote, "X is presenting").
  The engine stacks them in one centered column (also while presenting), so two bars never
  overlap; the panel renders only its bar, no positioning. Never place such a bar absolutely in
  `screen-overlay`.
- A socket closed with 4401/4403 (removed, link access revoked, signed out) drops the session to
  read-only (`viewer`) besides showing the banner: writes after that could never reach the server.
  `WS_CLOSE_BOARD_REMOVED` (4451, an operator took the board down) does the same with a "removed
  for review" banner (`ConnectionStatus` 'removed').
- `Host.report({ target, reason, note })`: reports to Freero's moderators (KAI-142); the report
  feature's dialog is the only caller (other features run `report.open` with `{ target }`).
- `BoardEngineProps.initialState`: a read-only board from a document state, with no network and
  nothing persisted (the operator's preview of a reported board; host role viewer, `syncUrl` '').
- `Host.user` changes (profile renamed / recolored in any tab) are republished to presence.
- Facilitator limits (KAI-129; see "Facilitator controls" under Server): `Editor.getLimits()` /
  hook `useLimits()` (from the server's role message), `mayAdd(type)`, `listAddableTypes()` (from
  `ToolDefinition.creates`, default: the element type named like the tool). The engine mirrors the
  server: a locked board is the commenter role with a toast naming the facilitator; `createMany`,
  `insertElements` / paste and `setTool` refuse types outside `addTypes`, and the toolbar hides
  those tools. `FollowTarget.locked` ("follow me"): user camera moves, Esc, canvas clicks and the
  followed person's brief absence don't end it; only `follow(null, { force: true })` does.
  `Editor.setCursorsHidden(hidden)` / `useCursorsHidden()`: other people's cursors off for this
  viewer (local).
- Board layers (see "Board layers" under Server): `Editor.layerOf(id)`, `setPrivatePlacement(rule)`,
  `privateCollection(name)` + hook `usePrivateCollection`, `revealPrivate` / `discardPrivate`,
  `ElementDefinition.hidesContents(el)`. `ExportOptions.sharedOnly` (thumbnails).
- Suggestions (KAI-169; see "Suggestions" under Server): `Editor.getSuggestions()` (pending, with
  `state`) + hook `useSuggestions()`, `acceptSuggestions(ids, { force? })` → `{ accepted, stale }`,
  `rejectSuggestions(ids)`; `<ElementPreview element>` (`@engine`) draws an element as it would look
  without being on the board (ghosts; world coordinates, never selected or hit-tested); test boards
  get `TestBoard.propose(records)`.
- `Editor.exportElements(ids?)` → `ElementsSnapshot` (what copy puts on the clipboard: elements
  with frame children + `copyContent`) and `Editor.insertElements(snapshot, { at? })` — the ONE
  insertion path for copied content (paste uses it): fresh ids, references remapped, content
  restored, one undo step, on a `findFreeSpot` by default. Saved templates go through it.
- `Host.ai?` (additive, KAI-101): `{ provider, source, run(AiActionRequest) }`, present only when the
  server said this user may use AI on this board. AI entry points (`features/ai`: the format-toolbar
  button, the "AI ▸" context/board menu, the dialog) hide without it; never offer AI from `when`
  alone. Not in the command palette (it lists unavailable commands greyed out).
- `Host.trackers?` (additive, KAI-154): `{ connections, projects, preview, send, importIssues, sync,
  unlink }`, present only when the server listed a tracker connection this person may use on this
  board (`GET /boards/:id/trackers`). `features/trackers` hides every entry point without it.
- `Host.walkthroughs?` / `Host.decisions?` (additive, KAI-133 / KAI-161; see "Walkthroughs and
  decision snapshots"): absent without a server; guests watch and open but don't record or comment.
  A command's `urlParam` run also gets `args.query` (every URL parameter: a walkthrough's `t`).
- `Host.activity?.list(before?)` (additive): the board's activity feed as the server recorded
  it (see "Activity"); `features/activity` shows it in a dock panel.
- `Host.engage?` (additive, KAI-132): answering live activities (`state / answer / withdraw / ask /
  upvote / moderate / reveal / clear`). Answers go to the server, never into the doc; the board
  shows only the results the server publishes (see "Live activities"). Guests have it too.
- `Host.call?` (`get / set`) and `Host.board.call` / `jitsiCalls` (additive, KAI-134): the board's
  call link (`features/call`: "Join call" in the top bar, who is in the call as presence
  `ext.call`, "Call link…" in the board menu). Changes reach open boards through the `call`
  collection's `rev`, which makes every client re-read `call.get()`; the link itself lives on the
  server (`boards.call_url` / `call_jitsi`), checked there (https only) and read as https only; the
  pasted link is sealed at rest (KAI-143: meeting links often carry a passcode).
- `SavedTemplateInfo.ownerName` / `canUnshare` (additive): team templates say who shared them;
  a workspace admin may `shareTemplate(id, false)` someone else's team template.
- `Host.listTemplates / loadTemplate / saveTemplate / deleteTemplate` (server module
  `templates`): a board or selection saved for reuse — the user's own plus those shared with a
  team workspace they are a full member of; offer owner-only actions only when
  `SavedTemplateInfo.ownerId` equals `user.id`. The visibility rule is one predicate in
  `modules/templates/repo.ts`. `Host.board.team` names the board's team workspace (when the user is
  a full member): `saveTemplate({ …, shareWithTeam })` and `Host.shareTemplate(id, shared)` share
  with it; `SavedTemplateInfo.shared` marks shared ones.
- `Host.board.canExport` (default true): false when the board's workspace "downloads" policy
  doesn't let this user export or copy its boards — export commands and "Save as template" hide
  (their `when`); the server refuses duplicates and template saves from that board itself.
  `Host.reportExport?(format)`: export features call it after each browser download (image, PDF)
  so the workspace's audit log records it (`POST /boards/:id/exported`, refused like the export).
- Board backups (KAI-137; format: docs/board-backup.md): `Host.downloadBackup?()` — the SERVER
  builds the `.freero` file (`modules/backup`), so the downloads policy, the reader's layers and
  the audit log apply there, never in a feature; `features/export`'s "Download board backup" only
  calls it. `Host.openBackup?(file)` hands a `.freero` (dropped on a board, opened with the
  installed app) to the app's restore flow: a backup always becomes a NEW board, never content of
  the open one.
- Shared into the installed app (KAI-218): `Host.takeShared?()` → `SharedContent` (images as our own
  `/uploads/` URLs, a link, text), handed over ONCE for the board the person picked on `/share`;
  `features/share` (`share.receive`, `urlParam: 'shared'`) places it through other features'
  paths only — `image.insertStored` (our uploads, laid out as a grid) and `importData` for the
  link / text (link card, sticky, text box).
- Version history (`features/history`, server `realtime/history.ts` + `routes.ts`):
  `Host.versions` (`list / load / nameCurrent / rename / restore`; `unavailableVersionHistory()`
  for hosts without it) and `<StaticBoardView state>` (`@engine`): a read-only board showing a
  version, built as a SEPARATE local engine session (own doc from `state`, no network, role
  viewer, hand tool) from the live board's feature bundles — previewing never touches the live
  doc, and nobody else sees it. Features never apply a version themselves: `restore` runs on the
  server, which applies it to the live doc as a new change (all clients, all instances converge)
  after keeping the board as it was as a `before-restore` version. Undo of a restore = restoring
  that version (the toast's Undo); Ctrl+Z does not revert it (like any change made by someone
  else). Comments, votes and the timer are not rolled back (`Y_KEPT_ON_RESTORE` in
  `@freero/shared`; a new social/session collection belongs there). Editors and owners only, in
  the UI and on the server: an old version can hold content removed before the board was shared
  with viewers or commenters.
- Built-in templates (`features/templates/lib/catalog/`) are pure builders, run only when a template
  is inserted or its preview scrolls into view. They may carry content kept outside the elements
  (table cells, in `@freero/shared` `TableCopyContent`, the same format copy/paste and saved
  templates use); those elements go through `insertElements` so the owner's `pasteContent` writes
  it, everything else through `createMany` (so `normalize` measures text), in one transaction.
  The `Kit` builds containers with their members (`kanban(…)`, `swimlane(…)` + `within(id, …)`:
  members name the kanban / pool as `frameId`, and the container's own `arrange` settles them on
  insert), icons from `lucide-react` components (`icon(…)`, drawing copied into the element), and
  connector ends at a spot on an element (`{ id, at: { u, v } }`, e.g. a message on a lifeline).
- **New built-in templates are data, not code** (`features/templates/lib/specs/<area>.ts`, format in
  `lib/spec/types.ts`). A spec names an archetype (`matrix`, `columns`, `kanban`, `canvas`,
  `timeline`, `funnel`, `journey`, `tree`, `prompts`, `table`, `clusters`, `hub`, `flow`) and gives
  its content: section titles, a guiding prompt each, realistic example notes and tones by meaning
  (never coordinates or hex colours). `lib/spec/archetypes.ts` lays specs out with the `Kit` and
  returns the same `BuiltTemplate`, so insert, preview, search and the outline treat both kinds
  alike; hand-coded templates stay for layouts no archetype fits (sequence diagrams, ERDs…). After
  adding or editing a spec run `npm run templates:index`: it writes `lib/specs/index.ts`, what the
  picker lists and searches plus one lazy loader per file, so spec content loads per file on first
  preview or insert (`TemplateDef.load`; insert through `addTemplate`). `validateSpec` (run over
  every spec by the tests) checks ids, categories, counts, text lengths and filler; the tests also
  fail while the index is stale or a note spills out of its section. A layout no archetype covers
  is a new archetype (with its validation limits), not a one-off spec.

Elements, geometry and text (all optional on `ElementDefinition` unless noted):
- **Reads inside `editor.transact` see its earlier writes** (`getElements()`, `getElement()`,
  followers alike): plan from the live board inside the transaction, never from a copy.
- `measureRichText(html, { fontFamily?, fontSize, fontWeight?, lineHeight?, width? | maxWidth?,
  padding?, whiteSpace? }) → { w, h, lines }` (`@engine`): the size ElementText renders, laid out
  with ElementText's own classes. Use it in `normalize` (text boxes, card titles, mind-map pills);
  never copy font metrics into a feature. Cached until web fonts change.
- `normalize(next, prev?)`: `prev` is the element before this local change (undefined on create),
  so "w changed alone" (a side handle) is told apart from a corner scale or an edit. When web fonts
  finish loading, the engine re-runs `normalize` for the elements THIS client measured and nobody
  else changed since — never for collaborators' elements. The write is no undo step of its own:
  it joins the last one (`BoardStore.transactDerived`), because Yjs never undoes a key over a
  newer untracked value, and waits for the next local change while redo steps exist.
- `arrange(container, { editor, touched }) → [{ id, patch }] | null` (`engine/editor/arrange.ts`):
  containers that lay out their children (kanban columns, frames with a grid layout). After every
  LOCAL change the engine asks each element of that type for the patches that put it back in
  layout and applies them in the same undo step: inside a gesture once, when the outermost gesture
  ends (a drag never re-stacks under the pointer; drop + re-stack = one undo), inside
  `editor.transact` once at its end (never from a half-written state), otherwise right after the
  write. Must be idempotent and deterministic (the same board gives the same patches on every
  client) — it also runs after unrelated changes. Remote changes don't run it, except one case:
  a client that laid a container out in the last 5 s re-plans it when a remote change settles, and
  if the merge left it out of layout (two drops into one free slot), the participant with the
  highest Yjs client id re-lays it out (the others re-check 1.5 s later), joining its last undo
  step. Bystanders never do, so nobody snaps a collaborator's drag in progress.
  Swimlanes (`features/swimlane`) use the same hook without restacking: items keep their own
  positions and belong to the lane / phase under their center; `arrange` only grows a band to fit
  what is in it and shifts the items of later bands by the growth. Lane edits that change the
  bands (edge drag, add, remove, reorder, rows ⇄ columns) move the items with `moveBy` in the same
  transaction, so attached connectors follow and one undo takes back both.
- `fitToContent(el, handle)`: double-clicking a resize handle applies the returned patch (a
  fixed-width text box goes back to auto width).
- `hitTest(el, local, { tolerance })` — `tolerance` is a few screen px in world units at the live
  zoom; `distanceTo(el, local)` (≤ 0 on the ink) is the default hit test when there's no
  `hitTest`, and other features may ask it (`editor.getDefinition('pen').distanceTo` is how the
  eraser finds ink). `worldToLocal(el, p)` from `@engine` converts.
- `hidden(el, editor)`: off the board (collapsed mind-map branches). Not rendered or exported, and
  ignored by hit tests, marquee, selection (dropped from it when they become hidden), snapping,
  `getBounds` and zoom-to-fit.
- `BaseElement.attachedTo` (`@freero/shared`): an element that rides on another (a reaction stamp
  on a sticky). `Editor.withChildren` includes riders like a frame's children, so they move (drag,
  nudge, `moveBy`), duplicate, copy/paste, come to front and are deleted with their item; copies
  whose item wasn't copied lose the link. The placing feature sets it (and re-attaches in
  `follow` when the rider is moved on its own).
- `removeWith(el, editor) → ids`: deleted along with `el` in the same transaction by every local
  `editor.remove` (Delete, cut, context menu, eraser); one undo restores all of them.
- `onKeyDown(e, { editor, selection })`: keys while this type is selected, asked before the
  engine's own keys and command shortcuts (mind-map Enter = add sibling, Delete = delete branch).
  Declare what it handles (and keys a type's text parts handle) in `keys: [{ shortcuts, label,
  minRole? }]` next to it, or the `?` sheet can't show them.
- `wrapperStyle(el)`: style for the element's world wrapper (highlighter `mix-blend-mode`).
- `selectionFrame: false`: no engine bounding box / handles / hover outline for that type; the
  feature draws its own (connector endpoint handles). `useFormatToolbarRect()` tells screen UI
  where the format toolbar is (never query the chrome's DOM).
- `visualOutset(el, zoom)`: what's drawn outside the box (frame titles). `getBounds(ids, { visual:
  true })`, exports, thumbnails and zoom-to-fit include it.
- `Editor.cancelGesture()`: Escape mid-drag — reverts the outermost gesture's writes and leaves no
  undo step (the select tool and connector handles use it).
- `renderToDataUrl({ …, skipFonts? })`: exports inline only the web-font faces the picture uses
  (fetched once, see `engine/editor/fontEmbed.ts`); html-to-image never reads stylesheets itself,
  so cross-origin font CSS can't log errors. `skipFonts` (thumbnails) uses installed fonts.
- Auto-fit text (`fontSize: 'auto'`) snaps to a small set of sizes (~12% apart), so neighbouring
  stickies with similar text match. `ElementText.padding` may be per side (`{ top, right, bottom,
  left }`): tagged stickies keep their chip band free.
- `DecorationDefinition.reserve?(el) → { top?, right?, bottom?, left? }`: the band a decoration
  draws over inside the element's box. The element gets the per-side maximum as
  `ElementRenderProps.reserved` (also in exports) and lays its text out clear of it — so the
  decoration's geometry has one owner (tags' chip band) instead of a copied formula.
- The active tool's Options flyout is kept inside the window by the engine.
- Text-style format controls are the engine's (`@engine`): `FontFamilyControl`, `FontSizeControl`
  (numbers, 'auto', labelled presets, custom field), `TextColorControl`, `TextHighlightControl`,
  `TextMarkButtons` (pick `marks`), `TextAlignControl` (vertical too when given `vAlign`), with
  `MIXED` / `commonValue`. A text-bearing feature composes them in `format.tsx` and owns only the
  write (`onChange` → its patch); never copy them into a feature.

Canvas productivity (engine primitives; the product UI lives in `features/arrange`, `find`,
`layers`, `format-painter`, `select-similar`):
- `Editor.moveBy([{ id, dx, dy }])`: programmatic moves with drag semantics — connector endpoints
  and waypoints move, a container's children travel with it, locked items stay put, moved items
  join/leave frames by the drop rule. Align / distribute / tidy up use it inside
  `beginGesture()/endGesture()`, so each action is exactly one undo step (never merged with an
  action a moment earlier by Yjs' capture window).
- "Hidden for me": `Editor.setViewHidden(ids, hidden)` / `getViewHidden()` / hook
  `useViewHidden()`. A LOCAL view filter (not synced, not saved, any role): hidden ids, and
  everything inside a hidden frame, behave like `ElementDefinition.hidden` elements for this
  viewer only (not drawn, hit-tested, selectable; dropped from the selection). Exports and the
  dashboard thumbnail still include them (they are board content). Chosen over a synced `hidden`
  flag because content vanishing for collaborators without a trace is not what whiteboard users
  expect; the Layers panel says "N hidden for you only · Show all". Not in `@freero/shared`.
  `ElementDefinition.hiddenWith(el) → ids` names what an element is drawn against (a connector's
  attached ends): while one of them is hidden for me, so is the element, so no line is left
  pointing at empty space. `Editor.isViewHidden(id)` answers the whole rule (itself, a container,
  or a `hiddenWith` id); features never re-walk it.
- `BoardSettings.gridSize` (8–48, default 24) and `snapToGrid` (board menu). The drawn grid uses
  `gridSize`; with snapping on it never subdivides below it, so every drawn line is a snap line.
  Moves snap the top-left, resizes the dragged edges; Ctrl/⌘ held during a drag inverts the
  setting for that drag; Alt still disables all snapping. Creation tools snap too, centrally
  (`engine/interaction/toolDispatch.ts`): while snapping applies (same Ctrl/⌘ / Alt rules) a
  tool's `ToolPointerEvent.point` is a grid point (`target` stays what is under the real pointer)
  and whatever it creates during that pointer event lands with its top-left on the grid (several
  elements created at once move together), so tools never snap by themselves. A tool's hover
  ghost uses `useToolGhost({ w, h })` (`@engine`; not `usePointer()`): the top-left of a box
  centered on the pointer exactly where a click would create it, by the same rules and modifiers
  (`toolGhostAt` in `toolDispatch.ts`, so preview and placement can't drift apart). Tools set
  `ToolDefinition.snapToGrid: false` to opt out: freehand (pen, eraser), element-aimed
  (connector, comment pins) and select (snaps its own drags). Arrow-key nudges with snapping on
  move to the next grid line (an off-grid item lands on the grid first); Shift+arrow moves five
  grid lines. With snapping off they move 1 px (Shift: 10 px).
- Snapping (`engine/geometry/snap.ts`) adds equal spacing: a dragged box snaps so its gap to a
  neighbour in the same row/column equals a gap already in that row/column (or centers it between
  two neighbours), whichever is closer than edge/center alignment, and draws distance markers on
  every matching gap (`UiState.gaps`).
- Keyboard: a burst of arrow-key nudges is one undo step (closes after 1 s idle, any other key,
  a pointer press or blur). Tab / Shift+Tab from the canvas walks items in reading order when no
  command or element `onKeyDown` claims Tab; once walking, it continues past Tab-claiming types
  (a sticky's "add to the right" applies to stickies the user picked, not ones Tab reached).
  Escape walks out: editing → group member → whole group → nothing.
- `replaceInRichText(html, find, replacement, { caseSensitive? }) → { html, count }` (`@engine`):
  replaces in rich text's text only, keeping tags. It matches the text as `richTextToPlain` reads
  it, so an occurrence split by formatting ("<b>Hel</b>lo") is replaced too: the replacement takes
  the formatting of the run the occurrence starts in, and inline tags left empty are dropped. An
  occurrence never spans a line break.
- Format toolbar: Group / Ungroup buttons for multi-selections; a locked member gets a lock badge
  and the Lock button a dot when only some items are locked.

Content (engine primitives; product UI in `features/table`, `embed`, `connector`, `sticky`, `eraser`):
- Text PARTS — elements with several texts: `ElementDefinition.textPartAt(el, local, { editor,
  zoom }) → part | null` names the text under a point; double-click there (or a click on the
  selected element) runs `Editor.startEditing(id, { part })`. `getEditingPart()` / hook
  `useEditingPart()`. The component renders each part with `<ElementText part value onCommit>`:
  it shows `value` and writes through `onCommit` (e.g. into the feature's collection) instead of
  `element[field]`; `onKeyDown(e, { atStart, atEnd })` sees keys first (Tab / arrows between
  table cells). Switching part ends the previous edit session (one undo step per part).
  `removeWhenEmpty` never applies to parts. Table cells and extra connector labels use it.
  Board-wide tools reach every text through `Editor.getTextParts(id)` (the `textField` as part
  null, then the definition's `textParts(el, editor)`) and rewrite them with
  `Editor.setTextParts(id, parts)`: one transaction, and each part is written by the definition's
  `writeTextPart(el, part, html, editor)` with the DEFINING feature's editor, so a table's cells
  are still written only by the table feature. Find & replace uses it; a new multi-text element
  becomes searchable and replaceable by defining `textParts` + `writeTextPart`.
  `toPlainText(el, editor)` (copy as text, Layers / voting previews) also gets the caller's editor,
  so content kept outside the element (a table's cells) is read from that board, never through a
  module-level handle that outlives a board switch.
- `FeatureManifest.undoable: string[]` — owned collections whose local writes join the undo
  history (same gestures / steps as element writes). For content that belongs to elements
  (`tableCells`); never for social data (comments, votes).
- `ElementDefinition.copyContent(el, editor)` / `pasteContent(copy, content, editor)` — content
  kept outside the elements map travels with copy / cut / paste (inside the clipboard payload,
  `ClipboardPayload.content`), duplicate and Alt-drag; `pasteContent` runs in the transaction that
  creates the copy, so a copy never shares or loses it and one undo removes both.
- Space: a tap first goes to the selected types' `onKeyDown` (mind map: collapse); unclaimed, held
  Space pans as before.
- `Host.unfurl(url) → LinkPreview` (server route `GET /api/unfurl`, module `modules/unfurl`, no
  table): the server fetches the page — http/https on default ports only, no credentials, every
  hop (redirects included) resolved through a lookup that refuses private / loopback / link-local /
  CGNAT / multicast addresses at connect time, 1.5 MB / 2 MB caps, 6 s deadlines, per-user rate
  limit — and returns title / description / site name and the preview image as a data: URL. The
  embed feature re-hosts that image with `Host.uploadImage`, so viewers and exports never load
  third-party URLs.
- Live embeds (KAI-127, `features/embed/lib/providers.ts`): one allow-list, `EMBED_PROVIDERS` in
  `@freero/shared` (YouTube, Vimeo, Loom, Figma, Google Docs / Sheets / Slides / Forms, CodePen,
  CodeSandbox — never another whiteboard), each with its frame origins, `sandbox` and `allow`. The
  board stores only the pasted URL; the iframe src is REBUILT from ids parsed out of it on the
  provider's own embed host and checked against the provider's origins, so a URL tampered with in
  the doc frames nothing else. The CSP `frame-src` (`platform/security.ts`) is exactly
  `EMBED_FRAME_ORIGINS` plus the operator's `EMBED_EXTRA_ORIGINS` (https origins only; links there are
  framed as given, `OPERATOR_EMBED_SANDBOX`). A frame mounts only after a click ("Open live" / play),
  for that viewer only; it takes pointer input only while the item is selected (a board-owned strip
  above it is the grab handle, with full screen / open / close), so the board stays navigable.
  Workspace policy `liveEmbeds: 'off'` (admin console → Sharing) keeps every link a card
  (`BoardPermissions.liveEmbeds` → `Host.board.embeds`). Exports and thumbnails render a fresh copy:
  never live, always the card with its poster.
- Code blocks (KAI-125, `features/code`, element `code`): `code` is plain text, never HTML. The
  highlighter (lowlight over highlight.js grammars, pinned, loaded with `import()` on first use)
  returns a syntax TREE that is turned into lines of text runs and rendered as React text spans
  with highlight.js scope class names only — no HTML string is ever built from a block, so W11
  needs no exception. Editing is a plain `<textarea>` in the block (one gesture per sitting);
  lines never wrap, so the height follows the line count. A pasted Markdown fence (not ```mermaid)
  becomes a block (importer priority 45). Exports render the same spans and colours.
- Timelines (KAI-122, `features/timeline`, elements `timeline` + `timelinebar`): a container whose
  bars are separate elements (`frameId`), so concurrent edits of different bars never collide.
  Dates are the truth: `arrange` (pure `lib/layout.ts` `planTimeline`) lays each bar at its dates,
  lane (under its center) and row; right after a LOCAL move / resize (`ArrangeContext.previous`) the
  change is read back as whole days. Bars outside the range shrink to a stub at that edge, never
  lost. Task cards dropped on a timeline become bars spanning `startDate`..`dueDate`; their dates are
  written only through `card.setDates` (cards keep one writer), and a card laid out shorter than
  `BAR_MAX_H` draws itself as a one-line bar. Dependencies are ordinary connectors. The layout is
  `@freero/shared` `timelineLayout` (the feature re-exports it) so the server lays a timeline out by
  the same rule. `TimelineElement.view: 'horizons'` (KAI-160) draws Now / Next / Later columns
  (`horizonsOf`: the month — or quarter on month / quarter scales — holding today, the next one,
  everything after): bars keep their dates and sit in the column their start falls in; moving one
  to another column moves its dates there, same length.
- Roadmap mode (KAI-160, `modules/trackers/roadmap.ts`, `features/trackers`): a tracker import with
  `timeline: { id, groupBy }` makes linked task cards that are that timeline's bars, in a lane per
  epic / team / label (`roadmapLaneOf`), laid out by `planTimeline` in the import's one change;
  undated issues go to a skipped "Unscheduled" frame. `startDate` is a synced issue field. A pull
  that changes a bar's dates (`planPull`) re-lays its timeline in the same change, so open boards
  see the bar move — no client has to re-lay a remote change. See docs/trackers.md.
- Typed table columns (KAI-123, `features/table`): `TableColumn.type` (text, number, date, select,
  person, checkbox; select `options`). Cells stay element content in `tableCells`; a typed cell
  stores its canonical plain value (number "12.5", ISO date, the option's label, a user id,
  "true"), which is valid RichText, so the outline, find and CSV read it unchanged; typed cells
  are not text parts (they have their own editors). Sort reorders `rows` (one undo step, header
  first, empty cells last); `TableElement.filter` is shared and draws filtered rows collapsed (the
  element keeps its size; Tab skips them); `view: 'board'` draws the same rows as cards in a
  column per option of `groupBy`, and dragging a card sets that cell. Pasted / imported sheets
  infer number, date and checkbox columns; CSV export writes numbers, ISO dates and TRUE / FALSE.
- Slide deck (KAI-126, `features/frame`): the "Slide deck" dock panel lists frames in `index`
  order (the order presenting and PDF export use): drag to reorder, New slide with a layout
  (`lib/layouts.ts`: Freero's own title / title + body / two columns / image + text, sized to the
  frame from a 1280 × 720 design; also `frame.applyLayout`), duplicate (right after the original),
  and `FrameElement.skip` — skipped by `present` and unpicked in the PDF export. Speaker notes are
  present's `presenterNotes`, written only through `present.setNote` (present owns them).
- Sticky author labels (KAI-112, `features/sticky/decoration.tsx`): a board setting in the
  `stickyLabels` collection (editors toggle "Show sticky authors" in the board menu). Names come
  from the people lookup (`usePeople`, current names; `useGonePeople` → "Deleted user", never an id;
  "<app> for <person>" for agents). No label while private mode runs nor on a private-layer draft,
  so a draft's author is never shown, exported or screenshotted before reveal; "Anonymous" on a
  note revealed from an anonymous private mode (#44: its author is on no client to look up).
- Images placed by URL (same module, same fetch protections, `remoteImage` rate limit):
  `Host.importImage(url)` (`POST /api/unfurl/image`) copies the image into the user's uploads —
  the image feature does this on paste/drop, so boards reference `/uploads/<key>`, not the third
  party. Boards that still link a third-party image: exports inline every cross-origin `<img>` as
  a data URL first (`engine/editor/remoteImages.ts`, through `Host.fetchImage(url)` =
  `GET /api/unfurl/image`, else a CORS read), and `renderToDataUrl({ onMissingImages })` reports
  what couldn't be read (the export feature says so). Offline sandbox: both reject.
- Pasted text is routed by importer priority, never by features importing each other: shape (40:
  Mermaid source, `looksLikeMermaid` — a header alone on its line — handed to `from-text.insert`)
  → mind map (25: an outline with two or more indentation levels, tabs only as indentation, not
  code; under the selected topic if one is selected) → table (20: TSV / consistent CSV) → embed
  (10: exactly one URL) → sticky (5: a list — mostly bulleted / numbered lines, or short lines that
  don't read as a wrapped paragraph, or `<li>`s in the HTML — and any text while stickies are
  selected) → text box (0: prose).

Files of other tools (`features/import`, KAI-138): `importer.ts` (priority 60: above Mermaid's 40
and the catch-all media importer's 12, below images' 100) takes `.drawio` / mxGraph XML (compressed
pages too) and `.excalidraw` JSON — by name, else by their first bytes — and diagrams pasted from
either app. Both parsers are pure (`lib/drawio.ts`, `lib/excalidraw.ts`, written from the documented
formats) and build `@freero/shared` drafts (`shapeDraft`, `connectorDraft`, `frameDraft`, …: the
same fully specified items the server's structure writes) plus a report of what has no Freero
counterpart. Shapes map to `ShapeKind`s (unknown ones become rectangles with their label, reported),
swimlanes / containers / Excalidraw frames to frames holding their children, groups to one
`groupId` (the outermost), edges / arrows to connectors attached where the file binds them (draw.io
`exitX/exitY` become `at`), freehand and multi-point lines to pen strokes, images to images (stored
first; one that can't be is left out and reported). Everything lands in ONE `transact` +
`createMany` (one undo step) on a free spot near the drop. Untrusted input: files over 30 MB, any
DOCTYPE / ENTITY (no external entities, no entity expansion), compressed pages that inflate past
30 MB (streamed `DecompressionStream`, counted) and more than 2000 items are refused before
anything is added; labels become plain text (HTML labels reduced to their text). A dropped `.freero`
goes to `Host.openBackup` (importer `backup`). Miro import (the person's own token) is KAI-261.

Structure from text and diagrams as code (`features/from-text`, KAI-196 / KAI-119; layout formats:
docs/board-outline.md):
- "Insert from text" lays text out in the BROWSER with `@freero/shared` `layoutStructure`, the
  function the server's insert-structure runs (no round trip; works offline, live preview), puts it
  on `findFreeSpot` near the view with `createMany` (tables, whose cells live outside the elements,
  through `insertElements`), one transaction = one undo step, then fits it into view.
- Mind maps from structure are laid out by `layoutMindTree` (`@freero/shared` layout/mindtree.ts),
  the function `features/mindmap` runs for tidy up / follow / drag: one function, not a copy.
  Org charts and Auto-layout ▸ Tree / Org chart use `tidyTree`; flowcharts and Auto-layout ▸
  Top-down / Left to right use `layered` (`features/arrange/lib/autoLayout.ts`: selected items and
  the connectors joining them, moved with `moveBy` in one gesture; locked items stay put).
- Diagrams (Mermaid, tree, org chart, mind map) keep their source in the `diagramSources`
  collection (owned and undoable by from-text: diagram id → `{ kind, source, ids: sourceKey →
  elementId, laid: elementId → what the last layout wrote }`). "Edit diagram source" re-lays edited
  source onto the same elements (`lib/reconcile.ts`): new and old layout matched by
  `LaidOut.keys`; per field, a value still equal to what the last layout wrote takes the new one,
  anything changed on the board (text, colour, size, a box moved by hand) is kept; lines always
  take the new geometry; mind-map topics take the new order and are tidied; removed source items
  go, locked ones stay. The source is shared board content, so it is kept and editable only while
  the whole diagram is in the shared doc (never for private-mode drafts or inside a hidden frame,
  whose text it would reveal). Limits, by design: the source is not rewritten from board edits; copies of
  a diagram don't carry its source; outline items without a Mermaid id are matched by their path
  of texts, so a renamed topic is a new topic; concurrent source edits of one diagram are LWW per
  diagram (the second update re-lays from its own source).

Reference & items (engine primitives; product UI in `features/shortcuts`, `links`, `image`, `icons`,
`select-similar` — "Select only ▸ <type> (count)" narrows a mixed selection):
- Item type names have one owner: `ElementDefinition.label: { one, many }` and `icon`, set in each
  `element.tsx`. Layers, Find and "Select only" read them through `describeElementType(editor,
  type)` (`@engine`; fallback: the capitalised type and a square), so a new type is named once.
  `defineCommands(({ elements }) => [...])` (a command factory, run once the registry knows every
  element definition) builds commands per type from the live registry — "Select only" lists every
  registered type by its `many` name.
- `Editor.getShortcuts() → ShortcutEntry[]` (`engine/runtime/shortcutList.ts`): every binding the
  board answers for the live role — tool keys, command shortcuts (alternatives with the same label
  fold into one row), element types' declared `keys` (under their feature) and the keys the keyboard router handles itself (`ENGINE_KEYS` in
  `interaction/keyboard.ts`, kept next to the handlers). The `?` sheet renders it with `@ui` `Kbd`
  (⌘ on Apple platforms, Ctrl elsewhere), so the reference can't drift from the real bindings.
- `Editor.listActions() → ActionEntry[]` (same file, same registry as `getShortcuts`): every tool
  and every user-facing command with its shortcuts and, when it can't run now, why
  (`disabledReason`: the role, or the command's `when` + `CommandDefinition.disabledReason`). A
  command is user-facing when it has a `shortcut` or `menus` (`CommandDefinition.palette`
  overrides: `true` for board settings, `false` for the palette's own shortcut); commands only other
  features run with `args` have neither and never show. Grouped labels read as one phrase
  ("Select all of this type"). `CommandDefinition.detail(editor)` is a live suffix in menus and
  the palette ("Sticky notes (12)", "Snap to grid (on)"). The board menu's settings are engine
  commands too (`engine.settings.*`, lists in `engine/editor/boardSettings.ts`), so the palette
  reaches them. The command palette (`features/shortcuts`, `Mod+/` — Mod+K is the item/text link)
  is built on it: fuzzy search (abbreviations inside one word, never letters scattered across
  words), unavailable actions listed greyed out with the reason (Enter does nothing), recent
  actions first (this browser, per user; localStorage, wrapped), an ARIA combobox + listbox, and
  closed while text is being edited.
- `Editor.bringForward(ids)` / `sendBackward(ids)` (`Mod+Shift+]` / `[`; `planStackStep` in
  `geometry/order.ts`): one step past the next item each one OVERLAPS (non-overlapping items
  change nothing visible, so they're passed), never past another selected item, riders with
  their item, frames only among frames. New z values go between the neighbours (no renumbering).
- Exact size and position (engine chrome: "Size and position" in the format toolbar,
  `engine/editor/exact.ts`): X / Y move the whole selection through `moveBy` (one item: its own
  stored top-left; several: their bounding box); W / H / rotation apply to each unlocked item the
  way its handles would (`resize: 'aspect'` keeps the ratio, `'scale'` / `'width-only'` take a
  width only, `'none'` and connectors nothing), growing from the item's own (rotated) top-left
  corner. Typed values land on whole pixels exactly — never grid-snapped, a typed number is meant
  — while ↑/↓ in a field step to the next grid line when "Snap to grid" is on (Shift: five), else
  1 px (Shift 10). Each commit is one gesture = one undo step.
- Mixed selections (`ElementDefinition.sharedStyle(el)` / `applySharedStyle(el, style)`,
  `SharedStyle` = fill, stroke, strokeWidth, strokeStyle, fontFamily, fontSize, textColor, align,
  vAlign): a type reports the keys it has; when the selection holds several types, the engine's
  `MixedStyleSection` (`engine/ui/MixedStyle.tsx`, before the features' sections) shows a control
  for every key two or more selected items have (MIXED when they disagree) and writes ONE
  `updateMany` with each item's patch from its own definition (default: the same-named field), so a
  sticky maps a fill to its nearest paper, a card / mind-map topic to its colour, an icon a line
  colour to `color`, and a text box ignores `fontSize: 'auto'`. Its text colour does not clear
  per-word colours (that would touch types that take no text colour). A new type joins mixed
  editing by defining `sharedStyle` (+ `applySharedStyle` when its fields differ).
- `BaseElement.link` (`@freero/shared`): an item link — an external URL or `#<elementId>`.
  Untrusted; `isSafeHref(href)` (`@engine`) is the one safe-href rule shared with rich text.
  "Copy link to item" (`engine.copyLink`) builds `/board/<id>?item=<elementId>`; the board selects
  and zooms to it on load (`?el=` is still honored).
- `ElementDefinition.onDoubleClick?(el, { editor, point })`: double-click on an element with no
  text to edit there (image → crop mode). Editors only, never on locked items. A container that
  defines it keeps double-clicks on its empty area instead of the canvas's "write here" (timeline:
  add a bar).
- `ElementDefinition.minSize` may be a function of the element (a card drawn as a timeline bar).
- `useGonePeople(ids)` (`@engine`): the ids the people lookup answered without (deleted accounts).
- `useIsExporting()`: true inside offscreen exports/thumbnails, so decorations can leave out
  on-screen affordances (the link badge).
- `ImageElement.crop` (fractions of the natural picture) is the non-destructive crop; crop mode
  is the image feature's `dialog` panel. `IconElement` stores its own drawing (whitelisted SVG
  primitives), so the lucide index (`features/icons/lib/iconIndex.ts`, imported only with
  `import()`) stays out of the board chunk; keep it that way when touching the icon library.

Accessibility, touch and phones (KAI-108, KAI-139; conformance notes: docs/accessibility.md):
- Keyboard walk: Tab follows `readingOrderByFrame` (`geometry/order.ts`: a frame's items right
  after the frame); Alt+arrows jump to the nearest item that way; Alt+Shift+arrows resize
  (`keyResizePatches`, `editor/exact.ts`, inside the nudge burst's undo step); Enter with a
  creation tool "clicks" it on a free spot beside the selection; Shift+F10 / Menu key open the
  context menu at the selection (`ContextMenuState.keyboard`); Alt+F10 focuses the format toolbar;
  F6 cycles `REGION_ORDER` — chrome containers mark themselves `data-fr-region="<name>"`, so new
  chrome joins F6 by carrying one. Arrows move along any `role="toolbar"`, Escape in a region
  returns to the canvas. New engine keys go into `ENGINE_KEYS` (the `?` sheet).
- Spoken descriptions: `describeElement(editor, el)` (`editor/typeLabel.ts`: `label.one` +
  `toPlainText`). `ui/LiveRegion.tsx` + `interaction/announce.ts` read the selection and,
  throttled, collaborators joining / leaving / changing items (`BoardStore.subscribeRemoteKeys`:
  other participants only, never this client's writes or undo/redo; quiet for 2 s after the first
  sync). Never announce from a feature by adding regions of your own.
- `Editor.getOutline()` builds the semantic outline in the browser: the web app now discovers
  features' `outline.ts` too (`FeatureBundle.outline`), so "Board as list" (`features/board-list`)
  and the server's `/outline` read a board identically.
- Reduced motion: `camera/motion.ts` `prefersReducedMotion()` makes `setCamera({ animate })` and
  following jump. CSS animations are cut globally in `ui/base.css`; don't re-enable them per owner.
- Forced colours: tokens switch to system colours (`ui/tokens.css`); a new owner whose state is
  shown only by a background tint or shadow adds a `@media (forced-colors: active)` outline.
- Touch (`interaction/touch.ts` `routePress`, used by `canvas/Canvas.tsx`): palm rejection while a
  pen is down, "pen draws, finger pans" after a pen was used, one finger pans empty canvas with the
  select tool (tap deselects), a 500 ms still press opens the context menu, fingers hit items 14 px
  off (`Editor.hitTest(p, { tolerancePx })`). `@media (pointer: coarse)` enlarges handles/controls.
- Phone layout (≤ 600 px, `ui/compact.ts` `useCompactLayout()`): the board root carries
  `data-fr-layout="phone" | "phone-edit"`; view-and-comment mode shows only tools whose `minRole`
  is commenter or lower, hides the format toolbar, and docks become a bottom sheet; editors toggle
  `UiState.phoneEditing` ("Edit board"). Phone CSS hangs off that attribute, not a media query, so
  JS and CSS can't disagree.

### Installable app (PWA, KAI-140)

`apps/web/public/manifest.webmanifest` + icons (rendered from `freero.svg`; maskable source in
`public/icons/freero-maskable.svg`), and one hand-written service worker, `app/pwa/sw.ts`, built
to `dist/sw.js` by the `freero-sw` plugin in `vite.config.ts` (version = hash of the build's entry
files; it precaches them plus the shell files). Rules, all in `strategyFor` / `respond` (tested):
- `/api`, `/ws`, `/uploads`, non-GET and other origins are never answered or stored by the worker.
- Navigations always go to the network (never cached, so sign-in pages and a deploy's new
  `index.html` are never stale); `offline.html` (no scripts: CSP) when the network fails.
- Hashed `/assets/*` and the shell files are cache-first; old versions' caches go on activation.
- `app/pwa/AppUpdates.tsx` registers it (production only), offers "Reload" when a new version
  waits (`SKIP_WAITING`), and reloads once on `vite:preloadError`. Offline editing is out of scope;
  anything that must work offline is a new decision, not a new cache rule.
- File handler (KAI-218): the manifest's `file_handlers` opens `.freero` files with `/app?restore=1`;
  the dashboard reads the file from `launchQueue` (`app/lib/pendingBackup.ts`) into the restore
  dialog. Share target: `share_target` POSTs a multipart form to `/api/share-target` (server
  `modules/share`: the worker never touches `/api`, the CSRF guard applies as usual — the share
  sheet's request is browser-initiated, a cross-site form is refused); it stores the images as the
  signed-in person's uploads and 303s to `/share`, where they pick a board (`Host.takeShared`).

## Marketing site (`apps/site`, server `modules/site`; KAI-250..253)

The public pages (`/`, `/claude`, `/chatgpt`, `/agents`, `/security`, `/open-source`, `/pricing`,
`/docs`, `/support`, `/privacy`, `/terms`, `/acceptable-use`, `/vs/<slug>`; later `/features/*`, `/use-cases/*`, `/templates/*`) are a separate workspace
so they can be fast, crawlable and free of the app's bundle. Keyword plan: `docs/marketing/seo.md`.

- **Why a custom prerender, not a site generator.** Pages are TSX components rendered once by
  `react-dom/server` (`src/build.tsx`): the same React and TypeScript the app uses, so there is no
  framework to learn or upgrade, and the output is exactly what we write — plain HTML with the CSS
  inlined, no hydration, no client script. Astro would give the same HTML for some 300 more
  packages. The only extra dependencies are the Inter font files (`@fontsource/inter`, OFL-1.1,
  self-hosted) and `@resvg/resvg-wasm` (MPL-2.0, no native code) for the OG images.
- **Pages are discovered, not listed:** `src/pages/**/<name>.page.tsx`, default export
  `definePage({ path, title, description, name, updated, faq?, index?, sitemap?, body })`
  (`src/lib/define.ts`). The build owns everything around the body: `<head>` (title, description,
  canonical, robots, Open Graph + Twitter card), the per-page OG image (`src/lib/og.ts`, original
  design drawn as SVG), JSON-LD (Organization, WebSite, WebPage, BreadcrumbList, FAQPage from `faq`,
  plus the page's own such as SoftwareApplication), the breadcrumbs, the FAQ section, the closing
  call to action, the sitemap entry. Colours come from the app's `ui/tokens.css` (`:root` blocks,
  read at build time), so the brand has one source.
- **Comparisons** (`/vs/<slug>`, `src/lib/compare.tsx` `defineComparison`): every competitor cell
  names its sources, every source its check date; `published: false` pages are `noindex`, out of
  the sitemap and linked from nowhere, and a page can't be published while a competitor claim is
  unverified or unsourced (the build throws). Facts come from `docs/marketing/competitors/` only;
  prose sections (a retirement timeline, moving over) cite sources through the same numbering, and
  the site tests check that every Freero `[docs]` link names a file in the repo. `/vs` lists the
  published comparisons, found from the build's pages (a page body receives `{ pages }`), and the
  footer links it.
- **One build, any deployment.** Pages are built with the placeholder origin
  `https://origin.freero.invalid`; `modules/site` swaps in `PUBLIC_URL` when it serves them (once
  per origin, cached), so the Docker image is the same everywhere. The build writes
  `dist/manifest.json` (pages, files such as sitemaps and robots.txt, the 404 page, the URL prefixes
  the site owns, the hashed-assets directory `/_site`), which is all the server reads.
- **Serving** (`modules/site/routes.ts`, mounted at `/`): `/` → the landing page, or 302 `/app` for
  a signed-in person (`Vary: Cookie`); known pages with `Cache-Control: no-cache` (ETag);
  `/claude/` → 301 `/claude`; a missing page under `/vs/`, `/features/`, `/use-cases/`,
  `/templates/` → the site's 404; `/_site/*` immutable; anything else falls through to the web
  app. `SITE=false` (or no build): `/` → `/app`, nothing marketing, `robots.txt` `Disallow: /`.
  The app's pages are never indexed: `index.html` has `robots noindex` and the SPA fallback sends
  `X-Robots-Tag: noindex`; robots.txt also disallows the app, boards, docs, embeds, the API, MCP,
  auth and invite paths. `SITE_ANALYTICS_SRC` adds an operator's analytics script to marketing
  pages only, with its origin in their CSP.
- **Legal pages** (`legal: true`: `/privacy`, `/terms`, `/acceptable-use`; drafts for legal review,
  written from the code and docs/operations.md's data map) and `/support` put `legal(key)` tokens
  (`src/lib/legal.tsx`) where a deployment's facts go: the operator, address, governing law and
  contacts (`SITE_LEGAL_*`, `ABUSE_CONTACT_EMAIL`, `SECURITY_CONTACT`), retention periods and the
  processors the server is configured with (SMTP host, S3, AI provider, error tracking, analytics).
  `modules/site/legal.ts` fills them when serving, like the origin. **The guard fails safe**: a
  legal page is BUILT as a draft (a "Draft: not in effect" banner and `noindex`), and only the
  server removes both, once `SITE_LEGAL_OPERATOR` is set; until then it also sends
  `X-Robots-Tag: noindex`, and `GET /api/site/legal` answers `null`, so the app's sign-up asks
  nobody to agree to a draft. A page about the deployment never hard-codes a value the server
  knows from its configuration.
- **For agents:** `/llms.txt` and `/llms-full.txt` (llmstxt.org, `src/lib/llms.ts`) are built files
  like robots.txt, origin-substituted when served: what Freero is, the MCP endpoint, OAuth metadata
  and the tool list. Tools and prompts come from `src/lib/mcp.ts` (also the /agents table); the site
  tests fail when it drifts from the MCP server's `tools.ts` / `prompts.ts`.
- **Screenshots** are real: `scripts/site-shots.mjs` drives the built app on a throwaway server
  (accounts, a board, a personal token proposing changes as an agent, a mock Jira) and writes WebP
  files to `apps/site/src/assets/shots/`; `<Shot>` gives them `srcset`, `width` and `height`.
- **Checks:** `apps/site/src/site.test.ts` builds the site and guards what search engines and
  visitors rely on (unique titles and descriptions within limits, one h1, canonical / OG URLs,
  JSON-LD that matches the visible FAQ, sitemaps = indexable pages, robots never blocking a page,
  no page shadowing an app route, no script or foreign resource, alt text and image sizes, no broken
  internal link, the comparison publishing rule); `npm run verify -- --only site` runs it on a real
  server with a real session and with `SITE=false`.

## UI kit (`ui/`) — exports from `@ui`

`Button` {variant: 'primary'|'secondary'|'ghost'|'danger', size: 'sm'|'md'|'lg', icon?, loading?} ·
`IconButton` {icon, label, active?, size?: 32|40, shortcut?, tooltipSide?} ·
`ToolbarButton` {label, shortcut?, wide?, children} (format-toolbar button showing a value — font, size, a color sample; never a native `title`) ·
`Tooltip` {content, shortcut?, side?, children} · `Popover` {open, onClose, anchor: HTMLElement|DOMRect|null, side?, align?, autoFocus?, escapeToContent?, children} ·
`Menu` {open, onClose, anchor, items: MenuItem[]} where MenuItem = {id, label, icon?, shortcut?, danger?, disabled?, disabledReason? (tooltip saying why; give one whenever the reason isn't obvious), onSelect, submenu?: MenuItem[]} | {divider: true} | {heading: string} ·
`Modal` {open, onClose, title, width?, footer?, children} · `Input`, `TextArea`, `Select` {options, value, onChange},
`Toggle`, `Slider` {min, max, step, value, onChange} · `ColorSwatches` {colors, value, onChange, allowCustom?} ·
`Divider` {vertical?} · `Avatar` {name, color, src?, size?} · `AvatarStack` {users, max?} · `Kbd` ·
`Spinner` · `Logo` {size?, withWordmark?} · `ElementsPreview` {elements, moved?, label?} (an SVG picture of content before it lands: AI results, Insert from text) · `ToastProvider` + `useToast()` → `notify(message, kind?, { duration?, action? })` (app only; features use `editor.host.notify`).
Tokens: `ui/tokens.css` (CSS variables `--fr-*`). Plain co-located CSS, class prefix `fr-`.

Popover focus: content focuses itself while mounting (`autoFocus` on an input, or a layout
effect); the popover is focusable from its first commit, so no keystroke reaches the board in
between — never defer focus to the next frame. `escapeToContent` lets an inline editor inside
take Escape first (cancel the edit, `preventDefault`); the next Escape closes the popover.

## Server (`apps/server/src`) — enforced by `scripts/dune-check.mjs`

```
main.ts            Composition root. Discovers modules/* by reserved files at startup (readdir) —
                   no hand-maintained module list.
platform/          Framework: config, db connection + migration runner, http app factory, error
                   handling, ws upgrade dispatch, logging/metrics/health, security, rate limits,
                   Redis, object storage. NEVER imports modules/.                             [S1]
modules/<name>/    auth, boards, members, uploads, realtime …
  index.ts         public API; other modules import only this                                 [S2]
  migrations/      reserved: <YYYYMMDDHHMM>_<snake_name>.sql — Postgres DDL creating/altering the
                   tables this module OWNS. Applied once each at startup, in global timestamp
                   order across modules                                                   [S4]
  repo.ts          the only file that touches the db; the only writer of the owned tables     [S3][S4]
  routes.ts        reserved: export default (ctx) => express.Router, mounted at /api
                   (optional `export const mountPath = '/'` to mount elsewhere — uploads uses it
                   for GET /uploads/:file). Routers are mounted in readdir order, so middleware
                   goes on each route (r.get(path, requireUser, …)): a router-level
                   `r.use('<prefix>', …)` on a prefix another module serves under fails      [S6]
  ws.ts            reserved: export default (ctx) => WsRoute | WsRoute[]  ({ prefix, handle(ws, req) })
  init.ts          reserved: export default (ctx) => void | Promise<void>; runs once after all
                   migrations are applied and routes mounted, before listen (e.g. auth seeds the
                   demo user in non-production and purges expired sessions)
  admin.ts         reserved: export default (ctx) => AdminCommand[] (platform/admin.ts) —
                   operator commands, discovered by the CLI root admin.ts (`npm run admin -- …`)
```

`src/admin.ts` is the second composition root: the operator CLI. It loads the same config, opens
the same database (applies pending migrations like a starting instance), discovers every
`modules/*/admin.ts` and runs one command in its own process, without HTTP. Commands use their
module's service functions, print what they did, and record an audit event (below). On PGlite
(one process) the server must be stopped first; on Postgres it runs next to the instances.

`ctx` (`platform/context.ts`) carries `config` and `onShutdown(fn)` (realtime flushes docs there).
Cross-module imports name the index file explicitly (`'../auth/index'`), which is what [S2] checks.
Auth is a plain middleware exported by `modules/auth/index.ts` (`requireUser`, `currentUser(req)`),
not a reserved hook. Server modules today: `auth` (users, sessions, auth_tokens: email
verification, password reset, email change, session list/revoke, avatars, deletion scheduling;
auth_devices: browsers that signed in (new sign-in notices);
auth_identities + auth_oidc_flows: sign in with a provider; auth_challenges, user_totp,
user_recovery_codes: two-step verification; auth_two_factor_recoveries: delayed "lost my
authenticator" recoveries; guest_sessions: visitors without an account),
`boards` (boards, stars, opens; trash; the guest join routes), `members` (board_members,
board_invites: pending invites for addresses without an account; board_access_requests; role
resolution), `workspaces` (workspaces, workspace_members,
workspace_invites, projects, project_members; see "Workspaces" below), `uploads` (uploads; files in object storage or
`<data>/uploads`), `realtime` (board_docs, board_doc_updates, board_doc_snapshots, board_layers, board_suggestion_authors; y-websocket
protocol + role filter + update log; version history + snapshot retention), `unfurl` (link
previews for pasted URLs; no table; SSRF-safe fetch in `unfurl/fetch.ts`, exported for other
modules that fetch a URL someone else chose — apiauth's client metadata documents), `templates` (saved
templates; content is opaque engine JSON), `outline` (no table: the semantic board read model,
`GET /boards/:id/outline`), `structure` (no table: layout from structure,
`POST /boards/:id/insert-structure`), `accounts` (no table: the purge after the deletion grace
period, orchestrating the owning modules' exports), `notifications` (notifications,
notification_prefs: inbox, live delivery, email digests), `moderation` (moderation_items,
moderation_actions: abuse reports, the operator queue, actions and appeals; see "Moderation"),
`sso` (sso_domains, sso_connections, sso_flows, sso_saml_cache: per-workspace single sign-on),
`scim` (scim_tokens, scim_users, scim_groups, scim_group_members: SCIM 2.0 provisioning under
`/scim/v2`), `privacy` (data_exports: personal and workspace data exports; see "Enterprise
identity and data"), `audit` (audit_events, audit_chains: the append-only audit log), `admin` (no
table: the admin console of team workspaces; see "Audit log, admin console and workspace
policies"), `activity` (board_activity: the activity feed; see "Activity" below), `ai`
(ai_workspace_settings, ai_usage: AI board actions with a provider the operator or a workspace
configures; see "AI" below), `apiauth` (api_tokens,
oauth_clients, oauth_grants, oauth_codes, api_workspace_settings, api_workspace_credentials:
credentials that act for a person without their session), `api` (no table: the public REST API
`/api/v1`; see "Public API and OAuth" below), `embed` (no table: live board views inside AI assistants, `/embed`, `/ws/embed`; see "The MCP server"), `mcp` (no table: the remote MCP server `/mcp`; see
"The MCP server" below), `objects` (no table: the object registry and the one
permission check, `POST /objects/resolve`), `references` (object_references, reference_sources: the
references index derived through the outbox, `GET /objects/backlinks`; both in "Suite foundation"
below), `engage` (engage_answers, engage_questions, engage_upvotes,
engage_reveals: live audience activities; see "Live activities" below), `trackers`
(tracker_connections, tracker_links, tracker_link_sources, tracker_oauth_flows: issue-tracker sync;
see "Issue trackers" below), `search` (search_entries, search_sources: the search index derived
through the outbox, `GET /search`), `events` (events, event_board_states, event_pending_boards: the
event stream), `docs` (no table: the doc app — a doc is a boards container of kind 'doc' whose
document realtime stores; see "Docs and native live embeds"), `site` (no table: serves the built
marketing site at `/`; see "Marketing site"), `webhooks` (webhook_endpoints, webhook_deliveries: workspace webhooks) — the last
three in "Search, the event stream and webhooks" below — `backup` (no table: `.freero` board
backups, see below), `share` (no table: the installed app's share target, see "Installable app"), `walkthroughs`
(walkthroughs, walkthrough_views, walkthrough_comments) and `decisions` (decisions), in "Walkthroughs
and decision snapshots" below.

- Board backups (`modules/backup`, KAI-137; format: docs/board-backup.md): owns no state. A download
  is boards' `authorizeBackup` (downloads policy + audit) → realtime's `boardBackupContent` (the
  shared doc and, for owners/editors, the editors layer as JSON; never private layers or
  suggestions; `Y_LEFT_OUT_OF_BACKUPS` collections dropped) → uploads' `readUpload` for the files
  it references → `format.ts` `buildBackup`. A restore is `readBackup` (size caps before unpacking,
  sha256 of every entry, version check / upgrades, content shape) → uploads' `restoreUploadFile`
  per carried file (checked like an upload, the restorer's quota; deleted again if anything later
  fails) → `remapContent` (fresh item ids wherever they appear as a whole token, upload URLs) →
  realtime's `encodeBoardContent` (a fresh doc from JSON: a file's CRDT history is never replayed) →
  boards' `restoreBoard` (row + doc + editors layer in ONE transaction, `board.backup_restored`).
  A collection whose content means nothing on a new board (a session, server-side state) belongs in
  `Y_LEFT_OUT_OF_BACKUPS` (`@freero/shared` ydoc.ts).

- Notifications are created only from trusted server-side events, never from client claims:
  realtime's `onCommentMessage` (a comment message applied from one of THIS instance's sockets,
  attributed to that socket's authenticated user — a message stored under anyone else's id is
  ignored; each change is reported once across instances), members' `onBoardShared`,
  `onAccessRequested` / `onAccessDecided` (`access.request`, `access.response`), api's control room
  (`agent.blocked`, KAI-249: a task an agent posted moved into Blocked; to the person its credential
  acts for, the app's name as actor), and realtime's
  `onCardAssignment` (KAI-135, `realtime/cards.ts`: a task card's `assigneeId` / `dueDate` changed in
  the shared doc by a socket, a request or a reveal of a private draft — attributed to the socket's
  user, the request's actor or the draft's author; a card arriving from the editors layer is not
  news). `notifications/cards.ts` settles each card's changes for `CARD_SETTLE_MS` (clicking through
  the picker notifies the last assignee once) into `card.assigned` / `card.due_changed`, and keeps
  `card_due_watch`, from which the digest job sends `card.due_soon` the day before (UTC dates) —
  each re-checked on the board as the assignee sees it, one per card and due date. Each
  recipient must have access to the board; the author is never notified; one notification per
  person per message (`dedupe_key`; a mention wins over a reply). Types live in
  `notifications/types.ts` (wording, link, settings label): a new source (workspace invites) adds
  its type there + in `NotificationType` and calls `notify` from `notifications/index.ts`.
  A comment naming the address of someone with a live invite to the board (the @ picker's
  "Invite … to comment") is kept in `pending_mentions`; members' `onInviteAccepted` (invite link
  or verified address) turns it into their `comment.mention`. Kept for an invite's lifetime.
  Live: `/ws/notifications` per tab; changes are published on one pubsub channel and each
  instance pushes the unread count to its own sockets (ended sessions close them everywhere, through auth).
  Email: the `notifications:digest` exclusive job emails everything a person hasn't read after
  `NOTIFY_EMAIL_DELAY_SECONDS` as ONE digest (claim-then-send; a failed send is handed back),
  only to verified addresses, honoring per-type opt-outs and the master switch that the signed,
  session-less unsubscribe link (`List-Unsubscribe` one-click too) turns off.

- Per-user quotas (boards, templates, team workspaces) count and insert in one transaction under
  a per-owner `pg_advisory_xact_lock(hashtext('<module>.quota'), hashtext(userId))`; a
  count-then-insert lets parallel requests overshoot. The board quota is per USER (owner), across
  all their workspaces, not per workspace: it is an abuse limit on a free service, and a
  per-workspace count would multiply with every team someone creates. Receiving a board by
  transfer counts against the new owner (except the account-deletion hand-over, which must not
  lose a team's content).
- Trash: deleting a board sets `boards.deleted_at`; `repo.getBoard`/lists/access treat it as
  gone (sockets refused and closed after the live doc state is stored). Owners restore or delete
  forever; `boards/init.ts` purges after the workspace's trash retention (`TRASH_RETENTION_DAYS`
  unless the workspace sets `trashRetentionDays`) hourly on every instance as a `platform/jobs`
  exclusive job, so replicas never purge at once.
- Periodic jobs: `scheduleExclusiveJob(ctx, { name, lockKey, intervalMs, run })` from an init.ts
  (trash purge, account purge). One instance runs a job at a time (a Postgres session advisory
  lock held for the whole run); jobs must be idempotent, since a run can be cut short anywhere.
- Accounts: `requireUser` answers 403 `{ code: 'account_pending_deletion' }` while an account is
  in its deletion grace period (`requireSession` lets restore through), and `userFromCookieHeader`
  (board sockets) treats it as signed out. Emailed links carry 256-bit single-use tokens stored as
  sha256 and deleted on use (one `DELETE … RETURNING`, so two concurrent uses can't both win).
  Proving an address (verification link, reset, email change, an invite link mailed to it) fires
  `onEmailVerified`, where members turns that address's pending invites into memberships; an
  unverified account never picks up invites and can't invite or share by link.
- Sign-in methods (`modules/auth`): `oidc.ts` is a generic OpenID Connect relying party
  (openid-client: authorization code + PKCE, state, nonce, id-token validation) configured by issuer
  + client id/secret — Google and Microsoft (multi-tenant) today, per-workspace SSO later.
  `providers.ts` holds the account rules: a provider account (issuer + subject) signs in to the
  account it is connected to; it is connected automatically only on a provider-VERIFIED email match;
  accounts without a password always keep a way in. Every sign-in (password, reset link, provider)
  ends in `signIn.ts` `completeSignIn`, which asks for the second step when the account has
  two-step verification on (and connects a matched identity only after it), so no path skips it.
  Passwordless accounts confirm sensitive changes with a recent sign-in (`sessions.auth_at`,
  re-confirmed through the provider with `intent=reauth`) where others give their password.
  `onTwoFactorRequirement` (auth index) is the seam for workspace-enforced two-step verification.
  Session locations come from an operator-provided GeoIP `.mmdb` (`GEOIP_DB_PATH`), read locally.
- Security notices (`modules/auth/notices.ts`, `sendSecurityNotice`): the function that makes a
  security-relevant change mails the owner once (password changed/set/reset, email changed — to the
  previous address, two-step on/off, new recovery codes, provider connected/disconnected, deletion
  scheduled, and a sign-in from an unrecognised browser), with when / device / approximate place
  and what to do. Account mail, not notifications: no opt-out. Never a code, secret or token, except
  links that act for whoever reads a VERIFIED address: the "this wasn't me" link an email change
  sends to the previous address (`revert_email` token, 7 days: it restores that address, sets a
  new password, removes two-step verification and providers set up since the change, cancels
  pending links — except a two-step undo link to that same address — and ends every session), and
  the two-step recovery links below. A browser is
  recognised when it brings a `freero_device` cookie (random, HttpOnly, 400 days) that already
  signed in to the account (`auth_devices`, sha256 only); an account with no browser on record
  recognises one matching a live session's User-Agent and network (so an upgrade mails nobody).
  `startSession` records the browser; signIn.ts mails — not for a just-created account or a reset
  link (the reset notice covers it). A new change to sign-in security adds a `SecurityNotice` kind
  and calls `sendSecurityNotice` where the change is made.
  `npm run verify` runs the whole provider flow against `scripts/lib/mock-oidc.mjs` (a local test
  provider with real signed id tokens) and GeoIP against a generated `.mmdb`.
- Two-step verification recovery (KAI-99, `modules/auth/recovery.ts`) — see the next section.
- Audit seam (`platform/audit.ts`): `audit({ action, actor, userId, detail })` records a
  security-relevant action on an account — today one structured log line (`"audit": {…}`), plus
  every sink registered with `onAuditEvent`. The Enterprise audit log registers its sink there (from
  its init.ts and admin.ts) and keeps its own table; callers don't change. Never passwords, tokens
  or codes in `detail`.
- Ending a session (logout, "sign out" from another device, password reset/change, account
  deletion, suspension, a session policy) goes through auth's `sessionsEnded`, which runs the
  `onSessionEnd` listeners of THIS process and announces the keys on auth's pubsub channel
  (`freero:auth:sessions`), so every instance runs its listeners too — also for the operator CLI,
  which connects to `REDIS_URL` for that. Sessions that vanish without anyone announcing it (raw
  SQL, expiry, a message lost in a Redis gap) are caught by `recheckLiveSessions`: every instance,
  every `SESSION_RECHECK_SECONDS`, checks the session keys of its open connections (registered with
  `trackLiveSessions`) against the database — the rule a new socket is admitted by — and ends the
  missing ones locally (KAI-146). Listeners (realtime's board sockets, notifications' bells) only
  close connections on their own instance — the one way to drop a session's live connections.
- Account purge: owned boards (trash included) and the avatar file are deleted, the user's
  comments elsewhere become "Deleted user" (`realtime.renameCommentAuthor`, through the live room),
  then the user row (cascades). Other files they uploaded stay — images on other people's boards
  are part of those boards — and files nothing references are left to the uploads sweep.
- Uploads sweep (`uploads/sweep.ts`, exclusive job every 6 h): uploads are shared (duplicates,
  templates, pasted copies, avatars), so nobody deletes an upload when one user of it goes away.
  Each module that stores `/uploads/<name>` URLs exposes `…UploadReferences(among?)` from its
  index (realtime: stored doc bases + log + version history, trashed boards included, and the live
  docs of this instance; templates; avatars; board thumbnails), searching its own tables in SQL
  with `UPLOAD_REF_PATTERN`. Files an operator removed are tombstones the sweep never touches
  (see "Moderation"). A round adopts stored files without a row (owner NULL), marks what is
  referenced (`last_referenced_at`), re-checks the candidates right before deleting, and deletes
  rows + files no round has seen referenced for 24 h — freeing quota. New content that stores
  upload URLs outside board docs adds its scan to `SCANS` there. `ObjectStorage.list()` exists for it.
  `UPLOAD_REF_PATTERN` / `FILE_NAME_RE` are built from the one extension list in `uploads/store.ts`,
  so a new upload kind is seen by every scan (and the account purge) without touching them.
- Uploads: what is served how (`uploads/store.ts`, `routes.ts`, `download.ts`; KAI-128). What may
  be served INLINE is an allowlist decided by the bytes, never a name or a declared type: raster
  images, SVG (sandbox CSP), PDF, and video / audio whose container signature `sniffMedia`
  recognises (MP4 / M4A / MOV by their `ftyp` brand, WebM's EBML doc type, Ogg, WAV, FLAC, MP3, AAC);
  they are stored under the type and extension the bytes say. Anything else is an ATTACHMENT
  (`POST /api/uploads?as=attachment`, stored as `<id>.bin`, `application/octet-stream`): never
  served at `/uploads/` at all (404), only by `GET /api/boards/:id/files/:elementId` — the item is
  looked up in the board AS THAT PERSON SEES IT (`readBoardView`: no other board's file, no hidden
  frame's, no one's draft), the workspace's downloads policy applies (`boards.authorizeFileDownload`,
  403 like an export, guests included), each download is audited (`board.file_downloaded`, file
  name + upload), and it goes out as `Content-Disposition: attachment` under the item's own name
  (RFC 5987), `nosniff`, the sandbox CSP and `no-store`. So an uploaded HTML / SVG / script can
  never run as same-origin content. Video / audio answer single byte ranges (`Accept-Ranges`, 206,
  416 past the end; `ObjectStorage.get(key, range)` + `stat`), or redirect to the bucket like
  raster images (the CSP's `media-src` names it; `blob:` is the local file probed for its poster).
  Size caps are per kind (`MAX_UPLOAD_MB` images / PDF, `MAX_MEDIA_UPLOAD_MB`,
  `MAX_ATTACHMENT_UPLOAD_MB`), refused before the body is read when `Content-Length` says so; every
  kind counts toward the one per-account quota. Moderation removal answers 410 on both paths.

### Moderation (`modules/moderation`, KAI-142)

- Reports: `POST /api/reports` (session optional: KAI-43 visitors report too) about a board, an
  element, an upload or a comment. Who may report = who may open the board: boards'
  `reportableBoard(boardId, userId | null)` (a visitor = an outsider with no membership, so only
  what the link gives, capped by workspace policies); everything else gets the same 404 as an
  unknown id. Rate-limited per IP and per user; one open report per reporter and target.
- Operators: a VERIFIED address in `OPERATOR_EMAILS` (`isOperator`), never a database flag. The
  operator API answers 404 to everyone else.
- The moderated STATE lives in the owning modules, written only through their indexes [S4]:
  boards `removed_at` (taken down: `repo.getBoard` and lists treat it as gone like the trash;
  `requireAccess` answers 451 `board_removed` only to someone who could open it otherwise;
  sockets close with `WS_CLOSE_BOARD_REMOVED` through realtime's `remove-board` control message,
  content kept as in `moveToTrash` via `closeKeepingContent`) and `link_blocked_at` (link access
  resolves as 'none' in `repo.toBoard`, once for every reader; the owner's setting is kept);
  uploads `removed_at` + `quarantine_key` (410 on every GET; bytes kept under a key that never
  matches an upload name, so neither served nor adopted; the sweep skips removed rows, so the
  tombstone stays); auth `users.suspended_at` (sessions ended through `onSessionEnd`, sessions of
  suspended accounts never resolve, `startSession`/`completeSignIn` refuse with
  `account_suspended`).
- Reviewing a reported file (KAI-205): `GET /api/moderation/uploads/:name/file` (operators only,
  404 for everyone else) streams the file — or a removed file's kept copy — through uploads'
  `openUploadForModeration`, always `application/octet-stream` as an attachment with nosniff and
  a sandbox CSP, and records `moderation.upload.download` in the audit trail. The queue links
  attachments (`.bin`, never served at /uploads) only there.
- Moderation owns only the queue and the append-only action record; every action is also a
  platform audit event `moderation.<action>` (`platform/audit.ts`, actor = the operator's user). Each action emails its subject a statement of reasons with a signed,
  session-less appeal link (`/appeal?t=`, `mac('moderation.appeal:<actionId>')`) and adds a
  `moderation.action` notification (a `direct` type: emailed by its module, never in digests, no
  email setting). Appeals enter the queue (one open appeal per action).
- Legal hold (KAI-178): a taken-down board is deleted only by the operator's `board.delete`
  (boards' `deleteTakenDownBoard`). The account purge waits (after the hand-over, deleting nothing)
  while the account owns one or is the last member of a team holding one (`countHeldBoards`,
  `handOverTeamWorkspaces` → `held`), and never blocks the accounts behind it; deleting a team
  workspace holding one answers 409 `workspace_board_held`. Removed uploads are detached from the
  account before its row goes (`keepRemovedUploadsOf`). Each action keeps a snapshot of its
  subject (`subject_name`, `subject_email`).
- Suspensions (KAI-180): `user.suspend` with `boards: 'take_down' | 'disable_link'` acts on every
  board the account has in service, each recorded with `parent_id` = the suspension; `user.restore`
  reverses those children not reversed or deleted since (children of the lift). One notice.
- Web: `features/report` (board menu, context menu, `report.open` command for other features —
  comments' flag), `Host.report`; the app's `/operator` queue, `/operator/boards/:id/preview`
  (read-only snapshot through `BoardEngineProps.initialState`) and `/appeal`.

### Workspaces (`modules/workspaces`)

Every board belongs to a workspace (`boards.workspace_id`) and optionally a project in it
(`boards.project_id`). Each user has one PERSONAL workspace (`workspaces.personal_of`; created on
first use by `ensurePersonalWorkspace`, so signup — or any future sign-in path — needs no hook;
deleted with the account row) that only ever holds its owner's boards. TEAM workspaces have
members with roles owner / admin / member / guest (separate from board roles).

- Board access (`members/roles.ts` `resolveRole`, fed by `workspaces.boardAccess`): the board
  owner is owner; otherwise the highest of a direct board membership, team access (owners/admins:
  every board; members: boards not in a private project they're outside of; guests: only private
  projects they were added to) and link access. Link access never exceeds the workspace's
  `linkSharing`; with `externalSharing: 'none'` people outside the workspace get nothing from
  memberships or links. One resolver serves REST, lists and socket admission.
- Team access LEVEL (KAI-93): what team access gives is the policy `teamAccess`
  (editor / commenter / viewer), overridden per project by `projects.team_access` (null: the
  workspace's) — `roles.ts` `teamAccessOf` + `teamRole`. Owners/admins always edit (they
  administer the content); direct board memberships and links still come on top. The share dialog
  shows the level (`BoardSummary.team.access`) and the member list each team member's real role.
- Lists (`GET /boards?workspace=`) are scoped to one workspace the caller is in; `shared` lists
  boards from workspaces they are NOT in that they reach directly; the personal home shows those
  too. A team board never appears for a non-member without a direct invite or its link.
- Writes that need a stable member list (role changes, removal, transfer, deletion) lock the
  workspace row (`FOR UPDATE`); board creation takes `FOR SHARE`, so a board can't land in a
  workspace being deleted. A workspace always keeps ≥ 1 owner (checked under that lock). Moving a
  board into a project shares the project's row lock with project deletion, which refuses while
  the project still holds live boards (their private access would otherwise open up).
- Every change that can alter access (roles, removal, project access/membership, policies, moves,
  transfers) re-resolves the live sockets of the affected boards on every instance through
  realtime's `refreshBoardAccess`. Removing someone also ends their direct board memberships in
  that workspace and hands boards they owned there to the remover.
- Invites by email reuse the board-invite mechanics (`workspace_invites`, sha256 tokens, link
  `/workspace-invite/<token>`, conversion on `auth.onEmailVerified`).
- Policies (team workspaces): `externalSharing` (who may invite people outside / share by link),
  `linkSharing` (max link role), `guestInvites`, `downloads` (who may export, duplicate or save
  as template), `teamAccess` (above), `publicLinks` (whether a link also lets in visitors without
  an account: see "Guests"), `liveEmbeds` (links may open as live frames; enforced by every
  viewer's client, the frames being third-party pages the CSP already confines). All other
  policies are enforced by the endpoint that does the work;
  `BoardSummary.permissions` only tells the UI.
- Team templates (KAI-96): owners/admins of the workspace a template is shared with may unshare
  it (`templates.shareTemplate(id, null)`); workspaces' `onMembershipChanged` (after a removal or
  role change) makes everything someone shared with a workspace personal again when they leave it
  or become a guest there (`templates/init.ts`).
- Ownership: `POST /boards/:id/transfer` (team: to a non-guest member; personal: to a board
  member, moving the board to their personal workspace) and `POST /workspaces/:id/transfer`, each
  one transaction; the previous owner becomes editor / admin. Account purge first calls
  `handOverTeamWorkspaces` (sole-owned teams pass to the longest-standing admin, else member,
  else guest; an otherwise empty team is deleted with its boards; their team boards pass to an
  owner there).

### Enterprise identity and data (`modules/sso`, `modules/scim`, `modules/privacy`)

- **Sign-in restrictions** (`auth/restrictions.ts`, `onSignInRestriction`): every way in asks it —
  signup, password login (before the password is checked: no oracle), reset and "this wasn't me"
  links and personal providers (all through `completeSignIn`, plus before a provider sign-in may
  create an account). sso registers "Enforce SSO" there. A new way of signing in must go through
  `completeSignIn` and so inherits it.
- **Domains**: a team proves a domain with a DNS TXT record (`sso/dns.ts`; resolver injectable for
  tests, `SSO_DNS_SERVERS` for operators, never skipped). Only a VERIFIED domain counts, and one
  workspace at most holds it: it routes sign-ins (`GET /api/sso/discover`, by domain only), lets the
  workspace's IdP vouch for addresses at it, scopes SCIM provisioning and "Enforce SSO".
- **SSO** (`sso/signIn.ts`): SP-initiated only. SAML via `@node-saml/node-saml` (signed assertion
  required, audience = the workspace's entity ID, `validateInResponseTo: always`, assertion-ID
  replay cache — both in `sso_saml_cache`, per workspace, shared by instances, consumed in one
  statement) plus our Recipient check on the verified assertion; claims are read only from the
  verified assertion. OIDC reuses `auth/oidc.ts`. The SAML POST is cross-site (the one
  `allowCrossSitePost` in `platform/security.ts`), so it only parks the verified claims on the flow;
  a same-site GET carrying the HttpOnly cookie set at start finishes it — only the browser that
  started a sign-in can complete it. Account rules: `auth.resolveDirectoryLogin` (identity
  `sso:<workspaceId>` + issuer + subject; else the address's account, connected after its second
  step; else a new verified account) — only for addresses at the workspace's verified domains. A
  newcomer joins with the connection's default role (`workspaces.applyDirectoryMembership`); a
  deactivated member is refused. Session lifetime has ONE model: a session belongs to the person,
  and the strictest session policy of their teams applies to all of it (auth, KAI-51) — SSO has no
  lifetime setting of its own; only the IdP's own end of a sign-in (SAML `SessionNotOnOrAfter`)
  shortens that one session. Enforcing needs a sign-in that went through and an owner as
  break-glass (exempt while still an owner), and ends the domain's non-SSO sessions; pointing the
  connection at another IdP drops enforcement.
- **SCIM** (`scim/`): bearer tokens per workspace (sha256; rotate = swap in one step, or overlap).
  Filters (`filter.ts`) and PATCH (`patch.ts`) are generic over the resource JSON, as Okta and
  Entra send them. Provisioned people are accounts at verified domains; groups map, by admins in
  Freero, to a workspace role (highest wins; once any group maps a role the directory owns
  provisioned people's roles; owners untouched) or a project. Deprovisioning (`active: false`,
  DELETE) is the admin console's deactivation (`workspaces.setDirectoryDeactivated` →
  `deactivated_at`, the `blocked` rule of `resolveRole`: one mechanism; keeps role and boards,
  sockets re-resolved on every instance) and ends all sessions of an organization address. The
  directory's `active: true` lifts it; its routine syncs never lift an admin's deactivation.
- **Data exports** (`privacy/`): this module reads no other table; each owning module exports its
  part from its index (`exportAccountData`, `exportMembershipsOf`, `boardRecords`,
  `exportBoardContent` — shared doc plus only the layers the exporter may read — `commentsWrittenBy`,
  `templatesExportOf`, `notificationsExportOf`, `uploadsOwnedBy`, `scimRecordsOf`, …). New personal
  data in a new module = an export function in its index + a line in `privacy/archive.ts` + a row
  in the data map (docs/operations.md). Archives are uploads' private files (never served at
  `/uploads/`, never swept).
- **Audit** (`recordAudit`, inside the change's transaction): `sso.*` (domains, the connection,
  enforcement, every SSO sign-in and refusal, just-in-time joins), `scim.*` (tokens, group
  mappings, provisioning, deprovisioning — actor null: the directory), `workspace.export_*` in the
  workspace's log; a person's own `account.export_*` only in their account's log (no fan-out).
- **Seams**: `workspaces.onWorkspaceDeletionHold` (legal holds; refused deletion with 409).
- **Admin console**: tabs Single sign-on and Provisioning next to Security; the workspace export
  under Data (pages/admin/AdminIdentity.tsx).

### Request access (`members/accessRequests.ts`, KAI-40)

Someone signed in who can't open a board asks for it (`board_access_requests`: one row per board
and person, so at most one pending request). Deciders are the board's owner, the workspace's
owners/admins and, for a board in a private project, the project's creator while still in the
workspace (`workspaces.boardGatekeepers`). Notified: the owner plus the admins — or, for a private
project's board, the project's creator instead of every admin. Approval is a board membership at
the role the decider picks (`grantAtLeast`: never lowers access); the decision is one conditional
UPDATE, so two deciders can't both win. Outsiders are let in only as the workspace's external
sharing policy allows, like invites. A declined request can be repeated after an hour. The answer
(`access.response`) never names the title of a board the requester can't open. The web request
page waits on the notifications socket (every instance publishes notification changes), so an
approval lets the requester in at once.

### Guests: visitors without an account (`auth/guests.ts`, boards' `/api/guest/*`, KAI-43)

- `auth` keeps WHO a guest is: `guest_sessions` (HttpOnly cookie `freero_guest`, sha256 only,
  `GUEST_SESSION_HOURS`), a name, a color, ONE board. Guest ids start with `guest_` (account ids
  never contain `_`: `isGuestId`). `boards` decides WHETHER a board lets guests in
  (`members/roles.ts` `resolveGuestRole`: the board's link as the workspace caps it, never above
  commenter, only with `publicLinks: 'anyone'` and outside access allowed).
- A guest id resolves through the same `describeAccess` as accounts, and only on the board the
  guest joined, so socket admission, live access refreshes (link turned off → 4403) and layers
  follow the usual path. Expired sessions are purged by a job that ends them through
  `sessionsEnded` (their sockets close on every instance).
- Guests reach only: their board's socket, `/api/guest/*`, the people lookup and the activity of
  their board (`requireUserOrGuest`). Never the member list or emails, notifications, uploads,
  templates or history. Presence names them `guestDisplayName` ("Guest · Kim"); `commentRules`
  refuses any other `authorName` from a guest socket. Their @mentions page nobody and they get no
  notifications; their replies notify thread members with no actor account (`data.actorName`).
- Join is rate-limited per IP (`RATE_LIMIT_GUEST_JOIN`). A workspace that requires two-step
  verification (KAI-51 `blocked`) lets no guest in.
- Moderation (KAI-142) needs nothing guest-specific: an operator's link block makes the board's
  link read as `none` (so `resolveGuestRole` answers no; the refresh drops connected guests) and a
  take-down makes the board stop resolving (guest sockets close with `WS_CLOSE_BOARD_REMOVED`,
  their board page answers 451). Guests report like anyone (`Host.report`, KAI-181) with an
  optional `contactEmail`; a visitor without an account may report exactly what a guest could
  open (`reportableBoard(id, null)` → `guestRoleFor`).

### Share-link password and expiry (`boards/linkProtection.ts`, KAI-145)

- The owner may give a board's link a password (scrypt, auth's `hashPassword`) and an expiry. The
  expiry is applied where a board is read (`repo.toBoard`: `linkAccess` reads 'none' from then on,
  for everyone, like an operator's block); a job (`boards:link-expiry`, every 10 s, one instance)
  re-checks the live sockets of links that just expired, so link-only visitors are disconnected.
- The password depends on who asks, so it is applied by `describeAccess` / `listBoards`
  (`linkAsSeenBy`): the link grants its role only to someone in `board_link_unlocks` for the CURRENT
  password revision (`link_password_rev`, bumped by every change) — a server-side fact, not a
  cookie, so REST, lists, socket admission and access refreshes all agree, and a new password
  cancels every earlier unlock at once (and disconnects those visitors). Memberships, team access
  and ownership never depend on the link. `requireAccess` answers 403 `link_password_required` when
  the link would let that person in after the password; `POST /boards/:id/link-unlock` (and the
  guest join / `/guest/boards/:id/unlock`) check it, rate limited per IP and per board + person,
  refusals audited (`board.link_password_refused`), changes audited (`board.link_protection_changed`).

### Activity (`modules/activity`, `realtime/changes.ts`, KAI-44)

- Sources are trusted server events only: realtime's `onBoardChange` — element changes applied
  from one of THIS instance's sockets (the same updates it appends to the update log), attributed
  to the socket's user or guest — plus `onCommentMessage` and members' sharing events. Private
  layers are never observed; changes in the `editors` layer are stored with audience `editors`
  (owners/editors only); removing a hidden frame's contents from the shared doc (the editors'
  clients moving them into the layer) is not reported; no element text is ever stored.
- The board as a whole (KAI-188), kind `board`, stored at once: boards' `onBoardLifecycle`
  (created, duplicated — on the copy, naming the original —, renamed, moved to a project, trashed,
  restored; fired after the change commits) and realtime's `onVersionRestored` (a version restore
  is applied by the server, so its element changes are never attributed).
- Each person's changes on a board form a BURST in memory on that instance (net per element:
  added-and-removed is nothing, a move between the shared doc and the editors layer is nothing)
  until they pause `ACTIVITY_IDLE_SECONDS` or 10 minutes pass; it is stored as one row per
  kind/audience with counts per element type and the frame they were in, and worded when read.
  Bursts are written at shutdown too. Retention: 90 days.
- `GET /boards/:id/activity` (anyone with access, guests too) and `GET /workspaces/:id/activity`
  (boards the reader can open there). The board panel is `features/activity` (`Host.activity`);
  the dashboard home shows the workspace feed.


### Board outline and layout from structure (KAI-166, KAI-167; format: docs/board-outline.md)

Agents, the API and AI read and write boards semantically, never by coordinates.

- **Reading a board on the server** goes through realtime's `readBoardView(boardId, { userId, role })`
  (`realtime/view.ts`): the live doc (caught up with other instances) plus exactly the layers that
  reader's socket would get — `editors` for owners/editors, their OWN private layer, never another's
  — and, for viewers/commenters, nothing under a hidden frame. Any new server-side reader of board
  content uses it, so access rules have one implementation.
- **The outline** (`modules/outline`, `GET /boards/:id/outline`): `@freero/shared` `buildOutline`
  (pure) over that view, with each element type described by its feature's reserved `outline.ts`
  (discovered from `apps/web/src/features` at startup; the Docker image ships that folder). Then
  `selectOutline` (scope / pages / token budget) and `renderOutlineMarkdown`. Names are resolved only
  for people the board shows (as `/boards/:id/people`). Version = a hash of what the reader sees
  (ETag / 304). Versioning rule: additive within `outlineVersion`.
- **Writing on a request** goes through realtime's `changeBoard(boardId, actor, plan)`: `plan(view)`
  runs against the live board and its `BoardChange` (new elements, field patches, deletions,
  collection entries) is applied in the same step as one transaction per doc — stamped (z above
  everything, `createdBy`, times), published to every instance and saved before it resolves. No
  other module writes board docs. `applyChange` keeps the rules a client would: a deletion takes a
  frame's contents, riders and mind-map branches along; whatever ends up inside a hidden frame is
  written to the `editors` layer (never the shared doc every viewer's socket receives) and moves back
  when the frame is shown; commenters may only write their OWN comment records (`commentRules.ts`,
  the socket's rule). Comment messages written this way are reported like a socket's
  (`onCommentMessage`: mentions and replies notify).
- **Layout from structure** (`modules/structure`, `POST /boards/:id/insert-structure`): `@freero/shared`
  `layout/` (pure, no dependencies; in-house layered graph layout, Mermaid reader, mind map, sticky
  clusters, sequence, table, work items as a grid or a kanban by status — the CSV import of
  `features/csv`, KAI-136, lays rows out with it and creates them with `createMany` in one
  transaction, tags by name through `tags.applyNames`) lays a structure out from (0, 0); `plan.ts` places it on a free spot of
  the view and turns it into a `BoardChange`; `sinks.ts` decides where that goes (`board` →
  `changeBoard`, `preview` → returned for `Editor.insertElements`, `suggestions` →
  `proposeSuggestions`: the same plan, proposed instead of written; KAI-169).
  **Placement by meaning** (`structure/place.ts`, `InsertStructureRequest.placement`): into a frame, a
  kanban column or a cluster (the outline's `cluster:<id>`, found with the outline's own proximity
  rule) or a new frame / kanban — the one place that decides where an agent's items go when it names
  a container; the tracker import (`placeLaid`, `keepStatus`) and `update_items`' `into`
  (`planMoveInto`) use it too, so no caller computes coordinates.
  Both modules expose these through their `index.ts` (`boardOutline`, `insertStructure`): other modules
  (AI, the public API) read and write boards through them, with the caller's own access.

### AI (`modules/ai`, `features/ai`; KAI-101, KAI-102; docs/ai.md)

Off unless configured (`AI_PROVIDER` and/or `AI_WORKSPACE_KEYS`; otherwise every AI route is 404 and
no AI UI shows). One rule decides who may use AI on a board and through which provider
(`ai/access.ts` `decideAi`): edit access; personal boards use the operator's provider when
`AI_INSTANCE_FOR` includes `personal`; team boards need their admins to turn it on (the operator's
provider if offered to teams, or the workspace's own, key sealed with `platform/secrets`), and the
person must pass the workspace's "who may use AI". The app asks `GET /boards/:id/ai` when it opens a
board and builds `Host.ai` only when it says yes.
- **Read** through the outline (`outline/index.ts`, the caller's own view), budgeted
  (`AI_MAX_INPUT_TOKENS`); a selection is the outline filtered to those items. Reading content is
  gated by the workspace's downloads policy (KAI-197): boards' one `requireBoardDownload(…, 'ai')`.
- **Prompts** are server-side templates per task (`ai/tasks.ts`). Board text (and the person's
  instruction) go in delimited blocks as ONE JSON string with `<`/`>` escaped (`encodeUntrusted`), and
  the system prompt says board content is data, never instructions (the KAI-170 boundary).
- **Providers** (`ai/providers.ts`): plain HTTP, Anthropic Messages (structured output with the
  task's JSON Schema) and OpenAI-compatible chat completions. Workspace-typed endpoints are untrusted:
  https only, no redirects, private addresses refused at connect time unless
  `AI_WORKSPACE_PRIVATE_ENDPOINTS`.
- **Validate, then write**: each task turns the model's JSON into a `StructureInput` (clamped, ids
  mapped from numbers the model was shown, Mermaid parsed); one repair turn, then 502 with nothing
  written. The structure goes through `structure/index.ts` `insertStructure` with `target: 'preview'`
  (the app's dialog shows it and inserts it with `Editor.insertElements` + `moveBy`, ONE transaction,
  one undo step) or `'board'` (one attributed server change).
- **Limits and records**: `RATE_LIMIT_AI` per user, `RATE_LIMIT_AI_WORKSPACE` per workspace, the
  workspace's monthly token budget and `AI_INSTANCE_MONTHLY_TOKENS_PER_USER` (`ai_usage`, one upsert per
  call, also for failed calls). Every request that reaches the model is audited
  as `ai.request` (task, provider, model, tokens, outcome; never the prompt or board text); settings
  changes as `ai.settings_changed`. Usage is in personal and workspace data exports.
- `npm run verify --only ai` runs it all against `scripts/lib/mock-model.mjs` (both wire formats,
  canned answers), never a paid API; the same mock runs standalone for the UI (`--port 4402`).

### Public API and OAuth (`modules/api`, `modules/apiauth`; KAI-104, KAI-170, KAI-197)

Scripts, integrations and agents use Freero through `/api/v1` (reference: `docs/api/openapi.json`,
served at `/api/v1/openapi.json`; `api/api.test.ts` fails when the routes, their scopes or their
response shapes drift from it). Versioned: within v1 changes are additive only.

**Why two modules, and why not `auth`.** `modules/apiauth` owns every credential that acts for a
person WITHOUT their session — personal access tokens, Freero's OAuth 2.0 authorization server
(apps, consents, codes, access/refresh tokens) — and each team's API switch. It is a separate module
from `auth` on purpose: sessions, sign-in methods, SSO and SCIM live in `auth`/`sso`/`scim` and
change for their own reasons; tokens are their own lifecycle (scopes, expiry, pause, rotation, an
admin's per-workspace block) with their own tables and a single writer. They meet at two seams in
`auth`'s index: a credential records how the session that made it signed in
(`currentSessionMethod`) and every call re-asks `auth.signInRestriction` with it, so **enforced SSO**
refuses tokens and apps made from a non-SSO sign-in (403 `sso_required`; make a new one after
signing in with SSO) — a credential can't become a way around the policy; and
`auth.onSignedOutEverywhere` (fired by `endSessionsOf` when it ends ALL sessions: password reset,
"this wasn't me", two-step recovery, operator reset, suspension, deletion, a directory
deprovisioning the organization's account) revokes every token and app consent of the account.
`modules/api` is the resource server: no table; its operations (`api/service.ts`, exported from its
index) call the same service functions as the app (boards, members, outline, structure, realtime) —
never a parallel data path — and `routes.ts` is a thin HTTP adapter. The remote MCP server (KAI-107,
`modules/mcp`) is a second resource server next to it: it calls `registerProtectedResource('/mcp',
…)` and `authenticate(req, '/mcp')` and then THOSE operations, so the consent screen, scopes, rules,
audit and admin controls are the same code.

- **Credentials.** 256-bit random secrets with a recognisable prefix (`frp_` personal, `fro_` access,
  `frr_` refresh), stored as sha256 only. Every request looks the credential up (no cache), so a
  pause, revoke, app revocation, workspace switch or block takes effect on the next request. Refused:
  expired / paused tokens, a token for another resource (`resource`, RFC 8707 audience), suspended
  accounts and accounts awaiting deletion. 401/403 carry a `WWW-Authenticate` challenge naming the
  protected-resource metadata (RFC 9728), as MCP clients expect.
- **Scopes** (`API_SCOPES` in `@freero/shared`, one model for REST and MCP): `boards:read`,
  `boards:write`, `boards:suggest`, `comments:write`, `members:read`, `members:write`. Effective
  power = the person's role on the board AND the scope: a viewer's write-scoped token still can't
  write.
- **Suggestions** (KAI-169, see "Suggestions" below): `POST /boards/:id/suggestions` (and
  `/structure` with `target: 'suggestions'`) needs `boards:suggest` and an owner/editor behind the
  token; listing needs `boards:read`; `…/suggestions/accept|reject` need `boards:write`. A token
  with only `boards:suggest` proposes and never writes or decides. The author is the credential
  (`kind: 'app'`, its name, the person it acts for). This is the contract the MCP server's
  `propose_changes` (KAI-107) calls.
- **OAuth server** (`apiauth/oauth.ts`), built to OAuth 2.1 as the MCP authorization spec requires:
  authorization code only; PKCE S256 mandatory for every client; exact redirect URIs (loopback http
  on any port, RFC 8252; https; an app's own scheme; never `javascript:`/`data:`/fragments); codes
  single use (deleted on redemption, even a failed one), 10 minutes; access tokens 1 hour; refresh
  tokens rotate, and a replayed one revokes the whole consent; RFC 7591 dynamic client registration
  (public clients only; unused registrations dropped after a week); RFC 8414 / RFC 9728 metadata;
  RFC 7009 revocation; RFC 9207 `iss` on every authorization response, success or error (one
  `authorizationResponse` builds them all, with the metadata's `issuer`).
  **Client ID Metadata Documents** (#81, `apiauth/clientMetadata.ts`, MCP authorization 2025-11-25 +
  draft-ietf-oauth-client-id-metadata-document): an `https://` client_id is the URL of the app's
  JSON metadata. Only a signed-in person's authorization request fetches it (per-person
  `RATE_LIMIT_OAUTH_CLIENT_METADATA`, one fetch per URL at a time), through unfurl's `safeFetch`
  with `protocols: ['https:']` and `followRedirects: false` — the connect-time private-address guard,
  5 KB, 5 s — after the URL itself passed `checkClientIdUrl` (canonical, path, default port, no
  query / fragment / userinfo / address literal). A document counts only if it answers 200 JSON
  whose `client_id` is that URL as a plain string, with `client_name` and redirect URIs the same
  rules accept as any client's (`redirects.ts`), and no shared secret; public clients only. It is
  stored as an `oauth_clients` row whose id is the URL (`metadata_expires_at`: Cache-Control
  max-age within 5 min – 1 day); failures are never stored, and the token endpoint only ever reads
  the stored row. Its name is the app's claim: the consent screen shows it with the document's
  host (`OAuthConsentInfo.client.host`, in the title too), its client_uri only on that host, no
  logo, and a warning for a loopback redirect (`localRedirect`). The loopback-http exception the
  draft allows for development exists only behind `OAUTH_CLIENT_METADATA_LOOPBACK`, which config
  refuses in production (`npm run verify`'s `api` group uses it). The consent screen is the web app's `/oauth/authorize` (signed in; says which
  app, whether Freero reviewed it — self-registered ones are marked — what it may do and where it
  sends you), and posts the decision same-site with the session cookie. Settings lists tokens,
  connected apps and the apps you develop, with revoke; "Disconnect all apps and tokens" is the
  per-person kill switch, pausing a token the per-token one.
- **Cross-site by design, cookies never.** `/api/v1/*` and the OAuth token / registration /
  revocation endpoints authenticate only with what the caller sends (bearer token, PKCE verifier,
  client secret), never the session cookie (`/api/v1/me` with a cookie is 401). So they register with
  `platform/security.ts` `allowCrossSiteApi(path, reason, cors)`: exempt from the CSRF origin check
  for exactly those paths, CORS for any origin without credentials. The consent decision, token
  management and every other cookie route stay checked.
- **Every call** (`api/routes.ts` `endpoint`): authenticate → the per-credential rate limit
  (`RATE_LIMIT_API_CREDENTIAL`; an app's refreshed tokens share one count) plus the person's own
  limits where the app has them (outline, structure, invites, board creation) → scope → the team's
  API switch and blocks for the workspace it acts in (`apiauth.useInWorkspace`, which also records
  the credential for the admin console) → the same service call as the app → one `api.call` audit
  event (endpoint, status, credential id and name, items touched) in the board's workspace log, else
  the account's. A workspace member's deactivation (console or SCIM) closes that workspace's boards
  through `resolveRole`'s `blocked`, so their tokens stop there on the next call too.
- **Agent safety (KAI-170).** Board text is untrusted: every response carrying it has `notice`
  (`UNTRUSTED_CONTENT_NOTICE`), the Markdown outline keeps its header line, and board text never
  appears in names, descriptions or errors the API writes itself. Destructive calls (delete a board,
  bulk delete, deleting an item that takes others along) need `confirm=true` or change nothing
  (400 `confirm_required`). Creates are capped per call (`API_MAX_ITEMS_PER_CALL`) and refused whole.
  Kill switches: `PUBLIC_API=false` (instance), "API & apps" in the admin console (workspace:
  off, or block one token/app there), revoke-all (person), pause/revoke (token).
- **Agents as participants (KAI-168).** A credential acts as "<app> for <person>": `ActingApp`
  (`@freero/shared`: the OAuth app, or the personal token by name) rides on realtime's `BoardActor`
  through `changeBoard`, which stamps it on what it creates (`createdVia`; copies made in the app drop
  it), reports the change for the activity feed like a socket's (`RequestOrigin`; its own burst,
  worded "Claude for Maria", KAI-207 — every request write, the app's insert structure included) and
  `showAgentPresence` shows the app for a few seconds as a server-published presence (its own user
  id, cursor and selection on what it wrote; sockets can't publish `agent`). Each credential has its
  own write budget (`RATE_LIMIT_AGENT_WRITE`), apart from the person's editing.
  Sockets can't claim attribution either (KAI-222, `realtime/attribution.ts`): inside the
  transaction that applies a socket's update (shared doc and layers), an element it ADDS gets
  `createdBy` = the socket's user and no `createdVia`, unless the room already knows the element
  (in another of its docs — a move into a hidden frame or private mode — or removed within the last
  hour — an undo), which keeps the attribution it had; an element it CHANGES keeps its `createdBy`,
  `createdVia` and `createdAt`. The sender is sent the correction (like the facilitation guards).
  A new draft in a private layer while private mode is anonymous gets `ANONYMOUS_AUTHOR` instead
  (#44, see "Board layers"); no socket can claim that marker.
- **Reads follow the downloads policy (KAI-197).** The outline, items and comments are a
  machine-readable copy of the board, so boards' `requireDownload` (the one check exports,
  duplicates and templates use) refuses them with 403 `downloads_restricted` and records
  `board.download_refused` with `via`. Writes (items, structure) are not gated by it.
- **Items** (`api/items.ts`): created with the shared layout kit's fully specified drafts (they
  render exactly like the tools' elements), on free space unless the caller gives x/y, in the frame
  under their center (the app's rule), connectors attached by item id; patches only take fields the
  type has, re-apply the frame rule on moves and move a frame's contents with it. Saved templates
  seed new boards through `changeBoard` (the board is empty, so element ids are kept).
- **GDPR**: a person's export carries `api.json` (their tokens without secrets, the apps they
  authorised and the apps they registered), from `apiauth.apiDataOf`.

### The MCP server (`modules/mcp`, KAI-107; docs/mcp.md)

- `POST /mcp`, Streamable HTTP with the official v2 SDK (`@modelcontextprotocol/server` +
  `createMcpHandler`, pinned, zod 4 for its schemas), **stateless**: each request builds its own
  server for its credential (authenticated afresh, no cache) and answers JSON — no session, no
  stream — so it runs behind round-robin balancing and a revoked token, app or workspace switch
  refuses the very next request. Both protocol eras are served per request: 2026-07-28 requests
  carry their own envelope, 2025-era ones get a fresh stateless transport. `GET`/`DELETE` answer
  405. `npm run verify` drives it with the v1 client SDK (`@modelcontextprotocol/sdk`, root
  devDependency — what most deployed hosts still speak), the unit tests with the v2 client.
- Tools (`tools.ts`) are outcome-shaped and call `modules/api`'s operations with the request's
  credential; each checks its scope first (refused as a tool error naming the permission) and is one
  `api.call` audit event (`MCP <tool>`). Board text only ever travels in the untrusted envelope
  (`content.ts`); names, descriptions, instructions, prompts and errors are Freero's own words.
  `propose_changes` is registered only when `structure.structureTargets()` has the suggestions sink
  (KAI-169).
- **MCP Apps** (KAI-171, `mcp/apps.ts`, docs/mcp.md "Live boards in the conversation"): tools name a
  `ui://` view in `_meta.ui` (`registerAppTool` / `registerAppResource` of ext-apps). The views are
  static HTML in `mcp/views/` (no build, no third-party code; `bridge.js` is the view side of the
  postMessage protocol). `get_board_outline` → the preview, which draws the outline its result
  carries (`_meta["freero/outline"]`, enveloped) and declares no domains; `open_board` → the live
  view, which frames Freero's `/embed/board/:id` (`frameDomains` = Freero's origin only) with a
  single-use ticket in `_meta["freero/live"]` (not for the model). `share_board` is `visibility:
  ["app"]`: the view's Share button.
- **Control room** (KAI-172, `api/controlRoom.ts`, MCP `post_status` / `get_feedback`, prompt
  `control_room`, template "Agent control room"): an agent's lane is plain board content found by
  its titles (*Plan · A*, *Status · A*, the *Tasks · A* kanban with To do / Doing / Done / Blocked;
  the heading rules are `@freero/shared` `controlRoom.ts`, read by the server and the web alike);
  tasks match by the agent's `externalId` (stored on the card, `CardElement.externalId`: a renamed
  task keeps its card), else by title (idempotent), moves use the kanban's column geometry
  (`KANBAN_LAYOUT`) and grow the kanban. Feedback is a diff against the opaque cursor the agent holds
  (card → column it last saw, comment messages seen), so its own changes are never reported and
  nothing is stored. KAI-249: a task moving into Blocked is an `agent.blocked` notification for the
  person the credential acts for (actor: the app's name). **Pausing** is board state a person writes:
  `features/controlroom` owns `agentPauses` (lane kanban id → who paused; in `Y_KEPT_ON_RESTORE`); the
  server only reads it — `api/pause.ts`, checked by `agentWrite(call, board)` before every write of
  the credential on that board (its lanes: named like it or `createdVia` it) and by `postStatus` for
  the lane it writes — and refuses with 423 `agent_paused` before anything changes. No API writes
  that collection, so an agent can't resume itself. REST twins: `/api/v1/boards/:id/control-room`.
  `post_status` returns `laneId`, which a workspace webhook can be scoped to (below).
- **Live views (`modules/embed`, no table).** apiauth mints the ticket (`api_embed_tokens`:
  per tool call, bound to one board and to the app's grant or the personal token — deleted with
  them — and to `maxRole` from the connection's scopes); `POST /api/embed/redeem` turns it, once,
  into a short-lived token; `ws.ts` (`/ws/embed/boards/:id`, token as a WebSocket subprotocol) admits
  the socket through realtime's `admitSocket` with `Admission.maxRole` (applied on every access
  refresh too) and the session key `embed:<sha256>`; `init.ts` re-checks those keys every
  `SESSION_RECHECK_SECONDS` (credential, account, API switch / block) and ends the ones that may no
  longer stay open. Realtime hands auth only the keys without a ':' (auth's own). The web side is
  `app/embed/EmbedBoardPage` + `createEmbedHost` (`Host.syncProtocols`). Framing: platform
  `allowFraming(path, reason)` gives `/embed/` the `frame-ancestors` of `MCP_APP_FRAME_ANCESTORS`;
  every other page stays `'none'`.
- **Connect page** (#80, `app/pages/connect/`, `/settings/connect`; linked from settings, the empty
  dashboard and the board menu's `features/connect`): the MCP URL comes from the server
  (`GET /api/mcp/connect` → `appUrl`, i.e. `PUBLIC_URL`), never from `window.location`, so it is the
  audience tokens are bound to. Per-client setup is built in `clients.ts` from the vendors'
  documented formats (sources in its header; the install links are tested by decoding them as the
  client does). "Connected" = the credential's `lastUsedAt` (apiauth stamps it in `authenticate`);
  the page polls while open. No new state: apps and tokens are apiauth's.
- Scopes: `MCP_SCOPES`; read + suggest by default — `registerProtectedResource(…, { optInScopes })`
  makes the consent screen offer `boards:write` / `comments:write` unticked (`OAuthConsentInfo.scopes[].optional`,
  the decision's `grant`). `/mcp` is the `root` resource: the bare `/.well-known/oauth-protected-resource`
  describes it.

### Suite foundation: the outbox, one permission check, object addresses and references (KAI-147, KAI-148, KAI-149)

Every Freero object is a live, permission-checked, linkable thing, so what a board produces
doesn't die at a hand-off. Three primitives carry that: the API, the MCP server, embeds, search and
later apps use them instead of re-implementing access or indexes.

**The outbox and derived indexes** (`platform/outbox.ts`, KAI-148). The one way a change in one
module reliably makes something else happen (a derived index, a webhook, a cleanup another module
owns):
- `appendOutbox(topic, key, payload?)` inside the transaction that makes the change: the event
  commits with it or not at all. In-process `onX(fn)` events called after a commit lose the work
  when the process dies right there; new reliable reactions use the outbox. (The existing
  in-process events — members' sharing events, `onCommentMessage`, `onBoardChange`, `onSessionEnd` —
  stay: they feed live, best-effort delivery (notifications, activity bursts, socket closes) that
  is either re-derived elsewhere or harmless to miss; moving them means replacing their in-memory
  state, a change of its own. `workspaces.onMembershipChanged` → templates' unsharing was moved.
  Board lifecycle and membership changes are ALSO appended to the outbox now — `board.events` and
  `board.members`, in the change's transaction — for the event stream and search, below.)
- `consumeOutbox(ctx, { name, topics, lockKey, handle })` from an init.ts. Every instance polls
  (1 s, and right after a local commit that appended: `afterCommit` in `platform/db.ts`); each
  consumer runs on ONE instance at a time (advisory lock). It reads in `(txid, id)` order only up to
  the oldest running transaction (`pg_snapshot_xmin`), so an event committed late by a slow
  transaction is never skipped, and moves its cursor (`_outbox_cursors`) only after `handle`
  returned: at-least-once, resumable anywhere. Backpressure: batches of `batchSize`, coalesced to
  the newest event per key, a few batches per run; `wakeDelayMs` gathers a burst into one batch.
  A failing batch is retried, then handled event by event, and an event that still fails is
  skipped and counted (`freero_outbox_skipped_total`). Events are pruned once every consumer
  passed them and they are a day old, or after a week regardless.
- Consumer rules: idempotent — recompute the derived rows of the event's KEY from the CURRENT
  source (never apply the event as a delta); stamp them with the batch's `version` (a sequence read
  with each batch, higher than any before on any instance) and never let a lower version replace a
  higher one; derived rows are HINTS — every read re-checks the reader's live access (objects
  below), so a few seconds of lag never exposes anything. Each derived index has a rebuild from the
  source (an admin command, run under `whileConsumerPaused`).
- The platform's own tables (`_outbox`, `_outbox_cursors`, `_outbox_derive_version`) are created by
  `platform/migrations/` (same naming and immutability rules; discovered with the modules').

**One permission check** (`modules/objects`, KAI-147). `can(actor, action, ref)`,
`filterObjects(actor, action, refs)`, `accessOf`, `summarizeObjects`, `resolveObjects(actor, uris)`.
Actions are `view < comment < edit < manage`. The registry decides nothing itself: each OWNING
module registers its types from its init.ts (`registerObjectType`) and keeps its rules —
boards: `board` and `element` (an item or frame, addressed within its board) through
`describeAccess` / `resolveRole` batched for many boards (owner, membership, team access, link,
policies, `blocked`, guests on their one board); an item only as the reader's `readBoardView`
shows it (no hidden frame's contents for viewers, no one's draft). templates: `template` (the
template list's visibility rule). workspaces: `workspace` (guest view, member edit, admin manage;
deactivated: nothing) and `project` (projects' `canSee` / `canManage`). A handler answers a whole
batch in a fixed number of queries (`objects.test.ts` asserts 200 refs cost what 10 do). Purpose
`'discover'` (backlinks, search) leaves out boards reached ONLY through their link that the reader
never opened — otherwise an index would hand out the ids a link protects; `'open'` (the reader
holds the address) counts link access, as the board page does. Docs (KAI-162) are type `doc`,
answered by boards next to `board` (each type only for its own kind). A new object type =
a handler in its module + a type in `OBJECT_TYPES`; nothing else changes.

**Object addresses** (`@freero/shared` `objects.ts`, KAI-149): `freero://board/<id>`,
`freero://board/<id>#<elementId>`, `freero://template/<id>`, `freero://workspace/<id>`,
`freero://project/<id>`, `freero://issue/<linkId>`, `freero://walkthrough/<id>` (web:
`/board/<boardId>?walkthrough=<id>`), `freero://decision/<id>` (web: `/decision/<id>`). `parseObjectUri` also reads the web URLs people copy
(`<origin>/board/<id>?el=<item>`, for the app's own origins: PUBLIC_URL and the request's) and the
same-origin paths item links store; `objectRefsInText` finds them in content.
`POST /api/objects/resolve` (≤ 200 per call; guests too) answers each with a summary (title, type,
item kind and board, preview, path, the reader's access) or `unavailable` — the same for "no
access" and "no such object", and nothing else, so content carrying addresses never tells its
readers whether a target exists or what it is called.

**References and backlinks** (`modules/references`). Every saved change of a board's shared
content appends `board.content` (realtime's repo, same transaction as the update-log row). The
`references` consumer re-derives that board from its SAVED doc as every reader sees it
(`realtime.storedBoardView`: no layer, nothing under a hidden frame): item links (`link`: `#id` or
another board's address), smart links and link cards whose address is a Freero object (`embed`),
addresses in any text field of an item (`mention`) and in comment messages (`comment`, on the item
the thread is pinned to); `object_references` per source board, replaced whole, with
`reference_sources.version`. `GET /api/objects/backlinks?uri=` needs view access to the target (404
otherwise) and lists only sources the caller may open now (`'discover'`); a board's backlinks
include its items'. Trashed sources vanish at once (access), deleted ones cascade.
`npm run admin -- references:rebuild [<board>]` re-derives from saved content.

**Web.** `features/smartlink`: a pasted address (this app's board / item URL or `freero://…`) becomes
an `objectlink` element that stores ONLY the address; the chip resolves the title for each viewer
on every view (`Host.resolveObjects`, batched per frame, 15 s cache), shows "No access" otherwise,
and its open button glides to an item on the same board or opens the target. Item links (KAI-54)
and link cards are indexed as they are. The share dialog's "Linked from" lists the other boards
pointing at this one that the viewer can open (`app/components/LinkedFrom.tsx`).

### Search, the event stream and webhooks (KAI-151, KAI-141, KAI-150, KAI-105, KAI-227)

**Search** (`modules/search`). An index of what each board SAYS — its title, the text of its items
(frame titles, table cells, a kanban's columns, a card's fields, tags, connector labels) and its
comment messages — in `search_entries`, Postgres full-text search with the `simple` configuration
(no stemming or stop words, so every language works the same, and PGlite has it). Each word of a
query matches as a prefix and all must match; query syntax people type is only ever words
(`searchTerms`), so no input can change the query's shape.
- **Derived through the outbox**, like references: `board.content` (every saved change) and
  `board.events` (renames) re-derive the board from its SAVED shared content as every reader sees it
  (`realtime.storedBoardView` → `outline.outlineOfView`, so each element type reads through its
  feature's `outline.ts` and a new type is searchable the day it has one). Rows replaced per board,
  versioned; `npm run admin -- search:rebuild [<board>]`.
- **Layers are skipped, not indexed per audience**: private drafts and hidden frames' contents are not
  in that view, and a comment thread pinned to an item that isn't (inside a hidden frame) is left out
  although its records sit in the shared `comments` collection. So the index holds exactly what every
  reader of a board sees, the only question per reader is "may they see this board?", and a snippet
  can never come from content they can't see. Indexing per audience (editors searching hidden frames,
  an author their drafts) would need rows per reader group; not worth it for content hidden on
  purpose. Hiding isn't retroactive anyway: what was in the shared doc stays findable until the next
  derivation (seconds).
- **Reading** (`searchFor`): candidates are the boards the reader could reach (boards'
  `boardIdsReachableBy`: their workspaces, memberships, boards they opened), the FTS query runs over
  those, and each page's boards go through `summarizeObjects(…, 'discover')` — the live check, so
  someone removed from a board finds nothing of it on the very next query, and a board reached only
  by its link counts once they opened it. Titles in results come from that live summary; snippets
  (`ts_headline`, highlights as offsets) from the index.
- **Surfaces**: `GET /api/search` (the dashboard's "Board names / Inside boards" tabs, results grouped
  by board, each opening `?el=<item>` or `?thread=<thread>`), `GET /api/v1/search` and MCP `search`
  (both through `api/objects.ts`: boards of workspaces closed to the credential and boards whose
  downloads policy keeps their content from the person are left out — search results are board
  text). `RATE_LIMIT_SEARCH`. KAI-227 adds `POST /api/v1/objects/resolve` and
  `GET /api/v1/objects/backlinks` (MCP `resolve_links`, `find_backlinks`) on the same registry: an
  item's title (its text) is blanked where the downloads policy applies.
- **Later**: semantic search adds an embedding column to `search_entries` (pgvector), filled by the
  same consumer only when an AI provider is configured; `searchFor` is the seam that merges both.

**The event stream** (`modules/events`, docs/events.md, contract `docs/events.schema.json`). One
ordered record of what happens to boards, fed only through the outbox: `board.events` and
`board.members` are recorded as they are; `board.content` marks the board pending, and once its saved
content was quiet for `EVENTS_SETTLE_SECONDS` (at most a minute) the `events:derive` job compares it
with what it saw last (`event_board_states`: a fingerprint per item, the comment messages) into
`item.created / updated / deleted` and `comment.created` — recompute, not patch, so a drag is one
update and a replayed batch changes nothing (`events.source_key` is unique). A board the stream never
saw is a silent baseline; a new board starts empty (its first items are news). Every recorded event
appends `event.recorded` to the outbox in the same transaction: consumers (webhooks; later the inbox
and feeds) follow that topic with their own cursor. Notifications and the activity feed stay on the
in-process events for now (live socket attribution, per-instance bursts).

**Webhooks** (`modules/webhooks`, admin console "Webhooks"). A team's owners/admins register endpoints
with event types and a format (`json` signed with HMAC-SHA256, `slack`, `teams`); the URL and secret
are sealed at rest (`platform/secrets`), the secret shown once, the URL shown shortened; changes are
audited (`webhook.*`). The fan-out consumer queues one delivery per event and endpoint (unique), only
for boards every full member of the workspace can open through team access (workspaces'
`openToWholeTeam`: no personal boards, no private projects — not even ids leave). The
`webhooks:deliver` job sends due deliveries (SSRF-safe like unfurl and AI endpoints: https only, our
own DNS lookup refuses private addresses at connect time, redirects never followed), retries with
4× backoff, and turns an endpoint off after `WEBHOOK_DISABLE_AFTER_FAILURES` failures in a row
(audited, its creator emailed); deliveries wait until it is back on. `WEBHOOKS=false` removes it all.
An endpoint may be **scoped** (KAI-249, `webhook_endpoints.board_id` / `item_id`, set from a board or
item link): one board's events, or only item and comment events about one item and what sits
directly in it — events carry `containerId` (the item's `frameId`; `item.deleted` from the stored
state) for that — e.g. an agent's control-room lane. A scope's board must be one the whole team can
open, and a scope never widens (no foreign key: a board that is gone just sends nothing).

### Walkthroughs and decision snapshots (`modules/walkthroughs`, `modules/decisions`; KAI-133, KAI-161)

**Walkthroughs** are not screen videos. `features/walkthrough` records the narrator's voice (and
camera, optional) with the browser's own `MediaRecorder` and, on the same clock, a TIMELINE of the
world rectangle their screen showed and where their pointer was (`lib/timeline.ts`:
`TimelineRecorder` stores a still view once and again just before the next move, so playback holds
instead of drifting). Playback re-renders the LIVE board: every frame the camera is set from the
recording's own `currentTime` (`viewAt` + `cameraShowing`, which fits the narrator's rectangle into
any screen), so view and voice can't drift; the viewer's own pan/zoom (`camera-user`) takes the
camera back and the bar offers "Back to …'s view"; pause leaves the camera alone, play returns to
the path. Viewers see the board as THEY may see it now (hidden frames stay hidden). Keyboard: the
bar is a region (Space/K, ←/→, J/L, Home/End, C captions, F back to the view, Esc) and the scrubber
a native range. No third-party recording service, no screen capture. Overlay controls carry
`data-fr-interactive` (else the canvas takes the pointer).

- The recording is an ordinary upload of its author's (`Host.walkthroughs.create` uploads it, then
  `POST /boards/:id/walkthroughs` takes only the caller's own video/audio upload): quota, size cap,
  byte sniffing, range requests, moderation removal (410; the player says so and offers "Report").
  `walkthroughUploadReferences` is in the uploads sweep's `SCANS`: deleting a walkthrough (or its
  board, or its author's account — a recording is their voice, maybe face: CASCADE) leaves the file
  to the sweep. Downloading it (`GET …/walkthroughs/:wid/download`) goes through
  `authorizeFileDownload` (the workspace's downloads policy, `board.file_downloaded` audit);
  streaming it for playback is viewing.
- Anyone who may open the board watches (guests too; only accounts are counted, once each, never
  the author); editors record; commenters comment; the author, editors and owners rename, caption
  and delete.
- Comments are pinned to moments and live with the walkthrough (`walkthrough_comments`), not in the
  board's comment threads. `<@userId>` mentions notify through `notify` (`walkthrough.mention`,
  checked against board access; the author gets `walkthrough.comment`), linking to
  `/board/<id>?walkthrough=<wid>&t=<ms>` — `walkthrough.play`'s `urlParam` (it reads `t` from
  `args.query`).
- Captions: typed (`PUT …/transcript`), or made by the board's AI provider only (`modules/ai`
  `transcribeRecording`: `decideAi`, budgets, downloads policy, `AI_TRANSCRIBE_MODEL` on an
  OpenAI-compatible endpoint; docs/ai.md). Never a browser speech API (it sends audio to the vendor).
- Open boards learn about changes through the server-written `walkthroughs` collection
  (`SERVER_WRITTEN_COLLECTIONS`, `Y_KEPT_ON_RESTORE`): a summary per walkthrough (title, length,
  counts), never the media URL or the timeline. An object: `freero://walkthrough/<id>`, with the
  board's access.

**Decision snapshots** freeze the board (or one frame) under a name. The content is a board version
of kind `decision` (realtime `freezeBoard`: the LIVE doc, every instance; never pruned by retention;
listed in version history with a stamp; renaming it there keeps it a decision; deleting the
decision demotes it to a named version). A frame decision keeps the whole shared board in its
version (restoring it from the history must not wipe the rest) and serves only that frame on every
read (`frameOnlyState`: the frame's items at any depth, their element content, lines whose both
ends are inside; a hidden frame can't be frozen). Only the SHARED doc is ever versioned, so a
decision — unlike ordinary versions, which are editors-only — is readable by whoever may open its
board, including people who join later: it is a deliberate publication of what everyone could see.
`/decision/:id` renders it read-only with `BoardEngine initialState` (`createDecisionHost`) next to
"What changed": both sides as everyone sees them, through the outline (`diffOutlines` in
`@freero/shared`: added, removed, changed text / fields / tags / frame). An object:
`freero://decision/<id>` (smart links show "Frozen <date>").

### Docs and native live embeds (KAI-162, KAI-152, KAI-124)

A doc is a collaborative document next to boards (`freero://doc/<id>`, page `/doc/<id>`): a PRD,
decision record or write-up, with live board frames inside it and live docs on boards.

**One container, two kinds.** A doc is a row of `boards` with `kind = 'doc'` (`boards.kind`,
`'board' | 'doc'`; `BoardSummary.kind`, `ObjectKind`). Every access rule is a property of the
CONTAINER — owner, members and invites, team access and private projects, link role, password and
expiry, guests, request access, trash and retention, transfers, quotas, moderation, workspace
policies — so a doc is shared, requested, trashed and taken down by the same code as a board, and
`/api/boards/:id/*` (summary, rename, members, link, versions, access requests) serves it too.
Considered and rejected: a `docs` table of its own, which would have forked every one of those
rules (or needed a generic grants table first). The object registry answers `board` and `doc` from
boards, each only for its own kind, so `freero://board/<doc id>` resolves to nothing.
`modules/docs` (no table) holds only what a document has: create (from Markdown, next to a board:
its workspace/project when the person may create there), export as Markdown (downloads policy,
audited `doc.exported`), append Markdown (the API). Its audit target is `{ type: 'doc' }`;
`doc.created` replaces `board.created`.

**One Yjs doc per object, the same rooms.** realtime serves `/ws/docs/:id` next to `/ws/boards/:id`
from the SAME rooms, persistence (base + update log, compaction), version history and retention,
Redis fan-out and access refreshes — the "board doc" is an object doc keyed by the container id.
A socket of one kind never opens the other kind (refused like no access). Docs have no layers
(they withhold nothing from their readers); layer messages on a doc socket are ignored. Layout
(`@freero/shared` docs.ts): `getXmlFragment('document-store')` in BlockNote's ProseMirror node
layout through y-prosemirror (the name La Suite Docs and OpenProject use: the document model stays
compatible), plus the boards' `comments` map — a thread's `elementId` is the BLOCK it is on, so
commenter rules, @mention notifications (links open `/doc/<id>?thread=`), the purge's rename and
data exports are unchanged. Every room types the fragment up front, so nothing reads it as a map;
restoring a version replaces it as one change (comments kept). `realtime/docContent.ts` reads and
writes the fragment on the server in the editor's own node layout (`readDocBlocks`,
`writeDocBlocks`); `@freero/shared` `docToMarkdown` / `markdownToDoc` are the one Markdown
conversion (browser import/export, API, MCP, data exports' `doc.md`).

**Derived indexes.** Every saved change raises `board.content` like a board's; search and
references branch on the kind (`boards.objectKindsOf`): a doc's rows are its blocks and comments
(hits open `/doc/<id>?block=<block>`, `SearchHit.objectKind`), its references are link targets,
live board embeds (`embed`), addresses in text and comments, with the block as the source; sources
are checked as what they are. The uploads sweep needs nothing: it scans the same stored documents.
Not yet: doc-specific event types (the stream records a doc's lifecycle and comments as a board's).

**Web.** `engine/store/ObjectDocStore`: another object's Yjs doc on its own socket (the reader's
access to THAT object), its own undo history (the editor's) — undo on a board never touches a
doc, and the other way round. `engine/docs`: `DocEditor` (BlockNote core, MPL-2.0, pinned; never
the XL packages or Tiptap Pro; loaded with `import()` on first use — `npm run check:licenses` fails
on copyleft, source-available or unknown licences and on those packages by name), `useObjectDoc`,
`useObjectDocState`, the comment record helpers. The page is `app/pages/doc` (comments panel,
version history with read-only previews from a local copy, Markdown in/out, share, request access).
Host addition: `Host.docs` (`syncUrl`, `create`, `exportMarkdown`, `requestAccess`).

**Native live embeds (KAI-152).** The host stores a reference, never a copy, and the target
renders with its own components from its own doc and connection, permission-checked on the
target itself:
- A board (or frame) in a doc: block `boardEmbed` (`props.uri` = `freero://board/<id>[#<frame>]`;
  the slash menu's "Live board", or a pasted board/frame link). The page resolves it with the
  reader's access and shows `LiveBoardView` (`@engine`): a separate engine session with its own
  socket to that board — the server admits it with the reader's role there and sends only what
  that role may read — drawn with the board's own element definitions, fitted to the frame,
  read-only and non-interactive (edits happen on the board). No access: a "No access to this
  board" card with Request access.
- A doc on a board: element `doc` (`features/doc`, `uri` = the doc's address only). It renders the
  doc live (`useObjectDoc` with `Host.docs.syncUrl`; editable in place after a double-click when
  the server says the viewer may edit THE DOC, else read-only; "Open" goes full page). No access:
  a "No access to this doc" card with Request access. Off-screen items are unmounted and items
  under 30% zoom are cards, so a board connects only for docs on screen. Markdown files and pasted
  Markdown with headings become docs next to the board (importer 30); a pasted doc link shows it.
- Embeds never nest without end: a board shown inside an embed is `Host.board.embedded`, and doc
  items there are cards.

### Issue trackers: one issue ↔ many items, kept in step (`modules/trackers`, KAI-153..157; docs/trackers.md)

The stickies-to-tickets hand-off without losing fields: board items become ONE issue (a cluster) or
one each in Jira (Cloud v3 / Data Center v2), Linear or GitHub, and stay linked both ways.

- **Model.** A *connection* is a team's (its admins manage it, its full members use it) or one
  person's own; credentials and the webhook secret are sealed (`platform/secrets`), never sent back
  or logged, and a person's own are erased on `auth.onSignedOutEverywhere`. A *link* is one issue ↔
  its items (`tracker_link_sources`, ordered; an item is in at most one link), the person whose
  access writes the tracker's changes (`created_by`; paused while they can't edit), and `base`:
  each field's canonical value on each side when they last agreed.
- **Providers** (`providers/*.ts`, one file each behind `TrackerProvider`): auth headers, who-am-I,
  projects, get / create / update / search issues, `changedSince` (polling), backlinks, how a tag
  becomes a label, and webhook verification. Plain HTTP (`http.ts`): untrusted addresses (https,
  no private addresses unless `TRACKER_PRIVATE_ENDPOINTS`, no redirects, size caps), retries with
  backoff honouring `Retry-After`; a longer wait sets the connection's `cooldown_until`.
- **The mapping and the merge are pure** (`@freero/shared` `trackers.ts`: `issueValuesFromBoard`,
  `pullableFields`, `canonical`, `mergeField`). Per field against `base`: one-sided changes flow
  across; the same field changed differently on both sides in one window keeps the tracker's value
  and the board's goes into a comment on the item; a field a side can't hold (a cluster's title)
  is never written back. The server previews with the same code the send uses.
- **One sync path** (`service.ts` `syncLink`), run only by the `trackers` outbox consumer, so a link
  never syncs twice at once: read the issue, read the items from the live board as the linking
  person sees them, merge, write the tracker, write the board through `changeBoard` ("Jira for
  Maria", one transaction: field patches, the badge record, notes), refresh backlinks, store the new
  base. Triggers only enqueue `tracker.sync` (`link:<id>`): `board.content` events whose items
  differ from `base` (read from the SAVED board), verified webhooks (`/api/trackers/webhooks/:id`,
  `allowCrossSitePost`; a delivery only names the issue — it is read back), the `trackers:poll` job
  (polling connections every `TRACKER_POLL_SECONDS`, webhook ones as a fallback, retries due).
  Webhook signatures are checked over the raw JSON body (`platform/http.ts` `rawBody`).
- **The board side**: the server writes each item's `trackerLink` and one `TrackerIssueRecord` per
  link in the `trackers` collection (key, status, assignee, sources, state); `features/trackers`
  draws the badge from it (a copy of a linked item shows none: the record doesn't list it) — live
  for everyone through Yjs, kept on version restore (`Y_KEPT_ON_RESTORE`). `BoardChange.collections`
  entries set to `null` delete (owners/editors), so unlinking removes the record. A card whose status
  comes from the tracker moves to the kanban column with that status (`KANBAN_LAYOUT`, shared with
  the kanban feature). The board side of a send is ONE server change (nobody ever sees part of a
  cluster linked); like any change the server makes it is not in anyone's Ctrl+Z — "Unlink" undoes it.
- **Suite primitives**: an issue is an object, `freero://issue/<linkId>` (its board's access); the
  references index adds kind `tracker` from items to it, so its backlinks are its items. Every sync
  that changed something is `tracker.synced` in the audit log (fields each way), failures
  `tracker.sync_failed`; the activity feed shows sends, imports, pushes and failures
  (`onTrackerActivity`). MCP `sync_to_tracker` is `api/service.ts` `syncToTracker`; MCP
  `import_from_tracker` and REST `POST /api/v1/boards/:id/trackers/import` (#79) are
  `importFromTracker`, which calls trackers' own `importIssues` (the UI's rules; `opts.via` makes
  the cards the app's, `preflight` runs the agent pause / write budget before the tracker is asked)
  or, for a suggest-only credential, `importCandidates` + the structure module's suggestions sink
  (plain cards linking to their issues: nothing is linked until an editor imports them).
- `npm run verify -- --only tracker` runs it all against `scripts/lib/mock-jira.mjs` (Cloud, DC,
  Atlassian OAuth), `mock-linear.mjs` and `mock-github.mjs`, which implement the subset of each
  public API used, webhooks included.

### Audit log, admin console and workspace policies (KAI-48, KAI-47, KAI-51)

**Audit log** (`modules/audit`). Every module records security-relevant changes with
`recordAudit({ action, workspaceId?, accountId?, actorId?, target?, metadata? })` from
`audit/index.ts`, where the change is made — inside its transaction when it has one, so the
change and its record commit together. IP and user agent come from the request context
(`platform/requestContext`); pass `actorId` explicitly (jobs have no request). An account's own
events (`accountId`: sign-ins, failed sign-ins on an existing account, sessions, password, email,
two-step, providers, deletion) go to the account's chain `u:<id>` AND to every team workspace the
person is a member of (not a guest: a guest's account is their own). Workspace events go to
`w:<id>`. Actions and their wording are `AUDIT_ACTIONS` in `@freero/shared`; a new kind of event
adds itself there. `platform/audit.ts` (`audit(…)`) is the seam for account events raised where the
module isn't the natural call and for the operator CLI: modules/audit registers its sink from
`init.ts` AND `admin.ts`, so operator two-step resets and moderation actions land in the same log
(a moderation action about a board also in that board's workspace).
- Append-only: no update/delete path in the app; a database trigger refuses UPDATE, TRUNCATE and
  any DELETE outside retention (which sets `freero.audit_prune` for its own transaction).
- Tamper-evident: per chain, events are numbered (`seq`) and hash-linked (sha256 over the event and
  the previous hash, `audit/chain.ts`); `audit_chains` holds the newest seq/hash and the newest
  pruned one, so an edited row, a gap, a dropped newest event or oldest events removed outside
  retention all show when the chain is checked (admin console "Integrity", `npm run admin --
  audit:verify <workspace>`). Someone with database write access could rewrite a whole chain and
  its head; the head hash shown to admins (and in every export) is what they anchor elsewhere.
- No foreign keys: the log outlives the workspaces, boards and accounts it names. Actor names are
  resolved when read (a deleted account reads "Deleted user"); targets keep the label they had.
- Retention (`audit:retention` job, hourly): each workspace's `auditRetentionDays`, accounts' own
  chains and deleted workspaces' `DEFAULT_AUDIT_RETENTION_DAYS`; only ever a chain's oldest events.

**Admin console** (`modules/admin`, web `/admin/:workspaceId`): owners and admins of a team
workspace, checked on the server by every route (`requireAdmin` → `workspaces.requireWorkspace(…,
'admin')`). Members (two-step status, last activity, boards, role, deactivate/reactivate), usage,
security and retention settings, sharing policies, the audit log (filters, paging, CSV/JSON export
— streamed, rate limited, recorded before it starts, CSV cells can't become formulas). Other modules
add their own tabs with their own routes under `/workspaces/:id/admin/…`, checked with
`admin/index.ts` `requireAdmin` (SSO and provisioning; AI, shown only when the server offers AI).

**Workspace settings** (`workspaces` columns; `WorkspaceSettings` in `@freero/shared`), each
enforced by the module that owns the data, wired from that module's `init.ts`:
- Deactivated members (`workspace_members.deactivated_at`) and the two-step requirement close the
  workspace's boards: one rule, `BoardWorkspaceAccess.blocked`, which `resolveRole` honours before
  anything else — not even a board's owner opens it then. The two-step requirement applies to
  everyone who opens the workspace's boards (members, guests, invited outsiders) and is registered
  with auth's `onTwoFactorRequirement`, so members can't turn two-step off; whoever turns the
  requirement on needs it on themselves. `WorkspaceSummary.blocked` tells the dashboard why.
- Session lifetime / idle timeout: **a session belongs to a person, not a workspace**, so the
  strictest limits of the team workspaces someone is a member of (not as a guest) apply to all of
  their sessions (`workspaces.sessionLimitsFor`, given to auth with `setSessionLimits`). Auth checks
  each request (forced re-login: the session is deleted and the request answers 401); the
  `workspaces:session-policy` job (every minute) ends the idle and expired ones everywhere, closing
  their sockets. Edits over a board socket count as activity (`auth.noteSessionActivity`).
- Trash retention: boards' purge job; version-history retention: realtime's prune job (above);
  audit retention: the audit job. All idempotent, one instance at a time.

### Two-step verification recovery (KAI-99, `modules/auth/recovery.ts`)

The problem: someone with the password turns on two-step verification with THEIR authenticator.
The owner still reads the account's address, but a reset link proves only the address, and every
sign-in ends in the second step (`completeSignIn`), so the owner is locked out. The opposite case
needs a way back too: the owner lost their own phone and recovery codes. Freero is a hosted
service with no support staff for the common case.

**Threat model.** Three things can prove who someone is: the password (P), the mailbox of the
account's address (M) and the second factor (F: the authenticator or a recovery code). Attackers:
- *P only* (a reused or phished password): must never get in, nor remove F, nor lock the owner
  out for good.
- *M only* (a compromised mailbox): today M alone resets P. Once the owner has F, M alone must not
  remove it — except in the short window right after F was set up (before that, M alone was
  already enough).
- *P + M*: can do anything the owner can, except pass F. Two-step verification can't stop them
  for good — the owner could have lost F the same way — so it buys TIME and NOTICE: removing F
  takes days, is mailed repeatedly, and the owner stops it by using F once.
- *F only* (a stolen phone): useless without P or a provider sign-in (unchanged).
- *Social engineering an operator*: the operator path checks identity beyond M (docs/operations.md).
- *Notice spam*: starting a recovery takes P (or a connected provider) and is rate-limited.

**Options weighed.** (a) A "this wasn't me" link in the two-step-on notice: precise for the
lockout (the owner acts the moment it happens) but, while it works, M alone undoes a real
enrolment — so it must be short and bound to that enrolment. (b) A delayed, self-service recovery:
covers a lost phone and a lockout noticed late, but by itself is either too weak (M alone starts
and finishes it) or useless against the lockout (whoever holds F cancels it). (c) An operator reset:
handles the contested cases neither can, but costs staff time, so it must be the exception.
(d) A delay before a new authenticator is enforced at sign-in: rejected — it weakens every real
enrolment for days to help only the lockout, which (a) already covers without that cost. The
decision is all three of (a)–(c), each closed against the attackers above:

| Path | Who can start | Who can finish | Removes | Window |
|---|---|---|---|---|
| (a) undo link (`two_factor_undo`) | — (mailed at enrolment, only to a VERIFIED address) | M, while the address is still the one it went to, for THIS enrolment only (`enabled_at` bound) | F, providers; sets P | `TWO_FACTOR_UNDO_HOURS` (72) |
| (b) delayed recovery (`auth_two_factor_recoveries`) | a pending sign-in whose first factor is P not set through an emailed link, or an already-connected provider | M (link mailed when ready) | F, providers; sets P | `TWO_FACTOR_RECOVERY_DELAY_SECONDS` (7 days) |
| (c) operator (`npm run admin -- two-factor:reset`) | an operator after an out-of-band check | M (a reset link) | F, providers, P | immediate |

Rules that make the table hold:
- **(a) only the enrolment it announced.** The link stores the enrolment's `enabled_at`; once that
  authenticator is gone or replaced, the link does nothing. It is only sent to a verified address
  (whoever reads an unproven one may not be the owner). While the address differs from where it went
  (the intruder then changed the email), it refuses without being used up; the email change's own
  "restore my address" link — to the same mailbox — keeps it alive, so the owner restores the
  address first and then removes the authenticator.
- **(b) needs two of P, M and time, and loses to F.** `users.password_via_link_at` marks a password
  chosen through an emailed link (reset, "this wasn't me"): it proves M, not P. Such a password, a
  reset-link sign-in or a provider that is only now being connected can't start a recovery
  (`recovery_needs_password`), so M alone never starts one; the finishing link goes only to the
  address, so P alone never finishes one. Any accepted second-factor code (sign-in, turning it off,
  new recovery codes) cancels a recovery in progress and clears the mark — the factor isn't lost.
  So do a signed-in device (Settings) and the cancel link in the mails. Mails: started (with cancel
  link), "completes soon" a day before (cancel link), ready (finishing link, 7 days), completed or
  cancelled. The job (`auth:two-factor-recovery`, exclusive) claims each mail before sending it, so
  it goes out once across instances. One recovery per account; `RATE_LIMIT_TWO_FACTOR_RECOVERY`
  per IP and per account.
- **Taking an account back is one operation** (`repo.takeBack`, one transaction): new password
  (none for the operator), two-step verification and every provider sign-in removed (an intruder
  who planted an authenticator may also have connected their own Google account; the owner
  reconnects theirs), pending links cancelled except the email change's way back, then every
  session ended through `endSessionsOf` (so board sockets close) and a notice to the address.
- **(c) leaves the address as the only way in**, mails how to choose a password, and is logged
  through the audit seam with the operator's name and stated reason. Its identity check must not
  rest on M alone (see docs/operations.md).

Residual risks, accepted and documented: for `TWO_FACTOR_UNDO_HOURS` after enrolment the account
is as strong as before it (M suffices — as it did a minute earlier); P + M removes F after the
recovery delay if the owner ignores three mails and never signs in with F; once the undo window
has passed, an intruder who planted an authenticator can keep the owner out of (b) — by changing
the password (the owner's reset-link password can't start one) or by signing in with their
authenticator (that cancels it) — and that contested case goes to (c). Live board tabs of sessions an
operator ended from the CLI close at once with `REDIS_URL`, else within `SESSION_RECHECK_SECONDS`
(KAI-146).

New sign-in factors or recovery paths keep this table true: say who can start and finish them in
P / M / F terms, and add their row.

### Database (`platform/db.ts`)

- One async API for both drivers: `query<T>(sql, params) → rows`, `one<T>(…) → row | null`,
  `exec(sql)` (multi-statement, no params), `tx(fn)`. Placeholders are `$1, $2, …`. Only `repo.ts`
  files (and platform/, main.ts) import it [S3]. Module tests use `platform/testing.ts`
  (`openTestDb()`: in-memory PGlite with every migration applied) — never the db directly.
- Types: ids/text `text`, instants `timestamptz` (repos convert to/from epoch ms: `new Date(ms)`
  in, `.getTime()` out), counters `bigint` (read as JS numbers), binary `bytea` (Yjs state).
- `tx(fn)`: every query run while `fn` runs — through the handle it gets OR any repo's module-level
  `query` — joins the transaction, so a service can make several modules' writes atomic (boards'
  duplicate = board row + realtime's doc row). Rule: never await, inside `fn`, work that was
  started outside it and queries the db (on PGlite, one connection, that deadlocks) — read first,
  then open the transaction (see `duplicateBoard`).
- Every route/service is async; express handlers go through `handle(async (req, res) => …)`. The
  shape of reserved files does not change. Async opens races the sync driver hid: write single
  statements instead of read-modify-write (`UPDATE … SET x = COALESCE($2, x)`), let constraints
  decide uniqueness (map `isUniqueViolation(e, '<constraint>')` to the 409 you would have sent),
  and treat `isForeignKeyViolation` as "the parent was deleted meanwhile" (404).
- Ownership: child tables reference their parent with `ON DELETE CASCADE` (deleting a board
  removes its members, stars, opens and doc); add an index for every column a repo looks up by.
- Migrations are immutable once applied: the server refuses to start if an applied file changed
  (checksum; CRLF/LF does not count). Fix forward with a new, later file. Startup applies all
  pending ones in ONE transaction under a Postgres advisory lock, so several instances can start
  at once; a failing migration leaves nothing behind. [S4] checks that a migration only
  ALTERs/DROPs/indexes/writes its own module's tables and REFERENCES only tables created by an
  earlier migration. The platform's own `_` tables (the outbox) come from `platform/migrations/`,
  applied in the same global timestamp order as module 'platform'.
- Startup fails fast (before listening) with a plain message when Postgres is unreachable, a
  migration fails, or another process already uses the PGlite directory (`<dir>.lock`). Graceful
  shutdown: stop sockets → `ctx.shutdown()` (realtime saves every loaded doc) → close the pool.
- Old dev data: `npm run db:import-sqlite` copies a pre-Postgres `data/freero.db` into the
  current database (idempotent; never modifies the SQLite file).

### Platform services (production foundation)

Configuration, deployment and operations are documented in `docs/` (configuration, deployment,
operations). What a module needs to know:

- **Config** (`platform/config.ts`): the only reader of `process.env`. New setting = a typed field
  validated in `loadConfig` + a row in `docs/configuration.md` + `.env.example`. Modules read it
  through `ctx.config` / `getConfig()`.
- **Every request** already gets: a request id (`X-Request-Id`), one structured log line
  (`platform/requestLog.ts`), a latency observation, security headers + CSP
  (`platform/security.ts`), the CSRF origin check on non-GET requests (except paths registered with
  `allowCrossSitePost` / `allowCrossSiteApi`, each with its stated reason), the per-IP `api` rate
  limit and the JSON body limit. `requireUser` records the user (`setRequestUser`), so logs and
  per-user limits know who asked. Log with `log`/`logError` (`platform/log.ts`, pino); never log
  request bodies, cookies or tokens.
- **Rate limits** (`platform/rateLimit.ts`): `rateLimit('<name>', 'ip' | 'user')` on a route (put
  `'user'` limits after `requireUser`), or `await consumeRateLimit(name, key)` for other keys
  (login also limits per email). Names and defaults live in config (`RATE_LIMIT_<NAME>`); a new
  abuse-prone endpoint (password reset, invites by email, exports) adds a name there and uses it.
  429 + `Retry-After` comes for free.
- **Files** go through `platform/storage.ts` (`storage().put/get/delete`: S3 or local disk), and
  only `modules/uploads` uses it; other modules call `saveUpload`/`deleteUpload`. Board content
  always references `/uploads/<key>`, whatever the backend. `S3_SSE` (KAI-143) adds server-side
  encryption to every write, both areas; startup warns when the bucket has no default encryption.
  The encryption-at-rest baseline (what is sealed, hashed or left to storage encryption, and why):
  docs/deployment.md "Encryption at rest", docs/operations.md "Encryption baseline". A new secret
  stored in a table is sealed (`seal`, its own purpose) or hashed — never plain — and joins that list.
- **Email** (`platform/mail.ts`): `sendMail({ to, ...renderMail({ subject, title, paragraphs,
  action, outro }) })` — SMTP with `SMTP_URL`, else the dev outbox (`<data>/outbox/*.json`, which
  `npm run verify` reads to follow links). `renderMail` escapes everything; links via
  `appUrl(req, path)`. Never log bodies (they carry tokens). `sendMailLater` when the answer must not
  depend on (or wait for) the mail.
- **Secrets** (`platform/secrets.ts`): the only user of `SESSION_SECRET` [S5]. `seal/unseal(purpose,
  …)` encrypt data at rest (AES-256-GCM, key = HKDF(secret, purpose)); `mac/macMatches(message)`
  sign values (prefix the message with its purpose). New values always use the current secret;
  values made with one in `SESSION_SECRET_PREVIOUS` are still accepted (`unseal` says `stale`, so
  the owner stores it sealed again), which makes the secret rotatable (docs/operations.md).
- **Background jobs** (`platform/jobs.ts`): `scheduleExclusiveJob(ctx, { name, lockKey, intervalMs,
  run })` runs on every instance's timer but one at a time (Postgres advisory lock); jobs must be
  idempotent. `runExclusive(lockKey, fn)` for a one-off.
- **Outbox** (`platform/outbox.ts`): `appendOutbox(topic, key)` inside the change's transaction,
  `consumeOutbox(ctx, consumer)` from an init.ts — reliable reactions and derived indexes (see
  "Suite foundation"). `afterCommit(fn)` (`platform/db.ts`) runs a nudge once the caller's
  transaction committed.
- **Metrics** (`platform/metrics.ts`): `histogram`/`counter`/`gaugeFn` register module metrics
  (`freero_<module>_…`; see `realtime/metrics.ts`). Readiness of a new external dependency:
  `addReadinessCheck(name, fn)` (`platform/health.ts`).
- **Shutdown**: SIGTERM → `/readyz` 503 for `SHUTDOWN_DRAIN_SECONDS` → sockets closed →
  `ctx.onShutdown` hooks → Redis/DB closed; a watchdog exits after 20 s more.

### Realtime ordering rules (`realtime/rooms.ts`)

A socket's messages are queued from the upgrade on and replayed when it joins (auth, access and
the doc load are async; y-websocket sends sync step 1 immediately). A room loads its doc once;
sockets arriving meanwhile wait for that load. Saves of one room are serialized. A room unloads
only when nobody is in it, joining it or saving it. Deleting a board first closes its room and
waits for in-flight saves. Access refreshes are serialized (the last reflects the latest state).

Storage (`realtime/docStore.ts`): a board's document is a compacted base (`board_docs`) plus an
append-only log of Yjs updates (`board_doc_updates`); a save appends only what changed since the
previous one. Loading reads base + log in one statement (one consistent snapshot). Compaction (when
a loaded board's log grows, and after a room unloads) folds the rows it read into a new base and
deletes exactly those rows, guarded by the base's `version` (optimistic lock), so neither a save
nor another instance's compaction running meanwhile is lost. Full-state snapshots
(`board_doc_snapshots`) are the base of version history (`listBoardSnapshots` /
`loadBoardSnapshot` in `realtime/index.ts`; REST in `realtime/routes.ts`): an automatic one at most
every `FREERO_SNAPSHOT_EVERY_MS` (30 min), taken by compaction and, while a board stays open, by its
room on a timer — one period after the first change, then once per period while changes keep coming
(KAI-82). Every instance holding the board may try; the "newest snapshot old enough?" check and the
insert run under the base row lock compaction takes, so one instance takes each. Snapshots have a
`kind`: `auto`, `named` (never pruned), `before-restore`. Retention
(`realtime/retention.ts`, job in `realtime/init.ts`, hourly on every instance under an advisory
lock): non-named snapshots keep the newest per hour for a day, per day for a month, per week after;
buckets are epoch-aligned, so a run is idempotent, and a snapshot is only ever deleted in favour of
a newer one the same plan keeps. A workspace's `versionRetentionDays` adds `maxAgeMs` to the
policy (`realtime/init.ts` through `RetentionPolicyFor`): unnamed snapshots older than that go,
even a board's only one; named versions never.

Work done for a REQUEST or a job rather than a socket (duplicate, trash, naming or restoring a
version, the account purge's comment rename) goes through `withLiveRoom` (`rooms.ts`): the board's room is loaded on the handling instance
(held like a joining socket, unloaded as usual after) and caught up with every other instance
holding it — it sends a sync-request and waits for one sync-reply per other subscriber of the
board channel (`subscribedInstances`, Redis `PUBSUB NUMSUB`; 2 s cap). So `snapshotBoardDoc` is
the board as collaborators see it, including edits not saved yet anywhere (KAI-73). Closing a
board's rooms (trash, delete) saves what each instance's sockets changed before dropping the doc
(for a deleted board that save finds no board and is dropped).

Several instances (`platform/pubsub.ts`: Redis pub/sub with `REDIS_URL`, in-process otherwise;
messages in `realtime/peers.ts`): every instance holding a board publishes its own sockets'
updates and presence on the board's channel and applies the others' with `REMOTE_ORIGIN` (relayed
to its sockets, never re-published or saved: the instance whose socket made a change saves it). A
room subscribes, loads, then asks the other instances for what the database lacks (sync-request /
sync-reply, also after a Redis reconnect). Presence from another instance never overrides a client
id owned by a local socket (a client that moved here). A room that applied remote changes appends
what the database still lacks before it unloads. Access refreshes, board deletion and logouts go to
all instances on a control channel. `npm run verify` with `DATABASE_URL` + `REDIS_URL` runs two
instances and checks all of this with clients on each.

Trust boundaries in `realtime`: presence from a socket may only write the awareness client ids
that socket announced, and its `user` is always replaced by the authenticated user's profile
(`realtime/awareness.ts`), so nobody can appear as someone else. Commenters may write only the
`comments` map, and in it only what they own (`realtime/commentRules.ts`, checked per key against
the server's doc): their own messages and reactions, threads they started (and their tombstones),
deleting a thread/message together with its tombstone. Resolve/reopen (`s:`) is shared workflow
state anyone who may comment can set (attributed via `by`); anyone may detach a pin whose element
is gone. Tombstones are final. A commenter's message carries their own name (KAI-187): a guest's
"Guest · <name>"; an account's current name, a previous one (`users.previous_names`: a tab opened
before a rename elsewhere) or a name taken while connected (`auth.onProfileChanged` refreshes the
sockets on every instance before the rename answers); an edit may keep the name the message had.
Account names never start with "Guest ·". Readers show the author's CURRENT name from the people
lookup (`usePeople` + `@freero/shared` `commentAuthorName`, in comments and find), the stored one only for ids nobody answers
(deleted accounts: "Deleted user") — so an editor's record, a rename or an old forged name never
reads as someone else. Owners and editors are trusted with the whole doc. Ending a session — logout,
"sign out" from another device, password reset/change, account deletion — fires
`auth.onSessionEnd` on every instance (auth announces it; see "Ending a session" above); realtime
closes every board socket opened with that session (4401) on its own instance. The
account purge rewrites the deleted user's comment authorship to "Deleted user" through the live
room (`renameCommentAuthor`), so open boards update and the save queue persists it. Member emails
(`GET /members`) are only sent to owners/editors.

**Facilitator controls** (KAI-129, `realtime/facilitation.ts`, next to the comment rules): the
`facilitation` collection holds at most one `FacilitationSession` (`@freero/shared`), and the
server reads it. While it runs, every EDITOR socket except the facilitator's is limited (the board
owner never is): a socket's `role` in `rooms.ts` is its EFFECTIVE role — its access as limited by
the session — recomputed whenever the session or the access changes and sent to the client in the
role message with `limits` (`RoleMessage`, `SessionLimits`). A locked board makes participants
commenters (comments only; no layer writes); `allowedTypes` limits what they may ADD. Forbidden
adds, and changes of the session by anyone but its facilitator or the owner, are undone INSIDE the
transaction that applies the update (`changedKeys` reads the values the transaction replaced), so
nobody else ever receives them and the sender is sent the correction — dropping the update instead
would leave every later update of that client pending on the server forever. "Adding" = an id in
none of the room's docs and not removed from one in the last 30 s (a move between the shared doc
and a layer arrives as two updates in either order). A participant's write that raced the lock is
dropped and lands when the lock ends (the room asks the newly writable client for what it lacks),
never during it. Requests go through the same rule (`applyChange` refuses for a limited actor).
The room ends the session (`SERVER_ORIGIN`) when the facilitator has had no socket here and no
presence from another instance for `FREERO_FACILITATOR_GRACE_MS` (30 s). Following the facilitator
and hidden cursors are views each client applies (`features/facilitation`); not enforceable.

**Vote budget** (KAI-210, `realtime/votingRules.ts`, same compensation in the same transaction,
shared doc and every layer doc): a socket may write only its OWN ballot (`${sessionId}:${userId}`,
matching fields) for the RUNNING session, with at most `votesPerUser` votes; a session needs
`VOTES_PER_USER_MIN..MAX` and keeps its budget for its id; deleting is always allowed (a new vote
wipes everyone's ballots). Readers still cap a ballot at the budget (`countedVotes`) for values
older than the rule.

Session features built on these pieces (KAI-130/131/159) add no other server rules:
planning poker (`features/estimation`) seals each pick in the picker's private layer with a shared
"has picked" marker and reveals one item at a time (`revealPrivate` with a per-item prefix), then
writes the agreed value through `card.setEstimate` (cards keep one writer). Retro mode
(`features/retro`) stores only its step and drives every other feature through commands that take
args — `templates.insert`, `private-mode.start/reveal`, `timer.start/stop`, `facilitation.start/set/end`,
`voting.start/end`, `arrange.clusterByColor` — so private writing, sealed votes and the
facilitator's limits keep their own guarantees. The laser pointer (`features/present`) is presence
only (`ext.present.laser`, receivers fade points from their own arrival time); presenter notes are
the `presenterNotes` collection (frame id → text), never elements, so never in exports (element
content: a frame's notes live in the frame's doc, see "Board layers").

**Live activities** (KAI-132, `modules/engage`, `features/engage`): polls, word clouds, rankings,
rating scales and Q&A. The `activity` element (question, options, settings) is ordinary board
content written by editors. Answers, questions and upvotes are NOT: they go to the server over REST
(anyone who can open the board, viewers too; guests when the activity allows them; one answer per
person, a new one replaces it; rate limited), are checked against the element as that person sees
the board, and are kept in engage's tables. The board gets only results — counts, words, averages,
questions — in the `engageResults` collection, written through realtime's
`writeServerCollection` by the server alone: a socket's write to it (shared doc or layer) is undone
in the same transaction (`realtime/serverCollections.ts`, like the vote budget). So an anonymous
answer can never be mapped to a person by any client, and a sealed activity (`results: 'reveal'`)
publishes only how many answered until an editor reveals it. Names appear only on a poll answered
while it was not anonymous (kept per answer as given). `engageResults` and `call` are in
`Y_KEPT_ON_RESTORE`. The answer form is a dialog that `?activity=<id>` opens (phones: the answer link).

### Board layers — content the server withholds (`realtime/layers.ts`, `engine/store/`)

Some content must not reach everyone who can open a board: the ballots of a vote whose results are
hidden, private-mode drafts, the contents of a hidden frame. Hiding them in the UI is not enough
(every client holds the whole doc), and the server cannot filter the shared doc per connection: a
Y.Doc replicates as a whole, each client's updates are one gap-free sequence, and a receiver that
misses some structs can never apply anything that client writes later. So **withheld content never
enters the shared doc**. It lives in server-held **layer docs**, synced over the board's socket
only to connections that may read them:

| layer (wire / stored) | read by | written by | holds |
|---|---|---|---|
| `private` / `u:<userId>` | that user's sockets | that user, while owner/editor | private-mode drafts (`elements`, with their element content: see below), sealed ballots (`voting`), sealed planning-poker picks (`estimation`) |
| `editors` / `editors` | owner/editor sockets | owners/editors | contents of hidden frames (`elements`, with their element content: table cells…); pending suggestions (`suggestions`, created only by the server; see "Suggestions") |

- Wire format: `WS_MESSAGE_LAYER` envelopes around y-protocols sync messages, `WS_MESSAGE_LAYER_OP`
  for reveal/discard (`@freero/shared` api.ts). A socket asking for a layer it may not read gets no
  answer; writes from sockets that may not write are dropped.
- **Across instances** (`realtime/rooms.ts`, `peers.ts`): every instance holding the board holds a
  copy of every layer and relays layer updates like the shared doc's (peer `layer-update`; layers
  ride along in `sync-request` / `sync-reply`, so opening a board, or catching up after a Redis gap,
  gets other instances' unsaved layer changes too). Access is re-checked per receiving socket at
  send time, on whichever instance it is connected to (role changes reach every instance on the
  control channel).
- **Persistence**: like the doc, a base plus an append-only log per (board, layer)
  (`board_layers`, `board_layer_updates`, `realtime/layerStore.ts`). The instance where a change is
  made saves it (a socket's write, or a reveal it ran); saves are idempotent appends, so instances
  never overwrite each other; a room that relayed others' layer changes saves what the database
  lacks before unloading. Compaction after unload folds the log, and deletes a layer that holds
  nothing or a private layer whose owner was removed from the board.
- **Reveal** happens on the server: an owner/editor sends `{ type: 'reveal', collection, prefix? }`
  and the instance holding that socket moves those entries out of the private layers into the
  shared doc in one transaction (so it works while authors are offline or on other instances, and
  nobody sees half a result). Only the layers of people who may still edit the board take part
  (someone removed or made a viewer keeps theirs). That access check reads the database, so the
  revealer's later messages are held until the reveal is applied (it stays in order with them,
  e.g. a vote ending after its ballots). `mine: true` reveals only the sender's own layer.
- **Anonymous private mode** (#44): the facilitator switches the session's `anonymous` on in the
  private-mode bar (everyone's bar then says notes are revealed without names; another feature can
  start it so with `private-mode.start` args `{ anonymous: true }`). Two server steps keep it, so no client can map a revealed
  note to its author — owners and the facilitator included (as for anonymous poll answers):
  (1) a NEW element arriving in a private layer while the shared doc's `privateMode` session is
  anonymous — or after an anonymous session ended (kept as `active: false` until the next start),
  for drafts still on their way — is stamped `createdBy = ANONYMOUS_AUTHOR` in the transaction that
  applies it (`realtime/attribution.ts`), so switching anonymity off or ending the session can never
  name it again; (2) a reveal of `elements` with `anonymous: true` (sent while the session is
  anonymous), and any reveal of an already-stamped draft, writes each draft into the shared doc
  scrubbed (`layers.ts`: `ANONYMOUS_AUTHOR`, no `createdVia` / `suggestedBy`, `createdAt` /
  `updatedAt` = the reveal) and DROPS the comment threads pinned to it (only its author could see
  the draft, so every record in them names the author; rewriting authorship would break the comment
  rules). The shared doc never holds the author, so versions, exports, backups, the outline and
  events never can; readers treat the marker as nobody: sticky labels and the outline say
  "Anonymous", the public API's `createdBy` is null, item events and card notifications have no
  actor, and the attribution guard keeps it on later edits like any creator. Not hidden: what a
  note says, where it sits, its colour, and its stacking order (`z`) among the drafts. Boards
  revealed before #44 keep their authors: nothing then promised anonymity, and a revealed draft is
  indistinguishable from an element made in the open.
- **Reveal racing an edit**: an author still typing in a draft while it is revealed (from any
  instance) writes into a private entry the reveal just deleted, so the newer text stays in their
  private layer. Their client — the only one that can see it — then holds the id in both docs and
  publishes the newer private copy over the revealed one (`editor/layers.ts`). Private items made
  after a reveal, with no private mode running, get a "Share them" bar (reveal `mine`).
- **Presence**: while private mode applies to a user, others don't see their cursor where a new
  sticky would go private or over their private items, and presence never names private elements
  in `selection` / `editingId` (`publicCursor` / `publicIds`, `editor/layers.ts`).
- Client (`BoardStore`): the shared doc plus both layer docs; `elements` of all three read as one
  board. A local write goes to the element's current layer, or where `editor/layers.ts` places it:
  private stays private; new elements matching private mode's rule (`Editor.setPrivatePlacement`) go
  private; anything inside a container whose `ElementDefinition.hidesContents` is true goes to
  `editors`; else shared. Every owner/editor client re-checks after each change (frame hidden/shown/
  deleted, concurrent writes) and moves misplaced elements silently; non-editors additionally never
  render a hidden frame's contents (`isOffBoard`) while a move is in flight.
- Undo spans docs: each doc has its own Y.UndoManager and `store/undo.ts` records which of them got
  an item per user action, so one gesture is one step even when it moves a sticky into a hidden
  frame (shared doc delete + layer doc insert).
- Losing owner/editor drops the local copy of the `editors` layer (a fresh doc; never synced back
  as deletions); gaining it asks the server for the layer. Dashboard thumbnails render shared
  content only; duplicating a board copies the `editors` layer only for an owner/editor and never
  anyone's private layer; moving a board to the trash keeps every layer exactly as it was (live
  state, like the doc) and restoring brings them back. Saved templates and exports are made on the
  client from what that user can see: never another user's private layer, and hidden frames'
  contents only for owners/editors (who see them).
- **Version history** (KAI-49) versions and previews the shared doc only: a snapshot or preview
  never contains private drafts, sealed ballots or the contents of a frame that was hidden at that
  moment (history is editor-only anyway). Restoring never touches layer docs; `voting` (sealed
  markers) and `privateMode` are in `Y_KEPT_ON_RESTORE`. Restoring brings back the frames as they
  were: a frame visible then comes back visible with the content the shared doc had (the editors
  clients' sweep drops a stale editors-layer copy of the same ids), a frame hidden then comes back
  hidden with whatever its editors layer holds NOW (hidden contents are not versioned).
- **Element content follows its element** (KAI-230, KAI-234): what an element keeps outside the
  `elements` map — the collections in `@freero/shared` `ELEMENT_CONTENT_COLLECTIONS` (`tableCells`,
  `presenterNotes`, `engageResults`, `comments`, `trackers`) — lives in the SAME doc as that
  element, so a table in a hidden frame or a private draft never sends its cell text, nor the
  discussion about it, to a socket that may not read the table. One declaration in
  `@freero/shared` (like `Y_KEPT_ON_RESTORE`) because both runtimes enforce it. Each collection has
  an `ElementContentRule`:
  - `owners(key, value, get)`: the elements an entry belongs to, read from its key (a cell), its
    value (a tracker badge's `sources`) or another entry (`get`: a comment message asks its `t:`
    thread record, whose `elementId` is the item the thread is pinned to). No owner: a board-level
    thread, which lives in the shared doc.
  - several owners (`homeLayer`): the most visible doc in which EVERY owner is visible — shared when
    all are shared, `editors` when none is in a private layer — else the most restrictive, the
    private layer of the first owner in one. A badge linking a shared sticky and an item in a hidden
    frame is for owners/editors only; one that also links a draft is that draft author's.
  - `follows(key)`: with no owner on the board (its item was deleted), the entry keeps to the doc of
    another entry: a comment record to its thread record (a hidden item's thread stays hidden after
    the item is deleted, and so do replies to it). The comments feature writes a thread's tombstone
    before deleting its records, so the tombstone lands where the thread was.
  - Client (`engine/store`): `editor.collection(name)` of such a collection reads the shared doc and
    both layers as one; a write goes to the owner element's doc. Every element move between docs
    (`BoardStore.writeElement`) carries its entries in the same transaction, so dragging a table into
    or out of a hidden frame is one undo step for the cells too (undoable collections are tracked in
    the layer docs' undo managers). The owner/editor sweep (`editor/layers.ts`) also places entries
    left elsewhere (a collaborator typing into a cell while the table was being hidden, untracked
    content after an undo); a stale editors-layer copy of an element takes its content with it.
  - Server (`realtime/elementContent.ts`): requests (`applyChange`) write entries into the owner's
    doc and move them when they move the element; reveal / discard of drafts (`applyLayerOp` on
    `elements`) carries their entries, and an op naming an element-content collection does nothing
    (content is never revealed without its element); a socket's write of an entry into the shared doc
    for an element that lives only in the editors layer (or only in the writer's own private layer)
    is moved there INSIDE the transaction that applies the update (the shared-doc update other
    sockets get carries no text, as with the facilitation guards); loading a board places every
    misplaced entry (idempotent: this migrated boards from before the rule). An element in two docs
    (a move in flight) or none (deleted) has no home: its entries stay put until it has one.
  - Collections only the server writes (`SERVER_WRITTEN_COLLECTIONS`, `engageResults`) are moved by
    the server, never by clients (a socket's change to them is undone): `writeServerCollection` writes
    each entry into its element's doc, and the room re-places them after every element move it applied.
  - Readers: `BoardView.collection(name)` merges the layers the reader may read for these collections
    (the outline, REST/MCP item reads, AI); exports, templates and thumbnails are made on the client
    from what that user can see; version snapshots and the references index read the shared doc only.

**What else lives outside `elements`, and why it is (not) withheld** (audit, KAI-230):

| Collection | Holds | Withheld with hidden / private items? |
|---|---|---|
| `tableCells` | cell text and fill, per table | yes: element content |
| `presenterNotes` | notes per frame | yes: element content (a frame inside a hidden frame or a draft). A visible frame's notes stay readable by everyone with access, by design (the panel says so) — that includes a hidden frame's OWN notes, since the frame itself is visible |
| `engageResults` | live activity results | yes: element content, moved by the server |
| `diagramSources` | a diagram's Mermaid / outline source and the ids it laid out | not element content (one record, many elements): from-text keeps a source only while the WHOLE diagram is shared content, offers editing only then, and refuses to write a source for a diagram that became hidden meanwhile. A diagram hidden after it was shared keeps the source everyone had already seen (hiding is not retroactive) |
| `comments` | threads pinned to items, messages | yes (KAI-234): every record of a thread pinned to an item lives with the item (owner via the `t:` record). Board-level threads stay shared. Server readers: commenter rules judge a record against the layer it would land in (a commenter can't take over a hidden thread by re-writing it into the shared doc; the room moves their own records there); mention/reply notifications carry the thread's layer (`editors`: only owners/editors are notified, no invite mention; `private`: nobody); the activity feed counts hidden-thread comments in an editors-only row; the account purge renames authors in every doc; the data export includes the person's own messages from every doc but describes a hidden item only if they may see it now; `/boards/:id/people` answers from the comments the asker can read; the references index, search and outline read `BoardView` / the saved shared doc, so hidden threads only for those who see them |
| `trackers` | issue badges (key, title, status, assignee) per link, `sources` = linked items | yes: element content with several owners (`homeLayer`), written and moved by the server only |
| `voting`, `estimation` | ballots / picks: element ids and values, sealed ones in private layers | ids only, no content: an item in a hidden frame can be voted on or estimated by editors, and viewers learn its id and count, never its text |
| `tags` | the board's tag vocabulary (name, colour) | no: board-level, shared by many items; an item's tag ids are on the element and follow it |
| `timer`, `privateMode`, `facilitation`, `retro`, `call`, `shapeLibraries` | session / board settings | nothing item-specific |
| `suggestions` (editors layer) | proposed changes | already editors-only; accepting writes through the same placement |
| kanban / swimlane / mind map / `objectlink` | fields of their elements | elements: follow their layer already |

Card notifications (`realtime/cards.ts`) observe the shared doc only, so a card inside a hidden frame
or a draft notifies nobody (a draft's assignee hears of it when it is revealed), and due-date
reminders re-check the card in the assignee's own `readBoardView`.
- Features use it through `Editor.privateCollection(name)` / `usePrivateCollection`,
  `revealPrivate` / `discardPrivate`, `setPrivatePlacement`, `layerOf(id)` and
  `ElementDefinition.hidesContents`. Trust model: owners/editors are trusted with integrity (they can
  write the whole doc anyway); the layers guarantee confidentiality from everyone the server does
  not send them to. What was in the shared doc before it was hidden was already seen; hiding is not
  retroactive.

### Suggestions — changes proposed for people to accept (KAI-169; `@freero/shared` `suggestions.ts`)

An agent, an app or an AI action can SUGGEST instead of edit: new items, field changes of items on
the board, deletions. A suggestion is not board content until someone who can edit accepts it.

- **Where they live**: the `suggestions` collection of the `editors` layer — one `SuggestionRecord`
  per proposed change of ONE item, records of one proposal sharing a `groupId` (each carries the
  group's `author` and `description`). Not a layer of its own on purpose: the editors layer already
  reaches exactly the people who may accept (owners/editors; never viewers, commenters or guests
  who can't edit), is persisted, relayed between instances, left out of thumbnails and exports
  (suggestions aren't elements) and left alone by version restore — so suggestions inherit all of
  it. Restoring a version never touches pending suggestions; duplicating a board copies the editors
  layer WITHOUT them (`snapshotBoardLayer(…, { withoutSuggestions })`).
- **Single writers**: records are CREATED only by the server — realtime's `proposeSuggestions(boardId,
  actor, { author, description }, plan)`, the seam everything that wants review goes through (the
  public API, structure insertion with `target: 'suggestions'`, in-app AI): `plan` returns a
  `BoardChange` from the SAME planners as a direct write, which becomes the records. So the author
  badge ("Claude for Maria", "AI for Maria") can't be forged by a socket. A SOCKET may only set or
  clear the `decision` of an existing record, naming itself (`realtime/suggestions.ts`
  `guardSuggestionWrites`, inside the transaction that applies its editors-layer update, like the
  facilitation guards: what it undoes reaches nobody, the sender gets the correction). Decided
  records stay a day (undo needs them) and are pruned when a room loads.
- **Accepting** in the app (`Editor.acceptSuggestions`) is an ordinary edit by the acceptor plus the
  decision, in ONE undo step across the shared doc and the editors layer (its undo manager tracks
  the collection); undo puts the items back AND makes the suggestions pending again. New items keep
  their proposed ids (two people accepting at once make one item), `createdBy` is the acceptor and
  `suggestedBy` the proposer. Accepting a line brings the new items it joins (`acceptClosure`);
  rejecting a new item rejects lines to it (`rejectClosure`). Role guards and a facilitator's limits
  apply as to any write (a locked participant is a commenter: no layer writes at all). On a request
  (`decideSuggestions`, the public API) the change goes through `applyChange` and the decisions are
  written in the same step.
- **Stale** (`suggestionState`): an update whose fields changed since it was proposed (its `base`),
  a deletion of an item that changed in any way (`elementFingerprint`), or an item (or one a new line
  needs) that is gone. Stale ones are never applied silently: the app asks ("Apply anyway"), the API
  answers 409 `suggestion_stale` unless `force`.
- **Withdrawn when the credential is revoked** (KAI-224): apiauth appends `CREDENTIAL_REVOKED_TOPIC`
  to the outbox in the transaction that deletes a token, an app's consent (the person, a replayed
  refresh token), an app (its developer) or all of a person's (revoke-all, signed out everywhere);
  realtime's `suggestion-withdrawals` consumer (`realtime/withdrawals.ts`) finds the boards in
  `board_suggestion_authors` — a hint realtime owns: `proposeSuggestions` notes (board, person,
  credential) BEFORE writing the records, a room load forgets authors with nothing pending — and
  `withdrawSuggestionsOn` decides them on the live room as rejected by `WITHDRAWN_BY` with `withdrawn`
  (no socket names that id, so none reopens them), audited `via: 'revoked'` in the person's name.
  Keyed by person AND credential: an app's credential id is its client id, shared by everyone who
  uses it, so revoking Maria's consent never touches Bob's suggestions from the same app.
- **Audit and activity**: every accept / reject / undo of either is
  `board.suggestion_accepted|rejected|reopened` in the board's workspace log, recorded by the
  instance that applied it (`via: board | api`). A proposal is an activity entry for owners and
  editors ("Claude for Maria suggested 6 changes", realtime `onSuggestionsProposed`); accepting is
  the acceptor's ordinary edit (a request's carries its app, KAI-168).
- **Attribution**: a proposal made on a request is from its `BoardActor` — "<app> for <person>"
  when an app or token acts (`via`, KAI-168), else the person; in-app AI passes its own author
  ("AI for <person>"). MCP's `propose_changes` is the suggestions sink through `insertStructureFor`
  (offered because `structureTargets()` lists `suggestions`); REST and MCP share
  `api/service.ts` (`listSuggestions`, `proposeChanges`, `decideSuggestions`).
- **Reading**: `BoardView.suggestions` (pending, owners/editors only); the outline lists them only
  with `include=suggestions`; `GET /api/v1/boards/:id/suggestions`. UI: `features/suggestions`
  (ghosts drawn with `ElementPreview`, the proposer's badge, accept / reject per item and per group,
  the review dock, the top-bar count).

## Verification

- `npm run check` — boundaries + typecheck + unit tests. Must pass before any change is "done".
- `npm run verify` — real-session end-to-end check (`scripts/verify.mjs`): boots the server on a temp
  data dir, signs up real users, creates a board, connects real Yjs WebSocket clients and checks
  sync, roles, persistence across restart. No fake harness. Runs on PGlite by default; with
  `DATABASE_URL` it runs against that Postgres (fresh database per run, dropped afterwards) and
  also starts two instances at once on one empty database (migration lock); with `REDIS_URL` too,
  it runs two instances on one database + Redis with clients on each. With `S3_ENDPOINT`,
  `S3_BUCKET` and keys (MinIO, SeaweedFS…), the `s3` group checks the S3 backend (prefixes, kept
  copies under `private/`, restore, retention, the S3_PUBLIC_URL redirect and stored Cache-Control);
  all other groups stay on the local disk. CI does all of it.
  `--only main,signin,secrets,sweep,purge,notify,platform,multi,facilitation,ai,api,mcp,s3,suite,suggestions,collab,tracker,search,webhooks,docs,portability,walkthroughs,decisions,site` runs some groups (to loop one while hunting a flake).
  The `mcp` group drives the MCP server with the official MCP client SDK, OAuth (dynamic
  registration, consent, PKCE) included; with DATABASE_URL + REDIS_URL one client's requests also
  alternate between two instances.
  Checks wait on the real condition, never a fixed sleep: `waitFor(cond, ms)` polls until a
  deadline; `settled(client, observers)` is a barrier (a presence change the server handles after
  everything the client sent before, relayed in order) for proving something did NOT arrive;
  `waitUnloaded(proc)` waits until the server holds no doc in memory (`/metrics` gauge), so the
  next read comes from the database. Background work exposes a counter to wait on the same way
  (`freero_notifications_comment_messages_handled_total`, `freero_notifications_digest_runs_total`:
  "the comment was handled", "N more digest runs saw it due"); a new async side effect a check
  depends on adds one rather than a sleep.
- UI: drive the real app in a browser (see `.claude/skills/verify-freero/`).

### What a test is for

Every test guards a behaviour a user or another module relies on, which a plausible change could
break. Write it from the scenario ("dragging a frame moves its children but not an overlapping
sticky outside it"), not from the code.

Not allowed (reviewers delete these on sight):
- asserting a component renders its own label/props ("the Enter button says Enter"), snapshots
- asserting constants, defaults or config equal what they were set to
- asserting a mock/stub returns what the test told it to, or that a function was "called"
  when the observable outcome could be checked instead
- several tests that would all fail for the same bug — keep the strongest one

Prefer fewer, scenario-level tests at the seam where bugs actually happen (geometry, sync, permissions,
undo grouping, serialization). Name each test after the failure it prevents.

## Git

Small, well-named commits, each scoped to one owned area (`engine: …`, `features/sticky: …`,
`server/boards: …`). Split large changes.
