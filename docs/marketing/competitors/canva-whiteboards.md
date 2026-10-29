# Freero vs Canva Whiteboards: competitor fact sheet

Slug: `canva-whiteboards` · Facts checked 2026-10-28 · Source numbers [n] refer to the Sources list at the end.

## 1. What it is and who it's for

Canva Whiteboards is the whiteboard design type inside Canva's all-in-one visual platform. Boards live
alongside presentations, docs, social graphics, video and websites in the same editor. It suits
marketing, education and general business teams who already create content in Canva and want to
brainstorm, then turn the result into a doc or deck [1][2][3]. Its strengths are Canva's huge template
library and easy editor rather than engineering workflows. It is closed-source SaaS.

## 2. Pricing as of 2026-10-28

**Source caveat:** canva.com/pricing returned HTTP 403 to our fetcher, so we could not read it
directly. The figures below come from PricingSaaS's captures of the Canva pricing page (latest
change recorded 2026-09-14, none recorded in October 2026) [4][5]. Moda's review (prices verified
2026-09-08) supplied storage and seat terms [6]. All prices are in USD, excluding tax.

| Plan | Billed annually | Billed monthly | Notes |
|---|---|---|---|
| Free | $0 | $0 | Whiteboards included; 5 GB storage; up to 20 Standard or Premium AI uses a month [5][6] |
| Pro (one person) | $144/yr ($12/mo) | $18/mo | Single user only [5][6] |
| Business (per person) | $250/yr ($20.83/mo) | $25/mo | No listed seat minimum; 500 GB storage [5][6] |
| Enterprise | Contact sales | Contact sales | Contracted seats [6] |
| Education / Nonprofits | Free for eligible users | | [6] |

- The old Teams plan is closed to new sign-ups; Business replaces it [6].
- Pro's annual price moved $144 → $180 (2026-07-28 / 08-04) and back to $144 (2026-09-11) [4][5].
- On 2026-09-09 the Free AI allowance was cut from "200 Standard or 20 Premium" uses to 20 [4].
- Extra AI can be bought with an AI Pass add-on (Pro, Business) or top-ups (Business) [7].

## 3. AI and agent capabilities

- **Built-in AI on whiteboards:**
  - Sticky-note sort (by author, color, topic or reactions, with AI topic grouping).
  - A Summary tool.
  - Magic Switch, which turns a whiteboard into a doc or summary (reported to need Pro) [2][8].
  - Canva's whiteboard pages returned 403, so these come from Canva's localized pages as indexed by
    search and from educator blogs.
- **Canva AI 2.0:**
  - Launched 2026-04-16 at Canva Create as a research preview.
  - Adds conversational design, scheduled background tasks and connectors (Slack, Notion, Zoom,
    Gmail, Google Drive, Google Calendar) [9].
- **AI metering:** per-plan monthly allowances (Free: 20 uses) [5].
- **Official MCP server (Canva AI Connector):** documented at canva.dev [10][11]. Tools include:
  - Read: `search-designs`, `get-design-content`, `get-design-pages`, `list-comments`.
  - Write: `generate-design`, `create-design`, `comment-on-design`, and an editing transaction
    (`start-editing-transaction` → `perform-editing-operations` → `commit-editing-transaction`).
  - Most tools work on all plans; brand-template and autofill tools need Pro or above [11].
  - Rate limits run 10–100 per minute per tool, with a 300 per minute per user cap [11].
- **Whiteboards in MCP:** the MCP docs never mention whiteboards. They don't say whether the editing
  operations work on whiteboard designs [10][11].
- **Human review of agent edits:** none documented. The agent commits its own editing transaction [11].
- **Connect API (REST):**
  - Can create a design with the preset type `whiteboard` (20 requests per minute) [12].
  - The create endpoint documents no element-level editing [12].
  - Also covers assets, export and comments [13].
- **Webhooks (notifications):** cover comments, mentions, shares, access and approval requests, and
  suggestions. They don't fire on board content changes [14].
- **Apps SDK and Apps Marketplace:** 430 apps at the end of 2024 [15].

## 4. Self-hosting and licensing

- Canva is proprietary SaaS with no source license.
- We found no on-premises or private-cloud edition.
- Enterprise customers can pin data to the US or EU (section 5) [16].

## 5. Enterprise features

