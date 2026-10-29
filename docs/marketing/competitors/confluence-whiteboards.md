# Freero vs Confluence whiteboards — fact sheet

Checked 2026-10-28. Internal research for a future comparison page. Every competitor claim carries a source and a date; Freero claims come only from the repo files named.

## 1. What it is and who it's for

Confluence whiteboards are Atlassian's freeform canvas inside Confluence Cloud, the team wiki and documentation product. They suit teams that already run on Jira and Confluence and want brainstorming and planning next to their pages and Jira work. Stickies and shapes can become Jira work items, existing issues can be pulled in with JQL, and on higher plans "smart" sections and connectors push changes back to Jira. You don't buy whiteboards separately. They come with the Confluence Cloud seat, and the plan sets how many active boards each user may have.

## 2. Pricing as of 2026-10-28

The whiteboard comes with Confluence: "included with Confluence", with capabilities varying by edition (https://www.atlassian.com/software/whiteboards, checked 2026-10-28). The price is the Confluence Cloud seat, in USD, with per-seat prices that fall as user counts rise.

| Plan | Price shown on the page | Monthly billing (list, per user/month) | Annual billing (list) | Whiteboards |
|---|---|---|---|---|
| Free | $0, up to 10 users | — | — | 3 active per user; no board-level permissions; no smart sections or connectors |
| Standard | $5.78/user/month¹ | $7.15 for users 1–100, $5.45 for 101–250, lower above | $720/yr for up to 10 users (≈$6.00/user/month); $7,200/yr for 51–100 | 10 active per user; board permissions |
| Premium | $11.16/user/month¹ | $14.10 for users 1–100, $10.20 for 101–250, lower above | $1,400/yr for up to 10 users (≈$11.67/user/month) | Unlimited active; smart sections and smart connectors |
| Enterprise | Contact sales (annual; listed for 801+ users) | — | Quote | Unlimited active (same as Premium) |

¹ The headline price is the average per-user monthly price for 300 users. The page's structured data gives a reference quantity of 300, and the graduated monthly tiers above average out to these figures. On Free and Standard, boards over the limit become read-only and the newest ones stay active.

- Sources: pricing data embedded in https://www.atlassian.com/software/confluence/pricing (downloaded 2026-10-28; the price plans are labeled "Default, 13-10-2026"); https://support.atlassian.com/confluence-cloud/docs/understand-confluence-whiteboards-plans-and-features/ (checked 2026-10-28).
- **Price change:** Atlassian raised cloud list prices for Confluence Standard, Premium and Enterprise on 2026-10-13 (PT). Trackers report Confluence Standard going from $5.42 to $5.78 and Premium from $10.44 to $11.16. Sources: https://www.atlassian.com/licensing/future-pricing/cloud-pricing/faqs; https://pricingsaas.com/companies/atlassian.confluence/diffs/2026W43 (both checked 2026-10-28).
- **Security add-on:** SSO enforcement, SCIM and the organization audit log come with Atlassian Guard Standard at $4.35 per user/month, billed separately. See section 5. Source: https://www.atlassian.com/software/guard/pricing (checked 2026-10-28).
- Flag: the plan-by-plan feature grid on the pricing page renders client-side and we couldn't read it. The per-plan feature claims below come from Atlassian support pages instead.

## 3. AI and agent capabilities

- **Built-in AI (Rovo):** included on all paid Confluence Cloud plans (Standard, Premium, Enterprise), not on Free. Each plan comes with pooled monthly Rovo credits: 25 per user on Standard, 70 on Premium, 150 on Enterprise. Chat messages and agent or AI invocations use credits; Rovo Search doesn't. Extra usage is $10 per 1,000 credits ($0.01 each), and overage billing starts **2026-12-03**. Extra usage is on by default, but admins can cap it or turn it off. Sources: https://www.atlassian.com/licensing/rovo; https://support.atlassian.com/organization-administration/docs/usage-limits-in-atlassian-intelligence/ (both checked 2026-10-28).
- **Rovo on whiteboards:** can summarize a board (and turn the summary into a page), group selected stickies, and suggest more stickies from one. Source: https://support.atlassian.com/confluence-cloud/docs/atlassian-intelligence-in-confluence-whiteboards/ (checked 2026-10-28, via search).
- **MCP server (official, "Atlassian Rovo MCP Server"):** remote, at `https://mcp.atlassian.com/v1/mcp` and `/v2/mcp`. It authenticates with OAuth 2.1 or optional API tokens and respects users' existing permissions. MCP calls **consume Rovo credits** from the shared pool. Existing v1 connections will switch to v2 tools on 2027-03-01. Source: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/ (checked 2026-10-28).
- **Can MCP reach whiteboards?** Yes, through v2. The general Confluence tools can create a whiteboard, read one and update one, and those tools exist only in MCP v2. Atlassian notes that whiteboard tools need extra domains allowlisted in sandboxed agent environments. An Atlassian Community post is titled "Whiteboards and Databases Are Now Supported in Atlassian MCP v2 and CLI". Search snippets describe this as preview / early access; we couldn't open the post. Sources: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/; https://community.atlassian.com/forums/Confluence-Whiteboards-articles/Whiteboards-and-Databases-Are-Now-Supported-in-Atlassian-MCP-v2/ba-p/3258701 (both checked 2026-10-28).
- **Human review of agent edits:** we found no documented way for an MCP agent to propose whiteboard changes for people to accept or reject. Its updates are direct writes. Source: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/ (checked 2026-10-28).
- **REST API:** Confluence REST v2 can create, get and delete a whiteboard (title, space, parent, template). We found no documented endpoints for reading or writing what's on the board. Source: https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-whiteboard/ (checked 2026-10-28).
- **Webhooks:** Confluence Cloud webhooks are declared by Connect apps, and the event list has no whiteboard events. Atlassian also says new extensibility features ship only on Forge. Source: https://developer.atlassian.com/cloud/confluence/modules/webhook/ (checked 2026-10-28).

## 4. Self-hosting and licensing

- Proprietary and closed source.
- **Whiteboards are Cloud-only.** Atlassian's FAQ says there are currently no plans to bring them to Data Center, and a public request for Data Center whiteboards (CONFSERVER-83249) is still open. Sources: https://www.atlassian.com/software/whiteboards; https://jira.atlassian.com/browse/CONFSERVER-83249 (both checked 2026-10-28).
- **Data Center is being retired.** Confluence and Jira Data Center reach end of life on **2029-03-28**. New-customer license sales ended on 2026-03-30, and sales to existing customers end on 2028-03-30. Atlassian says it may offer extended maintenance by exception, and Bitbucket and Bamboo Data Center aren't affected. Sources: https://www.atlassian.com/migration; https://community.atlassian.com/forums/Atlassian-Migration-Program/Reminder-Upcoming-changes-to-Data-Center-products/ba-p/3210687 (both checked 2026-10-28).
- **Government Cloud** (FedRAMP) has no whiteboards. Source: https://support.atlassian.com/confluence-cloud/docs/what-confluence-whiteboards-dont-support/ (checked 2026-10-28).
- In practice, a team that must keep whiteboard data on its own infrastructure has no Atlassian option.

## 5. Enterprise features

| Feature | Plan | Source (checked 2026-10-28) |
|---|---|---|
| Enforced SSO, SCIM provisioning, organization audit log | Atlassian Guard Standard ($4.35/user/month, separate) | https://www.atlassian.com/software/guard/pricing |
| Data classification, content scanning, SIEM integrations, anomaly detection | Guard Premium ($8.55/user/month) | https://www.atlassian.com/software/guard/pricing |
| Data residency: Australia, Canada, EU, Germany, India, Japan, Singapore, South Korea, Switzerland, UK, US | Standard, Premium, Enterprise | https://support.atlassian.com/security-and-access-policies/docs/understand-data-residency/ |
| SOC 2 reports, ISO 27001 / 27018 (scope varies by product); HIPAA for Confluence Cloud Enterprise | Company / Enterprise | https://www.atlassian.com/trust/compliance/compliance-faq (via search) |
| Whiteboards specifically: SOC 2 and ISO 27001 | — | https://www.atlassian.com/software/whiteboards |
| Accessibility: Confluence Cloud VPAT (WCAG 2.2 AA criteria), updated May 2026 | — | https://www.atlassian.com/accessibility-conformance-reports (via search) |
| **Whiteboards don't support screen readers or keyboard navigation**, backup and restore, or anonymous access | — | https://support.atlassian.com/confluence-cloud/docs/what-confluence-whiteboards-dont-support/ ; https://support.atlassian.com/confluence/kb/share-confluence-cloud-whiteboards-with-external-users/ |

## 6. Integrations relevant to Freero's differentiators

- **Jira (native, deep):** turn stickies and shapes into Jira or Jira Product Discovery work items, or import existing issues with text or JQL. On Premium and Enterprise, smart connectors write issue links back to Jira, and dragging an issue into a smart section applies a Jira action to it (for example, setting a field). Atlassian's marketing calls this a two-way sync. The support docs describe writing from the board to Jira, and we didn't confirm that edits made in Jira update board elements, beyond Jira cards on the board. Smart-section changes can't be undone from the board. **Whiteboards can't link Jira from Data Center sites.** Sources: https://support.atlassian.com/confluence-cloud/docs/create-and-edit-confluence-whiteboards/; https://support.atlassian.com/confluence-cloud/docs/take-bulk-jira-actions-with-smart-sections/; https://support.atlassian.com/confluence-cloud/docs/what-confluence-whiteboards-dont-support/ (all checked 2026-10-28). **Partial (Jira Cloud only; writes to Jira; two-way at field level unconfirmed).**
- **Linear / GitHub:** we found no native whiteboard integration. Links to outside tools appear as Smart Links or embeds. Source: https://www.atlassian.com/software/whiteboards (checked 2026-10-28). **Link/embed only.**

## 7. Where Confluence whiteboards are genuinely stronger than Freero

- **Being where Atlassian teams already work.** Whiteboards sit inside Confluence next to pages, databases and Loom, with Jira one click away and no extra vendor or login.
- **Jira depth for Jira Cloud shops.** JQL import, smart connectors and smart sections are first-party features from the company that makes Jira.
- **AI in the box.** Rovo comes with every paid plan, works across Jira and Confluence, and offers search, chat and agents. Freero has no built-in chat assistant or semantic search, and its AI is off until someone connects a model (`docs/ai.md`).
- **Compliance and residency.** Atlassian offers SOC 2, ISO 27001/27018, HIPAA on Enterprise, hosted data residency in 11 locations, a FedRAMP government cloud and a published VPAT. Freero has no certifications and no hosted regions.
- **Ecosystem and scale.** Atlassian has the Marketplace, Forge, a large installed base and vendor support. Freero has no app marketplace or SDK and no documented SLAs.
- **Low entry price for small teams.** Free covers 10 users, and Standard is about $6–7 per user/month for small teams, with Confluence's docs included.

## 8. Where Freero is stronger (verifiable)

| Freero point | Freero source | Contrast on the Confluence side |
|---|---|---|
| Self-hostable and MIT-licensed, so whiteboards can run on your own infrastructure | `LICENSE`, `README.md`, `docs/deployment.md` | Whiteboards are Cloud-only with no Data Center plans; Data Center reaches end of life 2029-03-28: https://www.atlassian.com/software/whiteboards, https://www.atlassian.com/migration (2026-10-28) |
| Two-way sync with Jira **Data Center/Server** as well as Jira Cloud, Linear, GitHub and GitHub Enterprise Server; field mapping, conflict rules, roadmap import | `docs/trackers.md` | Whiteboards can't link Jira from Data Center sites; no native Linear or GitHub: https://support.atlassian.com/confluence-cloud/docs/what-confluence-whiteboards-dont-support/ (2026-10-28) |
| Keyboard operation of the board and a screen-reader "Board as list" view; WCAG 2.1 AA target | `docs/accessibility.md` | Whiteboards don't support screen readers or keyboard navigation: same Atlassian page (2026-10-28) |
| Agents can propose board changes that people accept or reject; scoped permissions; every tool call audit-logged | `docs/mcp.md` | MCP whiteboard updates are direct writes; no suggestion flow documented: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/ (2026-10-28) |
| No per-call fee for agents or AI; bring your own model | `docs/mcp.md`, `docs/ai.md` | MCP calls and Rovo use metered credits; overage billing starts 2026-12-03: https://support.atlassian.com/organization-administration/docs/usage-limits-in-atlassian-intelligence/ (2026-10-28) |
| Visitors without an account can join shared boards as guests | `ARCHITECTURE.md` ("Guests") | No anonymous access to whiteboards: https://support.atlassian.com/confluence/kb/share-confluence-cloud-whiteboards-with-external-users/ (2026-10-28) |
| REST API covers board items, suggestions and comments; HMAC-signed workspace webhooks | `docs/api/openapi.json`, `docs/events.md` | REST v2 creates, gets and deletes whole whiteboards only; no whiteboard webhook events: https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-whiteboard/, https://developer.atlassian.com/cloud/confluence/modules/webhook/ (2026-10-28) |
| No plan gates: unlimited boards, SSO, SCIM and audit log with no add-on | `docs/parity.md` §13, `docs/configuration.md` | 3 or 10 active boards on Free and Standard; SSO, SCIM and audit log need Guard: support page above; https://www.atlassian.com/software/guard/pricing (2026-10-28) |

## 9. Suggested comparison table

| Capability | Confluence whiteboards | Freero | Sources |
|---|---|---|---|
| Free tier | Yes¹ | Yes | atlassian.com/software/confluence/pricing, support "understand-confluence-whiteboards-plans-and-features"; `docs/parity.md` §13 |
| Price per seat | Paid | No | atlassian.com/software/confluence/pricing; `LICENSE`, `README.md` |
| Open-source licence | No | Yes | atlassian.com/software/whiteboards; `LICENSE` |
| Self-hosting | No | Yes | atlassian.com/software/whiteboards (FAQ: cloud-only); `docs/deployment.md` |
| MCP / agent access | Yes | Yes | support "getting-started-with-the-atlassian-remote-mcp-server"; `docs/mcp.md` |
| Agent access to whiteboards specifically | Partial² | Yes | support "atlassian-rovo-mcp-server/docs/supported-tools"; `docs/mcp.md` |
| Agent write access with human review | No | Yes | support "supported-tools"; `docs/mcp.md` |
| Built-in AI | Paid | Partial³ | atlassian.com/licensing/rovo; `docs/ai.md` |
| Bring your own AI model | No | Yes | atlassian.com/licensing/rovo; `docs/ai.md` |
| Jira / Linear / GitHub two-way sync | Partial⁴ | Yes | support "take-bulk-jira-actions-with-smart-sections", "what-confluence-whiteboards-dont-support"; `docs/trackers.md` |
| REST API covering whiteboards | Partial⁵ | Yes | developer.atlassian.com/cloud/confluence/rest/v2/api-group-whiteboard; `docs/api/openapi.json` |
| Webhooks | No⁶ | Yes | developer.atlassian.com/cloud/confluence/modules/webhook; `docs/events.md` |
| SSO | Paid | Yes | atlassian.com/software/guard/pricing; `docs/configuration.md` |
| SCIM | Paid | Yes | atlassian.com/software/guard/pricing; `docs/configuration.md` |
| Audit log | Paid | Yes | atlassian.com/software/guard/pricing; `ARCHITECTURE.md` |
| Data residency choice | Paid | Partial⁷ | support "understand-data-residency"; `docs/deployment.md` |
| Native apps | No⁸ | No | jira.atlassian.com/browse/CONFCLOUD-79999; `apps/web/public/manifest.webmanifest` |
| Whiteboard facilitation (voting / timer / private mode) | Yes | Yes | support "create-and-edit-confluence-whiteboards"; `README.md` |
| Templates | Yes | Yes | atlassian.com/software/whiteboards; `apps/web/src/features/templates/lib/catalog/index.ts` |
| Guest access | Partial⁹ | Yes | support kb "share-confluence-cloud-whiteboards-with-external-users"; `ARCHITECTURE.md` |
| Accessibility statement | Yes¹⁰ | Yes | atlassian.com/accessibility-conformance-reports; `docs/accessibility.md` |
| Keyboard / screen-reader use of the whiteboard | No | Yes | support "what-confluence-whiteboards-dont-support"; `docs/accessibility.md` |
| Security certifications (SOC 2 / ISO 27001) | Yes | No | atlassian.com/software/whiteboards (FAQ); brief "Honest gaps" |

Notes: ¹ Up to 10 users, 3 active boards per user. ² Through general Confluence tools in MCP v2 only, which Atlassian's community post presents as preview or early access; calls use Rovo credits. ³ Freero's AI is off until a model is connected, and it has no chat assistant. ⁴ Native and deep for Jira Cloud, but writes go from the board to Jira; no Jira Data Center, Linear or GitHub. ⁵ Create, get and delete a whiteboard; no content endpoints found. ⁶ No whiteboard webhook events. ⁷ Freero runs in whatever region you host it; there's no hosted region choice. ⁸ An open Atlassian ticket says the native mobile app can't show whiteboards; we didn't check whether that has changed. ⁹ Account-holding guests (up to 5 per paid user, one space) and public links; no anonymous access. ¹⁰ Atlassian publishes Confluence VPATs, but whiteboards are excluded from screen-reader and keyboard support. All Confluence sources checked 2026-10-28.

## 10. Target search keywords

- **Confluence whiteboard alternative** (primary)
- **Confluence whiteboards Data Center** / **self-hosted alternative to Confluence whiteboards** (primary)
- **Freero vs Confluence whiteboards** (primary)
- Confluence whiteboards limit / active whiteboards limit
- Confluence whiteboards Jira Data Center
- Confluence whiteboard Linear / GitHub integration
- Atlassian Data Center end of life whiteboard
- on-premise whiteboard Jira
- accessible whiteboard keyboard screen reader
- Rovo whiteboard MCP

## 11. Notable timely context

- **2026-10-13:** Atlassian cloud list-price increase on Confluence Standard, Premium and Enterprise. Trackers report Confluence Standard up about 7%, from $5.42 to $5.78. Sources: https://www.atlassian.com/licensing/future-pricing/cloud-pricing/faqs (confirmed); https://pricingsaas.com/companies/atlassian.confluence/diffs/2026W43 (reported); both checked 2026-10-28.
- **2026-12-03:** extra-usage billing for Rovo credits begins, at $10 per 1,000 credits; it is on by default unless admins cap it. Source: https://support.atlassian.com/organization-administration/docs/usage-limits-in-atlassian-intelligence/ (checked 2026-10-28).
- **2027-03-01:** Atlassian MCP v1 connections move to v2 tools automatically. Source: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/ (checked 2026-10-28).
- **Data Center end of life:** no new-customer licenses since 2026-03-30; no sales to existing customers after 2028-03-30; end of life on 2029-03-28. Source: https://www.atlassian.com/migration (checked 2026-10-28).
- **Whiteboards in MCP v2 / CLI:** announced on the Atlassian Community; reported as early access. Source: https://community.atlassian.com/forums/Confluence-Whiteboards-articles/Whiteboards-and-Databases-Are-Now-Supported-in-Atlassian-MCP-v2/ba-p/3258701 (title only; checked 2026-10-28).

## Sources

- https://www.atlassian.com/software/confluence/pricing — page data downloaded 2026-10-28
- https://www.atlassian.com/software/whiteboards — checked 2026-10-28
- https://support.atlassian.com/confluence-cloud/docs/understand-confluence-whiteboards-plans-and-features/ — checked 2026-10-28
- https://support.atlassian.com/confluence-cloud/docs/what-confluence-whiteboards-dont-support/ — checked 2026-10-28
- https://support.atlassian.com/confluence-cloud/docs/create-and-edit-confluence-whiteboards/ — checked 2026-10-28
- https://support.atlassian.com/confluence-cloud/docs/take-bulk-jira-actions-with-smart-sections/ — checked 2026-10-28 (via search)
- https://support.atlassian.com/confluence-cloud/docs/atlassian-intelligence-in-confluence-whiteboards/ — checked 2026-10-28 (via search)
- https://support.atlassian.com/confluence/kb/share-confluence-cloud-whiteboards-with-external-users/ — checked 2026-10-28 (via search)
- https://www.atlassian.com/licensing/rovo — checked 2026-10-28
- https://support.atlassian.com/organization-administration/docs/usage-limits-in-atlassian-intelligence/ — checked 2026-10-28
- https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/ — checked 2026-10-28
- https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/ — checked 2026-10-28
- https://community.atlassian.com/forums/Confluence-Whiteboards-articles/Whiteboards-and-Databases-Are-Now-Supported-in-Atlassian-MCP-v2/ba-p/3258701 — title only, 2026-10-28
- https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-whiteboard/ — checked 2026-10-28
- https://developer.atlassian.com/cloud/confluence/modules/webhook/ — checked 2026-10-28
- https://www.atlassian.com/software/guard/pricing — checked 2026-10-28
- https://support.atlassian.com/security-and-access-policies/docs/understand-data-residency/ — checked 2026-10-28
- https://www.atlassian.com/trust/compliance/compliance-faq — checked 2026-10-28 (via search)
- https://www.atlassian.com/accessibility-conformance-reports — checked 2026-10-28 (via search)
- https://www.atlassian.com/migration — checked 2026-10-28
- https://community.atlassian.com/forums/Atlassian-Migration-Program/Reminder-Upcoming-changes-to-Data-Center-products/ba-p/3210687 — checked 2026-10-28
- https://www.atlassian.com/licensing/future-pricing/cloud-pricing/faqs — checked 2026-10-28
- https://pricingsaas.com/companies/atlassian.confluence/diffs/2026W43 — third-party, checked 2026-10-28
- https://jira.atlassian.com/browse/CONFSERVER-83249 and https://jira.atlassian.com/browse/CONFCLOUD-79999 — checked 2026-10-28 (via search)

## Could not verify

- Whether whiteboard support in MCP v2 is generally available or still early access (we could only see the community post's title).
- Whether Jira-side edits flow back into whiteboard elements, which would make the Jira link truly two-way.
- Whether Atlassian Guard Standard is bundled into Confluence Enterprise.
- Whether Rovo whiteboard features are on every paid plan or only Premium and up; Atlassian's pages disagree.
- Whether native Confluence mobile apps now show or edit whiteboards.
- Guest availability on the Free plan.
