# Freero vs Microsoft Whiteboard — competitor fact sheet

Slug: `microsoft-whiteboard` · Facts checked 2026-10-28 · Freero facts from the internal Freero brief (repo paths cited below).

> Framing correction: Microsoft Whiteboard as a whole is **not** retired. What ended in 2026 is (a) the **standalone Windows, iOS and Android apps** (Oct 16, 2026), (b) **legacy Azure-stored whiteboards** (deleted Oct 16, 2026), and (c) **editing for personal Microsoft accounts** (Sept 25, 2026). For work and school accounts, Whiteboard continues inside Microsoft Teams and on the web. Microsoft's own notices recommend Teams and web Whiteboard; none we found mention Microsoft Loop as the replacement. Pages should say "standalone apps retired", not "Whiteboard shut down".

## 1. What it is and who it's for

Microsoft Whiteboard is Microsoft's freeform digital canvas for sketching, sticky notes and pen input. It is built into Microsoft Teams meetings, chats and channels and is also available on the web. Files are saved as `.whiteboard` files in the creator's OneDrive (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations, checked 2026-10-28). It is aimed at organizations that already use Microsoft 365, especially for meeting brainstorms, classroom teaching and pen-and-touch devices. Since autumn 2026 it is effectively a work/school-only, Teams-and-web product (see §11).

## 2. Pricing as of 2026-10-28

Whiteboard has no price of its own. Organizations get it through a Microsoft 365 commercial or education subscription that includes OneDrive and Teams; admins switch it on or off for the tenant (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-whiteboard-access-organizations, checked 2026-10-28). So "the price of Whiteboard" is really the per-user price of the Microsoft 365 plan.

US list prices per user per month, after Microsoft's July 1, 2026 increase (reported by press; Microsoft's pricing pages did not load for us):

| Plan | Before Jul 1, 2026 | From Jul 1, 2026 | Source (checked 2026-10-28) |
|---|---|---|---|
| Microsoft 365 Business Basic | $6 | $7 | https://office-watch.com/2026/microsoft-365-business-price-increase-2026/ |
| Microsoft 365 Business Standard | $12.50 | $14 | same |
| Microsoft 365 Business Premium | $22 | $22 | same |
| Microsoft 365 E3 | $36 | $39 | same |
| Microsoft 365 E5 | $57 | $60 | same |

