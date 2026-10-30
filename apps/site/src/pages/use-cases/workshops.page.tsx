import { ButtonLink, Card, Cards, Hero, Section } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('workshops');

export default definePage({
  path: '/use-cases/workshops',
  name: u.name,
  title: 'Online workshop whiteboard with dot voting, free | Freero',
  ogTitle: 'Run the whole workshop on one board',
  description:
    'Run online workshops on a free whiteboard: private writing, dot voting, a shared timer, polls, follow the facilitator, and guests who join by link.',
  updated: '2026-10-30',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'How does dot voting work in Freero?',
      a: 'The facilitator starts voting from the board menu and sets the votes per person. Everyone spends them on sticky notes, cards or shapes; results can stay hidden until the facilitator shows them as a ranked list.',
    },
    {
      q: 'Can I keep participants from moving things around?',
      a: 'Yes. Facilitator controls can lock the board so participants only comment, or limit what they may add, for example sticky notes only. The server enforces it, and the controls end when the facilitator leaves.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · Workshops"
        title="An online workshop whiteboard with the facilitation built in"
        lead="Brainstorms, design sprints, lean coffee or a strategy offsite: run them on one board with the tools that keep a session fair and moving, and nothing extra to buy or install."
        actions={
          <>
            <ButtonLink href={useTemplateHref('workshop-agenda')}>Start with a workshop agenda</ButtonLink>
            <ButtonLink href="#templates" variant="secondary">
              Workshop templates
            </ButtonLink>
          </>
        }
      />

      <Section id="tools" title="Facilitation tools on every board" tone="tint">
        <Cards cols={3}>
          <Card title="Private mode" tint="violet" mark="◐">
            Everyone writes alone until you reveal all notes at once, optionally without names. The server keeps drafts from other participants, not just the screen.
          </Card>
          <Card title="Dot voting" tint="yellow" mark="●">
            A set number of votes per person on notes, cards and shapes, hidden until you show the ranked results.
          </Card>
          <Card title="Shared timer" tint="mint" mark="⏲">
            One countdown for everyone, in the board’s top bar.
          </Card>
          <Card title="Facilitator controls" tint="pink" mark="◎">
            Lock the board to comments, limit what people may add, bring everyone to your view and hide other cursors.
          </Card>
          <Card title="Polls and Q&A" tint="blue" mark="?">
            Polls, word clouds, rankings, rating scales and Q&A, answered from the board or a phone, with results drawn on the board.
          </Card>
          <Card title="Planning poker" tint="orange" mark="5">
            Estimate cards with sealed picks and a reveal. <a href="/use-cases/planning-poker">How it works</a>.
          </Card>
        </Cards>
      </Section>

      <Section id="agent" title="An agent as your co-facilitator" lead="Connect Claude, ChatGPT or another MCP client and ask it to do the parts that eat workshop time." narrow>
        <ul className="checks checks--yes">
          <li>“Group these notes into themes” after a brainstorm: it proposes clusters with titles, and nothing changes until someone accepts.</li>
          <li>“Turn the shortlisted ideas into task cards”: it proposes cards in a kanban or frame you name.</li>
          <li>“Summarise what the board says”: it reads the board’s outline, the same structured read the API gives, and answers in the chat.</li>
        </ul>
        <p>
          Set it up for <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>.
        </p>
      </Section>

      <Section id="templates" title="Workshop templates" tone="tint">
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
