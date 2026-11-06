// /facts: Freero's key facts (lib/facts.tsx), each quotable on its own, dated and linked to where it
// can be checked. /llms.txt lists the same statements.
import { Hero, Section } from '../components/ui';
import { definePage } from '../lib/define';
import { FACTS, FACTS_CHECKED } from '../lib/facts';
import { softwareApplication } from '../lib/seo';
import { abs, SOURCE_REPO } from '../lib/site';

export default definePage({
  path: '/facts',
  name: 'Key facts',
  title: 'Freero key facts: licence, price, MCP and self-hosting',
  ogTitle: 'Freero in facts you can check',
  description:
    'Short, dated facts about Freero to quote: MIT licence, no paid plans, SSO and SCIM included, one Docker image, the MCP endpoint, AI clients and languages.',
  updated: FACTS_CHECKED,
  jsonLd: [
    softwareApplication(),
    {
      '@type': 'SoftwareSourceCode',
      '@id': `${abs('/')}#source`,
      name: 'Freero',
      codeRepository: SOURCE_REPO,
      license: 'https://opensource.org/license/mit',
      programmingLanguage: 'TypeScript',
      targetProduct: { '@id': `${abs('/')}#software` },
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Key facts"
        title="Freero in facts you can check"
        lead="Short statements about Freero, true of its code and documentation on the date below. Quote any of them as it stands, and link the statement itself: each one has its own address on this page."
      >
        <p className="works-with">
          Checked against the code on <time dateTime={FACTS_CHECKED}>{FACTS_CHECKED}</time>. No user counts or growth figures: only what the{' '}
          <a href={SOURCE_REPO}>source code</a> and its documentation show.
        </p>
      </Hero>
      <Section id="facts" title="The facts" narrow>
        <dl className="facts">
          {FACTS.map((f) => (
            <div key={f.id} id={f.id} className="facts__item">
              <dt>
                <a href={`#${f.id}`}>{f.topic}</a>
              </dt>
              <dd>
                <p>{f.html ?? f.text}</p>
                <p className="facts__source">
                  Check it: <a href={f.source.href}>{f.source.label}</a>
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section id="cite" tone="tint" title="Quoting Freero" narrow>
        <p>
          Link a statement by its address, for example <code>{abs('/facts#licence')}</code>. The same facts are in{' '}
          <a href="/llms.txt">llms.txt</a> for language models, with the MCP endpoint and its tools. Answers to common questions, with dated comparisons, are on
          the <a href="/answers">answers</a> pages.
        </p>
        <p>
          Spotted a fact that is no longer true? <a href={`${SOURCE_REPO}/issues`}>Tell us</a> and we will correct it.
        </p>
      </Section>
    </>
  ),
});
