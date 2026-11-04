# Confluence and Jira

Freero's Atlassian app shows a board live in a **Confluence page** (the *Freero board* macro) and in a
**Jira issue** (the *Freero board* issue panel). It is an [Atlassian Forge](https://developer.atlassian.com/platform/forge/)
app that **your Freero generates for your address**, and it is **off by default**: you, the operator,
create the Forge app, set its id, and deploy what Freero gives you. Freero must be reachable at
`PUBLIC_URL` over **https**.

- [What people see](#what-people-see)
- [Setting it up (owner)](#setting-it-up-owner)
- [Listing it on the Atlassian Marketplace](#listing-it-on-the-atlassian-marketplace)
- [Environment variables](#environment-variables)
- [How it works](#how-it-works)
- [Not built yet](#not-built-yet)

## What people see

**Confluence.** In the editor, type `/Freero board` (or pick it from the macro browser) and paste a
board link in its configuration; or just **paste a board link of your Freero** into the page — it
turns into the macro. The page then shows the board live.

**Jira.** In an issue, open **Apps → Freero board** to add the panel. An issue that Freero's
[tracker sync](../trackers.md) linked to a board item shows that board at once, opened at the linked
item (the panel reads the issue's remote link from Freero). Any other issue offers to paste a board
link, which is kept on the issue for everyone (an issue property; editing the issue is needed).

**Who sees what.** The macro and the panel *are* the board's [embed](embedding.md), so they follow
the board's sharing exactly, for each reader separately:

| The reader | What they see |
|---|---|
| shared on the board | the board after they sign in once (**Sign in** opens Freero's own window); they edit (with **Edit**), comment or view as they can in Freero |
| anyone else, when the board's link lets people **without an account** view it (no password) | the board, read-only, with no presence |
| anyone else | "Sign in to see this board", and nothing about the board |

A board can be shown only while its owner allows embedding (**Share → Embed**) and its workspace's
admin allows embeds; turning that off closes it in every page and issue at once.

**Exports.** A Confluence page exported to PDF or Word shows the board's link, with its picture
when anyone with the link may view the board (a private board's export names nothing of it).

## Setting it up (owner)

You need an [Atlassian developer account](https://developer.atlassian.com) (free) and Node.js 22
on the computer you deploy from.

1. **Create the Forge app.** Install Atlassian's CLI and log in, then create an app *without
   templates* in the [developer console](https://developer.atlassian.com/console/myapps/) (*Create →
   Forge app*), or run `forge register` in an empty folder. Copy its **app id**
   (`ari:cloud:ecosystem::app/<uuid>`):

   ```sh
   npm install -g @forge/cli
   forge login
   ```

2. **Set it** on Freero and restart:

   ```sh
   ATLASSIAN_APP_ID=ari:cloud:ecosystem::app/<uuid>
   PUBLIC_URL=https://boards.example.com
   ```

3. **Download the app's source**: operator console (`/operator`) → **Apps on other platforms** →
   *Confluence and Jira app*, or `npm run admin -- atlassian:package --out freero-atlassian.zip`, or
   `https://<your host>/api/integrations/atlassian/forge-app`. It is a Forge project already pointing
   at your Freero: `manifest.yml` (the macro, the issue panel, the export function, the permissions),
   the macro's and panel's pages (`static-src/`), and `src/index.js`.

4. **Build and deploy** it from the unzipped folder:

   ```sh
   cd freero-atlassian
   npm install                     # Atlassian's Forge packages and esbuild
   npm run build                   # bundles static-src/ into static/
   forge deploy -e production
   forge install -e production     # pick your site, then Confluence; run it again for Jira
   ```

   Forge asks to confirm the app's permissions: reading and writing Jira issues (the remote links and
   the issue property), framing your Freero's board pages, and calling your Freero for exports.

5. In Confluence, edit a page, type `/Freero board`, paste a board link (its owner must allow
   embedding), and publish. In Jira, open an issue → **Apps → Freero board**.

**Updates**: download the source again after a Freero upgrade (or a new `PUBLIC_URL`), then `npm run
build` and `forge deploy -e production` (no reinstall unless the permissions changed; Forge then
asks site admins to accept the new ones).

## Listing it on the Atlassian Marketplace

Installing on your own sites needs none of this. To offer it to every Atlassian customer:

1. Sign Atlassian's **Marketplace Partner Agreement** and create a **vendor** (Kaiten Gaming LLC) in
   the [Marketplace partner console](https://marketplace.atlassian.com/manage/vendors/create).
2. In the developer console, **Distribution → Sharing**: turn on distribution (the app's name,
   vendor, privacy policy `https://<your host>/privacy`, a data-handling questionnaire: the app
   stores nothing at Atlassian except the Jira issue property, and sends nothing to Freero except
   the board link of an export).
3. Marketplace **Create listing → Forge app**: the listing text and screenshots, a support contact
   (support@freero.app), documentation (this page), and the app's **Security** and **Privacy**
   self-assessments. A Forge app that frames or calls an external site isn't eligible for *Runs on
   Atlassian*; say so plainly.
4. Atlassian's review (usually a few weeks). The listed app is the one deployed from freero.app's
   source: self-hosted Freero instances keep deploying their own app as above.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ATLASSIAN_APP_ID` | — | Turns the app on: your Forge app's id (`ari:cloud:ecosystem::app/<uuid>`, or the bare uuid). The app's source is offered, and `/atlassian/b/<board>` may be framed by Atlassian's hosts. |

`PUBLIC_URL` must be your https address: the app frames and calls it.

## How it works

- **The page** (`apps/web/src/app/hosts/AtlassianBoardPage`, server `modules/atlassian`):
  `/atlassian/b/<board>[?item=<id>][&theme=light|dark]` — the board's public embed, opened at the
  item, in Atlassian's colour mode.
- **Framing.** Confluence and Jira pages hold the Forge app's own frame, which Atlassian serves from
  its Forge hosting; that frame frames Freero's page. So only `/atlassian/b/<board>` may be framed,
  only by `https://*.atlassian.net`, `https://*.jira.com` and `https://*.cdn.prod.atlassian-dev.net`
  (never `*`), and only while the board allows embedding. Every other Freero page keeps
  `frame-ancestors 'none'`. On the Forge side, the app's content security policy lets it frame only
  `<your host>/atlassian/b/` (`permissions.external.frames`).
- **Sign-in**: the embed's own — Freero's first-party window (`/embed/connect/<board>`) mints a token
  for that board and that session and hands it to the frame (`postMessage` to Freero's own origin).
  Forge lets frames open windows only with the `fetch.client` permission (it adds `allow-popups` to
  the frame's sandbox), which is why the manifest asks for it; the app fetches nothing in the
  browser. Editing starts with a click on **Edit** on an uncovered frame, like the plain embed (any
  Forge app could frame the page, so the check stays).
- **Jira**: the panel reads `GET /rest/api/3/issue/<key>/properties/freero-board` (a link someone
  pasted), then `GET /rest/api/3/issue/<key>/remotelink` (the first link to your Freero's boards:
  tracker sync's), as the viewing user (`requestJira`). Nothing about the issue reaches Freero.
- **Exports** (`adfExport`): a Forge function asks your Freero's oEmbed (`/api/oembed`) for the
  board and returns its title and picture as a link and an image, or just the link for a board that
  isn't public.
- **The source is generated** per request from `PUBLIC_URL` and the app id (`modules/atlassian/forge.ts`);
  Atlassian's packages (`@forge/bridge`, `@forge/api`, `@forge/cli`, under the Atlassian Developer
  Terms) are dependencies of the generated project only, never of Freero.

## Not built yet

- **Tried on a real Atlassian site.** Checked against Atlassian's published manifest reference and
  with the page framed two levels deep from a stand-in host (sign-in window and all); things only a
  real site shows: Forge's exact hosting origin for Custom UI (the frame-ancestors above), whether
  `fetch.client: "*"` is still what opens the sandbox for windows, and the macro's paste-to-convert.
- **Choosing from your boards** in the macro's configuration (it takes a pasted link): the
  configuration runs on Atlassian's origin, which Freero's chooser window can't hand a board to.
- **Previews of a board link in Jira or Confluence** (Atlassian's link unfurling) beyond the macro.

## Sources

- Forge macro module (config, autoConvert, adfExport): https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/
- Jira issue panel module: https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-issue-panel/
- Forge permissions (external frames, fetch client and popups, scopes): https://developer.atlassian.com/platform/forge/manifest-reference/permissions/
- Custom UI and its iframe: https://developer.atlassian.com/platform/forge/custom-ui/iframe/
- Jira remote links and issue properties: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- Listing a Forge app: https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
