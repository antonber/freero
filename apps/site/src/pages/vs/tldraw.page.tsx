// Freero vs tldraw. Facts: docs/marketing/competitors/tldraw.md (sourced rows only; source numbers
// follow the sheet's Sources list as T<n>), re-checked on 2026-11-02 for the SDK licence key, its
// pricing page and tldraw sync. "tldraw" is two products: tldraw.com (a free whiteboard) and the
// tldraw SDK; each row says which. Left out as "Could not verify": any SDK price (sales only; a
// third-party figure is not used), paid tiers, SSO or admin features of tldraw.com (absences found
// only by searching), the status of tldraw computer and Fairies, whether the MCP App endpoint needs
// sign-in, guest access on tldraw.com. Freero-side corrections to the sheet: in-chat live boards
// (MCP Apps) shipped (docs/parity.md §9), and the template count comes from the catalog.
import { defineComparison } from '../../lib/compare';
import { SITE_TEMPLATES } from '../../lib/templates';

export default defineComparison({
  slug: 'tldraw',
  competitor: 'tldraw',
  column: 'tldraw.com and the tldraw SDK',
  checked: '2026-11-02',
  published: true,
  title: 'tldraw alternative for teams: Freero vs tldraw',
  description:
    'tldraw.com is a free sketching board and its SDK needs a licence key in production. Freero is an MIT-licensed team whiteboard you can self-host. Sourced.',
  summary:
    'tldraw is two things: tldraw.com, a free, fast whiteboard the company runs as a showcase, and the tldraw SDK, a React library for building canvas apps, sold under its own source-available licence. Freero is an open-source whiteboard product for teams of people and AI agents, under the MIT licence.',
  trademark: 'tldraw is a trademark of its owner.',
  rows: [
    {
      capability: 'Free to use',
      competitor: { verdict: 'yes', note: 'tldraw.com is free; no paid plan found', sources: ['T1', 'T2'] },
      freero: { verdict: 'yes', note: 'every feature; default fair-use limits instead of plans', ref: 'docs/parity.md' },
    },
    {
      capability: 'Open-source licence',
      competitor: { verdict: 'no', note: 'the SDK is under the source-available “tldraw license”', sources: ['T3', 'T4'] },
      freero: { verdict: 'yes', note: 'MIT', ref: 'LICENSE' },
    },
    {
      capability: 'Use in production without a licence key',
      competitor: { verdict: 'no', note: 'SDK: without a key it stops rendering after five seconds; trial 100 days; hobby keeps a watermark', sources: ['T5'] },
      freero: { verdict: 'yes', note: 'no key, no watermark', ref: 'LICENSE' },
    },
    {
      capability: 'Price of a commercial licence',
      competitor: { verdict: 'paid', note: 'SDK: not published, “talk to sales”', sources: ['T6'] },
      freero: { verdict: 'no', note: 'no licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'Self-hosted team whiteboard, ready to run',
      competitor: { verdict: 'partial', note: 'SDK and tldraw sync run on your servers; authentication, permissions, rate limits and history are left to you', sources: ['T7'] },
      freero: { verdict: 'yes', note: 'accounts, roles, sharing, history and scaling out, in one Docker image', ref: 'docs/deployment.md' },
    },
    {
      capability: 'MCP access for AI agents',
      competitor: { verdict: 'yes', note: 'an MCP App with a canvas in chat, and a ChatGPT and Codex plugin for tldraw.com boards', sources: ['T8', 'T2'] },
      freero: { verdict: 'yes', note: 'on every server, self-hosted ones too; OAuth or tokens; a live board in Claude and ChatGPT', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Agent edits reviewed by people',
      competitor: { verdict: 'no', note: 'the plugin edits boards directly; no review step described', sources: ['T2'] },
      freero: { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Bring your own AI model',
      competitor: { verdict: 'partial', note: 'SDK starter kits, with your own API keys', sources: ['T10'] },
      freero: { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, local models included', ref: 'docs/ai.md' },
    },
    {
      capability: 'Embeddable editor for your own product',
      competitor: { verdict: 'yes', note: 'the SDK, with custom shapes, a sync engine and starter kits', sources: ['T11', 'T4'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
    {
      capability: 'Desktop app that works offline',
      competitor: { verdict: 'yes', note: 'tldraw offline: free, local files, no account', sources: ['T12'] },
      freero: { verdict: 'no', note: 'installs from the browser; rides out short disconnects only', ref: 'docs/parity.md' },
    },
    {
      capability: 'Accessibility target',
      competitor: { verdict: 'partial', note: 'the SDK 4.0 release claims WCAG 2.2 AA; no tldraw.com statement found', sources: ['T13'] },
      freero: { verdict: 'yes', note: 'WCAG 2.1 AA target, a board-as-list view', ref: 'docs/accessibility.md' },
    },
  ],
  competitorStronger: [
    'You are building a canvas into your own product: the SDK is made for that, and Freero has no embeddable editor.',
    'You want to open a page and sketch, with nothing to set up.',
    'You want a free desktop app that keeps boards as local files and works offline.',
    'You want the drawing feel and the large community of a widely used canvas library.',
  ],
  freeroStronger: [
    'You want a whiteboard product for a team, with accounts, roles, sharing and history, that you can run yourself under the MIT licence with no licence key.',
    'You need SSO, SCIM and an audit log on your own servers.',
    'You want AI agents to propose changes that people accept or reject, through an MCP server that runs on your own Freero server.',
    `You plan work on the board: two-way Jira, Linear and GitHub sync, kanban, timelines and ${SITE_TEMPLATES.length} templates.`,
    'You run workshops with voting, a timer, polls and planning poker.',
  ],
  sections: [
    {
      id: 'which',
      title: 'Which tldraw are you comparing?',
      placement: 'intro',
      body: (cite) => (
        <p>
          Most searches for a tldraw alternative are one of two: a team looking for a whiteboard to work on together, or a developer looking for a canvas library
          to build with. For the first, compare tldraw.com with Freero below. For the second, the tldraw SDK is a library and Freero is a finished product: Freero
          is not a drop-in replacement for the SDK {cite('T4', 'T5')}.
        </p>
      ),
    },
    {
      id: 'moving',
      title: 'Running Freero yourself',
      body: () => (
        <p>
          Freero ships as one Docker image; a Docker Compose file runs the whole stack on one machine. See <a href="/open-source">self-hosting Freero</a> and{' '}
          <a href="/security">security</a>, or connect <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a> to try the agent side first.
        </p>
      ),
    },
  ],
  faq: [
    {
      q: 'Is tldraw open source?',
      a: 'The tldraw SDK’s source is public, but it is licensed under the tldraw license, not an open-source licence: production use needs a licence key, and hobby licences keep a “made with tldraw” watermark. Freero is MIT licensed.',
    },
    {
      q: 'Can I self-host tldraw for my team?',
      a: 'You can run the tldraw SDK and tldraw sync on your own servers, but you build the product around them: tldraw’s docs leave authentication, permissions, rate limiting and long-term history to you. A self-hosted Freero server includes accounts, roles, sharing and version history.',
    },
    {
      q: 'Can Freero replace the tldraw SDK in my app?',
      a: 'No. Freero is a whiteboard product with a REST API, webhooks and an MCP server, not a component library you embed. If you are building a canvas into your own product, the SDK is the better fit.',
    },
  ],
  sources: [
    { id: 'T1', title: 'tldraw.com', url: 'https://tldraw.com', checked: '2026-10-28' },
    { id: 'T2', title: 'tldraw blog: Introducing tldraw for ChatGPT and Codex', url: 'https://tldraw.dev/blog/introducing-tldraw-for-chatgpt-and-codex', checked: '2026-10-28' },
    { id: 'T3', title: 'GitHub: tldraw LICENSE.md', url: 'https://github.com/tldraw/tldraw/blob/main/LICENSE.md', checked: '2026-10-28' },
    { id: 'T4', title: 'tldraw docs: License', url: 'https://tldraw.dev/community/license', checked: '2026-10-28' },
    { id: 'T5', title: 'tldraw docs: License key', url: 'https://tldraw.dev/sdk-features/license-key', checked: '2026-11-02' },
    { id: 'T6', title: 'tldraw: Pricing', url: 'https://tldraw.dev/pricing', checked: '2026-11-02' },
    { id: 'T7', title: 'tldraw docs: tldraw sync', url: 'https://tldraw.dev/docs/sync', checked: '2026-11-02' },
    { id: 'T8', title: 'tldraw blog: tldraw MCP App', url: 'https://tldraw.dev/blog/tldraw-mcp-app', checked: '2026-10-28' },
    { id: 'T10', title: 'tldraw docs: Agent starter kit', url: 'https://tldraw.dev/starter-kits/agent', checked: '2026-10-28' },
    { id: 'T11', title: 'tldraw blog: Announcing tldraw’s Series A', url: 'https://tldraw.dev/blog/announcing-tldraw-series-a', checked: '2026-10-28' },
    { id: 'T12', title: 'tldraw blog: tldraw offline', url: 'https://tldraw.dev/blog/tldraw-offline', checked: '2026-10-28' },
    { id: 'T13', title: 'tldraw releases: v4.0.0', url: 'https://tldraw.dev/releases/v4.0.0', checked: '2026-10-28' },
  ],
});
