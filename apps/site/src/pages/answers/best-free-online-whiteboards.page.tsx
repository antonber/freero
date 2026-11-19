// "Best free online whiteboards" (docs/marketing/seo.md: a head term where listicles rank). A
// roundup (lib/lists.tsx) about what "free" means on each: no account, a capped free plan, or every
// feature. The narrower board-limit question is /answers/free-whiteboard-without-board-limit.
import { defineList } from '../../lib/lists';
import { comparison as confluence } from '../vs/confluence-whiteboards.page';
import { comparison as excalidraw } from '../vs/excalidraw.page';
import { comparison as figjam } from '../vs/figjam.page';
import { comparison as miro } from '../vs/miro.page';
import { comparison as mural } from '../vs/mural.page';
import { comparison as tldraw } from '../vs/tldraw.page';

export default defineList({
  slug: 'best-free-online-whiteboards',
  name: 'Best free online whiteboards',
  question: 'The best free online whiteboards in 2026',
  title: 'Best free online whiteboards in 2026, compared | Freero',
  description:
    'Seven free online whiteboards and what free means on each: no account, a free plan with a board cap, or every feature. Sourced, dated, with who each suits.',
  updated: '2026-11-19',
  answer:
    'Free means different things. Excalidraw and tldraw are free to open and draw in, with no account. Miro, FigJam, Mural and Confluence whiteboards have free plans that keep about three boards editable. Freero, which we make, is free with every feature: no seats, no paid plans, and a fair-use default of 5,000 boards per account.',
  criteria: [
    'A whiteboard you can use today without paying, in the browser.',
    'Each product’s facts come from its own public pages, checked and dated, and every fact in the table cites its source.',
    'Each pick says who it suits and when to choose it over Freero.',
    'Nobody paid to be listed, and there are no affiliate links. After Freero, the picks run from the ones that need no account to the free plans of paid products.',
  ],
  freero: {
    bestFor: 'teams that want every feature free, with no plan to outgrow',
    chooseIf: [
      'You want no seats and no three-board limit: the default is 5,000 boards per account, a fair-use limit rather than a plan.',
      'You want SSO, the audit log and two-way Jira, Linear and GitHub sync without paying for them.',
      'You run workshops: voting, a timer, polls, planning poker and private mode are in the free product.',
      'You want it to stay free: it is MIT licensed, so you can run it on your own servers.',
    ],
    lookElsewhereIf: [
      'You want people to draw without an account: on a shared Freero link, guests view and comment, and editing needs an account.',
      'You need native desktop or mobile apps today: Freero runs in the browser and installs as a web app.',
      'You want the smallest possible toolset: Freero does much more, which can be more to learn.',
    ],
  },
  picks: [
    { product: excalidraw, bestFor: 'quick sketches with no account', chooseIf: ['open a page and draw', 'offline without an account', 'AI on the free tier'] },
    { product: tldraw, bestFor: 'a fast canvas, in the browser or offline', chooseIf: ['open a page and sketch', 'desktop app', 'drawing feel'] },
    { product: confluence, bestFor: 'small teams on Atlassian', chooseIf: ['small team', 'lives in Confluence'] },
    { product: miro, bestFor: 'trying the biggest ecosystem before you pay', chooseIf: ['hosted service with nothing to run', 'big ecosystem'] },
    { product: figjam, bestFor: 'teams that design in Figma', chooseIf: ['designs in Figma', 'big ecosystem'] },
    { product: mural, bestFor: 'workshops that follow a method', chooseIf: ['methods library', 'visitors who can edit'] },
  ],
  matrix: {
    title: 'What each one gives you for free',
    lead: 'The free tier, what paying adds, who can join without an account, and the licence.',
    caption: 'Free tiers, paid plans, visitors without an account and licence, by product',
    columns: ['Free plan', 'Paid plans', 'Visitors without an account', 'Open-source licence'],
    rows: [
      { product: excalidraw, cells: ['Free to use', 'Paid plan', null, 'Open-source licence'] },
      { product: tldraw, cells: ['Free to use', 'Price of a commercial licence', null, 'Open-source licence'] },
      { product: confluence, cells: ['Free plan', 'Price', 'Visitors without an account', null] },
      { product: miro, cells: ['Free plan', 'Paid plans', 'Visitors without an account', 'Open-source licence'] },
      { product: figjam, cells: ['Free plan', 'Paid seats', 'Collaborators without an account', 'Open source, on your own servers'] },
      { product: mural, cells: ['Free plan', 'Paid plans', 'Visitors without an account', 'Open source, on your own servers'] },
    ],
    freero: [
      { verdict: 'yes', note: 'every feature; default fair-use limits instead of plan limits', ref: 'docs/parity.md' },
      { verdict: 'no', note: 'no licence fees; self-hosting costs your own servers', ref: 'docs/parity.md' },
      { verdict: 'yes', note: 'named guests on a shared link view and comment; editing needs an account', ref: 'docs/parity.md' },
      { verdict: 'yes', note: 'MIT', ref: 'LICENSE' },
    ],
  },
  notListed: [
    [
      'Microsoft Whiteboard',
      <>
        no longer free on its own: personal Microsoft accounts can’t create or edit boards since 2026-09-25, and otherwise it comes with a Microsoft 365 work
        or school subscription. Sources in <a href="/vs/microsoft-whiteboard">Freero vs Microsoft Whiteboard</a>.
      </>,
    ],
    [
      'Jamboard',
      <>
        Google shut it down at the end of 2024. <a href="/vs/jamboard">Freero vs Jamboard</a> covers where its boards can go.
      </>,
    ],
  ],
  related: [
    ['/answers/free-whiteboard-without-board-limit', 'A free whiteboard without a three-board limit'],
    ['/features/online-whiteboard', 'Freero’s free online whiteboard'],
    ['/pricing', 'Pricing and default limits'],
    ['/use-cases/workshops', 'Run a workshop on a free board'],
    ['/vs', 'Every comparison, sourced and dated'],
  ],
  faq: [
    {
      q: 'What is the best free online whiteboard?',
      a: 'For a quick sketch with no account, Excalidraw or tldraw. For a team that wants a full whiteboard free for good, with no board cap to hit, Freero, which we make. If your team already pays for Figma or Confluence, their whiteboards’ free plans are worth a look first.',
    },
    {
      q: 'Which free whiteboards work without an account?',
      a: 'Excalidraw and tldraw.com let anyone open a board and draw without signing up. In Freero, guests on a shared link view and comment without an account, and editing needs one; Miro, FigJam and Mural let visitors in without an account on some plans.',
    },
    {
      q: 'Which free whiteboard has no board limit?',
      a: 'Miro’s free plan keeps 3 boards editable, Mural’s its 3 most recent murals, and FigJam’s Starter plan 3 files per team. Freero has no plan limits: its default is 5,000 boards per account, a fair-use limit that a server’s operator can raise.',
    },
    {
      q: 'Is Microsoft Whiteboard still free?',
      a: 'Not on its own. Since 2026-09-25 personal Microsoft accounts can no longer create or edit boards, and for work and school it comes with a Microsoft 365 subscription.',
    },
  ],
});
