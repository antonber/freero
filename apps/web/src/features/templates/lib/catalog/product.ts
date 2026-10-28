// Product: PRD one-pager, opportunity solution tree, RICE scoring, feedback board, launch plan,
// release plan.
import type { StickyColor } from '@freero/shared';
import { Ban, CalendarDays, CircleAlert, CircleQuestionMark, Target, TrendingUp } from 'lucide-react';
import { Kit, kanbanSize, list, rt, type KanbanColumnSpec } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const prd: TemplateDef = {
  id: 'prd-one-pager',
  name: 'Product requirements (PRD)',
  description: 'A one-page spec: problem, goals and non-goals, prioritised requirements, metrics and open questions.',
  categories: ['product', 'planning'],
  keywords: ['prd', 'product requirements', 'requirements document', 'spec', 'specification', 'one-pager', 'brief', 'feature spec'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1800;
    const top = 160;
    const topH = 250;
    const midY = top + topH + 24;
    const reqCols = [64, 576, 140, 300];
    const reqW = reqCols.reduce((a, b) => a + b, 0);
    const reqRows = [
      { h: 44, cells: ['#', 'Requirement', 'Priority', 'Notes'] },
      { h: 56, cells: ['1', 'Owners can invite guests to a single board', { t: 'Must', f: HEAD.coral }, 'Guests see only that board'] },
      { h: 56, cells: ['2', 'Guests can comment but not edit', { t: 'Must', f: HEAD.coral }, ''] },
      { h: 56, cells: ['3', 'Invites expire after 30 days', { t: 'Should', f: HEAD.amber }, 'Admins can change the limit'] },
      { h: 56, cells: ['4', 'Owners see who opened the board', { t: 'Could', f: HEAD.sky }, ''] },
      { h: 56, cells: ['5', '', '', ''] },
    ];
    const midH = reqRows.reduce((a, r) => a + r.h, 0);
    const lowY = midY + midH + 24;
    const lowH = 230;
    k.frame('Product requirements', W, lowY + lowH + 48);
    k.header('Product requirements: guest access', 'Fill the problem first and keep it about people, not features. Everything else should trace back to it.', W);
    const third = (W - 96 - 48) / 3;
    const tops: Array<{ title: string; icon: typeof Target; tint: string; accent: string; body: string }> = [
      { title: 'Problem', icon: CircleAlert, tint: TINT.coral, accent: CORAL, body: rt('Teams share boards with clients by exporting PDFs, so feedback arrives late and out of context.') },
      { title: 'Goals', icon: Target, tint: TINT.mint, accent: MINT, body: list(['Clients comment on the live board', 'Owners stay in control of access']) },
      { title: 'Non-goals', icon: Ban, tint: TINT.gray, accent: INK_SOFT, body: list(['Guest editing', 'Billing for guests']) },
    ];
    tops.forEach((t, i) => {
      const x = 48 + i * (third + 24);
      const y = k.section(x, top, third, topH, t.title, t.tint, { accent: t.accent, icon: t.icon });
      k.text(x + 24, y, third - 48, t.body, { size: 18, h: topH - (y - top) - 16 });
    });
    k.table(48, midY, reqCols, reqRows);
    const sx = 48 + reqW + 24;
    const sw = W - 48 - sx;
    let y = k.section(sx, midY, sw, midH, 'Success metrics', TINT.sky, { accent: SKY, icon: TrendingUp, hint: 'How we will know it worked, with numbers.' });
    k.text(sx + 24, y, sw - 48, list(['30% of shared boards get a guest comment in week 1', 'PDF exports for sharing drop by half', 'No rise in access-related support tickets']), { size: 18, h: midH - (y - midY) - 16 });
    y = k.section(48, lowY, reqW, lowH, 'Open questions', TINT.amber, { accent: AMBER, icon: CircleQuestionMark });
    const qs: Array<[string, StickyColor]> = [
      ['Do guests need an account?', 'yellow'],
      ['Can a guest see other guests?', 'yellow'],
      ['What does a guest see on a private board?', 'yellow'],
      ['Add a question…', 'yellow'],
    ];
    qs.forEach(([t, c], i) => k.sticky(72 + i * 260, y, t, c, 240, lowH - (y - lowY) - 20));
    y = k.section(sx, lowY, sw, lowH, 'Timeline', TINT.violet, { accent: VIOLET, icon: CalendarDays });
    k.text(sx + 24, y, sw - 48, list(['Design review: week 2', 'Beta with five teams: week 5', 'Launch: week 8']), { size: 18, h: lowH - (y - lowY) - 16 });
    return k.done();
  },
};

