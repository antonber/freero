# Embedding a live board on other sites

A Freero board can be shown live inside another page: a Notion or Confluence page, a wiki, a blog,
an LMS or your own website. People pan and zoom it there, see changes as they happen, and (once
signed in) comment or edit in place. Pasting a board's link into a tool that understands oEmbed
embeds it without any code.

An embed **never shows more than the board's sharing does**. It is a window onto the board, not a
new way in.

## Turning it on

1. Open the board → **Share** → **Embed on other sites** and switch it on (board owners only).
2. Choose the options:
   - **View only**: everyone stays read-only in this embed, whatever they may do on the board.
   - **Start at**: the whole board, or one of its frames (the embed opens zoomed to it).
3. **Copy embed code** and paste it into the page, or **Copy embed link** for tools that ask for a
   URL (Notion's `/embed`, Confluence's iframe macro, WordPress, Webflow …).

The code is an ordinary iframe:

```html
<iframe src="https://freero.app/embed/b/BOARD_ID?readonly=1&frame=FRAME_ID" width="800" height="600"
  title="Roadmap" style="border:0;max-width:100%" allow="fullscreen; clipboard-read; clipboard-write"
  allowfullscreen loading="lazy"></iframe>
```

| Parameter | Meaning |
|---|---|
| `readonly=1` | read-only for everyone in this embed |
| `frame=<item id>` | start zoomed to this frame (any item id works; *Copy link to item* gives one as `?item=`) |
| `theme=dark` | dark chrome and canvas to match a dark page (board content keeps its colours); without it the embed is light, whatever the viewer picked in Freero |

Switching embedding off stops every embed of the board at once, wherever it was pasted.

## Who sees what

| Viewer | What the embed shows |
|---|---|
| Someone without a Freero account | The board **read-only**, only if its link lets visitors without an account in (*Anyone with the link* and the workspace allows visitors without an account; no link password). Otherwise a *Sign in* card that does not name the board. Visitors appear nowhere on the board: no cursor, no name. |
| Someone who signs in from the embed | Exactly their own access: their role on the board (from an invite, their team or the link), capped at view with `readonly=1`. No access: they can ask for it. |

Signing in happens in a small Freero window (a pop-up): the embed never sees your password or your
Freero session. That window gives the embed a key for **this board only**, which ends when you sign
out of Freero (or after 7 days). The embed keeps it in the browser's storage for that one embedding
site (browsers keep a frame's storage separately per site), so an embed of the same board on
another site asks you to sign in there too.

**Editing starts with a click.** Even for someone who may edit, the embed opens read-only; *Edit* (or
*Comment*) in its top bar starts editing. Where the browser can tell (Chrome, Edge), editing doesn't
start while the embed is covered or made transparent by the page around it, so a page can't trick
your clicks into changes you don't see. A read-only embed (`readonly=1`) never edits.

## For workspace admins

Admin console → **Sharing** → *Embedding boards on other sites*: **Off** keeps every board of the
workspace out of other sites (embeds already pasted stop working at once, and owners can't turn
embedding on). It is separate from *Live embeds*, which is about videos and design files shown
**inside** boards. Turning embedding on or off is recorded in the audit log
(`board.embedding_changed`).

## oEmbed

Freero is an oEmbed provider (`type: "rich"`):

```
GET /api/oembed?url=https://freero.app/board/BOARD_ID[&maxwidth=…][&maxheight=…][&format=json]
```

- `url`: a board link (`/board/<id>`, `?item=<id>` becomes the frame to start at) or an embed link
  (`/embed/b/<id>…`) of this server.
- Answers only for boards whose embedding is on (404 otherwise, the same for "no such board").
  A board visitors may view answers with its title; any other embeddable board with the title
  *Freero board*, so the endpoint never names a private board.
- `html` is the iframe above; `width` / `height` follow `maxwidth` / `maxheight` (default 800 × 600).
- Board pages of public, embeddable boards carry
  `<link rel="alternate" type="application/json+oembed" …>`, so unfurlers that read a page's HTML
  (Iframely — which Notion uses —, Embedly, WordPress) find the endpoint on their own.

## Self-hosting

| Setting | Default | Meaning |
|---|---|---|
| `EMBED_MAX_VISITORS_PER_BOARD` | `200` | Visitors without an account watching one board through embeds at a time, per server instance. Later ones see a card with *Open in Freero* and *Try again*. Signed-in people are never counted. `0` lets no visitor in. |

Only `/embed/b/<id>` of a board that allows embedding may be framed by other sites
(`Content-Security-Policy: frame-ancestors *`); every other page keeps `frame-ancestors 'none'` and
`X-Frame-Options: DENY`, and the app refuses to render anything but an embed inside a frame. The
sign-in window (`/embed/connect/<id>`) keeps `window.opener` (`Cross-Origin-Opener-Policy:
unsafe-none`) so it can hand the key back, and is never framable.

Embedding sites that sandbox their iframes must allow `allow-scripts allow-same-origin allow-popups`
(and `allow-popups-to-escape-sandbox`) for sign-in to work; a read-only public embed needs only the
first two.
