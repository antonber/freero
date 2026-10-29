# Freero vs Mural: competitor fact sheet

Checked 2026-10-28. Facts about Mural come from public pages listed under Sources (no logins). Facts
about Freero come only from the repo files named in each row (paths relative to the repo root).

## 1. What it is and who it's for

Mural (legal entity Tactivos, Inc. [S10]) is a hosted, proprietary visual collaboration workspace
aimed at facilitated teamwork: workshops, design thinking, retrospectives and planning, with a
strong focus on facilitation tools and on large enterprises, especially Microsoft-centric ones
(Azure hosting, Microsoft 365 Copilot integration, Surface Hub app) [S2][S4][S9]. It also sells
training and methods through its LUMA Institute brand [S1].

## 2. Pricing as of 2026-10-28

Source: mural.co/pricing, checked 2026-10-28 (page text read directly) [S1]. Prices in USD, per
member per month.

| Plan | Annual billing | Monthly billing | Main limits / gates |
|---|---|---|---|
| Free | $0 | $0 | Unlimited members; 3 editable murals at a time (since 2026-06-09 the three most recent stay editable, older ones become view-only [S5]); visitors view-only; open rooms only; core integrations; Mural AI not included |
| Team+ | $9.99 | $12 | Unlimited editable murals; visitors can edit; private rooms; Mural AI; basic integrations |
| Business | $17.99 | Not listed | Unlimited guests; SAML SSO and 2FA; advanced integrations (Azure, GitHub, Okta); LUMA frameworks; priority support |
| Enterprise | Contact sales | Contact sales | Multiple workspaces; confidential rooms; SCIM; audit logs and reporting APIs; data residency; BYOK; premier support |

- The pricing page doesn't state AI credit allowances or usage caps for Mural AI [S1][S2].
- Visitors (one-time collaborators on a specific mural, no account) are free on every plan; guests
  (ongoing outside collaborators) start at Business [S1].

## 3. AI and agent capabilities

- **Built-in AI.** Mural AI generates ideas, mind maps and diagrams, clusters and classifies sticky
  notes (including sentiment), and summarizes content; included on Team+, Business and Enterprise
  [S2]. A redesigned Mural AI with guided workflows shipped 2026-07-21, and AI guidance was added for
  all 36 LUMA methods on 2026-09-01 [S5]. Mural states customer content isn't used to train models
  [S2]. No credit figures are published [S2].
- **Microsoft 365 Copilot.** A Copilot agent can find murals and templates and summarize mural text
  [S2][S5].
- **Model choice.** The AI page names no model provider and no bring-your-own-model option [S2].
- **MCP server.** Mural MCP lets ChatGPT, Claude, Cursor, Gemini, Microsoft Copilot and other MCP
  clients read the canvas and create or edit stickies, shapes, connectors and text [S3]. It entered
  public preview on 2026-09-08 for paid workspaces and opened to Free users on 2026-10-13, still in
  public preview [S5]. Admin controls listed: client allowlisting, access permissions, audit logs
  [S3]. No suggestion / approve-reject step for agent edits is described [S3].
- **Public API.** Mural's public REST API (OAuth 2.0, 15-minute access tokens) is available to all
  plans within each plan's limits but is labelled beta / not generally available; a separate
  Enterprise API (audit logs, SCIM) is Enterprise-only [S6][S7].
- **Webhooks.** No webhook support is documented in Mural's developer docs (see Could not verify).

## 4. Self-hosting and licensing

Proprietary, closed source, SaaS only, hosted on Microsoft Azure by default. No on-premises edition
is offered; Enterprise customers can choose a storage region and bring their own encryption key
[S4].

## 5. Enterprise features

| Feature | Mural | Plan needed | Source |
|---|---|---|---|
| SAML SSO | Yes | Business and up | [S1] |
| SCIM (users and groups) | Yes; multiple IdPs/domains since 2026-08-18 | Enterprise | [S1][S5] |
| Audit logs | Yes | Enterprise | [S1] |
| Data residency | North America, Europe or Asia-Pacific, chosen per workspace | Enterprise | [S8][S4] |
| BYOK encryption | Yes | Enterprise | [S1][S4] |
| Data classification labels | Yes (launched 2026-09-22) | Enterprise | [S5] |
| Certifications | SOC 2 Type 2, SOC 3, ISO 27001, ISO 42001, Microsoft SSPA | Company-wide | [S4] |
| Accessibility | Statement of partial WCAG 2.1 conformance; ACR/VPAT linked | n/a | [S11] |

