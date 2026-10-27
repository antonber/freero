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

### Features — owned folders discovered through reserved files

```
features/<name>/
  feature.ts     REQUIRED  export default defineFeature({ name, description, owns? })
  element.tsx    optional  export default defineElement({...})  (or an array of them)
  tool.tsx       optional  export default defineTool({...})     (or an array)
  format.tsx     optional  export default defineFormat({...})   (contextual toolbar section)
  panel.tsx      optional  export default definePanel({...})    (or an array; mounts into a slot)
  commands.ts    optional  export default defineCommands([...]) (shortcuts + menu entries)
  *.css, *.test.ts(x)      allowed at the root
  lib/                     any helpers
```

Any other file at a feature root fails [W7]. The manifest `name` must equal the folder name.
The contract for all of these is `apps/web/src/engine/api.ts`. Scaffold with
`npm run new:feature <name> -- [--element <type>] [--tool] [--format] [--panel <slot>] [--commands] [--owns a,b]`.

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

### Rendering

DOM/SVG. One "world" layer transformed by the camera (`translate() scale()`), each element an
absolutely positioned memoized component; off-screen elements are culled. Screen-space UI
(handles, toolbars, cursors) lives in overlays so it stays constant size. Text editing is shared
(`ElementText`). Frames render beneath other elements.

## UI kit (`ui/`) — exports from `@ui`

`Button` {variant: 'primary'|'secondary'|'ghost'|'danger', size: 'sm'|'md'|'lg', icon?, loading?} ·
`IconButton` {icon, label, active?, size?: 32|40, shortcut?, tooltipSide?} ·
`Tooltip` {content, shortcut?, side?, children} · `Popover` {open, onClose, anchor: HTMLElement|DOMRect|null, side?, align?, children} ·
`Menu` {open, onClose, anchor, items: MenuItem[]} where MenuItem = {id, label, icon?, shortcut?, danger?, disabled?, onSelect} | {divider: true} | {heading: string} ·
`Modal` {open, onClose, title, width?, footer?, children} · `Input`, `TextArea`, `Select` {options, value, onChange},
`Toggle`, `Slider` {min, max, step, value, onChange} · `ColorSwatches` {colors, value, onChange, allowCustom?} ·
`Divider` {vertical?} · `Avatar` {name, color, src?, size?} · `AvatarStack` {users, max?} · `Kbd` ·
`Spinner` · `Logo` {size?, withWordmark?} · `ToastProvider` + `useToast()` → `notify(message, kind?)`.
Tokens: `ui/tokens.css` (CSS variables `--fr-*`). Plain co-located CSS, class prefix `fr-`.

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
  ws.ts            reserved: WebSocket upgrade handler(s) by path prefix
```

## Verification

- `npm run check` — boundaries + typecheck + unit tests. Must pass before any change is "done".
- `npm run verify` — real-session end-to-end check (`scripts/verify.mjs`): boots the server on a temp
  data dir, signs up real users, creates a board, connects real Yjs WebSocket clients and checks
  sync, roles, persistence across restart. No fake harness.
- UI: drive the real app in a browser (see `.claude/skills/verify-freero/`).

## Git

Small, well-named commits, each scoped to one owned area (`engine: …`, `features/sticky: …`,
`server/boards: …`). Split large changes.
