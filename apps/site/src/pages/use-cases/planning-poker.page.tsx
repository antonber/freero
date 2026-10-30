import { ButtonLink, Checks, Hero, Section, Shot, Step, Steps } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';
import { OtherUseCases, useCase, UseCaseTemplates } from '../../lib/useCases';

const u = useCase('planning-poker');

export default definePage({
  path: '/use-cases/planning-poker',
  name: u.name,
  title: 'Planning poker online, free, on your whiteboard | Freero',
  ogTitle: 'Planning poker on the board where the work is',
  description:
    'Free online planning poker on a whiteboard: Fibonacci, T-shirt or custom decks, picks sealed until the reveal, and the agreed estimate written on the card.',
  updated: '2026-10-30',
  sitemap: 'use-cases',
  faq: [
    {
      q: 'Is the planning poker free?',
      a: 'Yes. It is part of every Freero board, with nothing to install or buy. Freero is free and open source.',
    },
    {
      q: 'Can others see my pick before the reveal?',
      a: 'No. Your pick is kept private on the server, which sends it to nobody else until the facilitator reveals that item.',
    },
    {
      q: 'Do estimates reach Jira?',
      a: 'The agreed value is written into the card’s estimate. When the card is linked to a Jira issue, a numeric estimate syncs to the issue’s story points field (on Linear, its estimate).',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Use case · Planning poker"
        title="Planning poker online, right on the board"
        lead="Estimate the cards your team already planned on the whiteboard, one by one. Everyone picks in private, the facilitator reveals, you talk about the spread, and the agreed value lands on the card. No separate poker app, no copying stories over."
        actions={
          <>
            <ButtonLink href={useTemplateHref('relative-sizing')}>Start an estimation board</ButtonLink>
            <ButtonLink href="#how" variant="secondary">
              How a round works
            </ButtonLink>
          </>
        }
      />

      <Section id="how" title="How a round works" tone="tint">
        <div className="columns-2">
          <Steps>
            <Step title="Pick what to estimate">Select cards or sticky notes, or none to estimate every card on the board, and choose Estimate with planning poker… from the board menu or the right-click menu.</Step>
            <Step title="Choose a deck">Fibonacci (0, 1, 2, 3, 5, 8, 13, 21, ?), T-shirt sizes (XS to XXL, ?), or your own values.</Step>
            <Step title="Everyone picks in private">The board zooms to the item being estimated. Picks stay sealed on the server until the reveal.</Step>
            <Step title="Reveal and agree">The reveal shows every pick and the spread, and points out who picked far from the rest, worth hearing first. The facilitator saves the agreed value on the card and moves to the next item.</Step>
          </Steps>
          <Shot name="poker" alt="Planning poker on a Freero board: a story card being estimated, with the revealed picks of three teammates." caption="A revealed round: everyone’s pick and the suggested value." />
        </div>
      </Section>

      <Section id="tracker" title="From estimate to story points">
        <Checks
          kind="yes"
          items={[
            'Import the stories from Jira, Linear or GitHub as cards with Import issues…, estimate them, and the numbers sync back: story points on Jira, the estimate on Linear.',
            'Cards keep their estimate after the round, so a sprint-planning board shows what fits.',
            'Any editor can end a round whose facilitator left, from the board menu.',
          ]}
        />
        <p>
          More on keeping a board and Jira in step: <a href="/use-cases/jira">Jira planning on a whiteboard</a>.
        </p>
      </Section>

      <Section id="templates" title="Templates for estimation and planning" tone="tint">
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
