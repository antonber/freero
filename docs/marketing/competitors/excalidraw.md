# Freero vs Excalidraw (including Excalidraw+): competitor fact sheet

Slug: `excalidraw` · Facts checked 2026-10-28 · Source numbers [n] refer to the Sources list at the end.

## 1. What it is and who it's for

Excalidraw is a minimal, open-source sketching whiteboard known for its hand-drawn look. Developers
and technical writers reach for it to draw quick architecture diagrams and explainers, and many other
products embed it as a component [1][2]. It comes in three forms:

- **excalidraw.com:** a free web app with no account, local-first saving, and end-to-end encrypted
  live sessions [2].
- **@excalidraw/excalidraw:** an MIT-licensed npm package [1][2].
- **Excalidraw+:** a paid SaaS that adds cloud workspaces, access management, comments,
  presentations, AI quotas, and an MCP server and REST API [3].

Because both products are MIT-licensed and self-hostable, open source is **not** a differentiator
in this comparison.

## 2. Pricing as of 2026-10-28

From the Excalidraw+ pricing page [3], checked 2026-10-28. Prices are in USD.

| Plan | Price | What you get |
|---|---|---|
| Free (excalidraw.com and "Free solo") | $0 | Full editor, 1 infinite scene, unlimited collaborators, 10 generative AI requests a day, export to PNG/SVG/file, E2EE in the browser |
| Excalidraw+ (Plus) | $6 per user per month | Unlimited scenes and folders, cloud saving, access management, edit/view sharing, comments, voice hangouts and screen sharing, presentations (PDF/PPTX export), 100 AI requests a day or bring your own key, MCP and REST API (public beta), SOC 2 Type 2; 14-day free trial |

- **Billing:** a Monthly/Annually toggle says annual billing "saves 14%". The page doesn't label
  which period the $6 belongs to.
- **Secondary source:** CostBench reports $6 billed annually and $7 billed monthly. Its changelog
  logs a rise to $7 in February 2026 and a cut to $6 in June 2026; it cross-checked the official page
  on 2026-06-16 [4].
- **Payment and enterprise:** card only, no bank transfer [3]. An Enterprise tier (licenses, wire
  transfer) is on the roadmap backlog [5].
- **Self-hosting the open-source editor** costs nothing beyond your own infrastructure [6].

## 3. AI and agent capabilities

- **Built-in AI:**
  - Text-to-diagram, Mermaid-to-Excalidraw and wireframe-to-code [3].
  - Quotas: 10 requests a day on Free, 100 a day on Plus [3].
  - Plus can bring its own key (BYOK) [3][5]. A new text-to-diagram chat has shipped, and a
    "Generate anything" AI chat is in progress [5].
- **Excalidraw+ MCP server:** Excalidraw's own server, at `https://api.excalidraw.com/api/v1/mcp` [7].
  - Status: public beta [7].
  - Auth: an Excalidraw+ API key sent as a bearer token. No OAuth is documented [7].
  - Read tools: list, get and search scenes and their content, screenshots, collections, users and
    logs [8].
  - Write tools: create, update, delete and edit scenes (`edit_scene_content`), `create_diagram`,
    slides, sharing settings, collections, workspace users and invites [8].
  - Human review: none documented; writes apply directly [8].
- **Official Excalidraw MCP App:**
  - Repository `excalidraw/excalidraw-mcp` (MIT, about 5.6k stars), remote endpoint
    `https://mcp.excalidraw.com` [9].
  - Streams new hand-drawn diagrams into the chat with fullscreen editing and export to
    excalidraw.com [9].
  - Its tools (`read_me`, `create_view`, `export_to_excalidraw`, checkpoints) work on diagrams made
    in the chat, not on saved Excalidraw+ workspaces (directory listing, reported) [10].
  - Listed in Anthropic's Claude connector directory [10].
- **Community MCP servers:** several unofficial ones exist (for example `yctimlin/mcp_excalidraw`).
  Third-party directories sometimes mislabel them as official [11].
- **REST API:** `https://api.excalidraw.com/api/v1` for workspace, users, invites, collections,
  scenes, presentations, scene content and logs. It uses Plus API keys and is in public beta [12].
- **Webhooks:** none documented [12].
- **Outside agents on boards:** yes, through Excalidraw+ (read and write, beta). The free
  excalidraw.com app has no account or API, so agents can't act on boards stored there.

## 4. Self-hosting and licensing

- **License:** the editor and the excalidraw.com app are MIT [1]. So is the example collaboration
  server, `excalidraw-room` [13].
