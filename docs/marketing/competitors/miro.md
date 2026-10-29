# Freero vs Miro: competitor fact sheet

Checked 2026-10-28. Facts about Miro come from public pages listed under Sources (no logins). Facts
about Freero come only from the repo files named in each row (paths relative to the repo root).

## 1. What it is and who it's for

Miro is a hosted, proprietary visual workspace: an infinite online canvas for brainstorming,
workshops, diagramming, planning and, increasingly, AI-assisted work. It sells per-member plans from
small teams up to large enterprises, and most of its revenue comes from business and enterprise
customers (about $600M ARR, more than 250,000 organizations and nearly 4 million paying users, per
the Bending Spoons announcement of 2026-09-10 [S1]). Since 2026-10-26 it is owned by Bending Spoons
[S2].

## 2. Pricing as of 2026-10-28

Source: miro.com/pricing, checked 2026-10-28 [S3]. Prices in USD, per member per month.

| Plan | Annual billing | Monthly billing | Main limits / gates |
|---|---|---|---|
| Free | $0 | $0 | 3 editable boards; AI is a small trial (FAQ: 10 credits/month for the team); 100 MCP calls/day; no private boards; no guests |
| Starter | $8 | $10 (derived, see note) | Unlimited boards; 25 AI credits/member/month; 500 MCP calls/day; private boards; anonymous visitors on public boards |
| Business | $20 | $25 (derived, see note) | 50 AI credits/member/month; 2,000 MCP calls/day; unlimited signed-in guests; SAML SSO; 14-day trial |
| Enterprise | Custom (from 30 members) | Contact sales | From 2,500 pooled AI credits/month; 10,000 MCP calls/day; SCIM; audit logs; data residency choice of EU, US, Australia, Japan |

- Note on monthly prices: the page shows annual prices and states that annual billing saves 20% over
  monthly; the monthly figures above are derived from that ($8 / 0.8, $20 / 0.8). Third-party
  trackers agree on $10 for Starter monthly and mostly list $25 for Business monthly [S4]. Treat the
  monthly numbers as derived, not read directly.
- Invoicing is annual-only with seat minimums (10 on Starter, 5 on Business) [S3].
- Paid add-ons exist (e.g. a prototyping add-on billed in AI credits; data classification, key
  management, eDiscovery) [S3; docs/parity.md §13].
- The free-plan AI allowance is shown as a "limited trial" in the plan table and as 10 credits/month
  in the FAQ [S3].

## 3. AI and agent capabilities

- **Built-in AI.** Miro AI generates and edits board content (diagrams, tables, summaries,
  prototypes, mind maps) and is metered in AI credits per plan [S3][S5]. In 2026 Miro shipped
  "Sidekicks" (AI agents that use team context and produce canvas structures) and "Flows"
  (multi-step AI workflows that can be saved and shared), plus connectors that pull context from
  Slack, Jira, GitHub, Confluence and others into Sidekicks and Flows [S5][S6]. Free, Starter and
  Education members are capped at 5 Flow runs each (help center, via search snippet) [S7].
- **Model choice.** Users can pick among Miro-provided models in Flows and Sidekicks, and Enterprise
  admins can restrict providers (beta) [S8]. No option to bring your own API key or endpoint was
  found.
- **MCP server.** Official remote MCP server, OAuth 2.1 with dynamic client registration, documented
  for Claude, ChatGPT/Codex, Claude Code, Cursor, Gemini CLI and VS Code; works on all plans,
  including Free [S9]. It lists 20 tools, 12 of them write tools (create boards, create/update
  widgets, diagrams, docs, tables, code widgets, reply to and resolve comments); only the summarize
  tool uses AI credits [S10]. Disabled by default on Enterprise until an admin enables it [S10].
  Daily MCP call caps per plan: 100 / 500 / 2,000 / 10,000 [S3]. The help center calls it a beta
  (via search snippet; page returned 403) [S11].
- **Human review of agent edits.** The MCP docs describe no suggestion or approve/reject step;
  agent writes apply directly, within the user's board permissions [S10].
- **Public API.** REST API v2 plus a Web SDK for in-board apps; some Teams endpoints are
  Enterprise-only [S12].
