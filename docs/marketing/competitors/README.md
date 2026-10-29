# Competitor fact sheets ("Freero vs X" pages)

Research notes for a later site-building agent that turns them into comparison pages. They are not
site copy: they hold facts, sources and suggested comparison tables. Everything was checked on
**2026-10-28** from public pages only, without logging in anywhere. Each sheet ends with a Sources
list and a "Could not verify" list. Read that list before publishing anything from the sheet.

Every sheet has the same 11 sections: what it is, pricing, AI and agents, self-hosting and licensing,
enterprise, Jira/Linear/GitHub integrations, where the competitor is stronger, where Freero is
stronger, a comparison table, keywords, and timely context.

## Index

| # | Competitor | Sheet | Status (2026-10-28) | Pricing headline (USD, per seat per month) | Primary keywords |
|---|---|---|---|---|---|
| 1 | Miro | [miro.md](miro.md) | Active. Acquired by Bending Spoons, closed 2026-10-26 | Free: 3 editable boards. Starter $8, Business $20 (annual billing). Enterprise custom | free / open source / self-hosted Miro alternative |
| 2 | Microsoft Whiteboard | [microsoft-whiteboard.md](microsoft-whiteboard.md) | Standalone apps retired 2026-10-16; personal-account editing ended 2026-09-25; continues in Teams and on the web for work/school accounts | No price of its own; comes with Microsoft 365 (reported from Business Basic, $7). Copilot costs extra | Microsoft Whiteboard alternative / retirement / app retired |
| 3 | Mural | [mural.md](mural.md) | Active | Free: 3 editable murals. Team+ $9.99 annual ($12 monthly), Business $17.99 annual | free / open source / self-hosted Mural alternative |
| 4 | FigJam | [figjam.md](figjam.md) | Active (Figma is listed on NYSE: FIG) | Starter free: 3 FigJam files per team. Collab seat $3 (Professional) or $5 (Organization/Enterprise), annual | free / open source FigJam alternative, FigJam vs Freero |
| 5 | Excalidraw / Excalidraw+ | [excalidraw.md](excalidraw.md) | Active. MIT open source, like Freero | excalidraw.com free. Excalidraw+ $6/user | Excalidraw alternative for teams, self-hosted Excalidraw alternative |
| 6 | Confluence whiteboards | [confluence-whiteboards.md](confluence-whiteboards.md) | Active, Cloud only. Data Center reaches end of life 2029-03-28 | Free up to 10 users. Standard about $5.78 (300-user average; $7.15 monthly for small teams). SSO, SCIM and audit log need Atlassian Guard | Confluence whiteboard alternative, self-hosted alternative |
| 7 | Google Jamboard | [jamboard.md](jamboard.md) | Shut down 2024-12-31 ("Jamboard alternative" page) | Historical: the app was free; the board cost $4,999 plus $600/yr | Jamboard alternative / replacement / for teachers |
| 8 | tldraw | [tldraw.md](tldraw.md) | Active. SDK under its own source-available licence | tldraw.com free. The SDK's commercial licence is quoted by sales; no published price | tldraw alternative, tldraw vs Freero |
| 9 | Lucidspark | [lucidspark.md](lucidspark.md) | Active | Free: 3 editable boards. Individual $9, Team $10 (annual). **Secondary source:** Lucid's page was unreadable | free / open source Lucidspark alternative |
| 10 | ClickUp Whiteboards | [clickup-whiteboards.md](clickup-whiteboards.md) | Active. Price grid reported to be under A/B test since about 2026-10-15 | Free: 3 whiteboards. Core $9, Business $17 (annual) | ClickUp whiteboard alternative |
| 11 | Notion | [notion.md](notion.md) | Still **no native whiteboard or canvas** (release notes through 2026-10-19) | Plus $10 annual / $12 monthly. Business $20 / $24 | Notion whiteboard, whiteboard for Notion |
| 12 | Canva Whiteboards | [canva-whiteboards.md](canva-whiteboards.md) | Active | Whiteboards on Free. Pro $12 (one person); Business $20.83 annual. **Secondary source:** canva.com returned 403 | Canva whiteboard alternative |

## Build order

We have no keyword-volume data: no public source was used and no keyword tool was queried. Before
committing effort, check the order against a keyword tool (Google Keyword Planner, Ahrefs, Semrush or
similar). The ranking below weighs three things:

- **Likely search demand.** Brand size and how often people look for a way off the product.
- **Timeliness.** Something happening now that sends people looking.
- **Strategic fit.** How directly the page can show Freero's real differentiators: built-in MCP with
  human-reviewed agent edits, bring-your-own AI model, two-way Jira, Linear and GitHub sync,
  MIT-licensed self-hosting, and SSO, SCIM and an audit log at no cost.

