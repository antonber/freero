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
