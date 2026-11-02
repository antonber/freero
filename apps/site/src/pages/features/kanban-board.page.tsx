// /features/kanban-board — "free online kanban board": what the kanban element and task cards do
// (features/kanban, features/card, features/csv, features/trackers), checked against the code.
// Not claimed: swimlane rows inside a kanban, checklists, more than one assignee per card.
import { ButtonLink, Checks, Hero, Prompts, Section, Shot, Step, Steps } from '../../components/ui';
import { definePage } from '../../lib/define';
import { feature, FeatureTemplates, OtherFeatures } from '../../lib/features';
import { softwareApplication } from '../../lib/seo';
import { APP } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';

const f = feature('kanban-board');

export default definePage({
  path: '/features/kanban-board',
  name: f.name,
  title: 'Free online kanban board with WIP limits | Freero',
  ogTitle: 'A kanban board on your whiteboard',
  description:
    'A free online kanban board on a collaborative whiteboard: columns that set status, WIP limits, due dates, assignees, and two-way sync with Jira or Linear.',
  updated: '2026-11-02',
  sitemap: 'features',
  jsonLd: [softwareApplication()],
  faq: [
    {
      q: 'Is the kanban board free?',
      a: 'Yes. Freero has no paid plan, so the kanban board, task cards, WIP limits, CSV import and the Jira, Linear and GitHub sync are free for any number of people.',
    },
    {
      q: 'Can I set WIP limits on kanban columns?',
      a: 'Yes. Each column can have a work-in-progress limit of 1 to 10 items. The column header shows the count against the limit and turns to a warning when the column holds more; it warns rather than blocking the move.',
    },
    {
      q: 'Does the kanban board sync with Jira?',
      a: 'Yes. Import issues from a Jira, Linear or GitHub search as cards, or send cards to the tracker as new issues. Linked cards show the issue key, status and assignee, and changes flow both ways: moving a card to another column changes the issue’s status, and an issue changed in the tracker updates its card.',
    },
    {
      q: 'Can I import tasks from a spreadsheet?',
      a: 'Yes. Import a CSV file of up to 1,999 rows as task cards laid out as a kanban by status, mapping your columns to title, description, tags, status, assignee, due date and colour. Cards can be exported to CSV again.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Feature · Kanban board"
        title="A free online kanban board, right on your whiteboard"
        lead="Plan the work where you discussed it. Freero’s kanban board sits on the same canvas as your sticky notes and diagrams: drag a card to a column and its status changes, set WIP limits, and keep every card in step with Jira, Linear or GitHub."
        actions={
          <>
            <ButtonLink href={useTemplateHref('sprint-board')}>Start a kanban board</ButtonLink>
            <ButtonLink href="#templates" variant="secondary">
              Kanban templates
            </ButtonLink>
          </>
        }
        aside={<Shot name="kanban" eager alt="A Freero kanban board with To do, In progress and Done columns of task cards, each showing its status and due date." sizes="(min-width: 960px) 520px, 100vw" />}
      />

      <Section id="how" title="How the board works" tone="tint">
        <Steps>
          <Step title="Place a board">
            Pick Kanban board from the + menu of tools and click: a board with To do, In progress and Done columns lands on the canvas. Add, rename, reorder and delete
            columns from each column’s menu, and choose the column width.
          </Step>
          <Step title="Add task cards">
            A card has a title, a description, a status, start and due dates, an assignee from the board’s members, tags, an accent colour and an estimate. Right-click a
            sticky note and Convert to card to turn an idea into a task.
          </Step>
          <Step title="Move the work">
            Drag a card into a column and it stacks there. A column can set the status of the cards dropped into it, and a card whose status you change moves to the
            matching column.
          </Step>
          <Step title="Keep work in progress honest">
            Give a column a WIP limit from 1 to 10. Its header shows how many cards it holds against the limit and flags the column when it goes over.
          </Step>
        </Steps>
      </Section>

      <Section id="trackers" title="Synced with Jira, Linear and GitHub" lead="Your team’s tracker stays the source of truth; the board is where you plan.">
        <div className="columns-2">
          <Checks
            kind="yes"
            items={[
              <>
                <strong>Import issues as cards</strong> from a JQL query or a Linear or GitHub search, each linked to its issue.
              </>,
              <>
                <strong>Send cards to the tracker</strong> as one issue each, with the fields the tracker has: title, description, labels, status, assignee and dates.
              </>,
              <>
                <strong>Both directions:</strong> a card moved to another column changes its issue’s status, and an issue changed in the tracker updates its card.
              </>,
            ]}
          />
          <Checks
            kind="yes"
            items={[
              <>
                <strong>Jira Cloud and Jira Data Center</strong>, Linear, GitHub and GitHub Enterprise Server.
              </>,
              <>
                <strong>CSV in and out:</strong> up to 1,999 rows as a kanban by status, and every card back out as CSV.
              </>,
              <>
                <strong>Estimate on the board:</strong> <a href="/use-cases/planning-poker">planning poker</a> writes the agreed value onto the card.
              </>,
            ]}
          />
        </div>
        <p>
          More in <a href="/use-cases/jira">Jira planning on a whiteboard</a> and <a href="/use-cases/roadmaps">roadmaps from Jira and Linear</a>.
        </p>
      </Section>

      <Section id="agents" tone="tint" title="Let an agent update the board" lead="Connected over MCP, an assistant reads the board and proposes cards; people accept what they want.">
        <Prompts
          items={[
            { prompt: 'Turn the action items from this retro into cards in the To do column.', outcome: 'It proposes one task card per action, placed in the column, for someone on the board to accept.' },
            {
              prompt: 'Post your progress on the migration to our board.',
              outcome: 'A coding agent keeps its own lane of cards moving from To do to Done, so the team sees what it is doing.',
              needs: 'permission to change boards',
            },
          ]}
        />
        <p>
          Set it up for <a href="/claude">Claude</a>, <a href="/chatgpt">ChatGPT</a> or <a href="/agents">any MCP client</a>, or see an{' '}
          <a href="/use-cases/agent-control-room">agent control room</a>.
        </p>
      </Section>

      <Section id="templates" title="Kanban templates">
        <FeatureTemplates slug={f.slug} />
        <p>
          <a href="/templates/category/agile">All agile templates</a>
        </p>
      </Section>

      <Section id="more" tone="tint" title="More of the whiteboard" narrow>
        <OtherFeatures slug={f.slug} />
        <p>
          <ButtonLink href={APP.signup}>Start free</ButtonLink>
        </p>
      </Section>
    </>
  ),
});
