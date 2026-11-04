// /gallery — the community template gallery (#162): templates people who use Freero submitted and
// this server's operators approved. The list is this server's data, so the build leaves a slot the
// server fills when it serves the page (server modules/gallery: search, categories, cards, and one
// page per template from the `gallery-template` shell, build.tsx). With nothing approved yet the
// slot says so.
import { ButtonLink, Hero } from '../components/ui';
import { definePage } from '../lib/define';
import { APP } from '../lib/site';

export default definePage({
  path: '/gallery',
  name: 'Community templates',
  title: 'Community whiteboard templates, shared by Freero users',
  description: 'Free whiteboard templates made and shared by people who use Freero, each reviewed before it is published and free to reuse under CC BY or CC0.',
  updated: '2026-11-03',
  sitemap: 'templates',
  faq: [
    {
      q: 'Who makes the community templates?',
      a: 'People who use Freero. Anyone can submit one of their boards from its menu; Freero’s reviewers look at every submission before it is published, and anyone can report a published one.',
    },
    {
      q: 'What does a submitted template include?',
      a: 'Only what everyone on the board could see: its notes, shapes, frames, tables and cards. Comments, hidden frames, private drafts, links to other boards, attached files and the names of the people who worked on it are left out.',
    },
    {
      q: 'Can I use a community template for anything?',
      a: 'Yes. Each one is shared under CC BY 4.0 (credit its author) or CC0 (no conditions), shown on its page. A copy you make is your own board.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Community"
        title="Community templates"
        lead="Boards people who use Freero shared for anyone to start from. Every template is reviewed before it appears here, and carries its author and licence."
        actions={
          <>
            <ButtonLink href={APP.signup}>Start free</ButtonLink>
            <ButtonLink href="/templates" variant="secondary">
              Freero’s own templates
            </ButtonLink>
          </>
        }
      />
      <div data-freero-slot="gallery" />
    </>
  ),
});
