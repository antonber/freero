# Freero vs Notion — fact sheet

Checked 2026-10-28. Internal research for a future comparison page. Every competitor claim carries a source and a date; Freero claims come only from the repo files named.

**Headline: as of 2026-10-28, Notion still has no native whiteboard or infinite canvas.** Notion's release notes through 2026-10-19 (Notion 3.6 to 3.8 and later updates) announce no whiteboard, canvas or drawing feature. Notion's embed help article names Miro, Excalidraw and Canva as things to embed, and independent guides from 2026 still describe embedding as the way to get a whiteboard in Notion. The closest native features are page presentations (March 2026), agent-built interactive HTML blocks (July 2026) and Mermaid diagrams in code blocks, which only third-party guides document. None of them is a collaborative canvas. Sources: https://www.notion.com/releases; https://www.notion.com/releases/2026-07-01; https://www.notion.com/releases/2026-03-02; https://www.notion.com/help/embed-and-connect-other-apps; https://mockflow.com/blog/notion-whiteboard (all checked 2026-10-28).

## 1. What it is and who it's for

Notion is an all-in-one workspace for docs, wikis, databases and projects, and more and more for AI agents: Notion Agent, Custom Agents, Workers, AI meeting notes and Notion Mail/Calendar. It suits teams that want one flexible, block-based place for their writing and structured work. Notion has no visual canvas, so teams that need one usually embed a third-party board (Miro, Excalidraw, Whimsical, Canva and similar) in a Notion page. The comparison is therefore "Notion plus an embedded whiteboard" against Freero, not whiteboard against whiteboard.

## 2. Pricing as of 2026-10-28

Notion sells seats per member, in USD. There's no whiteboard to price, and teams usually pay for a separate whiteboard tool on top.

| Plan | Annual billing (per member/month) | Monthly billing (per member/month) | Notion AI |
|---|---|---|---|
| Free | $0 | $0 | Limited trial |
| Plus | $10 ($120/yr) | $12 | Notion Agent and meeting notes: limited trial |
| Business | $20 ($240/yr) | $24 | Notion Agent, AI meeting notes, Enterprise Search (beta); 1,500 Standard + 500 Select credits per seat/month under the new credit system |
| Enterprise | Custom (contact sales) | Custom | Business features plus zero data retention with LLM providers |

- Sources: https://www.notion.com/pricing (displayed prices, plus the price list embedded in the page: Plus $12 monthly / $120 yearly, Business $24 monthly / $240 yearly; downloaded 2026-10-28); https://www.notion.com/blog/notion-ai-more-for-less (credits; checked 2026-10-28).
- **Free plan limits:** a multi-member Free workspace has a block limit (the number isn't published on the page). Other limits are 5 MB per file upload, 7-day page history and an external guest limit of 10 (which plan the 10 belongs to wasn't clear in the page text). Sources: https://www.notion.com/pricing; https://www.notion.com/guides/plans-and-pricing (both checked 2026-10-28).
- **Notion credits:** Custom Agents and Workers run on credits at $10 per 1,000. Source: https://www.notion.com/pricing (checked 2026-10-28).
- Flag: the page's embedded price list includes an Enterprise line item, but the page shows Enterprise as custom, so we treat it as custom.

## 3. AI and agent capabilities

