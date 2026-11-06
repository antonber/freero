// "Which whiteboards work with Claude and ChatGPT over MCP?" (seo.md: MCP whiteboard, whiteboard for
// Claude, Claude whiteboard MCP: the most winnable cluster). Competitor cells come from the
// published /vs pages' rows; the connect steps are the integrations catalog's (@freero/shared).
import { integrationById } from '@freero/shared';
import { Code } from '../../components/ui';
import { defineAnswer } from '../../lib/answers';
import { AI_CLIENTS, list } from '../../lib/facts';
import { integrationPath } from '../../lib/integrations';
import { MCP_TOOLS } from '../../lib/mcp';
import { APP, MCP_URL } from '../../lib/site';
import { comparison as confluence } from '../vs/confluence-whiteboards.page';
import { comparison as excalidraw } from '../vs/excalidraw.page';
import { comparison as figjam } from '../vs/figjam.page';
import { comparison as microsoftWhiteboard } from '../vs/microsoft-whiteboard.page';
import { comparison as miro } from '../vs/miro.page';
import { comparison as mural } from '../vs/mural.page';
import { comparison as tldraw } from '../vs/tldraw.page';

const steps = (id: string) => {
  const i = integrationById(id);
  if (!i) throw new Error(`no integration ${id}`);
  return i.connect.steps.join(' ');
};

export default defineAnswer({
  slug: 'mcp-whiteboard',
  name: 'Whiteboards with MCP',
  question: 'Which whiteboards work with Claude and ChatGPT over MCP?',
  title: 'MCP whiteboard for Claude and ChatGPT, compared | Freero',
  description:
    'Freero is a free, open-source whiteboard with a built-in MCP server: Claude, ChatGPT and other AI clients read boards and propose changes people accept.',
  updated: '2026-11-06',
  answer:
    'Freero is one: a free, open-source (MIT) whiteboard with an MCP server built in, so Claude, ChatGPT, Cursor, VS Code and other MCP clients can find, read and add to your boards. What sets it apart is that agents propose and people accept: a new connection can only read and suggest, and nothing changes on the board until someone accepts.',
  facts: [
    <>
      The MCP server is at <code>{MCP_URL}</code> (Streamable HTTP). Clients sign in with OAuth 2.1, or send a personal access token.
    </>,
    `Guided setup for ${list(AI_CLIENTS)}; any other MCP client that speaks Streamable HTTP works too.`,
    'A new connection gets read and suggest permissions only. Changing boards directly and commenting are separate permissions the person ticks on the consent screen, and their own role on the board always caps them.',
    'Everything an agent adds is labelled with the app and the person it acts for, such as “Claude for Maria”, and every call is in the audit log.',
    `${MCP_TOOLS.length} tools: search and read boards and docs, add notes, clusters, kanban cards and diagrams (Freero lays them out; the model never picks coordinates), propose changes, sync with Jira, Linear or GitHub, and post to an agent control room.`,
    'In hosts that show MCP Apps views, Claude and ChatGPT among them, the live board opens inside the conversation.',
    'No MCP fees and no daily quota: a default rate limit of 300 requests a minute per connection, which a server’s operator can change. Self-hosted servers include the same MCP server.',
  ],
  matrix: {
    title: 'MCP access and human review, compared',
    lead: 'Which whiteboards let an AI assistant work on boards over MCP, and whether people review what it changes before it lands.',
    caption: 'MCP access for AI agents and review of their edits, by product',
    columns: ['MCP access for AI agents', 'Agent edits reviewed by people'],
    rows: [
      { product: miro, cells: ['MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: mural, cells: ['MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: figjam, cells: ['MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: confluence, cells: ['MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: excalidraw, cells: ['MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: tldraw, cells: ['MCP access for AI agents', 'Agent edits reviewed by people'] },
      { product: microsoftWhiteboard, cells: ['AI agents on boards (MCP)', null] },
    ],
    freero: [
      { verdict: 'yes', note: 'built into every server, self-hosted ones too; OAuth 2.1 or tokens; no daily quota', ref: 'docs/mcp.md' },
      { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    ],
  },
  steps: {
    title: 'How to connect Claude or ChatGPT to Freero',
    lead: 'You need a Freero account. Freero’s Connect page shows these steps with your server’s address filled in.',
    items: [
      {
        title: 'Copy the MCP URL',
        body: <Code label="MCP server URL">{MCP_URL}</Code>,
      },
      { title: 'In Claude', body: steps('claude') },
      { title: 'In ChatGPT', body: steps('chatgpt') },
      {
        title: 'In Claude Code, Cursor or another client',
        body: (
          <>
            Add a remote (HTTP) MCP server with that URL; the client signs in with OAuth the first time. Claude Code:
            <Code label="Terminal">{`claude mcp add --transport http freero ${MCP_URL}`}</Code>
            Every client’s step is on the <a href={APP.connect}>Connect page</a> in Freero.
          </>
        ),
      },
    ],
  },
  related: [
    ['/claude', 'Freero for Claude'],
    ['/chatgpt', 'Freero for ChatGPT'],
    ['/agents', 'Build with agents: every MCP tool, the REST API and webhooks'],
    [integrationPath('mcp-client'), 'Any MCP client'],
    ['/use-cases/agent-control-room', 'An agent control room: let people steer long-running agents'],
    ['/llms.txt', 'llms.txt: Freero described for language models'],
  ],
  faq: [
    {
      q: 'Does Freero work with Claude?',
      a: 'Yes. Add Freero to Claude as a custom connector with the MCP URL, sign in on Freero’s consent screen and choose what Claude may do. It works in Claude on the web, Claude Desktop and Claude Code. Anthropic decides which Claude plans include custom connectors.',
    },
    {
      q: 'Does Freero work with ChatGPT?',
      a: 'Yes. Add Freero to ChatGPT as a custom MCP server with OAuth sign-in, then mention it in a chat with @. OpenAI decides which plans can add custom MCP servers, and in a workspace an admin may have to allow them first.',
    },
    {
      q: 'Can an AI agent change my whiteboard without my approval?',
      a: 'Not by default. A new connection can read boards and propose changes, which appear as suggestions that owners and editors accept or reject; the board doesn’t change until they do. Changing boards directly is a separate permission you have to tick, and deleting needs an explicit confirmation on top.',
    },
    {
      q: 'Does Freero charge for MCP or AI calls?',
      a: 'No. Freero has no paid plans, no AI credits and no daily MCP quota; a server applies per-minute rate limits instead. The AI assistant you connect runs on your plan with its own vendor.',
    },
    {
      q: 'Does the MCP server work with a self-hosted Freero?',
      a: 'Yes. Every Freero server includes it at /mcp. Claude and ChatGPT connect from their vendors’ servers, so a self-hosted Freero must be reachable over public https with PUBLIC_URL set to that address.',
    },
  ],
});
