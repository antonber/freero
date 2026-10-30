// Freero vs Excalidraw and Excalidraw+ (#72). Facts: docs/marketing/competitors/excalidraw.md (sourced
// rows only; source numbers follow the sheet as E<n>). Both are MIT licensed, so this page compares
// what each gives you, not licences. Left out as "Could not verify": whether $6 is the annual or the
// monthly rate, where Excalidraw+ data is hosted, what its logs endpoint records (so no audit-log
// row), plan requirements beyond a Plus API key, release dates, library counts, a VPAT.
// Freero-side correction: the sheet calls Freero's in-chat live boards planned; they shipped
// (docs/parity.md §9, MCP Apps).
import { defineComparison } from '../../lib/compare';
import { SITE_TEMPLATES } from '../../lib/templates';

export default defineComparison({
  slug: 'excalidraw',
  competitor: 'Excalidraw',
  column: 'Excalidraw and Excalidraw+',
  checked: '2026-10-28',
  published: true,
  title: 'Excalidraw alternative for teams: Freero vs Excalidraw',
  description:
    'Both are MIT licensed. Freero adds self-hosted live collaboration, accounts, SSO, an MCP server and Jira, Linear and GitHub sync. Sourced and dated.',
  summary:
    'Excalidraw is a minimal, open-source sketching board with a hand-drawn look, free at excalidraw.com, with a paid Excalidraw+ service for teams. Freero is an open-source whiteboard for teams of people and AI agents. Both are MIT licensed; they differ in what you get when you run them yourself.',
  trademark: 'Excalidraw and Excalidraw+ are trademarks of their owner.',
  rows: [
    {
      capability: 'Open-source licence',
      competitor: { verdict: 'yes', note: 'MIT', sources: ['E1'] },
      freero: { verdict: 'yes', note: 'MIT', ref: 'LICENSE' },
    },
    {
      capability: 'Free to use',
      competitor: { verdict: 'yes', note: 'excalidraw.com: no account, live sessions, local saving', sources: ['E2'] },
      freero: { verdict: 'yes', note: 'every feature; default fair-use limits instead of plan limits', ref: 'docs/parity.md' },
    },
    {
      capability: 'Paid plan',
      competitor: { verdict: 'paid', note: 'Excalidraw+ at $6 per user a month, for cloud workspaces, sharing controls, comments and more', sources: ['E3'] },
      freero: { verdict: 'no', note: 'no paid plans; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'Live collaboration when self-hosted',
      competitor: { verdict: 'no', note: 'Excalidraw’s docs: self-hosting doesn’t support sharing or collaboration', sources: ['E6'] },
      freero: { verdict: 'yes', note: 'live sync, cursors, follow and comments', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Accounts and roles when self-hosted',
      competitor: { verdict: 'no', note: 'access management is an Excalidraw+ feature; self-hosted Excalidraw+ is on a waitlist', sources: ['E3', 'E15'] },
      freero: { verdict: 'yes', note: 'workspaces; owner, editor, commenter and viewer roles', ref: 'ARCHITECTURE.md' },
    },
    {
      capability: 'SSO and SCIM',
      competitor: { verdict: 'no', note: 'SSO is on the roadmap backlog; SCIM isn’t listed', sources: ['E5'] },
      freero: { verdict: 'yes', note: 'SAML 2.0 or OpenID Connect per workspace, and SCIM', ref: 'docs/configuration.md' },
    },
    {
      capability: 'MCP server for AI agents',
      competitor: { verdict: 'yes', note: 'Excalidraw+ MCP (public beta, API key) for saved scenes; a free MCP App draws new diagrams in chat', sources: ['E7', 'E9'] },
      freero: { verdict: 'yes', note: 'on every server, self-hosted ones too; OAuth or tokens; a live board in Claude and ChatGPT', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Agent edits reviewed by people',
      competitor: { verdict: 'no', note: 'writes apply directly; no review step documented', sources: ['E8'] },
      freero: { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Built-in AI',
      competitor: { verdict: 'yes', note: '10 requests a day free, 100 on Excalidraw+: text to diagram, Mermaid, wireframe to code', sources: ['E3'] },
      freero: { verdict: 'partial', note: 'off until you connect a model; no wireframe to code', ref: 'docs/ai.md' },
    },
    {
      capability: 'Bring your own AI key',
      competitor: { verdict: 'paid', note: 'Excalidraw+', sources: ['E3'] },
      freero: { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, local models included', ref: 'docs/ai.md' },
    },
    {
      capability: 'Jira, Linear and GitHub sync',
      competitor: { verdict: 'no', note: 'Jira and Confluence integration in progress; GitHub on the backlog', sources: ['E5'] },
      freero: { verdict: 'yes', note: 'two-way, Jira Cloud and Data Center included', ref: 'docs/trackers.md' },
    },
    {
      capability: 'REST API',
      competitor: { verdict: 'paid', note: 'Excalidraw+, public beta', sources: ['E12'] },
      freero: { verdict: 'yes', note: 'with an OpenAPI description', ref: 'docs/api/openapi.json' },
    },
    {
      capability: 'Webhooks',
      competitor: { verdict: 'no', note: 'none documented', sources: ['E12'] },
      freero: { verdict: 'yes', note: 'signed, with retries and a delivery log', ref: 'docs/events.md' },
    },
    {
      capability: 'Workshop tools: voting, timer, polls',
      competitor: { verdict: 'no', note: 'not listed; Excalidraw+ has presentations, voice hangouts and comments', sources: ['E3'] },
      freero: { verdict: 'yes', note: 'plus word clouds, Q&A, planning poker and private mode', ref: 'docs/parity.md' },
    },
    {
      capability: 'Works offline',
      competitor: { verdict: 'yes', note: 'the web app works offline and saves locally', sources: ['E2'] },
      freero: { verdict: 'no', note: 'rides out short disconnects only', ref: 'docs/parity.md' },
    },
    {
      capability: 'Embeddable editor component',
      competitor: { verdict: 'yes', note: 'the @excalidraw/excalidraw React package', sources: ['E2'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
    {
      capability: 'Security certifications',
      competitor: { verdict: 'yes', note: 'SOC 2 Type 1 and Type 2, for Excalidraw+', sources: ['E16'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
  ],
  competitorStronger: [
    'You want to open a page and draw: no account, no setup, and a deliberately small toolset.',
    'You like the hand-drawn look for diagrams and explainers.',
    'You need to work offline, or want live sessions that are end-to-end encrypted.',
    'You are embedding a whiteboard in your own product: the React package is made for that.',
    'You want AI on the free tier with nothing to configure, or Excalidraw’s large community and shape libraries.',
    'You want the interface in your language: the editor is translated.',
  ],
  freeroStronger: [
    'You want to self-host with live collaboration, accounts, roles and sharing, not just the editor.',
    'You need SSO, SCIM and an audit log on your own servers.',
    'You want AI agents to propose changes that people accept or reject, through an MCP server that runs on your own Freero server.',
    `You plan work on the board: two-way Jira, Linear and GitHub sync, kanban, timelines, tables and ${SITE_TEMPLATES.length} templates.`,
    'You run workshops with voting, a timer, polls and planning poker.',
  ],
  sections: [
    {
      id: 'moving',
      title: 'Bringing Excalidraw drawings into Freero',
      body: () => (
        <>
          <p>
            Freero imports Excalidraw files. Shapes, text, arrows (as connectors), frames, pen strokes and images arrive as editable items in one undo step, with a report of
            anything that couldn’t be mapped. Shapes take Freero’s clean outlines rather than sketchy strokes.
          </p>
          <p>
            To run Freero yourself, see <a href="/open-source">self-hosting Freero</a> and <a href="/security">security</a>. For agents, read{' '}
            <a href="/agents">how agents work on Freero boards</a> or connect <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>.
          </p>
        </>
      ),
    },
  ],
  faq: [
    {
      q: 'Is Freero open source like Excalidraw?',
      a: 'Yes. Both are MIT licensed. The difference is in what the open-source code includes: Freero’s has live collaboration, accounts and roles, SSO, SCIM, the audit log, the MCP server and tracker sync.',
    },
    {
      q: 'Can I self-host Excalidraw with real-time collaboration?',
      a: 'Excalidraw’s own documentation says a self-hosted instance doesn’t support sharing or collaboration, and a self-hosted Excalidraw+ was on a waitlist on 28 October 2026. Freero’s self-hosted server includes live collaboration.',
    },
    {
      q: 'Can I open my Excalidraw files in Freero?',
      a: 'Yes. Import an Excalidraw file and its shapes, text, arrows, frames, pen strokes and images become editable Freero items, with a report of anything that couldn’t be mapped.',
    },
  ],
  sources: [
    { id: 'E1', title: 'GitHub: excalidraw/excalidraw', url: 'https://github.com/excalidraw/excalidraw', checked: '2026-10-28' },
    { id: 'E2', title: 'Excalidraw README', url: 'https://raw.githubusercontent.com/excalidraw/excalidraw/master/README.md', checked: '2026-10-28' },
    { id: 'E3', title: 'Excalidraw+: Pricing', url: 'https://plus.excalidraw.com/pricing', checked: '2026-10-28' },
    { id: 'E5', title: 'Excalidraw+: Roadmap', url: 'https://plus.excalidraw.com/roadmap', checked: '2026-10-28' },
    { id: 'E6', title: 'Excalidraw docs: Development and self-hosting', url: 'https://docs.excalidraw.com/docs/introduction/development', checked: '2026-10-28' },
    { id: 'E7', title: 'Excalidraw+ docs: MCP', url: 'https://plus.excalidraw.com/docs/mcp', checked: '2026-10-28' },
    { id: 'E8', title: 'Excalidraw+ docs: MCP tools', url: 'https://plus.excalidraw.com/docs/mcp/tools', checked: '2026-10-28' },
    { id: 'E9', title: 'GitHub: excalidraw/excalidraw-mcp', url: 'https://github.com/excalidraw/excalidraw-mcp', checked: '2026-10-28' },
    { id: 'E12', title: 'Excalidraw+ docs: API', url: 'https://plus.excalidraw.com/docs/api', checked: '2026-10-28' },
    { id: 'E15', title: 'Excalidraw+ docs: Self-hosting Excalidraw+', url: 'https://plus.excalidraw.com/docs/self-hosting/excalidraw-plus-self-hosting', checked: '2026-10-28' },
    { id: 'E16', title: 'Excalidraw+: Security and compliance', url: 'https://plus.excalidraw.com/security-and-compliance', checked: '2026-10-28' },
  ],
});
