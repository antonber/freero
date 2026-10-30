// Freero vs Mural (#72). Facts: docs/marketing/competitors/mural.md (sourced rows only; source ids
// follow the sheet). Left out as "Could not verify": Business monthly price, AI credit limits,
// webhooks either way, which plans get the Linear and GitHub integrations and basic Jira sync,
// the names of the residency regions, an exact template count, the ACR's contents.
import { defineComparison } from '../../lib/compare';
import { SITE_TEMPLATES } from '../../lib/templates';

export default defineComparison({
  slug: 'mural',
  competitor: 'Mural',
  checked: '2026-10-28',
  published: true,
  title: 'Free, open-source Mural alternative: Freero vs Mural',
  description:
    'Freero and Mural compared: free plan limits, MCP and AI agents, Jira, Linear and GitHub sync, SSO, SCIM and self-hosting. Sourced, dated and fair to both.',
  summary:
    'Mural is a hosted visual workspace built around facilitated teamwork, with LUMA methods, Microsoft 365 ties and per-member plans. Freero is an open-source whiteboard for teams of people and AI agents: no paid plans, every feature included, and you can run it on your own servers.',
  rows: [
    {
      capability: 'Free plan',
      competitor: { verdict: 'partial', note: 'the 3 most recent murals stay editable, older ones become view-only; no Mural AI', sources: ['S1', 'S5'] },
      freero: { verdict: 'yes', note: 'every feature; default fair-use limits instead of plan limits', ref: 'docs/parity.md' },
    },
    {
      capability: 'Paid plans',
      competitor: { verdict: 'paid', note: 'Team+ $9.99 per member a month billed annually ($12 monthly), Business $17.99 billed annually, Enterprise by quote', sources: ['S1'] },
      freero: { verdict: 'no', note: 'no licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'Open source, on your own servers',
      competitor: { verdict: 'no', note: 'proprietary; hosted on Microsoft Azure', sources: ['S4'] },
      freero: { verdict: 'yes', note: 'MIT licence; Docker, in any region', ref: 'docs/deployment.md' },
    },
    {
      capability: 'MCP server for AI agents',
      competitor: { verdict: 'partial', note: 'public preview; open to Free workspaces since 2026-10-13', sources: ['S3', 'S5'] },
      freero: { verdict: 'yes', note: 'on every server, with OAuth sign-in for Claude, ChatGPT and other clients', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Agent edits reviewed by people',
      competitor: { verdict: 'no', note: 'agents edit the canvas directly; no review step described', sources: ['S3'] },
      freero: { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Built-in AI',
      competitor: { verdict: 'paid', note: 'Mural AI on Team+ and up', sources: ['S1', 'S2'] },
      freero: { verdict: 'partial', note: 'off until you connect a model; no chat assistant or AI workflows', ref: 'docs/ai.md' },
    },
    {
      capability: 'Bring your own AI model',
      competitor: { verdict: 'no', note: 'no provider or own-model option named', sources: ['S2'] },
      freero: { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, local models included', ref: 'docs/ai.md' },
    },
    {
      capability: 'Jira sync',
      competitor: { verdict: 'yes', note: 'two-way, Jira Cloud and Data Center; the upgraded integration is on Business and Enterprise', sources: ['S5', 'S12'] },
      freero: { verdict: 'yes', note: 'two-way, Jira Cloud and Data Center', ref: 'docs/trackers.md' },
    },
    {
      capability: 'Linear sync',
      competitor: { verdict: 'yes', note: 'two-way, since 2026-09-08', sources: ['S5', 'S13'] },
      freero: { verdict: 'yes', note: 'two-way', ref: 'docs/trackers.md' },
    },
    {
      capability: 'GitHub',
      competitor: { verdict: 'partial', note: 'pull-request links become live cards; create issues from stickies', sources: ['S13'] },
      freero: { verdict: 'yes', note: 'two-way issue sync, GitHub and GitHub Enterprise Server', ref: 'docs/trackers.md' },
    },
    {
      capability: 'Other work trackers',
      competitor: { verdict: 'yes', note: 'Azure DevOps, Rally, Salesforce, Asana and Microsoft Planner', sources: ['S5'] },
      freero: { verdict: 'no', note: 'Jira, Linear and GitHub only', ref: 'docs/trackers.md' },
    },
    {
      capability: 'REST API',
      competitor: { verdict: 'partial', note: 'labelled beta; on every plan within its limits', sources: ['S6'] },
      freero: { verdict: 'yes', note: 'with an OpenAPI description, and signed webhooks', ref: 'docs/api/openapi.json' },
    },
    {
      capability: 'SAML single sign-on',
      competitor: { verdict: 'paid', note: 'Business and up', sources: ['S1'] },
      freero: { verdict: 'yes', note: 'SAML 2.0 or OpenID Connect per workspace', ref: 'docs/configuration.md' },
    },
    {
      capability: 'SCIM provisioning',
      competitor: { verdict: 'paid', note: 'Enterprise', sources: ['S1'] },
      freero: { verdict: 'yes', ref: 'docs/configuration.md' },
    },
    {
      capability: 'Audit log',
      competitor: { verdict: 'paid', note: 'Enterprise', sources: ['S1'] },
      freero: { verdict: 'yes', note: 'per workspace, exportable; no SIEM streaming yet', ref: 'docs/parity.md' },
    },
    {
      capability: 'Choice of data region',
      competitor: { verdict: 'paid', note: 'Enterprise, with your own encryption key', sources: ['S4'] },
      freero: { verdict: 'yes', note: 'wherever you host it; no hosted regions or customer-managed keys', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Security certifications',
      competitor: { verdict: 'yes', note: 'SOC 2 Type 2, ISO 27001, ISO 42001 and others', sources: ['S4'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
    {
      capability: 'Native desktop and mobile apps',
      competitor: { verdict: 'yes', note: 'plus Surface Hub and other interactive displays', sources: ['S9'] },
      freero: { verdict: 'no', note: 'installable web app; phones view and comment', ref: 'docs/parity.md' },
    },
    {
      capability: 'Templates',
      competitor: { verdict: 'yes', note: '“hundreds”, plus LUMA methods', sources: ['S14', 'S1'] },
      freero: { verdict: 'partial', note: `${SITE_TEMPLATES.length} originals`, ref: 'README.md' },
    },
    {
      capability: 'Visitors without an account',
      competitor: { verdict: 'partial', note: 'free on every plan; view-only on Free, editing from Team+', sources: ['S1'] },
      freero: { verdict: 'yes', note: 'named guests on a shared link view and comment; editing needs an account', ref: 'docs/parity.md' },
    },
  ],
  competitorStronger: [
    'You run facilitated workshops at scale and want a methods library: LUMA frameworks, AI guidance for its methods, and training from the same company.',
    'Your organization is built on Microsoft: a Microsoft 365 Copilot agent, Azure hosting and apps for Surface Hub.',
    'You sync boards with Azure DevOps, Rally, Salesforce, Asana or Microsoft Planner, which Freero doesn’t support.',
    'Your security review needs certifications such as SOC 2 Type 2 and ISO 27001, your own encryption key or a hosted data region.',
    'You want native desktop and mobile apps, or visitors who can edit without an account.',
    'You want a hosted service with standard, priority and premier support tiers, and nothing to run.',
  ],
  freeroStronger: [
    'You want every board editable and every feature on, without a per-member plan.',
    'You want to run the whiteboard on your own servers, under the MIT licence, in the region you choose.',
    'You want AI agents to propose changes that people accept or reject, on an MCP server that ships with every Freero server.',
    'You want SSO, SCIM and an audit log without an Enterprise contract.',
    'You need two-way GitHub issue sync, or roadmap timelines whose bars write their dates back to Jira or Linear.',
    'You want AI on a model provider you choose, including models you run yourself.',
  ],
  sections: [
    {
      id: 'moving',
      title: 'Moving from Mural',
      body: () => (
        <>
          <p>
            Freero can’t import murals today. It brings in CSV rows as sticky notes or cards, draw.io and Excalidraw files as editable shapes, and images
            and PDFs placed on a board. Facilitation tools are built in for the workshops you move over: voting, a shared timer, private mode, polls, word
            clouds, Q&amp;A and planning poker, all free, with guests answering through a link.
          </p>
          <p>
            For agents, read <a href="/agents">how agents work on Freero boards</a> or connect <a href="/claude">Claude</a> or{' '}
            <a href="/chatgpt">ChatGPT</a>. For SSO, SCIM and the audit log, see <a href="/security">security</a>; to run it yourself, see{' '}
            <a href="/open-source">self-hosting Freero</a>.
          </p>
        </>
      ),
    },
  ],
  faq: [
    {
      q: 'Is Freero a free Mural alternative?',
      a: 'Yes. Freero has no paid plans, so there is no limit on editable boards and no feature held back for a higher tier. If you host it yourself, you pay for your own servers and their upkeep.',
    },
    {
      q: 'Is there an open-source, self-hosted Mural alternative?',
      a: 'Freero is MIT licensed and runs on your own servers with Docker and PostgreSQL. Mural is proprietary and hosted on Microsoft Azure.',
    },
    {
      q: 'How do Freero’s and Mural’s MCP servers compare?',
      a: 'Both let AI clients such as Claude and ChatGPT read and change boards. Mural’s was in public preview on 28 October 2026 and describes direct edits. Freero’s is part of every Freero server, and by default an agent proposes changes that people accept or reject before the board changes.',
    },
    {
      q: 'Can I import my murals into Freero?',
      a: 'Not today. Freero has no Mural importer; it imports CSV, draw.io and Excalidraw files, and places images and PDFs on a board.',
    },
  ],
  sources: [
    { id: 'S1', title: 'Mural: Pricing', url: 'https://www.mural.co/pricing', checked: '2026-10-28' },
    { id: 'S2', title: 'Mural: Mural AI', url: 'https://www.mural.co/ai', checked: '2026-10-28' },
    { id: 'S3', title: 'Mural: Mural MCP', url: 'https://www.mural.co/ai/mcp', checked: '2026-10-28' },
    { id: 'S4', title: 'Mural: Trust and security', url: 'https://www.mural.co/trust', checked: '2026-10-28' },
    { id: 'S5', title: 'Mural: Product release notes', url: 'https://www.mural.co/blog/product-release-notes', checked: '2026-10-28' },
    { id: 'S6', title: 'Mural developer hub: Public API and Enterprise API', url: 'https://developers.mural.co/public/docs/public-vs-enterprise', checked: '2026-10-28' },
    { id: 'S9', title: 'Mural: Apps', url: 'https://www.mural.co/apps', checked: '2026-10-28' },
    { id: 'S12', title: 'Mural: Jira integration', url: 'https://www.mural.co/integrations/jira', checked: '2026-10-28' },
    { id: 'S13', title: 'Mural blog: Integrations (2026-09-30)', url: 'https://www.mural.co/blog/mural-integrations', checked: '2026-10-28' },
    { id: 'S14', title: 'Mural Learning: Browse the template library', url: 'https://learning.mural.co/lessons/browse-the-template-library', checked: '2026-10-28' },
  ],
});
