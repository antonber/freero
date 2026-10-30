import { ButtonLink, Hero, Prompts, Section, Shot, Step, Steps, Table } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP, docsUrl } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('jira');

export default definePage({
  path: '/use-cases/jira',
  name: u.name,
  title: 'Jira whiteboard: sticky notes to Jira issues, both ways',
  ogTitle: 'Sticky notes to Jira, and back',
  description:
    'Plan on a free whiteboard and send sticky notes to Jira Cloud or Data Center as issues, kept in sync both ways. Linear and GitHub too.',
  updated: '2026-10-30',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'Does it work with Jira Data Center or Server?',
      a: 'Yes. Freero connects to Jira Data Center and Server with a personal access token, and to Jira Cloud with an API token or OAuth. Changes come back by webhook, or by polling where a Data Center version has no webhook secret.',
    },
    {
      q: 'What happens when the board and Jira disagree?',
      a: 'Each field is merged against what both sides last agreed on, so a change on one side flows to the other. If the same field changed on both sides within one sync, Jira’s value wins and the board’s value is kept in a comment on the item.',
    },
    {
      q: 'Who can connect Jira?',
      a: 'A team’s owners and admins connect it in the admin console for the whole team, and anyone can add their own connection in Settings for the boards they can edit.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · Jira planning"
        title="A Jira whiteboard: from sticky notes to issues, and back"
        lead="Plan the way people think, on a board, and keep the result where the work is tracked. A cluster of notes becomes one Jira issue, every note links back to it, and the board shows each issue’s key, status and assignee as they change. Jira Cloud and Jira Data Center alike, plus Linear and GitHub."
        actions={
          <>
            <ButtonLink href={useTemplateHref('sprint-planning')}>Start a sprint planning board</ButtonLink>
            <ButtonLink href="#how" variant="secondary">
              How the sync works
            </ButtonLink>
          </>
        }
      />

      <Section id="how" title="How it works" tone="tint">
        <div className="columns-2">
          <Steps>
            <Step title="Connect your tracker">Jira Cloud, Jira Data Center or Server, Linear, GitHub or GitHub Enterprise Server. Freero tests every connection before keeping it.</Step>
            <Step title="Send notes as issues">Select sticky notes, a cluster or cards and choose Send to tracker…: one issue listing every note with a link back, or one issue per item.</Step>
            <Step title="See the issue on the board">Each linked note or card shows the issue’s key, status and assignee, updated when the issue changes in the tracker.</Step>
            <Step title="Bring issues in">Import issues… turns a JQL query (or a Linear or GitHub search) into linked cards; importing again adds only the new ones.</Step>
          </Steps>
          <Shot name="tracker" alt="Sticky notes on a Freero board showing the linked Jira issue’s key and status." caption="Notes sent to Jira as one issue, each showing its key and status." />
        </div>
      </Section>

      <Section id="fields" title="What travels with the issue">
        <Table
          caption="How board items map to tracker issues"
          head={['On the board', 'In the tracker']}
          rows={[
            ['A card’s title, a note’s first line, a cluster’s heading', 'Title'],
            ['A card’s description, a note’s text, a list of the notes with links back', 'Description'],
            ['Tags', 'Labels'],
            ['Card status or kanban column', 'Status, through the Jira workflow’s transitions'],
            ['Card assignee', 'Assignee, matched by verified email (not on GitHub)'],
            ['Start and due dates', 'Start date (Jira) and due date (not on GitHub)'],
            ['A numeric estimate', 'Story points on Jira, the estimate on Linear'],
          ]}
          stack
        />
        <p>
          The full mapping, conflicts and security: <a href={docsUrl('docs/trackers.md')}>issue trackers in Freero</a>. Connecting:{' '}
          <a href="/integrations/jira-cloud">Jira Cloud</a> · <a href="/integrations/jira-data-center">Jira Data Center</a>.
        </p>
      </Section>

      <Section id="agent" title="Ask an agent to file it" lead="Claude, ChatGPT or your own agent uses the same sync people do, labelled with its name and yours." tone="tint" narrow>
        <Prompts
          items={[
            { prompt: 'Send the “Checkout bugs” cluster to Jira as one issue in project WEB.', outcome: 'One issue listing every note with a link back; the notes then show its key and status.', needs: 'permission to change boards' },
            { prompt: 'Import the open issues of the current sprint as cards into the Doing column.', outcome: 'Linked cards placed in that kanban column, each in the column of its status if that differs.', needs: 'permission to change boards (without it, the cards are proposed)' },
          ]}
        />
        <p>
          The tools are <code>sync_to_tracker</code>, <code>import_from_tracker</code> and <code>list_tracker_connections</code>; see <a href="/agents">building with agents</a>.
        </p>
      </Section>

      <Section id="templates" title="Templates for planning with Jira">
        <UseCaseTemplates slug={u.slug} />
      </Section>

      <Section id="more" title="More ways teams use Freero" tone="tint" narrow>
        <OtherUseCases slug={u.slug} />
        <p>
          <ButtonLink href={APP.signup}>Start free</ButtonLink>
        </p>
      </Section>
    </>
  ),
});
