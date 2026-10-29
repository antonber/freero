# Freero vs FigJam: competitor fact sheet

Slug: `figjam` · Facts checked 2026-10-28 · Source numbers [n] refer to the Sources list at the end.

## 1. What it is and who it's for

FigJam is Figma's online whiteboard. It sits inside the Figma platform next to Figma Design, Slides,
Buzz and Make, and it is aimed at product teams (designers, engineers, product managers) who already
work in Figma. They use it for brainstorming, diagrams, workshops, agile rituals and planning [1].
Its biggest draw is that it lives in the same account, file browser and seat model as the design tool
many teams already pay for. It is closed-source SaaS.

## 2. Pricing as of 2026-10-28

All prices are in USD, from Figma's pricing page [2] (checked 2026-10-28) unless noted. FigJam has no
plan of its own. It is included in every paid seat type [2][3].

| Plan | Collab seat (covers FigJam) | Dev seat | Full seat | Billing |
|---|---|---|---|---|
| Starter | Free | n/a | n/a | n/a |
| Professional | $3/mo | $12/mo | $16/mo | Monthly/annual toggle (see note) |
| Organization | $5/mo | $25/mo | $55/mo | Billed annually only |
| Enterprise | $5/mo | $35/mo | $90/mo | Billed annually only; sales-led |

- **Free (Starter):** one team with 3 FigJam files (plus unlimited personal drafts), 30-day version
  history, and drafts that can be shared only as "can view" [4]. AI: 150 credits/day, up to 500/month [2].
- **What a FigJam-only user pays:** one **Collab seat**. That is $3/mo on Professional and $5/mo on
  Organization or Enterprise [2]. The seat covers FigJam, Slides and Buzz, plus view, comment and basic
  Dev Mode inspection on Design files. People can view and comment on a paid team's files without a
  seat [2]. Collab seats get 500 AI credits a month [2][3].
- **Monthly vs annual (unconfirmed):** the pricing page shows the Professional prices next to a
  Monthly/Annual toggle without labeling which billing period they belong to [2]. Third-party guides
  say $16/$12/$3 are annual-billing rates and monthly billing costs $20/$15/$5 [5] (2025 guide).
  A Figma forum thread also describes a user who saw $16 and was charged $20 at checkout [6].
- **Extra AI:** credit packages and pay-as-you-go are sold on top of seats [3][7]. We found no public
  credit prices.

## 3. AI and agent capabilities

- **Built-in AI (FigJam AI):** generates templates and visuals from a prompt, sorts stickies into
  themes, summarizes output into action items, and drafts diagrams for coding agents [1]. All of it
  draws on per-seat monthly AI credits [2][3].
- **Credit enforcement:** limits have applied to Full seats since 2026-03-18. Once a seat runs out,
  paid AI features stop until credits reset or an admin buys more [7].
- **Figma agent in FigJam:** announced at Config 2026 (post dated 2026-06-24) as "coming soon",
  waitlist only [8].
- **Official MCP server:** a remote server at `https://mcp.figma.com/mcp`, with a desktop variant [9].
  - **FigJam tools** [10]:
    - Read: `get_figjam` (an XML outline of the board plus screenshots), `get_screenshot`.
    - Write: `use_figma` (create, edit or delete stickies, sections, connectors and more),
      `generate_diagram` (from a description or Mermaid), `create_new_file`, `upload_assets`, and
      `generate_image` (uses AI credits).
  - Writing to the canvas works only on the remote server. It needs a Full seat to write outside
    drafts, and it is free during beta, then usage-based [9].
- **MCP rate limits** [11]:
  - View and Collab seats get up to 20 read calls a month, on every plan.
  - Full and Dev seats get 200 a day (Professional, Organization) or 600 a day (Enterprise).
  - Write tools are exempt from these limits.
  - So a FigJam-only (Collab) user gets 20 read calls a month and, per [9], needs a Full seat to
    write outside drafts.
- **Human review of agent edits:** the tool docs describe no suggestion or approval mode. Writes
  apply directly [10].
- **Public REST API:** reads files and their nodes as JSON, posts comments, and manages webhooks,
  variables and dev resources [12]. It does not write board content [12]. The overview page doesn't say
  explicitly whether FigJam is covered.
- **Webhooks:** team, folder and file webhooks. File-webhook limits depend on the plan (Professional
  150, Organization 300, Enterprise 600) [13].
- **Plugins and widgets:** the plugin and widget platform also runs in FigJam [14].

## 4. Self-hosting and licensing

- FigJam is proprietary SaaS with no source license and no on-premises edition.
- Figma for Government exists: Figma lists FedRAMP Authorized [15], and that plan can use only the
  desktop MCP server [9].
