// /integrations — everything that connects to Freero, by category, from the shared catalog
// (@freero/shared integrations.ts): the list the app's Apps & agents page shows too.
//
// Community listings are not here, featured or not: they live in the app only. The site is built
// once into static files and the same build serves every Freero deployment, while listings are
// one server's data, approved by that server's operator; and a developer's own words and links on
// indexable pages under Freero's name would invite link spam. Featuring a listing puts it first
// in the app.
import { INTEGRATION_CATEGORIES, INTEGRATIONS } from '@freero/shared';
import { ButtonLink, Hero, Section } from '../../components/ui';
import { definePage } from '../../lib/define';
import { categoryAnchor, entriesIn, IntegrationCards, integrationsItemList } from '../../lib/integrations';
import { APP } from '../../lib/site';

export default definePage({
  path: '/integrations',
  name: 'Integrations',
  title: 'Freero integrations: AI agents, Jira, Slack, Figma and more',
  ogTitle: 'Everything that connects to Freero',
  description: `${INTEGRATIONS.length} integrations for Freero whiteboards: AI agents over MCP, Jira, Linear and GitHub sync, Slack and Teams, live embeds, SSO, SCIM and the API.`,
  updated: '2026-10-29',
  sitemap: 'integrations',
  jsonLd: [integrationsItemList()],
  faq: [
    {
      q: 'Does Freero have an app marketplace?',
      a: 'Yes: Apps & agents in Freero lists every integration on this page with the one step that connects it, plus community integrations people built on Freero’s MCP server and API, each reviewed before it is listed.',
    },
    {
      q: 'Do integrations cost extra?',
      a: 'No. Every integration on this page is part of Freero, which is free and open source. The other service may have its own plans and prices.',
    },
    {
      q: 'My AI assistant isn’t listed. Will it work?',
      a: 'Most likely. Freero is a remote MCP server, so any client that speaks MCP over Streamable HTTP connects with your server’s MCP address and signs in with your Freero account.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Integrations"
        title="Everything that connects to Freero"
        lead="AI agents, issue trackers, chat, live embeds, calls, sign-in and automation. Each one is part of every Freero server, with one step to connect it. Any MCP client works with every board."
        actions={
          <>
            <ButtonLink href={APP.apps}>Open Apps &amp; agents</ButtonLink>
            <ButtonLink href={`#${categoryAnchor('agents')}`} variant="secondary">
              AI agents
            </ButtonLink>
          </>
        }
      >
        <p className="works-with">
          Jump to:{' '}
          {INTEGRATION_CATEGORIES.map((c, i) => (
            <span key={c.id}>
              {i ? ' · ' : ''}
              <a href={`#${categoryAnchor(c.id)}`}>{c.label}</a>
            </span>
          ))}
        </p>
      </Hero>
      {INTEGRATION_CATEGORIES.map((c, i) => (
        <Section key={c.id} id={categoryAnchor(c.id)} title={c.label} lead={c.blurb} tone={i % 2 ? 'tint' : 'plain'}>
          <IntegrationCards entries={entriesIn(c.id)} />
        </Section>
      ))}
      <Section id="community" title="Built by the community" lead="Integrations people built on Freero’s MCP server, REST API and webhooks." narrow>
        <p>
          Community listings are in the app, under <a href={APP.apps}>Apps &amp; agents</a>: each one is reviewed by your Freero server’s operator before
          anyone sees it, carries a Community label, and can be reported. Built something? Submit it there.
        </p>
      </Section>
    </>
  ),
});
