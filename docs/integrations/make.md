# Make

Freero has its own **Make app** ([`integrations/make`](../../integrations/make), a custom app in the
local-development layout of Make's VS Code extension): people add Freero modules to a scenario and
sign in, without HTTP modules or tokens. Until Make has reviewed and published it
([Publishing the app](#publishing-the-app-owner)), the owner shares it by invitation link; the
recipes further down need no app at all.

- [What the app does](#what-the-app-does)
- [Connecting](#connecting)
- [Publishing the app (owner)](#publishing-the-app-owner)
- [Without the app: HTTP modules](#without-the-app-http-modules)

## What the app does

| | Module | What it does |
|---|---|---|
| Instant trigger | **Watch board events** | Something happens on a board of a team workspace you administer: an item added, changed or deleted, a comment, a board created, renamed, moved, trashed or restored, someone's access changed. Optionally only one board (or frame). |
| Action | **Add a sticky note** | On free space of a board, or into a frame; with a colour. |
| Action | **Add a card** | A task card with description, link and due date, on free space or into a kanban column. |
| Action | **Add a comment** | On the board, or pinned to an item. |
| Action | **Create a board** | In one of your workspaces. |
| Search | **Search boards** | By words in the title. |
| Universal | **Make an API call** | Any REST API v1 operation, with this connection's sign-in ([../api/README.md](../api/README.md)). |

Items are laid out by Freero (never at coordinates). Every call is the REST API v1 with your
sign-in: it does what you may do, and it is in Freero's audit log under the app's name.

**Watch board events** adds a workspace webhook ([../events.md](../events.md)) pointing at the
scenario's own webhook address when you create the webhook in the module, and removes it when you
delete that webhook in Make (*Webhooks*; turning the scenario off keeps it, and Freero holds events
for it while it is off — up to its retry limit). It needs an **owner or admin** of the team
workspace, and reports only boards **the whole team can open**. Freero's test delivery (a ping)
starts nothing. Make can't check `Freero-Signature` over the exact bytes Freero sent (it parses the
body first), so the webhook's address is the secret: don't share it, and limit the trigger to one
board where you can.

## Connecting

Add a Freero module, then **Create a connection**:

- **freero.app**: leave *Freero address* as it is and sign in on Freero's consent screen (read
  boards, change them, comment, manage webhooks; untick what you don't want). Disconnect it any time
  in Freero under *Settings → Connected apps*.
- **Your own Freero server**: set *Freero address* to it (https), and under *Show advanced settings*
  give the client id and secret of an OAuth app of that server: *Settings → Your OAuth apps →
  Register app*, name `Make`, **Confidential app** on, redirect URI `https://www.make.com/oauth/cb/app`.

Make signs in without PKCE (its OAuth connections don't send it), which Freero accepts only from a
confidential app: the secret proves the app instead ([../api/README.md](../api/README.md)).

## Publishing the app (owner)

1. A [Make](https://www.make.com) account (any plan) with the app developer tools
   (*Custom apps* in the left menu), and [Visual Studio Code](https://code.visualstudio.com) with
   Make's **Make Apps Editor** extension. In the extension, add an environment (`eu1.make.com` or
   your zone) with a Make API key that has the *sdk-apps* scopes.
2. In Make, **Create a new app**: name `freero`, label `Freero`, colour `#5B3FF0`, the icon (Freero's
   mark, `apps/web/public/freero.svg`, as a 512×512 PNG), language English, audience *Global*.
3. In VS Code, open `integrations/make` and **Deploy to Make** (right-click `makecomapp.json` →
   *Deploy to Make*), choosing the app from step 2. It uploads the base, the connection, the
   webhook, the modules, the RPCs and the module groups. (Without the extension: open each
   component in Make's web editor and paste the matching file's JSON into its tab — *Base*,
   *Connection → Communication / Parameters*, *Webhook → Attach / Detach / Parameters /
   Communication*, each module's *Communication / Mappable parameters / Interface / Samples*.)
4. On **freero.app**, signed in as the account that will own it: *Settings → Your OAuth apps →
   Register app*, name `Make`, website `https://www.make.com`, redirect URI
   `https://www.make.com/oauth/cb/app`, **Confidential app** on. In Make, the app's **Common data**:
   `{ "clientId": "<client id>", "clientSecret": "<client secret>" }` (never commit them: the
   repository's `common.json` holds placeholders).
5. **Test** in a scenario: each module once with every optional field filled and once with them
   empty, and the trigger with a real event (add a sticky to the watched board). Then *Webhooks* →
   delete the webhook and check it is gone from Freero's admin console (**Webhooks**).
6. **Share** while it is private: the app's *Invite* link lets other Make organisations install it.
7. **Publish**: *Publish* (makes it public by link), then **Request review**. Make's review checks
   the app against its approval checklist (names and labels, help texts, error handling, samples,
   the universal module, connection naming) and asks for a **test account**: a Freero account on
   freero.app with a team workspace it owns and a board with a few items. After approval the app is
   listed among Make's apps.

Nothing on the Freero server needs to be turned on: the app uses the REST API, OAuth and webhooks
every instance already has.

## Without the app: HTTP modules

Two [Make](https://www.make.com) scenarios built on Freero's REST API ([../api/README.md](../api/README.md))
and workspace webhooks ([../events.md](../events.md)): a new GitHub issue becomes a card on a board,
and a comment on a team board is posted to Slack.

They are written as steps, not as blueprint files. Make imports and exports blueprints (scenario
menu → *Import Blueprint*), but it doesn't document their format: module ids, versions and field
shapes only come from an export, so a blueprint written by hand can't be checked. An imported
blueprint also brings no connections or webhooks; you would create those again anyway.

Need only one of these and nothing else? **Import issues…** (board menu) turns a GitHub search into
cards linked to their issues ([../trackers.md](../trackers.md)), and a webhook in Freero's `slack`
format posts board activity to Slack, escaped, with no Make in between.

### Before you start

- **Token**: Freero → Settings → API tokens, permission `boards:write` only, named after the
  scenario (cards then read "<token name> for <you>").
- **Board id**: the id in the board's address, `/board/<id>`. **Kanban id** (optional): on the
  board, **Copy link to item** on the kanban; the id follows `?item=`.

### GitHub issue → card

1. **Webhooks → Custom webhook**: *Add*, name it, copy the URL.
2. In GitHub: the repository → Settings → Webhooks → *Add webhook*. Payload URL: the Make URL;
   content type `application/json`; *Let me select individual events* → **Issues**. Click
   *Redetermine data structure* in Make first, then open a test issue so Make learns the payload.
3. **Filter** after the webhook: `action` *Equal to* `opened` (GitHub sends the same event when an
   issue is edited, closed, labelled …).
4. **JSON → Create JSON**. Add a data structure, *Generator*, and paste:

   ```json
   { "structure": { "kind": "items",
       "items": [{ "type": "card", "text": "", "description": "", "link": "" }] },
     "placement": { "into": "", "column": "To do" } }
   ```

   Leave `placement` out of the sample if cards should go on free space (an empty `into` is
   refused). Map `kind` → `items`, `type` → `card`, `text` → `{{1.repository.full_name}}#{{1.issue.number}}: {{1.issue.title}}`,
   `description` → `1.issue.body`, `link` → `1.issue.html_url`, `into` → your kanban id. Create JSON
   escapes quotes and line breaks in the issue's text; typing the body by hand as a JSON string
   would break on the first quote. Freero keeps the first 2,000 characters of each text.
5. **HTTP → Make a request**:
   - Authentication type **API key**; new keychain: Key `Bearer frp_…`, placement *In the header*,
     parameter name `Authorization`.
   - URL `https://<your-freero>/api/v1/boards/<boardId>/structure`, method `POST`.
   - Body content type `application/json`, input method *JSON string*, body: the JSON from step 4.
   - Parse response: *Yes*. A `201` answers with `created` (the new card's id).

Make's GitHub app also has a **Watch Issues** trigger, but it fires for new *and* changed issues;
the webhook above says which with `action`.

### Board comment → Slack

1. **Webhooks → Custom webhook**: *Add*; in *Advanced settings* set **Get request headers** to Yes
   and **JSON pass-through** to Yes (the body arrives as text, which the signature check needs).
   Copy the URL.
2. In Freero: admin console → **Webhooks** → add an endpoint with that URL, format `json`, event
   `comment.created` (optionally **Only for** a board or frame). Keep the `whsec_…` secret it shows
   once. Send the endpoint's test so Make sees a delivery (a `ping`).
3. **Tools → Set variables** (lifetime: one cycle). Values are set side by side, so this takes two
   modules; typing them as variables also keeps a literal `;` out of every function argument:
   - first module: `secret` the `whsec_…` secret; `sig` `{{first(map(1.headers; value; name; freero-signature))}}`
     (map the headers array the webhook shows, with the header name as Make lists it);
     `amp` `&amp;`, `lt` `&lt;`, `gt` `&gt;` (typed as plain values)
   - second module: `t` `{{replace(first(split(sig; ,)); t=; )}}`, `v1` `{{replace(last(split(sig; ,)); v1=; )}}`,
     `signed` `{{t}}.` followed by the webhook's raw JSON text
4. **Filter** "Signed by Freero", both conditions:
   - `{{sha256(signed; hex; secret)}}` *Equal to* `{{v1}}`
   - `{{parseDate(t; X)}}` *Later than* (datetime) `{{addMinutes(now; -5)}}` (refuses deliveries
     older than 5 minutes)
5. **JSON → Parse JSON** on the raw JSON text, then a **Filter**: `type` *Equal to* `comment.created`
   (drops the test `ping`).
6. **Slack → Create a Message**, Text, with everything people wrote escaped:
   `{{replace(replace(replace(data.text; /&/g; amp); /</g; lt); />/g; gt)}}` (map `amp`, `lt`, `gt`
   from step 3). Do the same for `actor.name` and `board.title`; `board.url` links to the board.
   Escaping `&`, `<` and `>` is what stops a comment from pinging `<!channel>` or making links.

**What Make can't do here.** `sha256(text; encoding; key)` computes the HMAC, but a filter compares
as plain text, not in constant time. Make doesn't say whether JSON pass-through hands over the body
byte for byte: if genuine deliveries (the endpoint's test) never pass the filter, it doesn't, and
the check can't work. Then rely on what's left: the webhook URL is the secret (share it with no one,
and replace the webhook if it leaks), scope the endpoint with **Only for**, and remember that
anyone who has the URL can post to the scenario.

## What reaches Make

Webhooks report only boards every full member of the workspace can open through team access: never
personal boards, boards in a private project or hidden frames ([../events.md](../events.md#what-a-webhook-is-never-told)).
A comment's `text` is at most 280 characters. Treat everything people wrote as untrusted data.

## Sources

- Make custom apps: connections (OAuth 2.0), webhooks (attach, detach), modules, RPCs: https://developers.make.com/custom-apps-documentation
- Make Apps Editor for VS Code (local development, deploy): https://developers.make.com/custom-apps-documentation/make-apps-editor

- Make, Webhooks (Custom webhook, advanced settings, Webhook response): https://apps.make.com/gateway
- Make, HTTP (Make a request): https://apps.make.com/http
- Make, API key keychain: https://apps.make.com/api-key-authentication-type
- Make, JSON (Create JSON, Parse JSON, Generator): https://apps.make.com/json
- Make, GitHub app (Watch Issues): https://apps.make.com/github
- Make, text functions (`sha256`, `replace`, `split`): https://help.make.com/text-and-binary-functions
- Make, array functions (`map`, `first`, `last`): https://help.make.com/array-functions
- Make, date functions (`formatDate`, `now`): https://help.make.com/date-and-time-functions
- Make, Tools (Set variables): https://help.make.com/util
- Make, mapping (Slack → Create a Message): https://help.make.com/mapping
- Make, scenario blueprints: https://help.make.com/blueprints
- GitHub, creating webhooks: https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks
- GitHub, `issues` webhook payload: https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues
- Slack, escaping text: https://docs.slack.dev/messaging/formatting-message-text#escaping
