# Slack: link previews, direct messages and /freero

Freero's Slack app does two things, each **off by default**. You, the operator, create one Slack app
for your instance and give Freero its secrets. It needs no listing in the Slack Marketplace and no
approval from Slack.

1. **Link previews** (#88). A Freero board link posted in Slack gets a preview. Needs
   `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN`.
2. **Connect Slack** (#105). Each person links their own Slack account in their settings. They then
   get their notifications as direct messages from the app, links they post to boards they can open
   show the board even when it is private, and `/freero` creates or finds their boards. Also needs
   `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

(For messages *about* boards in a channel, such as "Maria commented on Roadmap", use a workspace
webhook with the `slack` format instead. See [events.md](../events.md).)

## What a preview shows

| The link is to… | Preview |
|---|---|
| a board **anyone with the link can view without an account** (link sharing on, guests allowed by its workspace, no link password, not expired, not blocked by an operator) | its title, its description (up to 300 characters), its thumbnail (when the board has one and your `PUBLIC_URL` is `https`), and "Freero board · anyone with the link can view" |
| a board or doc that **the person who posted the link can open**, when they connected their Slack account | its title, a board's description and thumbnail, and "Freero board · only people with access can open it". They chose to share the link, so the channel sees what it is. Opening it still takes access. |
| anything else: a private board posted by someone who didn't connect Slack or can't open it, a board that is shared only with accounts or protected by a password, a doc, a link to something that doesn't exist | the same card every time, **"Freero board — Sign in to Freero to view it."**, with no title |

So a preview never says what a private board is called, or whether it exists, unless someone who
can open it posted it. The thumbnail is the board's own preview picture (the one the dashboard
shows), which Freero serves without a session under an unguessable name. Only links to your
instance's host are answered. Other links are left to Slack.

## Set it up

1. **Create the app.** Print a manifest for your instance:

   ```sh
   npm run admin -- slack:manifest            # uses PUBLIC_URL
   npm run admin -- slack:manifest --url https://boards.example.com
   ```

   [`deploy/slack-app-manifest.json`](../../deploy/slack-app-manifest.json) is the same manifest for
   `freero.example.com`. You can edit the host names by hand instead. Go to
   <https://api.slack.com/apps>, choose **Create New App**, then **From a manifest**, pick the
   workspace and paste the manifest. It has everything both parts need (the
   [list below](#update-an-app-you-made-for-link-previews) says what each piece is for).

2. **Give Freero the secrets** and restart it:

   | Variable | Where it is in the Slack app | Turns on |
   |---|---|---|
   | `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret | link previews (with the next one) |
   | `SLACK_BOT_TOKEN` | OAuth & Permissions → Bot User OAuth Token (`xoxb-…`), after **Install to Workspace** | link previews (with the one above) |
   | `SLACK_CLIENT_ID` | Basic Information → App Credentials → Client ID | Connect Slack (with the next one) |
   | `SLACK_CLIENT_SECRET` | Basic Information → App Credentials → Client Secret | Connect Slack (with the one above) |

   Freero refuses to start if only one of a pair is set, or if the client pair is set without the
   first pair. Without the first pair, `/api/integrations/slack/events` and `/commands` don't exist
   (404). Without the client pair, nobody sees "Connect Slack" and `/freero` answers that it isn't
   turned on.

3. **Verify the request URL.** In the app's **Event Subscriptions**, Slack sends a `url_verification`
   challenge, and Freero answers it once the request's signature checks out. Then **Install to
   Workspace**. If you change the unfurl domain or the scopes later, reinstall the app.

4. Post a link to a public board in a channel. The preview appears under the message (and already in
   the message box while you type, for workspaces that show composer previews). Then, in Freero,
   open **Settings → Slack → Connect Slack**.

Freero must be reachable from the internet at `PUBLIC_URL` over `https`: Slack posts events and
commands to it, sends people back to it after they allow the app, and fetches thumbnails from it.

### Update an app you made for link previews

An app created from the manifest of #88 (link previews only) needs these changes for Connect Slack.
The quickest way is **App Manifest** in the app's settings: paste the new output of
`npm run admin -- slack:manifest` and save. By hand, in <https://api.slack.com/apps> → your app
(replace `boards.example.com` with your host):

| Where | Add | What it is for |
|---|---|---|
| **OAuth & Permissions → Redirect URLs** | `https://boards.example.com/api/integrations/slack/oauth/callback` | where Slack sends people back after they allow the app; Freero refuses any other |
| **OAuth & Permissions → Scopes → Bot Token Scopes** | `chat:write`, `im:write`, `commands`, `users:read` (keep `links:read` and `links:write`) | writing direct messages; opening the app's direct message with a person; `/freero`; showing their Slack name in their settings |
| **Slash Commands → Create New Command** | Command `/freero`, Request URL `https://boards.example.com/api/integrations/slack/commands`, short description "Create a Freero board, or find one", usage hint `new <title> · <words to search>`, **Escape channels, users, and links** off | `/freero` |
| **Event Subscriptions → Subscribe to bot events** | `app_uninstalled`, `tokens_revoked` (keep `link_shared`) | Freero forgets a workspace's links and token when the app is removed from it |
| **App Home → Show Tabs** | **Messages Tab** on, and **Allow users to send Slash commands and messages from the messages tab** off | people see the app's direct messages; Freero doesn't read replies |
| **Manage Distribution** (only if people from *other* Slack workspaces should connect) | **Activate Public Distribution** — not a Marketplace listing, no review by Slack | without it, only the workspace the app was created in can connect |
| **Basic Information → App Credentials** | copy **Client ID** and **Client Secret** into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` | turns Connect Slack on |

Then **reinstall** the app in every workspace that uses it (Slack asks again because the scopes
changed) and restart Freero. No user token scopes are needed, and neither is `users:read.email`:
Freero never matches Slack people to accounts by address, only by the person's own consent.

## Connect Slack: direct messages, private previews and /freero

**Connecting.** In **Settings → Slack**, a person chooses **Connect Slack**, picks their Slack
workspace and allows the app. Slack sends them back to Freero, which stores their Slack user id in
that workspace with their Freero account. One Slack account per Freero account and the other way
round: connecting the same Slack account from another Freero account moves it there. If the app
wasn't installed in that workspace yet, allowing it installs it (when the workspace lets members
install apps).

**Notifications.** Under **Notification emails and Slack**, each kind of notification gets an
**Email** and a **Slack** switch. Slack is on by default for mentions, replies, access requests and
answers to them, boards and workspaces shared with you, cards assigned to you, due-date changes and
reminders, blocked agents and mentions in walkthroughs; off for comments on and reactions to your
walkthroughs and fixed problem reports. A notification turned on for Slack is sent as a direct
message at once and is **left out of the email digest**: each notification arrives once, by Slack
or by email, never both (and by email when its team workspace keeps the app out, see
[Team workspace policies](#connect-slack-direct-messages-private-previews-and-freero)). A comment that both mentions you and replies in your thread is one
notification, so one message. If Slack refuses the message (the app was removed, Slack is down),
the notification goes into the next email digest instead. Moderation notices are always emailed,
never sent to Slack. The bell in Freero shows everything, as before.

A message holds what the notification already holds — its headline, the comment excerpt, a link —
and nothing is stored for it beyond the notification itself.

**Previews.** A board link posted by someone who connected Slack shows the board when they can open
it (see the table above).

**`/freero`.** Answered only to the person who typed it (others in the channel see nothing):

- `/freero new Sprint review` creates a board called "Sprint review" in their personal workspace and
  answers with its link;
- `/freero roadmap` lists their boards whose title has "roadmap" (every workspace they are in, the
  ten most recently changed);
- `/freero` or `/freero help` shows these two.

A Slack user who didn't connect gets a pointer to the settings page and nothing about any board.

**Team workspace policies.** For a team workspace, the Slack app is treated like an app the
person connected. Its admin console's API page lists it under **Tokens and apps used here** as
"Slack (Freero’s Slack app)", once per person who used it there, and:

- with **Allow API access to this workspace’s boards** off for the workspace (or for its organisation), `/freero` never lists its
  boards and a link to one of them gets the generic card, whoever posts it;
- **Block here** on the app for a person does the same for that person;
- with an **IP allowlist**, its boards are left out too, because the requests come from Slack's
  servers, not from the person's network, so the allowlist can't tell where they are. Ticking
  **Any network** on the app for a person there (as for any token or app) lets it in for them.

`/freero new` only creates boards in the person's personal workspace, which has no such policies.
A notification about a board, doc or workspace of a team that keeps the app out this way is not
sent to Slack: it goes into the email digest instead, as if Slack were off for it. There is no workspace allow-list of OAuth apps yet (#23); when there is, it
applies here too (`apiauth` `integrationMayReach`).

**Disconnecting.** **Disconnect Slack** in Settings removes the link at once: no more messages,
previews of private boards or commands for that person. Freero holds no token of the person's — the
app's bot writes to them — so there is none of theirs to revoke. When nobody in that Slack workspace
is connected any more, Freero deletes the app's token there and revokes it with Slack
(`auth.revoke`), unless it is `SLACK_BOT_TOKEN`, your own, which only you manage. Deleting a Freero
account disconnects it too. Removing the app from a Slack workspace (Slack sends `app_uninstalled`
or `tokens_revoked`) disconnects everyone there.

## How Freero handles a request

- **Signature.** Every request from Slack, events and slash commands alike, must carry Slack's v0
  signature. Freero computes the HMAC-SHA256 of `v0:<X-Slack-Request-Timestamp>:<raw body>` with
  the signing secret, compares it with `X-Slack-Signature` in constant time, and refuses (401)
  requests without a signature, with a wrong one, with a body changed after signing, or with a
  timestamp more than five minutes from its clock (a replay). The URL verification challenge gets
  the same check. A slash command is a form post; the signature covers its exact bytes, so nobody
  can send a command as someone else's Slack user.
- **Connect Slack.** The consent starts from Freero, signed in. Its `state` is random, single use,
  valid for ten minutes, stored only as a hash, and bound to the account that started it and to an
  HttpOnly cookie in that browser. A callback opened in another browser, by another account, a
  second time or late is refused (400) before Slack's code is redeemed, so a link someone else
  started can't connect their Slack account to yours. The code is redeemed with the client secret
  (`oauth.v2.access`); Freero links the Slack workspace and user Slack's own answer names, and
  refuses an app that wasn't given `chat:write` and `im:write` yet (an app not updated).
- **Answering.** A `link_shared` event is acknowledged at once (Slack wants an answer within three
  seconds). Freero then calls `chat.unfurl` with the message's `channel` and `ts` and one preview per
  Freero link, at most ten per message, with the app's token in that Slack workspace. An event Slack
  sends again (a retry) is answered once. A slash command is answered in its response.
- **Limits.** At most `RATE_LIMIT_SLACK_UNFURL` (default `50/1m`) `chat.unfurl` calls per Slack
  workspace, which is Slack's own tier for that method. Links past the limit stay without a preview.
  `/freero new` counts against the person's `RATE_LIMIT_BOARD_CREATE`, a search against their
  `RATE_LIMIT_SEARCH`.
- **Escaping.** Board titles, comment excerpts and other text people wrote are escaped for Slack
  (`&`, `<`, `>`), so they can't make links or ping `@channel` in a preview, a message or an answer.
- **Logs.** Each event is one log line, `"slack": { "event": "link_shared", "team", "eventId",
  "links", "outcome" }`, where `outcome` is one of `unfurled`, `no_links`, `duplicate`,
  `rate_limited`, `slack_error` (with Slack's `error`, such as `cannot_unfurl_url`) or `failed`.
  Refused requests are logged as `"slack": { "refused": "unsigned" | "mismatch" | "stale" |
  "oauth_state" }`. Metrics: `freero_slack_unfurls_total{outcome}`, `freero_slack_dms_total{outcome}`,
  `freero_slack_commands_total{outcome}` and `freero_notifications_slack_total{outcome}` (sent,
  failed — left to the email —, skipped).

## What is stored

| Table | What |
|---|---|
| `slack_user_links` | per connected person: the Slack workspace id and name, their Slack user id and name, the app's direct-message channel with them, when they connected |
| `slack_teams` | per Slack workspace someone connected from: the app's bot token there, sealed with `SESSION_SECRET` (see [operations.md](../operations.md), "Rotating SESSION_SECRET") |
| `slack_oauth_flows` | consents in progress, ten minutes at most: a hash of the state, the account, a hash of the browser cookie |
| `notification_prefs.slack` | each person's Slack switch per kind of notification, when they changed it |
| `notifications.slacked_at` | when a notification was sent to Slack (so the digest leaves it out) |

The personal data export has `slack.json` (the link, never a token) and the Slack switches in
`notifications.json`.

## Turning it off

Remove `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` and restart: Connect Slack disappears from
settings, no more direct messages are sent (notifications are emailed again), previews go back to
public boards only, and `/freero` answers that it isn't turned on. The links stay stored, so setting
the two back brings everyone's connection back. Remove `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN`
too to stop the app altogether. To stop it on Slack's side, uninstall the app from the workspace.

## Sources

- Events API: https://docs.slack.dev/apis/events-api/
- `url_verification`: https://docs.slack.dev/reference/events/url_verification
- Verifying requests from Slack: https://docs.slack.dev/authentication/verifying-requests-from-slack
- `link_shared`: https://docs.slack.dev/reference/events/link_shared
- `chat.unfurl`: https://docs.slack.dev/reference/methods/chat.unfurl
- Unfurling links in messages: https://docs.slack.dev/messaging/unfurling-links-in-messages
- Installing with OAuth: https://docs.slack.dev/authentication/installing-with-oauth
- `oauth.v2.access`: https://docs.slack.dev/reference/methods/oauth.v2.access
- `conversations.open`: https://docs.slack.dev/reference/methods/conversations.open
- `chat.postMessage`: https://docs.slack.dev/reference/methods/chat.postMessage
- `auth.revoke`: https://docs.slack.dev/reference/methods/auth.revoke
- Slash commands: https://docs.slack.dev/interactivity/implementing-slash-commands
- `app_uninstalled`: https://docs.slack.dev/reference/events/app_uninstalled
- `tokens_revoked`: https://docs.slack.dev/reference/events/tokens_revoked
- App manifests: https://docs.slack.dev/reference/app-manifest
