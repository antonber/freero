// /answers: every answer page (lib/answers.tsx), found from the build's pages: no list to keep.
import { Hero, Section } from '../../components/ui';
import { AnswerCards } from '../../lib/answers';
import { definePage } from '../../lib/define';

export default definePage({
  path: '/answers',
  name: 'Answers',
  title: 'Answers: common whiteboard questions, answered | Freero',
  ogTitle: 'Straight answers about Freero',
  description:
    'Short, sourced answers to what people ask about Freero: free SSO, AI assistants over MCP, board limits. Each with the facts, a dated comparison and steps.',
  updated: '2026-11-06',
  sitemap: 'answers',
  body: ({ pages }) => (
    <>
      <Hero
        kicker="Answers"
        title="Straight answers to common whiteboard questions"
        lead="Each page answers one question in its first sentences, then gives the facts, a comparison dated with its sources, and the steps. Freero is a free, open-source whiteboard where AI agents propose changes and people accept them."
      />
      <Section id="questions" title="Questions" tone="tint">
        <AnswerCards pages={pages} />
      </Section>
      <Section id="more" title="More to check" narrow>
        <ul>
          <li>
            <a href="/facts">Key facts</a>: short, dated statements about Freero, each with where to check it.
          </li>
          <li>
            <a href="/vs">Comparisons</a>: Freero next to Miro, Mural, FigJam and others, sourced and dated.
          </li>
          <li>
            Is there a free online retrospective board? Yes: <a href="/use-cases/retrospectives">guided retros in Freero</a>, with private writing, an
            anonymous reveal, voting and action items.
          </li>
          <li>
            Is there free planning poker? Yes: <a href="/use-cases/planning-poker">planning poker on every Freero board</a>, with sealed picks and the estimate
            written on the card.
          </li>
          <li>
            <a href="/use-cases">Use cases</a>: workshops, story maps, roadmaps, Jira planning and more.
          </li>
          <li>
            <a href="/open-source">Open source</a>: run Freero on your own servers.
          </li>
        </ul>
      </Section>
    </>
  ),
});
