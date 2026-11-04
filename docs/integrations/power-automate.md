# Power Automate (and Logic Apps): the Freero connector

Power Automate, Power Apps, Logic Apps and Copilot Studio call other services through
**connectors** made from an OpenAPI file. They accept only OpenAPI **2.0** (Swagger), under 1 MB.
Freero's REST API is described in OpenAPI 3.1 ([../api/openapi.json](../api/openapi.json)), so the
repository ships converted copies, made by `npm run gen:power-automate`:

- [`power-automate/freero.swagger.json`](power-automate/freero.swagger.json): a **custom connector**
  for any Freero instance (every `/api/v1` operation, signed in with a personal access token), for the
  example host `freero.example.com`;
- [`power-automate/certified/`](power-automate/certified/): the files Microsoft **certifies** for the
  hosted Freero at freero.app (the operations a flow needs, OAuth sign-in), so people find Freero in
  Power Automate's connector list without importing anything. Certification is the owner's step:
  [Certifying the connector](#certifying-the-connector-owner).

Both have the trigger **When something happens on a board**.

- [Make the file for your instance](#make-the-file-for-your-instance)
- [Create the connector](#create-the-connector)
- [Use it in a flow](#use-it-in-a-flow)
- [The trigger](#the-trigger)
- [Certifying the connector (owner)](#certifying-the-connector-owner)
- [How it works](#how-it-works)

## Make the file for your instance

```sh
npm run gen:power-automate -- --host boards.example.com --out freero-connector.json
```

Without arguments it rewrites the checked-in files, which a test keeps in step with `openapi.json`.
You can also import the example and change **Host** on the connector's *General* page.

What the conversion changes: `requestBody` becomes a `body` parameter, nullable fields are marked
`x-nullable`, and where the API accepts one of several shapes (adding one item or `{ items: […] }`)
the connector offers the first. "Add a webhook" becomes the trigger (below). The REST reference has
the rest.

## Create the connector

1. In [Power Automate](https://make.powerautomate.com), go to **Solutions** and open or create a
   solution, then **New → Automation → Custom connector → Import an OpenAPI file**. Name it
   "Freero" and pick the file.
2. **General**: check the host (your Freero's, without `https://`) and the base URL `/api/v1`.
3. **Security**: *API Key*, parameter name `Authorization`, location *Header*. Set the label to
   something like "Freero token (Bearer frp_…)".
4. **Create connector**, then **Test → New connection**. For the key, enter the word `Bearer`, a
   space and a personal access token made in Freero under **Settings → API tokens**:
   `Bearer frp_…`. Give the token only the scopes the flows need (`boards:read`, `boards:write`,
   `comments:write`, and `webhooks:manage` for the trigger). Each call acts as you, with your
   access, and is in the audit log under the token's name.

**OAuth instead of a token.** Register an OAuth app in Freero (*Settings → Your OAuth apps*) with
**Confidential app** on, change the connector's security to *OAuth 2.0*, identity provider *Generic
OAuth 2*, with your app's client id and secret, authorization URL `https://<host>/oauth/authorize`,
token and refresh URL `https://<host>/api/oauth/token`, scope
`boards:read boards:write comments:write webhooks:manage`. Save, copy the **Redirect URL** Power
Automate shows, and add it to the Freero app's redirect URIs (exactly). Power Automate's generic
OAuth sends no PKCE, which Freero accepts only from confidential apps (they prove themselves with
the secret instead).

## Use it in a flow

- **Card from anything:** a trigger (a Forms response, a new list item, an email), then Freero's
  *insertStructure* action with board id and body
  `{ "structure": { "kind": "items", "items": [ { "type": "card", "text": "…", "description": "…" } ] } }`.
  Add `"placement": { "into": "<kanban id>", "column": "To do" }` to put it in a kanban column. Copy
  the kanban's id from **Copy link to item** in Freero: it is the `item=` part.
- **Meeting notes:** the same action with `{ "structure": { "kind": "meeting", "source": "<the notes>" } }`
  turns a summary or transcript (Markdown, text, WebVTT, SRT) into one frame. See
  [../board-outline.md](../board-outline.md).
- **React to what happens on a board:** the trigger, below.

Board text in responses is untrusted (`notice` says so). Don't feed it to an AI step as instructions.

## The trigger

**When something happens on a board** (`x-ms-trigger: single`): pick a team workspace, the events
(`item.created`, `comment.created` … — [../events.md](../events.md)) and, optionally, **Only for
board** (a board link, or a frame's copied link, to watch only that). When the flow is saved, Power
Automate adds a workspace webhook in the `json` format pointing at the flow's own callback URL; when
the flow is turned off or deleted, it removes it again (Freero answers the webhook's address in the
`Location` header, and Power Automate sends `DELETE` there). Each event runs the flow with its
fields (event type, board id, title and link, who did it, the item or comment) as dynamic content.

- You must be an **owner or admin** of that team workspace (the connection needs
  `webhooks:manage`). Workspace webhooks report only boards **the whole team can open**: never
  personal boards or private projects ([../events.md](../events.md#what-a-webhook-is-never-told)).
- A workspace has at most 20 webhooks; each flow with the trigger uses one. The webhook shows in the
  admin console (**Webhooks**, "Power Automate flow"), with its delivery log.
- Power Automate can't check Freero's `Freero-Signature`: the callback URL is the secret (Power
  Automate's own trigger URLs work the same way). Scope the trigger to one board where you can.
- To post events straight to a Teams channel, Freero's `teams` webhook format and a Teams
  *Workflows* webhook need no connector at all.

## Certifying the connector (owner)

Certification lists Freero in every Power Automate tenant's connector list, signing in with OAuth to
**freero.app** (a certified connector has one fixed host; self-hosted instances keep using the custom
connector above). Only the operator of freero.app can do this. The files are generated and checked
against Microsoft's published rules by a test (summaries, descriptions, visibility, exact response
schemas, OAuth, the icon colour); what is left needs accounts and people:

1. **Choose the route.** As a *verified publisher* (the connector carries Kaiten Gaming LLC's name and
   Freero's icon): a [Microsoft Partner Center](https://partner.microsoft.com) account in the AI Cloud
   Partner Program (company verification). Or as an *independent publisher* (no Partner Center
   account, but the connector is named "Freero (Independent Publisher)", gets Microsoft's standard
   orange icon, and its files are submitted as a pull request to
   [microsoft/PowerPlatformConnectors](https://github.com/microsoft/PowerPlatformConnectors)
   `independent-publisher-connectors/`). For the independent route, set `iconBrandColor` to
   `#da3b01` and drop `icon.png`.
2. **Register the OAuth app on freero.app**, signed in as the account that will own it: *Settings →
   Your OAuth apps → Register app*, name `Power Automate`, **Confidential app** on. Keep the client
   secret (shown once).
3. **Generate the files with its id**:
   `npm run gen:power-automate -- --certified --client-id <the app's client id> --out-dir freero-connector`
   (`apiDefinition.swagger.json`, `apiProperties.json`, `intro.md`, `icon.png`).
4. **Create it as a custom connector in a solution** (`paconn create --api-def … --api-prop …
   --icon icon.png --secret <client secret>` with the
   [Power Platform connector CLI](https://learn.microsoft.com/connectors/custom-connectors/paconn-cli),
   or import in the maker portal), copy the **Redirect URL** it shows
   (`https://global.consent.azure-apim.net/redirect/…`) and add it to the Freero OAuth app's redirect
   URIs.
5. **Test**: every operation at least ten successful calls, the trigger turned on and off (its
   webhook appears and disappears in the admin console); then run the **Solution Checker** on the
   solution and fix what it reports.
6. **Package**: export the connector solution and a solution with a test flow, combine them with the
   Package Deployer, add `intro.md`, zip it, check it with Microsoft's `ConnectorPackageValidator.ps1`,
   upload it to an Azure storage blob with a SAS URL valid for at least 15 days.
7. **A test account for Microsoft's reviewers**: a Freero account on freero.app with a team workspace
   it owns (the trigger needs one) and a board with a few items. Give its sign-in in the submission.
8. **Submit**: Partner Center → Marketplace offers → **New offer → Power Platform connector**
   (verified), with the SAS URL, the OAuth client id and secret, and the test account; or the pull
   request (independent). Microsoft reviews, may ask for changes, then certifies and deploys it to
   all regions (several weeks).

**Updates**: a new version of the files goes through the same submission. Rotating the OAuth app's
secret needs an update submitted a month ahead.

## How it works

- `scripts/lib/swagger2.mjs` converts OpenAPI 3.1 to Swagger 2.0; `scripts/lib/powerAutomate.mjs`
  turns `POST /workspaces/{workspaceId}/webhooks` into the trigger (`x-ms-notification-url` on the
  hidden `url`, `x-ms-notification-content` describing the event) and builds the certified files from
  a curated list of operations with summaries and descriptions written to Microsoft's rules.
- The API's `201` for a new webhook carries `Location: <its address>`, which subscription-style
  triggers delete.
- Freero's OAuth server takes a confidential app's authorization request without PKCE (its
  generic OAuth can't send it); a challenge that is sent is always checked, and a code issued without
  one needs the client secret and refuses any verifier ([../api/README.md](../api/README.md)).

## Not done yet

- **Certification itself** (the owner's steps above), and a run against a real Power Platform
  environment: the files were checked against Microsoft's published rules and the trigger against
  Freero's own API, not by Microsoft's tools (`paconn validate`, the Solution Checker).

## Sources

- Create a custom connector from an OpenAPI definition (2.0 only, under 1 MB, API key security):
  https://learn.microsoft.com/en-us/connectors/custom-connectors/define-openapi-definition
- Webhook triggers (`x-ms-notification-url`, `Location`):
  https://learn.microsoft.com/en-us/connectors/custom-connectors/create-webhook-trigger
- Certification files and rules: https://learn.microsoft.com/en-us/connectors/custom-connectors/certification-submission
- Custom connector FAQ (OpenAPI 3.0 not supported, limits):
  https://learn.microsoft.com/en-us/connectors/custom-connectors/faq
- OpenAPI 2.0 specification: https://spec.openapis.org/oas/v2.0.html
