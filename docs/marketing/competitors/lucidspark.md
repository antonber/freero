# Freero vs Lucidspark: competitor fact sheet

Checked 2026-10-28. Facts about Lucidspark come from public pages listed under Sources (no logins).
Facts about Freero come only from the repo files named in each row (paths relative to the repo root).

## 1. What it is and who it's for

Lucidspark is the online whiteboard of Lucid Software, sold alongside the Lucidchart diagramming
tool as part of Lucid's "visual collaboration suite". It targets companies, especially large
enterprises and regulated or public-sector buyers, that want brainstorming and agile planning on the
same platform and admin console as their diagrams (Lucid claims more than 100 million users across
its products [S16]; it also runs a FedRAMP Moderate offering [S9]). It is hosted, proprietary
software.

## 2. Pricing as of 2026-10-28

**Lucid's own pricing page could not be read.** lucid.app/pricing/lucidspark returns "Access Denied"
to non-browser clients and renders prices with JavaScript, including in Wayback Machine captures
(last capture 2026-09-22). The figures below come from a secondary source, PricingSaaS, whose last
capture of the page is dated **2026-08-17** [S1][S2]. Prices in USD.

| Plan | Price (billed annually) | Monthly billing | Main limits / gates |
|---|---|---|---|
| Free | $0 | $0 | 3 editable Lucidspark boards (added June 2026 per [S2]); 25 MB storage; no premium templates, voting or timer [S3] |
| Individual (Lucidspark only) | $9/month | Not shown | Unlimited editable boards; premium templates; Lucid Cards; timelines [S3] |
| Team (Lucidspark only) | $10/user/month | Not shown | Adds voting, timer, facilitator tools; AI admin controls; guest collaborator links; developer tools [S3][S7][S12] |
| Individual Bundle (Lucidchart + Lucidspark) | $13.50/month | Not shown | Both products, 25% bundle discount [S1] |
| Team Bundle | $15/user/month | Not shown | Both products [S1] |
| Enterprise | Contact sales | Contact sales | SAML SSO, SCIM, domain control, breakout boards, planning features, Jira/Azure DevOps cards [S3][S10] |

- PricingSaaS reports that in June 2026 Lucid switched to bundle-first pricing (the headline
  Individual and Team prices became the $13.50 and $15 bundles) [S2]. This is a third-party
  observation, not a Lucid announcement: say "reported".
- Monthly-billing prices and any Team-plan seat minimum could not be confirmed.
- Lucid AI is currently available on all plans with no published credit limits; Lucid says it may
  become a paid subscription later [S4].

## 3. AI and agent capabilities

- **Built-in AI.** Lucid AI generates diagrams and boards, brainstorms ideas, summarizes and answers
  questions about documents; on all plans except FedRAMP, English only, on by default; Team and
  Enterprise admins can switch it off [S4]. 2026 additions: voice prompting, "generate board"
  (frames, stickies, text from a prompt) and a chat-driven Process Agent that drafts process
  diagrams (announced 2026-03-26) [S5]. Cloud Agent and Process Capture are Enterprise / add-on only
  [S4].
- **Model provider.** Lucid runs AI on Microsoft Azure OpenAI Service and AWS Bedrock; no
  bring-your-own-model option is described [S4].
- **MCP server.** Official hosted MCP server: search, read, create diagrams, edit any Lucid document
  (including ones the MCP didn't create), share and summarize; plus a read-only variant. All plans
  except FedRAMP; Team and Enterprise need an admin to enable it; Enterprise can restrict clients and
  IP ranges; OAuth 2.0 [S6][S4]. Documented clients include Claude/Claude Code, ChatGPT/Codex, GitHub
  and VS Code Copilot, Cursor, Slackbot, Glean and others [S6]. Core MCP launched November 2025; an
  edit-document capability was announced for April 2026 [S5]; a Claude connector launched 2026-04-07
  [S13].
- **Human review of agent edits.** No suggestion / accept-reject flow for agent edits is described
  [S6].
- **Public API.** REST API for documents, folders, embedding and collaborators, and an Extension API
  that runs inside the editor; developer tools are for Team and Enterprise accounts [S7]. Lucid
  staff have said the REST API can't modify the contents of an existing document (community answer,
  date not confirmed) [S7].
- **Webhooks.** No general document-event webhooks found in Lucid's developer docs [S7].

## 4. Self-hosting and licensing

Proprietary, closed source, SaaS only on AWS (US, EU, Australia regions) [S9]. No on-premises
edition; the FedRAMP "GovSuite" is a separate hosted offering, not self-hosted [S9].

## 5. Enterprise features