- Localized hosting (data residency) is the closest thing to a private-cloud option. It is
  Enterprise-only (see section 5).

## 5. Enterprise features

| Feature | Plan needed | Source |
|---|---|---|
| SAML SSO | Organization, Enterprise | [16] |
| SCIM user provisioning | Organization, Enterprise (seat assignment via SCIM: Enterprise only) | [16][17] |
| Activity (audit) logs | Organization, Enterprise | [16] |
| Data residency | Enterprise; covers data at rest only; FigJam stickies, shapes, text, frames, images are localized, comments and file names are not | [18] |
| Data residency regions | Text lists EU, Australia, India, Brazil; the region table also lists US, Japan, Canada (page is inconsistent) | [18] |
| Governance+ (IP allowlisting, network restrictions, enforced 2FA) | Enterprise add-on | [15] |
| Certifications | SOC 2 Type 2, SOC 3, ISO 27001:2022, ISO 27018, ISO 27017, ISO 27701, ISO 42001, EU Cloud Code of Conduct, C5, TISAX, FedRAMP Authorized | [15] |

## 6. Integrations relevant to Freero's differentiators

- **Jira: partial two-way, Jira Cloud only.**
  - The Jira widget is built by Figma. It turns stickies into Jira issues, imports existing issues or
    projects, and lets you change assignee, priority, status and issue type from FigJam, with Jira
    kept as the source of truth [19][20].
  - The Atlassian listing says it works with Jira Cloud. Data Center is not listed [20].
  - Users have asked for JQL/bulk import (forum feature request, 2026) [21].
- **GitHub: create-only as documented.** The GitHub widget creates issues from FigJam. The page
  doesn't describe status sync [22].
- **Linear: no official integration found.** Only a community-built plugin exists [23].
- **Asana:** listed as an integration [1]. It is not a Freero tracker, so we didn't evaluate it.

## 7. Where FigJam is genuinely stronger than Freero

- **Ecosystem and templates:** more than 300 ready-made templates [1], plus the Figma Community's
  plugins and widgets [14]. Freero has 73 built-in templates and no marketplace or SDK.
- **Figma platform fit:** boards live next to Design, Slides and Make. One seat and one file browser
  cover them all, and Design files are viewable and commentable from a Collab seat [2].
- **Native apps:** the Figma desktop app plus Figma for iOS and Android. FigJam moved into the main
  Figma app when the FigJam iPad app retired on 2026-01-08 (reported) [24]. Freero is a PWA only.
- **Built-in AI** that Freero lacks: prompt-to-template generation, image generation in boards, and
  an upcoming agent [1][8][10]. Freero has no AI chat assistant and no image generation.
- **Agent tooling depth:** the official MCP server writes FigJam content and is part of a wide
  partner ecosystem (20 new MCP partners reported in October 2026) [9][10][29].
- **Certifications and compliance:** SOC 2 Type 2, multiple ISO standards, and FedRAMP [15].
  Freero has none.
- **Maturity:** a public company (NYSE: FIG since 2025-07-31) [25] with vendor support and
  enterprise contracts. Freero is a young project with no documented SLAs.

## 8. Where Freero is stronger (verifiable)

| Freero fact (source) | FigJam contrast (source) |
|---|---|
| No plan gates or seat fees; limits are operator quotas; MIT license (`LICENSE`, `docs/parity.md` §13) | The free tier caps a team at 3 FigJam files, and every editor beyond that needs a paid seat ($3–$5/mo Collab) [2][4] |
| Self-hostable on a single VM with Docker Compose or on any cloud, in the region you choose (`README.md` "Run it", `docs/deployment.md`) | SaaS only. Choosing a data region is Enterprise-only [18] |
| A built-in MCP server on every Freero server. Read and *suggest* are on by default; direct write is opt-in. `propose_changes` lets agents propose edits that people accept or reject before the board changes (`docs/mcp.md` "Permissions", "Tools") | We found no suggestion or review mode in the Figma MCP docs. Collab seats get 20 read calls a month, and writing outside drafts needs a Full seat [9][10][11] |
| Every agent tool call is audit-logged. Agents show up as "<App> for <you>" with their own cursor, and kill switches exist (`docs/mcp.md` "Safety", "Agent control room") | The Figma MCP docs we reviewed don't describe per-call audit entries for FigJam edits [9][10] |
| Two-way sync with Jira Cloud, Jira Data Center/Server, Linear, GitHub and GitHub Enterprise Server: field mapping, conflict rules, import by query, and roadmap mode that writes dates back (`docs/trackers.md`) | The Jira widget is Jira Cloud only. The GitHub widget creates issues. There is no official Linear integration [19][20][22][23] |
| Bring your own model (Anthropic or any OpenAI-compatible endpoint, including local Ollama/vLLM); Freero sells no AI credits (`docs/ai.md`, `docs/configuration.md` "AI") | AI runs on Figma-metered credits, enforced since 2026-03-18 [2][7] |
| SAML/OIDC SSO, SCIM and a hash-chained audit log in the free product (`docs/configuration.md` "Workspace single sign-on, provisioning and data exports", `ARCHITECTURE.md`) | SSO, SCIM and activity logs require the Organization or Enterprise plan [16] |
| Guests can join shared boards with no account (`ARCHITECTURE.md` "Guests: visitors without an account") | Account-free editing ("open sessions") needs a paid plan and lasts 24 hours per session [26] |
| Workspace webhooks include item-level events (`item.created/updated/deleted`) (`docs/events.md`) | Figma webhooks fire on file-level events such as comments or new versions [13] |

