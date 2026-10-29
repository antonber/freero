# Slack link unfurls

When someone posts a Freero board link in Slack, Freero can answer with a preview. It's **off by
default**: you, the operator, create a Slack app for your instance and give Freero its two secrets.
It needs no listing in the Slack Marketplace and no approval from Slack.

(For messages *about* boards, such as "Maria commented on Roadmap", use a workspace webhook with the
`slack` format instead. See [events.md](../events.md).)

## What a preview shows

| The link is to… | Preview |
|---|---|
| a board **anyone with the link can view without an account** (link sharing on, guests allowed by its workspace, no link password, not expired, not blocked by an operator) | its title, its description (up to 300 characters), its thumbnail (when the board has one and your `PUBLIC_URL` is `https`), and "Freero board · anyone with the link can view" |
| anything else: a private board, a board that is shared only with accounts or protected by a password, a doc, a link to something that doesn't exist | the same card every time, **"Freero board — Sign in to Freero to view it."**, with no title |

So a preview never says what a private board is called, or whether it exists. The thumbnail is the
board's own preview picture (the one the dashboard shows), which Freero serves without a session
under an unguessable name. Only links to your instance's host are answered. Other links are left
to Slack.

## Set it up

1. **Create the app.** Print a manifest for your instance:

   ```sh
   npm run admin -- slack:manifest            # uses PUBLIC_URL
   npm run admin -- slack:manifest --url https://boards.example.com
   ```

   [`deploy/slack-app-manifest.json`](../../deploy/slack-app-manifest.json) is the same manifest for
   `freero.example.com`. You can edit the two host names by hand instead. Go to
   <https://api.slack.com/apps>, choose **Create New App**, then **From a manifest**, pick the
   workspace and paste the manifest. It asks for:
   - the bot scopes `links:read` and `links:write`;
   - the `link_shared` bot event, sent to `https://<your host>/api/integrations/slack/events`;
   - your host as the app's only unfurl domain.

2. **Give Freero the secrets** and restart it:

   | Variable | Where it is in the Slack app |
   |---|---|
   | `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret |
   | `SLACK_BOT_TOKEN` | OAuth & Permissions → Bot User OAuth Token (`xoxb-…`), after **Install to Workspace** |

   Freero refuses to start if only one of the two is set. Without them,
   `/api/integrations/slack/events` doesn't exist (404).

3. **Verify the request URL.** In the app's **Event Subscriptions**, Slack sends a `url_verification`
   challenge, and Freero answers it once the request's signature checks out. Then **Install to
   Workspace**. If you change the unfurl domain later, reinstall the app.

4. Post a link to a public board in a channel. The preview appears under the message (and already in
   the message box while you type, for workspaces that show composer previews).

Freero must be reachable from the internet at `PUBLIC_URL` over `https`: Slack posts events to it and
fetches thumbnails from it.

## How Freero handles a request

- **Signature.** Every request must carry Slack's v0 signature. Freero computes the HMAC-SHA256 of
  `v0:<X-Slack-Request-Timestamp>:<raw body>` with the signing secret, compares it with
  `X-Slack-Signature` in constant time, and refuses (401) requests without a signature, with a wrong
  one, or with a timestamp more than five minutes from its clock (a replay). The URL verification
  challenge gets the same check.
- **Answering.** A `link_shared` event is acknowledged at once (Slack wants an answer within three
  seconds). Freero then calls `chat.unfurl` with the message's `channel` and `ts` and one preview per
  Freero link, at most ten per message. An event Slack sends again (a retry) is answered once.
- **Limits.** At most `RATE_LIMIT_SLACK_UNFURL` (default `50/1m`) `chat.unfurl` calls per Slack
  workspace, which is Slack's own tier for that method. Links past the limit stay without a preview.
- **Logs.** Each event is one log line, `"slack": { "event": "link_shared", "team", "eventId",
  "links", "outcome" }`, where `outcome` is one of `unfurled`, `no_links`, `duplicate`,
  `rate_limited`, `slack_error` (with Slack's `error`, such as `cannot_unfurl_url`) or `failed`.
  Refused requests are logged as `"slack": { "refused": "unsigned" | "mismatch" | "stale" }`. The
  metric is `freero_slack_unfurls_total{outcome}`.
- **Nothing is stored.** No table, no tokens per user. The app acts only as itself, with the two
  link scopes.

## Turning it off

Remove `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` and restart. Links then appear as Slack shows
any other link. To stop it on Slack's side, uninstall the app from the workspace.

## Sources

- Events API: https://docs.slack.dev/apis/events-api/
- `url_verification`: https://docs.slack.dev/reference/events/url_verification
- Verifying requests from Slack: https://docs.slack.dev/authentication/verifying-requests-from-slack
- `link_shared`: https://docs.slack.dev/reference/events/link_shared
- `chat.unfurl`: https://docs.slack.dev/reference/methods/chat.unfurl
- Unfurling links in messages: https://docs.slack.dev/messaging/unfurling-links-in-messages
- App manifests: https://docs.slack.dev/reference/app-manifest
