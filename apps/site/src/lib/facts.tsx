// Key facts about Freero: short, dated statements a person or an AI assistant can quote as they
// stand, each with the place to check it. /facts shows them and /llms.txt lists them, from this one
// list. Every statement is true of the code on main on FACTS_CHECKED; the ones that would drift on
// their own (counts, client and tracker names, languages) are read from the catalogs they describe.
// No user counts, no growth numbers: nothing here that the repository can't show.
import { INTEGRATIONS, LOCALES, type IntegrationCategory } from '@freero/shared';
import type { ReactNode } from 'react';
import { L } from './legal';
import { MCP_PROMPTS, MCP_TOOLS } from './mcp';
import { abs, docsUrl, MCP_URL, SOURCE_REPO } from './site';
import { SITE_TEMPLATES } from './templates';

/** When every fact below was last checked against the code. */
export const FACTS_CHECKED = '2026-11-06';

export interface Fact {
  /** Anchor on /facts (#licence), so a quote can link the exact statement. */
  id: string;
  topic: string;
  /** The statement, plain text: shown on /facts and listed in /llms.txt. */
  text: string;
  /** Shown on the page instead of `text` where a deployment's own fact goes in (the operator). */
  html?: ReactNode;
  /** false: not in /llms.txt (the statement needs a value the server fills into HTML only). */
  llms?: boolean;
  /** Where to check it. */
  source: { label: string; href: string };
}

/** English names of the interface languages (`LOCALES`); a language added there without one here fails the build. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  'pt-BR': 'Portuguese (Brazil)',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-CN': 'Simplified Chinese',
  ar: 'Arabic',
  he: 'Hebrew',
};
const languages = LOCALES.map((l) => {
  const name = LANGUAGE_NAMES[l];
  if (!name) throw new Error(`lib/facts.tsx: no English name for the interface language ${l}`);
  return name;
});

/** "a, b and c". */
export const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const names = (c: IntegrationCategory, except: string[] = []) => INTEGRATIONS.filter((i) => i.category === c && !except.includes(i.id)).map((i) => i.name);

/** The AI clients with their own connect step (the agents catalog, without its "any MCP client" entry). */
export const AI_CLIENTS = names('agents', ['mcp-client']);
/** The issue trackers Freero syncs with (the trackers catalog, without the Confluence and Jira app, which shows boards inside them). */
export const TRACKERS = names('trackers', ['confluence-jira-app']);

