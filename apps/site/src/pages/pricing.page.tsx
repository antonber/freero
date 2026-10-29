import { ButtonLink, Checks, Hero, Section, Table } from '../components/ui';
import { definePage } from '../lib/define';
import { softwareApplication } from '../lib/seo';
import { APP, docsUrl } from '../lib/site';

export default definePage({
  path: '/pricing',
  name: 'Pricing',
  title: 'Pricing: Freero is free, with no paid plans',
  ogTitle: 'Free means free',
  description:
    'Freero costs nothing: every feature, unlimited editors and viewers, SSO and SCIM included. The fair-use limits of the hosted service, listed plainly.',
  updated: '2026-10-28',
  jsonLd: [softwareApplication()],
  faq: [
    {
      q: 'What’s the catch?',
      a: 'There isn’t a paid tier waiting behind the free one. Freero is an open-source project; the hosted service exists so teams can use it without running a server. The limits below keep that service fair for everyone, and anyone who needs more can host Freero themselves.',
    },
    {
      q: 'Do guests and viewers count as paid seats?',
      a: 'There are no seats. Invite as many editors, commenters and viewers as you like, and let visitors join a shared link as guests without an account.',
    },
    {
      q: 'Is AI included?',
      a: 'Freero’s built-in AI actions run on a model provider your team brings: you pay that provider directly, at its prices, and Freero adds nothing on top. Agents you connect, such as Claude or ChatGPT, run on your plan with that vendor.',
    },
    {
      q: 'What happens if I reach a limit?',
      a: 'The action that would go over it is refused with a clear message, and nothing you already have is touched. Rate limits reset within the minute or hour they apply to.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Pricing"
        title="Free. Every feature, every team size."
        lead="No plans, no seats, no trial that runs out. SSO, SCIM, the audit log, tracker sync and the MCP server are part of Freero, not a tier of it."
        actions={
          <>
            <ButtonLink href={APP.signup}>Start free</ButtonLink>
            <ButtonLink href="/open-source" variant="secondary">
              Host it yourself
            </ButtonLink>
          </>
        }
      />

      <Section id="included" title="What you get" narrow>
        <div className="columns-2">
          <Checks
            kind="yes"
            items={[
              'As many editors, commenters and viewers as you like',
              'Guests on shared links, without an account',
              'Every whiteboard and workshop feature',
              'Agents over MCP, the REST API and webhooks',
            ]}
          />
          <Checks
            kind="yes"
            items={[
              'Jira, Linear and GitHub two-way sync',
              'Team workspaces, SSO, SCIM and the admin console',
              'Audit log, retention policies and data exports',
              'The source code, under the MIT licence',
            ]}
          />
        </div>
      </Section>

      <Section id="limits" tone="tint" title="Fair-use limits of the hosted service" lead="These are the defaults of every Freero server, and the hosted service runs with them. A self-hosted Freero can change all of them.">
        <Table
          caption="Hosted service limits"
          head={['What', 'Limit']}
          rows={[
            ['Boards you own', '5,000 per account, across all your workspaces'],
            ['Team workspaces you own', '20 per account'],
            ['Saved templates', '500 per account'],
            ['Upload storage', '1 GB per account, for images, documents, video, audio and other files'],
            ['One image or PDF', '15 MB'],
            ['One video or audio file', '100 MB'],
            ['Any other file', '50 MB'],
            ['API and MCP requests', '300 per minute per token or connected app'],
            ['Changes an agent makes', '60 board changes per minute per token or connected app, up to 500 items per call'],
            ['Webhook endpoints', '20 per team workspace'],
          ]}
        />
        <p>
          Every limit, with its setting name: <a href={docsUrl('docs/configuration.md')}>configuration reference</a>.
        </p>
      </Section>
    </>
  ),
});
