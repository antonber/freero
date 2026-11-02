// /use-cases/brainstorming — "online brainstorming tool" / "online sticky notes": stickies
// (features/sticky), private mode, voting, timer, clustering (features/arrange), tags, reactions,
// and the built-in AI actions only as "once your server or team admin connects a model" (docs/ai.md:
// off by default). Checked against the code.
import { ButtonLink, Hero, Prompts, Section, Shot, Step, Steps } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP, docsUrl } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('brainstorming');

export default definePage({
  path: '/use-cases/brainstorming',
  name: u.name,
  title: 'Online brainstorming tool with sticky notes, free | Freero',
  ogTitle: 'From a wall of notes to a decision',
  description:
    'Brainstorm online on a free whiteboard: sticky notes, private writing under a timer, clustering by colour or tag, dot voting and an AI agent for themes.',
  updated: '2026-11-02',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'Can people brainstorm without seeing each other’s ideas first?',
      a: 'Yes. Start private mode for the board or one frame: while it is on, what each person writes is visible only to them, and the server sends it to nobody else. The facilitator reveals everything at once, with names or anonymously.',
    },
    {
      q: 'How does dot voting work?',
      a: 'Start voting, give each person 1 to 20 votes and choose whether all notes or only the selected ones can be voted on. With results hidden, ballots stay sealed on the server until voting ends; then the notes are ranked by votes.',
    },
    {
      q: 'Is there a limit on sticky notes?',
      a: 'No limit on notes. Freero is free with no paid plan; the default fair-use limits are 5,000 boards and 1 GB of uploads per account.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · Brainstorming"
        title="An online brainstorming tool that gets you from ideas to a decision"
        lead="Put a question on the board, let everyone write their own ideas before they hear anyone else’s, then cluster, vote and pick what to try. Freero has the sticky notes, the timer, private writing and voting on one free whiteboard."
        actions={
          <>
            <ButtonLink href={useTemplateHref('brainstorm')}>Start a brainstorm</ButtonLink>
            <ButtonLink href="#templates" variant="secondary">
              Brainstorming templates
            </ButtonLink>
          </>
        }
        aside={<Shot name="workshop" eager alt="Sticky notes from a brainstorm in a frame on a Freero board, with two teammates’ cursors." sizes="(min-width: 960px) 520px, 100vw" />}
      />

      <Section id="how" title="A brainstorm in four steps" tone="tint">
        <Steps>
          <Step title="Diverge, privately">
            Start private mode and a shared timer, and everyone writes on their own. Press N for a sticky note and Tab for the next one beside it, in any of twelve colours.
          </Step>
          <Step title="Reveal">
            End private mode and every note appears at once, with names or anonymous, so the first idea said aloud doesn’t steer the rest.
          </Step>
          <Step title="Cluster">
            Select the notes and Cluster by colour or Cluster by tag to make labelled groups in one step, then move the rest by hand. Select all with this colour or tag
            to gather a theme.
          </Step>
          <Step title="Converge">
            Run dot voting with hidden results, then read the ranked list. Turn the winners into task cards with an owner, or send them to Jira, Linear or GitHub.
          </Step>
        </Steps>
      </Section>

      <Section id="room" title="Keep the room on track" lead="Facilitator controls keep a session moving without a second app.">
        <div className="columns-2">
          <ul className="checks checks--yes">
            <li>
              <strong>One timer for everyone</strong>, from one minute to a custom length, with a chime at zero.
            </li>
            <li>
              <strong>Follow the facilitator</strong>, or bring everyone to your view.
            </li>
            <li>
              <strong>Limit what people add</strong> while they write, so the board stays sticky notes, enforced by the server.
            </li>
          </ul>
          <ul className="checks checks--yes">
            <li>
              <strong>Reactions</strong> on any note: approved, star, +1, question, love it or not this.
            </li>
            <li>
              <strong>Polls, word clouds and Q&A</strong> answered from a laptop or a phone.
            </li>
            <li>
              <strong>Guests</strong> can follow along and comment from a shared link without an account.
            </li>
          </ul>
        </div>
        <p>
          Running a longer session? See <a href="/use-cases/workshops">workshops on Freero</a> and <a href="/use-cases/retrospectives">guided retrospectives</a>.
        </p>
      </Section>

      <Section id="agent" tone="tint" title="An AI teammate for the sorting" lead="Connected over MCP, Claude, ChatGPT or another assistant reads the notes and proposes themes. Nothing changes until someone accepts.">
        <div className="columns-2">
          <Prompts
            items={[
              { prompt: 'Group the ideas on this board into themes and name each one.', outcome: 'It proposes clusters, shown as ghosts on the board for the group to accept or reject.' },
              { prompt: 'Add ten more ideas we haven’t thought of, in a different colour.', outcome: 'It proposes new sticky notes next to yours, labelled with its name and yours.' },
            ]}
          />
          <Shot name="proposal" alt="An agent’s proposal on a Freero board: notes grouped into themes, shown as ghosts waiting to be accepted." caption="Themes an agent proposed, waiting for the group." />
        </div>
        <p>
          Freero also has built-in AI actions (generate ideas, cluster by theme, summarise) once the server’s operator or your team admin connects a model provider;
          see the <a href={docsUrl('docs/ai.md')}>AI guide</a>. Mind-mapping instead? Try the <a href="/features/mind-map">mind map maker</a>.
        </p>
      </Section>

      <Section id="templates" title="Brainstorming templates">
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