- **Self-hosted open-source edition:**
  - Excalidraw publishes a Docker image of the client (`excalidraw/excalidraw`) [6].
  - Excalidraw's own docs say "self-hosting your own instance doesn't support sharing or collaboration
    features" [6].
  - The public build stores shared scenes in Excalidraw's Firebase. Community guides wire in
    `excalidraw-room` and replacement storage to get live sessions working [14].
  - The OSS edition has no accounts, roles or permissions. Those come from Excalidraw+ ("access
    management") [3][15].
- **Self-hosted Excalidraw+:** not available. It is "in progress" with a waitlist and will be sold
  under an Enterprise license [15]. The public roadmap lists it in the backlog [5].

## 5. Enterprise features

| Feature | Status | Source |
|---|---|---|
| SSO | Not available; on the roadmap backlog | [5] |
| SCIM | Not listed anywhere we checked | [3][5] |
| Audit log | Partial: a workspace logs endpoint exists in the API/MCP (`list_logs`); its scope is not documented | [8][12] |
| Role-based access for workspace admins | Plus | [16] |
| Data residency | No region choice published. A third-party review says the privacy policy places servers in the US (reported) | [16][17] |
| Certifications | SOC 2 Type 1 and Type 2 (Plus); report in their Trust Center; yearly penetration test; AES-256 at rest | [3][16] |
| Self-hosted Enterprise | Waitlist | [15] |

## 6. Integrations relevant to Freero's differentiators

- **Jira / Confluence: none shipped.**
  - A "bidirectional integration" is *in progress* on the Excalidraw+ roadmap [5].
  - A third-party "Excalidraw for Confluence" app (by XDevPod, not Excalidraw) embeds the editor in
    Confluence. It has no Jira issue sync [18].
- **GitHub: none.** Diagrams for PRs are on the roadmap backlog [5].
- **Linear: none found** [5].
- **Embedding instead of sync:** Excalidraw is embedded by many products, including Notion, Replit,
  Obsidian (community plugin), HackerRank and Google Cloud. It also has a VS Code extension [2]. Those
  are embeds, not tracker sync.

## 7. Where Excalidraw is genuinely stronger than Freero

- **Simplicity and speed:** open the site and draw. There is no account, no setup, and a deliberately
  small toolset [2].
- **Distinctive hand-drawn style:** sketchy diagrams are its signature look [2].
- **Huge open-source community:** about 134.7k GitHub stars and 4,100+ commits [1]. Freero is young,
  with a small community.
- **Embeddable library:** the `@excalidraw/excalidraw` React package powers diagrams inside other
  products [2]. Freero documents no embeddable editor component and has no SDK.
- **Privacy model:** live sessions on excalidraw.com are end-to-end encrypted, and drawings autosave
  locally [2].
- **Offline use:** the PWA works offline [2]. Freero only rides out short disconnects.
- **AI on the free tier with no setup:** 10 requests a day, including text-to-diagram, Mermaid
  import and wireframe-to-code [3]. Freero's AI is off until an operator configures a model, and its AI
  actions don't include wireframe-to-code (`docs/ai.md`).
- **MCP presence in chat clients:** an official MCP App that renders diagrams inside Claude and other
  MCP Apps clients [9][10]. Freero's in-chat live boards are planned, not shipped.
- **Certification:** SOC 2 for Excalidraw+ [3][16]. Freero has none.
- **Shape libraries:** a large community catalog of shape libraries (libraries.excalidraw.com; no
  total count published) [19].
- **Localization:** i18n support in the editor [2]. Freero is English only.

## 8. Where Freero is stronger (verifiable)

| Freero fact (source) | Excalidraw contrast (source) |
|---|---|
| Real-time collaboration (live sync, cursors, follow, comments) is part of the self-hosted product. The Compose stack ships proxy, 2 app replicas, Postgres, Redis and MinIO (`README.md` "Collaboration" and "Run it", `docs/deployment.md`) | Self-hosted Excalidraw "doesn't support sharing or collaboration features" [6] |
| Accounts, workspaces and board roles (owner, editor, commenter, viewer), plus link sharing with password and expiry, when self-hosted (`README.md`, `ARCHITECTURE.md`) | The OSS edition has no accounts or permissions. Access management is a hosted Plus feature, and self-hosted Plus is waitlist-only [3][15] |
| Per-workspace SAML 2.0 / OIDC SSO with verified domains, and SCIM provisioning (`docs/configuration.md` "Workspace single sign-on, provisioning and data exports") | SSO is in the roadmap backlog; SCIM isn't listed [5] |
| Append-only, hash-chained audit log per workspace, with export (`ARCHITECTURE.md`, `docs/configuration.md`) | Only a logs endpoint in the beta API, with undocumented scope [8][12] |
| An MCP server built into every Freero server, including self-hosted ones. OAuth 2.1 (dynamic registration, PKCE) or tokens. Scoped permissions with read and *suggest* on by default and write opt-in. `propose_changes` for human accept or reject. Every tool call audit-logged (`docs/mcp.md`) | Excalidraw+ MCP is hosted-only, public beta, API-key auth, with no documented review step. The free MCP App draws new diagrams in chat rather than editing saved boards [7][8][9][10] |
| Two-way sync with Jira Cloud and Data Center/Server, Linear, GitHub and GitHub Enterprise Server, including roadmap mode (`docs/trackers.md`) | The Jira/Confluence integration is "in progress"; GitHub is in the backlog; no Linear integration [5] |
| Workspace webhooks for board and item events, HMAC-signed, with retries (`docs/events.md`) | No webhooks documented [12] |
| Workshop facilitation: voting, a shared timer, presentation and private mode, polls, word clouds, Q&A and planning poker (`docs/configuration.md` RATE_LIMIT_ENGAGE, `apps/web/src/features/engage`, `apps/web/src/features/estimation`) | The Excalidraw+ pricing page lists presentations, voice and comments but no voting, timer or polls [3] |
| Structured board items beyond drawing: task cards, kanban, tables, timeline/Gantt, mind maps, and 73 board templates (`README.md`, `apps/web/src/features/templates/lib/catalog/index.ts`) | The README feature list centers on shapes, arrows, free-draw, images and shape libraries [2] |
| Bring your own model on the free product, including local Ollama or vLLM, with workspace token budgets (`docs/ai.md`) | BYOK is a Plus feature; Free gets 10 requests a day on Excalidraw's model [3] |

## 9. Suggested comparison table

| Capability | Excalidraw / Excalidraw+ | Freero | Sources |
|---|---|---|---|
| Free tier usable by a team | Yes (excalidraw.com live sessions) | Yes | [2][3]; `docs/parity.md` §13 |
| Full features with no per-seat fee | No (Plus $6/user/mo) | Yes | [3]; `docs/parity.md` §13 |
| Open-source license | Yes (MIT) | Yes (MIT) | [1]; `LICENSE` |
| Self-hosting | Partial (editor only) | Yes | [6]; `docs/deployment.md` |
| Real-time collaboration when self-hosted | No (officially unsupported) | Yes | [6]; `README.md` |
| Accounts and roles when self-hosted | No | Yes | [3][15]; `README.md` |
| MCP server | Yes (Plus MCP beta; free MCP App) | Yes | [7][9]; `docs/mcp.md` |
| Agent write access to saved boards | Paid (Plus, beta) | Yes (opt-in scope) | [8]; `docs/mcp.md` |
| Agent edits as suggestions for human review | No | Yes | [8]; `docs/mcp.md` |
| Built-in AI | Yes (10/day free, 100/day Plus) | Partial (only if the operator configures a model) | [3]; `docs/ai.md` |
| Bring your own AI model or key | Paid (Plus) | Yes | [3]; `docs/ai.md` |
| Jira two-way sync | No (in progress) | Yes | [5]; `docs/trackers.md` |
| Linear two-way sync | No | Yes | [5]; `docs/trackers.md` |
| GitHub two-way sync | No | Yes | [5]; `docs/trackers.md` |
| Public REST API | Paid (Plus, beta) | Yes | [12]; `docs/api/openapi.json` |
| Webhooks | No | Yes | [12]; `docs/events.md` |
| SSO | No | Yes | [5]; `docs/configuration.md` |
| SCIM | No | Yes | [5]; `docs/configuration.md` |
| Audit log | Partial (beta logs endpoint) | Yes | [8][12]; `ARCHITECTURE.md` |
| Data residency choice | Partial (self-host editor anywhere; hosted region not selectable) | Yes (self-host anywhere; no hosted regions) | [6][16]; `docs/deployment.md` |
| Security certifications (SOC 2/ISO) | Yes (SOC 2, Plus) | No | [16]; brief "Enterprise / security" |
| Native desktop and mobile apps | No (PWA) | No (PWA) | [2]; `apps/web/public/manifest.webmanifest` |
| Works offline | Yes (PWA) | No (short disconnects only) | [2]; brief "Honest gaps" |
| Embeddable editor component (npm) | Yes | No (not documented) | [2]; brief "Developer platform" |
| Built-in board templates | Partial (community shape libraries) | Yes (73) | [19]; `apps/web/src/features/templates/lib/catalog/index.ts` |
| Plugin marketplace | No | No | [2]; brief "Developer platform" |
| Accessibility statement or VPAT | No (none found) | Partial (statement, no VPAT) | (none found); `docs/accessibility.md` |
| Guest editing without an account | Yes | Yes | [2][3]; `ARCHITECTURE.md` |
| Facilitation (voting, timer, polls) | No (not listed) | Yes | [3]; `apps/web/src/features/engage` |

## 10. Target search keywords

- **Excalidraw alternative for teams** (primary)
- **self-hosted Excalidraw alternative** (primary)
- **Excalidraw vs Freero** (primary)
- self-hosted Excalidraw with real-time collaboration
- Excalidraw Plus alternative
- open source whiteboard with SSO
- Excalidraw Jira integration
- Excalidraw MCP server alternative
- open source whiteboard with SCIM and audit log
- Excalidraw alternative with kanban and templates
- open source collaborative whiteboard Docker

## 11. Notable timely context

- **2025-03-11:** open-source release v0.18.0. A v0.18.1 followed on 21 April; the GitHub releases page
  doesn't show the year [20].
- **2025-06-18:** "Excalidraw+ is SOC 2 compliant" blog post [21]. The security page now states
  Type 1 and Type 2 [16].
- **2026-01-26:** Anthropic launched MCP Apps (interactive connectors in Claude) [22]. Excalidraw's
  official MCP App was listed in the Claude directory, added 2026-02-09 per a third-party listing
  (reported) [10].
- **2026 (date not published):** Excalidraw+ MCP server and REST API in public beta [7][12].
- **February / June 2026:** Plus price reportedly raised to $7, then lowered to $6 (third-party
  tracker, reported) [4].
- **In progress:** self-hosted Excalidraw+ (waitlist, Enterprise license) and a bidirectional
  Jira/Confluence integration [5][15].

## Sources

1. https://github.com/excalidraw/excalidraw (checked 2026-10-28)
2. https://raw.githubusercontent.com/excalidraw/excalidraw/master/README.md (checked 2026-10-28)
3. https://plus.excalidraw.com/pricing (checked 2026-10-28)
4. https://costbench.com/verify/excalidraw/, https://www.costbench.com/changelog/excalidraw-price-increase-2026-02/, https://costbench.com/changelog/excalidraw-price-decrease-2026-06/ (third-party; checked 2026-10-28)
5. https://plus.excalidraw.com/roadmap (checked 2026-10-28)
6. https://docs.excalidraw.com/docs/introduction/development (Self-hosting section; checked 2026-10-28)
7. https://plus.excalidraw.com/docs/mcp (checked 2026-10-28)
8. https://plus.excalidraw.com/docs/mcp/tools (checked 2026-10-28)
9. https://github.com/excalidraw/excalidraw-mcp (checked 2026-10-28)
10. https://www.promptarmor.com/connectors/excalidraw and https://claude.com/connectors/excalidraw-app-demo (third-party listing and directory entry; via search, checked 2026-10-28)
11. https://mcpservers.org/id/servers/yctimlin/mcp_excalidraw (community server; via search, checked 2026-10-28)
12. https://plus.excalidraw.com/docs/api (checked 2026-10-28)
13. https://github.com/excalidraw/excalidraw-room (checked 2026-10-28)
14. https://sliplane.io/blog/self-hosting-excalidraw-the-easy-way and https://railway.com/deploy/excalidraw-whiteboard (community guides; via search, checked 2026-10-28)
15. https://plus.excalidraw.com/docs/self-hosting/excalidraw-plus-self-hosting (checked 2026-10-28)
16. https://plus.excalidraw.com/security-and-compliance (checked 2026-10-28)
17. https://europeanpurpose.com/tool/excalidraw (third-party review; via search, checked 2026-10-28)
18. https://marketplace.atlassian.com/apps/1231435 (checked 2026-10-28)
19. https://libraries.excalidraw.com/ (checked 2026-10-28; count not rendered)
20. https://github.com/excalidraw/excalidraw/releases (checked 2026-10-28)
21. https://plus.excalidraw.com/blog (post dated 2025-06-18; checked 2026-10-28)
22. https://claude.com/blog/interactive-tools-in-claude (via search, checked 2026-10-28)

## Could not verify

- Whether the $6 Plus price is the annual or the monthly rate. The page shows only "save 14%" on
  annual; $7 monthly comes from a third party.
- Where Excalidraw+ data is hosted (the privacy page returned 404; a US location is reported by a
  third party only).
- What the Plus logs endpoint records (we couldn't confirm it as an audit log).
- Whether the Plus MCP and REST API need a paid plan beyond a Plus API key (no plan named in the docs).
- The year of the v0.18.1 release, and the launch date of the Plus MCP and API betas.
- The number of community libraries on libraries.excalidraw.com.
- Whether an accessibility statement or VPAT exists (none found).
