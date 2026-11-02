// /features — every feature page (lib/features.tsx), and the jobs and templates around them.
import { ButtonLink, Card, Cards, Hero, Section } from '../../components/ui';
import { definePage } from '../../lib/define';
import { FEATURES, featurePath } from '../../lib/features';
import { APP } from '../../lib/site';
import { SITE_TEMPLATES } from '../../lib/templates';
import { USE_CASES, useCasePath } from '../../lib/useCases';

export default definePage({
  path: '/features',
  name: 'Features',
  title: 'Features: kanban, mind maps, flowcharts and more | Freero',
  ogTitle: 'Everything on a Freero board',
  description:
    'What you can do on Freero, the free, open-source online whiteboard: kanban boards, mind maps, flowcharts, workshops, and AI agents on the board.',
  updated: '2026-11-02',
  sitemap: 'features',
  body: () => (
    <>
      <Hero
        kicker="Features"
        title="Everything on a Freero board"
        lead="One infinite canvas for the meeting, the plan and the diagram, shared live with your team and the AI agents you connect. Every feature is free, for every team size."
        actions={<ButtonLink href={APP.signup}>Start free</ButtonLink>}
      />
      <Section id="list" title="Pick a feature">
        <Cards cols={2}>
          {FEATURES.map((f) => (
            <Card key={f.slug} title={f.name} href={featurePath(f.slug)}>
              <p>{f.summary}</p>
            </Card>
          ))}
        </Cards>
      </Section>
      <Section id="jobs" tone="tint" title="What teams use them for">
        <Cards cols={3}>
          {USE_CASES.map((u) => (
            <Card key={u.slug} title={u.name} href={useCasePath(u.slug)}>
              <p>{u.summary}</p>
            </Card>
          ))}
        </Cards>
        <p>
          Or start from one of {SITE_TEMPLATES.length} <a href="/templates">templates</a>, connect <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>,
          or read how Freero <a href="/vs">compares with other whiteboards</a>.
        </p>
      </Section>
    </>
  ),
});
