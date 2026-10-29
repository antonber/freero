// Freero vs Confluence whiteboards (#72). Facts: docs/marketing/competitors/confluence-whiteboards.md
// (sourced rows only; the sheet cites URLs, given ids C<n> here). Left out as "Could not verify":
// whether whiteboards in MCP v2 are generally available, whether Jira edits flow back into board
// elements (so the Jira link is described as writing to Jira), whether Guard is bundled into
// Enterprise, which plans get Rovo's whiteboard features, mobile-app support, Free-plan guests.
// Atlassian's trademark guidelines: names in plain text, referential use only.
import { defineComparison } from '../../lib/compare';

export default defineComparison({
  slug: 'confluence-whiteboards',
  competitor: 'Confluence whiteboards',
  checked: '2026-10-28',
  published: true,
  title: 'Confluence whiteboards alternative: Freero vs Confluence',
  description:
    'Confluence whiteboards are Cloud-only. Freero self-hosts and syncs both ways with Jira Cloud and Data Center, Linear and GitHub. Sourced and dated.',
  summary:
    'Confluence whiteboards are Atlassian’s freeform canvas inside Confluence Cloud, next to your pages and one click from Jira. Freero is an open-source whiteboard for teams of people and AI agents that you can use as it is or run on your own servers, connected to Jira Cloud or Data Center.',
  trademark: 'Atlassian, Confluence and Jira are trademarks of Atlassian.',
  rows: [
    {
      capability: 'Free plan',
      competitor: { verdict: 'partial', note: 'up to 10 users, 3 active whiteboards each', sources: ['C2', 'C3'] },
      freero: { verdict: 'yes', note: 'every feature; default fair-use limits instead of plan limits', ref: 'docs/parity.md' },
    },
    {
      capability: 'Active whiteboards',
      competitor: { verdict: 'partial', note: '10 per user on Standard, unlimited on Premium; older boards over the limit become read-only', sources: ['C3', 'C2'] },
      freero: { verdict: 'yes', note: 'no plan limits; default 5,000 boards per account', ref: 'docs/configuration.md' },
    },
    {
      capability: 'Price',
      competitor: { verdict: 'paid', note: 'part of the Confluence Cloud seat: Standard listed at $5.78 and Premium at $11.16 per user a month (average for 300 users)', sources: ['C2'] },
      freero: { verdict: 'no', note: 'no paid plans or licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'On your own servers',
      competitor: { verdict: 'no', note: 'Cloud only, with no plans for Data Center, which reaches end of life on 2029-03-28', sources: ['C1', 'C17'] },
      freero: { verdict: 'yes', note: 'MIT licence; Docker, in any region', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Jira',
      competitor: { verdict: 'partial', note: 'Jira Cloud only: create or import work items; on Premium, smart sections and connectors write back to Jira', sources: ['C5', 'C6', 'C4'] },
      freero: { verdict: 'yes', note: 'two-way sync with Jira Cloud and Data Center', ref: 'docs/trackers.md' },
    },
    {
      capability: 'Linear and GitHub',
      competitor: { verdict: 'no', note: 'links and embeds only', sources: ['C1'] },
      freero: { verdict: 'yes', note: 'two-way sync, GitHub Enterprise Server included', ref: 'docs/trackers.md' },
    },
    {
      capability: 'MCP server for AI agents',
      competitor: { verdict: 'partial', note: 'Atlassian’s Rovo MCP server reaches whiteboards through its v2 tools; calls use Rovo credits', sources: ['C11', 'C12'] },
      freero: { verdict: 'yes', note: 'per-minute rate limits, no credits', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Agent edits reviewed by people',
      competitor: { verdict: 'no', note: 'updates are direct writes; no suggestion flow documented', sources: ['C12'] },
      freero: { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    },
    {
      capability: 'Built-in AI',
      competitor: { verdict: 'paid', note: 'Rovo summarises boards and groups stickies; Rovo needs a paid plan and uses credits', sources: ['C7', 'C9'] },
      freero: { verdict: 'partial', note: 'off until you connect a model; no chat assistant or semantic search', ref: 'docs/ai.md' },
    },
    {
      capability: 'Bring your own AI model',
      competitor: { verdict: 'no', note: 'Rovo only', sources: ['C9'] },
      freero: { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, local models included', ref: 'docs/ai.md' },
    },
    {
      capability: 'API for board content',
      competitor: { verdict: 'partial', note: 'REST v2 creates, gets and deletes whole whiteboards; no endpoints for what’s on them', sources: ['C13'] },
      freero: { verdict: 'yes', note: 'items, comments and suggestions, with an OpenAPI description', ref: 'docs/api/openapi.json' },
    },
    {
      capability: 'Webhooks for board changes',
      competitor: { verdict: 'no', note: 'no whiteboard events', sources: ['C14'] },
      freero: { verdict: 'yes', note: 'signed, with retries and a delivery log', ref: 'docs/events.md' },
    },
    {
      capability: 'Keyboard and screen readers on the board',
      competitor: { verdict: 'no', note: 'not supported on whiteboards', sources: ['C4'] },
      freero: { verdict: 'yes', note: 'keyboard operation and a “Board as list” view for screen readers', ref: 'docs/accessibility.md' },
    },
    {
      capability: 'Visitors without an account',
      competitor: { verdict: 'no', note: 'no anonymous access to whiteboards', sources: ['C4', 'C8'] },
      freero: { verdict: 'yes', note: 'named guests on a shared link view and comment; editing needs an account', ref: 'docs/parity.md' },
    },
    {
      capability: 'Backup and restore of a board',
      competitor: { verdict: 'no', note: 'not supported on whiteboards', sources: ['C4'] },
      freero: { verdict: 'yes', note: 'a backup file that restores on any Freero server', ref: 'docs/parity.md' },
    },
    {
      capability: 'SSO, SCIM and audit log',
      competitor: { verdict: 'paid', note: 'with Atlassian Guard Standard, listed at $4.35 per user a month', sources: ['C15'] },
      freero: { verdict: 'yes', note: 'per workspace, included', ref: 'docs/configuration.md' },
    },
    {
      capability: 'Choice of data region',
      competitor: { verdict: 'paid', note: '11 locations, on Standard and up', sources: ['C16'] },
      freero: { verdict: 'yes', note: 'wherever you host it; no hosted regions', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Security certifications',
      competitor: { verdict: 'yes', note: 'SOC 2 and ISO 27001', sources: ['C1'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
  ],
  competitorStronger: [
    'Your team lives in Confluence and Jira Cloud and wants boards next to its pages, with no new vendor or login.',
    'You want Jira Cloud work items created and updated from the board by the company that makes Jira, with JQL import and smart sections.',
    'You want Rovo’s search, chat and agents across Jira and Confluence, included with your paid plan.',
    'You need hosted data residency in one of 11 locations, or certifications such as SOC 2 and ISO 27001.',
    'You rely on the Atlassian Marketplace and vendor support.',
    'You are a small team: Confluence Free covers up to 10 users, with Confluence’s pages included.',
  ],
  freeroStronger: [
    'You run Jira Data Center, or must keep whiteboards on your own infrastructure: Freero self-hosts and syncs with both Jira Cloud and Data Center.',
    'You plan in Linear or GitHub as well as Jira, with two-way sync for all three.',
    'You need a whiteboard people can use with a keyboard and a screen reader.',
    'You want AI agents to propose board changes that people accept, without spending credits per call.',
    'You want SSO, SCIM and an audit log without a separate security add-on, and no limit on active boards per person.',
    'You invite people from outside without giving them an account.',
  ],
  sections: [
    {
      id: 'data-center',
      title: 'If you run Jira Data Center',
      body: (cite) => (
        <>
          <p>
            Confluence whiteboards can’t link Jira from Data Center sites, and Atlassian says there are currently no plans to bring whiteboards to Data
            Center. {cite('C4', 'C1')} Data Center itself reaches end of life on 28 March 2029; new customer licences stopped on 30 March 2026.{' '}
            {cite('C17')}
          </p>
          <p>
            Freero connects to Jira Data Center with a personal access token and syncs cards both ways, using webhooks where your version supports them and
            polling otherwise. It can run on your own servers, next to Jira. See <a href="/open-source">self-hosting Freero</a>,{' '}
            <a href="/security">security</a>, and <a href="/agents">how agents work on Freero boards</a> with <a href="/claude">Claude</a> or{' '}
            <a href="/chatgpt">ChatGPT</a>.
          </p>
          <p>
            Freero can’t import Confluence whiteboards. It imports CSV, draw.io and Excalidraw files, and can pull Jira issues onto a board by query.
          </p>
        </>
      ),
    },
  ],
  faq: [
    {
      q: 'Are Confluence whiteboards available on Data Center?',
      a: 'No. Confluence whiteboards run only on Confluence Cloud, and Atlassian says it has no current plans to bring them to Data Center. Freero can be self-hosted and syncs with Jira Data Center as well as Jira Cloud.',
    },
    {
      q: 'Is there a self-hosted alternative to Confluence whiteboards?',
      a: 'Freero is MIT licensed and runs on your own servers with Docker and PostgreSQL, with two-way Jira, Linear and GitHub sync, SSO and SCIM included.',
    },
    {
      q: 'Can I use Freero alongside Confluence?',
      a: 'Yes. Freero doesn’t replace Confluence’s pages. Teams keep documents in Confluence and use Freero boards for planning and workshops, with cards synced to Jira.',
    },
  ],
  sources: [
    { id: 'C1', title: 'Atlassian: Confluence whiteboards', url: 'https://www.atlassian.com/software/whiteboards', checked: '2026-10-28' },
    { id: 'C2', title: 'Atlassian: Confluence pricing', url: 'https://www.atlassian.com/software/confluence/pricing', checked: '2026-10-28' },
    { id: 'C3', title: 'Atlassian Support: Understand Confluence whiteboards plans and features', url: 'https://support.atlassian.com/confluence-cloud/docs/understand-confluence-whiteboards-plans-and-features/', checked: '2026-10-28' },
    { id: 'C4', title: 'Atlassian Support: What Confluence whiteboards don’t support', url: 'https://support.atlassian.com/confluence-cloud/docs/what-confluence-whiteboards-dont-support/', checked: '2026-10-28' },
    { id: 'C5', title: 'Atlassian Support: Create and edit Confluence whiteboards', url: 'https://support.atlassian.com/confluence-cloud/docs/create-and-edit-confluence-whiteboards/', checked: '2026-10-28' },
    { id: 'C6', title: 'Atlassian Support: Take bulk Jira actions with smart sections', url: 'https://support.atlassian.com/confluence-cloud/docs/take-bulk-jira-actions-with-smart-sections/', checked: '2026-10-28' },
    { id: 'C7', title: 'Atlassian Support: Atlassian Intelligence in Confluence whiteboards', url: 'https://support.atlassian.com/confluence-cloud/docs/atlassian-intelligence-in-confluence-whiteboards/', checked: '2026-10-28' },
    { id: 'C8', title: 'Atlassian Support: Share Confluence Cloud whiteboards with external users', url: 'https://support.atlassian.com/confluence/kb/share-confluence-cloud-whiteboards-with-external-users/', checked: '2026-10-28' },
    { id: 'C9', title: 'Atlassian: Rovo licensing', url: 'https://www.atlassian.com/licensing/rovo', checked: '2026-10-28' },
    { id: 'C11', title: 'Atlassian Support: Getting started with the Atlassian Rovo MCP Server', url: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/', checked: '2026-10-28' },
    { id: 'C12', title: 'Atlassian Support: Rovo MCP Server supported tools', url: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/', checked: '2026-10-28' },
    { id: 'C13', title: 'Atlassian Developer: Confluence REST API v2, Whiteboard', url: 'https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-whiteboard/', checked: '2026-10-28' },
    { id: 'C14', title: 'Atlassian Developer: Confluence Cloud webhooks', url: 'https://developer.atlassian.com/cloud/confluence/modules/webhook/', checked: '2026-10-28' },
    { id: 'C15', title: 'Atlassian: Guard pricing', url: 'https://www.atlassian.com/software/guard/pricing', checked: '2026-10-28' },
    { id: 'C16', title: 'Atlassian Support: Understand data residency', url: 'https://support.atlassian.com/security-and-access-policies/docs/understand-data-residency/', checked: '2026-10-28' },
    { id: 'C17', title: 'Atlassian: Migration and Data Center changes', url: 'https://www.atlassian.com/migration', checked: '2026-10-28' },
  ],
});
