# Microsoft Teams and Microsoft 365 Copilot

Freero offers two Microsoft 365 apps, both **off by default**. You, the operator, register them with
Microsoft, set a few environment variables, and Freero builds the app packages for your instance:

- **The Teams app**: a board as a channel or chat tab, and in meetings (side panel, meeting chat,
  details, and shared to the meeting stage for everyone). With an Azure Bot, Freero links pasted in
  Teams messages also get a preview card.
- **The Copilot agent**: Microsoft 365 Copilot puts stickies, clusters, task tables, kanbans and
  diagrams on Freero boards through Freero's [MCP server](../mcp.md), signed in with Freero's own
  OAuth, and answers with the board link.

Nothing here needs a listing in the Teams store: an organisation's Teams admin can upload the
packages for their own people. Freero must be reachable at `PUBLIC_URL` over **https**.

- [What people see](#what-people-see)
- [The Teams app: tab and meetings](#the-teams-app-tab-and-meetings)
- [Link previews (the bot)](#link-previews-the-bot)
- [Microsoft 365 Copilot](#microsoft-365-copilot)
- [Publishing to the Teams store](#publishing-to-the-teams-store)
- [Environment variables](#environment-variables)
- [How it works](#how-it-works)
- [Not built yet](#not-built-yet)

## What people see

**Adding a board.** In a channel, a group chat or a meeting, someone selects **+** (Add a tab),
picks Freero, and either chooses one of their boards (a Freero window opens: they sign in if they
need to, pick a workspace and a board) or pastes a board link. The tab is named after the board.

**Who sees what.** The tab *is* the board's [embed](embedding.md), so it follows the board's sharing
exactly, for each person separately:

| The person | What the tab shows |
|---|---|
| shared on the board (member, invited, a team with access) | the board after they sign in once (**Sign in** opens Freero in Teams' sign-in window); they edit, comment or view as they can in Freero |
| anyone else, when the board's link lets people **without an account** view it (no password) | the board, read-only, with no presence |
| anyone else | "Sign in to see this board", and nothing about the board |

So a channel tab never shows a board to someone Freero wouldn't. A board can only be added when its
owner allows embedding (**Share → Embed**) and its workspace's admin allows embeds; the board picker
offers to turn embedding on for boards you own. Turning embedding off, or the board's link, closes
the board in every tab at once.

**Meetings.** Add Freero to a meeting (before it, or from **Apps** during it). In the side panel,
organisers and presenters get **Share to stage**: the board takes the meeting stage for everyone,
and each participant sees and edits it with their own access, as above.

**Theme.** The tab follows Teams' theme (default, dark, high contrast).

**Link previews** (with the bot). A Freero link pasted in a message unfolds into a card:

| The link is to… | Card |
|---|---|
| a board anyone with the link can view without an account | its title, description and thumbnail, "Freero board · anyone with the link can view", and **Open in Freero** |
| anything else (a private board, a doc, a board that doesn't exist) | the same card every time, "Freero board — Sign in to Freero to view it.", with no title |

The rule is the [Slack previews'](slack.md#what-a-preview-shows) rule. Teams caches a preview for 30
minutes.

## The Teams app: tab and meetings

1. **Pick an app id.** Any GUID, kept for the life of the app (it is how Teams recognises updates):

   ```sh
   uuidgen                          # macOS, Linux
   [guid]::NewGuid().Guid           # PowerShell
   ```

   (If you create the app in the [Teams Developer Portal](https://dev.teams.microsoft.com/apps)
   instead, use the App ID it shows.)

2. **Set it** and restart Freero:

   ```sh
   TEAMS_APP_ID=<the GUID>
   PUBLIC_URL=https://boards.example.com
   ```

3. **Download the package** — any of:
   - the operator console (`/operator`) → **Microsoft 365 apps** → *Teams app package*;
   - `npm run admin -- teams:package --out freero-teams.zip` (`--url` for another address);
   - `https://<your host>/api/integrations/teams/app-package` (public: nothing in it is secret, and
     your customers' Teams admins can fetch it themselves).

   It holds `manifest.json` (manifest schema 1.19) and Freero's two icons. **Updates:** Teams accepts
   a new package for the same app id only with a higher version: add `--version 1.0.1` (or
   `?version=1.0.1`), and keep going up.

4. **Upload it to Teams.** Microsoft 365 tenants do this in one of two ways:
   - **For the whole organisation** (a Teams administrator): [Teams admin center](https://admin.teams.microsoft.com)
     → **Teams apps → Manage apps → Upload new app**, then allow it in the app permission and setup
     policies you use.
   - **To try it yourself**: in Teams, **Apps → Manage your apps → Upload an app → Upload a custom
     app**. Your tenant must allow custom apps (Teams admin center → **Teams apps → Setup policies**
     → *Upload custom apps* on, and **Manage apps → Org-wide app settings** → *Custom apps* on). A free
     [Microsoft 365 developer sandbox](https://developer.microsoft.com/microsoft-365/dev-program) works.

5. In a channel, select **+**, choose Freero, pick a board, **Save**.

No Entra app registration is needed for the tab: people sign in with their Freero account in
Teams' sign-in window (see [How it works](#how-it-works)).

## Link previews (the bot)

Teams sends pasted links to a bot, so link previews need an **Azure Bot** — an Azure subscription
(the Teams channel is free on the F0 tier).

1. [Azure portal](https://portal.azure.com) → **Create a resource → Azure Bot**:
   - **Bot handle**: anything, e.g. `freero-boards-example-com`;
   - **Pricing tier**: Free (F0);
   - **Type of App**: *Single Tenant* (Azure no longer creates new multi-tenant bots), **Creation
     type**: *Create new Microsoft App ID*. This creates an Entra app registration for the bot.
2. Bot → **Configuration** → **Messaging endpoint**:
   `https://<your host>/api/integrations/teams/messages`. Copy the **Microsoft App ID**.
3. Bot → **Channels** → **Microsoft Teams** → accept the terms → **Apply**.
4. Set `TEAMS_BOT_ID=<the Microsoft App ID>` (with `TEAMS_APP_ID`) and restart Freero.
5. Download the package again with a higher `--version` and upload the update. It now carries a
   message extension that handles links to your host (`composeExtensions.messageHandlers`, also for
   people who haven't added the app).

Freero needs **no bot secret**: it only answers Teams' requests (the card goes back in the HTTP
response) and never calls the Bot Connector. Leave the client secret in Entra unused.

A *Single Tenant* bot belongs to your own Microsoft 365 tenant. If people from other organisations
use your Freero (a hosted service), check Microsoft's current guidance on bots used across tenants
before you rely on previews there; the tab and meetings don't involve the bot.

## Microsoft 365 Copilot

The agent is a separate app package: a declarative agent whose one action is Freero's MCP server
(`https://<your host>/mcp`), with the tools listed in the package from the server's own
descriptions. People sign in through Freero's OAuth 2.1 server, exactly like Claude or ChatGPT:
reading and proposing changes by default, changing boards and commenting only if they tick them on
Freero's consent screen. Changes appear live, labelled "Microsoft 365 Copilot for <name>", and every
call is audited and covered by the same kill switches ([mcp.md](../mcp.md)). Copilot asks the person
to confirm before any tool that changes a board. It never deletes, shares or syncs to trackers.

People need a Microsoft 365 Copilot licence.

1. **Register Copilot as an OAuth app in Freero.** Signed in as the account that will own it:
   **Settings → Your OAuth apps → Register app**:
   - App name: `Microsoft 365 Copilot` (people see it on the consent screen and in activity);
   - Redirect URIs: `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect`;
   - **Confidential app** on (it gets a client secret, shown once).
2. **Register the OAuth client with Microsoft.** [Teams Developer Portal](https://dev.teams.microsoft.com)
   → **Tools → OAuth client registration → Register client**:

   | Field | Value |
   |---|---|
   | Base URL | `https://<your host>/mcp` |
   | Restrict usage by org | your organisation, or *Any Microsoft 365 organization* |
   | Client ID / Client secret | from step 1 |
   | Authorization endpoint | `https://<your host>/oauth/authorize?resource=https%3A%2F%2F<your host>%2Fmcp` |
   | Token endpoint / Refresh endpoint | `https://<your host>/api/oauth/token` |
   | Scope | `boards:read boards:suggest` |
   | Enable PKCE | on (Freero requires it) |

   Save, and copy the **OAuth client registration ID**.

   The `resource` in the authorization endpoint binds Copilot's tokens to the MCP server (RFC 8707).
   If Microsoft drops it, the tokens are for the REST API instead, `/mcp` answers them with 401, and
   Copilot keeps asking people to sign in. (Not yet tried against a real tenant: see
   [Not built yet](#not-built-yet).)
3. **Set** and restart Freero:

   ```sh
   COPILOT_APP_ID=<a new GUID, not the Teams app's>
   COPILOT_OAUTH_REFERENCE_ID=<the OAuth client registration ID>
   ```
4. **Download the package**: operator console → **Microsoft 365 apps** → *Copilot agent package*,
   `npm run admin -- copilot:package --out freero-copilot.zip`, or
   `https://<your host>/api/integrations/copilot/agent-package`. It holds `manifest.json`,
   `declarativeAgent.json` (schema 1.6), `freero-plugin.json` (API plugin schema 2.4, a
   `RemoteMCPServer` runtime) and the icons.
5. **Upload it**: [Microsoft 365 admin center](https://admin.microsoft.com) → **Settings → Integrated
   apps → Upload custom apps**, or the Teams admin center like the Teams app, or to try it yourself
   Teams → **Apps → Manage your apps → Upload a custom app**. Then in Copilot Chat, pick **Freero**
   under Agents and try *"Draw our onboarding process as a flowchart on a new Freero board"*.

## Publishing to the Teams store

Uploading for one organisation needs none of this. To list the apps in the Teams store (and the
agent store) for every organisation:

1. Join the [Microsoft AI Cloud Partner Program](https://partner.microsoft.com) and open a
   **Partner Center** account (company verification).
2. **Publisher verification**: in Entra ID, mark the bot's app registration (and any other Entra app
   you use) with your verified Partner ID.
3. Partner Center → **Marketplace offers → New offer → Teams app**: upload the same package (store
   listing text, screenshots, a support and privacy URL, test notes and a test account that Microsoft's
   reviewers can sign in to Freero with), and submit for validation.

Store apps must be multi-organisation: see the bot note above.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TEAMS_APP_ID` | — | Turns the Teams app on: the GUID of your Teams app. The tab pages may then be framed by Teams, and the package is offered. |
| `TEAMS_BOT_ID` | — | The Azure Bot's Microsoft App ID (needs `TEAMS_APP_ID`): link previews at `/api/integrations/teams/messages`. Without it that route doesn't exist (404). |
| `TEAMS_BOT_OPENID_METADATA_URL` | `https://login.botframework.com/v1/.well-known/openidconfiguration` | Where the Bot Connector's signing keys are published (tests point it at a stand-in). |
| `RATE_LIMIT_TEAMS_UNFURL` | `120/1m` | Per Microsoft 365 tenant: link previews answered; past it, links get no card. |
| `COPILOT_APP_ID` | — | The GUID of your Copilot agent app (not the Teams app's). With the next one, turns the Copilot package on. |
| `COPILOT_OAUTH_REFERENCE_ID` | — | The OAuth client registration ID from the Teams Developer Portal. One without the other refuses to start. |

`PUBLIC_URL` must be your https address: the packages point Teams there.

## How it works

- **Pages** (`apps/web/src/app/teams`, server `modules/teams`): `/teams/config` (the tab's
  configuration page), `/teams/b/<board>` (tab, side panel, stage: the board's public embed with
  Teams' context and theme, through the Teams JavaScript library `@microsoft/teams-js`, MIT), and
  `/teams/choose` (the board picker in Teams' sign-in window).
- **Framing.** Only these pages may be framed, only by Microsoft's documented Teams and Microsoft
  365 hosts (`teams.microsoft.com`, `*.teams.microsoft.com`, `*.cloud.microsoft`, `*.office.com`,
  `*.microsoft365.com`), never by any other site — and `/teams/b/<board>` only while the board allows
  embedding, the embed's own rule. Every other Freero page keeps `frame-ancestors 'none'`.
- **Sign-in, without Teams single sign-on.** The tab never sees the Freero session (it is a
  third-party frame). **Sign in** opens Freero's own page in Teams' sign-in window
  (`authentication.authenticate`): `/embed/connect/<board>?teams=1` — the embed's sign-in page —
  where the person signs in and confirms, and Freero mints the embed's token for that board and that
  session. It goes back to the tab through the Teams library (`authentication.notifySuccess`), which
  only talks to Teams' own origins. In Teams' desktop and mobile apps the window signs in in place;
  on Teams in a browser it opens a sign-in tab like the plain embed. Editing starts at once (only
  Teams can frame the page, so the plain embed's "is the frame covered?" step isn't needed).
- **Share to stage**: `meeting.shareAppContentToStage` with the tab's own URL, offered when Teams says
  the person may share (`getAppContentStageSharingCapabilities`); the manifest asks for
  `MeetingStage.Write.Chat` and `ChannelMeetingStage.Write.Group` (resource-specific consent).
- **Bot requests** are checked as Microsoft requires of bots that check them themselves: a Bearer
  JWT signed RS256 by a key from the Bot Connector's OpenID metadata (cached, refreshed daily, and
  once more when a token names a new key — at most every five minutes), issuer
  `https://api.botframework.com`, audience `TEAMS_BOT_ID`, within its validity (five minutes'
  skew), its `serviceurl` equal to the activity's, and the key endorsed for the `msteams` channel
  (403 otherwise). Anything else is 401, before any board is read. Each preview is one log line
  `"teams": { "invoke", "tenant", "outcome" }` (`public`, `generic`, `not_ours`, `rate_limited`);
  refusals are `"teams": { "refused": <reason> }`; the metric is
  `freero_teams_link_previews_total{outcome}`. Board text goes into the card only as plain text runs
  (never Markdown). Nothing is stored.
- **Packages** are built per request from `PUBLIC_URL` and the ids (the icons are drawn from
  Freero's mark), and checked against Microsoft's published JSON schemas.

## Not built yet

- **Teams single sign-on** (an Entra app for `getAuthToken`, mapped to the Freero account): people
  sign in with their Freero account instead.
- **Personal notifications in Teams** ("Connect Microsoft Teams" in settings; mentions, replies and
  assignments as bot messages, deduplicated with email). Workspace webhooks in the `teams` format
  already post board activity to a channel ([events.md](../events.md)).
- **Tried against a real Microsoft 365 tenant.** Everything here was checked against Microsoft's
  published schemas and documentation, with Teams and the Bot Connector played by local stand-ins
  (the Teams JavaScript library's own protocol, tokens signed by local keys). Things only a real
  tenant shows: Teams' desktop sign-in window signing in in place, whether Copilot's OAuth vault keeps
  the `resource` parameter, and single-tenant bots across organisations.
- **Previews of private boards for people who can open them** (needs the account linking above):
  until then every private link gets the generic card.

## Sources

- App manifest reference: https://learn.microsoft.com/microsoft-365/extensibility/schema/
- Tabs, configuration pages, frame-ancestors: https://learn.microsoft.com/microsoftteams/platform/tabs/how-to/tab-requirements
- Apps in meetings, share to stage: https://learn.microsoft.com/microsoftteams/platform/apps-in-teams-meetings/build-apps-for-teams-meeting-stage
- Authentication in tabs (sign-in window): https://learn.microsoft.com/microsoftteams/platform/tabs/how-to/authentication/auth-flow-tab
- Link unfurling: https://learn.microsoft.com/microsoftteams/platform/messaging-extensions/how-to/link-unfurling
- Bot Connector authentication: https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
- Azure Bot registration: https://learn.microsoft.com/azure/bot-service/bot-service-quickstart-registration
- Uploading custom apps: https://learn.microsoft.com/microsoftteams/platform/concepts/deploy-and-publish/apps-upload
- Declarative agent manifest 1.6: https://learn.microsoft.com/microsoft-365-copilot/extensibility/declarative-agent-manifest-1.6
- API plugin manifest 2.4 (`RemoteMCPServer`): https://learn.microsoft.com/microsoft-365-copilot/extensibility/plugin-manifest-2.4
- OAuth in API plugins (Developer Portal registration): https://learn.microsoft.com/microsoft-365-copilot/extensibility/api-plugin-authentication
- Publishing to the Teams store: https://learn.microsoft.com/microsoftteams/platform/concepts/deploy-and-publish/appsource/publish
