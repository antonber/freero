# Zapier

Freero has its own **Zapier app** ([`integrations/zapier`](../../integrations/zapier), a Zapier
Platform CLI project): people pick Freero in the Zap editor and sign in, with no webhooks or tokens
to copy. Until the owner has published it ([Publishing the app](#publishing-the-app-owner)), it
works for the people the owner invites; the recipes further down need no app at all.

- [What the app does](#what-the-app-does)
- [Connecting](#connecting)
- [Publishing the app (owner)](#publishing-the-app-owner)
- [Without the app: Webhooks by Zapier](#without-the-app-webhooks-by-zapier)

## What the app does

| | Name | What it does |
|---|---|---|
| Trigger (instant) | **Board Event** | Something happens on a board of a team workspace you administer: an item added, changed or deleted, a comment, a board created, renamed, moved, trashed or restored, someone's access changed. Optionally only one board (or frame). |
| Trigger | **New Item** | A sticky note, card or other item is added to a board (checked every few minutes; anyone who can open the board). |
| Trigger | **New Comment** | Someone comments on a board or replies in a thread (same). |
| Action | **Add Sticky Note** | On free space of a board, or into a frame; with a colour. |
| Action | **Add Card** | A task card with description, link and due date, on free space or into a kanban column. |
| Action | **Add Comment** | On the board, or pinned to an item. |
| Action | **Create Board** | In one of your workspaces. |
| Search | **Find Board** | By words in its title. |

Items are laid out by Freero (never at coordinates), through the REST API's structure operation
([../board-outline.md](../board-outline.md)). Every call is the REST API v1 with your sign-in: it
does what you may do on the board, nothing more, and it is in Freero's audit log under the app's
name ("Zapier for <you>").

**Board Event** adds a workspace webhook ([../events.md](../events.md)) when the Zap is turned on and
removes it when the Zap is turned off; each delivery is checked against that webhook's signing
secret (HMAC-SHA256, at most five minutes old) before the Zap runs, so a forged or replayed request
does nothing. It needs an **owner or admin** of the team workspace, and, like every webhook, reports
only boards **the whole team can open**: never personal boards or private projects. A workspace has
at most 20 webhooks; each Zap with the trigger uses one. Anyone else uses the polling triggers.

## Connecting

In the Zap editor, choose Freero and **Sign in**:

- **freero.app**: leave *Freero address* as it is. Freero's consent screen shows what the Zap may do
  (read boards, change them, comment, manage webhooks); untick what you don't want. You can disconnect
  it any time in Freero under *Settings → Connected apps*.
- **Your own Freero server**: set *Freero address* to it (https). On that server, *Settings → Your
  OAuth apps → Register app*: name `Zapier`, **Confidential app** on, redirect URI
  `https://zapier.com/dashboard/auth/oauth/return/<APP ID>CLIAPI/` (the owner fills in `<APP ID>`
  here once the app is registered: [step 3](#publishing-the-app-owner)), and give its client id and
  secret in the connection.

## Publishing the app (owner)

The app is code in this repository (MIT). Zapier runs it on its platform; the packages it runs on
(`zapier-platform-core`, and the `zapier` command from `zapier-platform-cli`) are Zapier's, under the
[Zapier Platform Agreement](https://zapier.com/platform/tos): they are installed only in
`integrations/zapier` by whoever pushes the app, never as Freero's dependencies.

1. A [Zapier developer account](https://developer.zapier.com), then on your computer:

   ```sh
   npm install -g zapier-platform-cli
   cd integrations/zapier
   npm install
   zapier login
   zapier register "Freero"        # once: creates the integration and .zapierapprc (don't commit it)
   ```

2. `zapier describe` shows the **redirect URI** (`https://zapier.com/dashboard/auth/oauth/return/App…CLIAPI/`).
3. On **freero.app**, signed in as the account that will own it: *Settings → Your OAuth apps →
   Register app*, name `Zapier`, website `https://zapier.com`, that redirect URI, **Confidential app**
   on. Keep the secret (shown once). Put the redirect URI into [Connecting](#connecting) above.
4. Give Zapier the app's credentials and push:

   ```sh
   zapier env:set 1.0.0 CLIENT_ID=<client id> CLIENT_SECRET=<client secret>
   zapier validate
   zapier push
   ```

5. In the [developer platform](https://developer.zapier.com): the app's **name**, **logo** (Freero's
   mark, `apps/web/public/freero.svg`, exported as a 256×256 PNG), category *Project Management*,
   the **intended audience** *public*, and a **description**.
6. **Test** every trigger, action and search in real Zaps (at least one live Zap per trigger and
   action is what Zapier's review asks for), and **invite** a few testers (*Manage team → Invite*).
   Updates: bump `version` in `package.json`, `zapier push`, then `zapier promote <version>`
   (`zapier migrate` moves existing Zaps).
7. **Publish**: *Publishing → Publish*. Zapier's partner review needs: the app in production on a
   public website (freero.app), a **test account** for Zapier's reviewers (a Freero account with a
   team workspace it owns, so Board Event can be tried, and a board with a few items), privacy policy
   and terms (`/privacy`, `/terms`), a support contact (support@freero.app), and a set number of
   active users of the invite-only app before it goes public (Zapier's current threshold is in its
   publishing requirements). After the review it is listed in Zapier's app directory.

Nothing on the Freero server needs to be turned on: the app uses the REST API, OAuth and webhooks
every instance already has.

## Without the app: Webhooks by Zapier

Two kinds of Zap, built on Freero's workspace webhooks ([../events.md](../events.md)) and REST API
([../api/README.md](../api/README.md)) with **Webhooks by Zapier** and **Code by Zapier**:

- **(a)** something happens on a board (a comment, a new item) → any app Zapier connects to;
- **(b)** anything Zapier can trigger on (a form response, a new GitHub issue …) → a card on a board.

Webhooks by Zapier is on Zapier's paid plans (Professional, Team, Enterprise), not Free. For Slack
alone you don't need Zapier: a Freero webhook in the `slack` format posts board activity to a Slack
incoming webhook, escaped. For GitHub issues as linked cards, see **Import issues…**
([../trackers.md](../trackers.md)).

### (a) Freero events → any app

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

### (b) Any trigger → a card on a board

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

- Zapier Platform CLI (authentication, OAuth 2 with PKCE, REST hook triggers, `bundle.rawRequest`): https://docs.zapier.com/platform/build-cli/overview
- Zapier, publishing requirements and partner review: https://docs.zapier.com/platform/publish/integration-publishing-requirements

- Zapier, trigger Zaps from webhooks (Catch Hook, Catch Raw Hook, limits, plans): https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zap-workflows-from-webhooks
- Zapier, send webhooks in Zaps (POST, Custom Request): https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps
- Zapier, ways to make API requests (credentials in step fields): https://help.zapier.com/hc/en-us/articles/44391646192397-Ways-to-make-API-requests-in-Zapier
- Zapier, JavaScript in Code by Zapier (Node.js, standard library, `inputData`, `output`): https://help.zapier.com/hc/en-us/articles/8496310939021-Use-JavaScript-code-in-Zaps
- Zapier, filters: https://help.zapier.com/hc/en-us/articles/8496032540301-Common-Problems-with-Filters-on-Zapier
- Slack, escaping text: https://docs.slack.dev/messaging/formatting-message-text#escaping
