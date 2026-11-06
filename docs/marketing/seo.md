# Search: keywords, the page that owns each one, technical rules, and off-site listings

The marketing site (`apps/site`, ARCHITECTURE.md "Marketing site") should rank for the searches of
people looking for this kind of tool, and be technically clean for crawlers. This file is the plan:
which query each page owns, how realistic it is, what the build enforces, and the ready-to-paste text
for directories. Competitor facts come only from `docs/marketing/competitors/`.

**Last research pass: 2026-11-02.** Method and its limits, said plainly:

- SERP observations come from web searches run on 2026-11-02 (a US-only search tool, not a
  Google rank tracker) and from the result pages they returned. They show the *shape* of each SERP
  (who and what kind of page ranks), not positions or volumes.
- **No keyword-volume data was used**: no keyword tool was queried. Volume and difficulty words
  below ("head", "mid", "long tail") are judgement from the SERP shape and the brands in it.
- Since 2026-11-02 Google Search Console is verified for the domain property `freero.app` and
  `https://freero.app/sitemap.xml` is submitted (read as a sitemap index, status Success). After
  4–6 weeks of data, replace the judgement column with real impressions and positions and re-order
  the backlog.

## What we learned from the SERPs (2026-11-02)

| Query family | What ranks today | What it means for Freero |
|---|---|---|
| free online whiteboard, online whiteboard | Canva and Microsoft product pages, then listicles ("best free online whiteboards") and small no-signup tools (WBO, webwhiteboard) | Head term owned by large brands. Not winnable soon. Aim for listicle inclusion (off-site) and the long tail: "free online whiteboard no limits", "…with kanban", "…for teams open source". |
| miro alternative, free miro alternative, best miro alternatives 2026 | Listicles (Rework, GetApp, many AI-written "alternatives" sites), AlternativeTo, OpenAlternative | The page we own (`/vs/miro`) competes with listicles; the bigger win is **being listed** on AlternativeTo / OpenAlternative / SaaSHub and in listicles. |
| open source miro alternative, self-hosted miro alternative | AlternativeTo and OpenAlternative pages, GitHub awesome lists; the projects named are Excalidraw, AFFiNE, draw.io, WBO, Spacedeck | Winnable. Few complete, self-hostable team whiteboards exist; most results are diagram tools or sketch boards. `/open-source` and `/vs/miro` own it; directory listings carry it. |
| self-hosted whiteboard docker | Docker Hub images, Hostinger app pages for WBO, community Excalidraw-with-collaboration repos | Winnable with `/open-source` + an awesome-selfhosted entry (once eligible, below). Excalidraw's own docs say its self-hosted build has no collaboration: that is the gap Freero fills. |
| MCP whiteboard, whiteboard for Claude, Claude whiteboard MCP | MCP directories (mcp.so, mcpservers.org, LobeHub, conare), small npm packages, the Excalidraw MCP app | Young SERP with no brand owner: the **most winnable** cluster. `/claude`, `/chatgpt`, `/integrations/mcp-client` own it; MCP directories and awesome lists are the off-site half. |
| AI whiteboard 2026 | Review/listicle farms (FitGap, Krowdbase), vendor blogs (Boardmix, AFFiNE), Zoom's AI whiteboard | Mid difficulty, noisy. Home owns it ("free, open-source AI whiteboard"). Differentiator to repeat everywhere: agents propose, people accept. |
| online retrospective tool free, retro board | Dedicated retro tools (EasyRetro, Echometer, Parabol, Neatro, GoRetro, TeamRetro) with their own "best free retro tools" posts | Competitive but fragmented; `/use-cases/retrospectives` plus the retro templates can rank on the long tail ("guided retro", "anonymous retro board", "start stop continue template"). |
| planning poker online free | Single-purpose free tools (Planning Poker Online, ScrumVote, Estimate Poker, Firepoker), AlternativeTo | Owners are tiny, single-feature sites. Freero's angle (poker on the board, estimate written onto the card, Jira sync) is real; `/use-cases/planning-poker` owns it. |
| free kanban board online (no signup) | Product Hunt launches and tiny tools; Trello-style brands further down | Long tail winnable: "kanban board with WIP limits free", "kanban board synced with Jira". `/features/kanban-board` owns it. |
| free mind map maker online collaborative | Creately, GitMind, Miro's mind-map page, MindMeister, listicles | Hard head term; the long tail ("mind map from outline", "keyboard mind map", "mermaid mind map online") is winnable. `/features/mind-map`. |
| free flowchart maker online | Lucidchart, Miro, Figma, Whimsical, Visual Paradigm, Moqups landing pages | Brand-heavy. Win the long tail: "mermaid to flowchart online editable", "draw.io alternative collaborative", "flowchart with live collaboration free". `/features/flowchart-maker`. |
| online sticky notes / brainstorming tool | Lucidspark and FigJam "online sticky notes" pages, EasyRetro, ClickUp free tools | Brand-heavy; `/use-cases/brainstorming` aims at "online brainstorming tool free", "private brainstorming / brainwriting online", "dot voting online". |
| user story mapping tool | Lucid (several pages), StoriesOnBoard, review posts (Creately, Guideflow) | Few strong owners and a clear job: winnable. `/use-cases/user-story-mapping` + `/templates/story-map`. |
| tldraw alternative, excalidraw alternative, figjam/mural alternative | AlternativeTo, OpenAlternative, toolradar, Sliplane's "Excalidraw alternatives" | Our `/vs/*` pages are sourced and fair, which listicles are not; they rank on "X vs Freero" and "open source X alternative". Directory listings matter more. |
| "[name] template" (retrospective template, lean canvas template, SWOT template…) | Miro, Canva, FigJam, Lucid template galleries; Atlassian; niche blogs | 584 template pages compete on the long tail. Rank expectation: low positions on popular names, real chances on less common formats (e.g. "rose thorn bud template", "lean coffee template"). The page title format leads with "<Name> template". |

