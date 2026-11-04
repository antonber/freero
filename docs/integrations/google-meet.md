# Google Meet

Freero's **Google Meet add-on** opens a board in a Meet call: someone picks it in the side panel and
opens it on the **main stage**, and everyone else in the call is asked to join. It is **off by
default**: you, the operator, deploy the add-on from a Google Cloud project and set its number. Freero
must be reachable at `PUBLIC_URL` over **https**.

- [What people see](#what-people-see)
- [Setting it up (owner)](#setting-it-up-owner)
- [Publishing to the Google Workspace Marketplace](#publishing-to-the-google-workspace-marketplace)
- [Environment variables](#environment-variables)
- [How it works](#how-it-works)
- [Not built yet](#not-built-yet)

## What people see

In a call, **Activities → Freero** opens the side panel (only you see it): **Choose from your boards**
(Freero's own window: sign in, pick a board, turn embedding on if you own it) or paste a board link,
then **Open on the main stage for everyone**. The board takes the main stage, and Meet asks everyone
else in the call to join; those who do get it on their main stage too.

**Who sees what.** The stage *is* the board's [embed](embedding.md), so it follows the board's
sharing for each person: people it is shared with sign in once (Freero's own window) and edit,
comment or view as they can in Freero; a board anyone with its link may view (no password) shows
read-only to everyone else; anyone else sees "Sign in to see this board" and nothing about the board.
Turning embedding off closes it on every stage at once.

## Setting it up (owner)

1. A [Google Cloud project](https://console.cloud.google.com) (any; note its **project number**, on
   the project's dashboard — the number, not the id). Enable the **Google Workspace Marketplace SDK**
   and the **Google Workspace add-ons API** (*APIs & Services → Library*). Don't enable the Marketplace
   *API* (billing).
2. **Set it** on Freero and restart:

   ```sh
   GOOGLE_MEET_CLOUD_PROJECT_NUMBER=<the project number>
   PUBLIC_URL=https://boards.example.com
   ```

3. **Get the deployment manifest**: operator console (`/operator`) → **Apps on other platforms** →
   *Google Meet add-on deployment*, or `npm run admin -- meet:deployment`, or
   `https://<your host>/api/integrations/meet/deployment.json`. It names your side panel
   (`/meet/sidepanel`), your origin (`addOnOrigins`) and Freero's logo.
4. **Create the deployment**: Cloud console → *APIs & Services → Google Workspace Marketplace SDK →
   HTTP deployments → Create new deployment*, any id (`freero`), paste the manifest, **Submit**. Then
   *App configuration → App integration → Google Workspace add-on → Deploy using cloud deployment
   resource*, pick that deployment, and fill in the app's name, descriptions and the support,
   privacy (`https://<your host>/privacy`) and terms links; save.
5. **Test**: *HTTP deployments → Install* (for your own account), start a call at meet.google.com,
   **Activities → Freero**.

## Publishing to the Google Workspace Marketplace

Installing for your own account or your Workspace domain (*Visibility: private*, then a domain admin
installs it for everyone) needs no review. To list it for everyone:

1. Configure the **OAuth consent screen** of the project (the add-on asks for no Google scopes beyond
   the Meet add-on's own: it reads nothing in Google), with your domain verified.
2. *Google Workspace Marketplace SDK → Store listing*: the listing text, a 128×128 icon and banner
   (Freero's mark, `apps/web/public/freero.svg`), screenshots of the side panel and the stage, the
   developer (Kaiten Gaming LLC), support (support@freero.app), privacy and terms links.
3. *Publish* with **Visibility: public**: Google's review (brand, privacy, a working add-on: give a
   Freero test account with a board shared with it and embedding on, and say how to try the stage
   with a second account). After approval it is listed in the Marketplace and in Meet's
   *Activities*.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_MEET_CLOUD_PROJECT_NUMBER` | — | Turns the add-on on: the number of the Google Cloud project the add-on is deployed from (its pages name it to Meet's SDK; not a secret). `/meet/sidepanel` and `/meet/stage/<board>` may then be framed by Google Meet. |

## How it works

- **Pages** (`apps/web/src/app/hosts/meet`, server `modules/meet`): `/meet/sidepanel` (choose a board,
  start the activity) and `/meet/stage/<board>` (the board's public embed).
- **Framing**: only `https://meet.google.com` may frame them (the stage only while the board allows
  embedding); every other Freero page keeps `frame-ancestors 'none'`.
- **Google's SDK**: Google's terms let nobody bundle the Meet add-ons SDK, so the two pages load it from
  where Google serves it (`https://www.gstatic.com/meetjs/addons/1.1.0/meet.addons.js`, the address
  in Google's guide), and only their content security policy allows that origin's scripts.
- **The activity**: the side panel calls `startActivity({ mainStageUrl: /meet/stage/<board>,
  sidePanelUrl: /meet/sidepanel?board=<board> })`; Meet asks the others to join. Each frame creates
  its own add-on session with the project number.
- **Sign-in**: the embed's own — Freero's first-party windows (`/embed/choose` to pick a board,
  `/embed/connect/<board>` to sign in for one) mint a token for that board and that session and hand
  it to the frame (`postMessage` to Freero's own origin). The side panel and the stage share it (both
  are Freero frames in the same Meet page). Only Meet can frame the stage, so editing starts at once.
- No state: nothing about the call is stored.

## Not built yet

- **Tried in a real Meet call.** Checked with Google's published manifest and SDK reference, with Meet
  and its SDK played by a stand-in (headless Chromium), not in Meet itself: things only Meet shows are
  whether its frames allow Freero's sign-in window (pop-ups), and the review.
- **Promoting the add-on while screen sharing** (the screenshare SDK) and co-doing state: Freero's own
  live board already keeps everyone on the stage in step.

## Sources

- Meet add-ons overview: https://developers.google.com/workspace/meet/add-ons/guides/overview
- Using the SDK (sessions, side panel, main stage, activities): https://developers.google.com/workspace/meet/add-ons/guides/use-SDK
- Deploying (manifest, HTTP deployments): https://developers.google.com/workspace/meet/add-ons/guides/deploy-add-on
- Publishing to the Google Workspace Marketplace: https://developers.google.com/workspace/marketplace/how-to-publish