| Feature | Plan needed | Source |
|---|---|---|
| SAML SSO | Enterprise (also Education). Setup guides exist only for these plans; Business is not documented | [17][18] |
| SCIM provisioning | Enterprise and Canva for Districts only | [17][18] |
| Audit / activity logs | Enterprise | [17] |
| Data residency | Enterprise, Campus and District plans; regions: United States or European Union; migration may take 30+ days; not available for Canva China | [16] |
| Certifications | ISO 27001 and SOC 2 Type II, as stated on Canva's own pages (Trust Center not readable by us) | [17] |
| Accessibility | WCAG 2.1 AA claimed across core products; VPAT/ACR updated yearly on the Trust & Security Portal | [19] |

## 6. Integrations relevant to Freero's differentiators

- **Jira: no issue sync.** The official "Canva for Jira" app (by Canva, Jira Cloud only, v2.11.0 from
  2024-10-18) uses Canva's AI agent to generate designs and whiteboard visuals inside Jira. It
  describes no syncing of issue data [20]. Third-party apps only embed Canva designs in Jira issues [21].
- **Linear: one-way, read-only.** Linear's connector lets Canva AI read issues, projects and team
  data as context. It cannot create or change issues [22].
- **GitHub:** no official Canva app found.
- **Verdict:** none of the three trackers has two-way sync with Canva whiteboards.

## 7. Where Canva Whiteboards is genuinely stronger than Freero

- **Template and asset scale:** 1.6M+ templates across Canva (pricing page, via a secondary
  source) [7], plus stock media and brand kits. Freero has 73 built-in templates.
- **User base:** more than 265 million monthly active users and 31 million paid users by the end of
  2025 (as reported) [23]. Freero is a young project with a small user base.
- **One suite for the whole flow:** a whiteboard can become a doc, presentation or social asset in the
  same editor (Magic Switch) [2][8]. Freero's closest equivalent is a slide deck built from frames
  (`ARCHITECTURE.md` "Slide deck (KAI-126)").
- **Native apps:** Windows, Mac, iOS and Android [24]. Freero is a PWA only.
- **App ecosystem:** Apps Marketplace with 430+ apps [15]. Freero has no marketplace or SDK.
- **AI breadth Freero lacks:**
  - Image generation and background removal (MCP `generate-image`, `remove-background`) [11].
  - A conversational assistant with workplace connectors and scheduled tasks [9].
  - Built-in AI on the free plan, with no setup [5].
- **Certifications and residency:** ISO 27001 and SOC 2 Type II [17], plus a managed choice of
  US/EU data residency [16]. Freero has no certifications and no hosted regions.
- **Polish and localization:** a mature consumer-grade editor available in many languages (localized
  help and product pages [16]). Freero is English only.

## 8. Where Freero is stronger (verifiable)

| Freero fact (source) | Canva contrast (source) |
|---|---|
| Two-way sync with Jira Cloud and Data Center/Server, Linear, GitHub and GitHub Enterprise Server: send to tracker, import by query, live status badges, conflict rules, and roadmap mode writing dates back (`docs/trackers.md`) | Canva for Jira generates designs; Linear's connector is read-only; no GitHub app found [20][22] |
| A built-in MCP server with whiteboard-specific tools (board outline, stickies, clusters, Mermaid diagrams, tracker sync). Agents can *suggest* changes for people to accept or reject, and direct write is opt-in (`docs/mcp.md` "Permissions", "Tools") | The Canva MCP docs don't mention whiteboards, and editing transactions are committed by the agent, with no review step documented [10][11] |
| MIT license; self-host anywhere with Docker Compose or managed cloud services (`LICENSE`, `docs/deployment.md`) | Proprietary SaaS only [10] |
| SAML/OIDC SSO, SCIM and a hash-chained audit log in the free product (`docs/configuration.md`, `ARCHITECTURE.md`) | SSO, SCIM and audit logs need Enterprise [17][18] |
| No seat fees or plan gates; limits are operator quotas (`docs/parity.md` §13) | Collaboration features beyond Free cost $20.83–$25 per person a month on Business [5] |
| Bring your own model, including local models; no Freero AI credits; per-workspace token budgets (`docs/ai.md`) | AI is metered per plan (Free: 20 uses a month), with paid top-ups [5][7] |
| Workspace webhooks for board content (`item.created/updated/deleted`), HMAC-signed, with retries and a delivery log (`docs/events.md`) | Canva webhooks cover collaboration notifications (comments, shares, access requests), not content changes [14] |
| Guests join shared boards without an account (`ARCHITECTURE.md` "Guests: visitors without an account") | Editing without an account works only through an "anyone with the link" edit link in a desktop browser; on mobile, guests must sign in [25] |