- **Webhooks.** Miro's experimental board webhooks were discontinued effective 2025-12-05, with no
  replacement announced [S13].

## 4. Self-hosting and licensing

Proprietary, closed source, hosted SaaS only. Miro runs on AWS; there is no on-premises or
customer-hosted edition. Enterprise customers can pick a data-residency region and use key
management options including bring-your-own-key [S14].

## 5. Enterprise features

| Feature | Miro | Plan needed | Source |
|---|---|---|---|
| SAML SSO | Yes | Business and up | [S3] |
| SCIM provisioning | Yes | Enterprise | [S3] |
| Audit logs | Yes | Enterprise | [S3] |
| Data residency | EU, US, Australia, Japan | Enterprise for US/AU/JP; the plan table also marks EU residency on lower plans (see Could not verify) | [S3][S14] |
| Bring-your-own-key | Yes | Enterprise | [S14] |
| Certifications | ISO 27001, ISO 42001, SOC 2 Type II, SOC 3, Cyber Essentials, IRAP | Company-wide | [S14] |
| Accessibility conformance report | Available on request | n/a | [S14] |

## 6. Integrations relevant to Freero's differentiators

- **Jira.** Miro's own "Jira Cards" app imports, creates and edits Jira issues on the board; Miro's
  Atlassian Marketplace listing describes two-way updates (type, priority, key, summary,
  description, status, assignee) and Jira Data Center support [S15][S16]. Help-center material says
  real-time two-way sync needs a webhook configured per Jira instance (via search snippet) [S17].
  Verdict: **two-way, on paid plans** (help center lists Starter, Business, Education, Enterprise)
  [S17].
- **Linear.** Miro-built Linear app: import Linear issues, filter them, edit details and status,
  create issues from the board; Linear changes show on the board. Business and Enterprise only,
  admin must authorize; no custom fields [S18][S19]. Verdict: **two-way for core fields, Business+**.
- **GitHub.** No Miro-built GitHub app found. "GitHub for Miro" is a third-party app by
  ServiceRocket with free and paid tiers, listing bidirectional sync; creating issues directly from
  Miro is marked as coming soon [S20]. Verdict: **Partial (third-party app)**.
- **Marketplace.** 250+ apps, integrations and AI tools [S21].

## 7. Where Miro is genuinely stronger than Freero

- **Scale and maturity.** Over 100M users, 250,000+ organizations, ~4M paying users [S1]. Freero is
  a young project with a small user base and no documented support contracts or SLAs (brief).
- **Template ecosystem.** Miroverse advertises 7,000+ templates [S22]; Freero ships 73 original
  templates and has no community gallery (`apps/web/src/features/templates/lib/catalog/index.ts`).
- **Marketplace and in-board SDK.** 250+ apps [S21] and a Web SDK [S12]; Freero has no app SDK or
  marketplace (brief, "Developer platform").
- **Native apps.** Windows, macOS, iOS, Android and interactive-display apps [S23]; Freero is a PWA
  only, view-and-comment on phones (`docs/accessibility.md` "Touch and small screens").
- **AI depth.** Agent-style Sidekicks, multi-step Flows, AI prototyping and connectors to outside
  context [S5][S6]; Freero has no board-aware chat assistant, AI workflows, AI slides, image
  generation or semantic search (`docs/ai.md`).
- **Certifications and enterprise controls.** ISO 27001, ISO 42001, SOC 2 Type II, IRAP, BYOK and
  four hosted residency regions [S14]; Freero has no certifications, customer-managed keys, DLP or
  eDiscovery, and no multi-region hosted offer (brief).
- **Turnkey hosting.** Nothing to run. Freero is self-hosted unless a hosted offer exists (brief).
- **Integrations breadth.** 250+ marketplace apps, including Microsoft Teams, Google Meet and a
  two-way monday.com sync app [S21]; Freero has no Asana, Azure DevOps, monday.com, Trello, ClickUp or Notion sync
  (`docs/trackers.md`).
- **Built-in video, import, languages.** Freero has no built-in calls, no import from Miro, and an
  English-only interface (brief).

## 8. Where Freero is stronger