- **Built-in AI:** Notion Agent (chat, generate, autofill, translate), Custom Agents, Workers (custom code), AI meeting notes and Enterprise Search. Full use needs Business or Enterprise. Source: https://www.notion.com/pricing (checked 2026-10-28).
- **New credit system (2026-10-19):** all AI usage moves to credits. Business and Enterprise seats get 1,500 Standard and 500 Select credits a month, and admins can buy more. It applies to new customers now and to existing customers from 2026-11-02. A new "Auto" model router is said to make credits go about 10 times further. Sources: https://www.notion.com/releases/2026-10-19; https://www.notion.com/blog/notion-ai-more-for-less (both checked 2026-10-28).
- **Bring your own AI:** members can connect a ChatGPT Plus, Pro or Go subscription to their personal Notion Agent; Notion 3.8 lists this for Business and Enterprise. Bring-your-own-key is in private alpha for Enterprise. Sources: https://www.notion.com/releases/2026-10-13; https://www.notion.com/releases/2026-10-19 (both checked 2026-10-28).
- **MCP server (official, hosted by Notion):** `https://mcp.notion.com/mcp` (Streamable HTTP; SSE fallback). It uses OAuth sign-in and works on every plan. Tokens that skip browser sign-in need Business or Enterprise, and limits are higher on those plans. The tools search, read, create and update pages, databases, comments and calendars, and include **suggested edits that people resolve** (`notion-create-suggested-edit`). The tool list has no drawing, canvas or whiteboard tool. Sources: https://developers.notion.com/guides/mcp/get-started-with-mcp; https://developers.notion.com/guides/mcp/mcp-supported-tools.md (both checked 2026-10-28).
- **Outside agents inside Notion:** Notion 3.6 added "External Agents" (Claude and Cursor first) that can be assigned tasks and @-mentioned, plus MCP connections for Custom Agents, including **Miro**. Notion 3.8 added admin visibility and per-person revocation for connected AI tools. Sources: https://www.notion.com/releases/2026-07-01; https://www.notion.com/releases/2026-10-13 (both checked 2026-10-28).
- **Public API:** a REST API for pages, databases and blocks, with webhooks for page, comment and data-source events. Source: https://developers.notion.com/reference/webhooks (checked 2026-10-28).
- **Can outside agents act on whiteboards?** Notion has no whiteboards. An agent can edit a whiteboard embedded in Notion only through that whiteboard vendor's own API or MCP (for example Miro's), not through Notion.

## 4. Self-hosting and licensing

Proprietary and closed source, sold only as SaaS. We found no on-premises or self-hosted edition. Hosted data residency is available on Enterprise (section 5). Sources: https://www.notion.com/security; https://www.notion.com/help/data-residency (both checked 2026-10-28).

## 5. Enterprise features

| Feature | Plan | Source (checked 2026-10-28) |
|---|---|---|
| SAML SSO | Business and Enterprise | https://www.notion.com/pricing |
| SCIM provisioning | Enterprise | https://www.notion.com/pricing |
| Audit log (plus SIEM/DLP connections) | Enterprise | https://www.notion.com/pricing |
| Data residency: US (Oregon), EU (Frankfurt), Japan (Tokyo), South Korea (Seoul); Calendar, Mail and beta features excluded | Enterprise (no extra charge) | https://www.notion.com/help/data-residency |
| Certifications / audits: SOC 2, ISO 27001, ISO 27701, ISO 27018, ISMAP, BSI C5; HIPAA through a BAA on Enterprise | Company / Enterprise | https://www.notion.com/security |
| Encryption: TLS 1.2+ in transit, AES-256 at rest | All | https://www.notion.com/security |
| Zero data retention with LLM providers | Enterprise | https://www.notion.com/pricing |
| Accessibility statement / VPAT | Not found publicly (notion.com/accessibility redirected to a sign-in-gated app URL). Notion shipped a high-contrast mode on 2026-07-30 | https://www.notion.com/releases |

## 6. Integrations relevant to Freero's differentiators

- **Jira / GitHub (synced databases):** the original synced databases for Jira, GitHub, Asana and GitLab are **one-way** into Notion, need Business or Enterprise, and **stop updating on 2026-10-30**. Notion 3.8 (2026-10-13) rebuilt synced databases starting with GitHub, Jira and Salesforce, but the release note doesn't say which way they sync. A third-party write-up reports two-way Jira sync on Enterprise since late 2025 (not every field editable). Sources: https://www.notion.com/help/synced-databases; https://www.notion.com/releases/2026-10-13; https://matthiasfrank.de/en/notion-updates/enhanced-jira-integration-two-way-sync/ (all checked 2026-10-28). **Partial**, and it lives in databases, not on a whiteboard.
- **Linear:** we found no native sync in the sources checked; not verified.
- **Whiteboard tools:** embeds (Miro, Excalidraw and Canva are named in the help article; Whimsical has a Notion connection page) and a Miro MCP connection for Custom Agents. Sources: https://www.notion.com/help/embed-and-connect-other-apps; https://www.notion.com/integrations/whimsical; https://www.notion.com/releases/2026-07-01 (all checked 2026-10-28). **Embed only.**

