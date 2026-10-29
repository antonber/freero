import { Card, Cards, Hero, Section } from '../components/ui';
import { definePage } from '../lib/define';
import { docsUrl } from '../lib/site';

const GROUPS: Array<{ id: string; title: string; lead: string; docs: Array<[string, string, string]> }> = [
  {
    id: 'agents',
    title: 'Agents and integrations',
    lead: 'Connect assistants and build your own.',
    docs: [
      ['MCP server', 'docs/mcp.md', 'Connect Claude, ChatGPT, Claude Code, Cursor and VS Code; permissions, safety and every tool.'],
      ['Board outline', 'docs/board-outline.md', 'The structured read of a board that agents and the REST API return.'],
      ['REST API', 'docs/api/README.md', 'Tokens, OAuth apps, scopes and the rules every call follows.'],
      ['Events and webhooks', 'docs/events.md', 'The event contract, signatures, retries and the Slack and Teams formats.'],
      ['Issue trackers', 'docs/trackers.md', 'Jira, Linear and GitHub: connecting, what maps to what, conflicts, roadmaps.'],
      ['AI in Freero', 'docs/ai.md', 'The built-in AI actions, your model provider, and what happens to your data.'],
    ],
  },
  {
    id: 'self-hosting',
    title: 'Running Freero',
    lead: 'For operators of a self-hosted Freero.',
    docs: [
      ['Deployment', 'docs/deployment.md', 'One VM with Docker Compose, or any cloud with managed services; TLS, scaling, upgrades.'],
      ['Configuration', 'docs/configuration.md', 'Every environment variable, its default and what it does.'],
      ['Operations', 'docs/operations.md', 'Backups and restores, monitoring, secret rotation, SSO, GDPR requests, moderation.'],
      ['Accessibility', 'docs/accessibility.md', 'Keyboard and screen-reader support, how it is checked, and the known gaps.'],
    ],
  },
  {
    id: 'contributing',
    title: 'Contributing',
    lead: 'How the code is organised.',
    docs: [
      ['Architecture', 'ARCHITECTURE.md', 'Layers, single writers, the server modules and how features are discovered.'],
      ['README', 'README.md', 'Run Freero locally and the commands that check a change.'],
    ],
  },
];

export default definePage({
  path: '/docs',
  name: 'Documentation',
  title: 'Freero documentation: MCP, API, webhooks, self-hosting',
  ogTitle: 'Documentation',
  description:
    'Guides for connecting AI agents over MCP, the REST API and webhooks, Jira and Linear sync, and deploying and operating a self-hosted Freero.',
  updated: '2026-10-28',
  body: () => (
    <>
      <Hero
        kicker="Documentation"
        title="Freero documentation"
        lead="The guides live next to the code, so they change with it. Start with the MCP server if you want an assistant on your boards, or with deployment if you run your own Freero."
      >
        <p className="works-with">
          Quick starts: <a href="/claude#setup">connect Claude</a> · <a href="/chatgpt#setup">connect ChatGPT</a> · <a href="/agents">build an agent</a> ·{' '}
          <a href="/open-source#self-host">self-host</a>
        </p>
      </Hero>
      {GROUPS.map((g, i) => (
        <Section key={g.id} id={g.id} title={g.title} lead={g.lead} tone={i % 2 ? 'tint' : 'plain'}>
          <Cards cols={3}>
            {g.docs.map(([title, file, body]) => (
              <Card key={file} title={title} href={docsUrl(file)}>
                {body}
              </Card>
            ))}
          </Cards>
        </Section>
      ))}
      <Section id="reference" title="API reference" narrow tone="tint">
        <p>
          Every Freero server serves its OpenAPI 3.1 description at <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>; load it into your API client or
          code generator.
        </p>
      </Section>
    </>
  ),
});