| Feature | Lucidspark | Plan needed | Source |
|---|---|---|---|
| Google / Microsoft sign-in | Yes | All plans | [S3] |
| SAML SSO | Yes | Enterprise | [S3] |
| SCIM 2.0 | Yes | Enterprise | [S3] |
| Audit logs (admin view + API, SIEM script) | Yes | Enterprise with the Enterprise Shield add-on | [S8] |
| Data residency | US, EU (Germany, Ireland), Australia | Enterprise (via sales) | [S9][S14] |
| Customer key management | Lucid KMS via Enterprise Shield | Enterprise add-on | [S9] |
| Certifications | SOC 2 Type II, ISO 27001, ISO 27701, ISO 42001, FedRAMP Moderate, IRAP (PROTECTED), PCI, CASA | Company-wide | [S9] |
| Accessibility | Lucidspark ACR/VPAT dated 2026-02-16, "substantially conformant" with WCAG 2.1 A/AA | n/a | [S15] |

## 6. Integrations relevant to Freero's differentiators

- **Jira.** "Lucid Cards for Jira": two-way sync (or pull-only or manual), Jira Cloud, Data Center
  and Atlassian Government Cloud; **Enterprise only** [S10]. Verdict: **Paid (Enterprise), two-way**.
- **Azure DevOps.** Lucid Cards for Azure DevOps Cloud, two-way sync by default; Lucid's blog says
  Enterprise only [S11].
- **Linear.** No Linear integration found in Lucid's marketplace or help center [S12]. Verdict:
  **No**.
- **GitHub.** The only GitHub-related marketplace item found is a Lucid MCP connector for GitHub
  Copilot; no GitHub Issues sync for Lucidspark found [S12]. PricingSaaS reports a GitHub integration
  was removed from the Team plan in Q3 2024 [S1]. Verdict: **No** issue sync.
- **Marketplace.** 113 listings in Lucid's integrations marketplace at time of checking [S12].

## 7. Where Lucidspark is genuinely stronger than Freero

- **Certifications and public-sector readiness.** SOC 2 Type II, ISO 27001/27701/42001, FedRAMP
  Moderate, IRAP [S9]; Freero has no certifications (brief).
- **Paired diagramming product.** Lucidchart in the same account and bundle [S1]; Freero has
  diagramming features but no separate pro diagramming product, and no import from other tools
  (brief, "Honest gaps").
- **Accessibility paperwork.** A published Lucidspark VPAT/ACR [S15]; Freero has an accessibility
  statement but no VPAT (`docs/accessibility.md`).
- **Enterprise planning features.** Scenario/capacity planning, dependency mapping, breakout boards,
  Azure DevOps sync [S3][S11]; Freero has no Azure DevOps sync (`docs/trackers.md`).
- **AI breadth.** Process Agent, voice prompting, Copilot/Slack/Teams AI integrations [S4][S5];
  Freero has no assistant or AI workflows (`docs/ai.md`).
- **Templates and ecosystem.** Lucid cites 500+ Lucidspark templates and 1,500+ across the platform,
  and 113 marketplace listings [S16][S12]; Freero has 73 templates and no marketplace
  (`apps/web/src/features/templates/lib/catalog/index.ts`).
- **Native mobile apps.** iOS app (Team/Enterprise subscribers) and an Android app [S17]; Freero is
  PWA only. Lucidspark has no desktop app either [S17].
- **Scale and turnkey hosting.** 100M+ users claimed [S16], nothing to run; Freero is young and
  self-hosted (brief).

## 8. Where Freero is stronger

1. **Open source and self-hostable.** MIT licence (`LICENSE`), `docker compose up`
   (`README.md` "Run it", `docs/deployment.md`). Lucidspark is proprietary SaaS on AWS [S9].
2. **No plan gates.** Everything is free (`docs/parity.md` §13). Lucidspark Free has 3 editable
   boards and 25 MB storage; SAML SSO and SCIM need Enterprise; audit logs need an Enterprise add-on
   [S3][S8].
3. **Linear and GitHub two-way sync, and Jira without an enterprise contract.** Freero syncs Jira
   Cloud/Data Center, Linear, GitHub and GitHub Enterprise Server both ways, with roadmap mode
   (`docs/trackers.md`). Lucid's Jira cards are Enterprise-only and no Linear or GitHub issue sync
   was found [S10][S12].
4. **Agent edits as reviewable suggestions.** `boards:suggest` on by default; `propose_changes`
   produces suggestions people accept or reject (`docs/mcp.md`). Lucid's MCP edits documents
   directly; no review step is described [S6].
5. **Bring your own model.** Any OpenAI-compatible endpoint or Anthropic, per operator or workspace;
   prompts and answers not stored (`docs/ai.md`). Lucid uses its own Azure OpenAI / AWS Bedrock
   setup [S4].
