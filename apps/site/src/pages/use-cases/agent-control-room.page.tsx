import { ButtonLink, Checks, Hero, Section, Shot, Step, Steps } from '../../components/ui';
import { definePage } from '../../lib/define';
import { docsUrl } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('agent-control-room');

export default definePage({
  path: '/use-cases/agent-control-room',
  name: u.name,
  title: 'AI agent control room: watch and steer agents on a board',
  ogTitle: 'Watch and steer your agents on a board',
  description:
    'A whiteboard where AI agents post their plan, status and tasks while they work, and people steer them by moving cards, commenting or pausing them.',
  updated: '2026-10-30',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'Which agents can post to a control room?',
      a: 'Any agent that connects to Freero’s MCP server (Claude Code, Cursor, an agent you built) or calls the REST API with a token that may change boards. Several agents can share one board, each in its own lane.',
    },
    {
      q: 'How do I stop an agent?',
      a: 'Select its lane’s Tasks kanban and press Pause agent. Until someone resumes it, every write that agent makes on the board is refused, and it can still read what people changed. You can also disconnect the app in Settings at any time.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · Agent control room"
        title="A control room for your AI agents, on a whiteboard"
        lead="Coding agents, research agents and automations work for hours. Give each one a lane on a board where it posts its plan, its status and its tasks as it goes, and where people steer it with the moves they already know: drag a card, write a comment, press pause."
        actions={
          <>
            <ButtonLink href={useTemplateHref('agent-control-room')}>Start a control room</ButtonLink>
            <ButtonLink href="/agents#control-room" variant="secondary">
              For builders
            </ButtonLink>
          </>
        }
      />

      <Section id="how" title="How it works" tone="tint">
        <div className="columns-2">
          <Steps>
            <Step title="Each agent gets a lane">A Plan note, a Status note and a Tasks kanban with To do, Doing, Done and Blocked. Start from the Agent control room template, or let the agent create the board on its first post.</Step>
            <Step title="The agent posts as it works">
              After each step it calls <code>post_status</code> with its plan, a one-line status and its tasks. A retry never duplicates a card.
            </Step>
            <Step title="Blocked means it needs you">A task moved to Blocked carries the agent’s question, and the person it works for gets a notification.</Step>
            <Step title="People steer, the agent listens">
              Drag a card back to To do to have it redone, out of Blocked to say go ahead, add a card or comment. Before its next step, <code>get_feedback</code> returns exactly what people changed.
            </Step>
          </Steps>
          <Shot name="control-room" alt="An agent’s lane on a Freero board: its plan, its status and a Tasks kanban with To do, Doing, Done and Blocked." caption="An agent’s lane, posted through the API while it works." />
        </div>
      </Section>

      <Section id="safety" title="People stay in charge">
        <Checks
          kind="yes"
          items={[
            'Pause agent on its lane: its writes on the board are refused until someone resumes it, and only a person can lift the pause.',
            'Everything an agent adds is labelled with its name and the name of the person it works for, and shows in the activity feed.',
            'What people write reaches the agent marked as untrusted board content, so a note can’t give it instructions.',
            'On team boards, workspace webhooks can push people’s changes to the agent instead of it asking.',
          ]}
        />
        <p>
          The <code>control_room</code> MCP prompt sets an agent up to work this way. Reference: <a href={docsUrl('docs/mcp.md')}>MCP server guide</a>.
        </p>
      </Section>

      <Section id="templates" title="Templates for working with agents" tone="tint">
        <UseCaseTemplates slug={u.slug} />
      </Section>

      <Section id="more" title="More ways teams use Freero" narrow>
        <OtherUseCases slug={u.slug} />
      </Section>
    </>
  ),
});