Each point pairs a Freero file with the Miro-side source.

1. **Open source and self-hostable.** Freero is MIT-licensed (`LICENSE`) and runs from
   `docker compose up` on your own infrastructure (`README.md` "Run it", `docs/deployment.md`).
   Miro is proprietary SaaS on AWS with no on-prem option [S14].
2. **No plan gates.** Every Freero feature is free; limits are operator quotas (`docs/parity.md`
   §13). Miro's free plan allows 3 editable boards and gates SSO (Business), SCIM and audit logs
   (Enterprise) [S3].
3. **Agent edits as reviewable suggestions.** Freero's MCP server grants `boards:read` and
   `boards:suggest` by default; `propose_changes` creates suggestions people accept or reject, and
   the board doesn't change until they do (`docs/mcp.md`). Miro's MCP write tools apply directly;
   no review step is documented [S10].
4. **No per-call metering of agents or AI.** Freero charges no AI credits or MCP fees; operators set
   rate limits, and AI uses your own model provider (`docs/mcp.md`, `docs/ai.md`,
   `docs/configuration.md`). Miro caps MCP calls per day by plan (100 on Free) and meters AI in
   credits [S3].
5. **Bring your own model.** Freero works with Anthropic or any OpenAI-compatible endpoint
   (including Azure OpenAI, Ollama, vLLM), operator-wide or per workspace, and doesn't store prompts
   or answers (`docs/ai.md`). Miro offers a choice among its own providers; no own-key option was
   found [S8].
6. **Two-way GitHub and Linear sync on every install.** Freero syncs both ways with Jira
   Cloud/Data Center, Linear, GitHub and GitHub Enterprise Server, with field mapping, per-field
   conflict rules and roadmap mode (`docs/trackers.md`). Miro's Linear app is Business+ only [S18]
   and GitHub sync relies on a third-party app [S20].
7. **Webhooks.** Freero has HMAC-signed workspace webhooks with retries and a delivery log
   (`docs/events.md`). Miro discontinued its experimental webhooks on 2025-12-05 with no
   replacement [S13].
8. **SSO, SCIM and audit log without an enterprise contract.** Freero ships per-workspace SAML/OIDC
   SSO, SCIM and a hash-chained audit log (`docs/configuration.md`, `ARCHITECTURE.md`). Miro needs
   Business for SSO and Enterprise (30+ members) for SCIM and audit logs [S3].
9. **Edit-capable guests without an account, free.** Freero lets visitors join shared boards with a
   guest name (`ARCHITECTURE.md` "Guests: visitors without an account"). Miro allows anonymous
   visitors on public boards on Starter and Business [S3]; on Free, visitors are view-only
   (`docs/parity.md` §13).
10. **Data residency by choice of infrastructure.** Self-hosters put Freero in any region
    (`docs/deployment.md`). Miro's US, Australia and Japan residency is Enterprise-only and moving
    from EU carries migration fees [S3].

## 9. Suggested comparison table