export const opportunityTree: TemplateDef = {
  id: 'opportunity-solution-tree',
  name: 'Opportunity solution tree',
  description: 'One outcome, the customer opportunities behind it, solutions for each and the experiments to test them.',
  categories: ['product', 'strategy'],
  keywords: ['opportunity solution tree', 'ost', 'continuous discovery', 'discovery', 'outcomes', 'experiments', 'assumptions', 'product discovery', 'mind map'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [
      { w: 260, h: 84 },
      { w: 300, h: 60 },
      { w: 270, h: 52 },
      { w: 300, h: 52 },
    ];
    const gap = 80;
    const rowH = 76;
    const W = 96 + cols.reduce((a, c) => a + c.w, 0) + 3 * gap;
    const treeY = 216;
    const tree = {
      text: 'Raise week-2 retention from 35% to 45%',
      color: VIOLET,
      children: [
        {
          text: 'I don’t know where to start on an empty board',
          color: SKY,
          children: [
            { text: 'Starter templates on first open', children: [{ text: 'Fake door: “Start from a template”' }] },
            { text: 'Guided first sticky', children: [{ text: 'Prototype test with 5 new users' }] },
          ],
        },
        {
          text: 'My team never comes back to the board',
          color: MINT,
          children: [
            { text: 'Weekly digest email', children: [{ text: 'Send by hand to 20 teams' }] },
            { text: 'Mentions that notify', children: [{ text: 'Count replies within 24 hours' }] },
          ],
        },
        {
          text: 'Sharing with clients is awkward',
          color: AMBER,
          children: [{ text: 'Guest links', children: [{ text: 'Interview 6 agency owners' }] }],
        },
      ],
    };
    const treeH = 5 * rowH;
    k.frame('Opportunity solution tree', W, treeY + treeH + 48);
    k.header('Opportunity solution tree', 'Start from one measurable outcome. Opportunities are customer needs in their words; test the riskiest assumption first.', W);
    const labels = ['Outcome', 'Opportunities', 'Solutions', 'Experiments'];
    let x = 48;
    labels.forEach((l, i) => {
      k.text(x, 160, cols[i].w, `<b>${rt(l)}</b>`, { size: 18, color: INK_SOFT, h: 28 });
      x += cols[i].w + gap;
    });
    k.mindTree(48, treeY, cols, gap, rowH, tree);
    return k.done();
  },
};

export const riceScoring: TemplateDef = {
  id: 'rice-scoring',
  name: 'RICE scoring',
  description: 'Score ideas by reach, impact, confidence and effort, so the backlog order has reasons.',
  categories: ['product', 'strategy'],
  keywords: ['rice', 'ice', 'prioritisation', 'prioritization', 'scoring', 'reach impact confidence effort', 'backlog', 'feature prioritization', 'table'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [320, 130, 130, 160, 130, 170];
    const tw = cols.reduce((a, b) => a + b, 0);
    const score = (t: string) => ({ t, f: TINT.violet });
    const rows = [
      { h: 48, cells: ['Idea', 'Reach', 'Impact', 'Confidence', 'Effort', 'RICE score'] },
      { h: 56, cells: ['Faster board loading', '3000', '1', '100%', '2', score('1500')] },
      { h: 56, cells: ['Bulk-edit stickies', '1200', '1', '80%', '1', score('960')] },
      { h: 56, cells: ['Guest comments', '800', '0.5', '80%', '0.5', score('640')] },
      { h: 56, cells: ['Share templates with a team', '600', '2', '80%', '2', score('480')] },
      { h: 56, cells: ['Calendar sync', '400', '2', '50%', '3', score('133')] },
      { h: 56, cells: ['', '', '', '', '', score('')] },
    ];
    const th = rows.reduce((a, r) => a + r.h, 0);
    const sideW = 440;
    const W = 48 + tw + 24 + sideW + 48;
    const parkY = 160 + th + 24;
    const parkH = 240;
    k.frame('RICE scoring', W, parkY + parkH + 48);
    k.header('RICE scoring', 'Score each idea on its own, then sort by the last column. A surprising order is a reason to talk, not to obey.', W);
    k.table(48, 160, cols, rows);
    const sx = 48 + tw + 24;
    const y = k.section(sx, 160, sideW, th + 24 + parkH, 'How to score', TINT.gray);
    k.text(
      sx + 24,
      y,
      sideW - 48,
      list([
        'Reach: people affected per quarter',
        'Impact: 3 huge, 2 high, 1 medium, 0.5 low, 0.25 tiny',
        'Confidence: 100% data, 80% some proof, 50% a hunch',
        'Effort: person-months',
        'Score = Reach × Impact × Confidence ÷ Effort',
        'ICE instead: Impact × Confidence × Ease, each 1–10',
      ]),
      { size: 18, h: th + parkH - (y - 160) },
    );
    const py = k.section(48, parkY, tw, parkH, 'Parked ideas', TINT.amber, { accent: AMBER, hint: 'Not scored yet, or not now.' });
    k.stickies(72, py, tw - 48, ['Dark mode for exports', 'Offline editing', 'Custom fonts', 'Add an idea…'], 'yellow', 140, 24);
    return k.done();
  },
};