1. **Miro.** It is the category leader with the most "alternative" searches. Bending Spoons closed its
   acquisition on 2026-10-26, which is a natural moment for customers to look around. The fit is the
   best of any page: Miro has an MCP server with daily call caps, AI credits, a Linear app limited to
   Business, retired webhooks, and SSO, SCIM and audit logs behind higher plans. Each of those
   compares directly with something Freero documents.
2. **Microsoft Whiteboard.** The most time-sensitive page. The standalone apps retired on 2026-10-16,
   personal accounts lost editing on 2026-09-25, and the Azure service shuts down on 2026-11-30, so
   searches are happening now. The best audience is personal-account users and people without
   Microsoft 365, for whom Freero is free. The framing must be exact: Whiteboard is **not** shut
   down for work and school accounts (see the correction at the top of that sheet).
3. **Mural.** The second enterprise whiteboard and a close match for Freero's message. Mural's MCP
   server is still in public preview, and it added Linear and GitHub integrations on 2026-09-08. The
   page can compare them precisely: Mural's GitHub integration shows PR cards and creates issues,
   while Freero syncs issues both ways.
4. **FigJam.** A large audience of product and engineering teams. Figma's MCP allows few calls on the
   seats FigJam users usually hold, and its Jira widget works with Jira Cloud only. Both are
   documented, specific contrasts.
5. **Excalidraw.** The developer and open-source audience, which suits "teams of people and AI
   agents" best. This page must not argue open source, because Excalidraw is MIT too. The real
   difference is what self-hosting gives you. Freero self-hosted includes live collaboration,
   accounts, roles, SSO, an MCP server and tracker sync. Excalidraw's own docs say its self-hosted
   edition doesn't support sharing or collaboration.
6. **Confluence whiteboards.** Strong fit for teams on Jira. Confluence whiteboards run only on
   Atlassian Cloud and won't come to Data Center, which itself ends in 2029. Freero syncs with Jira
   Data Center and can be self-hosted. Search demand is probably modest.
7. **Jamboard.** Probably still a high-volume query, but demand peaked in 2023–24 and the audience is
   mostly teachers, which is a weaker fit for the agents positioning. Two honest drawbacks for this
   page: Freero has no Jamboard importer, and FigJam has one.
8. **tldraw.** A developer audience with a clear licensing contrast: tldraw's SDK is
   source-available and needs a licence key in production. But much of tldraw's search demand is
   developers looking for an SDK, not teams looking for a whiteboard, so intent is mixed.
9. **Lucidspark.** Moderate demand. Its strengths (FedRAMP, the Lucidchart bundle) reach buyers
   Freero can't serve today. Build this page only after confirming prices on Lucid's own page.
10. **ClickUp Whiteboards.** The contrast is crisp: ClickUp whiteboards have no API or MCP access. But
    people rarely choose a whiteboard separately from ClickUp, so search demand is low. Wait until
    ClickUp's A/B pricing settles.
11. **Notion.** Notion has no whiteboard, so this is really a "whiteboard for Notion users" page.
    Freero has no Notion integration, so the fit is limited. Searches for "Notion whiteboard" are
    informational and probably large, which makes this better as a content or SEO article than a
    "vs" page.
12. **Canva Whiteboards.** Its audience is design and marketing, the weakest fit for Freero's
    differentiators. Canva also blocked our fetcher, so prices come from a secondary source.

## Using Freero's own claims safely

- **Cite the docs the sheets cite:**
  - `docs/mcp.md` (MCP server)
  - `docs/ai.md` (built-in AI)
  - `docs/trackers.md` (Jira, Linear and GitHub sync)
  - `docs/configuration.md` (SSO, SCIM and other settings)
  - `docs/accessibility.md`
  - `LICENSE`, `README.md`, `docs/deployment.md`
  - `ARCHITECTURE.md`

  `docs/parity.md` has since been refreshed and is current (checked 2026-10-28 when the first pages
  were built). Corrections to the sheets: the catalog has **74** templates, not 73 (`README.md` and
  parity agree); guests without an account can **view and comment, not edit** (parity §11
  "Anonymous visitors": at most commenter); and Freero's live board inside Claude and ChatGPT
  (MCP Apps) has shipped (parity §9).
- **Hosted Freero is unconfirmed.** `docs/mcp.md` mentions "the hosted service", but no sheet claims
  a hosted Freero or a price for one. Until it exists, "free" means no licence fee for software you
  run yourself. Say "no licence fees" or "free and self-hostable", not "costs $0", because
  self-hosters pay for their own servers.
- **Claim only what's on the released version.** The repo has work in review on branches. A page's
  "Yes" should match the release a visitor can actually run.
- **Built-in AI is "Partial" everywhere.** It does nothing until someone connects a model, and Freero
  has no chat assistant, AI workflows, image generation or semantic search (`docs/ai.md`). Keep it
  that way in the tables.
- **The same gaps appear in every sheet; don't hide them:**
  - no native apps (PWA only)
  - no marketplace or SDK
  - a smaller template library (73)
  - no SOC 2 or ISO certifications, customer-managed keys, DLP or eDiscovery
  - no hosted data-residency regions
  - no built-in calls
  - no importer from other whiteboards
  - English only