## 6. Integrations relevant to Freero's differentiators

- **Jira.** Mural-built integration with two-way sync for Jira Cloud and Jira Data Center (Server
  integration kept but no longer enhanced); import issues as stickies, create issues from stickies
  [S12][S13]. Upgraded Jira Cloud and Data Center integrations were released for Business and
  Enterprise on 2026-06-30; multiple Jira Cloud sites since 2026-10-20 [S5]. Verdict: **two-way;
  the upgraded version is Business+**. Mural's pricing page lists Jira among core integrations
  [S1], so a basic version may exist on lower plans.
- **Linear.** Launched 2026-09-08: import Linear issues, create them from stickies, edit and sync
  changes both ways [S5][S13]. Verdict: **two-way**; plan not stated.
- **GitHub.** Launched 2026-09-08: pasted pull-request links become live cards with some editable
  fields; create GitHub issues from stickies [S5][S13]. Mural doesn't describe it as full two-way
  issue sync. Verdict: **Partial; Business+** (GitHub listed under Business "advanced integrations")
  [S1].
- **Broader trackers.** Bulk sync with Azure DevOps, Rally, Salesforce, Asana and Microsoft Planner
  [S5].

## 7. Where Mural is genuinely stronger than Freero

- **Facilitation methods and services.** LUMA Institute frameworks, 36 LUMA methods with AI guidance,
  and training/services [S1][S5]; Freero has facilitation tools but no methods library or services
  (brief).
- **Native apps.** Windows, macOS, iOS, Android and Surface Hub / interactive displays [S9]; Freero
  is a PWA only, view-and-comment on phones (`docs/accessibility.md`).
- **Microsoft ecosystem.** Microsoft 365 Copilot agent, Azure hosting, Microsoft SSPA [S2][S4];
  Freero has no Copilot or Teams app beyond webhook payloads (`docs/events.md`).
- **Certifications and enterprise controls.** SOC 2 Type 2, ISO 27001, ISO 42001, BYOK, data
  classification labels and three hosted residency regions [S4][S5][S8]; Freero has none of these
  (brief).
- **Tracker breadth.** Azure DevOps, Rally, Salesforce, Asana and Planner sync [S5]; Freero covers
  only Jira, Linear and GitHub (`docs/trackers.md`).
- **Template library.** Mural describes "hundreds" of templates [S14]; Freero has 73
  (`apps/web/src/features/templates/lib/catalog/index.ts`). No exact Mural count is published.
- **Maturity and support.** Established enterprise vendor with standard, priority and premier
  support tiers [S1]; Freero is young with no documented support contracts or SLAs (brief).
- **Turnkey hosting.** Nothing to run; Freero is self-hosted unless a hosted offer exists (brief).
- **Built-in AI breadth.** Sentiment classification, guided AI workflows and Copilot integration
  [S2][S5]; Freero has no AI workflows or assistant, and AI is off until an operator configures a
  model (`docs/ai.md`).

## 8. Where Freero is stronger

1. **Open source and self-hostable.** MIT licence (`LICENSE`); run it with `docker compose up`
   anywhere (`README.md` "Run it", `docs/deployment.md`). Mural is proprietary SaaS on Azure [S4].
2. **No plan gates.** Everything is free; limits are operator quotas (`docs/parity.md` §13). Mural's
   Free plan keeps only 3 murals editable and excludes Mural AI; SSO needs Business; SCIM, audit logs
   and residency need Enterprise [S1][S5].
3. **Generally available MCP server with reviewable suggestions.** Freero's MCP server ships on every
   server, with `boards:suggest` on by default and `propose_changes` creating suggestions people
   accept or reject (`docs/mcp.md`). Mural MCP is in public preview and describes direct edits only
   [S3][S5].
4. **Bring your own model, no AI credits.** Anthropic or any OpenAI-compatible endpoint, per operator
   or per workspace; prompts and answers aren't stored (`docs/ai.md`). Mural names no provider and
   offers no BYO-model option, and AI starts at Team+ [S1][S2].