export const feedbackBoard: TemplateDef = {
  id: 'feedback-board',
  name: 'Customer feedback board',
  description: 'A kanban for feature requests and feedback: inbox, under review, planned and shipped.',
  categories: ['product', 'agile'],
  keywords: ['feedback', 'feature requests', 'customer feedback', 'requests', 'voice of the customer', 'triage', 'kanban', 'ideas'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 290;
    const columns: KanbanColumnSpec[] = [
      {
        title: 'Inbox',
        color: HEAD.gray,
        items: [
          { sticky: '“I wish I could lock the background image”', color: 'yellow', h: 150 },
          { sticky: '“Export to slides, please”', color: 'yellow', h: 150 },
        ],
      },
      {
        title: 'Under review',
        status: 'todo',
        color: HEAD.amber,
        items: [
          { card: 'Lock elements', desc: 'Asked by 14 teams · design', color: AMBER },
          { card: 'Slide export', desc: 'Asked by 6 teams', color: AMBER },
        ],
      },
      { title: 'Planned', status: 'doing', color: HEAD.sky, items: [{ card: 'Comment notifications', desc: 'Q3 · asked by 22 teams', color: SKY }] },
      { title: 'Shipped', status: 'done', color: HEAD.mint, items: [{ card: 'Dark mode', desc: 'Tell the 31 teams who asked', color: MINT }] },
    ];
    const kb = kanbanSize(colW, columns);
    const sideW = 400;
    const bodyH = Math.max(kb.h + 40, 520);
    const W = 48 + kb.w + 24 + sideW + 48;
    k.frame('Customer feedback', W, 160 + bodyH + 48);
    k.header('Customer feedback board', 'Paste requests into the Inbox as quotes. Merge duplicates into one card and count who asked.', W);
    k.kanban(48, 160, 'Feedback', colW, columns);
    const sx = 48 + kb.w + 24;
    const y = k.section(sx, 160, sideW, bodyH, 'Triage rules', TINT.violet, { accent: VIOLET });
    k.text(
      sx + 24,
      y,
      sideW - 48,
      list(['Once a week, empty the Inbox', 'Keep the customer’s words; add the problem behind them', 'Vote on Under review with the voting tool', 'When it ships, tell everyone who asked']),
      { size: 18, h: 260 },
    );
    k.sticky(sx + 24, y + 284, 'Tip: tag cards with the customer segment', 'pink', sideW - 48, Math.min(160, bodyH - (y - 160) - 284 - 24));
    return k.done();
  },
};

