import { ButtonLink, Hero, Prompts, Section, Shot, Step, Steps } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP, docsUrl } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('retrospectives');

export default definePage({
  path: '/use-cases/retrospectives',
  name: u.name,
  title: 'Online retrospective board: free guided retros | Freero',
  ogTitle: 'Retros that end with owned actions',
  description:
    'Run sprint retros on a free online whiteboard: private writing under a timer, anonymous reveal, voting, action items, and an AI agent that groups notes.',
  updated: '2026-10-30',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'Can people write retro notes anonymously?',
      a: 'Yes. During the writing step every note is private: the server sends it to nobody else until the facilitator reveals all notes at once, and the facilitator can switch on Anonymous so notes are revealed without names.',
    },
    {
      q: 'Do participants need an account?',
      a: 'People you invite sign in with their Freero account. With a share link, guests can join a board without an account, if the board’s workspace allows public links.',
    },
    {
      q: 'Can the action items go to Jira?',
      a: 'Yes. Select the action cards and send them to Jira, Linear or GitHub as one issue or one per card. Each card then shows its issue’s key, status and assignee, kept in sync both ways.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · Retrospectives"
        title="An online retrospective board that runs the retro for you"
        lead="Freero’s guided retro takes the team through every step on one board: write alone under a timer, reveal, group, vote, discuss and leave with action items that have an owner. An AI agent can group the notes into themes while you talk."
        actions={
          <>
            <ButtonLink href={useTemplateHref('retrospective')}>Start a retro board</ButtonLink>
            <ButtonLink href="#templates" variant="secondary">
              Retro templates
            </ButtonLink>
          </>
        }
      />

      <Section id="how" title="How a guided retro runs" lead="The facilitator picks Run a retrospective… in the board menu, chooses a format, the writing time and the votes per person, and Freero moves everyone through the steps." tone="tint">
        <div className="columns-2">
          <Steps>
            <Step title="Write">Everyone adds notes on their own under a shared timer. Nobody sees anyone else’s notes yet, not even in the data the server sends.</Step>
            <Step title="Reveal and group">The facilitator reveals all notes at once, with or without names, and similar notes are grouped, by hand or by colour in one click.</Step>
            <Step title="Vote">Each person spends a set number of votes on what to talk about. Votes stay hidden until the results are shown as a ranked list.</Step>
            <Step title="Discuss and act">Talk through the top topics, then turn what you agreed into action-item cards, each with an owner.</Step>
          </Steps>
          <Shot name="workshop" alt="A Freero retro board: sticky notes about a product launch, with two teammates’ cursors on it." caption="The board during a retro, with teammates working live." />
        </div>
        <p>
          Facilitator controls can limit participants to sticky notes while they write, and the retro ends them with itself. Formats offered: Start, stop,
          continue · Went well, to improve, actions · Liked, learned, lacked, longed for · or whatever is already on the board.
        </p>
      </Section>

      <Section id="agent" title="Let an agent do the sorting" lead="Connected over MCP, Claude, ChatGPT or another assistant reads the retro board and proposes the themes and actions. Nothing changes until someone accepts.">
        <div className="columns-2">
          <Prompts
            items={[
              { prompt: 'Group the retro notes into themes.', outcome: 'It proposes clusters with a title each, shown as ghosts on the board for you to accept or reject.' },
              { prompt: 'Turn the top themes into action items and send them to Jira.', outcome: 'It proposes action cards, then sends the accepted ones to your tracker through the same sync people use.', needs: 'permission to change boards, for the tracker step' },
            ]}
          />
          <Shot name="proposal" alt="An agent’s proposal on a retro board: themes shown as ghosts, labelled with the agent’s and the person’s names." caption="An agent’s proposal: notes grouped into themes, waiting for a person to accept." />
        </div>
        <p>
          Freero’s MCP server includes a <code>run_retro</code> prompt that sets an assistant up to do exactly this. Set it up for <a href="/claude">Claude</a>,{' '}
          <a href="/chatgpt">ChatGPT</a> or <a href="/agents">any MCP client</a>; how it works is in the <a href={docsUrl('docs/mcp.md')}>MCP guide</a>.
        </p>
      </Section>

      <Section id="templates" title="Retrospective templates" tone="tint">
        <UseCaseTemplates slug={u.slug} />
      </Section>

      <Section id="more" title="More ways teams use Freero" narrow>
        <OtherUseCases slug={u.slug} />
        <p>
          <ButtonLink href={APP.signup}>Start free</ButtonLink>
        </p>
      </Section>
    </>
  ),
});