| Capability | Miro | Freero | Sources |
|---|---|---|---|
| Free tier | Partial (3 editable boards) | Yes (no plan gates) | Miro [S3]; Freero `docs/parity.md` §13 |
| Lowest paid price per seat | Paid ($8/mo annual, ~$10 monthly) | Yes ($0; self-hosted) | [S3]; `README.md` |
| Open source licence | No | Yes (MIT) | [S14]; `LICENSE` |
| Self-hosting | No | Yes | [S14]; `docs/deployment.md` |
| MCP / agent access | Yes | Yes | [S9]; `docs/mcp.md` |
| Agent write access with human review (suggestions) | No | Yes | [S10]; `docs/mcp.md` (`propose_changes`) |
| Built-in AI | Yes (credits; limited trial on Free) | Partial (needs a configured model; no assistant/workflows) | [S3][S5]; `docs/ai.md` |
| Bring-your-own AI model | No | Yes | [S8]; `docs/ai.md` |
| Jira two-way | Paid (Starter) | Yes | [S16][S17]; `docs/trackers.md` |
| Linear two-way | Paid (Business) | Yes | [S18]; `docs/trackers.md` |
| GitHub two-way | Partial (third-party app) | Yes | [S20]; `docs/trackers.md` |
| REST API | Yes | Yes | [S12]; `docs/api/openapi.json` |
| Webhooks | No (retired 2025-12-05) | Yes | [S13]; `docs/events.md` |
| SSO (SAML/OIDC) | Paid (Business) | Yes | [S3]; `docs/configuration.md` |
| SCIM | Paid (Enterprise) | Yes | [S3]; `docs/configuration.md` |
| Audit log | Paid (Enterprise) | Yes | [S3]; `ARCHITECTURE.md` |
| Data residency choice | Paid (Enterprise: EU/US/AU/JP) | Yes (self-host anywhere; no hosted regions) | [S3][S14]; `docs/deployment.md` |
| Compliance certifications (SOC 2 / ISO 27001) | Yes | No | [S14]; brief "Enterprise / security" |
| Native desktop/mobile apps | Yes | No (PWA) | [S23]; `apps/web/public/manifest.webmanifest` |
| Template library size | Yes (7,000+) | Partial (73) | [S22]; `apps/web/src/features/templates/lib/catalog/index.ts` |
| App marketplace | Yes (250+) | No | [S21]; brief "Developer platform" |
| Accessibility statement / VPAT | Yes (ACR on request) | Partial (WCAG 2.1 AA statement, no VPAT) | [S14]; `docs/accessibility.md` |
| Guest access without account | Paid (Starter; view-only on Free) | Yes | [S3]; `ARCHITECTURE.md` "Guests" |

## 10. Target search keywords

- **free Miro alternative** (primary)
- **open source Miro alternative** (primary)
- **self-hosted Miro alternative** (primary)
- Miro vs Freero
- Miro MCP alternative
- Miro alternative with Jira sync
- Miro alternative with Linear integration
- Miro alternative for AI agents
- Miro alternative after Bending Spoons acquisition
- whiteboard with MCP server
- free Miro alternative with SSO
- Miro alternative no board limit

## 11. Notable timely context

- **Bending Spoons acquired Miro (confirmed, closed).** Bending Spoons (NASDAQ: BSP) announced a
  definitive agreement on 2026-09-10 to buy Miro for an enterprise value of $1.355B (about $1.79B
  equity value including net cash), all cash, expected to close in Q4 2026 [S1]. Miro's CEO Andrey
  Khusid confirmed it the same day on Miro's blog; the post says Bending Spoons will review Miro's
  operations after closing before deciding on structure and roles [S24]. Bloomberg reported the
  agreement the same day [S25]. Bending Spoons announced completion on 2026-10-26 [S2]; The Next
  Web and Investing.com reported the close the same day [S26][S27]. The price is reported as about
  90% below Miro's 2022 peak valuation of $17.5B [S28].
- **Post-deal changes: none announced.** As of 2026-10-28 neither company has announced layoffs,
  leadership or pricing changes at Miro [S2][S26]. Press coverage notes Bending Spoons' history of
  restructuring acquired companies (e.g. Vimeo) [S28]; any claim about Miro cuts should stay
  "reported" until confirmed.
- **Earlier Miro layoffs (reported).** About 7% of staff in early 2023 and about 18% (~275 people) in
  October 2024, per Reworked [S28].
- **Same acquirer, same quarter.** Bending Spoons completed its Airtable acquisition shortly before
  the Miro announcement [S1].
- **Webhooks retired.** Miro discontinued experimental webhooks effective 2025-12-05 [S13].
- **2026 AI push.** Sidekicks, Flows and external-context connectors (May 2026 release post) [S6];
  MCP server with per-plan daily call caps [S3][S9].

## Sources

All checked 2026-10-28.

