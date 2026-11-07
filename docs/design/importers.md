# Importers from other whiteboards: what each vendor's terms allow, and what Freero builds

Status: **decided and built** for #62 (Miro), #163 (Mural), #164 (FigJam) and #165 (Lucidspark,
Whimsical). Terms read on **2026-11-04** from the vendors' own pages (URLs below). This is a product
engineer's reading of public terms, not legal advice: where a verdict carries a risk, the risk is
named, and the owner can turn the one API importer off (`MIRO_IMPORT=off`).

## The question

May a third-party tool, acting with the end user's **own** OAuth or API token and only for **that
user's own boards**, read their board content to import it into another product? For each vendor:
clauses against competitive use, scraping or storing data, and the rate limits.

## Summary

| Vendor | Verdict | What Freero builds |
|---|---|---|
| Miro (#62) | **Allowed with conditions** | API importer with the person's own Miro token (their own private Miro app), read-only, paged and bounded, nothing stored |
| Mural (#163) | **Not allowed** (API) | Import of Mural's own CSV download (stickies with text, colour, position, area, tags, links) |
| Figma / FigJam (#164) | **Unclear** (API) | No API importer. FigJam's own sticky and table CSV exports already import through Freero's CSV import; PNG / PDF exports as pictures and PDF items |
| Lucid / Lucidspark (#165) | **Unclear** (API) | Import of Lucid's own "CSV of Shape Data" export (Lucidspark and Lucidchart): stickies, shapes, frames from containers, connectors and tags, laid out automatically. Lucidchart's Visio export already imports (#116) |
| Whimsical (#165) | **Not allowed** (no public board API) | Nothing new: Whimsical's own "Copy as Mermaid" pastes into Freero as an editable diagram (KAI-119); PNG / PDF exports as pictures |

## Miro (#62) — allowed with conditions

Sources: [Developer Terms of Use](https://miro.com/legal/developer-terms-of-use/) (published
25 Oct 2022, effective 25 Nov 2022), [Terms of Service](https://miro.com/legal/terms-of-service/)
(effective 1 Sep 2021), [REST API rate limiting](https://developers.miro.com/reference/rate-limiting),
[Get items on board](https://developers.miro.com/miro-ea/reference/get-items-1.md). Read 2026-11-04.

Facts:

- The licence covers apps for the developer's own use: Developer Terms §1.1 grants use "solely to
  develop, test, and support applications and integrations … for your internal use of the Service
  ("Private Apps")", or Public Apps published on the Miro Marketplace (which need Miro's approval,
  §4.3).
- §3.3(b) forbids accessing the Developer Tools "by means other than as described in the
  documentation provided by Miro, including for the intention of developing a competing or
  similar product and/or feature." §3.3(f) limits use to "facilitate the integration and/or use of
  Your Apps with the Service." §3.3(m) forbids competitive analysis and benchmarks.
- The Terms of Service §2.9(c) forbid a customer to "use the Service to develop a similar or
  competing product or service"; §12: "Customer retains all intellectual property and other rights
  in Customer Content"; §4.4 lets the customer export it "using the export features".
- Data (§5.1, §5.2): consent before collecting or storing data; never share it with third parties;
  delete it within fourteen business days of uninstall; stored data strongly encrypted.
- Rate limits are per user per app: 100,000 credits a minute; "Get items on board" is Level 2
  (100 credits, 10–50 items a page, `cursor` paging); §3.4 forbids circumventing limits.

Reading: the competitive-product language attaches to undocumented access (§3.3(b)) and to building
a product with the Service (ToS §2.9(c)). A person reading their own boards through the documented
REST API, with a token from a Miro app they made for their own team, to move content they own, is
neither. Freero registers no Miro app, holds no Miro credential and lists nothing on the
Marketplace. **Risk:** Miro could read §3.3(b)'s "competing … feature" or the non-sublicensable
licence (a person handing their app's token to Freero's server) more broadly; Freero does not
advertise the importer with Miro's name or marks beyond naming the source, and the operator switch
turns it off.

Conditions Freero meets (and tests):

1. **The person's own token**, typed into the import dialog, from a Miro app they create for their
   own team with only `boards:read`. Freero has no Miro app or credential of its own.
2. **Documented endpoints only** (`/v2/boards/{id}`, `/items`, `/connectors`, `/tags`, image
   resources), read-only.
3. **Nothing stored**: the token lives in memory for the one request and is sent only to Miro's
   API origin (never to the image host Miro links to, never logged, never in the response); the
   board's content goes only into the board the person is editing. Images go through the upload
   checks into the person's own uploads, like any picture they add.
4. **Within the limits**: pages of 50, at most `MAX_ITEMS` (2,000) items and connectors, at most
   100 pictures, a 429 from Miro is reported (no retry storm), and the route has its own per-person
   rate limit.
5. **Consent**: the person starts each import; the dialog says what is read and that the token is
   not kept. Cancel really cancels (#193): the request is aborted, the server stops reading and
   copying pictures, and an answer already on its way is never placed (as for a file whose
   pictures are still being stored).

What the API does not give: comments (no public comments endpoint), groups, app cards' fields,
embeds, documents, mind-map nodes (experimental API). The import report lists them.

## Mural (#163) — not allowed (API)

Sources: [API Policy](https://mural.co/terms/api-policy) (last updated 29 Mar 2023; shown as
"[Archive] … outdated", with no link to a newer version), [Main Services
Agreement](https://mural.co/terms/main-services-agreement) (effective 7 Mar 2023, also shown as
archived), [Terms index](https://www.mural.co/terms), [EU Data Act
page](https://mural.co/terms/eu-data-act), [Download to CSV
lesson](https://learn.mural.co/lessons/add-data-from-spreadsheets-to-mural). Read 2026-11-04.

Facts:

- API Policy, "Respect Our Business and Property", prohibits "Accessing or using our APIs or
  documentation to replicate or compete with the Services;" and "Attempting to use our APIs in a
  manner that exceeds rate limits".
- Main Services Agreement §2.4(v): the customer may not "access the Services to compete with Mural
  or build a competitive product or service."
- Mural's EU Data Act page commits to letting customers extract their content in common formats
  (including PDF) when switching provider.
- Mural's own "Download to CSV" (select, right-click) includes ID, text, background colour, sticky
  type, border, X/Y position, area name and link.

Verdict: an importer in a competing whiteboard built on Mural's API is what the API Policy names.
The newest version we can read says no, and no newer version is published. **No API importer.**

Built instead: **Mural CSV import** (`features/import/lib/mural.ts`). Header (as Mural writes it):
`ID, Text, BG Color, Sticky type, Border line, Position X, Position Y, Area, Link to, Last Updated
By, Last Updated, Last Content Edited By, Last Content Edited, Tags, Integration Labels`. Stickies
keep text, colour (nearest Freero sticky colour), position (sizes aren't in the file: every sticky
gets the standard size and positions are scaled so they don't overlap), tags and link; each Area
becomes a frame around its stickies. Who edited what (personal data) is not imported. Mural's PDF
export places as a PDF item or its pages as pictures (`features/pdf`).

## Figma / FigJam (#164) — unclear (API)

Sources: [Developer Terms](https://www.figma.com/developer-terms/) (effective 5 May 2026),
[Acceptable Use Policy](https://www.figma.com/aup/) (last updated 7 Oct 2026), [Terms of
Service](https://www.figma.com/legal/tos/) (effective 11 Mar 2026), [REST API rate
limits](https://developers.figma.com/docs/rest-api/rate-limits) (in force since 17 Nov 2025),
[Export your FigJam board](https://help.figma.com/hc/en-us/articles/4407699832855). Read 2026-11-04.

Facts:

- Developer Terms §2: a licence "to access and use the Developer Resources only as necessary to
  develop, test, and support an integration or other connection … with the Services"; §1: "All
  Developer Resources must be used in accordance with Figma's Acceptable Use Policy."
- Acceptable Use Policy §2(e): you may not "use the Services to compete with Figma, or copy any
  ideas, features, functions, or graphics of the Services;" §2(j) forbids systematic extraction
  or programmatic access "except as expressly permitted by Figma".
- Developer Terms §4(f): "Figma Integrations must allow data to flow both directions." and "Figma
  may disallow any Figma Integrations from using Figma APIs if they block write-back tool calls."
- Rate limits: `GET file` is Tier 1 — 20 requests **a month** for View and Collab seats, 10–20 a
  minute for Full and Dev seats.
- ToS §2.8: "Customer retains all right, title, and interest in Customer Content".
- FigJam's own exports: PNG, JPG, PDF, and CSV for stickies ("Each sticky note translates to a
  cell in a CSV file") and for tables.

Verdict: the developer terms have no competitor clause, but they pull in the AUP, whose §2(e) is
broad enough to cover a FigJam-to-Freero importer, and §4(f)'s two-way rule doesn't fit a one-way
import. Freero's existing Figma integration ("Place from Figma", #171) places design frames on a
board — a connection with Figma, not a way off it — and is unaffected. **No API importer** until
Figma confirms in writing (an owner task: ask Figma developer relations).

Built instead: nothing new was needed. FigJam's sticky CSV (`Content`, `Created by`) and table CSV
import through Freero's CSV import (`features/csv`: the `Content` column becomes the text; the
author column is not mapped to an assignee); PNG and PDF exports place as a picture or a PDF item.
FigJam's `.jam` local copy is a private binary format and is not read.

## Lucid / Lucidspark (#165) — unclear (API)

Sources: [Legal hub](https://lucid.co/legal), [Developer Terms of
Service](https://lucid.co/developer-terms) (the page renders its text through a third-party
viewer; no text could be retrieved), a [Terms of Service
copy](https://d7umqicpi7263.cloudfront.net/eula/hvI_YyucMfiPlMHb-FVVeczM6USWkRSl2utTxl-oX7w)
(last updated 7 Jul 2021; the live [lucid.co/tos](https://lucid.co/tos) renders the same way),
[Get document contents](https://developer.lucid.co/reference/getdocumentcontent), [Export or print
a Lucid document](https://help.lucid.co/hc/en-us/articles/16324571257492). Read 2026-11-04.

Facts:

- The Developer Terms "govern your access to and use of the Application Programming Interface"
  (legal hub); their text could not be read.
- The Terms of Service copy forbids using the Services "for competitive purposes" (§ on use
  restrictions, (c)) and access "by any means other than Lucid's publicly supported interfaces,
  including through any automated means" ((h)).
- "Get document contents" returns pages, shapes, lines, groups and their text, but **no positions
  or sizes**; rate limit 100 requests per 5 seconds per account; scopes
  `lucidspark.document.content:readonly` and others.
- Lucidspark and Lucidchart export a "CSV of Shape Data" from the document menu (Export ▸ CSV of
  Shape Data).

Verdict: the governing API terms couldn't be read and the general terms bar competitive use; the
API also lacks positions, so it would import no better than the export. **No API importer.**

Built instead: **Lucid CSV import** (`features/import/lib/lucid.ts`). Header (as Lucid writes it):
`Id, Name, Shape Library, Page ID, Contained By, Group, Line Source, Line Destination, Source
Arrow, Destination Arrow, Status, Text Area 1 … n, Comments, …` (more columns for custom data).
Pages become frames side by side; containers (Lucidspark frames, Lucidchart containers and swim
lanes) become frames holding their children; sticky notes become stickies, other shapes the
nearest Freero shape, lines connectors attached at both ends (arrows kept); tags become tags.
Comments are counted in the report, not posted: they would appear under the importing person's
name. The export has no positions, sizes or colours: the items are laid out by their connections
(layers left to right), the rest in a grid, and the report says so.

## Whimsical (#165) — not allowed (no public board API)

Sources: [Terms of Service](https://whimsical.com/terms) (last updated 30 Jul 2025), [Exporting
content from Whimsical](https://whimsical.com/learn/imports-exports/exporting-from-whimsical)
(undated), [community: "is there no API?"](https://community.whimsical.com/t/am-i-stupid-or-there-no-api/710).
Read 2026-11-04.

Facts:

- Whimsical publishes no board API; third-party listings describe an invitation-only, read-only API
  without board or element access (not first-hand).
- Terms: you may not "Use any robot, spider, or other automatic device, process, or means to access
  the Services for any purpose"; Whimsical claims no ownership of Customer Content.
- Exports: PNG (board or frames), PDF (print), SVG (Copy as ▸ SVG; the `/svg` board URL is
  experimental per Whimsical's own page), and **Mermaid** for flowcharts and sequence diagrams
  ("The code preserves shape styles, colors, and grouping (as subgraphs).").

Verdict: there is no sanctioned API to build on and automated access is barred. **No API
importer.**

Built instead: nothing new. Whimsical's "Copy as ▸ Mermaid" pastes into Freero as an editable
Mermaid diagram with its subgraphs (KAI-119, #117); PNG and PDF exports place as pictures or a PDF
item. An SVG importer was not built: Whimsical calls its SVG export experimental, and a parser
written without real exports would guess.

## How the importers are built

- **File importers** (Mural CSV, Lucid CSV) are parsers in `features/import/lib/` like the
  draw.io, Excalidraw, Visio and PowerPoint ones: pure, size-capped, every cell treated as untrusted
  plain text (`htmlToPlain` → `richLabel`), at most `MAX_ITEMS` items, placed by `placeImport` in
  one undo step with the same report. A dropped `.csv` is recognised by its header; any other CSV
  still goes to the CSV import.
- **Miro** is the one API importer: server `modules/importers` (no table) reads the board with the
  token from the request body and returns a bounded, type-checked subset of Miro's items
  (`@freero/shared` "Board import"); pictures are copied into the person's uploads there (the token
  sent only to the API origin; the picture's own link fetched through unfurl's SSRF-safe fetch,
  https only); `features/import/lib/miro.ts` maps it to drafts in the browser. `Host.boardImport`;
  `BoardPermissions.miroImport`.
- Tests guard the failures that matter: the token never reaches logs, the response or the image
  host; hostile content arrives as plain text; a huge board is paged and stops at the cap.
- `scripts/lib/mock-miro.mjs` is a stand-in Miro for the tests and for trying the dialog by hand
  (`MIRO_API_URL`).
