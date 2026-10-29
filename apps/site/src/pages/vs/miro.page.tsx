// Freero vs Miro (#70). Facts about Miro: docs/marketing/competitors/miro.md (sourced rows only; its
// "Could not verify" list is left out: monthly prices, which plans can choose EU hosting, Jira Cards'
// plans and Data Center support, the MCP beta label and Flow caps). Source ids follow the sheet.
// Freero facts: docs/parity.md and the docs each row links (guests are view-and-comment, not editors,
// although the sheet says otherwise).
import { defineComparison } from '../../lib/compare';

export default defineComparison({
  slug: 'miro',
  competitor: 'Miro',
  checked: '2026-10-28',
  published: true,
  title: 'Free, open-source Miro alternative: Freero vs Miro',
  description:
    'Freero and Miro compared: plans, MCP and AI agents, Jira, Linear and GitHub sync, SSO and self-hosting. Sourced and dated, including where Miro is ahead.',
  summary:
    'Miro is a hosted visual workspace sold in per-member plans, with a large template and app ecosystem and AI credits on each plan. Freero is an open-source whiteboard for teams of people and AI agents: no paid plans, every feature included, and you can run it on your own servers.',
  rows: [
    {
      capability: 'Free plan',
      competitor: { verdict: 'partial', note: '3 editable boards', sources: ['S3'] },
      freero: { verdict: 'yes', note: 'every feature; default fair-use limits instead of plan limits', ref: 'docs/parity.md' },
    },
    {
      capability: 'Paid plans',
      competitor: { verdict: 'paid', note: 'Starter $8 and Business $20 per member a month, billed annually; Enterprise by quote', sources: ['S3'] },
      freero: { verdict: 'no', note: 'no licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'Open-source licence',
      competitor: { verdict: 'no', note: 'proprietary', sources: ['S14'] },
      freero: { verdict: 'yes', note: 'MIT', ref: 'LICENSE' },
    },
    {
      capability: 'Run it on your own servers',
      competitor: { verdict: 'no', note: 'hosted on AWS; no on-premises edition', sources: ['S14'] },
      freero: { verdict: 'yes', note: 'Docker, in any region', ref: 'docs/deployment.md' },
    },
    {
      capability: 'MCP server for AI agents',
      competitor: { verdict: 'yes', note: 'on every plan, capped at 100 to 10,000 calls a day by plan', sources: ['S3', 'S9'] },
      freero: { verdict: 'yes', note: 'per-minute rate limits the server sets, no daily quota', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Agent edits reviewed by people',
      competitor: { verdict: 'no', note: 'write tools change the board directly; no review step documented', sources: ['S10'] },
      freero: { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Built-in AI',
      competitor: { verdict: 'yes', note: 'metered in AI credits; a small trial on Free', sources: ['S3', 'S5'] },
      freero: { verdict: 'partial', note: 'off until you connect a model; no chat assistant or AI workflows', ref: 'docs/ai.md' },
    },
    {
      capability: 'Bring your own AI model',
      competitor: { verdict: 'no', note: 'a choice of Miro-provided models; no own-key option found', sources: ['S8'] },
      freero: { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, local models included', ref: 'docs/ai.md' },
    },
    {
      capability: 'Jira sync',
      competitor: { verdict: 'yes', note: 'Miro’s Jira Cards app, two-way updates', sources: ['S15', 'S16'] },
      freero: { verdict: 'yes', note: 'two-way, Jira Cloud and Data Center', ref: 'docs/trackers.md' },
    },
    {
      capability: 'Linear sync',
      competitor: { verdict: 'paid', note: 'Business and Enterprise', sources: ['S18'] },
      freero: { verdict: 'yes', note: 'two-way', ref: 'docs/trackers.md' },
    },
    {
      capability: 'GitHub sync',
      competitor: { verdict: 'partial', note: 'through a third-party app', sources: ['S20'] },
      freero: { verdict: 'yes', note: 'two-way, GitHub and GitHub Enterprise Server', ref: 'docs/trackers.md' },
    },
    {
      capability: 'REST API',
      competitor: { verdict: 'yes', sources: ['S12'] },
      freero: { verdict: 'yes', note: 'with an OpenAPI description', ref: 'docs/api/openapi.json' },
    },
    {
      capability: 'Webhooks',
      competitor: { verdict: 'no', note: 'experimental webhooks removed on 2025-12-05', sources: ['S13'] },
      freero: { verdict: 'yes', note: 'signed, with retries and a delivery log', ref: 'docs/events.md' },
    },
    {
      capability: 'SAML single sign-on',
      competitor: { verdict: 'paid', note: 'Business and up', sources: ['S3'] },
      freero: { verdict: 'yes', note: 'SAML 2.0 or OpenID Connect per workspace', ref: 'docs/configuration.md' },
    },
    {
      capability: 'SCIM provisioning',
      competitor: { verdict: 'paid', note: 'Enterprise', sources: ['S3'] },
      freero: { verdict: 'yes', ref: 'docs/configuration.md' },
    },
    {
      capability: 'Audit log',
      competitor: { verdict: 'paid', note: 'Enterprise', sources: ['S3'] },
      freero: { verdict: 'yes', note: 'per workspace, exportable; no SIEM streaming yet', ref: 'docs/parity.md' },
    },
    {
      capability: 'Choice of data region',
      competitor: { verdict: 'paid', note: 'US, Australia or Japan hosting on Enterprise', sources: ['S3', 'S14'] },
      freero: { verdict: 'yes', note: 'wherever you host it; no hosted regions', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Security certifications',
      competitor: { verdict: 'yes', note: 'ISO 27001, SOC 2 Type II and others', sources: ['S14'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
    {
      capability: 'Native desktop and mobile apps',
      competitor: { verdict: 'yes', note: 'plus apps for interactive displays', sources: ['S23'] },
      freero: { verdict: 'no', note: 'installable web app; phones view and comment', ref: 'docs/parity.md' },
    },
    {
      capability: 'Templates',
      competitor: { verdict: 'yes', note: '7,000+ in its community library', sources: ['S22'] },
      freero: { verdict: 'partial', note: '74 originals, no community gallery', ref: 'README.md' },
    },
    {
      capability: 'App marketplace',
      competitor: { verdict: 'yes', note: '250+ apps and integrations', sources: ['S21'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
    {
      capability: 'Visitors without an account',
      competitor: { verdict: 'paid', note: 'anonymous visitors on public boards from Starter', sources: ['S3'] },
      freero: { verdict: 'yes', note: 'named guests on a shared link view and comment; editing needs an account', ref: 'docs/parity.md' },
    },
  ],
  competitorStronger: [
    'You want a hosted service with nothing to run, from a large, established vendor.',
    'You rely on a big ecosystem: thousands of community templates and 250+ marketplace apps, including integrations Freero doesn’t have.',
    'You need native desktop and mobile apps, or apps for interactive displays.',
    'You want AI that goes further out of the box: agent-style Sidekicks, multi-step Flows and AI prototyping, without connecting a model yourself.',
    'Your security review asks for certifications such as ISO 27001 and SOC 2 Type II, customer-managed keys or a hosted data region.',
  ],
  freeroStronger: [
    'You want to run your whiteboard on your own servers, under the MIT licence, in the region you choose.',
    'You want SSO, SCIM and an audit log without moving to a higher plan.',
    'You want AI agents to propose changes that people accept or reject, instead of writing straight to the board.',
    'You’d rather not count MCP calls or AI credits: agents work within per-minute rate limits, and AI runs on a model provider you pick.',
    'You need two-way sync with Jira (Cloud or Data Center), Linear and GitHub on every installation, and webhooks for board events.',
  ],
  sections: [
    {
      id: 'moving',
      title: 'Moving from Miro',
      body: () => (
        <>
          <p>
            Freero can’t import Miro boards today. What it can bring in: CSV rows as sticky notes or cards, draw.io and Excalidraw files as editable
            shapes, and images and PDFs placed on a board. Once you’re in, every board can be exported as an image, PDF, SVG or CSV, or downloaded as a
            full backup file that restores on any Freero server.
          </p>
          <p>
            If agents are part of why you are looking, start with <a href="/agents">how agents work on Freero boards</a>, or connect{' '}
            <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>. If running it yourself is the reason, read <a href="/open-source">self-hosting
            Freero</a>.
          </p>
        </>
      ),
    },
  ],
  faq: [
    {
      q: 'Is Freero a free Miro alternative?',
      a: 'Yes. Freero has no paid plans and no licence fees: SSO, SCIM, the audit log, tracker sync and the MCP server are all in the free product. If you host it yourself, you pay for your own servers and their upkeep.',
    },
    {
      q: 'Is there an open-source, self-hosted Miro alternative?',
      a: 'Freero is MIT licensed, and the same code runs on your own servers with Docker, PostgreSQL and optionally Redis and S3-compatible storage. Miro is proprietary and offered only as a hosted service.',
    },
    {
      q: 'Can I import my Miro boards into Freero?',
      a: 'Not today. Freero imports CSV rows as sticky notes or cards, draw.io and Excalidraw files as editable shapes, and places images and PDFs on a board, but it has no Miro importer.',
    },
    {
      q: 'Who owns Miro now?',
      a: 'Bending Spoons completed its acquisition of Miro on 26 October 2026. As of 28 October 2026 neither company had announced changes to Miro’s plans or prices; this comparison reflects Miro’s public pages on that date.',
    },
    {
      q: 'How is Freero’s MCP server different from Miro’s?',
      a: 'Both let AI agents such as Claude and ChatGPT read and change boards. Freero’s starts with read and suggest permissions, so an agent’s changes wait for a person to accept them, and its limits are per-minute rate limits rather than a daily quota. Miro’s write tools change the board directly, and each plan caps MCP calls per day.',
    },
  ],
  sources: [
    { id: 'S2', title: 'Bending Spoons: completion of the Miro acquisition (2026-10-26)', url: 'https://investors.bendingspoons.com/newsroom/bending-spoons-completes-the-acquisition-of-miro', checked: '2026-10-28' },
    { id: 'S3', title: 'Miro: Pricing', url: 'https://miro.com/pricing/', checked: '2026-10-28' },
    { id: 'S5', title: 'Miro: Miro AI', url: 'https://miro.com/ai/', checked: '2026-10-28' },
    { id: 'S8', title: 'Miro Help Center: AI provider availability', url: 'https://help.miro.com/hc/en-us/articles/34182831271570-AI-provider-availability-overview-Beta', checked: '2026-10-28' },
    { id: 'S9', title: 'Miro Developer Platform: Miro MCP', url: 'https://developers.miro.com/docs/miro-mcp', checked: '2026-10-28' },
    { id: 'S10', title: 'Miro Developer Platform: MCP introduction and tools', url: 'https://developers.miro.com/docs/mcp-intro', checked: '2026-10-28' },
    { id: 'S12', title: 'Miro Developer Platform: REST API reference guide', url: 'https://developers.miro.com/docs/rest-api-reference-guide', checked: '2026-10-28' },
    { id: 'S13', title: 'Miro Developer Platform changelog: experimental webhooks removed', url: 'https://developers.miro.com/changelog/removed-experimental-webhooks-support', checked: '2026-10-28' },
    { id: 'S14', title: 'Miro Trust Center', url: 'https://trust.miro.com/', checked: '2026-10-28' },
    { id: 'S15', title: 'Miro Marketplace: Jira Cards', url: 'https://miro.com/marketplace/jira', checked: '2026-10-28' },
    { id: 'S16', title: 'Atlassian Marketplace: Jira Cards by Miro', url: 'https://marketplace.atlassian.com/apps/1219583/jira-cards-by-miro', checked: '2026-10-28' },
    { id: 'S18', title: 'Linear integrations: Miro', url: 'https://linear.app/integrations/miro', checked: '2026-10-28' },
    { id: 'S20', title: 'Miro Marketplace: GitHub for Miro (by ServiceRocket)', url: 'https://us.miro.com/marketplace/github-for-miro/', checked: '2026-10-28' },
    { id: 'S21', title: 'Miro Marketplace', url: 'https://miro.com/marketplace/', checked: '2026-10-28' },
    { id: 'S22', title: 'Miroverse templates', url: 'https://miro.com/templates/', checked: '2026-10-28' },
    { id: 'S23', title: 'Miro: Apps', url: 'https://miro.com/apps/', checked: '2026-10-28' },
  ],
});
