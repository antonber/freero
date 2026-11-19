// "Best AI whiteboards" (docs/marketing/seo.md: "AI whiteboard 2026", listicle farms). A roundup
// (lib/lists.tsx) about where each product puts AI: built in, your own model, or agents over MCP.
// The narrower "which whiteboards work over MCP" question is /answers/mcp-whiteboard.
import { defineList } from '../../lib/lists';
import { comparison as confluence } from '../vs/confluence-whiteboards.page';
import { comparison as excalidraw } from '../vs/excalidraw.page';
import { comparison as figjam } from '../vs/figjam.page';
import { comparison as microsoftWhiteboard } from '../vs/microsoft-whiteboard.page';
import { comparison as miro } from '../vs/miro.page';
import { comparison as mural } from '../vs/mural.page';
import { comparison as tldraw } from '../vs/tldraw.page';

export default defineList({
  slug: 'best-ai-whiteboards',
  name: 'Best AI whiteboards',
  question: 'The best AI whiteboards in 2026',
  title: 'Best AI whiteboards in 2026: built-in AI and agents | Freero',
  description:
    'Eight AI whiteboards and where each puts the AI: built in, your own model, or agents such as Claude over MCP, and whether people review what agents change.',
  updated: '2026-11-19',
  answer:
    'It depends on where you want the AI. Miro and FigJam build the most into the board, Microsoft Whiteboard and Confluence whiteboards bring Copilot and Rovo from their suites, and Excalidraw turns text into diagrams on its free tier. Freero, which we make, is built for the agents you already use: Claude, ChatGPT or your own model propose changes, and people accept them.',
  criteria: [
    'A whiteboard with AI a team can use today: built into the board, through a model you bring, or through AI agents connected over MCP.',
    'Each product’s facts come from its own public pages, checked and dated, and every fact in the table cites its source.',
    'Each pick says who it suits and when to choose it over Freero.',
    'Nobody paid to be listed, and there are no affiliate links. After Freero, the picks run from the most AI built in to the least.',
  ],
  freero: {
    bestFor: 'teams that want AI agents on the board, with people approving their changes',
    chooseIf: [
      'You want Claude, ChatGPT, Cursor or another MCP client to read your boards and add to them, with no daily quota on calls.',
      'You want people to stay in charge: a new connection can only read and suggest, and nothing changes until someone accepts.',
      'You want to choose the model: Anthropic or any OpenAI-compatible endpoint, local models included, with no AI credits to buy.',
      'You want to see what agents did: everything they add is labelled with the app and the person it acts for, and every call is in the audit log.',
    ],
    lookElsewhereIf: [
      'You want AI that works with nothing to set up: Freero’s built-in assistant stays off until a workspace admin or the server’s operator connects a model.',
      'You want AI that makes images or prototypes from a prompt: Freero’s AI doesn’t.',
      'You want the AI inside a suite you already pay for, such as Microsoft 365 Copilot or Atlassian Rovo.',
    ],
  },
  picks: [
    { product: miro, bestFor: 'the most AI built into the board', chooseIf: ['AI that goes further', 'hosted service with nothing to run'] },
    { product: figjam, bestFor: 'AI next to Figma designs', chooseIf: ['AI that does more without setup', 'designs in Figma'] },
    { product: microsoftWhiteboard, bestFor: 'Copilot on boards inside Microsoft 365', chooseIf: ['Microsoft 365 Copilot', 'already pays for Microsoft 365'] },
    { product: confluence, bestFor: 'Rovo across Jira and Confluence', chooseIf: ['Rovo', 'lives in Confluence'] },
    { product: mural, bestFor: 'AI guidance for workshop methods', chooseIf: ['methods library', 'built on Microsoft'] },
    { product: excalidraw, bestFor: 'AI diagrams on a free tier', chooseIf: ['AI on the free tier', 'hand-drawn look'] },
    { product: tldraw, bestFor: 'developers building AI canvas apps', chooseIf: ['building a canvas', 'open a page and sketch'] },
  ],
  matrix: {
    title: 'AI on the board, compared',
    lead: 'Built-in AI, your own model, AI agents over MCP, and whether people review what agents change before it lands.',
    caption: 'Built-in AI, own models, MCP access and review of agent edits, by product',
    columns: ['Built-in AI', 'Bring your own AI model', 'MCP server for AI agents', 'Agent edits reviewed by people'],
    rows: [
      { product: miro, cells: ['Built-in AI', 'Bring your own AI model', 'MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: figjam, cells: ['Built-in AI', 'Bring your own AI model', 'MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: microsoftWhiteboard, cells: ['Built-in AI', 'Bring your own AI model', 'AI agents on boards (MCP)', null] },
      { product: confluence, cells: ['Built-in AI', 'Bring your own AI model', 'MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: mural, cells: ['Built-in AI', 'Bring your own AI model', 'MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: excalidraw, cells: ['Built-in AI', 'Bring your own AI key', 'MCP server for AI agents', 'Agent edits reviewed by people'] },
      { product: tldraw, cells: [null, 'Bring your own AI model', 'MCP access for AI agents', 'Agent edits reviewed by people'] },
    ],
    freero: [
      { verdict: 'partial', note: 'off until you connect a model; then a board assistant and saved AI workflows', ref: 'docs/ai.md' },
      { verdict: 'yes', note: 'Anthropic or any OpenAI-compatible endpoint, local models included', ref: 'docs/ai.md' },
      { verdict: 'yes', note: 'built into every server, self-hosted ones too; no daily quota', ref: 'docs/mcp.md' },
      { verdict: 'yes', note: 'agents start with read and suggest; direct writes are opt-in', ref: 'docs/mcp.md' },
    ],
  },
  related: [
    ['/answers/mcp-whiteboard', 'Which whiteboards work with Claude and ChatGPT over MCP?'],
    ['/claude', 'Freero for Claude'],
    ['/chatgpt', 'Freero for ChatGPT'],
    ['/agents', 'Build with agents: every MCP tool, the REST API and webhooks'],
    ['/use-cases/agent-control-room', 'An agent control room: let people steer long-running agents'],
  ],
  faq: [
    {
      q: 'What is the best AI whiteboard?',
      a: 'For the most AI built into the board with nothing to set up, Miro or FigJam, both metered in AI credits. For Copilot or Rovo, the whiteboards of Microsoft 365 or Confluence. For AI agents such as Claude and ChatGPT working on boards while people approve their changes, Freero, which we make.',
    },
    {
      q: 'Can I use my own AI model or API key on a whiteboard?',
      a: 'In Freero, yes: connect Anthropic or any OpenAI-compatible endpoint, local models included. Excalidraw allows its own key on Excalidraw+, and the tldraw SDK’s starter kits take your own keys. Miro, FigJam, Mural, Confluence and Microsoft Whiteboard name no option for your own model on their public pages, as of the dates in the table.',
    },
    {
      q: 'Is AI on Freero free?',
      a: 'Freero charges nothing for AI or MCP calls and sells no AI credits. Its built-in assistant runs on the model a workspace admin or the server’s operator connects, and that model’s provider bills them for what it uses; AI agents you connect over MCP run on your plan with their own vendor.',
    },
    {
      q: 'Can an AI agent change my whiteboard without asking?',
      a: 'On most whiteboards with an MCP server, an agent’s writes land on the board directly. In Freero, a new connection can only read and suggest: its changes wait as suggestions until an owner or editor accepts them. Changing boards directly is a separate permission you have to grant.',
    },
  ],
});
