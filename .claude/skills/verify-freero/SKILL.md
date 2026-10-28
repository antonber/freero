---
name: verify-freero
description: Verify a Freero change in a real running session — boundaries/types/tests, the real-session server check, and driving the real web app in headless Chromium with screenshots. Use before calling any Freero change done.
---

# Verifying Freero

A change is done when all of these hold. Never substitute a fake harness for a real session.

## 1. Static + unit
```
npm run check          # dune boundaries + typecheck (all workspaces) + vitest
```

## 2. Real-session server check (server or sync changes)
```
npm run verify         # boots the real server on a temp dir, real Yjs WebSocket clients, roles, persistence
```
Realtime / persistence changes: also run it against real Postgres + Redis, which adds the
multi-instance checks (two servers, clients on each). With Docker (pick free ports, remove after):
```
docker run -d --rm --name <you>-pg -e POSTGRES_PASSWORD=freero -p 127.0.0.1:<pgport>:5432 postgres:17-alpine
docker run -d --rm --name <you>-redis -p 127.0.0.1:<redisport>:6379 redis:7-alpine
DATABASE_URL=postgres://postgres:freero@127.0.0.1:<pgport>/postgres REDIS_URL=redis://127.0.0.1:<redisport> npm run verify
docker stop <you>-pg <you>-redis
```

## 3. Drive the real UI

Pick ports nobody else uses (several agents may verify in parallel). Example: API 4101, web 5201.

```
# terminal A (background) — real server with a throwaway data dir
PORT=4101 FREERO_DATA_DIR=<scratch>/data npx tsx apps/server/src/main.ts
# terminal B (background) — Vite proxying to that server
cd apps/web && FREERO_API_PORT=4101 npx vite --port 5201 --strictPort
```

- `/board/local` is an offline sandbox (no server, no login) — fastest for element/tool work.
- Real boards: log in as the seeded `demo@freero.app` / `freero123`, create a board with
  `POST /api/boards`, open `/board/<id>`. For multi-user features, sign up a second user and use
  two browser contexts.

Screenshots (headless Chromium via Playwright, already installed):
```
node scripts/ui-shot.mjs --url http://localhost:5201/board/local --out <scratch>/shot.png --steps <scratch>/steps.mjs
```
`steps.mjs`: `export default async ({ page, shot }) => { await page.keyboard.press('n'); await page.mouse.click(700, 400); await shot('after-sticky'); }`.
Use real input (mouse, keyboard), not direct state pokes. Then **look at the PNGs** (Read tool) and
fix what looks wrong. The script exits non-zero on console errors — treat those as failures.

Stop every process you started when finished.
