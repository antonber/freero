# n8n recipes

Two workflows you can import into [n8n](https://n8n.io) as they are, built on Freero's REST API
([../api/README.md](../api/README.md)) and workspace webhooks ([../events.md](../events.md)):

| File | What it does |
|---|---|
| [n8n/github-issue-to-card.json](n8n/github-issue-to-card.json) | A new GitHub issue becomes a card on a board (optionally in a kanban column), linked to the issue |
| [n8n/board-comment-to-slack.json](n8n/board-comment-to-slack.json) | A comment on a team board is posted to Slack, after its signature is checked |

Need only one of these and no other steps? Freero does both on its own: **Import issues…** (board
menu) turns a GitHub search into linked cards ([../trackers.md](../trackers.md)), and a webhook in
the `slack` format posts board activity to a Slack incoming webhook, escaped. Use n8n when you want
more: other triggers, other filters, other destinations.

## Import

In n8n, open a new workflow, then the workflow menu (**…**) → **Import from File**, or copy a
file's JSON and paste it onto the canvas. The files hold no credentials: after importing, open each
node that needs one and pick or create it.
The workflows arrive inactive; publish (activate) them once tested.

## GitHub issue → card

`GitHub Trigger` (event `issues`) → `Opened?` (only `action` = `opened`) → `Card and board` →
`Add card to Freero`, which sends:

```
POST https://<your-freero>/api/v1/boards/<boardId>/structure
Authorization: Bearer frp_…

{ "structure": { "kind": "items", "items": [ { "type": "card",
    "text": "acme/api#42: Login fails on Safari", "description": "<issue body>",
    "link": "https://github.com/acme/api/issues/42" } ] },
  "placement": { "into": "<kanbanId>", "column": "To do" } }
```

Without `placement` the card goes on free space; Freero never puts it on top of anything.

1. **GitHub Trigger**: set the owner and repository (`YOUR_GITHUB_OWNER`, `YOUR_GITHUB_REPO`) and a
   GitHub credential. n8n creates the repository webhook itself, so the token's account must be an
   owner or admin of the repository, and your n8n must be reachable from the internet.
2. **Card and board**: replace `https://YOUR_FREERO_HOST` and `YOUR_BOARD_ID` (the id in the board's
   address, `/board/<id>`). To land cards in a kanban, put its id in `kanbanId` (on the board,
   **Copy link to item** on the kanban: the id follows `?item=`) and the column's title in `column`;
   a column with a status ("To do", "Done") gives the card that status. Leave `kanbanId` empty for
   free space.
3. **Add card to Freero**: create a **Header Auth** credential, Name `Authorization`, Value
   `Bearer frp_…`. Make the token in Freero (Settings → API tokens) with only `boards:write`, named
   after this workflow: the cards then read "<token name> for <you>".

**Test**: click **Execute workflow**, open an issue in the repository, and the card appears on the
board. Then publish the workflow. A GitHub redelivery (or a re-run) adds the card again; Freero's
own *Import issues…* skips issues already on the board if you need that.

## Board comment → Slack

`Freero webhook` (raw body on) → `Verify signature` → `Valid?` → `Accept (204)` → `Comment?` →
`Slack message` → `Post to Slack`. A delivery that fails the check gets `Reject (401)` and stops,
so it shows as failed in Freero's delivery log.

**Verify signature** is a Code node. It recomputes `Freero-Signature` (HMAC-SHA256 with the
endpoint's secret over `<t>.<raw body>`), compares in constant time (`crypto.timingSafeEqual`), and
refuses timestamps more than 5 minutes off. It reads the exact bytes Freero signed from the Webhook
node's **Raw Body** option (binary field `data`, via `this.helpers.getBinaryDataBuffer`); re-encoding
the parsed JSON could differ. It needs Node's `crypto` module:

- **n8n Cloud**: available, nothing to do.
- **Self-hosted**: set `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, on the task runners if you use them.

(n8n's Crypto node can compute the HMAC but not compare it in constant time, so the Code node does
both.)

**Slack message** escapes `&`, `<` and `>` in everything people wrote (the comment, the board title,
the author's name), so a comment can't ping `<!channel>`, mention anyone or make links. Keep that
step if you change the message.

1. **Post to Slack**: replace `https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK` with a Slack
   incoming webhook URL. (Or swap in n8n's Slack node; keep the escaped text.)
2. **Freero**: in the admin console → **Webhooks**, add an endpoint with the Webhook node's
   **Production URL**, format `json`, event `comment.created`. Freero only sends to `https` URLs.
   To limit it to one board or frame, fill **Only for** with its link.
3. **Verify signature**: replace `whsec_REPLACE_ME` with the secret Freero shows once. Anyone who can
   edit the workflow can read it there; rotate it in Freero if that changes.
4. Publish the workflow, then use the endpoint's test in Freero: a `ping` arrives, gets `204` and
   posts nothing. Comment on a team board and the message appears in Slack.

The webhook path is a random id; keep it that way, but the signature is what protects the workflow.

## What reaches n8n

Webhooks report only boards every full member of the workspace can open through team access: never
personal boards, boards in a private project or hidden frames ([../events.md](../events.md#what-a-webhook-is-never-told)).
A comment's `text` is at most 280 characters. Everything people wrote is untrusted data: escape it
for wherever it goes, and never hand it to a model as instructions.

## Sources

- n8n, export and import workflows: https://docs.n8n.io/build/manage-workflows/export-and-import
- n8n, Webhook node (test / production URL, Raw Body, Respond to Webhook): https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- n8n, Code node (`crypto` on Cloud): https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/
- n8n, enable modules in the Code node: https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/enable-modules-in-code-node
- n8n, get the binary data buffer: https://docs.n8n.io/build/code-in-n8n/cookbook/code-node/get-the-binary-data-buffer
- n8n, GitHub Trigger node: https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.githubtrigger/
- n8n, HTTP Request credentials (Header Auth): https://docs.n8n.io/integrations/builtin/credentials/httprequest/
- n8n node source (parameter names and versions): https://github.com/n8n-io/n8n/tree/master/packages/nodes-base/nodes (`Github/GithubTrigger.node.ts`, `If/V2`, `Set/v2`, `HttpRequest/V3`, `Webhook`, `RespondToWebhook`, `Code`)
- GitHub, `issues` webhook payload: https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues
- Slack, escaping text: https://docs.slack.dev/messaging/formatting-message-text#escaping
