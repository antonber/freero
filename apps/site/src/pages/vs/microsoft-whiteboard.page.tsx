// Freero vs Microsoft Whiteboard (#71). Facts: docs/marketing/competitors/microsoft-whiteboard.md.
// Its framing correction holds: only the standalone apps, legacy Azure boards and personal-account
// editing ended; Whiteboard continues in Teams and on the web for work and school accounts. Left out
// as "Could not verify": every Microsoft 365 and Copilot price (press only), which plans include
// Whiteboard, what personal accounts can still view or export, Loop as a successor, a
// Whiteboard-specific ACR and the template count. Absences ("no MCP server") are worded as what
// Microsoft documents, citing the pages checked.
import { defineComparison } from '../../lib/compare';
import { SITE_TEMPLATES } from '../../lib/templates';

export default defineComparison({
  slug: 'microsoft-whiteboard',
  competitor: 'Microsoft Whiteboard',
  column: 'Microsoft Whiteboard',
  checked: '2026-10-28',
  published: true,
  title: 'Microsoft Whiteboard alternative after the app retirement',
  description:
    'Microsoft retired the standalone Whiteboard apps on 16 October 2026; Teams and web continue for work accounts. How Freero compares, sourced and dated.',
  summary:
    'Microsoft Whiteboard is the freeform canvas built into Microsoft Teams and Microsoft 365, with boards saved to OneDrive. Freero is an open-source whiteboard for teams of people and AI agents that anyone can use without a Microsoft 365 subscription, or run on their own servers.',
  trademark: 'Microsoft, Microsoft Whiteboard, Microsoft 365 and Microsoft Teams are trademarks of the Microsoft group of companies.',
  rows: [
    {
      capability: 'Where it runs',
      competitor: { verdict: 'partial', note: 'in Teams and on the web, for work and school accounts; standalone apps retired 2026-10-16', sources: ['W1', 'W4'] },
      freero: { verdict: 'yes', note: 'any current browser, installable as a web app', ref: 'docs/parity.md' },
    },
    {
      capability: 'Personal accounts',
      competitor: { verdict: 'no', note: 'creating and editing boards ended 2026-09-25', sources: ['W3'] },
      freero: { verdict: 'yes', note: 'sign up with an email address, or sign in with Google or Microsoft', ref: 'docs/parity.md' },
    },
    {
      capability: 'Without a paid subscription',
      competitor: { verdict: 'no', note: 'no price of its own: it comes with a Microsoft 365 commercial or education subscription', sources: ['W5'] },
      freero: { verdict: 'yes', note: 'no paid plans or licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'Open source, on your own servers',
      competitor: { verdict: 'no', note: 'a Microsoft 365 cloud service; boards are files in the creator’s OneDrive', sources: ['W6'] },
      freero: { verdict: 'yes', note: 'MIT licence; Docker, in any region', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Inside Microsoft Teams',
      competitor: { verdict: 'yes', note: 'in meetings, chats and channels', sources: ['W1'] },
      freero: { verdict: 'partial', note: 'a board links to your Teams meeting; webhooks post to Teams channels', ref: 'docs/events.md' },
    },
    {
      capability: 'Built-in AI',
      competitor: { verdict: 'paid', note: 'Copilot suggests, groups and summarises sticky notes; needs a Copilot licence', sources: ['W8'] },
      freero: { verdict: 'partial', note: 'off until you connect a model; no chat assistant', ref: 'docs/ai.md' },
    },
    {
      capability: 'Bring your own AI model',
      competitor: { verdict: 'no', note: 'Copilot only', sources: ['W8'] },
      freero: { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, Azure OpenAI and local models included', ref: 'docs/ai.md' },
    },
    {
      capability: 'AI agents on boards (MCP)',
      competitor: { verdict: 'no', note: 'none documented: Microsoft describes Copilot, and no API for board content', sources: ['W8', 'W9'] },
      freero: { verdict: 'yes', note: 'agents suggest changes that people accept; direct writes are opt-in', ref: 'docs/mcp.md' },
    },
    {
      capability: 'API for board content',
      competitor: { verdict: 'no', note: 'the Microsoft Graph whiteboard reference returns “not found”', sources: ['W9'] },
      freero: { verdict: 'yes', note: 'REST API with an OpenAPI description, and signed webhooks', ref: 'docs/api/openapi.json' },
    },
    {
      capability: 'Jira, Linear and GitHub sync',
      competitor: { verdict: 'no', note: 'its documented integrations are Teams, OneDrive and Loop', sources: ['W1', 'W8'] },
      freero: { verdict: 'yes', note: 'two-way, Jira Cloud and Data Center included', ref: 'docs/trackers.md' },
    },
    {
      capability: 'Single sign-on',
      competitor: { verdict: 'yes', note: 'Microsoft Entra ID, with Conditional Access', sources: ['W5'] },
      freero: { verdict: 'yes', note: 'SAML 2.0 or OpenID Connect per workspace, and SCIM', ref: 'docs/configuration.md' },
    },
    {
      capability: 'People outside your organization',
      competitor: { verdict: 'partial', note: 'anonymous people only during a Teams meeting; otherwise specific-people links and guest (B2B) accounts', sources: ['W7'] },
      freero: { verdict: 'yes', note: 'named guests on a shared link view and comment; editing needs an account', ref: 'docs/parity.md' },
    },
    {
      capability: 'Audit trail',
      competitor: { verdict: 'yes', note: 'board file activity in Microsoft Purview', sources: ['W6'] },
      freero: { verdict: 'yes', note: 'per-workspace audit log, exportable; no SIEM streaming yet', ref: 'docs/parity.md' },
    },
    {
      capability: 'Retention, legal hold, DLP, eDiscovery',
      competitor: { verdict: 'yes', note: 'through OneDrive and Microsoft 365', sources: ['W6'] },
      freero: { verdict: 'partial', note: 'retention of trash, history and the audit log; no eDiscovery, legal hold or DLP', ref: 'docs/parity.md' },
    },
    {
      capability: 'Security certifications',
      competitor: { verdict: 'yes', note: 'SOC 1, SOC 2, ISO 27001, HIPAA', sources: ['W5'] },
      freero: { verdict: 'no', ref: 'docs/parity.md' },
    },
    {
      capability: 'Where data is stored',
      competitor: { verdict: 'yes', note: 'wherever the tenant’s OneDrive data lives', sources: ['W6'] },
      freero: { verdict: 'yes', note: 'wherever you host it; no hosted regions', ref: 'docs/deployment.md' },
    },
    {
      capability: 'Apps',
      competitor: { verdict: 'partial', note: 'inside the Teams apps; the standalone Windows, iOS and Android apps retired 2026-10-16', sources: ['W4'] },
      freero: { verdict: 'no', note: 'installable web app; phones view and comment', ref: 'docs/parity.md' },
    },
    {
      capability: 'Templates',
      competitor: { verdict: 'yes', sources: ['W10'] },
      freero: { verdict: 'yes', note: `${SITE_TEMPLATES.length} originals`, ref: 'README.md' },
    },
  ],
  competitorStronger: [
    'Your organization already pays for Microsoft 365 and you want a board inside Teams meetings and chats, saved to OneDrive, with nothing new to buy or run.',
    'Your compliance team relies on Microsoft 365 controls: Purview auditing, retention, legal hold, DLP and eDiscovery, and certifications such as SOC 2, ISO 27001 and HIPAA.',
    'You draw on Surface Hub or Teams Rooms devices in meeting rooms.',
    'You have Microsoft 365 Copilot and want it to sort and summarise sticky notes on the board.',
    'You need the interface in a language other than English.',
  ],
  freeroStronger: [
    'You used Whiteboard with a personal Microsoft account, or you work without a Microsoft 365 subscription.',
    'You want AI agents such as Claude or ChatGPT to read your boards and propose changes that people accept or reject.',
    'You want two-way Jira, Linear or GitHub sync, a REST API and webhooks for your boards.',
    'You want to host the whiteboard yourself, under the MIT licence, so a vendor can’t retire it or move your boards.',
    'You run workshops: voting, a shared timer, polls, word clouds, Q&A and planning poker are built in.',
  ],
  sections: [
    {
      id: 'what-changed',
      title: 'What changed for Microsoft Whiteboard in 2026',
      lead: 'Microsoft Whiteboard has not shut down. Three things ended this autumn; the rest continues.',
      placement: 'intro',
      body: (cite) => (
        <>
          <dl className="dates">
            <dt>
              <time dateTime="2026-09-25">25 September 2026</time>
            </dt>
            <dd>
              Personal Microsoft accounts can no longer create or edit whiteboards. The tool that moved older boards from Azure storage to OneDrive stopped, and
              boards still in Azure became read-only. {cite('W3', 'W2')}
            </dd>
            <dt>
              <time dateTime="2026-10-16">16 October 2026</time>
            </dt>
            <dd>
              The standalone Whiteboard apps for Windows, iOS and Android retired, for work, school and personal accounts alike. Boards that were still in Azure
              storage were permanently deleted. {cite('W1', 'W4', 'W2')}
            </dd>
            <dt>
              <time dateTime="2026-11-30">30 November 2026</time>
            </dt>
            <dd>The Azure service behind those older boards shuts down. {cite('W2')}</dd>
            <dt>Continuing</dt>
            <dd>
              For work and school accounts, Whiteboard carries on in Microsoft Teams and on the web, with boards saved to OneDrive. {cite('W1', 'W4', 'W6')}
            </dd>
          </dl>
          <p>
            Some older Microsoft pages give other dates for the app retirement; the dates above are the ones on Microsoft’s dedicated retirement page and its
            Message Center notice MC1469557.
          </p>
        </>
      ),
    },
    {
      id: 'moving',
      title: 'Moving boards to Freero',
      body: (cite) => (
        <>
          <p>
            Freero has no Microsoft Whiteboard importer. Microsoft documents exporting a board as an image, and an HTML export for administrators of older
            boards. {cite('W2')} An exported image can go on a Freero board as a picture to work around, but it won’t turn back into editable sticky notes.
          </p>
          <p>
            From there, Freero gives you an infinite canvas with sticky notes, pens, shapes, connectors, frames and templates, and every board exports as an
            image, PDF, SVG or CSV, or as a backup file that restores on any Freero server. If your team works with AI, start with{' '}
            <a href="/agents">how agents work on Freero boards</a>, or connect <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>. If you would
            rather keep boards on your own servers, read <a href="/open-source">self-hosting Freero</a>; for sign-in and controls, see{' '}
            <a href="/security">security</a>.
          </p>
        </>
      ),
    },
  ],
  faq: [
    {
      q: 'Is Microsoft Whiteboard shut down?',
      a: 'No. Microsoft retired the standalone Windows, iOS and Android apps on 16 October 2026, and personal accounts lost the ability to create or edit boards on 25 September 2026. For work and school accounts, Whiteboard continues in Microsoft Teams and on the web.',
    },
    {
      q: 'What can I use instead of the Microsoft Whiteboard app?',
      a: 'If your organization has Microsoft 365, the same Whiteboard is still in Teams and on the web. If you used a personal account or don’t have Microsoft 365, Freero is a free, open-source whiteboard that runs in any current browser and installs as a web app.',
    },
    {
      q: 'Can I import my Microsoft Whiteboard boards into Freero?',
      a: 'Not as editable content: Freero has no Whiteboard importer. You can export a board as an image and place it on a Freero board, then rebuild the parts you need on top of it.',
    },
    {
      q: 'Does Freero work with Microsoft Teams?',
      a: 'Partly. Freero isn’t an app inside Teams. A board can carry a link to your Teams meeting, people can sign in with a Microsoft account or your organization’s SSO, and webhooks can post board activity to a Teams channel.',
    },
  ],
  sources: [
    { id: 'W1', title: 'Microsoft Support: Retirement of the standalone Microsoft Whiteboard apps', url: 'https://support.microsoft.com/en-us/whiteboard/retirement-standalone-microsoft-whiteboard-apps', checked: '2026-10-28' },
    { id: 'W2', title: 'Microsoft Support: Migration of whiteboards from Azure to OneDrive', url: 'https://support.microsoft.com/en-us/whiteboard/migration-of-whiteboards-from-azure-to-onedrive', checked: '2026-10-28' },
    { id: 'W3', title: 'Microsoft 365 Message Center MC1441775 (public mirror)', url: 'https://mc.merill.net/message/MC1441775', checked: '2026-10-28' },
    { id: 'W4', title: 'Microsoft 365 Message Center MC1469557 (public mirror)', url: 'https://mc.merill.net/message/MC1469557', checked: '2026-10-28' },
    { id: 'W5', title: 'Microsoft Learn: Manage access to Whiteboard for your organization', url: 'https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-whiteboard-access-organizations', checked: '2026-10-28' },
    { id: 'W6', title: 'Microsoft Learn: Manage data for Whiteboard', url: 'https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-data-organizations', checked: '2026-10-28' },
    { id: 'W7', title: 'Microsoft Learn: Manage sharing for Whiteboard', url: 'https://learn.microsoft.com/en-us/microsoft-365/whiteboard/manage-sharing-organizations', checked: '2026-10-28' },
    { id: 'W8', title: 'Microsoft Support: Welcome to Copilot in Whiteboard', url: 'https://support.microsoft.com/en-US/whiteboard/welcome-to-copilot-in-whiteboard', checked: '2026-10-28' },
    { id: 'W9', title: 'Microsoft Learn: Graph “whiteboard” resource (returned 404)', url: 'https://learn.microsoft.com/en-us/graph/api/resources/whiteboard', checked: '2026-10-28' },
    { id: 'W10', title: 'Microsoft Support: Insert templates in Whiteboard', url: 'https://support.microsoft.com/en-us/whiteboard/insert-templates-in-whiteboard', checked: '2026-10-28' },
  ],
});