export const launchPlan: TemplateDef = {
  id: 'launch-plan',
  name: 'Launch plan',
  description: 'Who does what before, during and after a launch, in swimlanes per team.',
  categories: ['product', 'planning'],
  keywords: ['launch plan', 'go to market', 'gtm', 'launch', 'rollout', 'marketing plan', 'release', 'swimlane', 'checklist'],
  build(newId) {
    const k = new Kit(newId);
    const phaseW = 460;
    const laneH = 190;
    const lanes: Array<{ title: string; color: string; sticky: StickyColor; cells: string[][] }> = [
      { title: 'Product', color: HEAD.violet, sticky: 'violet', cells: [['Feature flag ready', 'Beta feedback triaged'], ['Flag on for everyone'], ['Fix top 3 issues', 'Usage review']] },
      { title: 'Marketing', color: HEAD.rose, sticky: 'pink', cells: [['Landing page draft', 'Launch video'], ['Blog post', 'Social posts'], ['Customer story']] },
      { title: 'Sales', color: HEAD.sky, sticky: 'blue', cells: [['Pitch deck update'], ['Email key accounts', 'Demo script'], ['Win/loss notes']] },
      { title: 'Support', color: HEAD.mint, sticky: 'green', cells: [['Help articles', 'Train the team'], ['Watch the queue'], ['FAQ from tickets']] },
    ];
    const phases = ['4 weeks before', 'Launch week', '4 weeks after'];
    const W = 48 + 150 + phases.length * phaseW + 48;
    const poolH = 44 + 36 + lanes.length * laneH;
    k.frame('Launch plan', W, 160 + poolH + 48);
    k.header('Launch plan', 'One sticky per task, in the team’s lane and the week it happens. Put names on stickies, and dates when they’re fixed.', W);
    const p = k.swimlane(48, 160, 'Launch: guest access', lanes.map((l) => ({ title: l.title, size: laneH, color: l.color })), phases.map((t) => ({ title: t, size: phaseW, color: HEAD.gray })));
    const size = 150;
    k.within(p.id, () =>
      lanes.forEach((l, i) =>
        l.cells.forEach((cell, j) => {
          const { x } = p.phase(j);
          const { y, h } = p.lane(i);
          cell.forEach((t, n) => k.sticky(x + 24 + n * (size + 24), y + (h - size) / 2, t, l.sticky, size));
        }),
      ),
    );
    return k.done();
  },
};

export const releasePlan: TemplateDef = {
  id: 'release-plan',
  name: 'Release plan',
  description: 'Work per stream across four sprints as task cards in swimlanes, with the release marked.',
  categories: ['product', 'agile', 'planning'],
  keywords: ['release plan', 'release planning', 'sprints', 'roadmap', 'workstreams', 'increments', 'pi planning', 'swimlane', 'milestones'],
  build(newId) {
    const k = new Kit(newId);
    const phaseW = 320;
    const laneH = 220;
    const cardW = 272;
    const lanes: Array<{ title: string; color: string; accent: string; cells: string[][] }> = [
      { title: 'Design', color: HEAD.violet, accent: VIOLET, cells: [['Guest flow sketches', 'Usability test'], ['Final UI specs'], [], ['Polish from feedback']] },
      { title: 'Web app', color: HEAD.sky, accent: SKY, cells: [['Invite dialog'], ['Guest view', 'Comment-only mode'], ['Access settings'], ['Bug fixes']] },
      { title: 'API', color: HEAD.mint, accent: MINT, cells: [['Guest roles'], ['Invite links', 'Expiry job'], ['Audit events'], []] },
      { title: 'Quality', color: HEAD.amber, accent: AMBER, cells: [[], ['Test plan'], ['End-to-end tests', 'Load test'], ['Release checks']] },
    ];
    const phases = ['Sprint 14', 'Sprint 15', 'Sprint 16', 'Sprint 17'];
    const W = 48 + 150 + phases.length * phaseW + 48;
    const poolY = 208;
    const poolH = 44 + 36 + lanes.length * laneH;
    k.frame('Release plan', W, poolY + poolH + 48);
    k.header('Release plan 2.4', 'Cards sit in their stream’s lane and the sprint they land in. Drag a card to replan; the lanes grow to fit.', W);
    const relX = 48 + 150 + 3 * phaseW - 150;
    k.shape('roundRect', relX, 152, 300, 44, '<b>Release 2.4 · end of Sprint 16</b>', { fill: CORAL, textColor: '#FFFFFF', fontSize: 16 });
    const p = k.swimlane(48, poolY, 'Guest access', lanes.map((l) => ({ title: l.title, size: laneH, color: l.color })), phases.map((t) => ({ title: t, size: phaseW, color: HEAD.gray })));
    k.within(p.id, () =>
      lanes.forEach((l, i) =>
        l.cells.forEach((cell, j) => {
          const { x } = p.phase(j);
          const { y } = p.lane(i);
          cell.forEach((t, n) => k.card(x + 24, y + 20 + n * 96, cardW, 84, t, '', l.accent, null));
        }),
      ),
    );
    return k.done();
  },
};