## 9. Suggested comparison table

| Capability | Canva Whiteboards | Freero | Sources |
|---|---|---|---|
| Free tier usable by a team | Yes | Yes | [6]; `docs/parity.md` §13 |
| Full features with no per-seat fee | No | Yes | [5]; `docs/parity.md` §13 |
| Open-source license | No | Yes (MIT) | [10]; `LICENSE` |
| Self-hosting | No | Yes | [16]; `docs/deployment.md` |
| MCP server | Yes | Yes | [10]; `docs/mcp.md` |
| MCP tools documented for whiteboards | No (generic design tools) | Yes | [11]; `docs/mcp.md` |
| Agent edits as suggestions for human review | No | Yes | [11]; `docs/mcp.md` |
| Built-in AI | Yes (metered) | Partial (only if the operator configures a model) | [2][5]; `docs/ai.md` |
| Bring your own AI model or key | No | Yes | [5]; `docs/ai.md` |
| AI chat assistant or agent | Yes (Canva AI 2.0, research preview) | No | [9]; `docs/ai.md` |
| Jira two-way sync | No | Yes | [20]; `docs/trackers.md` |
| Linear two-way sync | No (read-only) | Yes | [22]; `docs/trackers.md` |
| GitHub two-way sync | No | Yes | (no app found); `docs/trackers.md` |
| Public REST API | Yes (Connect API) | Yes | [12][13]; `docs/api/openapi.json` |
| Webhooks for board content changes | No (notifications only) | Yes | [14]; `docs/events.md` |
| SSO | Paid (Enterprise) | Yes | [17][18]; `docs/configuration.md` |
| SCIM | Paid (Enterprise) | Yes | [18]; `docs/configuration.md` |
| Audit log | Paid (Enterprise) | Yes | [17]; `ARCHITECTURE.md` |
| Data residency choice | Paid (Enterprise: US/EU) | Yes (self-host anywhere; no hosted regions) | [16]; `docs/deployment.md` |
| Security certifications (SOC 2/ISO) | Yes | No | [17]; brief "Enterprise / security" |
| Native desktop and mobile apps | Yes | No (PWA) | [24]; `apps/web/public/manifest.webmanifest` |
| Very large template library | Yes (1.6M+ across Canva) | No (73) | [7]; `apps/web/src/features/templates/lib/catalog/index.ts` |
| App marketplace | Yes (430+ apps) | No | [15]; brief "Developer platform" |
| Accessibility conformance report (VPAT/ACR) | Yes | Partial (statement, no VPAT) | [19]; `docs/accessibility.md` |
| Guest editing without an account | Partial (desktop browser, edit link) | Yes | [25]; `ARCHITECTURE.md` |
| Interface languages beyond English | Yes | No | [16]; brief "Honest gaps" |

## 10. Target search keywords

- **Canva whiteboard alternative** (primary)
- **Canva Whiteboards vs Freero** (primary)
- **whiteboard with Jira integration** (primary)
- free online whiteboard for engineering teams
- open source alternative to Canva whiteboard
- self-hosted online whiteboard
- Canva whiteboard Jira sync
- Canva whiteboard Linear integration
- whiteboard with MCP server for AI agents
- whiteboard for sprint planning and retros
- Canva whiteboard SSO without enterprise plan

## 11. Notable timely context

- **March 2024:** Canva acquired Affinity (reported at $380M). On 2025-10-30 Affinity relaunched as a
  single free app [26].
- **2026-04-16:** Canva AI 2.0 launched at Canva Create in Los Angeles as a research preview [9].
- **2026-04-17:** cofounder and COO Cliff Obrecht said Canva is targeting an IPO in 2027, not 2026
  (reported) [27].
- **First 15 weeks of 2026:** Canva bought five startups, including Simtheory, Ortto, Doohly,
  Mango.AI and Cavalry (reported) [27].
- **July–September 2026:** Pro's annual price moved from $144 to $180 and back to $144. The Free AI
  allowance was cut to 20 uses a month on 2026-09-09 [4][5].
- **Earlier change:** Teams moved to per-seat billing in September 2024 (reported) [28]. Teams is now
  closed to new sign-ups in favor of Business [6].