5. **GitHub two-way issue sync and roadmap mode.** Freero syncs GitHub/GitHub Enterprise Server
   issues both ways and imports issues onto a timeline whose bars write dates back
   (`docs/trackers.md`). Mural's GitHub integration centres on PR cards and creating issues [S13].
6. **Webhooks and a stable public API.** HMAC-signed webhooks with retries and a delivery log
   (`docs/events.md`) and `/api/v1` with an OpenAPI spec (`docs/api/openapi.json`). Mural's API is
   labelled beta and no webhooks are documented [S6].
7. **SSO, SCIM and audit log on every install.** Per-workspace SAML/OIDC, SCIM and a hash-chained
   audit log (`docs/configuration.md`, `ARCHITECTURE.md`). Mural needs Business for SSO and
   Enterprise for SCIM and audit logs [S1].
8. **Accessibility target.** Freero targets WCAG 2.1 AA with axe-core runs, full keyboard operation
   and a "Board as list" tree view (`docs/accessibility.md`). Mural states partial WCAG 2.1
   conformance [S11].

## 9. Suggested comparison table

| Capability | Mural | Freero | Sources |
|---|---|---|---|
| Free tier | Partial (3 editable murals, no AI) | Yes (no plan gates) | [S1]; `docs/parity.md` §13 |
| Lowest paid price per seat | Paid ($9.99/mo annual, $12 monthly) | Yes ($0; self-hosted) | [S1]; `README.md` |
| Open source licence | No | Yes (MIT) | [S4]; `LICENSE` |
| Self-hosting | No | Yes | [S4]; `docs/deployment.md` |
| MCP / agent access | Partial (public preview) | Yes | [S3][S5]; `docs/mcp.md` |
| Agent write access with human review (suggestions) | No | Yes | [S3]; `docs/mcp.md` |
| Built-in AI | Paid (Team+) | Partial (needs a configured model; no assistant/workflows) | [S2]; `docs/ai.md` |
| Bring-your-own AI model | No | Yes | [S2]; `docs/ai.md` |
| Jira two-way | Yes (upgraded version Business+) | Yes | [S5][S12]; `docs/trackers.md` |
| Linear two-way | Yes | Yes | [S5][S13]; `docs/trackers.md` |
| GitHub two-way | Partial (PR cards, issue creation) | Yes | [S13]; `docs/trackers.md` |
| REST API | Partial (beta) | Yes | [S6]; `docs/api/openapi.json` |
| Webhooks | No (not documented) | Yes | [S6]; `docs/events.md` |
| SSO (SAML/OIDC) | Paid (Business) | Yes | [S1]; `docs/configuration.md` |
| SCIM | Paid (Enterprise) | Yes | [S1]; `docs/configuration.md` |
| Audit log | Paid (Enterprise) | Yes | [S1]; `ARCHITECTURE.md` |
| Data residency choice | Paid (Enterprise: NA/EU/APAC) | Yes (self-host anywhere; no hosted regions) | [S8]; `docs/deployment.md` |
| Compliance certifications (SOC 2 / ISO 27001) | Yes | No | [S4]; brief "Enterprise / security" |
| Native desktop/mobile apps | Yes | No (PWA) | [S9]; `apps/web/public/manifest.webmanifest` |
| Template library size | Yes ("hundreds") | Partial (73) | [S14]; `apps/web/src/features/templates/lib/catalog/index.ts` |
| App marketplace | Partial (integrations directory and an Integrations SDK; no public app count) | No | [S16]; brief "Developer platform" |
| Accessibility statement / VPAT | Yes (partial WCAG 2.1; ACR) | Partial (WCAG 2.1 AA statement, no VPAT) | [S11]; `docs/accessibility.md` |
| Guest access without account | Partial (view-only on Free; edit on Team+) | Yes | [S1]; `ARCHITECTURE.md` "Guests" |

## 10. Target search keywords

- **free Mural alternative** (primary)
- **open source Mural alternative** (primary)
- **self-hosted Mural alternative** (primary)
- Mural vs Freero
- Mural MCP alternative
- Mural alternative with GitHub integration
- Mural alternative with Linear sync
- Mural alternative for AI agents
- free online workshop whiteboard
- Mural free plan limit alternative
- Mural alternative with SSO free