## Legal and brand cautions for comparative pages

This is a checklist, not legal advice. Have counsel review the first page and the template before
publishing.

1. **Comparisons must be truthful, objective and verifiable.**
   - **US:** the FTC encourages naming competitors, as long as comparisons are truthful and not
     deceptive, and claims are substantiated (16 CFR 14.15:
     https://www.law.cornell.edu/cfr/text/16/14.15).
   - **EU:** Directive 2006/114/EC, Article 4, allows comparative advertising only if all of these
     hold:
     - it isn't misleading;
     - it compares goods that meet the same needs;
     - it objectively compares material, relevant, verifiable and representative features (price
       included);
     - it doesn't discredit or denigrate the competitor or its marks;
     - it doesn't take unfair advantage of a mark's reputation;
     - it doesn't present Freero as an imitation or replica.

     Source: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32006L0114
   - **UK:** the CAP Code rules 3.32–3.34 say much the same; the marketer must hold evidence for each
     claim, and comparisons must be verifiable
     (https://www.asa.org.uk/advice-online/comparisons-identifiable-competitors.html, page dated
     2026-08-27).

   **In practice:** keep the source URL and check date behind every cell. Link a "Sources and dates"
   section from each page so readers can verify. Never state a competitor fact you couldn't verify:
   each sheet's "Could not verify" list is a do-not-publish list until it's resolved.
2. **Date every price.** Write "as of <date>". Say whether the price is billed annually or monthly,
   name the currency, and say per member or per seat. Re-check prices before each publish and at
   least every quarter.
   - Several prices are volatile right now: ClickUp's grid is under A/B test, Canva's Pro price
     changed twice between July and September 2026, Atlassian prices rose about 7% on 2026-10-13, and
     Notion's AI credits change on 2026-11-02.
   - Prices taken from secondary sources (Lucidspark, Canva, Microsoft 365) are marked in those
     sheets. Confirm them on the vendor's page before publishing.
   - Don't call Freero "cheaper" without saying that self-hosting has infrastructure and operations
     costs.
3. **Use competitor names only to identify them (nominative use).**
   - Use the name in plain text and only as much of it as you need.
   - **No logos, product screenshots, brand colors or fonts**, and nothing that suggests a
     partnership or endorsement. In US law this is the New Kids on the Block test
     (https://en.wikipedia.org/wiki/Nominative_use).
   - Add a footer such as "Miro is a trademark of its owner. Freero is not affiliated with or endorsed
     by Miro."
   - Follow each vendor's trademark guidelines. Atlassian, for example, asks that its marks be no
     more prominent than the surrounding text and be used referentially ("for Jira", not "Jira X"):
     https://www.atlassian.com/legal/trademark
   - Freero uses its own brand (`apps/web/src/ui/tokens.css`). Never copy competitors' copy, icons,
     templates or UI (`CLAUDE.md`).
4. **Don't disparage, and don't speculate.**
   - Say what is confirmed. The Bending Spoons acquisition of Miro is confirmed and closed. Anything
     about later layoffs or price rises is speculation unless reported, and then it must say
     "reported" with a source.
   - Don't imply that a competitor will decline.
   - State retirements exactly. For example: "Microsoft retired the standalone Whiteboard apps on
     2026-10-16". Not: "Microsoft Whiteboard is shut down".
   - Describe tldraw as "source-available", not "closed source".
5. **Search ads.** Google doesn't restrict competitor trademarks as keywords. It may restrict them
   in ad text if the owner complains about a direct competitor, though informational landing pages
   are an exception (https://support.google.com/adspolicy/answer/6118). Keep ad text generic ("a
   free, open-source whiteboard"), and put the comparison on the landing page. Atlassian also has
   its own keyword policy for its marks:
   https://developer.atlassian.com/platform/marketplace/adwords-trademark-policy/
6. **Corrections channel.** Give every comparison page a "last checked" date and a way to report a
   mistake. Fix verified errors quickly; vendors do complain about comparison pages.

## Keeping this current

- Re-run the research per sheet before its page is built, and at least every quarter after that.
  Update the date at the top of the sheet and in its Sources list.
- Watch these:
  - Miro after the Bending Spoons acquisition: plans, layoffs, MCP caps.
  - Mural's MCP, now in preview.
  - Figma: MCP seat limits and the Figma agent in FigJam.
  - Excalidraw+ self-hosting and SSO, both on its roadmap.
  - Atlassian's MCP v2 whiteboard support; v1 connections move on 2027-03-01.
  - Notion's rebuilt Jira and GitHub syncs.
  - Microsoft's Azure Whiteboard service shutdown on 2026-11-30.
- When Freero ships something on the gap list (the MCP Apps board preview, KAI-171; importers;
  certifications), update the Freero column in every table, not just one sheet.
