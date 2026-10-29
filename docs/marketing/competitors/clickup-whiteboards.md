# Freero vs ClickUp Whiteboards — fact sheet

Checked 2026-10-28. Internal research for a future comparison page. Every competitor claim carries a source and a date; Freero claims come only from the repo files named.

## 1. What it is and who it's for

ClickUp Whiteboards is the infinite-canvas view inside ClickUp, an all-in-one work platform that combines tasks, docs, chat, dashboards and AI in one subscription. It suits teams that already plan and track their work in ClickUp and want brainstorms, process maps and flowcharts sitting next to their tasks: any sticky or shape can become a ClickUp task, and live tasks and docs can be placed on the board. You don't buy the whiteboard on its own. It comes with the ClickUp seat, and the plan decides how many whiteboards you can have.

## 2. Pricing as of 2026-10-28

The whiteboard comes with ClickUp, so the price is the ClickUp seat. Prices are in USD (the page shows "$" and doesn't name the currency).

What clickup.com/pricing showed on 2026-10-28 (checked 2026-10-28):

| Plan | Annual billing (per user/month) | Monthly billing (per user/month) | Whiteboards | AI credits included |
|---|---|---|---|---|
| Free Forever | $0 | $0 | 3 max; no private whiteboards | 500 per workspace (trial) |
| Core | $9 | $12 ("regular price"; reported as the monthly rate) | 10 max; no private whiteboards | 1,000 per user/month, pooled |
| Business | $17 | $25 (reported) | Unlimited; private whiteboards included | 1,500 per user/month, pooled |
| Enterprise | Custom | Custom | Unlimited; private whiteboards included | 3,000 per user/month, pooled |
| Max | $100 | $120 (reported) | Unlimited; private whiteboards included | 10,000 per user/month, pooled |

- Extra AI: "AI Super Credits" at $10 per 10,000 credits, with optional auto top-up. "Certified Agents" are an add-on on Enterprise and Max, priced by quote. Source: https://clickup.com/pricing (checked 2026-10-28).
- Guests: unlimited members and guests on Free, but Free guests always get full edit rights. Core includes 5 guest seats for a one-seat workspace plus 2 per extra paid seat. Business includes 10 plus 5 per extra paid seat. Read-only guests are unlimited on paid plans. Source: https://clickup.com/pricing (checked 2026-10-28).
- **Flag: the price grid looks like a live A/B test.** Pricing trackers say that since about 2026-10-15 the pricing page shows either this Core/Business/Max grid or the older one, depending on the visitor. The older grid was Unlimited at $7 a year / $10 a month and Business at $12 / $19, with AI sold separately: Brain AI at about $9 per user/month annually and Everything AI at about $28. These numbers are reported, not confirmed by ClickUp. Sources: https://www.usagepricing.com/blueprint/activity/clickup-2026-10-15-core-max-plans-test (checked 2026-10-28); https://pricingsaas.com/companies/clickup/diffs/2026W43 (reported Core moving from $8 to $9 annually between 2026-10-12 and 10-19; checked 2026-10-28).
- Couldn't confirm: the monthly prices from ClickUp's own page, because only the annual figures were readable. We also don't know which grid a given visitor sees.

## 3. AI and agent capabilities

- **Built-in AI (ClickUp Brain):** on whiteboards, Brain turns text, SOPs, docs or project data into flowcharts and process maps you can edit. ClickUp also says its "Super Agents" can redraw process maps when a workflow changes. Source: https://clickup.com/features/whiteboard (checked 2026-10-28).
- **AI pricing:** in the grid shown on 2026-10-28, every plan includes pooled AI credits (table above) and extra credits cost $10 per 10K. In the legacy grid, AI was a per-seat add-on (reported). Sources: https://clickup.com/pricing; https://www.usagepricing.com/blueprint/activity/clickup-2026-10-15-core-max-plans-test (both checked 2026-10-28).
- **MCP server (official):** hosted at `https://mcp.clickup.com/mcp`, OAuth only (OAuth 2.1 + PKCE for custom clients), available on all plans. Daily call limits depend on the plan, from 100 calls per rolling 24 hours on Free Forever up to 25,000 on Enterprise Plus. ClickUp deliberately ships no delete tools. Source: https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server (checked 2026-10-28).
- **Can MCP reach whiteboards?** No. The 65 documented tools cover tasks, lists, folders, docs, comments, chat, time tracking, reminders and search. None of them creates, reads or edits a whiteboard. The search tool's overview mentions whiteboards among the things it can find, but its detailed description doesn't. Source: https://developer.clickup.com/docs/mcp-tools (checked 2026-10-28).
- **Public API:** a REST API with personal tokens or OAuth 2.0, plus webhooks. An independent API review (last verified October 2026) says whiteboards and dashboards have no API, which makes them hard to back up or migrate except by manual export. We didn't find whiteboard endpoints in ClickUp's own docs. Sources: https://developer.clickup.com/docs/Getting%20Started; https://supergood.ai/api-report-card/clickup (both checked 2026-10-28).
- **Can outside agents act on whiteboards?** Not through any documented ClickUp API or MCP tool as of 2026-10-28. Agents can create and update tasks, and tasks can be shown on a whiteboard.

## 4. Self-hosting and licensing

Proprietary and closed source, sold only as SaaS. We found no on-premises or self-hosted edition. Instead, ClickUp offers hosted data residency in the US, EU and APAC on Enterprise. Sources: https://clickup.com/pricing; https://clickup.com/security (both checked 2026-10-28).

## 5. Enterprise features

| Feature | Plan | Source (checked 2026-10-28) |
|---|---|---|
| Google SSO | Business and up | https://clickup.com/pricing |
| Microsoft / Okta / SAML SSO | Enterprise, Max | https://clickup.com/pricing |
| SCIM provisioning | Enterprise, Max | https://clickup.com/pricing |
| Audit trails, session management | Enterprise, Max | https://clickup.com/pricing |
| Data residency: US, EU, APAC (AWS US, Ireland, Australia, Singapore) | Enterprise, Max | https://clickup.com/pricing; https://clickup.com/security |
| HIPAA | Enterprise, Max | https://clickup.com/pricing |
| Certifications: SOC 1 Type 2, SOC 2 Type 2, SOC 3; ISO 27001:2022, 27017, 27018, 27701; ISO 42001 (AI management); PCI; GDPR | Company-wide | https://clickup.com/security |
| Encryption: TLS 1.2 in transit, AES-256 at rest | All | https://clickup.com/security |
| Accessibility: aims for WCAG 2.2 AA over several years (an FAQ on the same page mentions WCAG 2.0); VPAT on request | — | https://clickup.com/accessibility |

## 6. Integrations relevant to Freero's differentiators

- **Jira:** ClickUp has a native "Jira Sync". It creates ClickUp tasks from Jira issues, and ClickUp says it updates Jira when the ClickUp work is finished. The page doesn't say the sync is fully two-way, and we couldn't open the help article to check field-level direction. The sync works at task level, not from the whiteboard. Third parties (Unito, Getint) sell full two-way sync. Sources: https://clickup.com/integrations/jira; https://help.clickup.com/hc/en-us/articles/26324629158423-Jira-Sync-integration (403 when fetched); https://unito.io/integrations/clickup-jira/ (all checked 2026-10-28). **Partial.**
- **GitHub:** links commits, branches and pull requests to tasks when the task ID appears in them, and can move a task's status from a commit or PR message. It doesn't sync GitHub issues into tasks. Source: https://clickup.com/integrations/github (checked 2026-10-28). **Link only, one-way (GitHub → ClickUp).**
- **Linear:** we found no native integration, only third-party connectors (Unito, Zapier). Sources: https://unito.io/integrations/clickup-linear/; https://zapier.com/apps/linear/integrations/clickup (checked 2026-10-28). **No (native).**
- **On the whiteboard itself:** a sticky or shape becomes a *ClickUp* task, not a Jira, Linear or GitHub issue. Source: https://clickup.com/features/whiteboard (checked 2026-10-28).

## 7. Where ClickUp is genuinely stronger than Freero

- **All-in-one platform.** Tasks, docs, chat, dashboards, time tracking and whiteboards share one workspace, and stickies become real tasks without an integration. Freero is a whiteboard that syncs to trackers. It has no task system or docs product of its own beyond board items.
- **Being where the team already works.** For a team already on ClickUp, the whiteboard adds no extra tool, login or vendor.
- **AI depth and packaging.** Brain is built in with credits on every plan, generates flowcharts from workspace data and runs agents across ClickUp. Freero has no built-in chat assistant, AI workflows or semantic search, and its AI is off until an operator connects a model (`docs/ai.md`; brief "Honest gaps").
- **Native apps.** ClickUp offers iOS, Android, Mac and Windows downloads (https://clickup.com/pricing, download menu, checked 2026-10-28). Freero is a PWA only.
- **Certifications and compliance.** ClickUp holds SOC 1/2/3, five ISO certifications and HIPAA on Enterprise. Freero has no compliance certifications.
- **Hosted data residency** in three regions, with no servers to run. Freero has no hosted multi-region offer.
- **Scale, support and ecosystem.** ClickUp has a large user base, a mature vendor and a broad integration catalog. Freero is a young project with no documented support contracts or SLAs.

## 8. Where Freero is stronger (verifiable)

| Freero point | Freero source | Contrast on the ClickUp side |
|---|---|---|
| Agents can read and edit whiteboards: a built-in MCP server with board tools (outline, stickies, clusters, diagrams, comments, updates, export) | `docs/mcp.md` | None of ClickUp's 65 MCP tools work on whiteboards: https://developer.clickup.com/docs/mcp-tools (2026-10-28) |
| Agents can propose changes that people accept or reject (`propose_changes`, `boards:suggest` scope on by default), and agents are visible on the board | `docs/mcp.md` | No whiteboard agent access, so no review flow for whiteboards: same source |
| Public REST API covers boards, items, suggestions and comments | `docs/api/openapi.json` | Whiteboards reported to have no API: https://supergood.ai/api-report-card/clickup (2026-10-28) |
| Two-way sync with Jira Cloud and Data Center, Linear and GitHub (including GHES) straight from board items, plus roadmap import | `docs/trackers.md` | Stickies become ClickUp tasks only; GitHub is linking only; no native Linear: https://clickup.com/features/whiteboard, https://clickup.com/integrations/github (2026-10-28) |
| MIT-licensed and self-hostable (`docker compose up`) | `LICENSE`, `README.md`, `docs/deployment.md` | Proprietary SaaS only: https://clickup.com/security (2026-10-28) |
| No plan gates. SSO (SAML/OIDC), SCIM and audit log are available to every self-hosted workspace | `docs/configuration.md`, `docs/parity.md` §13 | SAML, SCIM and audit trails are Enterprise/Max only; free whiteboards are capped at 3: https://clickup.com/pricing (2026-10-28) |
| Bring your own AI model (Anthropic, OpenAI-compatible, Ollama, vLLM) with no AI credits sold | `docs/ai.md` | AI is metered in ClickUp credits, with paid top-ups at $10 per 10K: https://clickup.com/pricing (2026-10-28) |
| Facilitation: voting, shared timer, private mode, polls, planning poker | `README.md`, `apps/web/src/features/engage`, `apps/web/src/features/estimation` | Not mentioned on ClickUp's whiteboard feature page; a whiteboard timer is an open feature request: https://clickup.com/features/whiteboard, https://feedback.clickup.com/feature-requests/p/digital-timer-pomodoro (2026-10-28) |
| Accessibility: WCAG 2.1 AA target, keyboard operation of the board, screen-reader "Board as list" view | `docs/accessibility.md` | ClickUp is working toward WCAG over several years; its page doesn't describe whiteboard keyboard or screen-reader support: https://clickup.com/accessibility (2026-10-28) |

## 9. Suggested comparison table

| Capability | ClickUp Whiteboards | Freero | Sources |
|---|---|---|---|
| Free tier | Yes¹ | Yes | clickup.com/pricing; `docs/parity.md` §13 |
| Price per seat | Paid | No | clickup.com/pricing; `README.md`, `LICENSE` |
| Open-source licence | No | Yes | clickup.com/security; `LICENSE` |
| Self-hosting | No | Yes | clickup.com/security; `docs/deployment.md` |
| MCP / agent access | Yes | Yes | developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server; `docs/mcp.md` |
| Agent access to whiteboards specifically | No | Yes | developer.clickup.com/docs/mcp-tools; `docs/mcp.md` |
| Agent write access with human review | No | Yes | developer.clickup.com/docs/mcp-tools; `docs/mcp.md` (`propose_changes`) |
| Built-in AI | Yes | Partial² | clickup.com/features/whiteboard, clickup.com/pricing; `docs/ai.md` |
| Bring your own AI model | No³ | Yes | clickup.com/pricing; `docs/ai.md` |
| Jira / Linear / GitHub two-way sync | Partial⁴ | Yes | clickup.com/integrations/jira, clickup.com/integrations/github; `docs/trackers.md` |
| REST API covering whiteboards | No | Yes | supergood.ai/api-report-card/clickup; `docs/api/openapi.json` |
| Webhooks | Yes⁵ | Yes | supergood.ai/api-report-card/clickup; `docs/events.md` |
| SSO | Paid | Yes | clickup.com/pricing; `docs/configuration.md` |
| SCIM | Paid | Yes | clickup.com/pricing; `docs/configuration.md` |
| Audit log | Paid | Yes | clickup.com/pricing; `ARCHITECTURE.md`, `docs/configuration.md` |
| Data residency choice | Paid | Partial⁶ | clickup.com/security; `docs/deployment.md` |
| Native apps | Yes | No | clickup.com/pricing (download menu); `apps/web/public/manifest.webmanifest` |
| Whiteboard facilitation (voting / timer / private mode) | No⁷ | Yes | clickup.com/features/whiteboard, feedback.clickup.com/feature-requests/p/digital-timer-pomodoro; `README.md` |
| Templates | Yes | Yes | clickup.com/features/whiteboard; `apps/web/src/features/templates/lib/catalog/index.ts` |
| Guest access | Yes | Yes | clickup.com/pricing; `ARCHITECTURE.md` ("Guests") |
| Accessibility statement | Yes | Yes | clickup.com/accessibility; `docs/accessibility.md` |
| Security certifications (SOC 2 / ISO 27001) | Yes | No | clickup.com/security; brief "Honest gaps" |

Notes: ¹ Free is capped at 3 whiteboards with no private whiteboards. ² Freero's AI is off until an operator or workspace connects a model, and it has no chat assistant. ³ We found no bring-your-own-model option on the pricing page or in the MCP docs. ⁴ Native Jira sync works at task level and isn't confirmed as fully two-way; GitHub is linking only; Linear has no native integration; none of this runs from the whiteboard. ⁵ Webhooks cover the API's objects, not whiteboards. ⁶ Freero runs in whatever region you host it; there's no hosted region choice. ⁷ Not documented on ClickUp's whiteboard page; we couldn't confirm the feature is absent. All ClickUp sources checked 2026-10-28.

## 10. Target search keywords

- **ClickUp whiteboard alternative** (primary)
- **ClickUp whiteboards vs** / **Freero vs ClickUp** (primary)
- **open source ClickUp whiteboard alternative** (primary)
- ClickUp whiteboard limit / ClickUp free plan whiteboard limit
- ClickUp whiteboard Jira
- ClickUp whiteboard API
- ClickUp MCP whiteboard
- self-hosted whiteboard for ClickUp teams
- whiteboard with Jira and Linear two-way sync
- AI agent whiteboard MCP

## 11. Notable timely context

- **2026-10-15 onward:** pricing trackers report that ClickUp is testing a new Core / Business / Max grid with AI credits bundled into every plan, replacing Unlimited and the separate Brain AI / Everything AI add-ons. Reported, not confirmed by ClickUp; on 2026-10-28 we saw the new grid on clickup.com/pricing. Sources: https://www.usagepricing.com/blueprint/activity/clickup-2026-10-15-core-max-plans-test; https://pricingsaas.com/companies/clickup/diffs/2026W43; https://clickup.com/pricing (checked 2026-10-28).
- **New Max tier** at $100 per user/month (annual), with 10K AI credits per user. Source: https://clickup.com/pricing (checked 2026-10-28).
- **Official MCP server** on all plans, with plan-based call limits and no delete tools. Source: https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server (checked 2026-10-28).

## Sources

- https://clickup.com/pricing — checked 2026-10-28
- https://clickup.com/features/whiteboard — checked 2026-10-28
- https://clickup.com/security — checked 2026-10-28
- https://clickup.com/accessibility — checked 2026-10-28
- https://clickup.com/integrations/github — checked 2026-10-28
- https://clickup.com/integrations/jira — checked 2026-10-28
- https://help.clickup.com/hc/en-us/articles/26324629158423-Jira-Sync-integration — returned 403 on 2026-10-28
- https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server — checked 2026-10-28
- https://developer.clickup.com/docs/mcp-tools — checked 2026-10-28
- https://developer.clickup.com/docs/Getting%20Started — checked 2026-10-28 (via search)
- https://supergood.ai/api-report-card/clickup — third-party, checked 2026-10-28
- https://www.usagepricing.com/blueprint/activity/clickup-2026-10-15-core-max-plans-test — third-party, checked 2026-10-28
- https://pricingsaas.com/companies/clickup/diffs/2026W43 — third-party, checked 2026-10-28
- https://feedback.clickup.com/feature-requests/p/digital-timer-pomodoro — checked 2026-10-28 (via search)
- https://unito.io/integrations/clickup-jira/ and https://unito.io/integrations/clickup-linear/ — third-party, checked 2026-10-28
- https://zapier.com/apps/linear/integrations/clickup — checked 2026-10-28 (via search)

## Could not verify

- ClickUp's own monthly-billing prices (only annual prices were readable), and whether the Core/Max grid is a test or a permanent rollout.
- Whether the native Jira Sync is fully two-way, and which fields it covers (the help article returned 403).
- Absence of whiteboard endpoints, confirmed against ClickUp's own API reference (we relied on a third-party review).
- Whether ClickUp whiteboards have voting, a timer or private mode. None is documented; a timer is an open request.
- Whether ClickUp offers any bring-your-own-model option.
