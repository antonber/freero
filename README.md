# Freero

An original real-time collaborative whiteboard: an infinite canvas for teams to brainstorm, plan,
diagram and run workshops together.

## What's in it

- **Canvas** — infinite pan/zoom, dot grid, minimap, snapping and alignment guides, multi-select,
  resize/rotate, groups, lock, undo/redo, copy/paste across boards, drag-and-drop import.
- **Content** — sticky notes, 21 shapes, rich text, connectors (straight/elbow/curved, attached,
  labelled), pen + highlighter + eraser, images, emoji and stamps, frames, task cards, mind maps, tags.
- **Collaboration** — live sync, cursors and selections, avatars, follow a collaborator,
  "bring everyone to me", emoji reactions, comment threads, owner/editor/commenter/viewer roles,
  share by invite or link.
- **Facilitation** — voting sessions, a shared timer, presentation mode over frames.
- **Templates & export** — 13 original templates; export PNG/JPG/SVG, frames to PDF, copy as image.
- **Dashboard** — boards grid/list, search, filters, stars, live thumbnails, duplicate, sharing.

## Run it

Requires Node 22+.

```bash
npm install
npm run dev          # server on :4000 + web on :5173
```

Open http://localhost:5173 and log in with the seeded demo account
`demo@freero.app` / `freero123` (development only), or sign up.
`http://localhost:5173/board/local` is an offline sandbox board that needs no server.

Production:

```bash
npm run build && npm start     # serves the built web app from the server on :4000
docker compose up --build -d   # or the full stack: proxy, 2 app replicas, Postgres, Redis, MinIO, Mailpit on :8080
```

Deploying for real: [docs/deployment.md](docs/deployment.md) · every setting:
[docs/configuration.md](docs/configuration.md) · backups, monitoring, incidents:
[docs/operations.md](docs/operations.md).

Configuration: `PORT` (default 4000), `FREERO_DATA_DIR` (default `./data` — the built-in PGlite
database in `data/pg` + uploads), `DATABASE_URL` (use a real Postgres instead), `DATABASE_POOL_MAX`
(default 10). Had boards from before the move to Postgres? Stop the dev server and run
`npm run db:import-sqlite` once.

## Develop

| Command | What it does |
|---|---|
| `npm run check` | Architecture boundaries + typecheck + unit tests |
| `npm run verify` | Real-session end-to-end check: real server, real Yjs WebSocket clients, roles, persistence |
| `npm run new:feature <name> -- …` | Scaffold a feature folder (see ARCHITECTURE.md) |
| `node scripts/ui-shot.mjs --url … --out …` | Drive the real UI in headless Chromium and screenshot it |

Freero follows the [Dune method](https://github.com/Dahhrk/dark-factory/blob/main/docs/dune-method.md):
features are isolated folders discovered by reserved file names, every piece of state has one
writer, and forbidden dependencies fail `npm run check` with an error that names the supported
path. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing code.

Stack: React 18 + TypeScript + Vite, Yjs (CRDT) over WebSockets, Express + `ws`, PostgreSQL
(`pg`; PGlite for dev/tests), Playwright for UI verification.
