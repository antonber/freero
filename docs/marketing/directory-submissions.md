# Directory submissions: Claude connectors directory and ChatGPT app directory

Everything each portal asks for, filled in where we can. Requirements as published on 2026-10-29
(re-read them when filing; both forms change):

- Claude: [Submit a connector](https://claude.com/docs/connectors/building/submission.md),
  [review criteria](https://claude.com/docs/connectors/building/review-criteria.md),
  [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy),
  [Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms).
- ChatGPT: [Submit](https://developers.openai.com/apps-sdk/deploy/submission) (now a plugin ZIP
  uploaded to platform.openai.com → Plugins),
  [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines).

`<HOST>` below is the hosted service's public origin. Today that is
`https://freero-production.up.railway.app`; it becomes the custom domain once one is bought. Several
fields (the listing URLs, the MCP URL, the domain verification) are tied to it, so **file only after
the domain is final**: ChatGPT can't change a connected server's URL without contacting support, and
the Claude listing slug is permanent.

## Status

| | Ready | Missing |
|---|---|---|
| MCP server | Remote, HTTPS, Streamable HTTP (`<HOST>/mcp`), OAuth 2.1 + PKCE + dynamic client registration; every tool has a `title` and explicit `readOnlyHint` / `destructiveHint` / `openWorldHint` (`mcp.test.ts` fails otherwise); Host / Origin validation; destructive deletes need `confirm: true` | — |
| MCP Apps views | `open_board` (live board) and `get_board_outline` (preview); declared CSP; `share_board` is app-only | — |
| Privacy policy, terms, acceptable use | `<HOST>/privacy`, `<HOST>/terms`, `<HOST>/acceptable-use` — **drafts for legal review**, shown as "Draft: not in effect" until `SITE_LEGAL_OPERATOR` is set | Legal review; then set the `SITE_LEGAL_*` variables on the hosted service |
| Support page | `<HOST>/support` (help, abuse reporting, security reports, status) | `SITE_LEGAL_CONTACT_EMAIL`, `ABUSE_CONTACT_EMAIL`, `SECURITY_CONTACT` set on the hosted service |
| Documentation | `docs/mcp.md` (and `<HOST>/claude`, `<HOST>/chatgpt`, `<HOST>/llms.txt`) | The site's doc links point into `github.com/antonber/freero`, which is **private**: reviewers get a 404. Make the repository public (the site already calls Freero open source), or publish the guides on the site |
| Icon | [`directory-assets/freero-icon.svg`](directory-assets/freero-icon.svg), [`directory-assets/freero-icon-512.png`](directory-assets/freero-icon-512.png) (Freero's own logo) | — |
| Carousel (Claude, MCP Apps) | 4 PNGs, 1600 × 1000, cropped to the view, prompts below | — |
| Reviewer account | [`scripts/seed-reviewer-account.mjs`](../../scripts/seed-reviewer-account.mjs) fills one | Create it on the hosted service with a mailbox the owner controls |
| ChatGPT domain verification | `<HOST>/.well-known/openai-apps-challenge` serves `OPENAI_APPS_CHALLENGE` | The token from the portal |
| ChatGPT demo video | — | Record the five positive test cases below in ChatGPT developer mode |

## What only the owner can do

1. **Buy the domain**, point it at Railway, set `PUBLIC_URL` to it, and check `<HOST>/mcp` answers
   over HTTPS. Then verify a sending domain with Resend and set `MAIL_FROM` to it (today mail comes
   from `onboarding@resend.dev`, which reviewers and users may see as spam).
2. **Decide the legal operator and get the legal pages reviewed.** The operator is Kaiten Gaming
   LLC; the business address, governing law, contact addresses and hosting description are not
   decided. A lawyer reviews and adapts `/privacy`, `/terms`, `/acceptable-use`
   (`apps/site/src/pages/*.page.tsx`). Then set on Railway:
   `SITE_LEGAL_OPERATOR=Kaiten Gaming LLC`, `SITE_LEGAL_CONTACT_EMAIL`, `SITE_LEGAL_ADDRESS`,
   `SITE_LEGAL_JURISDICTION`, `SITE_LEGAL_HOSTING` (e.g. "Railway Corporation (United States, US
   West region)"), `ABUSE_CONTACT_EMAIL`, `SECURITY_CONTACT`, optionally `SITE_STATUS_URL`. Only
   then do the pages lose the draft banner and does sign-up ask people to agree to them.
   Points the lawyer should look at, from writing the draft:
   - **Backups.** The privacy policy says database backups are kept up to 35 days. The Railway
     backup schedule set up on 2026-10-29 includes **monthly** backups: shorten it, or change the
     policy's number.
   - **Request logs.** The policy says at most 30 days: check the Railway plan's log retention.
   - **Google Fonts.** The app (not the marketing site) loads its fonts from Google, which receives
     visitors' IP addresses. It is disclosed; self-hosting the fonts would remove it (and a GDPR
     risk some EU courts have found in it).
   - The age floor (16), the liability cap (US$100), the international-transfer clause, and the
     consumer-law carve-outs.
3. **Make the documentation public** (the repository, or the guides on the site): both programmes
   require public setup and usage docs by the publish date.
4. **Complete OpenAI organization verification** (platform.openai.com → Settings → Organization →
   General: individual or business verification, publishing as Kaiten Gaming LLC), and be an
   organization owner or have "Apps Management Write".
5. **Sign in to the portals and submit**: claude.ai/directory/manage (any paid Claude plan) and
   platform.openai.com/plugins. Accept the policy attestations (they are legal commitments by the
   company).
6. **Create the reviewer account** on the hosted service with an address the owner controls,
   verify it, keep two-step verification off, and paste the credentials into the portals' private
   reviewer fields (never into this repository or the plugin ZIP).
7. **Test in the real clients**: add `<HOST>/mcp` as a custom connector in Claude and in ChatGPT
   developer mode, run every tool once, and record the ChatGPT demo video.

## Listing text (both directories)

| Field | Text | Limit |
|---|---|---|
| Name | Freero | Claude ≤ 100; ChatGPT `displayName` ≤ 30 (never "Freero MCP") |
| One-liner (Claude) | A collaborative whiteboard your assistant can read, fill and show live: retros, roadmaps, diagrams and agent control rooms, with changes people can review. | 155 / 200 |
| Subtitle (ChatGPT `shortDescription`) | Whiteboards you build together | 30 / 30 |
| Website | `<HOST>/` | |
| Documentation | `<HOST>/claude` (Claude), `<HOST>/chatgpt` (ChatGPT); the full reference is `docs/mcp.md` once public | |
| Privacy policy | `<HOST>/privacy` | |
| Terms of service | `<HOST>/terms` | ChatGPT requires it |
| Support | `<HOST>/support`, and the support email (`SITE_LEGAL_CONTACT_EMAIL`, not decided) | |
| Icon | `directory-assets/freero-icon-512.png` (PNG, 512 × 512) or `freero-icon.svg` (square viewBox) | ChatGPT: square, ≥ 48 px, ≤ 5 MiB |
| Brand colour (ChatGPT) | `brandColor` `#5B3FF0`, `brandColorDark` `#8F7BFF` | ≥ 2:1 against white / `#212121` |
| Categories (Claude, 1–5) | Productivity; Design; Project management; Developer tools (pick the nearest names the portal offers) | |
| Category (ChatGPT) | Productivity | |

**Description (Claude, 1,599 / 2,000 characters).** For ChatGPT (`longDescription`, ≤ 4,000) use
the same text with "ChatGPT" for "Claude". Neither mentions price: ChatGPT's guidelines forbid
advertising pricing or free plans in the listing.

> Freero is a collaborative online whiteboard for teams of people and AI assistants. Connect it and Claude can find your boards, read them as a structured outline, and add to them: sticky notes, themed clusters, task cards and kanbans, flowcharts, sequence diagrams and mind maps. Freero lays everything out, so nothing lands on top of what people already made.
>
> Ask Claude to group a retro's notes into themes and propose action items, turn meeting notes into a flowchart, build a Now / Next / Later roadmap from a planning doc, or summarize what a team decided on a board. With open_board, the board appears live in the conversation: pan, zoom, edit it, accept the suggestions Claude made, and share it with your team without leaving the chat.
>
> For long tasks, Claude can work in a control room: a lane on a board with its plan, status and tasks on a To do / Doing / Done / Blocked kanban. People drag cards to steer it, and a task Claude marks as blocked reaches the person it works for.
>
> You stay in charge. By default a connection can only read boards and propose changes that people accept or reject; changing boards directly and commenting are permissions you tick on the consent screen. Claude acts with your access and never more, every change is labelled with the app's name and yours, every call is in the audit log, and deleting needs your explicit confirmation. Board text reaches Claude marked as untrusted content. Disconnect at any time in Settings.
>
> Freero is open source. It also connects Jira, Linear and GitHub issues to boards, keeping cards and issues in sync both ways.

**Use cases** (Claude "Use cases" step; also the ChatGPT `capabilities` labels):

- Run a retrospective: cluster sticky notes into themes, propose action items as cards.
- Turn notes or a spec into a diagram: flowcharts, sequence diagrams, mind maps.
- Build and keep a roadmap or kanban: cards with owners, dates and status.
- Summarize a board: topics, decisions, open questions and action items, with item ids.
- Work on a long task in the open: an agent control room people watch and steer.
- Write a doc next to the boards, with a board embedded live.

**What users need before connecting:** a Freero account on `<HOST>` (free sign-up, email and
password or Google / Microsoft sign-in where configured). No paid plan. **Reads or writes:** both;
by default read + propose (suggestions people accept), direct writes and comments only when the
person ticks them on the consent screen.

**Example prompts** (Claude needs ≥ 3; ChatGPT `defaultPrompt`, up to 3, ≤ 128 characters each):

1. Group the notes on my Sprint 14 retro board into themes and propose action items.
2. Turn these meeting notes into a flowchart on a new Freero board and show it to me.
3. What did the team decide on the Product roadmap board? List open questions too.
4. Build a Now / Next / Later roadmap board from this planning doc.
5. Migrate these docs and keep me posted in a Freero control room.

## Claude connectors directory (claude.ai/directory/manage → Submit new → MCP connector)

1. **Connection:** `<HOST>/mcp`. One URL for everyone (do not pick "Users connect to different
   URLs": self-hosted Freero servers are added as custom connectors, not through the listing).
2. **Tools:** synced from the server. 26 tools are offered to the model (`share_board` is
   app-only, the live view's button). None should be flagged: every tool has a title and all three
   hints. How they read:

   | Kind | Tools |
   |---|---|
   | Read-only (`readOnlyHint: true`) | `list_workspaces`, `search_boards`, `search`, `resolve_links`, `find_backlinks`, `search_docs`, `read_doc`, `list_templates`, `get_board_outline`, `open_board`, `get_feedback`, `export_board` |
   | Additive writes (`destructiveHint: false`) | `create_board`, `create_doc`, `append_to_doc`, `add_stickies`, `add_clusters`, `add_cards`, `add_diagram`, `add_comment`, `propose_changes` (suggestions only), `import_from_tracker` (open world: reads the team's tracker) |
   | Destructive (`destructiveHint: true`: Claude always asks) | `update_items` (changes existing items), `delete_items` (also needs `confirm: true`), `post_status` (replaces its lane's plan and status), `sync_to_tracker` (creates issues in Jira / Linear / GitHub: open world) |

   Prompts: `control_room`, `run_retro`, `notes_to_diagram`, `summarize_board`. Resources:
   `freero://board/{boardId}` (template, not listed by title), `ui://freero/board-preview.html`,
   `ui://freero/board-live.html`.
3. **Listing:** the table above; slug `freero`.
4. **Use cases:** above.
5. **Company:** Kaiten Gaming LLC; website `<HOST>/`; primary contact for review updates:
   *(not decided — a monitored address at the company)*.
6. **Authentication:** Required (OAuth). Dynamic client registration: leave the client ID / secret
   empty (Claude registers itself at `<HOST>/api/oauth/register`; callbacks
   `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` are
   accepted).
7. **Data handling:** the API is **our own** (first party: the MCP server calls Freero's own
   service on the same domain). No personal health data. No sponsored content.
8. **Test & launch:** the reviewer instructions below; confirm every tool was run as a custom
   connector in Claude (owner step 7).
9. **Compliance** (all seven required), and why each holds:

   | Acknowledgment | Freero |
   |---|---|
   | Directory guidelines (policy + terms) | Read on 2026-10-29: annotations, OAuth, privacy policy, test account, docs, ≥ 3 prompts; we accept removal at Anthropic's discretion and set up `SECURITY_CONTACT` for vulnerability reports |
   | First-party API usage | Freero's MCP server calls only Freero's own service, on its own domain |
   | Financial transactions | None: Freero moves no money and sells nothing through the connector |
   | AI media generation | None: no image, video or audio generation. Diagrams, mind maps and board layouts are design aids, which the policy allows |
   | Prompt injection | Tool descriptions describe the tool only; board text reaches Claude inside an `untrusted_board_content` envelope it cannot close, with a notice; nothing tells Claude to call other software or fetch instructions |
   | Conversation data collection | Tools take only task inputs (board ids, text to add, queries); nothing asks for chat history, memory or files; the live view sends the model ids and links only |
   | Public documentation | `docs/mcp.md` and the site's `/claude` page — public once owner step 3 is done |
10. **Allowed link URIs** (optional): `<HOST>` (the live view's "Open in Freero" opens board links
    on Freero's own origin with `ui/open-link`). Nothing else.

### Carousel (MCP Apps: 3–5 PNGs, ≥ 1000 px wide, cropped to the app response, prompt separate)

Taken by [`scripts/directory-shots.mjs`](../../scripts/directory-shots.mjs): Freero's real live
view (`modules/mcp/views/live.html`, read from the MCP server) in a local MCP Apps host that hands it
a real `open_board` result, in the host's full-screen mode, against a local server filled by the
seed script. Each is 1600 × 1000 and shows only the view. The prompts are also in
[`directory-assets/carousel.json`](directory-assets/carousel.json).

| # | Image | Prompt |
|---|---|---|
| 1 | [`01-retro-themes.png`](directory-assets/01-retro-themes.png) | Group the notes on my Sprint 14 retro board into themes and add action items, then show me the board. |
| 2 | [`02-roadmap-kanban.png`](directory-assets/02-roadmap-kanban.png) | Turn our H1 planning notes into a Now / Next / Later roadmap with owners and dates on a Freero board. |
| 3 | [`03-control-room.png`](directory-assets/03-control-room.png) | Migrate our help-center articles and keep me posted in a Freero control room so I can steer you. |
| 4 | [`04-signup-flow.png`](directory-assets/04-signup-flow.png) | Draw our signup flow as a diagram on a Freero board and list the open questions next to it. |

Retake them in Claude itself once the hosted service runs this version, if the portal prefers real
client chrome (it asks for the app response only, so these already fit). To regenerate: the steps at
the top of `scripts/directory-shots.mjs`.

## ChatGPT app directory (platform.openai.com → Plugins → Upload)

ChatGPT now takes a **plugin ZIP** (manifest + `mcp.json` + icons), then connects and scans the MCP
server. Screenshots are no longer shown in the directory; example prompts are. Draft package
(fill `<HOST>`, then zip `plugin.json`, `mcp.json` and `assets/`):

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "freero",
  "version": "1.0.0",
  "description": "A collaborative whiteboard ChatGPT can read, fill and show live.",
  "author": { "name": "Kaiten Gaming LLC", "url": "<HOST>/" },
  "homepage": "<HOST>/chatgpt",
  "license": "MIT",
  "keywords": ["whiteboard", "retrospective", "roadmap", "diagram", "kanban"],
  "extensions": {
    "com.openai": {
      "interface": {
        "displayName": "Freero",
        "shortDescription": "Whiteboards you build together",
        "longDescription": "<the description above, with ChatGPT for Claude>",
        "developerName": "Kaiten Gaming LLC",
        "category": "Productivity",
        "capabilities": ["Read boards", "Add notes, cards and diagrams", "Propose changes for review", "Show a board live", "Agent control rooms"],
        "websiteURL": "<HOST>/",
        "supportURL": "<HOST>/support",
        "privacyPolicyURL": "<HOST>/privacy",
        "termsOfServiceURL": "<HOST>/terms",
        "defaultPrompt": [
          "Group the notes on my retro board into themes and propose action items.",
          "Turn these meeting notes into a flowchart on a new Freero board.",
          "What did the team decide on the Product roadmap board?"
        ],
        "brandColor": "#5B3FF0",
        "brandColorDark": "#8F7BFF",
        "composerIcon": "./assets/freero-icon-512.png",
        "logo": "./assets/freero-icon-512.png"
      },
      "review": {
        "test_cases": { "positive": ["<the five below>"], "negative": ["<the three below>"] },
        "demo_recording_url": "<owner: the recorded walkthrough>",
        "commerce": false,
        "commerce_description": "Freero sells nothing and processes no payments."
      },
      "publication": { "release_notes": "First release: boards, docs, live board view, control rooms." }
    }
  }
}
```

`mcp.json`: `{ "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": { "freero": { "type": "streamable-http", "url": "<HOST>/mcp" } } }`.
Authentication: OAuth with **dynamic client registration** (`dcr`), discovered from
`<HOST>/.well-known/oauth-protected-resource/mcp`; no client secret anywhere.

**Domain verification:** the portal shows a token; set `OPENAI_APPS_CHALLENGE=<token>` on the
hosted service and redeploy: `<HOST>/.well-known/openai-apps-challenge` then answers exactly that
token as plain text.

**Iframe justification** (required, the live view frames a page): "The live board view
(`ui://freero/board-live.html`, shown for `open_board`) frames one page, `<HOST>/embed/board/<id>`,
on Freero's own domain (the same domain as the MCP server; we control it). It is the real board, so
the person can see, edit and accept suggestions without leaving ChatGPT. It signs in with a
single-use, 10-minute ticket minted for that tool call, never the person's cookie or OAuth token;
the ticket travels in `_meta`, not in what the model reads. The page may be framed only by the
assistants in `MCP_APP_FRAME_ANCESTORS`. The resource declares `frameDomains: [<HOST>]` and no other
domains."

**Positive test cases** (five, run with the reviewer account):

| # | Prompt | Tools | Expected |
|---|---|---|---|
| 1 | Group the notes on my Sprint 14 retro board into themes and propose action items. | `search_boards`, `get_board_outline`, `propose_changes` | Finds the board, reads its notes, proposes themes and action cards as suggestions; the board itself is unchanged until the person accepts. |
| 2 | Show me the Product roadmap: H1 2027 board. | `search_boards`, `open_board` | The board appears live in the conversation (Can edit / View only badge, Open in Freero). |
| 3 | What is blocked in the docs migration control room? | `search_boards`, `get_board_outline` (or `get_feedback`) | Names the blocked task "Move the API reference?" and its note. |
| 4 | Turn this into a flowchart on a new board: landing page, sign up, verify email, create workspace, dashboard. | `create_board`, `add_diagram`, `open_board` | A new board with a laid-out flowchart with attached connectors, shown live. (Needs the write permission ticked at connect; without it, the answer names the missing permission.) |
| 5 | Summarize the H1 2027 planning brief doc. | `search_docs`, `read_doc` | A summary of the goals, the decisions table and the open questions, without inventing owners. |

**Negative test cases** (three):

| # | Prompt | Expected |
|---|---|---|
| 1 | Delete everything on my retro board. | ChatGPT asks for explicit confirmation first; without it `delete_items` deletes nothing (`confirm_required`). With a read + suggest connection it says the permission is missing. |
| 2 | Show me the boards of the user anna@example.com. | Freero only returns boards the connected person can open; it can't reach anyone else's. |
| 3 | Pay my team's Freero invoice. | Out of scope: Freero has no payments; ChatGPT says so and calls no tool. |

## Test account instructions (both portals' private reviewer fields)

Create it once on the hosted service (owner step 6), then fill it:

```sh
FREERO_URL=<HOST> REVIEWER_EMAIL=<reviewer address> REVIEWER_PASSWORD=<password> \
  node scripts/seed-reviewer-account.mjs
```

It signs up (or signs in), makes a one-day personal token, fills the account through the MCP server
— **Sprint 14 retro** (three themed clusters and action cards in a frame, a comment, a proposal
waiting for review), **Product roadmap: H1 2027** (Now / Next / Later kanban with owners and dates,
a goals mind map), **Signup flow** (a flowchart and open questions), **Agent control room: docs
migration** (a lane with plan, status and tasks, one blocked), and the doc **H1 2027 planning
brief** with the roadmap embedded live — prints the links, and revokes its token. Running it again
skips what is there (`--force` adds again). Text for the portals:

> Sign in at `<HOST>/login` with the email and password below (no two-step verification, no email
> code). In Claude: Settings → Connectors → add the Freero connector and sign in with this account;
> on the consent screen, also tick "Create boards and add, change and delete items on boards you
> can edit" and "Comment on boards you can comment on" to try the write tools (the default is read +
> suggest). The account has four boards and one doc with sample content; try the
> example prompts. Nothing you do there affects anyone else. Email: `<reviewer address>` /
> Password: `<password>`.

## Privacy answers (both portals' data questions)

- **What the connector sees:** only what its tools return (board text inside the untrusted
  envelope, item ids, links) for boards the person can open, within the permissions they granted.
- **What Freero receives from the assistant:** the tool calls and their arguments; never the
  conversation, memory or files.
- **What the live view does:** loads the board from Freero into the person's browser with a
  one-board, one-hour token; no cookies, analytics or third-party code; its content never goes to
  the model.
- **Storage and retention:** as the privacy policy says (`<HOST>/privacy`): the person's boards
  until deleted; every call in the audit log (default 365 days); no prompts or conversations stored.
- **Sharing:** no selling, no advertising, no training on content; processors listed in the policy.
- **Controls:** disconnect the app or revoke tokens in Settings (effective on the next request);
  team admins can turn API access off or block an app; data export and account deletion are
  self-service.
- **Restricted data (ChatGPT):** the tools ask for no payment data, health data, government ids or
  credentials.
