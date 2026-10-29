// The comparisons index: every published /vs/<slug> page, found from the build (no list to edit),
// plus how the comparisons are made and the gaps Freero has against every one of them.
import { Checks, Hero, Section } from '../../components/ui';
import { ComparisonCards } from '../../lib/compare';
import { definePage } from '../../lib/define';
import { docsUrl, SOURCE_REPO } from '../../lib/site';

export default definePage({
  path: '/vs',
  name: 'Comparisons',
  title: 'Whiteboard comparisons: Freero vs Miro, Mural and more',
  ogTitle: 'How Freero compares',
  description:
    'Freero compared with Miro, Microsoft Whiteboard, Mural, FigJam, Excalidraw, Confluence whiteboards and Jamboard: sourced, dated, and fair to both sides.',
  updated: '2026-10-28',
  sitemap: 'compare',
  body: ({ pages }) => (
    <>
      <Hero
        kicker="Comparisons"
        title="How Freero compares with other whiteboards"
        lead="Each page puts Freero next to one other whiteboard, capability by capability. Every fact about the other product links to a public source with the date we checked it, and every page says plainly where the other product is the better choice."
      />
      <Section id="comparisons" title="Pick a comparison">
        <ComparisonCards pages={pages} />
      </Section>
      <Section id="method" tone="tint" title="How we compare" narrow>
        <Checks
          kind="yes"
          items={[
            'Facts about other products come only from public sources, mostly the vendor’s own pages, release notes and documentation, each cited with the date it was checked. What we couldn’t confirm is left out.',
            'Facts about Freero come from its documentation and code, and each table cell links to the file that documents it.',
            'Prices are quoted as the vendor shows them, in US dollars, with the billing period where the vendor states one. Check the vendor’s own page before you decide.',
            'Product names are used only to say which product we mean. No logos, screenshots or brand colours of other companies appear on these pages.',
          ]}
        />
        <p>
          Spotted a mistake or an outdated fact? <a href={`${SOURCE_REPO}/issues`}>Tell us</a> and we will correct it.
        </p>
      </Section>
      <Section id="gaps" title="What Freero doesn’t do yet" lead="These gaps hold against every product compared here, so they are listed once." narrow>
        <Checks
          kind="no"
          items={[
            'No native desktop or mobile apps: Freero installs from the browser as a web app, and phones get a view-and-comment layout.',
            'No built-in AI until someone connects a model, and no AI chat assistant, AI workflows or image generation.',
            'No security certifications such as SOC 2 or ISO 27001, no customer-managed keys, DLP or eDiscovery, and no choice of hosted data region: organizations that need one host Freero themselves.',
            'No built-in audio or video: a board links to your meeting or a Jitsi room.',
            'Imports cover CSV, draw.io and Excalidraw files, plus images and PDFs placed on a board; there is no importer for Miro, Mural, FigJam, Microsoft Whiteboard, Confluence or Jamboard boards.',
            'A library of 180 original templates, no plugin SDK (integrations connect from outside, through the API, webhooks and MCP), and an English-only interface.',
          ]}
        />
        <p>
          The full, current list is in Freero’s <a href={docsUrl('docs/parity.md')}>feature parity notes</a>. If you need any of these today, the
          comparisons say which product has it.
        </p>
      </Section>
    </>
  ),
});