## 11. Notable timely context

- **Free plan tightened (confirmed by Mural).** From 2026-06-09, Free keeps the three most recent
  murals editable and makes older ones view-only [S5].
- **Mural MCP in public preview.** Paid workspaces from 2026-09-08; Free users from 2026-10-13;
  more OAuth connections (Glean, Figma, Postman and others) on 2026-10-20 [S5].
- **Linear and GitHub integrations launched** 2026-09-08 [S5]; Mural's 2026-09-30 integrations post
  describes them [S13].
- **AI redesign.** Guided-workflow Mural AI shipped 2026-07-21; Copilot agent moved to Microsoft's
  declarative-agent architecture 2026-06-09 [S5].
- **Enterprise additions.** Data classification labels (2026-09-22), multi-IdP SSO/SCIM
  (2026-08-18), Company Insights GA (2026-08-04) [S5].
- **Corporate.** No acquisition, layoff or leadership-change announcement for Mural (Tactivos) was
  found for 2025–2026. Anonymous employee posts mention earlier layoffs, but these are unconfirmed
  and shouldn't be cited [S15]. Note: unrelated companies also named "Mural" (a fintech and a
  biotech) appear in 2026 news; don't confuse them.

## Sources

All checked 2026-10-28.

- [S1] Mural pricing: https://www.mural.co/pricing
- [S2] Mural AI: https://www.mural.co/ai
- [S3] Mural MCP: https://www.mural.co/ai/mcp
- [S4] Mural Trust & security: https://www.mural.co/trust (also https://www.mural.co/security)
- [S5] Mural product release notes (2026 entries): https://www.mural.co/blog/product-release-notes
- [S6] Mural developer hub, public vs enterprise API, OAuth (via search snippets and page): https://developers.mural.co/public/docs/public-vs-enterprise , https://developers.mural.co/public/docs/oauth , https://developers.mural.co/docs/welcome
- [S7] Mural Enterprise API: https://developers.mural.co/enterprise/docs/enterprise-api-vs-mural-api
- [S8] Mural data residency (press release Feb 2022 and blog; regions per search snippet): https://www.mural.co/press-releases/introducing-data-residency , https://www.mural.co/blog/introducing-data-residency
- [S9] Mural apps: https://www.mural.co/apps ; App Store listing: https://apps.apple.com/us/app/mural-visual-collaboration/id1156631145
- [S10] Mural SOC 3 report 2026 (names Tactivos, Inc. d/b/a Mural): https://cdn.prod.website-files.com/62e11362da2667ac3d0e6ed5/6a0bfe3024cefa533985d011_Mural%20-%20SOC%203%20-%202026.pdf
- [S11] Mural accessibility statement: https://www.mural.co/accessibility
- [S12] Mural Jira integration: https://www.mural.co/integrations/jira
- [S13] Mural blog, integrations (2026-09-30): https://www.mural.co/blog/mural-integrations
- [S14] Mural learning, browse the template library ("hundreds of templates"): https://learning.mural.co/lessons/browse-the-template-library
- [S15] Teamblind thread (anonymous, unverified; context only): https://www.teamblind.com/post/mural-layoffs-p4ffqocj
- [S16] Mural integrations directory and Integrations SDK: https://www.mural.co/integrations , https://developers.mural.co/public/docs/integration-sdk

## Could not verify

- Business monthly-billing price (only the annual $17.99 is shown).
- Mural AI credit or usage limits (not published).
- Whether Mural offers webhooks (not found in developer docs; third-party sources disagree).
- Which plans include the Linear and GitHub integrations (GitHub is listed under Business; Linear
  not stated) and whether basic Jira two-way sync exists below Business.
- Current exact residency regions (sources say North America, Europe, Asia-Pacific; the Trust page
  doesn't list them).
- Exact template count.
- Contents/date of Mural's current ACR/VPAT.
- Whether Freero's "hosted service" mentioned in `docs/mcp.md` exists or has a price (brief flags it
  as unconfirmed); this sheet makes no hosted-Freero claim.