Sources for the table (all fetched 2026-11-02): searches for each query family; result pages included
canva.com/online-whiteboard, microsoft.com/…/online-whiteboard, alternativeto.net/software/miro…,
openalternative.co/tags/miro, mcp.so/tags/whiteboard, mcpservers.org/…/whiteboard-mcp,
easyretro.io/use-cases/online-retrospective-tool, echometerapp.com, neatro.io, troopr.ai,
alternativeto.net/software/scrumvote, lucid.co/lucidspark/create/user-story-mapping-tool,
creately.com/reviews/best-user-story-mapping-tools, miro.com/flowchart-maker, whimsical.com/flowcharts,
lucid.co/…/online-sticky-notes, figma.com/figjam/online-sticky-notes, fitgap.com/search/whiteboard-ai-tools,
sliplane.io/blog/5-awesome-excalidraw-alternatives, toolradar.com/alternatives/tldraw.

### Realistic targets (next 3–6 months)

1. **MCP / Claude / ChatGPT whiteboard** — first page is realistic; the SERP is directories and small
   packages. Pages: `/claude`, `/chatgpt`, `/integrations/mcp-client`, `/agents`.
2. **Open-source / self-hosted Miro alternative** — realistic through directory listings plus
   `/open-source` and `/vs/miro`.
3. **Competitor long tail** ("tldraw alternative for teams", "excalidraw self-hosted collaboration",
   "jamboard alternative", "microsoft whiteboard alternative") — realistic; pages exist.
4. **Job long tail** (user story mapping tool, planning poker with Jira, guided retro, kanban with WIP
   limits, Mermaid to whiteboard) — realistic; pages exist.
5. **Template long tail** — some of 584 pages will rank; expect a slow build-up.
6. **Head terms** (online whiteboard, free online whiteboard, mind map maker, flowchart maker) —
   not realistic soon; they need links and brand. Keep the pages good and let listings and links build.

## Keyword → page map

Status: **live** = on freero.app; **new** = built in this branch, live after the next deploy;
**gap** = no page yet (backlog).

