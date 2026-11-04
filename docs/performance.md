# Performance (as measured)

How big a board stays smooth, with numbers. Board performance is the weakness people cite most
about whiteboards, so Freero measures it on a large board in a real browser and keeps the results
here. Engine-session benchmarks for single paths: `npm run bench:kanban` (docs/design/
kanban-fields-and-views.md, "Performance (as measured)") and `npm run bench:line-jumps`.

## The large-board benchmark (#130)

```
npm run bench:board [-- --items 10000] [--port 4322] [--width 1440 --height 900] [--theme light|dark]
                       [--only <part of a scenario name>] [--no-build | --dist <built web app>]
                       [--profile] [--trace <dir>] [--census] [--css <rules>] [--shots <dir>]
                       [--out <file.json>] [--compare <earlier.json>] [--headed]
```

`scripts/bench-board.mjs` builds the web app (production React, not minified so profiles name
functions) into a temp folder and serves it from a real server (`NODE_ENV=test`, a throwaway data
dir). A user signs up, makes a board, uploads six generated pictures and writes the board through
a real y-websocket client, which stays connected as the collaborator. The board
(`scripts/bench/board-seed.ts`, a fixed seed, so every run measures the same board) has **10,000
items**: 5,292 stickies (half of them in 26 frames), 1,552 shapes with text, 2,100 connectors
(straight, elbow and curved, some labelled), 448 text boxes, 180 images, a kanban of 400 cards and
a diagram (40 shapes, 50 lines) — laid out over 40,000 × 27,000 units, so zoom to fit is 0.023 in a
1440 × 900 window.

