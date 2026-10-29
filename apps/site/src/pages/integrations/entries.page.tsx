// /integrations/<id> — one page per catalog entry (@freero/shared integrations.ts): what it does,
// how to connect it (with the app's deep link to that step), and its siblings. A new catalog entry
// gets its page, sitemap entry and index card without touching this file.
import { INTEGRATION_STATUS_LABEL, INTEGRATIONS, integrationDocsUrl, type Integration } from '@freero/shared';
import { ButtonLink, Card, Cards, Hero, Section, Step, Steps } from '../../components/ui';
import { definePage, type PageDef } from '../../lib/define';
import { appEntryPath, categoryAnchor, categoryOf, connectHowTo, entriesIn, integrationPath, SITE_GUIDE } from '../../lib/integrations';

const page = (i: Integration): PageDef => {
  const category = categoryOf(i.category);
  const siblings = entriesIn(i.category).filter((x) => x.id !== i.id);
  const guide = SITE_GUIDE[i.id];
  return definePage({
    path: integrationPath(i.id),
    name: i.name,
    title: i.seo.title,
    ogTitle: i.name,
    description: i.seo.description,
    updated: '2026-10-29',
    sitemap: 'integrations',
    jsonLd: [connectHowTo(i)],
    body: () => (
      <>
        <Hero
          kicker={category.label}
          title={i.name}
          lead={i.oneLiner}
          actions={
            <>
              <ButtonLink href={appEntryPath(i)}>Connect in Freero</ButtonLink>
              {i.connect.docs ? (
                <ButtonLink href={integrationDocsUrl(i.connect.docs)} variant="secondary">
                  {i.connect.docs.label}
                </ButtonLink>
              ) : null}
            </>
          }
        >
          <p className="works-with">
            {INTEGRATION_STATUS_LABEL[i.status]}
            {guide ? (
              <>
                {' · '}
                <a href={guide.href}>{guide.label}</a>
              </>
            ) : null}
          </p>
        </Hero>
        <Section id="about" title="What it does" narrow>
          {i.description.map((p, n) => (
            <p key={n}>{p}</p>
          ))}
        </Section>
        <Section id="connect" title={`Connect ${i.name}`} tone="tint" narrow>
          <Steps>
            {i.connect.steps.map((s, n) => (
              <Step key={n} title={`Step ${n + 1}`}>
                <p>{s}</p>
              </Step>
            ))}
          </Steps>
          {i.operatorSetup ? <p className="note">{i.operatorSetup}</p> : null}
          <p>
            In Freero, <a href={appEntryPath(i)}>Apps &amp; agents → {i.name}</a> takes you straight to this step.
          </p>
        </Section>
        {siblings.length ? (
          <Section id="more" title={`More ${category.label.toLowerCase()}`}>
            <Cards cols={3}>
              {siblings.map((s) => (
                <Card key={s.id} title={s.name} href={integrationPath(s.id)}>
                  <p>{s.oneLiner}</p>
                </Card>
              ))}
            </Cards>
            <p>
              <a href={`/integrations#${categoryAnchor(i.category)}`}>All integrations</a>
            </p>
          </Section>
        ) : (
          <Section id="more" title="More integrations" narrow>
            <p>
              <a href={`/integrations#${categoryAnchor(i.category)}`}>See every integration</a>, from AI agents to issue trackers and single sign-on.
            </p>
          </Section>
        )}
      </>
    ),
  });
};

export default INTEGRATIONS.map(page);
