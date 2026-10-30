// /use-cases — every use case (lib/useCases.tsx), each with the templates it uses.
import { ButtonLink, Card, Cards, Hero, Section } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP } from '../../lib/site';
import { USE_CASES, useCasePath } from '../../lib/useCases';

export default definePage({
  path: '/use-cases',
  name: 'Use cases',
  title: 'What teams do with Freero: retros, planning, roadmaps',
  ogTitle: 'What teams do on Freero',
  description:
    'How teams use Freero, the free whiteboard for people and AI agents: retros, planning poker, workshops, Jira planning, roadmaps and agent control rooms.',
  updated: '2026-10-30',
  sitemap: 'use-cases',
  body: () => (
    <>
      <Hero
        kicker="Use cases"
        title="What teams do on Freero"
        lead="One board for the meeting, the plan and the work that follows, with your AI agents in the room. Each page shows how a job runs in Freero and the templates to start from."
        actions={<ButtonLink href={APP.signup}>Start free</ButtonLink>}
      />
      <Section id="list" title="Pick a use case">
        <Cards cols={3}>
          {USE_CASES.map((u) => (
            <Card key={u.slug} title={u.name} href={useCasePath(u.slug)}>
              <p>{u.summary}</p>
            </Card>
          ))}
        </Cards>
        <p>
          Or browse <a href="/templates">every template</a>.
        </p>
      </Section>
    </>
  ),
});
