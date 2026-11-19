// "Best Miro alternatives" (docs/marketing/seo.md: a listicle-owned SERP). A roundup (lib/lists.tsx):
// every competitor line and fact comes from a published /vs page.
import { defineList } from '../../lib/lists';
import { SITE_TEMPLATES } from '../../lib/templates';
import { comparison as confluence } from '../vs/confluence-whiteboards.page';
import { comparison as excalidraw } from '../vs/excalidraw.page';
import { comparison as figjam } from '../vs/figjam.page';
import { comparison as microsoftWhiteboard } from '../vs/microsoft-whiteboard.page';
import { comparison as miro } from '../vs/miro.page';
import { comparison as mural } from '../vs/mural.page';
import { comparison as tldraw } from '../vs/tldraw.page';

export default defineList({
  slug: 'best-miro-alternatives',
  name: 'Best Miro alternatives',
  question: 'The best Miro alternatives in 2026',
  title: 'Best Miro alternatives in 2026, compared | Freero',
  description:
    'Seven Miro alternatives and who each one suits: Freero, Mural, FigJam, Confluence whiteboards, Microsoft Whiteboard, Excalidraw and tldraw. Sourced, dated.',
  updated: '2026-11-19',
  answer:
    'The right one depends on what you need from Miro. Mural suits facilitated workshops, FigJam teams that design in Figma, Confluence whiteboards teams on Atlassian, and Microsoft Whiteboard organizations on Microsoft 365. Excalidraw and tldraw are for quick sketching. Freero, which we make, is for teams that want it free, open source and ready for AI agents.',
  criteria: [
    'A whiteboard a team can use today, hosted or on its own servers. Jamboard is gone, so it isn’t here.',
    'Each product’s facts come from its own public pages, checked and dated, and every fact in the table cites its source.',
    'Each pick says who it suits and when to choose it over Freero.',
    'Nobody paid to be listed, and there are no affiliate links. After Freero, the picks run from the closest to Miro (a hosted team workspace) to the lightest.',
  ],
  freero: {
    bestFor: 'teams that want Miro’s core for free, on their own servers if they like',
    chooseIf: [
      'You want every feature without a plan: SSO, SCIM, the audit log, two-way Jira, Linear and GitHub sync and the MCP server are all in the free product.',
      'You want to run the whiteboard yourself, under the MIT licence, in the region you choose.',
      'You want AI agents such as Claude and ChatGPT to propose changes that people accept or reject, with no daily quota on MCP calls.',
      'You are moving from Miro: Freero imports a Miro board’s sticky notes, shapes, text, frames, connectors, cards, images and tags through Miro’s API.',
    ],
    lookElsewhereIf: [
      'You need native desktop or mobile apps today: Freero runs in the browser and installs as a web app.',
      'Your security review asks for certifications such as SOC 2 or ISO 27001: Freero has none.',
      `You rely on a large ecosystem: Freero has ${SITE_TEMPLATES.length} templates of its own but no community gallery and no in-board apps.`,
      'You want AI that works with nothing to set up: Freero’s built-in assistant stays off until a workspace admin connects a model.',
    ],
  },
  picks: [
    { product: mural, bestFor: 'facilitated workshops at scale', chooseIf: ['methods library', 'Azure DevOps, Rally', 'support tiers'] },
    { product: figjam, bestFor: 'teams that already design in Figma', chooseIf: ['designs in Figma', 'big ecosystem', 'native desktop and mobile apps'] },
    { product: confluence, bestFor: 'teams that live in Confluence and Jira Cloud', chooseIf: ['lives in Confluence', 'Rovo', 'small team'] },
    { product: microsoftWhiteboard, bestFor: 'organizations on Microsoft 365 and Teams', chooseIf: ['already pays for Microsoft 365', 'compliance team', 'Surface Hub'] },
    { product: excalidraw, bestFor: 'quick diagrams with a hand-drawn look', chooseIf: ['open a page and draw', 'hand-drawn look', 'offline without an account'] },
    { product: tldraw, bestFor: 'developers building a canvas into their own product', chooseIf: ['building a canvas', 'open a page and sketch', 'desktop app'] },
  ],
  matrix: {
    title: 'Miro and its alternatives, compared',
    lead: 'Plans, your own servers and AI agents side by side. Miro is in the first row for reference.',
    caption: 'Miro and its alternatives: plans, own servers and MCP',
    columns: ['Free plan', 'Paid plans', 'Team use on your own servers', 'MCP server for AI agents'],
    rows: [
      { product: miro, cells: ['Free plan', 'Paid plans', 'Run it on your own servers', 'MCP server for AI agents'] },
      { product: mural, cells: ['Free plan', 'Paid plans', 'Open source, on your own servers', 'MCP server for AI agents'] },
      { product: figjam, cells: ['Free plan', 'Paid seats', 'Open source, on your own servers', 'MCP server for AI agents'] },
      { product: confluence, cells: ['Free plan', 'Price', 'On your own servers', 'MCP server for AI agents'] },
      {
        product: microsoftWhiteboard,
        cells: ['Without a paid subscription', null, 'Open source, on your own servers', 'AI agents on boards (MCP)'],
      },
      { product: excalidraw, cells: ['Free to use', 'Paid plan', 'Live collaboration when self-hosted', 'MCP server for AI agents'] },
      { product: tldraw, cells: ['Free to use', 'Price of a commercial licence', 'Self-hosted team whiteboard, ready to run', 'MCP access for AI agents'] },
    ],
    freero: [
      { verdict: 'yes', note: 'every feature; default fair-use limits instead of plan limits', ref: 'docs/parity.md' },
      { verdict: 'no', note: 'no licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
      { verdict: 'yes', note: 'MIT licence; accounts, roles, sharing, history and live collaboration, in one Docker image', ref: 'docs/deployment.md' },
      { verdict: 'yes', note: 'agents start with read and suggest; per-minute rate limits, no daily quota', ref: 'docs/mcp.md' },
    ],
  },
  notListed: [
    [
      'Jamboard',
      <>
        Google shut it down at the end of 2024. <a href="/vs/jamboard">Freero vs Jamboard</a> covers where its boards can go.
      </>,
    ],
  ],
  related: [
    ['/vs/miro', 'Freero vs Miro, row by row'],
    ['/vs', 'Every comparison, sourced and dated'],
    ['/open-source', 'Run Freero on your own servers'],
    ['/answers/free-whiteboard-without-board-limit', 'A free whiteboard without a three-board limit'],
    ['/pricing', 'Pricing and default limits'],
  ],
  faq: [
    {
      q: 'What is the best free Miro alternative?',
      a: 'For a team that wants Miro’s features without a plan, Freero: it has no paid plans, and SSO, the audit log, tracker sync and the MCP server are in the free product. For quick sketches with no account at all, Excalidraw or tldraw. We make Freero, so weigh that, and check each comparison’s sources.',
    },
    {
      q: 'Is there an open-source Miro alternative I can host myself?',
      a: 'Yes. Freero is MIT licensed and runs on your own servers with Docker, with accounts, roles, sharing and live collaboration included. Excalidraw is MIT licensed too, but its own documentation says self-hosting does not support sharing or collaboration. The tldraw SDK is source-available, not open source.',
    },
    {
      q: 'Which Miro alternative works best with AI agents like Claude and ChatGPT?',
      a: 'Several have MCP servers now: Mural’s is in preview, Figma’s reaches FigJam, and Atlassian’s reaches Confluence whiteboards. Freero is the one where agents start with read and suggest permissions, so their changes wait for a person to accept them, and there is no daily cap on calls.',
    },
    {
      q: 'Can I move my Miro boards to another whiteboard?',
      a: 'Into Freero, yes: paste a board’s link and a read-only token from a Miro app you create, and Freero brings over its sticky notes, shapes, text, frames, connectors, cards, images and tags, up to 2,000 items per import. Comments, documents and mind-map nodes stay in Miro, because its API doesn’t give them out.',
    },
  ],
});