| Cluster | Example queries | Intent | Page that should rank | Status |
|---|---|---|---|---|
| Brand + positioning | freero, ai whiteboard, ai-powered whiteboard, whiteboard for ai agents | navigational / commercial | `/` (title: "Freero: free, open-source AI whiteboard for teams") | live, title new |
| Free online whiteboard | free online whiteboard, free collaborative whiteboard, online whiteboard for teams, whiteboard no paid plan | commercial | `/features/online-whiteboard` | new |
| Feature hub | whiteboard features, what can freero do | navigational | `/features` | new |
| Kanban | free online kanban board, kanban board with wip limits, kanban synced with jira | commercial | `/features/kanban-board` | new |
| Mind map | free mind map maker, online mind map collaborative, mind map from outline, mermaid mind map | commercial | `/features/mind-map` | new |
| Flowchart / diagram | free flowchart maker online, diagram maker collaborative, mermaid to diagram editable, uml / bpmn / erd online | commercial | `/features/flowchart-maker` | new |
| Brainstorming / sticky notes | online brainstorming tool, online sticky notes free, brainwriting online, dot voting online | commercial | `/use-cases/brainstorming` | new |
| User story mapping | user story mapping tool, story map online free, story map template | commercial | `/use-cases/user-story-mapping`, `/templates/story-map` | new / live |
| Retrospectives | online retrospective tool free, retro board, anonymous retro | commercial | `/use-cases/retrospectives` | live |
| Planning poker | planning poker online free, scrum poker, story points estimation | commercial | `/use-cases/planning-poker` | live |
| Workshops | online workshop whiteboard, dot voting, facilitation tool | commercial | `/use-cases/workshops` | live |
| Jira whiteboard | jira whiteboard, sticky notes to jira, jira data center whiteboard | commercial | `/use-cases/jira` | live |
| Roadmaps | roadmap from jira, linear roadmap whiteboard | commercial | `/use-cases/roadmaps` | live |
| Agent control room | ai agent dashboard board, human in the loop board | commercial | `/use-cases/agent-control-room` | live |
| Claude | claude whiteboard, claude mcp whiteboard, claude connector whiteboard | commercial | `/claude` | live |
| ChatGPT | chatgpt whiteboard, chatgpt mcp connector whiteboard | commercial | `/chatgpt` | live |
| MCP / builders | mcp whiteboard server, whiteboard api, whiteboard webhooks | commercial / informational | `/agents`, `/integrations/mcp-client`, `/docs` | live |
| Open source / self-hosted | open source whiteboard, self-hosted whiteboard, docker whiteboard, on-premise whiteboard, open-source whiteboard I can self-host | commercial | `/open-source` (direct answer + "Self-hostable whiteboards, compared" matrix since 2026-11-06) | live, extended |
| Miro alternative | free / open source / self-hosted miro alternative | commercial | `/vs/miro` | live |
| Other alternatives | mural, figjam, excalidraw, jamboard, microsoft whiteboard, confluence whiteboard alternative | commercial | `/vs/<slug>` | live |
| tldraw alternative | tldraw alternative, tldraw open source, tldraw self-hosted, tldraw license | commercial / informational | `/vs/tldraw` | new |
| Lucidspark alternative | lucidspark alternative free | commercial | `/vs/lucidspark` | gap (confirm prices on Lucid's own page first; the sheet's price is a secondary source) |
| Canva / ClickUp whiteboard alternative | canva whiteboard alternative, clickup whiteboard alternative | commercial | `/vs/canva-whiteboards`, `/vs/clickup-whiteboards` | gap (low demand; ClickUp pricing under A/B test) |
| Notion whiteboard | notion whiteboard, whiteboard for notion | informational | an article, not a /vs page | gap |
| Pricing / free | is freero free, whiteboard pricing | navigational | `/pricing` | live |
| Security / enterprise | whiteboard sso scim, whiteboard audit log | commercial | `/security` | live |
| Free + SSO (answer) | free whiteboard with sso, free miro alternative with sso, whiteboard scim free | commercial | `/answers/free-whiteboard-with-sso` | new |
| MCP whiteboards (answer) | which whiteboard works with claude / chatgpt, mcp whiteboard, whiteboard mcp server compared | commercial / informational | `/answers/mcp-whiteboard` | new |
| No board limit (answer) | free whiteboard unlimited boards, miro alternative no board limit, free whiteboard no 3 board limit | commercial | `/answers/free-whiteboard-without-board-limit` | new |
| Answers hub | freero answers, whiteboard questions | navigational | `/answers` | new |
| Key facts | freero licence, is freero open source, freero mcp endpoint, freero languages | navigational / informational | `/facts` | new |
| Integrations | whiteboard slack integration, jira whiteboard integration, n8n whiteboard | commercial | `/integrations/<id>` | live |
| Templates | "[name] template", "free [name] template" | commercial | `/templates/<id>`, `/templates/category/<slug>`, `/templates` | live (584) |