- [S1] Bending Spoons press release (SEC exhibit), 2026-09-10: https://www.sec.gov/Archives/edgar/data/2004711/000200471126000015/bsp_ex99-1.htm (also https://investors.bendingspoons.com/newsroom/bending-spoons-agrees-to-acquire-miro)
- [S2] Bending Spoons, "completes the acquisition of Miro", 2026-10-26: https://investors.bendingspoons.com/newsroom/bending-spoons-completes-the-acquisition-of-miro
- [S3] Miro pricing page: https://miro.com/pricing/
- [S4] Third-party price trackers (secondary): https://recurdash.com/subscription-pricing/miro , https://saascrmreview.com/miro-pricing/ , https://www.vendr.com/marketplace/miro
- [S5] Miro AI page: https://miro.com/ai/
- [S6] Miro, "What we launched in May 2026": https://miro.com/blog/whats-new-may-2026/
- [S7] Miro help center, AI Workflows overview (via search snippet): https://help.miro.com/hc/en-us/articles/29722516406546-Miro-AI-Workflows-overview
- [S8] Miro help center, AI provider availability (Beta) and Select your own model (via search snippets): https://help.miro.com/hc/en-us/articles/34182831271570-AI-provider-availability-overview-Beta , https://help.miro.com/hc/articles/29484232754578
- [S9] Miro developer docs, Miro MCP: https://developers.miro.com/docs/miro-mcp
- [S10] Miro developer docs, MCP intro and tool list: https://developers.miro.com/docs/mcp-intro
- [S11] Miro help center, MCP server article (403 to direct fetch; via search snippet): https://help.miro.com/hc/en-us/articles/31624028247058
- [S12] Miro REST API reference guide: https://developers.miro.com/docs/rest-api-reference-guide
- [S13] Miro changelog, "Removed: Experimental Webhooks Support": https://developers.miro.com/changelog/removed-experimental-webhooks-support
- [S14] Miro Trust Center: https://trust.miro.com/
- [S15] Miro Marketplace, Jira Cards: https://miro.com/marketplace/jira
- [S16] Atlassian Marketplace, Jira Cards by Miro: https://marketplace.atlassian.com/apps/1219583/jira-cards-by-miro
- [S17] Miro help center Jira articles (via search snippets): https://help.miro.com/hc/articles/360017572434 , https://help.miro.com/hc/articles/8588617184402
- [S18] Linear integrations directory, Miro: https://linear.app/integrations/miro
- [S19] Miro help center, Linear overview (via search snippet): https://help.miro.com/hc/en-us/articles/30596808532754-Linear-overview
- [S20] Miro Marketplace, GitHub for Miro (ServiceRocket): https://us.miro.com/marketplace/github-for-miro/
- [S21] Miro Marketplace: https://miro.com/marketplace/
- [S22] Miroverse templates: https://miro.com/templates/
- [S23] Miro apps: https://miro.com/apps/
- [S24] Miro blog, "Miro + Bending Spoons" (Andrey Khusid), 2026-09-10: https://miro.com/blog/miro-bending-spoons/
- [S25] Bloomberg, 2026-09-10: https://www.bloomberg.com/news/articles/2026-09-10/bending-spoons-agrees-to-buy-workspace-miro-for-1-36-billion
- [S26] The Next Web, 2026-10-26: https://thenextweb.com/news/bending-spoons-completes-miro-deal
- [S27] Investing.com, 2026-10-26: https://in.investing.com/news/stock-market-news/bending-spoons-completes-acquisition-of-miro-platform-93CH-5654374
- [S28] Reworked, 2026-09-10: https://www.reworked.co/collaboration-productivity/bending-spoons-acquires-miro-for-136b/

## Could not verify

- Miro's monthly-billing prices are not printed on the pricing page; $10 / $25 are derived from the
  stated 20% annual saving and match most third-party trackers.
- The pricing table appears to mark EU data residency on Free/Starter/Business, while the Trust
  Center says the default region is the US. Whether lower plans can actually choose EU hosting is
  unclear; confirm with Miro before publishing a residency claim beyond "Enterprise".
- help.miro.com returned 403; plan details for Jira Cards, the MCP beta label and Flow-run caps come
  from search-result snippets of those articles.
- Whether Miro's Jira sync covers Jira Data Center fully today (the Atlassian listing notes a recent
  version was made non-installable).
- Bloomberg article body (paywalled); only its headline/date were used.
- No confirmed report of post-acquisition layoffs or pricing changes at Miro as of 2026-10-28.
- Whether Freero's "hosted service" mentioned in `docs/mcp.md` exists or has a price (brief flags it
  as unconfirmed); this sheet makes no hosted-Freero claim.
