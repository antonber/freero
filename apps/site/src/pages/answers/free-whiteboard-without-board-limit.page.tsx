// "Is there a free whiteboard without a board limit?" (seo.md / miro.md keywords: Miro alternative no
// board limit, free whiteboard unlimited boards). Competitor cells come from the published /vs
// pages' rows; Freero's numbers are the server's defaults (platform/config.ts, /pricing).
import { defineAnswer } from '../../lib/answers';
import { APP } from '../../lib/site';
import { SITE_TEMPLATES } from '../../lib/templates';
import { comparison as confluence } from '../vs/confluence-whiteboards.page';
import { comparison as excalidraw } from '../vs/excalidraw.page';
import { comparison as figjam } from '../vs/figjam.page';
import { comparison as miro } from '../vs/miro.page';
import { comparison as mural } from '../vs/mural.page';

export default defineAnswer({
  slug: 'free-whiteboard-without-board-limit',
  name: 'Free whiteboard without a board limit',
  question: 'Is there a free whiteboard without a board limit?',
  title: 'Free whiteboard without a 3-board limit | Freero',
  description:
    'Yes: Freero has no paid plan, so there is no 3-board free tier: every feature, any number of editors, and up to 5,000 boards per account by default.',
  updated: '2026-11-06',
  answer:
    'Yes. Freero is a free, open-source (MIT) online whiteboard with no paid plan, so there is no free tier capped at three editable boards: each account can own up to 5,000 boards by default, with as many editors, commenters and viewers as you like. AI assistants such as Claude and ChatGPT can work on those boards too, proposing changes that people accept.',
  facts: [
    'Up to 5,000 boards per account by default, across all your workspaces. It is a fair-use limit, not a plan: whoever runs the server can raise it.',
    'No seats: invite as many editors, commenters and viewers as you like, and let guests join a shared link without an account to view and comment.',
    'Every feature is included: kanban, mind maps, diagrams, retros, planning poker, tracker sync, SSO, SCIM and the MCP server for AI agents.',
    '1 GB of uploads per account and 300 API or MCP requests a minute per connection by default; reaching a limit refuses only the action that would pass it, and nothing you have is touched.',
    `Start from any of ${SITE_TEMPLATES.length} templates, and export boards as images, PDF, SVG, CSV, Markdown or JSON.`,
    'Host it yourself and you set every limit: Freero is MIT licensed and runs from one Docker image.',
  ],
  matrix: {
    title: 'Free plans and what they cost after, compared',
    lead: 'What each whiteboard’s free plan allows, and what its paid plans are.',
    caption: 'Free plan limits and paid plans by product',
    columns: ['Free plan', 'Paid plans'],
    rows: [
      { product: miro, cells: ['Free plan', 'Paid plans'] },
      { product: mural, cells: ['Free plan', 'Paid plans'] },
      { product: figjam, cells: ['Free plan', 'Paid seats'] },
      { product: confluence, cells: ['Free plan', 'Price'] },
      { product: excalidraw, cells: ['Free to use', 'Paid plan'] },
    ],
    freero: [
      { verdict: 'yes', note: 'every feature; up to 5,000 boards per account by default', ref: 'docs/configuration.md' },
      { verdict: 'no', note: 'no paid plans or licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
    ],
  },
  steps: {
    title: 'How to start',
    items: [
      {
        title: 'Sign up',
        body: (
          <>
            <a href={APP.signup}>Create a free account</a>. There is no trial and no card to enter.
          </>
        ),
      },
      {
        title: 'Make boards',
        body: (
          <>
            Start blank or from a <a href="/templates">template</a>, in your personal space or a team workspace.
          </>
        ),
      },
      { title: 'Bring your team', body: 'Invite people by email with a role, or share a link that guests can open without an account.' },
      {
        title: 'Connect an assistant, if you like',
        body: (
          <>
            Add Freero to <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a> and ask it to sort notes, draw a diagram or plan a sprint on the board.
          </>
        ),
      },
    ],
  },
  related: [
    ['/pricing', 'Pricing and every default limit'],
    ['/features/online-whiteboard', 'The free online whiteboard'],
    ['/vs/miro', 'Freero vs Miro'],
    ['/vs/mural', 'Freero vs Mural'],
    ['/vs/figjam', 'Freero vs FigJam'],
    ['/open-source', 'Host Freero yourself and set your own limits'],
  ],
  faq: [
    {
      q: 'How many boards can I make in Freero for free?',
      a: 'Up to 5,000 boards per account by default, across all your workspaces, with every feature. That is a fair-use limit of the server, not a plan: there is nothing to upgrade to, and the operator of a server can raise it.',
    },
    {
      q: 'Is there a limit on editors or viewers?',
      a: 'No. Freero has no seats: invite as many editors, commenters and viewers as you like, and let visitors join a shared link as guests without an account, if the board’s workspace allows public links.',
    },
    {
      q: 'What happens if I reach a limit?',
      a: 'The action that would go over it is refused with a clear message, and nothing you already have is touched. Rate limits reset within the minute or hour they apply to.',
    },
    {
      q: 'Why is Freero free?',
      a: 'Freero is an open-source project under the MIT licence with no paid tier behind the free one. Running a server costs something: if you host Freero yourself, you pay for your own infrastructure, and the default limits keep a shared server fair.',
    },
  ],
});