Answer pages (`/answers/<slug>`, `lib/answers.tsx`) take a question people put to an assistant;
the next candidates, in order: "does Notion have a whiteboard?" (informational and large; needs a
sourced Notion comparison first, and no claim about embedding Freero in Notion until it is tested),
"free online dot voting tool", "self-hosted Excalidraw with collaboration" (today an FAQ on
`/open-source`), "Microsoft Whiteboard for personal accounts replacement" (today `/vs/microsoft-whiteboard`).

Gaps worth a page next, in order: org chart maker (`/templates/org-chart` exists; a feature page
would add "Insert from text" org charts), online timer / dot voting tool pages (small but
uncontested), a Notion-whiteboard article, `/vs/lucidspark` once prices are confirmed.

## Rules every page follows (enforced by the build where marked)

- One search intent per page, one `<h1>` that answers it (**enforced**), a `<title>` of at most 60
  characters leading with the primary keyword and a description of at most 155 that says what the
  visitor gets, both unique across the site (**enforced**: `site.test.ts`).
- Canonical, `og:url`, `og:image` and the Twitter card point at the page's own URL and image on the
  serving origin (**enforced**). URLs have no trailing slash; `/x/` answers 301 → `/x`.
- Structured data: Organization + WebSite + WebPage on every page, BreadcrumbList on inner pages,
  FAQPage only where the same questions and answers are visible on the page (**enforced**),
  SoftwareApplication with a free offer on `/`, `/pricing`, `/claude`, `/chatgpt`, `/agents`,
  `/open-source` and the feature pages; HowTo on template pages (their steps are shown) and
  integration pages (their connect steps). No Product, Review or AggregateRating markup: there are
  no reviews to mark up.
- Sitemaps list exactly the pages built indexable (robots `index`) (**enforced**): never a 404, a
  draft legal page, an unpublished comparison. Legal pages are left out (they are drafts until the
  operator is set and are linked from every footer). `verify --only site` also fetches every
  sitemap URL from a real server and fails on a non-200, a redirect, a noindex header or meta, or a
  canonical that isn't the URL itself.
- robots.txt never blocks a marketing page and always blocks the app, boards, API, MCP and auth
  paths (**enforced**). The app's pages answer `X-Robots-Tag: noindex`, so an unknown top-level path
  (a soft 404 served by the SPA) is never indexed; paths under `/vs/`, `/features/`, `/use-cases/`,
  `/templates/` and `/integrations/` get a real 404.
- No script, no third-party resource, every image with alt text and its size (**enforced**). CSS is
  inlined, the bold Inter weight is preloaded, fonts use `font-display: swap`, screenshots are WebP
  with `srcset` and lazy below the fold: no render-blocking request beyond the HTML itself.
- Every indexable page is reachable by links from `/` (**enforced**), and every internal link goes
  to a page, an anchor, a built file or an app route (**enforced**).
- Claims are true today (checked against the code and `docs/`); other products are named in plain
  text only, no logos or branding; comparisons are sourced and dated (**enforced** for `/vs`).

## Internal linking

```
                         ┌──────────── / (AI whiteboard) ────────────┐
                         │                                            │
   /features ──► online-whiteboard · kanban-board · mind-map · flowchart-maker
        │                   │ (each links the others, its templates, a use case, /claude, /chatgpt)
        ▼                   ▼
   /use-cases ──► retros · poker · workshops · jira · roadmaps · brainstorming · story mapping · control room
        │                   │ (each lists its templates; every template page links back)
        ▼                   ▼
   /templates ──► /templates/category/<slug> ──► /templates/<id>
   /vs ──► /vs/<competitor> ──► /open-source, /pricing, /claude, /chatgpt, /facts
   /claude ◄──► /chatgpt ◄──► /agents ◄──► /integrations ──► /security, /docs
   /answers ──► /answers/<question> ──► its /vs comparisons, /facts, the pages in its "Keep reading"
                 (each answer lists the others); /facts ◄── every answer page, /vs page and the footer
```