## Sources

1. https://www.canva.com/online-whiteboard/ (returned HTTP 403 to our fetcher on 2026-10-28; content known only from search results)
2. https://www.canva.com/nl_nl/online-whiteboard/ (Canva's localized whiteboard page, via search snippet; checked 2026-10-28)
3. https://www.canva.com/sem/online-whiteboard/ (403; via search, checked 2026-10-28)
4. https://pricingsaas.com/companies/canva/diffs/2026W38 (captures 2026-09-07 → 2026-09-14; checked 2026-10-28)
5. https://pricingsaas.com/companies/canva (latest capture 2026-09-14; checked 2026-10-28)
6. https://moda.app/blog/canva-pricing (prices verified 2026-09-08; checked 2026-10-28)
7. https://www.lilachbullock.com/?p=158891 (Canva pricing summary "as of October 2026"; checked 2026-10-28)
8. https://blog.tcea.org/tag/canva-whiteboard/ (educator blog; via search, checked 2026-10-28)
9. https://siliconangle.com/2026/04/16/canva-unveils-canva-ai-2-0-recasting-platform-agentic-system-work/ (2026-04-16; checked 2026-10-28)
10. https://canva.dev/docs/mcp/ (checked 2026-10-28)
11. https://www.canva.dev/docs/mcp/tools/ (checked 2026-10-28)
12. https://www.canva.dev/docs/connect/api-reference/designs/create-design/ (checked 2026-10-28)
13. https://www.canva.dev/docs/connect/ (checked 2026-10-28)
14. https://www.canva.dev/docs/connect/webhooks/ (checked 2026-10-28)
15. https://www.canva.dev/blog/developers/canva-developers-wrapped-2024/ (2024-12-20; checked 2026-10-28)
16. https://www.canva.com/help/data-residency/ (via search snippet; page 403 to our fetcher; checked 2026-10-28)
17. https://www.canva.com/solutions/it/ (via search snippet; checked 2026-10-28)
18. https://www.canva.com/help/sso/ and https://www.canva.com/ca_es/help/scim-provisioning-pingfederate/ (via search snippet; checked 2026-10-28)
19. https://www.canva.com/accessibility/ and https://www.canva.com/policies/accessibility/ (via search snippet; checked 2026-10-28)
20. https://marketplace.atlassian.com/apps/1235307/canva-for-jira-official (checked 2026-10-28)
21. https://marketplace.atlassian.com/apps/1225852/embed-canva-for-jira (via search, checked 2026-10-28)
22. https://linear.app/integrations/canva-connector (checked 2026-10-28)
23. https://en.wikipedia.org/wiki/Canva (secondary; checked 2026-10-28)
24. https://www.canva.com/download/windows and https://www.canva.com/download/mac (via search snippet; checked 2026-10-28)
25. https://www.canva.com/help/collaborate-with-anyone/ (via search snippet; checked 2026-10-28)
26. https://www.cgchannel.com/?p=171450 and https://marketech-apac.com/canva-unveils-all-new-affinity-now-free-for-all-users/ (press; checked 2026-10-28)
27. https://www.startupdaily.net/?p=136012 ("Patient capital: Canva delays IPO to 2027 amid AI pivot", 2026-04-17; checked 2026-10-28)
28. https://piktochart.com/blog/canva-pricing-2026-costs-raised/ and https://www.usecarly.com/blog/canva-pricing/ (secondary; via search, checked 2026-10-28)

## Could not verify

- **Pricing page:** canva.com/pricing returned 403, so all prices are secondary (PricingSaaS capture
  of 2026-09-14). An October change can't be ruled out.
- **Whiteboard AI details:** sort, summary and Magic Switch come from search snippets of Canva pages
  and educator blogs; we couldn't fetch the pages themselves.
- **MCP on whiteboards:** whether the MCP editing operations work on whiteboard designs.
- **SSO on Business:** whether SAML SSO is available on Business (only Enterprise and Education are
  documented).
- **Certifications:** the full list beyond ISO 27001 and SOC 2 Type II (Trust Center not readable).
- **Current VPAT:** the newest report sits behind Canva's Trust & Security Portal.
- **Whiteboard-specific template count:** not published (1.6M+ is Canva-wide).
- **AI Connector plans:** some third-party pages say the AI Connector needs Pro, Teams, Business or
  Nonprofit, while canva.dev lists most tools for all plans.
