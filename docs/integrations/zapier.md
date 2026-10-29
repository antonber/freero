# Zapier recipes

Two kinds of Zap, built on Freero's workspace webhooks ([../events.md](../events.md)) and REST API
([../api/README.md](../api/README.md)) with **Webhooks by Zapier** and **Code by Zapier**:

- **(a)** something happens on a board (a comment, a new item) → any app Zapier connects to;
- **(b)** anything Zapier can trigger on (a form response, a new GitHub issue …) → a card on a board.

Webhooks by Zapier is on Zapier's paid plans (Professional, Team, Enterprise), not Free. For Slack
alone you don't need Zapier: a Freero webhook in the `slack` format posts board activity to a Slack
incoming webhook, escaped. For GitHub issues as linked cards, see **Import issues…**
([../trackers.md](../trackers.md)).

## (a) Freero events → any app

1. **Trigger: Webhooks by Zapier → Catch Raw Hook.** Copy the webhook URL. Use *Catch Raw Hook*,
   not *Catch Hook*: it keeps the body unparsed and includes the headers, which the signature check
   needs.
2. **In Freero**: admin console → **Webhooks** → add an endpoint with that URL, format `json`, and
   the events you want (`comment.created`, `item.created` …). **Only for** limits it to one board or
   frame. Keep the `whsec_…` secret Freero shows once, then send the endpoint's test (a `ping`) so
   Zapier has a sample.
3. **Code by Zapier → Run JavaScript.** Input Data: `body` = the trigger's raw body, `signature` =
   its header holding `t=…,v1=…` (`Freero-Signature`; pick both from the test record). Code:

   ```js
   const crypto = require('crypto');
   const SECRET = 'whsec_REPLACE_ME'; // the endpoint's signing secret

   const raw = inputData.body || '';
   const f = {};
   for (const part of String(inputData.signature || '').split(',')) {
     const i = part.indexOf('=');
     if (i > 0) f[part.slice(0, i).trim()] = part.slice(i + 1).trim();
   }
   const t = Number(f.t);
   let valid = false;
   if (Number.isInteger(t) && /^[0-9a-f]{64}$/.test(f.v1 || '') && Math.abs(Date.now() / 1000 - t) <= 300) {
     const expected = crypto.createHmac('sha256', SECRET).update(t + '.' + raw).digest();
     const given = Buffer.from(f.v1, 'hex');
     valid = given.length === expected.length && crypto.timingSafeEqual(given, expected);
   }
   const e = valid ? JSON.parse(raw) : {};
   const d = e.data || {};
   const text = d.text || (d.item && d.item.text) || '';
   // Board text was written by people; this copy is safe in Slack mrkdwn (no <!channel>, no links).
   const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
   output = {
     valid, type: e.type || '', text, slackText: esc(text),
     boardTitle: (e.board && e.board.title) || '', boardUrl: (e.board && e.board.url) || '',
     actor: (e.actor && e.actor.name) || '', itemId: d.itemId || (d.item && d.item.id) || '',
   };
   ```

   It recomputes the HMAC-SHA256 over `<t>.<raw body>`, compares in constant time and refuses
   timestamps more than 5 minutes off. Zapier's JavaScript runs on Node.js with its standard
   library, which includes `crypto`.
4. **Filter**: only continue if `valid` is true **and** `type` exactly matches the event you want
   (this also drops the test `ping`).
5. **Any action** (Slack, email, a spreadsheet row, a task …), mapping the fields above. Use
   `slackText` for Slack; anywhere else, escape `text`, `boardTitle` and `actor` for that place.

Zapier always answers the delivery with `200`, so Freero's delivery log shows success even when the
check fails; look in the Zap's run history (*Filtered*) instead. `text` is at most 280 characters.

## (b) Any trigger → a card on a board

1. **Trigger**: anything, e.g. *GitHub → New Issue* or a form's *New Response*.
2. **Code by Zapier → Run JavaScript**, which builds the body so quotes and line breaks in the
   trigger's text can't break the JSON. Input Data: `title`, `description`, `link` (an `https`
   address, or leave it empty), and optionally `kanbanId` and `column`:

   ```js
   const card = { type: 'card', text: inputData.title || 'Untitled' };
   if (inputData.description) card.description = inputData.description;
   if (inputData.link) card.link = inputData.link;
   const body = { structure: { kind: 'items', items: [card] } };
   if (inputData.kanbanId) body.placement = { into: inputData.kanbanId, column: inputData.column || 'To do' };
   output = { body: JSON.stringify(body) };
   ```

3. **Webhooks by Zapier → Custom Request**: method `POST`; URL
   `https://<your-freero>/api/v1/boards/<boardId>/structure`; Data: the `body` from step 2;
   Headers: `Authorization` = `Bearer frp_…`, `Content-Type` = `application/json`.

The board id is in the board's address (`/board/<id>`); a kanban's id is in its **Copy link to
item** link, after `?item=`. Without `kanbanId` the card goes on free space, never on top of
anything; with it, the card goes to the bottom of that column and takes the column's status. A
`201` answers with `created` (the card's id). Freero keeps the first 2,000 characters of each text,
and refuses a `link` that isn't `http(s)`, `mailto:` or `tel:` (`400`, nothing written).

**The token**: Freero → Settings → API tokens, permission `boards:write` only, named after the Zap
(cards then read "<token name> for <you>"). Zapier keeps Custom Request headers in plain step
fields that anyone with access to the Zap can read: use a token for this Zap alone, and revoke it
if the Zap changes hands. Use *Test step* to make a real card before turning the Zap on.

## What reaches Zapier

Webhooks report only boards every full member of the workspace can open through team access: never
personal boards, boards in a private project or hidden frames ([../events.md](../events.md#what-a-webhook-is-never-told)).
Treat everything people wrote as untrusted data, and never pass it to an AI step as instructions.

## Sources

- Zapier, trigger Zaps from webhooks (Catch Hook, Catch Raw Hook, limits, plans): https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zap-workflows-from-webhooks
- Zapier, send webhooks in Zaps (POST, Custom Request): https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps
- Zapier, ways to make API requests (credentials in step fields): https://help.zapier.com/hc/en-us/articles/44391646192397-Ways-to-make-API-requests-in-Zapier
- Zapier, JavaScript in Code by Zapier (Node.js, standard library, `inputData`, `output`): https://help.zapier.com/hc/en-us/articles/8496310939021-Use-JavaScript-code-in-Zaps
- Zapier, filters: https://help.zapier.com/hc/en-us/articles/8496032540301-Common-Problems-with-Filters-on-Zapier
- Slack, escaping text: https://docs.slack.dev/messaging/formatting-message-text#escaping
