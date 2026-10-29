# Freero vs tldraw — competitor fact sheet

Slug: `tldraw` · Facts checked 2026-10-28 · Freero facts from the internal Freero brief (repo paths cited below).

> Important framing: "tldraw" is two things. (1) The **tldraw SDK**, a React library for building canvas apps, sold under the source-available tldraw license. (2) **tldraw.com**, a free whiteboard that tldraw runs as a showcase of the SDK. Most Freero comparisons are against tldraw.com (the product a team would use); SDK comparisons only matter to people who would build their own whiteboard.

## 1. What it is and who it's for

tldraw, Inc. makes an infinite-canvas SDK for React developers who want to put a whiteboard, diagram editor or AI canvas inside their own product; customers named by the company include ClickUp, Padlet, Craft and Jam (https://tldraw.dev/blog/announcing-tldraw-series-a, checked 2026-10-28). The company also runs tldraw.com, a free, instant collaborative whiteboard that the company itself describes as a flagship demo of the SDK (https://tldraw.dev/blog/announcing-tldraw-series-a; company reply at https://tldraw.substack.com/p/announcing-tldraw-sync/comments, checked 2026-10-28). In 2026 it added a free local desktop app, "tldraw offline", aimed at people who work with coding agents (https://tldraw.dev/blog/tldraw-offline, checked 2026-10-28). The SDK is for product and engineering teams; tldraw.com is for individuals and small groups who want a fast, no-frills sketching board.

## 2. Pricing as of 2026-10-28

| Offer | Price | Notes | Source (checked 2026-10-28) |
|---|---|---|---|
| tldraw.com (hosted whiteboard) | Free | Described as a "free-to-use tldraw.com account"; no paid plan found | https://tldraw.com, https://tldraw.dev/blog/introducing-tldraw-for-chatgpt-and-codex |
| tldraw offline (desktop app) | Free to download | Local files, no account, no server | https://tldraw.dev/blog/tldraw-offline |
| SDK — development use | Free | No key needed on localhost / non-production | https://tldraw.dev/sdk-features/license-key |
| SDK — trial license | Free, 100 days | One per company/project; no watermark; sends usage pings; stops at expiry with no grace period | https://tldraw.dev/sdk-features/license-key, https://tldraw.dev/pricing |
| SDK — hobby license | Free, discretionary | Non-commercial only; "made with tldraw" watermark stays on | https://tldraw.dev/community/license |
| SDK — commercial license | Not published ("value-based", talk to sales) | Annual; no watermark; 30-day grace after expiry | https://tldraw.dev/pricing, https://tldraw.dev/sdk-features/license-key |
| SDK — startup license | Not published ("discounted") | Apply via form | https://tldraw.dev/pricing |
| Premium modules | Listed as "in development" | No price | https://tldraw.dev/pricing |

There is no per-seat price: the SDK is licensed per company/deployment, not per user.

Flags:
- SDK commercial and startup prices are not published. A third-party review cites $6,000/year for a startup license for up to 10 users (https://automateed.com/tldraw-computer-review) — **unconfirmed; do not publish**.
- We could not find any paid tier or published usage limits for tldraw.com.

## 3. AI and agent capabilities

- **ChatGPT / Codex plugin (Sept 29, 2026):** a tldraw plugin built on OpenAI's MCP extension lets ChatGPT and Codex create, open, rename and search tldraw.com boards, read the canvas (screenshots, shapes, text, comments), draw and edit (including Mermaid diagrams) and reply to comments; boards are real tldraw.com files (https://tldraw.dev/blog/introducing-tldraw-for-chatgpt-and-codex, checked 2026-10-28). No human-approval / suggestion step is described.
- **tldraw MCP App (Mar 3, 2026):** an MCP server that gives agents tools to create, edit and delete shapes and shows an interactive canvas inside the chat; launched in Cursor with VS Code, ChatGPT and Claude support announced as coming (https://tldraw.dev/blog/tldraw-mcp-app, checked 2026-10-28). A directory lists a hosted endpoint with no auth (https://mcpservers.org/remote-mcp-servers/tldraw) — third-party, not verified.
- **tldraw offline (Jul 16, 2026):** local desktop app whose `.tldraw` files agents such as Claude Code, Codex and Pi can read, edit and attach scripts to (https://tldraw.dev/blog/tldraw-offline, checked 2026-10-28).
- **Fairies:** multi-agent "AI agents on your canvas" experiment, run on tldraw.com for one month (December, reported as December 2025) (https://fairies.tldraw.com; https://tldraw.dev/blog/harnessing-the-agents; year from https://ag-grid.com/studio/session/bringing-ai-to-the-canvas.md, checked 2026-10-28). Current availability not confirmed.
- **SDK starter kits:** an Agent starter kit (chat panel agent that reads the canvas and edits it through typed actions; Anthropic, OpenAI or Google models; developer supplies own API keys), plus chat, branching-chat and workflow kits (https://tldraw.dev/starter-kits/agent, https://tldraw.dev/docs/ai, checked 2026-10-28). Starter kits are MIT-licensed (https://github.com/tldraw/tldraw README).
- **make real:** "draw a UI and make it real" demo; its GitHub repo was archived on Feb 20, 2026 (https://github.com/tldraw/make-real, checked 2026-10-28).
- **tldraw computer:** AI workflow canvas at computer.tldraw.com; current status could not be confirmed (page is JS-only).
- **AI credits/pricing:** none published for tldraw.com or the plugin.
- **Public REST API / webhooks for tldraw.com:** none found. The SDK itself is a JavaScript library with a full editor API (developer-side, not a hosted API).

## 4. Self-hosting and licensing

- SDK license: the custom **"tldraw license"** — source-available, **not open source**, not MIT. Default terms allow development use only; production needs a trial, hobby or commercial license key (https://github.com/tldraw/tldraw/blob/main/LICENSE.md, https://tldraw.dev/community/license, checked 2026-10-28).
- Since SDK 4.0 (announced Sept 18, 2025) the key is enforced: in production without a valid key the editor logs errors and stops rendering after five seconds (https://tldraw.dev/releases/v4.0.0, https://tldraw.dev/sdk-features/license-key, https://alternativeto.net/news/2025/9/tldraw-sdk-4-0-adds-five-new-starter-kits-cli-tool-and-enforces-licensing-changes/, checked 2026-10-28).
- Downstream users of a product that embeds the SDK need their own license (https://tldraw.dev/community/license).
- Self-hosting: the SDK and tldraw sync run on your own infrastructure (sync template on Cloudflare Durable Objects + R2, or any WebSocket server). Auth, permissions, rate limits, history and room listing are left to the developer (https://tldraw.dev/docs/sync, checked 2026-10-28). There is **no self-hostable, ready-made team whiteboard product** equivalent to tldraw.com.
- tldraw.com itself is hosted only.

## 5. Enterprise features

- tldraw.com: no SSO, SCIM, audit log, admin console, data residency choice or compliance certifications documented (searched tldraw.dev and tldraw.com, 2026-10-28) — listed under "Could not verify" as an absence.
- SDK: enterprise controls are whatever the integrating developer builds; the sync template ships without auth (https://tldraw.dev/docs/sync). Some enterprise keys allow wildcard domains (https://tldraw.dev/sdk-features/license-key).

## 6. Integrations relevant to Freero's differentiators

- Jira / Linear / GitHub: **no integration found** for tldraw.com or the SDK (checked tldraw.dev docs and blog, 2026-10-28). A developer could build one with the SDK.
- AI clients: ChatGPT and Codex (plugin), Cursor (MCP App), coding agents via local files (tldraw offline) — sources in §3.

## 7. Where tldraw is genuinely stronger than Freero

- **Embeddability and SDK depth:** a mature React SDK used by companies such as ClickUp and Padlet, with custom shapes, a sync engine and starter kits; Freero has no in-board app SDK or embeddable editor package (Freero brief "Developer platform: NOT built").
- **Canvas feel and performance:** widely adopted (51.1k GitHub stars, https://github.com/tldraw/tldraw, checked 2026-10-28) and focused on drawing quality.
- **AI experimentation:** first-party ChatGPT/Codex plugin with a canvas UI inside chat, an MCP App, multi-agent fairies, and agent starter kits. Freero's MCP previews inside chat are not shipped (planned KAI-171).
- **Zero-setup free app:** tldraw.com needs nothing to run; Freero is self-hosted unless a hosted offer exists.
- **Local-first desktop app** (tldraw offline) with no account; Freero is a PWA with no offline editing beyond short disconnects.
- **Accessibility claim on the SDK:** 4.0 claims WCAG 2.2 AA (https://tldraw.dev/releases/v4.0.0); Freero targets WCAG 2.1 AA.

## 8. Where Freero is stronger (verifiable)

| Freero point | Freero source | tldraw contrast |
|---|---|---|
| MIT-licensed, free in production, no license key or watermark | `LICENSE`, `README.md` "License" | tldraw license: production requires a key; hobby keeps a watermark; commercial via sales (https://tldraw.dev/sdk-features/license-key) |
| Complete self-hostable team product (auth, roles, Postgres, Redis, object storage, horizontal scaling) | `README.md` "Run it", `docs/deployment.md` | tldraw sync template ships without auth, permissions, history or rate limits (https://tldraw.dev/docs/sync) |
| Built-in MCP server on every Freero server, OAuth 2.1 + scoped permissions; agents can propose changes that humans accept or reject | `docs/mcp.md` | tldraw ChatGPT/Codex plugin edits boards directly; no review step described (https://tldraw.dev/blog/introducing-tldraw-for-chatgpt-and-codex) |
| Agent activity visible and audit-logged, with kill switches | `docs/mcp.md` | Not documented for tldraw.com |
| Two-way Jira (Cloud/DC), Linear, GitHub (incl. Enterprise Server) sync and roadmap mode | `docs/trackers.md` | No tracker integration found |
| Public REST API with OpenAPI spec; signed webhooks | `docs/api/openapi.json`, `docs/events.md` | No hosted API or webhooks for tldraw.com found |
| SSO (SAML/OIDC), SCIM, hash-chained audit log, data exports | `docs/configuration.md`, `ARCHITECTURE.md` | None documented for tldraw.com |
| Bring-your-own model built-in AI (Anthropic, OpenAI-compatible, Ollama…), no credits | `docs/ai.md` | tldraw.com AI is via external clients; SDK kits need your own keys (https://tldraw.dev/starter-kits/agent) |
| Facilitation (voting, timer, polls, planning poker), 73 templates, guests, kanban, timeline | `README.md`, `apps/web/src/features/templates/lib/catalog/index.ts`, `ARCHITECTURE.md` | tldraw.com is a minimal sketching board (no template gallery found) |

Honesty notes: Freero has no SDK for embedding, no native/desktop app, no certifications, a small ecosystem, and self-hosting means you run it.

## 9. Suggested comparison table

Column "tldraw" = tldraw.com unless the row says SDK.

| Capability | tldraw | Freero | Sources |
|---|---|---|---|
| Availability / status | Yes (active) | Yes | tldraw.com; Freero `README.md` |
| Free tier | Yes (tldraw.com free; SDK free only in dev/trial/hobby) | Yes (no plan gates) | https://tldraw.dev/pricing; `docs/parity.md` §13 |
| Price per seat | No (no per-seat pricing; SDK commercial license by quote) | No (free) | https://tldraw.dev/pricing; `LICENSE` |
| Open source licence | No (source-available tldraw license) | Yes (MIT) | https://github.com/tldraw/tldraw/blob/main/LICENSE.md; `LICENSE` |
| Self-hosting | Partial (SDK + sync, you build the product; commercial key for production) | Yes | https://tldraw.dev/docs/sync; `docs/deployment.md` |
| MCP / agent access | Yes | Yes | https://tldraw.dev/blog/tldraw-mcp-app; `docs/mcp.md` |
| Agent write access with human review | No (not documented) | Yes | https://tldraw.dev/blog/introducing-tldraw-for-chatgpt-and-codex; `docs/mcp.md` (propose_changes) |
| Built-in AI | Partial (experiments, external-chat plugin) | Partial (off until operator configures a model) | https://tldraw.dev/blog/harnessing-the-agents; `docs/ai.md` |
| Bring-your-own AI model | Partial (SDK starter kits only) | Yes | https://tldraw.dev/starter-kits/agent; `docs/ai.md` |
| Jira / Linear / GitHub two-way | No | Yes | tldraw.dev (none found); `docs/trackers.md` |
| REST API | No | Yes | tldraw.dev (none found); `docs/api/openapi.json` |
| Webhooks | No | Yes | tldraw.dev (none found); `docs/events.md` |
| SSO | No | Yes | tldraw.dev (none found); `docs/configuration.md` |
| SCIM | No | Yes | tldraw.dev (none found); `docs/configuration.md` |
| Audit log | No | Yes | tldraw.dev (none found); `ARCHITECTURE.md` audit_events |
| Data residency choice | Partial (SDK: you host it; tldraw.com: no) | Yes (self-host anywhere) | https://tldraw.dev/docs/sync; `docs/deployment.md` |
| Native apps | Yes (tldraw offline desktop) | No (PWA) | https://tldraw.dev/blog/tldraw-offline; `apps/web/public/manifest.webmanifest` |
| Templates | No (none found on tldraw.com) | Yes (73) | tldraw.com; `apps/web/src/features/templates/lib/catalog/index.ts` |
| Guest access | Yes (reported: join shared links without an account) | Yes | https://openalternative.co/tldraw (third-party); `ARCHITECTURE.md` "Guests" |
| Accessibility statement | Partial (SDK 4.0 claims WCAG 2.2 AA; no tldraw.com statement found) | Yes (WCAG 2.1 AA target) | https://tldraw.dev/releases/v4.0.0; `docs/accessibility.md` |

## 10. Target search keywords

- **tldraw alternative** (primary)
- **tldraw vs Freero** (primary)
- **open source tldraw alternative** (primary)
- tldraw license
- tldraw license key production
- tldraw watermark
- tldraw self-hosted
- tldraw MIT alternative
- free whiteboard MCP server
- whiteboard for AI agents
- tldraw Jira integration
- self-hosted collaborative whiteboard

## 11. Notable timely context

- 2025-04-09 — tldraw announced a $10M Series A led by Lux Capital and Definition; said first-year sales were about $1M, mostly SDK licenses (https://tldraw.dev/blog/announcing-tldraw-series-a).
- 2025-09-18 (reported) — SDK 4.0: production license key enforced, five starter kits, `npm create tldraw`, WCAG 2.2 AA claim (https://tldraw.dev/releases/v4.0.0; date from https://alternativeto.net/news/2025/9/tldraw-sdk-4-0-adds-five-new-starter-kits-cli-tool-and-enforces-licensing-changes/).
- December 2025 (reported) — "Fairies" multi-agent experiment on tldraw.com for one month (https://tldraw.dev/blog/harnessing-the-agents; https://ag-grid.com/studio/session/bringing-ai-to-the-canvas.md).
- 2026-02-20 — make-real repository archived (https://github.com/tldraw/make-real).
- 2026-03-03 — tldraw MCP App announced (https://tldraw.dev/blog/tldraw-mcp-app).
- 2026-07-16 — tldraw offline desktop app launched, free (https://tldraw.dev/blog/tldraw-offline).
- 2026-09-29 — tldraw plugin for ChatGPT and Codex, working on tldraw.com boards (https://tldraw.dev/blog/introducing-tldraw-for-chatgpt-and-codex).

## Sources (all checked 2026-10-28)

- https://tldraw.dev/pricing
- https://tldraw.dev/community/license
- https://tldraw.dev/sdk-features/license-key
- https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- https://github.com/tldraw/tldraw
- https://tldraw.dev/releases/v4.0.0
- https://alternativeto.net/news/2025/9/tldraw-sdk-4-0-adds-five-new-starter-kits-cli-tool-and-enforces-licensing-changes/
- https://tldraw.dev/docs/sync
- https://tldraw.dev/docs/ai
- https://tldraw.dev/starter-kits/agent
- https://tldraw.dev/blog/tldraw-mcp-app
- https://tldraw.dev/blog/tldraw-offline
- https://tldraw.dev/blog/introducing-tldraw-for-chatgpt-and-codex
- https://tldraw.dev/blog/harnessing-the-agents
- https://tldraw.dev/blog/announcing-tldraw-series-a
- https://fairies.tldraw.com
- https://ag-grid.com/studio/session/bringing-ai-to-the-canvas.md
- https://github.com/tldraw/make-real
- https://tldraw.com
- https://tldraw.substack.com/p/announcing-tldraw-sync/comments
- https://mcpservers.org/remote-mcp-servers/tldraw (third-party)
- https://openalternative.co/tldraw (third-party)
- https://automateed.com/tldraw-computer-review (third-party, price not used)

## Could not verify

- Any SDK commercial or startup price (sales-only; the $6,000/year figure is third-party and unconfirmed).
- Whether tldraw.com has any paid tier, usage limits, SSO, admin features or an accessibility statement (none found; absences inferred from docs/blog search).
- Current status of tldraw computer and of Fairies on tldraw.com.
- Whether the tldraw MCP App endpoint is officially hosted/free and requires no auth (third-party directory only).
- Guest access without account on tldraw.com (third-party directory only).
- Freero: status and pricing of "the hosted service" mentioned in `docs/mcp.md` — do not claim a hosted Freero offer.