## 7. Where Notion is genuinely stronger than Freero

- **All-in-one workspace.** Docs, wikis, databases, projects, meeting notes, Mail and Calendar live in one product. Freero is a whiteboard only.
- **Being where the team already works.** For Notion-centered teams, notes, specs and decisions are already there.
- **AI and agent depth.** Notion has a chat agent, Custom Agents, Workers, meeting notes, enterprise search across connected sources, sub-agents and skills, plus a model router and a choice of models. Freero has no chat assistant, AI workflows or semantic search, and its AI is off until a model is connected (`docs/ai.md`).
- **A mature MCP with human review.** Notion's MCP already offers suggested edits that people resolve, for pages, which is the same idea as Freero's `propose_changes`. Notion also lets outside agents like Claude and Cursor take assigned tasks inside Notion.
- **Native apps** for Mac, Windows and mobile (https://www.notion.com/desktop, checked 2026-10-28). Freero is a PWA only.
- **Templates and community.** The gallery advertises 30,000+ templates (https://www.notion.com/templates, checked 2026-10-28). Freero has 73 built-in templates and no community gallery.
- **Compliance and residency.** SOC 2, several ISO certifications, ISMAP, BSI C5, HIPAA BAA and hosted residency in four regions. Freero has no certifications and no hosted regions.
- **Scale and brand.** Notion has a very large user base and ecosystem; Freero is a young project.

## 8. Where Freero is stronger (verifiable)

| Freero point | Freero source | Contrast on the Notion side |
|---|---|---|
| A real collaborative whiteboard: infinite canvas, stickies, shapes, connectors, pen, frames, mind maps, kanban, tables, diagrams | `README.md` | No native whiteboard; embeds instead: https://www.notion.com/releases, https://www.notion.com/help/embed-and-connect-other-apps (2026-10-28) |
| Agents can work on the board itself: outline, stickies, clusters, Mermaid-to-diagram, update, export, propose changes for review | `docs/mcp.md` | Notion MCP has no canvas or whiteboard tools: https://developers.notion.com/guides/mcp/mcp-supported-tools.md (2026-10-28) |
| Facilitation: voting, shared timer, presentation mode, private mode, polls, word clouds, planning poker | `README.md`, `apps/web/src/features/engage`, `apps/web/src/features/estimation` | Not a canvas tool; Notion presents pages as slides (Plus and up): https://www.notion.com/releases/2026-03-02 (2026-10-28) |
| Two-way sync with Jira (Cloud and Data Center), Linear, GitHub/GHES from board items; roadmap import with dates written back | `docs/trackers.md` | Legacy synced databases are one-way and stop updating 2026-10-30; the direction of the rebuilt sync isn't stated: https://www.notion.com/help/synced-databases, https://www.notion.com/releases/2026-10-13 (2026-10-28) |
| MIT-licensed and self-hostable | `LICENSE`, `README.md`, `docs/deployment.md` | SaaS only: https://www.notion.com/security (2026-10-28) |
| Bring any model (Anthropic, OpenAI-compatible, Ollama, vLLM) at operator or workspace level; no credits sold; Freero doesn't store prompts or answers | `docs/ai.md` | AI runs on Notion credits; ChatGPT-subscription use covers the personal agent only; BYOK is Enterprise alpha: https://www.notion.com/blog/notion-ai-more-for-less (2026-10-28) |
| No plan gates: SSO, SCIM and audit log available to every self-hosted workspace | `docs/configuration.md`, `docs/parity.md` §13 | SAML on Business; SCIM and audit log on Enterprise: https://www.notion.com/pricing (2026-10-28) |
| Published accessibility doc: WCAG 2.1 AA target, keyboard board operation, screen-reader list view | `docs/accessibility.md` | No public accessibility statement or VPAT found (2026-10-28) |

## 9. Suggested comparison table

Rows marked "whiteboard" compare Notion's (absent) native whiteboard; embedding a third-party board brings that vendor's capabilities and price instead.

| Capability | Notion | Freero | Sources |
|---|---|---|---|
| Native whiteboard / infinite canvas | No | Yes | notion.com/releases, notion.com/help/embed-and-connect-other-apps; `README.md` |
| Free tier | Yes¹ | Yes | notion.com/pricing; `docs/parity.md` §13 |
| Price per seat | Paid | No | notion.com/pricing; `LICENSE`, `README.md` |
| Open-source licence | No | Yes | notion.com/security; `LICENSE` |
| Self-hosting | No | Yes | notion.com/security; `docs/deployment.md` |
| MCP / agent access | Yes | Yes | developers.notion.com/guides/mcp/get-started-with-mcp; `docs/mcp.md` |
| Agent access to whiteboards specifically | No | Yes | developers.notion.com/guides/mcp/mcp-supported-tools.md; `docs/mcp.md` |
| Agent write access with human review | Yes² | Yes | developers.notion.com/guides/mcp/mcp-supported-tools.md; `docs/mcp.md` |
| Built-in AI | Paid | Partial³ | notion.com/pricing; `docs/ai.md` |
| Bring your own AI model | Partial⁴ | Yes | notion.com/releases/2026-10-19; `docs/ai.md` |
| Jira / Linear / GitHub two-way sync | Partial⁵ | Yes | notion.com/help/synced-databases, notion.com/releases/2026-10-13; `docs/trackers.md` |
| REST API covering whiteboards | No | Yes | developers.notion.com (no whiteboard object); `docs/api/openapi.json` |
| Webhooks | Yes | Yes | developers.notion.com/reference/webhooks; `docs/events.md` |
| SSO | Paid | Yes | notion.com/pricing; `docs/configuration.md` |
| SCIM | Paid | Yes | notion.com/pricing; `docs/configuration.md` |
| Audit log | Paid | Yes | notion.com/pricing; `ARCHITECTURE.md` |
| Data residency choice | Paid | Partial⁶ | notion.com/help/data-residency; `docs/deployment.md` |
| Native apps | Yes | No | notion.com/desktop; `apps/web/public/manifest.webmanifest` |
| Whiteboard facilitation (voting / timer / private mode) | No | Yes | notion.com/releases; `README.md` |
| Templates | Yes | Yes | notion.com/templates; `apps/web/src/features/templates/lib/catalog/index.ts` |
| Guest access | Yes | Yes | notion.com/pricing; `ARCHITECTURE.md` ("Guests") |
| Accessibility statement | No⁷ | Yes | notion.com/accessibility (sign-in gated); `docs/accessibility.md` |
| Security certifications (SOC 2 / ISO 27001) | Yes | No | notion.com/security; brief "Honest gaps" |

Notes: ¹ Multi-member Free workspaces have a block limit, 5 MB uploads and 7-day history. ² Suggested edits on Notion pages through MCP; there's no whiteboard. ³ Freero's AI is off until a model is connected, and it has no chat assistant. ⁴ ChatGPT subscription for the personal Notion Agent on Business and Enterprise; BYOK is Enterprise alpha. ⁵ Legacy Jira/GitHub syncs are one-way and end 2026-10-30; the rebuilt syncs' direction isn't stated; two-way Jira on Enterprise is reported by a third party; no native Linear found. ⁶ Freero runs in whatever region you host it; there's no hosted region choice. ⁷ No public statement or VPAT found; this may exist behind sign-in. All Notion sources checked 2026-10-28.

## 10. Target search keywords

- **Notion whiteboard** (primary)
- **whiteboard for Notion** (primary)
- **Notion canvas alternative** (primary)
- does Notion have a whiteboard
- Notion infinite canvas
- Notion Miro alternative / Miro embed Notion alternative
- Notion Excalidraw alternative
- open source whiteboard for Notion users
- AI agent whiteboard MCP (Notion MCP alternative for diagrams)
- Notion brainstorming board
- Freero vs Notion

## 11. Notable timely context

- **2026-10-30:** Notion's legacy synced databases (Jira, GitHub, Asana, GitLab) stop updating; teams have to move to the rebuilt syncs. Source: https://www.notion.com/help/synced-databases (checked 2026-10-28).
- **2026-10-19 / 2026-11-02:** new AI credit system with included credits on Business and Enterprise seats, an Auto model router and ChatGPT-subscription use. Existing customers move over on 2026-11-02. Sources: https://www.notion.com/releases/2026-10-19; https://www.notion.com/blog/notion-ai-more-for-less (checked 2026-10-28).
- **2026-10-13, Notion 3.8:** MCP connections for outside agents with admin controls; rebuilt synced databases (GitHub, Jira, Salesforce). Source: https://www.notion.com/releases/2026-10-13 (checked 2026-10-28).
- **2026-07-01, Notion 3.6:** External Agents (Claude, Cursor), agent-built HTML blocks, and a Miro MCP connection for Custom Agents. Still no whiteboard. Source: https://www.notion.com/releases/2026-07-01 (checked 2026-10-28).
- **2026-05-13 (reported):** Developer Platform and Workers launched in beta; Workers billing in credits from 2026-08-11. Sources: https://www.notion.com/help/understand-pricing-for-workers; https://www.createwith.com/tool/notion/updates/notion-launches-workers-for-custom-code-database-sync-and-two-way-webhooks (checked 2026-10-28, via search).
- **Whiteboard status:** no native whiteboard announced as of the 2026-10-19 release notes. A third-party page (whiteboardhq.com) claims a Notion whiteboard launched in 2024; it isn't a Notion source and Notion's materials don't back it up. Sources: https://www.notion.com/releases; https://whiteboardhq.com/notion-whiteboard (checked 2026-10-28).

## Sources

- https://www.notion.com/pricing — displayed and embedded price data, 2026-10-28
- https://www.notion.com/guides/plans-and-pricing — checked 2026-10-28
- https://www.notion.com/releases — checked 2026-10-28
- https://www.notion.com/releases/2026-10-19 — checked 2026-10-28
- https://www.notion.com/releases/2026-10-13 — checked 2026-10-28
- https://www.notion.com/releases/2026-07-01 — checked 2026-10-28
- https://www.notion.com/releases/2026-03-02 — checked 2026-10-28
- https://www.notion.com/blog/notion-ai-more-for-less — checked 2026-10-28
- https://www.notion.com/help/synced-databases — checked 2026-10-28
- https://www.notion.com/help/embed-and-connect-other-apps — checked 2026-10-28
- https://www.notion.com/help/data-residency — checked 2026-10-28
- https://www.notion.com/help/understand-pricing-for-workers — checked 2026-10-28 (via search)
- https://www.notion.com/security — checked 2026-10-28
- https://www.notion.com/desktop — checked 2026-10-28
- https://www.notion.com/templates — checked 2026-10-28
- https://www.notion.com/integrations/whimsical — checked 2026-10-28 (via search)
- https://developers.notion.com/docs/mcp — checked 2026-10-28
- https://developers.notion.com/guides/mcp/get-started-with-mcp — checked 2026-10-28
- https://developers.notion.com/guides/mcp/mcp-supported-tools.md — checked 2026-10-28
- https://developers.notion.com/reference/webhooks — checked 2026-10-28
- https://mockflow.com/blog/notion-whiteboard — third-party (Aug 2026), checked 2026-10-28
- https://matthiasfrank.de/en/notion-updates/enhanced-jira-integration-two-way-sync/ — third-party, checked 2026-10-28 (via search)
- https://whiteboardhq.com/notion-whiteboard — third-party claim, checked 2026-10-28

## Could not verify

- Whether Notion's rebuilt Jira and GitHub synced databases (3.8) are two-way, and on which plans.
- Free-plan guest limit by plan (the "10" couldn't be tied to a plan) and the Free block-limit number.
- Whether Notion publishes an accessibility statement or VPAT (the URL is sign-in gated).
- Mermaid diagram support in code blocks, which only third-party guides document.
- Any native Linear integration.
- Enterprise list price (the page shows custom).
