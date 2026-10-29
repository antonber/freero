// Freero vs FigJam (#72). Facts: docs/marketing/competitors/figjam.md (sourced rows only; source
// numbers follow the sheet as F<n>). Left out as "Could not verify": whether the Professional prices
// are annual or monthly, which seat FigJam MCP writes need, whether the REST API and webhooks cover
// FigJam (so no API or webhook rows), residency region names, the VPAT, plugin counts and the
// Config India press.
import { defineComparison } from '../../lib/compare';

export default defineComparison({
  slug: 'figjam',
  competitor: 'FigJam',
  checked: '2026-10-28',
  published: true,
  title: 'Free, open-source FigJam alternative: Freero vs FigJam',
  description:
    'Freero and FigJam compared: seats and free-plan limits, MCP and AI agents, Jira, Linear and GitHub sync, SSO and self-hosting. Sourced and dated.',
  summary:
    'FigJam is the whiteboard inside Figma, sold through Figma seats and used most by product teams who already design in Figma. Freero is an open-source whiteboard for teams of people and AI agents: no seats or paid plans, every feature included, and you can run it on your own servers.',
  trademark: 'FigJam and Figma are trademarks of their owner.',
  rows: [
    {
      capability: 'Free plan',
      competitor: { verdict: 'partial', note: 'Starter: 3 FigJam files per team, plus personal drafts', sources: ['F4'] },
      freero: { verdict: 'yes', note: 'every feature; default fair-use limits instead of plan limits', ref: 'docs/parity.md' },
    },
    {
      capability: 'Paid seats',
      competitor: { verdict: 'paid', note: 'a Collab seat covers FigJam: $3 a month on Professional, $5 on Organization or Enterprise (billed annually)', sources: ['F2'] },
      freero: { verdict: 'no', note: 'no seats or licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'Open source, on your own servers',
      competitor: { verdict: 'no', note: 'proprietary; hosted by Figma', sources: ['F2', 'F18'] },
      freero: { verdict: 'yes', note: 'MIT licence; Docker, in any region', ref: 'docs/deployment.md' },
    },
    {
      capability: 'MCP server for AI agents',
      competitor: { verdict: 'yes', note: 'Figma’s remote server reads FigJam boards and writes stickies, sections, connectors and diagrams', sources: ['F9', 'F10'] },
      freero: { verdict: 'yes', note: 'on every server; reading, suggesting and writing are separate permissions', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Agent calls on a FigJam seat',
      competitor: { verdict: 'partial', note: 'Collab and View seats: 20 read calls a month', sources: ['F11'] },
      freero: { verdict: 'yes', note: 'per-minute rate limits the server sets, no monthly quota', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Agent edits reviewed by people',
      competitor: { verdict: 'no', note: 'writes apply directly; no review mode documented', sources: ['F10'] },
      freero: { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Built-in AI',
      competitor: { verdict: 'yes', note: 'FigJam AI, on monthly AI credits per seat', sources: ['F1', 'F2'] },
      freero: { verdict: 'partial', note: 'off until you connect a model; no image generation', ref: 'docs/ai.md' },
    },
    {
      capability: 'Bring your own AI model',
      competitor: { verdict: 'no', note: 'Figma-metered credits', sources: ['F2', 'F7'] },
      freero: { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, local models included', ref: 'docs/ai.md' },
    },
    {
      capability: 'AI assistant inside the board',
      competitor: { verdict: 'partial', note: 'Figma agent announced for FigJam, waitlist only', sources: ['F8'] },
      freero: { verdict: 'no', note: 'no chat assistant; agents work through MCP', ref: 'docs/ai.md' },
    },
    {
      capability: 'Jira',
      competitor: { verdict: 'partial', note: 'Figma’s Jira widget, Jira Cloud only: create, import and update issues', sources: ['F19', 'F20'] },
      freero: { verdict: 'yes', note: 'two-way sync, Jira Cloud and Data Center', ref: 'docs/trackers.md' },
    },
    {
      capability: 'Linear',
      competitor: { verdict: 'no', note: 'no official integration; a community plugin exists', sources: ['F23'] },
      freero: { verdict: 'yes', note: 'two-way sync', ref: 'docs/trackers.md' },
    },
    {
      capability: 'GitHub',
      competitor: { verdict: 'partial', note: 'the GitHub widget creates issues', sources: ['F22'] },
      freero: { verdict: 'yes', note: 'two-way sync, GitHub and GitHub Enterprise Server', ref: 'docs/trackers.md' },
    },
    {
      capability: 'SAML single sign-on',
      competitor: { verdict: 'paid', note: 'Organization and Enterprise', sources: ['F16'] },
      freero: { verdict: 'yes', note: 'SAML 2.0 or OpenID Connect per workspace', ref: 'docs/configuration.md' },
    },
    {
      capability: 'SCIM provisioning',
      competitor: { verdict: 'paid', note: 'Organization and Enterprise', sources: ['F16'] },
      freero: { verdict: 'yes', ref: 'docs/configuration.md' },
    },
    {
      capability: 'Audit log',
      competitor: { verdict: 'paid', note: 'activity logs on Organization and Enterprise', sources: ['F16'] },
      freero: { verdict: 'yes', note: 'per workspace, exportable; no SIEM streaming yet', ref: 'docs/parity.md' },
    },
    {
      capability: 'Choice of data region',
      competitor: { verdict: 'paid', note: 'Enterprise; covers data at rest', sources: ['F18'] },
      freero: { verdict: 'yes', note: 'wherever you host it; no hosted regions', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Security certifications',
      competitor: { verdict: 'yes', note: 'SOC 2 Type 2, ISO 27001, FedRAMP and others', sources: ['F15'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
    {
      capability: 'Native desktop and mobile apps',
      competitor: { verdict: 'yes', note: 'in the Figma apps', sources: ['F24'] },
      freero: { verdict: 'no', note: 'installable web app; phones view and comment', ref: 'docs/parity.md' },
    },
    {
      capability: 'Templates',
      competitor: { verdict: 'yes', note: '300+', sources: ['F1'] },
      freero: { verdict: 'partial', note: '74 originals', ref: 'README.md' },
    },
    {
      capability: 'Plugins and widgets',
      competitor: { verdict: 'yes', note: 'the Figma Community platform runs in FigJam', sources: ['F14'] },
      freero: { verdict: 'no', note: 'no plugin SDK or marketplace', ref: 'docs/parity.md' },
    },
    {
      capability: 'Collaborators without an account',
      competitor: { verdict: 'paid', note: 'open sessions on paid plans, 24 hours each, for editing', sources: ['F26'] },
      freero: { verdict: 'yes', note: 'named guests on a shared link view and comment; editing needs an account', ref: 'docs/parity.md' },
    },
  ],
  competitorStronger: [
    'Your team designs in Figma: boards live next to Design, Slides and Make files, under one account and one file browser.',
    'You want a big ecosystem: 300+ templates and the Figma Community’s plugins and widgets.',
    'You want AI that does more without setup, such as generating templates and images, with a Figma agent on the way.',
    'You need native desktop and mobile apps.',
    'Your security review asks for SOC 2 Type 2, ISO 27001 or FedRAMP.',
    'You want guests to edit without an account, in time-limited open sessions.',
  ],
  freeroStronger: [
    'You want everyone to edit every board without buying seats.',
    'You want AI agents to propose changes that people accept or reject, without a monthly call quota on the seats most of your team holds.',
    'You need two-way sync with Jira Cloud or Data Center, Linear and GitHub, not one-way widgets.',
    'You want SSO, SCIM and an audit log without moving to an Organization plan.',
    'You want to host the whiteboard yourself, under the MIT licence, in the region you choose.',
    'You want AI on a model provider you choose, without per-seat credits.',
  ],
  sections: [
    {
      id: 'moving',
      title: 'Moving from FigJam',
      body: () => (
        <>
          <p>
            Freero can’t import FigJam files today. It brings in CSV rows as sticky notes or cards, draw.io and Excalidraw files as editable shapes, and
            images and PDFs placed on a board. Freero is a whiteboard, not a design tool, so keep Figma for design work: a Figma link pasted onto a
            board opens the file in a live frame after a click.
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
      q: 'Is Freero a free FigJam alternative?',
      a: 'Yes. Freero has no seats or paid plans: every editor gets every feature, with no limit on the number of boards beyond default fair-use limits. If you host it yourself, you pay for your own servers and their upkeep.',
    },
    {
      q: 'Is there an open-source FigJam alternative?',
      a: 'Freero is MIT licensed and runs on your own servers with Docker and PostgreSQL. FigJam is proprietary and hosted by Figma.',
    },
    {
      q: 'Can AI agents work on Freero boards the way they do with Figma’s MCP server?',
      a: 'Yes, with two differences. Freero’s MCP server lets an agent propose changes that people accept or reject before the board changes, and its limits are per-minute rate limits rather than a monthly quota per seat.',
    },
    {
      q: 'Can I import FigJam boards into Freero?',
      a: 'Not today. Freero has no FigJam importer; it imports CSV, draw.io and Excalidraw files, and places images and PDFs on a board.',
    },
  ],
  sources: [
    { id: 'F1', title: 'Figma: FigJam', url: 'https://www.figma.com/figjam/', checked: '2026-10-28' },
    { id: 'F2', title: 'Figma: Pricing', url: 'https://www.figma.com/pricing/', checked: '2026-10-28' },
    { id: 'F4', title: 'Figma Help Center: Starter plan overview', url: 'https://help.figma.com/hc/en-us/articles/13838684089751-Starter-plan-overview', checked: '2026-10-28' },
    { id: 'F7', title: 'Figma Forum (staff post): AI credits update, 2026-03-11', url: 'https://forum.figma.com/product-updates-3/ai-credits-update-new-purchasing-options-and-enforcement-on-march-18-51782', checked: '2026-10-28' },
    { id: 'F8', title: 'Figma Forum: Everything announced at Config 2026', url: 'https://forum.figma.com/product-updates-3/everything-announced-at-config-2026-55221', checked: '2026-10-28' },
    { id: 'F9', title: 'Figma developer docs: Figma MCP server', url: 'https://developers.figma.com/docs/figma-mcp-server/', checked: '2026-10-28' },
    { id: 'F10', title: 'Figma developer docs: MCP tools and prompts', url: 'https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/', checked: '2026-10-28' },
    { id: 'F11', title: 'Figma developer docs: MCP rate limits and access', url: 'https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/', checked: '2026-10-28' },
    { id: 'F14', title: 'Figma blog: Bringing our open platform to FigJam', url: 'https://www.figma.com/blog/bringing-the-power-of-our-open-platform-to-figjam/', checked: '2026-10-28' },
    { id: 'F15', title: 'Figma: Security', url: 'https://www.figma.com/security/', checked: '2026-10-28' },
    { id: 'F16', title: 'Figma Help Center: Figma plans and features', url: 'https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features', checked: '2026-10-28' },
    { id: 'F18', title: 'Figma Help Center: Enable localized file hosting', url: 'https://help.figma.com/hc/en-us/articles/15643274574871-Enable-localized-file-hosting', checked: '2026-10-28' },
    { id: 'F19', title: 'Figma Help Center: Jira widget for FigJam', url: 'https://help.figma.com/hc/en-us/articles/360039827834', checked: '2026-10-28' },
    { id: 'F20', title: 'Atlassian Marketplace: FigJam widget for Jira', url: 'https://marketplace.atlassian.com/apps/1228454/figjam-widget-for-jira', checked: '2026-10-28' },
    { id: 'F22', title: 'Figma: GitHub for FigJam', url: 'https://www.figma.com/github-for-figjam/', checked: '2026-10-28' },
    { id: 'F23', title: 'Figma Forum: a community-built FigJam Linear plugin', url: 'https://forum.figma.com/showcase-your-work-14/a-small-free-figjam-linear-plugin-i-built-for-founders-and-pms-54863', checked: '2026-10-28' },
    { id: 'F24', title: 'Figma blog: FigJam for iPad (with its retirement note)', url: 'https://www.figma.com/blog/introducing-figjam-for-ipad/', checked: '2026-10-28' },
    { id: 'F26', title: 'Figma Help Center: Open sessions', url: 'https://help.figma.com/hc/en-us/articles/4410786053911', checked: '2026-10-28' },
  ],
});
