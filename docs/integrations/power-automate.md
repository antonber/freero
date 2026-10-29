# Power Automate (and Logic Apps): a Freero custom connector

Power Automate, Power Apps, Logic Apps and Copilot Studio call other services through **custom
connectors** made from an OpenAPI file. They accept only OpenAPI **2.0** (Swagger), under 1 MB.
Freero's REST API is described in OpenAPI 3.1 ([../api/openapi.json](../api/openapi.json)), so the
repository ships a converted copy:
[`power-automate/freero.swagger.json`](power-automate/freero.swagger.json). It has every `/api/v1`
operation (list boards, read the outline, add items, insert a structure, comment, search …), for the
example host `freero.example.com`.

## Make the file for your instance

```sh
npm run gen:power-automate -- --host boards.example.com --out freero-connector.json
```

Without arguments it rewrites the checked-in example, which a test keeps in step with
`openapi.json`. You can also import the example and change **Host** on the connector's *General*
page.

What the conversion changes: `requestBody` becomes a `body` parameter, nullable fields are marked
`x-nullable`, and where the API accepts one of several shapes (adding one item or `{ items: […] }`)
the connector offers the first. The REST reference has the rest.

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
   `comments:write` …). Each call acts as you, with your access, and is in the audit log under the
   token's name.

Freero's OAuth apps (*Settings → Your OAuth apps*) work too, but each connector then needs its own
app registration with the connector's redirect URL, and its security type changed to OAuth 2.0
(authorization code with PKCE). An API token is simpler for a team's own flows.

## Use it in a flow

- **Card from anything:** a trigger (a Forms response, a new list item, an email), then Freero's
  *insertStructure* action with board id and body
  `{ "structure": { "kind": "items", "items": [ { "type": "card", "text": "…", "description": "…" } ] } }`.
  Add `"placement": { "into": "<kanban id>", "column": "To do" }` to put it in a kanban column. Copy
  the kanban's id from **Copy link to item** in Freero: it is the `item=` part.
- **Meeting notes:** the same action with `{ "structure": { "kind": "meeting", "source": "<the notes>" } }`
  turns a summary or transcript (Markdown, text, WebVTT, SRT) into one frame. See
  [../board-outline.md](../board-outline.md).
- **React to what happens on a board:** the connector has no trigger. Use Power Automate's
  *When an HTTP request is received* trigger, and in Freero's admin console add a workspace webhook
  (format `json`) pointing at the URL it gives you. Check the `Freero-Signature` header as
  [../events.md](../events.md) describes, or keep the URL secret and scope the webhook to one board.
  To post the event straight to a Teams channel, Freero's `teams` format and a Teams *Workflows*
  webhook need no connector at all.

Board text in responses is untrusted (`notice` says so). Don't feed it to an AI step as instructions.

## Sources

- Create a custom connector from an OpenAPI definition (2.0 only, under 1 MB, API key security):
  https://learn.microsoft.com/en-us/connectors/custom-connectors/define-openapi-definition
- Custom connector FAQ (OpenAPI 3.0 not supported, limits):
  https://learn.microsoft.com/en-us/connectors/custom-connectors/faq
- OpenAPI 2.0 specification: https://spec.openapis.org/oas/v2.0.html