- Header: Features, Claude, ChatGPT, For builders, Templates, Security, Pricing, Docs (+ Log in,
  Start free); from 1080 px, a Menu below that. Footer adds Overview, Use cases, Open source, Compare,
  Integrations, Help and support and the legal pages.
- `/` links down into every cluster: the "full whiteboard" cards link the feature pages, the
  workshop cards the use cases, the agent section `/claude`, `/chatgpt`, `/agents`.
- New pages are added to `src/lib/features.tsx` or `src/lib/useCases.tsx` and the hubs and sibling
  links follow; nothing else to edit.

## GEO: being found, understood and cited by AI assistants

ChatGPT search, Copilot / Bing, Gemini / AI Overviews, Claude and Perplexity answer questions from
pages they can fetch and quote. What the site does for them (built 2026-11-06, on top of the SEO
above):

- **Answer pages** (`/answers/<slug>`): the question as the h1, the direct answer in the first one or
  two sentences (what Freero is, free, open source, agents propose and people accept), then short
  checkable facts, a dated comparison matrix, how-to steps, an FAQ (FAQPage JSON-LD that the tests
  match against the visible text) and links into the page graph. A matrix cell is always a row of a
  published `/vs` page with its sources and check date ("as of" in the caption, "checked" per
  product), so an answer can't state a competitor fact the comparison doesn't.
- **Quotable facts** (`/facts`, `lib/facts.tsx`): one statement per topic (licence, price, limits,
  self-hosting, MCP endpoint, AI clients, trackers, integrations, languages, templates, guests,
  hosting, operator, source), each with its own anchor (`/facts#licence`) and where to check it.
  Counts and names come from the catalogs (MCP tools, integrations, `LOCALES`, templates), and the
  site tests check the quoted limits against the server's defaults. No user counts.
- **llms.txt** has "Key facts" and "Answers" sections; **llms-full.txt** adds each answer's FAQ.
- **Dates everywhere:** every page shows "Updated <date>" from its `updated` field (under the
  breadcrumbs; above the closing band on `/`; legal articles show their own "Last updated"), and the
  WebPage JSON-LD carries the same `dateModified` (tested). Bump `updated` when a page's facts change.
- **Already in place before:** robots.txt allows every crawler (the AI ones included) on marketing
  pages, static HTML without scripts, schema.org JSON-LD, `/vs` comparisons, use-case and template
  pages, IndexNow.

How to measure (check monthly; the first useful read is 4–6 weeks after the deploy):

