import { ButtonLink, Hero } from '../components/ui';
import { definePage } from '../lib/define';

export default definePage({
  path: '/404',
  name: 'Page not found',
  title: 'Page not found: Freero',
  description: 'This page doesn’t exist or has moved. Head back to Freero’s overview, or connect your AI agent to a board.',
  updated: '2026-10-28',
  index: false,
  closingCta: false,
  body: () => (
    <Hero
      title="This page isn’t on the board."
      lead="It doesn’t exist, or it has moved. These are good places to pick up from:"
      actions={
        <>
          <ButtonLink href="/">Freero overview</ButtonLink>
          <ButtonLink href="/claude" variant="secondary">
            Freero for Claude
          </ButtonLink>
          <ButtonLink href="/chatgpt" variant="secondary">
            Freero for ChatGPT
          </ButtonLink>
        </>
      }
    />
  ),
});
