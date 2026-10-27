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

- npm workspaces. Node 22 (built-in `node:sqlite`, no native deps). `npm run dev` starts both apps.
- `packages/shared` — pure types/constants shared by client + server (no imports). Element model
  (`elements.ts`), Yjs doc layout + presence (`ydoc.ts`), REST/WS contract (`api.ts`).
- `apps/server` — Express 4 + `ws` + Yjs (y-protocols), SQLite, run with `tsx`. Port 4000.
- `apps/web` — Vite 5 + React 18 + TS, react-router 6, zustand 4, yjs + y-websocket 2,
  lucide-react, perfect-freehand, dompurify, html-to-image + jspdf. Dev on 5173, proxies
  `/api`, `/uploads`, `/ws` to :4000.

Dependencies are pre-installed. Adding one: `npm install <pkg> -w @freero/<web|server>`, and say so.

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
  *.css, *.test.ts(x)      allowed at the root
  lib/                     any helpers
```

Any other file at a feature root fails [W7]. The manifest `name` must equal the folder name.
The contract for all of these is `apps/web/src/engine/api.ts`. Scaffold with
`npm run new:feature <name> -- [--element <type>] [--tool] [--format] [--panel <slot>] [--commands] [--decoration] [--owns a,b]`.
Something drawn ON another feature's elements that must appear in image exports is a
`decoration.tsx`, never a `world-overlay` panel (overlays aren't part of exports).

Features talk to each other only through the engine: elements, `editor.collection(name)` reads,
`editor.runCommand('<feature>.<verb>')`, and presence.

### Single writers

| Durable value | Single writer | How others change it |
|---|---|---|
| Yjs doc, provider, awareness | `engine/store/` | `Editor` methods |
| `elements` map | engine (`editor.create/update/remove/transact`) | same |
| `settings` map (background, grid) | engine | `editor` settings API |
| feature collection (e.g. `comments`) | the feature whose `feature.ts` `owns` it | `editor.runCommand` of the owner. Writes from a non-owner throw at runtime [W8 checks unique claims] |
| camera, selection, active tool, dock | engine | `editor.setCamera/select/setTool/openDock` |
| presence ext | each feature writes `ext[<its name>]` only | — |
| SQLite table | the server module whose `schema.sql` creates it; only its `repo.ts` writes it [S4] | that module's exported functions |
| auth session cookie | server `modules/auth` | — |

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
  position and rotation.
- `@engine` hooks: `usePointer()` (world pointer for tool `Preview`s), `useTextFormatState()`,
  `useSettings()`, `useCanEdit()`; `plainToRichText()`; types `ElementTextProps`, `TextFormatState`.
- `useCollection(name)` returns the collection's entries (`Array<[key, value]>`).
- `CommandDefinition.minRole` defaults to `'editor'`; engine view-safe commands set `'viewer'`.
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
- `Host.listMembers()`: everyone with access to the board (owner + invited members), including
  people never seen online — for assignee pickers etc. (`/board/local`: just the local user).
- `Editor.findFreeSpot(size, { near?, gap? })`: top-left of a box that keeps `gap` clear of
  every element, nearest to `near` (default: viewport center). Every "insert" action that
  isn't aimed at a point (templates, the image upload button) places content with it.
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
- Typing a character with one EMPTY text item selected starts editing it with that character;
  items that already have text keep single letters as tool shortcuts (Enter / double-click edit).
  Undo/redo shortcuts also work while a non-modal popover has focus.
- Screen/world UI that must stay visible next to a selection (comment pins) marks its node
  `data-fr-keep-clear`; the format toolbar steps above it, or flips below the selection.
- `ToolDefinition.onSelect?(editor)`: act-now tools (upload image, templates) run when picked and
  never become the active tool. `ToolPointerEvent.button` is -1 on every move (drag or hover);
  `buttons` is the pressed-buttons bitmask.
- `CommandDefinition.icon?` (shown in the context and board menus) and `group?` (commands sharing
  a group fold into one "<group> ▸" submenu, e.g. emoji's "React with ▸" stamps).
- `Host.notify(message, kind?, { action?: { label, run } })` — features never call `useToast`.
- Panel slot `'top-center'`: session bars under the top bar (an active vote, "X is presenting").
  The engine stacks them in one centered column (also while presenting), so two bars never
  overlap; the panel renders only its bar, no positioning. Never place such a bar absolutely in
  `screen-overlay`.
- A socket closed with 4401/4403 (removed, link access revoked, signed out) drops the session to
  read-only (`viewer`) besides showing the banner: writes after that could never reach the server.
- `Host.user` changes (profile renamed / recolored in any tab) are republished to presence.

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
  else changed since, writing silently (no undo step) — never for collaborators' elements.
- `fitToContent(el, handle)`: double-clicking a resize handle applies the returned patch (a
  fixed-width text box goes back to auto width).
- `hitTest(el, local, { tolerance })` — `tolerance` is a few screen px in world units at the live
  zoom; `distanceTo(el, local)` (≤ 0 on the ink) is the default hit test when there's no
  `hitTest`, and other features may ask it (`editor.getDefinition('pen').distanceTo` is how the
  eraser finds ink). `worldToLocal(el, p)` from `@engine` converts.
- `hidden(el, editor)`: off the board (collapsed mind-map branches). Not rendered or exported, and
  ignored by hit tests, marquee, selection (dropped from it when they become hidden), snapping,
  `getBounds` and zoom-to-fit.
- `removeWith(el, editor) → ids`: deleted along with `el` in the same transaction by every local
  `editor.remove` (Delete, cut, context menu, eraser); one undo restores all of them.
- `onKeyDown(e, { editor, selection })`: keys while this type is selected, asked before the
  engine's own keys and command shortcuts (mind-map Enter = add sibling, Delete = delete branch).
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
- The active tool's Options flyout is kept inside the window by the engine.

## UI kit (`ui/`) — exports from `@ui`

`Button` {variant: 'primary'|'secondary'|'ghost'|'danger', size: 'sm'|'md'|'lg', icon?, loading?} ·
`IconButton` {icon, label, active?, size?: 32|40, shortcut?, tooltipSide?} ·
`Tooltip` {content, shortcut?, side?, children} · `Popover` {open, onClose, anchor: HTMLElement|DOMRect|null, side?, align?, autoFocus?, escapeToContent?, children} ·
`Menu` {open, onClose, anchor, items: MenuItem[]} where MenuItem = {id, label, icon?, shortcut?, danger?, disabled?, onSelect, submenu?: MenuItem[]} | {divider: true} | {heading: string} ·
`Modal` {open, onClose, title, width?, footer?, children} · `Input`, `TextArea`, `Select` {options, value, onChange},
`Toggle`, `Slider` {min, max, step, value, onChange} · `ColorSwatches` {colors, value, onChange, allowCustom?} ·
`Divider` {vertical?} · `Avatar` {name, color, src?, size?} · `AvatarStack` {users, max?} · `Kbd` ·
`Spinner` · `Logo` {size?, withWordmark?} · `ToastProvider` + `useToast()` → `notify(message, kind?, { duration?, action? })` (app only; features use `editor.host.notify`).
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
                   handling, ws upgrade dispatch. NEVER imports modules/.                     [S1]
modules/<name>/    auth, boards, members, uploads, realtime …
  index.ts         public API; other modules import only this                                 [S2]
  schema.sql       reserved: tables this module OWNS
  repo.ts          the only file that touches the db; the only writer of the owned tables     [S3][S4]
  routes.ts        reserved: export default (ctx) => express.Router, mounted at /api
                   (optional `export const mountPath = '/'` to mount elsewhere — uploads uses it
                   for GET /uploads/:file)
  ws.ts            reserved: export default (ctx) => WsRoute | WsRoute[]  ({ prefix, handle(ws, req) })
  init.ts          reserved: export default (ctx) => void | Promise<void>; runs once after all
                   schemas are applied and routes mounted, before listen (e.g. auth seeds the
                   demo user in non-production and purges expired sessions)
```

`ctx` (`platform/context.ts`) carries `config` and `onShutdown(fn)` (realtime flushes docs there).
Cross-module imports name the index file explicitly (`'../auth/index'`), which is what [S2] checks.
Auth is a plain middleware exported by `modules/auth/index.ts` (`requireUser`, `currentUser(req)`),
not a reserved hook. Server modules today: `auth` (users, sessions), `boards` (boards, stars,
opens), `members` (board_members, role resolution), `uploads` (files under `<data>/uploads`, no
table), `realtime` (board_docs; y-websocket protocol + role filter).

Trust boundaries in `realtime`: presence from a socket may only write the awareness client ids
that socket announced, and its `user` is always replaced by the authenticated user's profile
(`realtime/awareness.ts`), so nobody can appear as someone else. Logging out
(`auth.onSessionEnd`) closes every board socket opened with that session (4401). Member emails
(`GET /members`) are only sent to owners/editors.

## Verification

- `npm run check` — boundaries + typecheck + unit tests. Must pass before any change is "done".
- `npm run verify` — real-session end-to-end check (`scripts/verify.mjs`): boots the server on a temp
  data dir, signs up real users, creates a board, connects real Yjs WebSocket clients and checks
  sync, roles, persistence across restart. No fake harness.
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