Chromium runs headless with vsync and the frame-rate cap off, so a frame takes what it costs:
compare with 16.7 ms (60 Hz). Each scenario is driven the way input arrives — one wheel event per
frame for pan and zoom (the canvas's own handler), the keyboard for select all, the mouse for the
marquee and the drag, the collaborator's socket for remote edits — and reports frame times
(median / p95 / worst) from `requestAnimationFrame`. It is a script, not a test: it checks only
that each scenario did what it says (everything got selected, the drag moved the items, the edit
showed), and a scenario that takes seconds a frame stops after a minute and says so.

| Scenario | What happens |
|---|---|
| initial load | navigation → every item drawn (the count stops changing) and the page done with it (its last long task); starts once the server has digested the seed and the app's files were read once |
| pan at zoom to fit | 150 frames of panning, the whole board in view |
| zoom in from fit to 100% / zoom out | about a frame of interest, 6 % a frame |
| pan at 100% | 180 frames across a frame of stickies (items mount as they come into view) |
| select all | Ctrl+A → the frame that shows it |
| pan at fit, everything selected | 60 frames with 10,000 items selected |
| zoom in to 100%, everything selected | the zoom in, still with everything selected (#182) |
| leave low detail | 0.17 → 0.26 in one step about the frame of interest, then 60 frames while items mount (#184) |
| drag 500 items | a marquee over 540 stickies, then dragging them 60 steps; "settled" is the mouse up → calm frames |
| a collaborator's edit appears | the collaborator moves a sticky and changes its text → the frame that shows it (localhost round trip included), median of 9 |
| a collaborator drags 50 items | 60 updates 16 ms apart, frame times meanwhile |
| memory | JS heap after a forced GC, DOM nodes, layout objects |

Results are printed as a table and saved as JSON (`bench-results/board-<time>.json`, gitignored;
`--out` to name it). `--compare <earlier.json>` adds a column per earlier run; with only
`--compare` it prints a saved run. `--profile` adds each scenario's hottest functions (CPU
profile, self time); `--trace <dir>` writes a Chrome trace per scenario and sums its main-thread
work by kind; `--census` lists what the drawn board is made of by item type (DOM nodes, SVG roots,
shadows, clips, transforms); `--css` adds a stylesheet for what-if experiments (is it the
shadows?); `--shots <dir>` saves what the board looks like at fit and at 100%; `--dist` measures
another build (another commit's `vite build --outDir`).

## Results

One Windows desktop: AMD Ryzen 9 7950X (16 cores), 128 GB, Windows 11, Node 22, Chromium 156
headless (software rendering), 1440 × 900, light theme. **Before** is main at 3142c15f; **after**
is this change (#130, #131). Frames: median / p95 / worst, ms.

| Scenario | before (3142c15f) | after (this change, on main 28b043da) |
|---|---|---|
| initial load | 3.6 s; 53,477 DOM nodes | 3.7 s; 307 DOM nodes (9,972 items on low-detail canvases) |
| memory after load | 147 MB JS heap, 59,936 DOM nodes | 22 MB, 360 DOM nodes |
| pan at zoom to fit | **3,710 / 4,044 / 4,275** (stopped after a minute: 26 frames) | **7.6 / 17 / 18** |
| zoom in from fit to 100% | 3,375 / 3,810 / 3,857 (stopped at zoom 0.065 after a minute) | 15 / 40 / 52 |
| pan at 100% | 922 / 949 / 970 (at 0.065, where the zoom stopped: 4,350 items mounted) | 6.0 / 14 / 33 (52 items) |
| zoom out from 100% to fit | 609 / 1,890 / 2,818 | 9.5 / 33 / 90 |
| select all | 1,455 ms | 122 ms |
| pan at fit, everything selected | 3,887 / 4,039 / 4,102 (stopped after a minute) | 15 / 19 / 22 |
| drag 500 items | 19 / 242 / 265; the drop settles in 246 ms | 17 / 70 / 71; 45 ms |
| a collaborator's edit appears | 21 ms (worst 96) | 15 ms (worst 21) |
| a collaborator drags 50 items | 149 / 201 / 201 | 14 / 18 / 19 |
| memory at the end | 238 MB, 59,961 DOM nodes | 36 MB, 385 DOM nodes |

**Target (#131) and result:** at zoom to fit a 10,000-item board pans and zooms inside a 60 Hz
frame — median under 16.7 ms, p95 under 33 ms. Before: about 4 s a frame (and every frame long
enough that the camera's "moving" state dropped between frames). After: 7.6 ms median, 17 ms p95.
The same numbers on the before build are reproducible: build main with
`vite build --minify false --outDir <dir>` and run `npm run bench:board -- --dist <dir> --label before`.

## What the trace said

**Zoomed out, the browser spent seconds a frame layering the page.** With the whole board in view
every item was DOM — 53,000 nodes — and every pan or zoom frame took 4–5 s. The CPU profile's
JavaScript was a few milliseconds; the rest was Chrome's own work, and the trace named it:
`Layerize` (`PaintArtifactCompositor::Update`), 240 ms to several seconds a frame. Isolating types
with `--css` showed the cost grows faster than the item count and comes from what makes an item a
paint property of its own: an SVG root per shape and per connector (10,000 SVG roots alone: 2 s a
frame), blurred box shadows (stickies, cards), an opacity per faint text line, a transform per item.
Stickies alone (plain boxes) were cheap; together everything was not. Removing them one at a time
helped but never reached a usable frame (still ~230 ms with no SVG left), because layering
thousands of interleaved, overlapping items is the problem itself.

**What changed** (#131, `engine/canvas/LowDetailLayer.tsx`, `detail.ts`): below zoom 0.18 (back
above 0.22, so it never flickers) the items whose type knows how to paint itself cheaply —
stickies and sticky pads, shapes, text, connectors, images, cards (the side that shows, with the
kanban's colour-by) and charts (their plot area) — are painted onto canvases in the world instead of
being DOM. Consecutive such items share a canvas and items drawn in full sit between canvases, so
render order holds; a canvas moves with the camera (a pan repaints nothing) and repaints only the
part a change touched. Items big on screen, edited, making room for a drag or private keep their
DOM. Exports, thumbnails, hit-testing, selection and the screen-reader paths read the doc and never
see the canvas. At fit the page went from 53,000 DOM nodes to about 300 and from 147 MB of JS heap to
22 MB.

**Then the per-item React work** (visible once the browser stopped dominating):
- Every item subscribed to the ui store with six selectors, one of them `selection.includes(id)`:
  each camera frame ran 60,000 selectors, and with everything selected each one scanned 10,000 ids.
  Items now get their selected / edited / drag-preview state from one subscription that notifies
  only the items whose state changed (`ItemStates`, `WorldLayer.tsx`); zoom and focus come through
  context.
- The selection overlay re-rendered one outline box per selected item every camera frame; a
  multiple selection's outlines are now one SVG path in world units, moved by one transform.
- The format toolbar re-ran its selection-wide work (format sections, mixed style, bounds, every
  command's `when` for the More menu, the arrange commands' units) on each camera frame; it now
  does that when the selection changes, and the More menu's items only when it is open.
- Items are placed with `left` / `top` (a transform only when rotated).
- Dragging 500 items: every connector's `follow` asked each changed item where it went (2,100
  lines × 500 items per pointer move); the changed items are now indexed once per change.

## The follow-ups (#182–#185)

Same machine, 2026-11-03, while other work ran on it (so single runs vary by ±30 % on the frame
rows; the rows below are one run each, the leave and load rows checked over 2–3 runs). **Before**
is main at 2d2a7fa9 measured with the updated script (`--dist`), **after** is #182–#185.

| Scenario | before (2d2a7fa9) | after |
|---|---|---|
| initial load | 3.3–4.6 s (first items at ~0.9 s, then the full-detail fit swapped for canvases) | **0.55–0.6 s**; 252 DOM nodes (9,999 items on canvases) |
| memory after load | 22 MB JS heap, 360 DOM nodes | 17 MB, 300 DOM nodes |
| zoom in to 100%, everything selected | 26 / 104 / **798**, 8,683 items mounted | 21 / 53 / 63, 109 items mounted |
| leave low detail (762 items mount) | worst 70–158 ms | worst 33–87 ms (spread over ~10 frames) |
| select all (after zooming about) | 6,844 ms | 96 ms |
| pan / zoom at fit, drag, collaborators | unchanged within the noise | unchanged within the noise |

- **#183 — initial load.** The trace showed the load wasn't decoding: the doc arrived and applied in
  ~0.3 s, then React mounted the whole board in full detail (1.6 s) and the browser laid it out
  and layered it (2.3 s) before the canvases took over. Entering low detail was deferred
  (`useDeferredValue`), so the first render at the fit's zoom still drew everything as DOM. Low
  detail now switches on at once; the board appears as soon as the doc is applied. (The old
  script also stopped its clock when the item count settled, before that swap, and timed the
  server still digesting the seed and cold reads of a fresh build; it now waits for both and
  counts until the last long task.) A partial Yjs sync (visible region first) isn't possible with
  y-protocols' state exchange and isn't needed at this size.
- **#182** — selected items mount like the rest; the selection outlines, keyboard and toolbar
  already worked from the doc.
- **#184** — leaving low detail keeps the canvases (at their old resolution) for what hasn't
  mounted yet and mounts items nearest the pointer first, in batches sized by the last frame; a
  canvas whose items mount repaints only their part.
- **#185** — kanbans, diagrams and frames (once a frame's title can't show; hidden frames never)
  paint in low detail; at fit the benchmark board is 252 DOM nodes instead of 307, and a board of
  many kanbans no longer keeps one DOM tree per kanban.

## Still open

- **Each half-octave zoom step in low detail repaints every canvas** (36–47 ms frames at fit on
  this board): the p95 of zooming at fit. Painting at the old resolution until the zoom settles
  (as leaving low detail does now) would remove them.
- The headless numbers are software-rendered; a GPU raster changes the paint side of every row,
  not the layering and React work.
