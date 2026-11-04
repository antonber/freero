# Zoom

Freero's **Zoom App** opens a board live in a Zoom meeting's app panel, and lets the host invite
everyone in the meeting to open the same board. It is **off by default**: you, the operator, create the
app in the Zoom App Marketplace, set its Client ID, and enter the values your Freero lists. Freero must
be reachable at `PUBLIC_URL` over **https**.

- [What people see](#what-people-see)
- [Setting it up (owner)](#setting-it-up-owner)
- [Publishing to the Zoom App Marketplace](#publishing-to-the-zoom-app-marketplace)
- [Environment variables](#environment-variables)
- [How it works](#how-it-works)
- [Not built yet](#not-built-yet)

## What people see

In a meeting, **Apps → Freero**. The first time, the panel asks to sign in to Freero (Zoom's apps keep
their own sign-in, separate from your browser's), then lists your boards: pick one (its owner must
allow embedding; the owner can turn that on right there). In Zoom's web client the panel instead
offers **Choose from your boards** (Freero's own window) or a pasted board link.

**Invite everyone** (hosts and co-hosts): Zoom invites everyone in the meeting to open the app, and
their app opens the same board. **Another board** goes back to the list.

**Who sees what.** The panel *is* the board's [embed](embedding.md), so it follows the board's
sharing for each person:

| The person | What they see |
|---|---|
| shared on the board | the board after they sign in to Freero once; they edit, comment or view as they can in Freero |
| anyone else, when the board's link lets people **without an account** view it (no password) | the board, read-only, with no presence — a guest in the meeting needs no Freero account |
| anyone else | "Sign in to see this board", and nothing about the board |

Turning embedding off closes the board in every meeting at once, and takes it off the meeting.

## Setting it up (owner)

1. [Zoom App Marketplace](https://marketplace.zoom.us) → **Develop → Build App → General App**
   (user-managed). Copy the **Client ID** (*App Credentials*).
2. **Set it** on Freero and restart:

   ```sh
   ZOOM_CLIENT_ID=<the Client ID>
   PUBLIC_URL=https://boards.example.com
   ```

3. **Get your app's values**: operator console (`/operator`) → **Apps on other platforms** → *Zoom App
   settings*, or `npm run admin -- zoom:settings --out freero-zoom.json`, or
   `https://<your host>/api/integrations/zoom/app-settings`. Enter them in the build flow:

   | Build flow | Value |
   |---|---|
   | Basic information → OAuth redirect URL, OAuth allow list | `https://<your host>/zoom/installed` |
   | Features → Surface → products | **Meetings** |
   | Features → Surface → Home URL | `https://<your host>/zoom/home` |
   | Features → Surface → Domain allow list | `<your host>` |
   | Features → Surface → Zoom App SDK → APIs | `getRunningContext`, `getMeetingUUID`, `getUserContext`, `sendAppInvitationToAllParticipants`, `showAppInvitationDialog`, `openUrl`, `onRunningContextChange`, `onMyUserContextChange` |
   | Features → Surface → Guest mode | on (guests open public boards) |
   | Scopes | `zoomapp:inmeeting` |

   In-client OAuth stays off: Freero calls no Zoom API, so it needs no Zoom token.
4. **Local test**: *Add app now* in the build flow (or open the app's authorization URL), then in a
   meeting **Apps → Freero**. Share the test link with your own account's colleagues to try it
   together.

## Publishing to the Zoom App Marketplace

Adding the app for your own account needs none of this. To list it for every Zoom user:

1. In the build flow, complete **App listing** (name, short and long description from the settings
   file's `listing`, a 160×160 icon — Freero's mark, `apps/web/public/freero.svg`, exported as PNG —,
   screenshots of the panel in a meeting, the privacy, terms, support and documentation links).
2. **Technical design**: the security questionnaire (Freero stores no Zoom data; it keeps the hash of
   a meeting's UUID with the board opened for it for a day; see [How it works](#how-it-works)).
3. **Submit** for Zoom's review, with a **test account**: a Freero account on your instance with a
   board shared with it (and embedding on), and how to try *Invite everyone* (two Zoom accounts in
   one meeting). Zoom's reviewers check the security headers of every page the app loads (Freero
   sends `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options` and
   `Referrer-Policy` on every response).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ZOOM_CLIENT_ID` | — | Turns the Zoom App on: your Zoom app's Client ID. The settings are offered, `/zoom/home` and `/zoom/b/<board>` may be framed by Zoom's web client, and meetings can record their board. |
| `RATE_LIMIT_ZOOM_MEETING_BOARD` | `120/10m` | Per IP: a meeting's board set or looked up (once per participant who opens the app). |

## How it works

- **Pages** (`apps/web/src/app/hosts/zoom`, server `modules/zoom`): `/zoom/home` (the meeting's
  board, or the chooser), `/zoom/b/<board>` (the board's public embed with Zoom around it) and
  `/zoom/installed` (where Zoom sends people after they add the app). The Zoom Apps SDK
  (`@zoom/appssdk`, MIT) is the only Zoom code Freero uses (`zoomSdk.ts`).
- **Zoom's desktop and mobile apps** load the pages at the top level of their own browser, which
  keeps its own cookies: people sign in to Freero right there (password or single sign-on; Google may
  refuse sign-in inside an app's browser), and the panel mints the board's embed token with that
  session.
- **Zoom's web client** frames the pages: so `/zoom/home` and `/zoom/b/<board>` may be framed only by
  `https://zoom.us` and `https://*.zoom.us` (the board page only while the board allows embedding);
  framed, they see no session cookie (a third-party frame) and sign in through the embed's
  first-party window, like a board embedded anywhere.
- **Invite everyone**: `PUT /api/integrations/zoom/meeting-board { meetingUuid, boardId }` — from
  someone signed in who can open the board (the session, or the board's embed token where there is
  no session), only while it allows embedding — then Zoom's `sendAppInvitationToAllParticipants`.
  An invited participant's app asks `POST /api/integrations/zoom/meeting-board/lookup { meetingUuid }`
  and opens that board. Freero keeps only the **sha256 of Zoom's meeting UUID** (known to the meeting's
  participants) with the board id, for a day (`zoom_meeting_boards`); the answer is null once the
  board stops allowing embedding, and names nothing else. What each person then sees is the board's
  own sharing.

## Not built yet

- **Tried in a real Zoom client.** Checked against the SDK's own message protocol with a stand-in Zoom
  web client and a stand-in desktop browser (headless Chromium), not in Zoom itself: things only Zoom
  shows are the exact web-client origin that frames apps, how its desktop browser handles Freero's
  sign-in, and the review's checks.
- **Collaborate mode** (Zoom's own "everyone in the app together" with shared state): the invitation
  plus Freero's own live board does the same.
- **Zoom's manifest import**: it is an early preview whose feature fields aren't documented, so the
  values above are entered by hand.

## Sources

- Zoom Apps SDK (`@zoom/appssdk`, MIT): https://github.com/zoom/appssdk
- Building a Zoom App (home URL, domain allow list, OAuth redirect): https://developers.zoom.us/docs/zoom-apps/
- App manifests (preview): https://developers.zoom.us/docs/build-flow/manifests/
