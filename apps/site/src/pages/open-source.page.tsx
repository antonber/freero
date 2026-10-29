import { ButtonLink, Card, Cards, Checks, Code, Hero, Section, Step, Steps } from '../components/ui';
import { definePage } from '../lib/define';
import { docsUrl, SOURCE_REPO } from '../lib/site';

export default definePage({
  path: '/open-source',
  name: 'Open source',
  title: 'Open-source, self-hosted whiteboard (MIT): Freero',
  ogTitle: 'An open-source whiteboard you can host yourself',
  description:
    'Freero is an MIT-licensed collaborative whiteboard. Run it with Docker on your own servers, with the MCP server, Jira sync, SSO and SCIM included.',
  updated: '2026-10-28',
  faq: [
    {
      q: 'Is there an enterprise edition or a licence key?',
      a: 'No. There is one codebase under the MIT licence. SSO, SCIM, the audit log, the admin console, tracker sync and the MCP server are in every installation.',
    },
    {
      q: 'What do I need to run Freero in production?',
      a: 'Docker (or Node 22), PostgreSQL 15 or newer, and a reverse proxy for TLS. Add Redis and S3-compatible storage to run more than one instance. Everything is configured with environment variables.',
    },
    {
      q: 'Can I turn the marketing pages off on my server?',
      a: 'Yes. Set SITE=false and the address people open goes straight to the app; no marketing page is served and search engines are asked to stay away.',
    },
    {
      q: 'Which licences do Freero’s dependencies use?',
      a: 'Permissive ones only: licences such as MIT, Apache-2.0, BSD, ISC and MPL-2.0 for code, and the SIL Open Font License for the Inter typeface. GPL, AGPL and source-available projects are integrated at the protocol level, never bundled.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Open source"
        title="An open-source whiteboard you can run yourself."
        lead="Freero is MIT licensed, from the canvas to the MCP server. Use it here, or run the same code on your own servers, under your own policies, next to your own Jira."
        actions={
          <>
            <ButtonLink href={SOURCE_REPO}>Get the source</ButtonLink>
            <ButtonLink href="#self-host" variant="secondary">
              Self-host it
            </ButtonLink>
          </>
        }
      />

      <Section id="why" title="Why open source matters for a whiteboard" lead="Your boards hold plans, research and decisions. You should be able to see how they are handled and choose where they live.">
        <Cards cols={3}>
          <Card title="No lock-in" tint="violet" mark="↔">
            Export boards as images, PDF, SVG, CSV, Markdown or JSON; read everything through the API; take the whole server with you.
          </Card>
          <Card title="Inspectable security" tint="mint" mark="◎">
            The permission checks, the agent safety rules and the audit log are code you can read and test, not a promise on a page.
          </Card>
          <Card title="Your infrastructure" tint="yellow" mark="⌂">
            Keep data in your region and network, behind your SSO, connected to your self-managed Jira Data Center or GitHub Enterprise Server.
          </Card>
        </Cards>
      </Section>

      <Section id="self-host" tone="tint" title="Self-host in three steps" lead="One Docker image serves the app, the realtime connections, the API, the MCP server and these pages.">
        <Steps>
          <Step title="Get the code and build the image">
            <Code label="Terminal">{`git clone ${SOURCE_REPO}.git && cd freero
docker build -t freero .`}</Code>
          </Step>
          <Step title="Try the whole stack on one machine">
            <Code label="Terminal">{`docker compose up --build -d
# open http://localhost:8080 and sign up`}</Code>
            The compose file runs Caddy in front of two app instances, PostgreSQL, Redis, MinIO for files and Mailpit for mail.
          </Step>
          <Step title="Make it yours">
            Set <code>PUBLIC_URL</code>, <code>SESSION_SECRET</code> and <code>DATABASE_URL</code>, put TLS in front, and schedule the backup script. Turn on
            what you need: SMTP, Google or Microsoft sign-in, an AI provider, tracker OAuth apps.
          </Step>
        </Steps>
        <p>
          Guides: <a href={docsUrl('docs/deployment.md')}>deployment</a>, <a href={docsUrl('docs/configuration.md')}>configuration</a>,{' '}
          <a href={docsUrl('docs/operations.md')}>operations and backups</a>.
        </p>
      </Section>

      <Section id="included" title="Included in every installation" narrow>
        <div className="columns-2">
          <Checks
            kind="yes"
            items={[
              'Real-time boards, comments, notifications and version history',
              'The MCP server and its OAuth sign-in, the REST API, webhooks',
              'Jira Cloud and Data Center, Linear and GitHub sync',
              'Built-in AI on the provider you configure, including local models',
            ]}
          />
          <Checks
            kind="yes"
            items={[
              'Team workspaces, SSO (SAML, OpenID Connect) and SCIM',
              'Audit log, admin console, retention and data exports',
              'Health checks, Prometheus metrics, JSON logs, an admin CLI',
              'Horizontal scaling with PostgreSQL, Redis and S3-compatible storage',
            ]}
          />
        </div>
      </Section>

      <Section id="contribute" tone="tint" title="Built to be changed" narrow>
        <p>
          Freero’s codebase is organised so that a new feature is a new folder: features are discovered by convention, every piece of state has one writer,
          and an automated check fails when code crosses a boundary, naming the supported path. That keeps contributions small and reviews short.
        </p>
        <p>
          Start with <a href={docsUrl('ARCHITECTURE.md')}>ARCHITECTURE.md</a> and <a href={docsUrl('README.md')}>the README</a>.
        </p>
      </Section>
    </>
  ),
});
