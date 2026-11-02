// /use-cases/user-story-mapping — "user story mapping tool": the story-map template (activities, user
// tasks, release rows; templates/lib/catalog/agile.ts), cards, planning poker, tracker sync. There is
// no dedicated story-map element: the page says it is a template on the whiteboard.
import { ButtonLink, Hero, Prompts, Section, Shot, Step, Steps } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP } from '../../lib/site';
import { templateById, TemplatePreviewImage, useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('user-story-mapping');
const storyMap = templateById('story-map');

export default definePage({
  path: '/use-cases/user-story-mapping',
  name: u.name,
  title: 'User story mapping tool: free story maps online | Freero',
  ogTitle: 'Story maps that turn into a backlog',
  description:
    'Map user stories on a free online whiteboard: activities, tasks and release slices, estimated with planning poker and sent to Jira, Linear or GitHub.',
  updated: '2026-11-02',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'Is there a user story map template?',
      a: 'Yes. The User story map template lays out a row of activities, the user tasks under them, and release rows (Release 1 as the MVP, then Release 2) separated by dashed lines. It is made of ordinary sticky notes, shapes and lines in a frame, so you can edit, extend or move every part.',
    },
    {
      q: 'Can I send the stories to Jira?',
      a: 'Yes. Select the stories in a release row and send them to Jira Cloud, Jira Data Center, Linear or GitHub as one issue each. Each note then shows its issue’s key, status and assignee, kept in sync both ways.',
    },
    {
      q: 'Can we estimate the stories on the map?',
      a: 'Yes. Convert story notes to task cards and estimate them with planning poker on the board: picks stay sealed until the reveal and the agreed value is written on the card.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · User story mapping"
        title="User story mapping online, from the first activity to the backlog"
        lead="Lay out how people use your product from left to right, break each step into stories, and slice the map into releases. Freero’s story map is a template on a free collaborative whiteboard, so the whole team builds it together and the stories go straight to your tracker."
        actions={
          <>
            <ButtonLink href={useTemplateHref('story-map')}>Start a story map</ButtonLink>
            <ButtonLink href="#templates" variant="secondary">
              Story mapping templates
            </ButtonLink>
          </>
        }
        aside={
          <figure className="tpl-hero">
            <TemplatePreviewImage t={storyMap} eager alt="The User story map template: a row of activities, user tasks under them, and two release rows." />
            <figcaption>The User story map template as it lands on a board.</figcaption>
          </figure>
        }
      />

      <Section id="how" title="Build the map together" tone="tint">
        <Steps>
          <Step title="The backbone">
            Along the top, write the activities a person goes through, in order: discover, sign up, set up, use, share. Everyone adds at once, with live cursors.
          </Step>
          <Step title="User tasks and stories">
            Under each activity, the tasks people do, and under those the stories that deliver them. Tab adds the next sticky note beside the last.
          </Step>
          <Step title="Release slices">
            Drag the dashed lines to split the stories into Release 1, the smallest version worth shipping, and the releases after it. Add a row for each.
          </Step>
          <Step title="Estimate and ship">
            Convert stories to cards, estimate them with <a href="/use-cases/planning-poker">planning poker</a>, then send the first release to Jira, Linear or
            GitHub as issues that stay in sync.
          </Step>
        </Steps>
      </Section>

      <Section id="tracker" title="From the map to the tracker" lead="The board stays the picture; the tracker holds the work. Freero keeps them in step.">
        <div className="columns-2">
          <ul className="checks checks--yes">
            <li>
              <strong>One issue per story</strong>, or one issue for a whole cluster with a link back to every note.
            </li>
            <li>
              <strong>Live status on the map:</strong> each linked story shows its issue key, status and assignee, updated when the issue changes.
            </li>
            <li>
              <strong>Jira Cloud and Data Center</strong>, Linear, and GitHub including Enterprise Server.
            </li>
          </ul>
          <Shot name="tracker" alt="Sticky notes on a Freero board, each showing its linked Jira issue’s key and status." caption="Sticky notes linked to a Jira issue, with its live status." />
        </div>
        <p>
          More on this in <a href="/use-cases/jira">Jira planning on a whiteboard</a>; for dates, put the releases on a <a href="/use-cases/roadmaps">roadmap timeline</a>.
        </p>
      </Section>

      <Section id="agent" tone="tint" title="Let an agent draft the stories" lead="Connected over MCP, Claude or ChatGPT reads the map and proposes stories; the team decides what stays.">
        <Prompts
          items={[
            { prompt: 'For each activity on this story map, propose the user tasks and stories we are missing.', outcome: 'It proposes sticky notes under each activity, shown as suggestions for the team to accept or reject.' },
            {
              prompt: 'Send the Release 1 stories to Jira, one issue each.',
              outcome: 'It sends them through the same sync people use, and each note shows its new issue.',
              needs: 'permission to change boards',
            },
          ]}
        />
        <p>
          Set it up for <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>. Planning the work as columns instead? See the <a href="/features/kanban-board">kanban board</a>.
        </p>
      </Section>

      <Section id="templates" title="Story mapping templates">
        <UseCaseTemplates slug={u.slug} />
      </Section>

      <Section id="more" tone="tint" title="More ways teams use Freero" narrow>
        <OtherUseCases slug={u.slug} />
        <p>
          <ButtonLink href={APP.signup}>Start free</ButtonLink>
        </p>
      </Section>
    </>
  ),
});
