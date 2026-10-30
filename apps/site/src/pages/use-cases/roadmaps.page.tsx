import { ButtonLink, Checks, Hero, Section, Shot, Step, Steps } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP, docsUrl } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('roadmaps');

export default definePage({
  path: '/use-cases/roadmaps',
  name: u.name,
  title: 'Roadmap from Jira or Linear on a whiteboard timeline',
  ogTitle: 'A roadmap that moves with the tracker',
  description:
    'Import Jira or Linear issues onto a whiteboard timeline as a roadmap, in lanes per epic, team or label. Drag a bar and its dates sync back to the issue.',
  updated: '2026-10-30',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'What happens to issues without dates?',
      a: 'They go to an Unscheduled frame under the timeline instead of being dropped. Drag one onto the timeline to give it dates.',
    },
    {
      q: 'Does it work with GitHub issues?',
      a: 'GitHub issues import too, in lanes per milestone, repository or label, but GitHub issues have no start or due dates, so they start in the Unscheduled frame and their dates stay on the board.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · Roadmaps"
        title="A roadmap from Jira or Linear, on a timeline you can move"
        lead="Put the issues your team tracks on a whiteboard timeline: each issue is a bar from its start to its due date, in a lane per epic, team or label. Move a bar and the dates change in the tracker; change them in the tracker and the bar moves."
        actions={
          <>
            <ButtonLink href={APP.signup}>Start free</ButtonLink>
            <ButtonLink href="#templates" variant="secondary">
              Roadmap templates
            </ButtonLink>
          </>
        }
      />

      <Section id="how" title="How it works" tone="tint">
        <div className="columns-2">
          <Steps>
            <Step title="Add a timeline">Pick Timeline from the toolbar’s more tools and click the board: a date axis by day, week, month or quarter, with lanes.</Step>
            <Step title="Import issues onto it">Select the timeline and choose Import issues onto this timeline… from its right-click menu. Run a query and group by epic, team or first label.</Step>
            <Step title="Plan by dragging">Each issue is a linked task card drawn as a bar. Moving or resizing it writes the card’s dates, which sync to the issue like any field.</Step>
            <Step title="Switch the view">The same bars also show as Now · Next · Later, for a roadmap without dates.</Step>
          </Steps>
          <Shot name="roadmap" alt="A roadmap on a Freero timeline: issues from a tracker drawn as bars in lanes per epic, each showing its issue key." caption="Issues imported onto a timeline, a lane per epic." />
        </div>
      </Section>

      <Section id="details" title="Grouped the way your tracker is">
        <Checks
          kind="yes"
          items={[
            'Epic lanes: the parent on Jira, the project on Linear, the milestone on GitHub.',
            'Team lanes: the project on Jira, the team on Linear, the repository on GitHub.',
            'Or a lane per first label. Lanes are matched by name, and the timeline’s range grows to hold the dates.',
            'Dependencies: draw connectors between bars.',
          ]}
        />
        <p>
          Details: <a href={docsUrl('docs/trackers.md')}>roadmap mode in the tracker guide</a>. For planning before anything is in the tracker, start from{' '}
          <a href={useTemplateHref('now-next-later')}>a Now, next, later board</a>.
        </p>
      </Section>

      <Section id="agent" title="With an agent" tone="tint" narrow>
        <p>
          A connected assistant can read the roadmap board’s outline and answer “what is planned for next month?”, or import issues for
          you with <code>import_from_tracker</code>. See <a href="/claude">Claude</a>, <a href="/chatgpt">ChatGPT</a> and <a href="/agents">building with agents</a>.
        </p>
      </Section>

      <Section id="templates" title="Roadmap and planning templates">
        <UseCaseTemplates slug={u.slug} />
      </Section>

      <Section id="more" title="More ways teams use Freero" tone="tint" narrow>
        <OtherUseCases slug={u.slug} />
      </Section>
    </>
  ),
});