## 9. Suggested comparison table

| Capability | FigJam | Freero | Sources |
|---|---|---|---|
| Free tier usable by a team | Partial (3 FigJam files) | Yes | [4]; `docs/parity.md` §13 |
| Full features with no per-seat fee | No | Yes | [2]; `LICENSE`, `docs/parity.md` §13 |
| Open-source license | No | Yes (MIT) | [2]; `LICENSE` |
| Self-hosting | No | Yes | [18]; `docs/deployment.md` |
| MCP server | Yes | Yes | [9]; `docs/mcp.md` |
| Agent write access to boards | Paid (Full seat outside drafts) | Yes (opt-in scope) | [9][10]; `docs/mcp.md` |
| Agent edits as suggestions for human review | No | Yes | [10]; `docs/mcp.md` |
| Built-in AI | Yes (credits) | Partial (only if the operator configures a model) | [1][2]; `docs/ai.md` |
| Bring your own AI model or key | No | Yes | [2]; `docs/ai.md` |
| AI agent or chat assistant inside the board | Partial (waitlist) | No | [8]; `docs/ai.md` |
| Jira two-way sync | Partial (Cloud widget) | Yes | [19][20]; `docs/trackers.md` |
| Linear two-way sync | No | Yes | [23]; `docs/trackers.md` |
| GitHub two-way sync | Partial (create issues) | Yes | [22]; `docs/trackers.md` |
| Public REST API | Yes (read and comments) | Yes | [12]; `docs/api/openapi.json` |
| Webhooks | Paid | Yes | [13]; `docs/events.md` |
| SSO | Paid (Organization) | Yes | [16]; `docs/configuration.md` |
| SCIM | Paid (Organization) | Yes | [16][17]; `docs/configuration.md` |
| Audit log | Paid (Organization) | Yes | [16]; `ARCHITECTURE.md` |
| Data residency choice | Paid (Enterprise) | Yes (self-host anywhere; no hosted regions) | [18]; `docs/deployment.md` |
| Security certifications (SOC 2/ISO) | Yes | No | [15]; brief "Enterprise / security" |
| Native desktop and mobile apps | Yes | No (PWA) | [24]; `apps/web/public/manifest.webmanifest` |
| Template library of 300 or more | Yes | No (73) | [1]; `apps/web/src/features/templates/lib/catalog/index.ts` |
| Plugin or widget marketplace | Yes | No | [14]; brief "Developer platform" |
| Accessibility conformance report (VPAT/ACR) | Yes (Dec 2023 ACR, via third party) | Partial (statement, WCAG 2.1 AA target, no VPAT) | [27]; `docs/accessibility.md` |
| Guest editing without an account | Paid (24-hour open sessions) | Yes | [26]; `ARCHITECTURE.md` |

## 10. Target search keywords

- **free FigJam alternative** (primary)
- **FigJam vs Freero** (primary)
- **open source FigJam alternative** (primary)
- self-hosted FigJam alternative
- FigJam alternative with Jira integration
- FigJam Linear integration
- whiteboard with MCP server for AI agents
- FigJam collab seat price
- FigJam alternative without per-seat pricing
- AI agent whiteboard Claude MCP
- FigJam alternative for engineering teams
- whiteboard with two-way Jira sync

## 11. Notable timely context

- **2025-03-11:** Figma restructured seats into Full, Dev, Collab and View. The old FigJam seat became
  the Collab seat at the same price, and every paid seat now includes FigJam [28].