- Billing basis: these are the commonly quoted monthly-equivalent prices, generally tied to an annual commitment; month-to-month billing typically costs more. **Not confirmed on Microsoft's site** — re-check https://www.microsoft.com/en-us/microsoft-365/business/compare-all-microsoft-365-business-products before publishing.
- Copilot in Whiteboard needs a Copilot license on top. Press reports Microsoft 365 Copilot at $30/user/month (annual) and Microsoft 365 Copilot Business at $21/user/month (annual), with promotional pricing at times (https://coworker.ai/blog/microsoft-copilot-enterprise-pricing, https://eesel.ai/blog/copilot-pricing, checked 2026-10-28). **Unconfirmed on Microsoft's site.**
- Free tier: personal Microsoft accounts could use Whiteboard free of charge, but as of Sept 25, 2026 personal-account holders can no longer create or edit whiteboards (Message Center MC1441775, mirror https://mc.merill.net/message/MC1441775, checked 2026-10-28). There is no free tier for new users today.
- Currency: USD. Other regions vary.

## 3. AI and agent capabilities

- **Copilot in Whiteboard:** three actions. *Suggest* adds ideas as sticky notes, *Categorize* groups sticky notes into labeled clusters, and *Summarize* writes a summary of sticky notes into a Loop component. It works on sticky notes only, not ink or text boxes, and requires a Microsoft Copilot license (https://support.microsoft.com/en-US/whiteboard/welcome-to-copilot-in-whiteboard, checked 2026-10-28). Whiteboard must be enabled for the tenant (Microsoft 365 Copilot requirements, https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-requirements, checked 2026-10-28).
- **AI pricing:** per-user Copilot license, see §2. No bring-your-own-model option found.
- **MCP server / agent access:** none found that is specific to Whiteboard (searched Microsoft Learn and support, 2026-10-28).
- **Public API:** none found for board content. A Microsoft Graph "whiteboard" resource page returns 404 (https://learn.microsoft.com/en-us/graph/api/resources/whiteboard, checked 2026-10-28). Admin PowerShell cmdlets exist for legacy Azure boards (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations). `.whiteboard` files can be moved like other OneDrive files.
- **Outside agents acting on boards:** no documented way.

## 4. Self-hosting and licensing

- Proprietary, closed source, Microsoft cloud only. No on-prem or self-hosted edition was found.
- Some boards started on Surface Hub or Teams Rooms devices are stored in Azure rather than OneDrive (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations).

## 5. Enterprise features

All of these come from the Microsoft 365 tenant, so they need a paid commercial or education subscription:

- **Identity / SSO:** Microsoft Entra ID sign-in. Admins can require Conditional Access policies for Whiteboard (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-whiteboard-access-organizations).
- **SCIM / provisioning:** handled at the tenant level by Entra ID. Nothing Whiteboard-specific.
- **Audit log:** OneDrive-stored whiteboards appear in Microsoft Purview file audit activities (create, modify, share, delete) (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations).
- **Data controls:** retention policies, quota, legal hold, DLP and basic eDiscovery for OneDrive boards. Sensitivity labels and fuller eDiscovery are listed as planned. Page updated 2026-10-08 (same source).
- **Data residency:** boards are stored wherever the tenant's OneDrive data lives (same source; see Microsoft 365 data locations).
- **Certifications:** Microsoft lists SOC 1, SOC 2, ISO 27001, HIPAA and EU Model Clauses (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-whiteboard-access-organizations).
- **Government clouds:** GCC, GCC High and DoD are covered by the app-retirement notice (MC1469557, https://mc.merill.net/message/MC1469557).
- **External/guest use:** anonymous meeting participants can collaborate only during a Teams meeting. This needs an admin PowerShell setting, and no share link is created. Persistent external sharing needs "specific people" links and B2B accounts (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-sharing-organizations, checked 2026-10-28).

## 6. Integrations relevant to Freero's differentiators

- Jira / Linear / GitHub: **none found** in Microsoft's Whiteboard documentation (checked 2026-10-28).
- Its integrations are inside Microsoft 365: Teams meetings, chats and channels, OneDrive files, and Loop components (used by Copilot Summarize) (https://support.microsoft.com/en-us/whiteboard/retirement-standalone-microsoft-whiteboard-apps, https://support.microsoft.com/en-US/whiteboard/welcome-to-copilot-in-whiteboard).

## 7. Where Microsoft Whiteboard is genuinely stronger than Freero

- **Teams and Microsoft 365 integration:** opens inside Teams meetings and chats, saves to OneDrive, and is administered from the M365 admin center with no extra procurement. Freero only links to a call (Jitsi or a pasted meeting link) and has no built-in audio or video (`docs/configuration.md` "Board calls").
- **Compliance stack:** SOC 1/2, ISO 27001 and HIPAA, plus DLP, retention, legal hold and eDiscovery through OneDrive/Purview. Freero has no certifications, DLP or eDiscovery (brief "Honest gaps").
- **Inking and pen-first devices:** built for pen and touch, including Surface Hub and Teams Rooms boards. Freero supports tablet pen and touch but its phone layout is view-and-comment (`docs/accessibility.md`).
- **Already paid for:** organizations on Microsoft 365 pay nothing extra, and IT does not have to run anything. Self-hosting Freero is an ops task.
- **Vendor support and scale:** Microsoft support contracts. Freero has no documented SLAs.
- **Copilot inside the board** for M365 Copilot customers. Freero's built-in AI needs an operator-configured model.
- **Interface translations:** Microsoft 365 ships in many languages. Freero is English only.

## 8. Where Freero is stronger (verifiable)

| Freero point | Freero source | Microsoft Whiteboard contrast |
|---|---|---|
| Works for anyone, no Microsoft 365 subscription needed: free, MIT-licensed | `LICENSE`, `docs/parity.md` §13 | Personal accounts can no longer create or edit whiteboards since Sept 25, 2026 (https://mc.merill.net/message/MC1441775) |
| You own and host the data; no vendor-driven migrations or deletions | `docs/deployment.md` | Unmigrated legacy Azure boards were permanently deleted on Oct 16, 2026 (https://support.microsoft.com/en-us/whiteboard/migration-of-whiteboards-from-azure-to-onedrive) |
| Built-in MCP server; scoped agent permissions; suggestions humans accept or reject | `docs/mcp.md` | No Whiteboard MCP server or content API found |
| Public REST API (OpenAPI) and signed webhooks, including Teams-format payloads | `docs/api/openapi.json`, `docs/events.md` | Graph whiteboard resource not found (404) |
| Two-way Jira, Linear and GitHub sync, plus roadmap mode | `docs/trackers.md` | No tracker integrations documented |
| Bring your own AI model (incl. Azure OpenAI), no per-seat AI fee | `docs/ai.md` | Copilot needs a per-user Copilot license (https://support.microsoft.com/en-US/whiteboard/welcome-to-copilot-in-whiteboard) |
| Guests join shared boards with a name, no account | `ARCHITECTURE.md` "Guests" | External users need meeting-only access or B2B accounts (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-sharing-organizations) |
| Microsoft sign-in (OIDC), SAML/OIDC SSO and SCIM per workspace, so M365 shops keep their identity provider | `docs/configuration.md` | Parity, not a contrast: Whiteboard uses Entra ID (https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-whiteboard-access-organizations) |
| Facilitation and planning: voting, timer, polls, planning poker, kanban, timeline, 73 templates | `README.md`, `apps/web/src/features/*`, templates catalog | Copilot works on sticky notes only; templates exist (§9) |
| Keyboard "Board as list" view, high-contrast support, WCAG 2.1 AA target | `docs/accessibility.md` | Microsoft publishes keyboard and screen-reader support docs (https://support.microsoft.com/whiteboard/whiteboard-accessibility-support) |

**Migration reality:** Freero has **no Whiteboard file importer** and no Miro/Mural importer (brief "Honest gaps"). Microsoft's documented exports are image export from the board and HTML export for admins via `Export-WhiteboardHtml` (https://support.microsoft.com/en-us/whiteboard/migration-of-whiteboards-from-azure-to-onedrive). An exported image can be placed on a Freero board as an image (`README.md`: images), but it will not become editable sticky notes.

## 9. Suggested comparison table

| Capability | Microsoft Whiteboard | Freero | Sources |
|---|---|---|---|
| Availability / status | Partial (Teams and web for work/school; standalone apps and personal-account editing Retired 2026) | Yes | https://support.microsoft.com/en-us/whiteboard/retirement-standalone-microsoft-whiteboard-apps; https://mc.merill.net/message/MC1441775; `README.md` |
| Free tier | No (personal-account editing ended Sept 25, 2026) | Yes | https://mc.merill.net/message/MC1441775; `docs/parity.md` §13 |
| Price per seat | Paid (included in M365 plans, from $7/user/month reported) | No (free) | https://office-watch.com/2026/microsoft-365-business-price-increase-2026/; `LICENSE` |
| Open source licence | No | Yes (MIT) | Microsoft proprietary; `LICENSE` |
| Self-hosting | No | Yes | https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations; `docs/deployment.md` |
| MCP / agent access | No | Yes | none found on Microsoft Learn; `docs/mcp.md` |
| Agent write access with human review | No | Yes | none found; `docs/mcp.md` (propose_changes) |
| Built-in AI | Paid (Copilot license) | Partial (operator configures a model) | https://support.microsoft.com/en-US/whiteboard/welcome-to-copilot-in-whiteboard; `docs/ai.md` |
| Bring-your-own AI model | No | Yes | same; `docs/ai.md` |
| Jira / Linear / GitHub two-way | No | Yes | none found in Whiteboard docs; `docs/trackers.md` |
| REST API | No | Yes | https://learn.microsoft.com/en-us/graph/api/resources/whiteboard (404); `docs/api/openapi.json` |
| Webhooks | No | Yes | none found; `docs/events.md` |
| SSO | Paid (Entra ID) | Yes | https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-whiteboard-access-organizations; `docs/configuration.md` |
| SCIM | Paid (tenant-level via Entra ID, not Whiteboard-specific) | Yes | same; `docs/configuration.md` |
| Audit log | Paid (Purview file activities) | Yes | https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations; `ARCHITECTURE.md` |
| Data residency choice | Paid (follows tenant OneDrive location) | Yes (self-host anywhere) | same; `docs/deployment.md` |
| Native apps | Partial (inside Teams clients; standalone apps Retired Oct 16, 2026) | No (PWA) | https://mc.merill.net/message/MC1469557; `apps/web/public/manifest.webmanifest` |
| Templates | Yes | Yes (73) | https://support.microsoft.com/en-us/whiteboard/insert-templates-in-whiteboard; templates catalog |
| Guest access | Partial (meeting-only for anonymous users; B2B for persistent) | Yes | https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-sharing-organizations; `ARCHITECTURE.md` |
| Accessibility statement | Yes (support docs; Microsoft ACR program) | Yes | https://support.microsoft.com/whiteboard/whiteboard-accessibility-support; https://www.microsoft.com/en-us/accessibility/conformance-reports; `docs/accessibility.md` |
| Compliance certifications | Paid (SOC 1/2, ISO 27001, HIPAA) | No | manage-whiteboard-access-organizations; brief "Honest gaps" |

## 10. Target search keywords

- **Microsoft Whiteboard alternative** (primary)
- **Microsoft Whiteboard retirement** (primary)
- **Microsoft Whiteboard app retired** (primary)
- Microsoft Whiteboard replacement
- Microsoft Whiteboard personal account
- free Microsoft Whiteboard alternative
- Microsoft Whiteboard Windows app alternative
- Microsoft Whiteboard export whiteboards
- open source Microsoft Whiteboard alternative
- self-hosted whiteboard for Teams
- Microsoft Whiteboard vs Freero
- whiteboard without Microsoft 365

## 11. Notable timely context

- 2026-07-28 — Message Center MC1441775 published: legacy (Azure) whiteboards are retiring and moving to OneDrive. Updated 2026-08-25 with a revised timeline (https://mc.merill.net/message/MC1441775).
- 2026-08-30 / 2026-09-10 (reported) — the standalone-app date was postponed to Nov 30, 2026, then moved back to Oct 16, 2026 (https://blog.topedia.com/2026/08/end-of-support-for-the-whiteboard-apps-on-windows-ios-and-android/).
- 2026-09-09 — MC1469557: standalone Windows, iOS and Android apps retire Oct 16, 2026 for work/school and personal accounts. Teams and web Whiteboard continue (https://mc.merill.net/message/MC1469557).
- 2026-09-25 — migration tooling ended. Remaining Azure boards became read-only, and personal-account holders can no longer create or edit whiteboards (MC1441775; https://support.microsoft.com/en-us/whiteboard/migration-of-whiteboards-from-azure-to-onedrive).
- 2026-10-16 — standalone apps retired. Unmigrated Azure boards permanently deleted (https://support.microsoft.com/en-us/whiteboard/retirement-standalone-microsoft-whiteboard-apps).
- 2026-11-30 — Azure Whiteboard service shuts down (https://support.microsoft.com/en-us/whiteboard/migration-of-whiteboards-from-azure-to-onedrive).
- Date conflicts in Microsoft's own pages: the migration article still says the apps retire Sept 14, 2026, and MC1441775 v2 says Nov 30, 2026. The dedicated retirement page and MC1469557 say Oct 16, 2026. Use Oct 16.
- "Microsoft Loop replaces Whiteboard": **not supported** by any Microsoft notice we found. Microsoft points users to Whiteboard in Teams and on the web.
- 2026-07-01 (reported) — Microsoft 365 commercial price increase (https://office-watch.com/2026/microsoft-365-business-price-increase-2026/).

## Sources (all checked 2026-10-28)

- https://support.microsoft.com/en-us/whiteboard/retirement-standalone-microsoft-whiteboard-apps
- https://support.microsoft.com/en-us/whiteboard/migration-of-whiteboards-from-azure-to-onedrive
- https://mc.merill.net/message/MC1441775 (mirror of Microsoft 365 Message Center)
- https://mc.merill.net/message/MC1469557 (mirror of Microsoft 365 Message Center)
- https://blog.topedia.com/2026/08/end-of-support-for-the-whiteboard-apps-on-windows-ios-and-android/
- https://www.collaboard.app/blog/microsoft-whiteboard-retirement (competitor blog; used only to corroborate the personal-account cutoff)
- https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-whiteboard-access-organizations
- https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations
- https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-sharing-organizations
- https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-requirements
- https://learn.microsoft.com/en-us/graph/api/resources/whiteboard (404)
- https://support.microsoft.com/en-US/whiteboard/welcome-to-copilot-in-whiteboard
- https://support.microsoft.com/en-us/whiteboard/insert-templates-in-whiteboard
- https://support.microsoft.com/whiteboard/whiteboard-accessibility-support
- https://www.microsoft.com/en-us/accessibility/conformance-reports
- https://office-watch.com/2026/microsoft-365-business-price-increase-2026/
- https://coworker.ai/blog/microsoft-copilot-enterprise-pricing
- https://eesel.ai/blog/copilot-pricing

## Could not verify

- Microsoft 365 and Copilot prices on Microsoft's own site (pages timed out). Figures come from press and analyst blogs.
- Exactly which M365 plans include Whiteboard (Business Basic assumed because it includes Teams and OneDrive; not confirmed).
- Whether personal accounts can still **view or export** anything after Oct 16, 2026. Microsoft's pages don't say, and community answers conflict.
- Any Microsoft statement naming Loop as Whiteboard's replacement (none found).
- A Whiteboard-specific accessibility conformance report (only general support docs found).
- Current template count (press reported 40+ new templates when the app was redesigned, https://mspoweruser.com/microsoft-whiteboard-app-new-features; no official current number).
- Freero: status and pricing of "the hosted service" mentioned in `docs/mcp.md`. Do not claim a hosted Freero offer.
