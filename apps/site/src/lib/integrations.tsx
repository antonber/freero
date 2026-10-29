// The site's view of Freero's integrations catalog (@freero/shared integrations.ts, the same list
// the app's Apps & agents page shows): /integrations and one page per entry, generated from it.
import { INTEGRATION_CATEGORIES, INTEGRATION_STATUS_LABEL, INTEGRATIONS, type Integration, type IntegrationCategory } from '@freero/shared';
import { Card, Cards } from '../components/ui';
import { abs, APP } from './site';

export const integrationPath = (id: string) => `/integrations/${id}`;
export const categoryAnchor = (c: IntegrationCategory) => `category-${c}`;
export const categoryOf = (c: IntegrationCategory) => INTEGRATION_CATEGORIES.find((x) => x.id === c)!;
export const entriesIn = (c: IntegrationCategory) => INTEGRATIONS.filter((i) => i.category === c);

/** Where an entry's connect step is in the app (signed-out visitors sign in first, then land there). */
export const appEntryPath = (i: Integration) => `${APP.apps}/${i.id}`;

/** The site's own longer guide for an entry, where one exists. */
export const SITE_GUIDE: Partial<Record<string, { href: string; label: string }>> = {
  claude: { href: '/claude', label: 'Freero for Claude' },
  chatgpt: { href: '/chatgpt', label: 'Freero for ChatGPT' },
  'claude-code': { href: '/agents', label: 'Build with agents' },
  'mcp-client': { href: '/agents', label: 'Build with agents' },
  'rest-api': { href: '/agents#api', label: 'The REST API for builders' },
  webhooks: { href: '/agents#webhooks', label: 'Webhooks for builders' },
};

export function IntegrationCards({ entries }: { entries: readonly Integration[] }) {
  return (
    <Cards cols={3}>
      {entries.map((i) => (
        <Card key={i.id} title={i.name} href={integrationPath(i.id)}>
          <p>{i.oneLiner}</p>
          <p className="status-tag">{INTEGRATION_STATUS_LABEL[i.status]}</p>
        </Card>
      ))}
    </Cards>
  );
}

/** schema.org ItemList of the catalog (the index page). */
export function integrationsItemList(): Record<string, unknown> {
  return {
    '@type': 'ItemList',
    '@id': `${abs('/integrations')}#list`,
    name: 'Freero integrations',
    numberOfItems: INTEGRATIONS.length,
    itemListElement: INTEGRATIONS.map((i, n) => ({ '@type': 'ListItem', position: n + 1, name: i.name, url: abs(integrationPath(i.id)) })),
  };
}

/** schema.org HowTo for an entry's connect step. */
export function connectHowTo(i: Integration): Record<string, unknown> {
  const url = abs(integrationPath(i.id));
  return {
    '@type': 'HowTo',
    '@id': `${url}#connect`,
    name: `Connect ${i.name} to Freero`,
    description: i.oneLiner,
    step: i.connect.steps.map((text, n) => ({ '@type': 'HowToStep', position: n + 1, text, url: `${url}#connect` })),
  };
}