export const FACTS: Fact[] = [
  {
    id: 'what',
    topic: 'What it is',
    text: 'Freero is a free, open-source, real-time collaborative whiteboard for teams of people and AI agents: sticky notes, diagrams, mind maps, kanban boards, tables and docs.',
    source: { label: 'README', href: docsUrl('README.md') },
  },
  {
    id: 'agents-propose',
    topic: 'How agents work',
    text: 'AI agents connect over MCP and, by default, can only read boards and propose changes; people accept or reject each proposal, and nothing changes until they do. Changing boards directly and commenting are separate permissions a person ticks on the consent screen.',
    source: { label: 'MCP guide: permissions', href: docsUrl('docs/mcp.md') },
  },
  {
    id: 'attribution',
    topic: 'Who did what',
    text: 'Everything an agent adds is labelled with the app and the person it acts for (for example "Claude for Maria"), shown in the board’s activity and recorded in the audit log.',
    source: { label: 'MCP guide: safety', href: docsUrl('docs/mcp.md') },
  },
  {
    id: 'licence',
    topic: 'Licence',
    text: 'The whole codebase is under the MIT licence, including the MCP server, SSO, SCIM and tracker sync. There is no enterprise edition and no licence key.',
    source: { label: 'LICENSE', href: docsUrl('LICENSE') },
  },
  {
    id: 'price',
    topic: 'Price',
    text: 'Freero has no paid plans and no seats. Every feature is included, also SAML and OpenID Connect single sign-on, SCIM provisioning, the audit log and the admin console. Self-hosting costs only your own servers.',
    source: { label: 'Pricing', href: '/pricing' },
  },
  {
    id: 'limits',
    topic: 'Limits',
    text: 'Instead of plan limits, a Freero server has default fair-use limits that its operator can change: for example 5,000 boards per account, 1 GB of uploads per account and 300 API or MCP requests per minute per token or connected app.',
    source: { label: 'Pricing: default limits', href: '/pricing#limits' },
  },
  {
    id: 'self-host',
    topic: 'Self-hosting',
    text: 'Freero ships as one Docker image that serves the app, real-time collaboration, the REST API, the MCP server and the marketing pages. It needs PostgreSQL 15 or newer; Redis and S3-compatible storage let it run as more than one instance.',
    source: { label: 'Deployment guide', href: docsUrl('docs/deployment.md') },
  },
  {
    id: 'mcp-endpoint',
    topic: 'MCP endpoint',
    text: `The MCP server is at ${MCP_URL} (MCP Streamable HTTP). Clients sign in with OAuth 2.1 (PKCE and dynamic client registration) or send a personal access token.`,
    source: { label: 'MCP guide: how sign-in works', href: docsUrl('docs/mcp.md') },
  },
  {
    id: 'mcp-tools',
    topic: 'MCP tools',
    text: `The MCP server offers ${MCP_TOOLS.length} tools and ${MCP_PROMPTS.length} prompts: find and read boards and docs, add notes, clusters, cards and diagrams that Freero lays out itself, propose changes, sync with issue trackers and run an agent control room.`,
    source: { label: 'Build with agents', href: '/agents' },
  },
  {
    id: 'ai-clients',
    topic: 'AI clients',
    text: `Clients with a guided setup: ${list(AI_CLIENTS)}. Any other MCP client that speaks Streamable HTTP works too.`,
    source: { label: 'Integrations: AI agents', href: '/integrations#category-agents' },
  },
  {
    id: 'live-board',
    topic: 'Live board in chat',
    text: 'In hosts that show MCP Apps views, such as Claude and ChatGPT, the open_board tool shows the live board inside the conversation.',
    source: { label: 'MCP guide: live boards', href: docsUrl('docs/mcp.md') },
  },
  {
    id: 'mcp-registry',
    topic: 'MCP Registry',
    text: 'The hosted server is listed in the official MCP Registry as io.github.antonber/freero.',
    source: { label: 'server.json', href: docsUrl('server.json') },
  },
  {
    id: 'trackers',
    topic: 'Issue trackers',
    text: `Board items become issues and stay in sync both ways with ${list(TRACKERS)}.`,
    source: { label: 'Issue tracker guide', href: docsUrl('docs/trackers.md') },
  },
  {
    id: 'integrations',
    topic: 'Integrations',
    text: `${INTEGRATIONS.length} integrations in all, among them ${list(names('chat').filter((n) => !/ (app|link previews|notifications)/.test(n)))} for chat, and ${list(names('automation').filter((n) => ['n8n', 'Make', 'Zapier', 'Power Automate'].includes(n)))} for automation, besides the REST API and signed webhooks.`,
    source: { label: 'Integrations', href: '/integrations' },
  },
  {
    id: 'ai-models',
    topic: 'Built-in AI',
    text: 'Freero has no model of its own. Its built-in AI is off until the server’s operator or a workspace admin connects a provider: Anthropic, OpenAI or any OpenAI-compatible endpoint, including one you run yourself.',
    source: { label: 'AI guide', href: docsUrl('docs/ai.md') },
  },
  {
    id: 'languages',
    topic: 'Languages',
    text: `The interface is available in ${languages.length} languages: ${list(languages)}. The translations are machine-made and not yet reviewed by people.`,
    source: { label: 'Interface languages', href: docsUrl('docs/design/i18n.md') },
  },
  {
    id: 'templates',
    topic: 'Templates',
    text: `${SITE_TEMPLATES.length} built-in templates, each with its own page: retrospectives, planning, workshops, diagrams, strategy and more.`,
    source: { label: 'Templates', href: '/templates' },
  },
  {
    id: 'guests',
    topic: 'Guests',
    text: 'People with a share link can join a board as guests without an account, to view and comment, if the board’s workspace allows public links.',
    source: { label: 'Architecture: guests', href: docsUrl('ARCHITECTURE.md') },
  },
  {
    id: 'hosting',
    topic: 'Hosted service',
    text: 'The hosted Freero service stores data with its hosting provider in the United States, in one region; a self-hosted server keeps it wherever you run it. Neither the hosted service nor the software holds a SOC 2 or ISO 27001 certification yet.',
    source: { label: 'Security overview', href: '/security' },
  },
  {
    id: 'operator',
    topic: 'Operator',
    text: `The hosted service at ${abs('/')} is operated by the company named in its terms of service.`,
    html: (
      <>
        The hosted service at {abs('/')} is operated by {L('operator')}.
      </>
    ),
    llms: false,
    source: { label: 'Terms of service', href: '/terms' },
  },
  {
    id: 'source',
    topic: 'Source code',
    text: `The source code, issues and documentation are public at ${SOURCE_REPO}.`,
    source: { label: 'GitHub', href: SOURCE_REPO },
  },
];