6. **Webhooks and a write-capable REST API.** Signed webhooks (`docs/events.md`) and `/api/v1` with
   OpenAPI (`docs/api/openapi.json`) that edits board content. Lucid documents no general webhooks
   and staff have said its REST API can't modify existing document contents [S7].
7. **SSO, SCIM and audit log on every install.** (`docs/configuration.md`, `ARCHITECTURE.md`) vs
   Enterprise / Enterprise Shield at Lucid [S3][S8].
8. **Edit-capable guests without an account, free.** (`ARCHITECTURE.md` "Guests: visitors without an
   account") vs Lucidspark guest collaborator links on Team and Enterprise only [S18].

## 9. Suggested comparison table

| Capability | Lucidspark | Freero | Sources |
|---|---|---|---|
| Free tier | Partial (3 editable boards, 25 MB) | Yes (no plan gates) | [S2][S3]; `docs/parity.md` §13 |
| Lowest paid price per seat | Paid ($9/mo annual, secondary source) | Yes ($0; self-hosted) | [S1]; `README.md` |
| Open source licence | No | Yes (MIT) | [S9]; `LICENSE` |
| Self-hosting | No | Yes | [S9]; `docs/deployment.md` |
| MCP / agent access | Yes | Yes | [S6]; `docs/mcp.md` |
| Agent write access with human review (suggestions) | No | Yes | [S6]; `docs/mcp.md` |
| Built-in AI | Yes (all plans, for now) | Partial (needs a configured model; no assistant/workflows) | [S4]; `docs/ai.md` |
| Bring-your-own AI model | No | Yes | [S4]; `docs/ai.md` |
| Jira two-way | Paid (Enterprise) | Yes | [S10]; `docs/trackers.md` |
| Linear two-way | No | Yes | [S12]; `docs/trackers.md` |
| GitHub two-way | No | Yes | [S12]; `docs/trackers.md` |
| REST API | Paid (Team; limited content editing) | Yes | [S7]; `docs/api/openapi.json` |
| Webhooks | No (not documented) | Yes | [S7]; `docs/events.md` |
| SSO (SAML/OIDC) | Paid (Enterprise for SAML) | Yes | [S3]; `docs/configuration.md` |
| SCIM | Paid (Enterprise) | Yes | [S3]; `docs/configuration.md` |
| Audit log | Paid (Enterprise + Shield add-on) | Yes | [S8]; `ARCHITECTURE.md` |
| Data residency choice | Paid (Enterprise: US/EU/AU) | Yes (self-host anywhere; no hosted regions) | [S9][S14]; `docs/deployment.md` |
| Compliance certifications (SOC 2 / ISO 27001) | Yes | No | [S9]; brief "Enterprise / security" |
| Native desktop/mobile apps | Partial (iOS/Android; no desktop) | No (PWA) | [S17]; `apps/web/public/manifest.webmanifest` |
| Template library size | Yes (500+) | Partial (73) | [S16]; `apps/web/src/features/templates/lib/catalog/index.ts` |
| App marketplace | Yes (113 listings) | No | [S12]; brief "Developer platform" |
| Accessibility statement / VPAT | Yes (VPAT 2026-02-16) | Partial (WCAG 2.1 AA statement, no VPAT) | [S15]; `docs/accessibility.md` |
| Guest access without account | Paid (Team) | Yes | [S18]; `ARCHITECTURE.md` "Guests" |

## 10. Target search keywords

- **free Lucidspark alternative** (primary)
- **open source Lucidspark alternative** (primary)
- **Lucidspark vs Freero** (primary)
- self-hosted Lucidspark alternative
- Lucidspark alternative with Jira sync
- Lucidspark Linear integration alternative
- Lucidspark GitHub integration alternative
- Lucid MCP alternative
- Lucidspark free plan limits
- open source online whiteboard for engineering teams

## 11. Notable timely context

- **Bundle-first pricing (reported).** PricingSaaS observed Lucid moving to bundle-first pricing
  between 2026-06-01 and 2026-06-08 (Individual Bundle $13.50/mo, Team Bundle $15/user/mo, Free
  gaining 3 editable Lucidspark boards) [S2]. Not confirmed by a Lucid announcement.
- **Earlier price changes (reported).** Team rose from $9 to $10/user in Q3 2024, and GitHub
  integration left the Team plan [S1].
- **AI and MCP launches (confirmed by Lucid).** MCP core launched November 2025; 2026-03-26
  announcement of Process Agent, generate board and voice prompting [S5]; Claude connector
  2026-04-07 [S13].
- **Corporate.** No 2025–2026 acquisition, layoff or CEO change found for Lucid Software. Note that
  2026 layoff and CEO news about "Lucid" refers to Lucid Group (the electric-car maker), an
  unrelated company.

## Sources

All checked 2026-10-28.

- [S1] PricingSaaS, Lucid pricing and history (last page capture 2026-08-17; secondary): https://pricingsaas.com/companies/lucid
- [S2] PricingSaaS, Lucid change Jun 1 → Jun 8, 2026 (secondary): https://pricingsaas.com/companies/lucid/diffs/2026W24
- [S3] Lucid help center, Lucid Plans (feature matrix, no prices): https://help.lucid.co/hc/en-us/articles/360056903132-Lucid-Plans
- [S4] Lucid help center, AI in Lucid overview: https://help.lucid.co/hc/en-us/articles/31463501699476-AI-in-Lucid-overview
- [S5] Lucid press release, MCP and Process Agent, 2026-03-26: https://www.prnewswire.com/news-releases/lucid-software-advances-mcp-server-offering-and-lucid-ai-capabilities-debuts-process-agent-to-boost-speed-and-clarity-across-teams-302725846.html
- [S6] Lucid MCP server page: https://lucid.co/mcp-server
- [S7] Lucid developer docs and help (REST/Extension API; developer tools on Team/Enterprise; community note on REST editing), via search snippets: https://developer.lucid.co/docs/welcome , https://help.lucid.co/hc/en-us/articles/17919029366164-Developer-tools-in-Lucid , https://community.lucid.co/developer-community-6/lucidspark-rest-api-8167
- [S8] Lucid audit logs (Enterprise Shield), via search snippets: https://developer.lucid.co/reference/audit-logs , https://help.lucid.co/hc/en-us/articles/28014192205076-Enterprise-Shield-add-on-overview
- [S9] Lucid security page: https://lucid.co/security
- [S10] Lucid help center, Integrate Lucid Cards with Jira: https://help.lucid.co/hc/en-us/articles/14943046626964-Integrate-Lucid-Cards-with-Jira
- [S11] Lucid Cards for Azure DevOps (help and blog, via search snippets): https://help.lucid.co/hc/en-us/articles/14821391456020-Integrate-Lucid-Cards-with-Azure-DevOps-Cloud , https://lucid.co/blog/agile-workflows-with-lucidspark-cards-for-azure-devops
- [S12] Lucid integrations marketplace: https://lucid.co/marketplace
- [S13] Lucid press release, Claude connector, 2026-04-07: https://www.prnewswire.com/news-releases/lucid-software-launches-lucid-claude-connector-bringing-visual-intelligence-into-ai-workflows-302735875.html
- [S14] Lucid press release, EMEA data residency, 2024-09-10: https://prnewswire.co.uk/news-releases/lucid-software-expands-global-data-residency-program-with-new-region-in-emea-302243042.html
- [S15] Lucidspark Accessibility Conformance Report (dated 2026-02-16): https://corporate-assets.lucid.co/co/0b8c2141-945a-4b8e-ba63-01aa9bf532bd.pdf ; https://lucid.co/accessibility
- [S16] Lucid platform page (100M+ users, 1,500+ templates) and Lucid pages citing 500+ Lucidspark templates, via search snippets: https://lucid.co/platform
- [S17] Lucidspark on the App Store and Android help article: https://apps.apple.com/us/app/lucidspark/id1553934753 , https://help.lucid.co/hc/en-us/articles/15154010721300-Use-Lucidspark-on-an-Android-device
- [S18] Lucid help center, Guest Collaborators in Lucid (via search snippet): https://help.lucid.co/hc/en-us/articles/13592910415380-Guest-Collaborators-in-Lucid
- Unreadable primary source (Access Denied / JS-rendered): https://lucid.app/pricing/lucidspark

## Could not verify

- All Lucidspark prices: the official pricing page was unreadable; figures are PricingSaaS's
  2026-08-17 capture. Monthly-billing rates and Team seat minimums are unknown.
- Whether the June 2026 bundle-first change means standalone Lucidspark plans are still sold at
  $9 / $10 (PricingSaaS lists both standalone and bundle prices on 2026-08-17).
- Whether Lucid's REST API can now edit existing board content (the community answer may predate
  the April 2026 edit-document capability, which was announced for the MCP/AI path).
- Plan gating of Azure DevOps cards today (blog says Enterprise; post is older).
- Exact Lucidspark template count (Lucid pages cite both "hundreds" and "500+").
- Whether Freero's "hosted service" mentioned in `docs/mcp.md` exists or has a price (brief flags it
  as unconfirmed); this sheet makes no hosted-Freero claim.
