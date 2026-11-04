# Figma

Two ways to get Figma frames onto a Freero board as pictures everyone on the board can see —
whether or not they have access to the Figma file — each linking back to its frame:

- **Place from Figma** (#171): inside Freero, board menu → *Place from Figma…*. People sign in to
  their own Figma account once, open a file (paste its link, or pick one they used before), tick
  frames and place them. *Refresh from Figma* (the picture's toolbar or right-click menu) renders
  the frame again when the design changed. Needs the operator's Figma OAuth app.
- **The Freero plugin for Figma** (#172): inside Figma, select frames and send them to a board.
  See [The Figma plugin](#the-figma-plugin) below.

A pasted Figma link still becomes a live embed through Figma's own viewer (who sees it is up to
Figma's sharing), as before.

## How Place from Figma works

- `modules/figma` on the server; nothing in the browser talks to Figma except the consent page
  and, in the picker, Figma's own short-lived preview pictures.
- **Connect Figma** is Figma's OAuth 2 consent for the operator's app, scopes
  `current_user:read`, `file_content:read`, `file_metadata:read` (read only). The state is single
  use, ten minutes, bound to the account and to the browser that started it. The access and
  refresh tokens are sealed at rest (`SESSION_SECRET`, see operations.md "Rotating
  SESSION_SECRET"), refreshed shortly before they expire, and never sent to a browser.
  *Disconnect* in the picker deletes them; a token Figma refuses (revoked in Figma's settings)
  drops the connection and the picker asks to connect again. Deleting the Freero account deletes
  them too.
- A file's frames are the frames, components, component sets and sections at the top of its
  pages (the first 60, with small previews Figma renders). "Recent files" are the files the
  person opened in the picker (Figma's API has no list of a person's recent files); the newest
  20 are kept.
- **Placing** asks Figma's images endpoint (`GET /v1/images/:file`) for a PNG at twice the
  frame's size (the long side at most 4096 px), downloads it — only over https through the same
  SSRF-safe fetch as link previews — and stores it through the upload checks: the bytes must be a
  PNG, under `MAX_UPLOAD_MB`, within the person's upload quota. The picture on the board is an
  ordinary image whose item link is the frame's Figma link; that link is what *Refresh* reads.
  Refreshing stores a new upload (the old one is swept once nothing uses it) and keeps the
  picture's position and width.
- Who may place: editors of the board. Figma decides which files the person can read.

## Owner steps (outside the code)

1. Sign in to Figma with the account that should own the app (the company's), open
   <https://www.figma.com/developers/apps> and **create a new app**: name *Freero*, your website,
   the Freero logo (`apps/web/public/icons/`), a support email.
2. **Callback URL**: `https://<your Freero>/api/integrations/figma/oauth/callback` (for the hosted
   instance `https://freero.app/api/integrations/figma/oauth/callback`).
3. **Scopes**: `current_user:read`, `file_content:read`, `file_metadata:read`. Nothing else.
4. Copy the client ID and secret into `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET` (Railway variables
   for freero.app) and redeploy. The board menu then shows *Place from Figma…*.
5. Figma lets a new app be used by its owner's team only until it is **published**: submit it for
   Figma's review from the same page (privacy policy and terms links: freero.app/privacy,
   freero.app/terms). Add Figma to the privacy policy and the subprocessor list: the files a
   person opens and the frames they render are read from Figma under their own account.

To try it locally without Figma: `node scripts/lib/mock-figma.mjs --port 4471`, then start the
server with `FIGMA_CLIENT_ID=dev FIGMA_CLIENT_SECRET=dev FIGMA_API_URL=http://127.0.0.1:4471
FIGMA_OAUTH_URL=http://127.0.0.1:4471/oauth` and paste
`https://www.figma.com/design/MockCheckoutFile2026/Checkout` into the picker.

## The Figma plugin

`integrations/figma` (MIT, no dependencies; built with `node integrations/figma/build.mjs`). In
Figma: select frames → Plugins → *Freero* → pick a board → *Send to board*. Each frame is exported
by Figma as a PNG (twice its size, the long side at most 4096 px) and sent to
`POST /api/v1/boards/{boardId}/images` (scope `boards:write`): stored through the upload checks
(its bytes decide its type, the size cap, the sender's quota) and placed as an image whose link
points back at the frame. Sending a frame again updates its picture in place instead of adding
another: the plugin remembers, in the frame's plugin data, which item it became on each board
(`replace`), and a teammate's copy of the plugin finds it by the frame's link.

- **Signing in**: *Sign in to Freero* registers the plugin with the chosen Freero as a public OAuth
  app (dynamic client registration) whose redirect is `/api/integrations/figma/plugin/callback`,
  opens Freero's consent in the browser, and polls `POST /api/integrations/figma/plugin/pickup`
  with its secret `state` for the code (kept sealed, single use, five minutes), which it redeems
  with its PKCE verifier. Or paste a personal API token (Settings → API tokens). The sign-in stays
  in Figma's client storage on that computer.
- **Links back**: Figma tells only private and organisation plugins the file's key; the published
  plugin asks for the file's link once (*Copy link* in Figma's Share menu) and keeps the key with
  the file. Without it, pictures are sent without a link (re-sending still updates them through the
  remembered item).
- It works with any Freero: the address field takes the server; the build bakes in the one the
  manifest may reach (`networkAccess`).

### Owner steps: publishing to the Figma Community

1. `node integrations/figma/build.mjs` (hosted: the default `https://freero.app`; a self-hosted
   operator passes `--server https://their.freero` and publishes privately to their organisation).
2. In the Figma desktop app: Plugins → Development → *Import plugin from manifest…* →
   `integrations/figma/manifest.json`. Try it against freero.app (or a local server on
   `http://localhost:4000`, which the manifest allows while developing).
3. Plugins → Development → *Publish*: Figma assigns the plugin id on the first publish — write it
   into `manifest.json` with `node integrations/figma/build.mjs --id <id>`, commit it, and build
   again before every later publish. Fill in the listing: name *Freero*, a tagline, the
   description (what is sent where: the selected frames, as pictures, to the board you pick), an
   icon (128×128, from `apps/web/public/icons/`), a cover image (1920×1080: the plugin beside a
   board), a support contact, and the network access reason (already in the manifest).
4. Figma reviews Community plugins (usually within a few working days); answer their questions
   from the Figma account that published it. Once approved, the plugin is listed.
