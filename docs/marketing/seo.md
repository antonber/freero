# Search: keyword clusters, page map and internal links

The marketing site (`apps/site`, ARCHITECTURE.md "Marketing site") is built to rank for one idea:
**the whiteboard for teams of people and AI agents**, plus the "free / open-source / self-hosted
alternative" searches that bring whiteboard users looking for a way off their current tool.

No keyword-volume data was used: no keyword tool was queried. Before investing in a cluster, check
it against one (Google Keyword Planner, Search Console once the site is live, Ahrefs, Semrush) and
re-order the backlog below. Competitor facts come only from `docs/marketing/competitors/`.

## Rules every page follows

- One search intent per page, one `<h1>` that answers it, a `<title>` (≤ 60 characters) that leads
  with the primary keyword, and a description (≤ 155) that says what the visitor gets. The build's
  tests fail on duplicates or overruns.
- Claims are true today (checked against the code and `docs/`), names of other products are plain
  text (no logos, no implied endorsement), comparisons are sourced and dated.
- Every page links to at least two related pages, and every indexable page is linked from the
  header or footer, so nothing is an orphan. Unpublished pages are `noindex`, out of the sitemap and
  linked from nowhere.
- Structured data: Organization + WebSite + WebPage on every page, BreadcrumbList on inner pages,
  FAQPage where there is a FAQ (the questions people actually type), SoftwareApplication with a
  free offer on `/` and `/pricing`.

## Clusters and the pages that own them

| Cluster | Example queries | Owning page | Supporting pages |
|---|---|---|---|
| AI whiteboard | ai whiteboard, ai-powered whiteboard, whiteboard with ai | `/` | `/claude`, `/chatgpt`, `/agents` |
| Whiteboard for AI agents / MCP | whiteboard for ai agents, mcp whiteboard, whiteboard mcp server, agent collaboration board | `/agents` | `/`, `/claude`, `/chatgpt`, `/security` |
| Claude whiteboard | claude whiteboard, claude mcp whiteboard, claude custom connector whiteboard, claude code diagram board | `/claude` | `/agents`, `/security` |
| ChatGPT whiteboard | chatgpt whiteboard, chatgpt connector whiteboard, chatgpt developer mode mcp, chatgpt mind map board | `/chatgpt` | `/agents`, `/security` |
| Agent control room | ai agent dashboard board, monitor coding agents, human in the loop board | `/use-cases/agent-control-room` | `/agents#control-room`, `/claude`, `/chatgpt` |
| Free / open-source / self-hosted Miro alternative | free miro alternative, open source miro alternative, self-hosted miro alternative | `/vs/miro` | `/open-source`, `/pricing`, `/` |
| Other "alternative" searches | mural alternative, figjam alternative, lucidspark alternative, excalidraw alternative for teams, tldraw alternative | `/vs/<competitor>` (`/vs/mural`, `/vs/figjam`, `/vs/excalidraw`, `/vs/confluence-whiteboards` built) | `/open-source`, `/` |
| Microsoft Whiteboard alternative | microsoft whiteboard alternative, microsoft whiteboard app retired | `/vs/microsoft-whiteboard` (the standalone apps retired 2026-10-16, Teams and web continue for work accounts: say exactly that) | `/pricing`, `/` |
| Jamboard alternative | jamboard alternative, jamboard replacement, jamboard for teachers | `/vs/jamboard` (no Jamboard importer: said so) | `/`, `/pricing` |
| Self-hosted / open-source whiteboard | self-hosted whiteboard, open source whiteboard, on-premise whiteboard, docker whiteboard | `/open-source` | `/security`, `/pricing` |
| Free whiteboard | free online whiteboard, free collaborative whiteboard, whiteboard no signup limits | `/pricing` | `/`, `/open-source` |
| Online whiteboard for retrospectives | retrospective whiteboard, online retro board, sprint retro template | `/use-cases/retrospectives` | `/templates/retrospective` and the other retro templates, `/` (#workshops) |
| Planning poker | planning poker online free, scrum poker, story point estimation online | `/use-cases/planning-poker` | `/use-cases/jira`, `/` (#workshops) |
| Workshops | dot voting online, online workshop whiteboard, workshop facilitation tool | `/use-cases/workshops` | `/templates/*`, `/` (#workshops) |
| Jira whiteboard | jira whiteboard, sticky notes to jira, jira data center whiteboard, linear whiteboard, github issues whiteboard | `/use-cases/jira` | `/` (#trackers), `/agents`, `/integrations/jira-cloud`, `/integrations/jira-data-center` |
| Roadmap from Jira / Linear | jira roadmap whiteboard, linear roadmap, roadmap timeline from issues | `/use-cases/roadmaps` | `/use-cases/jira`, `/` (#trackers) |
| Secure / enterprise whiteboard | whiteboard sso scim, whiteboard audit log, gdpr whiteboard | `/security` | `/open-source`, `/pricing` |
| Templates | retrospective template, kanban template, lean canvas template, user story map template | `/templates/<id>`, one per catalog template, generated from the app's catalog; `/templates` lists them by category | `/use-cases/*` |
| Docs | whiteboard api, whiteboard webhooks, mcp server docs | `/docs` | `/agents` |

Keyword variants a page should use naturally in headings and copy are in its row; don't stuff them.

## Internal-linking plan

```
                ┌──────────── / (AI whiteboard) ─────────────┐
                │                                             │
   /claude ◄────┼──► /chatgpt ◄──► /agents (MCP, API, webhooks, control room)
      │         │        │              │
      └─────────┴────────┴──► /security ◄──► /open-source ◄──► /pricing
                                                 ▲
   /vs/<competitor> ──────────────────────────────┤  (each links to /, /open-source, /pricing
   /use-cases/<job> ──► /templates/<name>         │   and the use case it fits)
   /docs ──► guides in the repository ────────────┘
```

- Header: Claude, ChatGPT, For builders, Templates, Security, Pricing, Docs (+ Log in, Start free). Footer adds Templates, Use cases, Help and support (`/support`), the legal pages (`/privacy`, `/terms`, `/acceptable-use`: drafts, `noindex` until the operator is set),
  Overview and Open source. Every page ends with the same call to action (Start free, Connect
  Claude, Connect ChatGPT).
- `/` links down into every cluster from the section that matches it (agents → `/claude`,
  `/chatgpt`, `/agents`; safety → `/security`; enterprise → `/security`, `/open-source`, `/pricing`).
- `/claude` and `/chatgpt` link to each other, to `/agents` for other clients, and to `/security`.
- Comparison pages link to the owning page of the competitor's cluster and to `/open-source` and
  `/pricing`; nothing links to a comparison until it is published. Once there are three or more,
  add a `/vs` index and link it from the footer.
- Use-case and template pages link to each other (a use case lists its templates; a template names
  its use cases) and back to `/`. Their sitemaps (`sitemap-use-cases.xml`, `sitemap-templates.xml`)
  are added to `sitemap.xml` automatically when the first page of the group exists.

## Backlog (Linear project "Freero · Website & SEO")

Comparison pages in the order of `docs/marketing/competitors/README.md`, use-case pages, template
pages from the catalog, a blog, i18n with hreflang, Search Console and analytics (operator), and
directory submissions. The keyword order above should be re-checked with data before each batch.
