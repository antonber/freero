# Make recipes

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

## Before you start

- **Token**: Freero → Settings → API tokens, permission `boards:write` only, named after the
  scenario (cards then read "<token name> for <you>").
- **Board id**: the id in the board's address, `/board/<id>`. **Kanban id** (optional): on the
  board, **Copy link to item** on the kanban; the id follows `?item=`.

## GitHub issue → card

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

## Board comment → Slack

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