- **2025-07-31:** Figma IPO on the NYSE (FIG), priced at $33 per share [25].
- **2026-01-08:** the standalone FigJam for iPad app was retired; FigJam now runs in the Figma app and
  on the web (reported, from Figma's blog via search) [24].
- **2026-03-11 / 03-18:** Figma added AI-credit purchase options, then began enforcing credit limits
  on Full seats [7].
- **2026-06-24:** Config 2026 recap lists a "Figma agent in FigJam and Slides" as a waitlist feature [8].
- **October 2026:** at Config India, Figma reportedly added 20 new MCP integration partners [29].

## Sources

1. https://www.figma.com/figjam/ (checked 2026-10-28)
2. https://www.figma.com/pricing/ (checked 2026-10-28)
3. https://www.figma.com/pricing-faq/ (checked 2026-10-28)
4. https://help.figma.com/hc/en-us/articles/13838684089751-Starter-plan-overview (checked 2026-10-28)
5. https://userjot.com/blog/figma-pricing-2025-plans-seats-costs-explained and https://www.usecarly.com/blog/figma-pricing/ (secondary; checked 2026-10-28)
6. https://forum.figma.com/report-a-problem-6/full-seat-offers-at-16-but-i-am-being-charged-20-57530 (checked 2026-10-28)
7. https://forum.figma.com/product-updates-3/ai-credits-update-new-purchasing-options-and-enforcement-on-march-18-51782 (Figma staff post, 2026-03-11; checked 2026-10-28)
8. https://forum.figma.com/product-updates-3/everything-announced-at-config-2026-55221 (post 2026-06-24; checked 2026-10-28)
9. https://developers.figma.com/docs/figma-mcp-server/ (checked 2026-10-28)
10. https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/ (checked 2026-10-28)
11. https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/ (checked 2026-10-28)
12. https://developers.figma.com/docs/rest-api/ (checked 2026-10-28)
13. https://developers.figma.com/docs/rest-api/webhooks/ (checked 2026-10-28)
14. https://www.figma.com/blog/bringing-the-power-of-our-open-platform-to-figjam/ (checked 2026-10-28)
15. https://www.figma.com/security/ (checked 2026-10-28)
16. https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features (checked 2026-10-28)
17. https://help.figma.com/hc/en-us/articles/360048514653 (SCIM; via search, checked 2026-10-28)
18. https://help.figma.com/hc/en-us/articles/15643274574871-Enable-localized-file-hosting (checked 2026-10-28)
19. https://help.figma.com/hc/en-us/articles/360039827834 (checked 2026-10-28)
20. https://marketplace.atlassian.com/apps/1228454/figjam-widget-for-jira (checked 2026-10-28)
21. https://forum.figma.com/suggest-a-feature-11/add-jira-widget-in-figjam-jql-import-support-56480 (via search, checked 2026-10-28)
22. https://www.figma.com/github-for-figjam/ (checked 2026-10-28)
23. https://forum.figma.com/showcase-your-work-14/a-small-free-figjam-linear-plugin-i-built-for-founders-and-pms-54863 (via search, checked 2026-10-28)
24. https://www.figma.com/blog/introducing-figjam-for-ipad/ (retirement note reported via search, checked 2026-10-28)
25. https://www.figma.com/blog/ipo-pricing/ and https://www.axios.com/2025/07/31/figma-ipo-stock-adobe (checked 2026-10-28)
26. https://help.figma.com/hc/en-us/articles/4410786053911 (open sessions; via search, checked 2026-10-28)
27. https://software.psdschools.org/ApplicationsPublic/GetDocument/accbc2d4-d64f-4de9-8566-eebc11483746 (FigJam ACR Dec 2023, third-party host; via search, checked 2026-10-28)
28. https://www.figma.com/blog/billing-experience-update-2025/ (via search, checked 2026-10-28)
29. https://www.techdogs.com/tech-news/td-newsdesk/figma-config-india-2026-unveils-code-layers-specs-payload-20-new-mcp-integrations (press, reported; checked 2026-10-28)

## Could not verify

- Whether the Professional prices on the pricing page ($16/$12/$3) are annual or monthly rates. The
  monthly-billing figures ($20/$15/$5) come only from third-party guides.
- The exact seat requirement for FigJam MCP writes by a Collab seat. The overview page says writing
  outside drafts needs a Full seat; the tools page lists no seat rules.
- Whether the REST API and webhooks officially cover FigJam files (not stated on the overview pages).
- The full list of data-residency regions (the help article contradicts itself).
- The current FigJam VPAT. The only copy we found is from December 2023 and hosted by a third party.
- Total counts of Figma Community plugins and widgets for FigJam (not published).
- Config India 2026 details: secondary press only.