1. **GA4**: create a custom channel group with an "AI Assistant" channel whose source matches
   `chatgpt\.com|chat\.openai\.com|perplexity\.ai|copilot\.microsoft\.com|bing\.com/chat|gemini\.google\.com|claude\.ai|you\.com`
   (regex on Session source), placed above Referral. Report: Acquisition → Traffic acquisition by that
   channel, with Landing page as the secondary dimension. Expect `/answers/*`, `/facts`, `/vs/*`,
   `/claude`, `/chatgpt` to lead. (GA4 runs only where `GA_MEASUREMENT_ID` is set and the visitor
   didn't opt out, so it undercounts.)
2. **Bing Webmaster Tools**: verify freero.app, submit `sitemap.xml`, and read the **AI Performance**
   report (citations of the site in Copilot and Bing AI answers, by page). IndexNow already notifies
   Bing after each deploy.
3. **Google Search Console**: AI Overviews and AI Mode clicks and impressions are counted in the
   Performance report (Web search type); filter Pages by `/answers/` and `/facts` and compare queries
   before and after. `sitemap-answers.xml` is its own sitemap, so its coverage reads separately.
4. **Spot checks**: ask ChatGPT search, Copilot, Gemini, Perplexity and Claude (with web search) the
   answer pages' questions; note whether Freero is named and which URL is cited. Keep the log here.

## IndexNow (Bing, Yandex, Seznam, Naver…)

Google does not use IndexNow; Search Console and the sitemap cover it. For the others:

1. Set `SITE_INDEXNOW_KEY` on the server (8–128 letters, digits or dashes, e.g. `openssl rand -hex 16`).
   The server then answers `https://freero.app/<key>.txt` with the key; with no key, nothing is
   served (`docs/configuration.md`).
2. After a deploy: `SITE_INDEXNOW_KEY=<key> node scripts/indexnow.mjs --site https://freero.app`
   submits every URL in the live sitemaps; `--since YYYY-MM-DD` submits only pages whose `lastmod`
   is on or after that day (a page's `updated` field); `--dry-run` lists them. The script checks the
   key file is live first and refuses URLs from another host (IndexNow would reject the batch).
3. The URL list comes from the same sitemaps Google reads, so it can't drift from what the site asks
   to have indexed (`site.test.ts` checks this against the built sitemaps).

## Off-site listings (ready to paste; nothing has been submitted)

Facts used below are true of the code on 2026-11-02. Re-read each site's rules when filing.

### GitHub repository (antonber/freero)

Today the description reads "Freero — an original real-time collaborative whiteboard (React +
TypeScript + Yjs), built with the Dune method", there are no topics and no releases.

- **Description** (≤ 350 characters):
  `Free, open-source (MIT) whiteboard for teams of people and AI agents. Real-time boards, kanban, mind maps, diagrams, retros and planning poker; an MCP server for Claude and ChatGPT; two-way Jira, Linear and GitHub sync; SSO and SCIM. Self-host with Docker.`
- **Website**: `https://freero.app` (already set).
- **Topics** (GitHub allows 20): `whiteboard`, `collaborative-whiteboard`, `online-whiteboard`,
  `miro-alternative`, `self-hosted`, `open-source`, `mcp`, `mcp-server`, `model-context-protocol`,
  `ai-agents`, `claude`, `chatgpt`, `kanban`, `mind-map`, `diagrams`, `retrospective`,
  `planning-poker`, `yjs`, `typescript`, `react`.
- **Needs from the owner**: a first tagged release (e.g. `v0.1.0`) with a changelog (several lists
  below require one, and its date starts their clocks), and a link to https://freero.app in the
  README's first lines (today the README never links the hosted site).

### AlternativeTo (alternative to Miro, FigJam, Mural, Lucidspark, Excalidraw, tldraw)

- **Name**: Freero · **Website**: https://freero.app · **Source**: https://github.com/antonber/freero
- **License**: Free · Open Source (MIT) · **Platforms**: Online / Web, Self-Hosted
- **Categories**: Online whiteboard; Diagram editor; Mind mapping; Kanban board
- **Tagline**: `Free, open-source whiteboard for teams and their AI agents`
- **Description**:
  `Freero is a free, open-source (MIT) collaborative whiteboard. Teams brainstorm with sticky notes, run retros, planning poker and dot voting, draw flowcharts and mind maps (Mermaid paste included) and plan on kanban boards and timelines that sync both ways with Jira, Linear and GitHub. AI assistants such as Claude and ChatGPT connect over MCP: they read boards and propose changes that people accept or reject. Everything is free, including SSO, SCIM and the audit log, and the whole product runs from one Docker image.`
- **Features to tick**: Real-time collaboration, Infinite canvas, Sticky notes, Mind maps, Flowcharts,
  Kanban boards, Templates, Self-hosted, Ad-free, Works offline: **no** (don't tick), AI-powered.
- **Alternatives to add it to**: Miro, FigJam, Mural, Lucidspark, Microsoft Whiteboard, Excalidraw,
  tldraw, Google Jamboard.
- **Needs from the owner**: an AlternativeTo account; screenshots (`docs/marketing/directory-assets/`
  has four); the app icon (`docs/marketing/directory-assets/freero-icon-512.png`).

### OpenAlternative (openalternative.co, "open source alternative to Miro")

- Same name, tagline and description as AlternativeTo. Alternatives: Miro, Mural, FigJam.
- **Needs**: a submission through their form (free queue; paid expedite exists, not needed). They
  read GitHub stars and activity, so submit after the first release.

### SaaSHub

- **Name**: Freero · **URL**: https://freero.app · **Category**: Online Whiteboard, Collaboration, Diagrams
- **Short description** (≤ 120): `Free, open-source whiteboard for teams and AI agents, with an MCP server and two-way Jira sync.`
- **Long description**: the AlternativeTo description above.
- **Alternatives**: Miro, Mural, FigJam, Lucidspark, Excalidraw, tldraw.
- **Needs**: a SaaSHub account; verify ownership with the freero.app email.

### awesome-selfhosted (awesome-selfhosted/awesome-selfhosted-data)

Rules checked 2026-11-02 (`.github/ISSUE_TEMPLATE/addition.md` and `CONTRIBUTING.md` in that repo):
free licence, working install instructions, actively maintained, **first released more than 4
months ago** (counted from a tagged release), **submitted by a human: "Machine/LLM-generated
contributions are not allowed and will result in a ban"**, descriptions under 250 characters
without the words "open-source", "free" or "self-hosted", "(alternative to …)" appended.

- **Not eligible yet**: the repository was created on 2026-10-27 and has no tagged release. Earliest
  filing: four months after the first release (a `v0.1.0` tagged in November 2026 → March 2027).
- **When eligible, the owner files this by hand** (`software/freero.yml`):

  ```yaml
  name: Freero
  website_url: https://freero.app
  source_code_url: https://github.com/antonber/freero
  description: Collaborative whiteboard for teams and AI agents, with kanban boards, mind maps, diagrams, retrospectives, an MCP server and two-way Jira, Linear and GitHub sync (alternative to Miro, Mural, FigJam).
  licenses:
    - MIT
  platforms:
    - Nodejs
    - Docker
  tags:
    - Communication - Custom Communication Systems
  demo_url: https://freero.app
  ```

  (WBO, another whiteboard, is listed under that tag. Re-check the tag list when filing.)

### awesome-mcp-servers (punkpeye) and awesome-remote-mcp-servers

- **awesome-remote-mcp-servers** fits freero.app (a hosted endpoint with public sign-up). Rules
  (CONTRIBUTING.md, 2026-11-02): the URL must answer an MCP `initialize` (CI checks; `https://freero.app/mcp`
  answers 401 with OAuth metadata, as OAuth servers do), usable by anyone, **listed as a Glama
  connector** with its badge, description ≤ 120 characters. Entry:

  ```markdown
  - [Freero](https://freero.app) `https://freero.app/mcp`
    [![Freero MCP connector](https://glama.ai/mcp/connectors/<glama-id>/badges/score.svg)](https://glama.ai/mcp/connectors/<glama-id>)
    🔐 - Read and build on collaborative whiteboards: notes, clusters, kanban cards, diagrams, tracker sync; edits reviewable.
  ```
- **awesome-mcp-servers** is for servers you run yourself from a public GitHub repo; Freero's MCP
  server ships inside the self-hosted product, so it fits under "Workplace & Productivity":

  ```markdown
  - [antonber/freero](https://github.com/antonber/freero) 📇 ☁️ 🏠 - Open-source collaborative whiteboard with a built-in MCP server (OAuth 2.1): read boards as outlines, add notes, clusters, kanban cards and Mermaid diagrams, or propose changes people accept; two-way Jira, Linear and GitHub sync.
  ```
  Entries there mostly carry a Glama score badge too.
- **Needs from the owner**: claim the server and connector on glama.ai (sign in with GitHub) to get
  the badge ids; open the PRs by hand.
- Also worth listing (free, self-serve): the official MCP Registry (`registry.modelcontextprotocol.io`,
  a `server.json` with a `remotes` entry for `https://freero.app/mcp`; namespace `app.freero/*` needs
  DNS verification of freero.app, or `io.github.antonber/*` via GitHub sign-in), mcp.so, PulseMCP,
  Smithery. The Claude connectors directory and ChatGPT app directory have their own checklist in
  `directory-submissions.md`.

### Product Hunt

Limits per Product Hunt's launch guide (2026-11-02): tagline ≤ 60 characters, description up to 500
(the first ~260 show in previews), gallery images 1270×760.

- **Name**: Freero
- **Tagline** (55): `The free, open-source whiteboard for people and AI agents`
- **Description** (≤ 260):
  `Freero is a free, MIT-licensed whiteboard where your team and your AI agents work together. Connect Claude or ChatGPT over MCP: they read the board and propose changes you accept. Kanban, mind maps, retros, planning poker and two-way Jira sync. Self-host it.`
- **Topics**: Productivity, Open Source, Artificial Intelligence, Design Tools, Developer Tools.
- **First comment (maker)**:
  > Hi Product Hunt! In Freero, Claude, ChatGPT or your own agent joins the whiteboard like a teammate: it reads the
  > board, proposes sticky notes, clusters or diagrams, and nothing changes until someone accepts.
  > Everything it does is labelled with its name and yours.
  >
  > It's also a complete whiteboard: kanban with WIP limits, mind maps, flowcharts from Mermaid,
  > guided retros, planning poker, dot voting, and two-way sync with Jira, Linear and GitHub. There
  > is no paid plan: SSO, SCIM and the audit log are free, and the whole thing is MIT licensed and
  > runs from one Docker image.
  >
  > I'd love feedback on the agent workflow, and on what would make you move a team over.
- **Gallery**: 1270×760 crops of the site screenshots (`apps/site/src/assets/shots/*-1600.webp`:
  workshop, proposal, review, tracker, kanban, mindmap, flowchart, control-room).
- **Needs from the owner**: a Product Hunt account (personal, not a company account), a launch date
  (Tuesday–Thursday, 00:01 PT), the gallery images exported to PNG, a 1-minute demo video (optional).

### Hacker News (Show HN)

Show HN rules (news.ycombinator.com/showhn.html, read 2026-11-02): it must be something you made
that people can try, "ideally without barriers such as signups or emails"; no landing pages.

- **The barrier to fix first**: editing on freero.app needs an account; guests on a shared link can
  only view or comment. Before posting, publish a **public demo board** (link access on, a board
  with a retro, a kanban and a Mermaid flowchart) and lead with it, and point to the GitHub repo
  and `docker compose up` so people can try it without signing up anywhere.
- **Title**: `Show HN: Freero – open-source whiteboard where AI agents propose and people accept`
- **URL**: `https://github.com/antonber/freero` (HN readers prefer the code; first add a link to https://freero.app and the demo board at the top of the README, which today names only the development login)
- **Text**:
  > Freero is an MIT-licensed collaborative whiteboard (React, TypeScript, Yjs, Postgres) with an MCP
  > server built in. Connect Claude, ChatGPT, Cursor or your own agent with OAuth, and it can read a
  > board as an outline and add notes, clusters, kanban cards or diagrams, laid out by the server so
  > the model never picks coordinates. By default a connection can only read and propose: proposals
  > show up as ghosts that someone on the board accepts or rejects, and every change is labelled with
  > the agent's name and the person it acts for.
  >
  > The rest is a normal whiteboard: kanban, mind maps, Mermaid paste, retros, planning poker,
  > two-way Jira/Linear/GitHub sync, SSO/SCIM. No paid tier. One Docker image; `docker compose up`
  > runs the stack locally.
  >
  > Demo board (no sign-up to look): <public board link>. Hosted: https://freero.app.
  > Happy to answer questions about the CRDT layer, the layout-from-structure API or the MCP side.
- **Needs from the owner**: the public demo board link; be around for the first hours to answer.

### Other free directories worth a listing

- **Slant** ("best online whiteboard" / "best Miro alternatives" questions): add Freero as an option
  with the AlternativeTo description.
- **G2 and Capterra**: free vendor listings exist but expect company details and reviews; low
  priority until there are users to review it.
- **Hosting marketplaces** (Railway templates, Coolify, CapRover, Cloudron, YunoHost apps): each
  is a one-click self-host listing and a backlink; Railway is the natural first one since freero.app
  runs there.
