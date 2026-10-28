// Planning & delivery: OKR tree, OKR tracker, Gantt chart, onboarding plan, sprint board,
// sprint review.
import type { StickyColor } from '@freero/shared';
import { Users } from 'lucide-react';
import { Kit, kanbanSize, list, rt, type KanbanColumnSpec, type TableCell } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, MINT, ROSE, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const okrTree: TemplateDef = {
  id: 'okr-tree',
  name: 'OKR tree',
  description: 'A mission broken into objectives, measurable key results and the initiatives behind them.',
  categories: ['planning', 'strategy'],
  keywords: ['okr', 'okrs', 'objectives and key results', 'goals', 'goal tree', 'alignment', 'mind map', 'targets', 'cascade'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [
      { w: 280, h: 96 },
      { w: 300, h: 64 },
      { w: 310, h: 52 },
      { w: 280, h: 52 },
    ];
    const gap = 72;
    const rowH = 80;
    const W = 96 + cols.reduce((a, c) => a + c.w, 0) + 3 * gap;
    const treeY = 216;
    k.frame('OKR tree', W, treeY + 6 * rowH + 48);
    k.header('OKR tree', 'Objectives say where to go, key results how you’ll know you got there. Initiatives are bets: swap them freely.', W);
    let x = 48;
    ['Mission', 'Objectives', 'Key results', 'Initiatives'].forEach((l, i) => {
      k.text(x, 160, cols[i].w, `<b>${rt(l)}</b>`, { size: 18, color: INK_SOFT, h: 28 });
      x += cols[i].w + gap;
    });
    k.mindTree(48, treeY, cols, gap, rowH, {
      text: 'Make the easiest whiteboard to start with',
      color: VIOLET,
      children: [
        {
          text: 'New teams get value in their first session',
          color: SKY,
          children: [
            { text: 'Week-1 activation 40% → 55%', children: [{ text: 'Starter templates on first open' }] },
            { text: 'First sticky in under 60 s', children: [{ text: 'Shorter sign-up' }] },
          ],
        },
        {
          text: 'Teams keep coming back',
          color: MINT,
          children: [
            { text: 'Week-4 retention 25% → 35%', children: [{ text: 'Weekly board digest' }] },
            { text: '3+ active members per board', children: [{ text: 'Better invite flow' }] },
          ],
        },
        {
          text: 'Support stays light',
          color: AMBER,
          children: [
            { text: 'Tickets per 1k users ≤ 4', children: [{ text: 'In-app help search' }] },
            { text: 'First reply under 2 hours', children: [{ text: 'Saved replies' }] },
          ],
        },
      ],
    });
    return k.done();
  },
};

export const okrTracker: TemplateDef = {
  id: 'okr-tracker',
  name: 'OKR tracker',
  description: 'Key results with start, target and current values, confidence and owners, plus check-in notes.',
  categories: ['planning', 'strategy'],
  keywords: ['okr tracker', 'okrs', 'key results', 'progress', 'goals', 'scorecard', 'quarterly goals', 'check-in', 'table'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [290, 360, 100, 100, 100, 150, 150];
    const tw = cols.reduce((a, b) => a + b, 0);
    const on = { t: 'On track', f: HEAD.mint };
    const risk = { t: 'At risk', f: HEAD.amber };
    const off = { t: 'Off track', f: HEAD.coral };
    const rows: Array<{ h: number; cells: Array<string | TableCell> }> = [
      { h: 48, cells: ['Objective', 'Key result', 'Start', 'Target', 'Now', 'Confidence', 'Owner'] },
      { h: 56, cells: ['New teams get value fast', 'Week-1 activation', '40%', '55%', '47%', on, ''] },
      { h: 56, cells: ['', 'Time to first sticky', '95 s', '60 s', '80 s', risk, ''] },
      { h: 56, cells: ['Teams keep coming back', 'Week-4 retention', '25%', '35%', '26%', off, ''] },
      { h: 56, cells: ['', 'Active members per board', '2.1', '3', '2.6', on, ''] },
      { h: 56, cells: ['Support stays light', 'Tickets per 1k users', '6', '4', '4.5', risk, ''] },
      { h: 56, cells: ['', '', '', '', '', '', ''] },
    ];
    const th = rows.reduce((a, r) => a + r.h, 0);
    const sideW = 380;
    const W = 48 + tw + 24 + sideW + 48;
    const notesY = 160 + th + 24;
    const notesH = 290;
    k.frame('OKR tracker', W, notesY + notesH + 48);
    k.header('OKR tracker · Q3', 'Update “Now” and confidence every week. Confidence is a forecast: will we hit the target by the end of the quarter?', W);
    k.table(48, 160, cols, rows);
    const sx = 48 + tw + 24;
    const y = k.section(sx, 160, sideW, th + 24 + notesH, 'Weekly check-in', TINT.gray);
    k.text(sx + 24, y, sideW - 48, list(['What moved since last week?', 'What is blocking the red ones?', 'Do we change an initiative?', 'Who needs help?'], true), { size: 18, h: 180 });
    k.sticky(sx + 24, y + 204, 'Rule of thumb: hitting 70% of an ambitious target is a good quarter.', 'violet', sideW - 48, 200);
    const ny = k.section(48, notesY, tw, notesH, 'Check-in notes', TINT.amber, { accent: AMBER, hint: 'One sticky per week: date, what changed, decisions.' });
    k.stickies(72, ny, tw - 48, ['Week 1: baseline set', 'Week 2: digest moved up', 'Add this week…'], 'yellow', 176, 24);
    return k.done();
  },
};

export const gantt: TemplateDef = {
  id: 'gantt-chart',
  name: 'Gantt chart',
  description: 'Tasks against twelve weeks as colored bars in a table, with owners, a launch milestone and risks.',
  categories: ['planning'],
  keywords: ['gantt', 'gantt chart', 'project plan', 'schedule', 'project timeline', 'weeks', 'milestones', 'dependencies', 'table'],
  build(newId) {
    const k = new Kit(newId);
    const weeks = 12;
    const wk = 60;
    const cols = [260, 120, ...Array.from({ length: weeks }, () => wk)];
    const tw = cols.reduce((a, b) => a + b, 0);
    const tasks: Array<{ name: string; from: number; to: number; color: string; milestone?: boolean }> = [
      { name: 'Customer interviews', from: 1, to: 2, color: HEAD.violet },
      { name: 'Define scope', from: 2, to: 3, color: HEAD.violet },
      { name: 'Design', from: 3, to: 5, color: HEAD.sky },
      { name: 'Build: server', from: 4, to: 8, color: HEAD.mint },
      { name: 'Build: web app', from: 5, to: 9, color: HEAD.mint },
      { name: 'Beta with 5 teams', from: 9, to: 10, color: HEAD.amber },
      { name: 'Fix and polish', from: 10, to: 11, color: HEAD.amber },
      { name: 'Launch', from: 12, to: 12, color: CORAL, milestone: true },
    ];
    const rows: Array<{ h: number; cells: Array<string | TableCell> }> = [
      { h: 44, cells: ['Task', 'Owner', ...Array.from({ length: weeks }, (_, i) => `W${i + 1}`)] },
      ...tasks.map((t) => ({
        h: 44,
        cells: [t.name, '', ...Array.from({ length: weeks }, (_, i) => (i + 1 >= t.from && i + 1 <= t.to ? { t: t.milestone ? '◆' : '', f: t.color } : ''))],
      })),
      { h: 44, cells: ['', ''] },
    ];
    const th = rows.reduce((a, r) => a + r.h, 0);
    const sideW = 360;
    const W = 48 + tw + 24 + sideW + 48;
    const riskY = 160 + th + 24;
    const riskH = 230;
    k.frame('Gantt chart', W, riskY + riskH + 48);
    k.header('Gantt chart', 'Color a task’s weeks to draw its bar (cell fill). Keep it to the big pieces; details live in the sprint board.', W);
    k.table(48, 160, cols, rows, { fontSize: 15 });
    const sx = 48 + tw + 24;
    let y = k.section(sx, 160, sideW, th, 'Legend', TINT.gray);
    const legend: Array<[string, string]> = [
      [HEAD.violet, 'Discovery'],
      [HEAD.sky, 'Design'],
      [HEAD.mint, 'Build'],
      [HEAD.amber, 'Test'],
      [CORAL, 'Milestone'],
    ];
    legend.forEach(([c, label], i) => {
      k.shape('roundRect', sx + 24, y + i * 44, 40, 28, '', { fill: c });
      k.text(sx + 80, y + i * 44, sideW - 104, rt(label), { size: 18, h: 28 });
    });
    y += legend.length * 44 + 8;
    k.text(sx + 24, y, sideW - 48, rt('Today: week 4'), { size: 16, color: INK_SOFT, h: 26 });
    const ry = k.section(48, riskY, tw + 24 + sideW, riskH, 'Risks & dependencies', TINT.coral, { accent: CORAL });
    const risks: Array<[string, StickyColor]> = [
      ['Design sign-off by week 5 or build slips', 'coral'],
      ['Server work needs the new auth API', 'coral'],
      ['Beta teams not yet confirmed', 'yellow'],
      ['Add a risk…', 'yellow'],
    ];
    risks.forEach(([t, c], i) => k.sticky(72 + i * 200, ry, t, c, 180, riskH - (ry - riskY) - 20));
    return k.done();
  },
};

export const onboardingPlan: TemplateDef = {
  id: 'onboarding-plan',
  name: 'Onboarding plan',
  description: 'A new hire’s first month as a kanban checklist, with the people to know and questions to ask.',
  categories: ['planning', 'meetings'],
  keywords: ['onboarding', 'new hire', 'new joiner', 'checklist', 'first week', '30 60 90', 'orientation', 'buddy', 'kanban'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 270;
    const columns: KanbanColumnSpec[] = [
      { title: 'Before day 1', color: HEAD.gray, items: [{ card: 'Laptop and accounts ready', color: INK_SOFT }, { card: 'Welcome note from the team', color: INK_SOFT }] },
      {
        title: 'Week 1',
        status: 'todo',
        color: HEAD.sky,
        items: [
          { card: 'Coffee with your buddy', color: SKY },
          { card: 'Set up your dev environment', color: SKY },
          { card: 'Ship one tiny change', desc: 'A typo fix counts', color: SKY },
        ],
      },
      {
        title: 'Weeks 2–4',
        status: 'doing',
        color: HEAD.violet,
        items: [
          { card: 'Sit in on two customer calls', color: VIOLET },
          { card: 'Own a small feature', color: VIOLET },
          { card: '30-day check-in', desc: 'With your manager', color: VIOLET },
        ],
      },
      { title: 'Done', status: 'done', color: HEAD.mint, items: [{ card: 'Signed the paperwork', color: MINT }] },
    ];
    const kb = kanbanSize(colW, columns);
    const sideW = 420;
    const bodyH = Math.max(kb.h + 40, 560);
    const W = 48 + sideW + 24 + kb.w + 48;
    k.frame('Onboarding plan', W, 160 + bodyH + 48);
    k.header('Onboarding plan', 'Make a copy per new hire. They move their own cards; the buddy checks in at the end of each week.', W);
    let y = k.section(48, 160, sideW, bodyH, 'People to know', TINT.mint, { accent: MINT, icon: Users });
    k.table(72, y, [150, 222], [
      { h: 44, cells: ['Manager', ''] },
      { h: 44, cells: ['Buddy', ''] },
      { h: 44, cells: ['IT help', '#it-help'] },
      { h: 44, cells: ['People team', ''] },
    ], { header: false, fills: { 0: TINT.gray } });
    y += 4 * 44 + 24;
    k.sticky(72, y, 'Ask anyone: “What do you wish you’d known in week 1?”', 'yellow', sideW - 48, Math.min(200, bodyH - (y - 160) - 24));
    k.kanban(48 + sideW + 24, 160, 'First month', colW, columns);
    return k.done();
  },
};

export const sprintBoard: TemplateDef = {
  id: 'sprint-board',
  name: 'Sprint board',
  description: 'The sprint goal and facts on top, a five-column task kanban with WIP limits below.',
  categories: ['agile', 'planning'],
  keywords: ['sprint board', 'scrum board', 'task board', 'sprint backlog', 'kanban', 'scrum', 'wip', 'tasks'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 260;
    const columns: KanbanColumnSpec[] = [
      { title: 'Backlog', color: HEAD.gray, items: [{ card: 'Keyboard shortcuts help', color: INK_SOFT }, { card: 'Faster image upload', color: INK_SOFT }] },
      { title: 'To do', status: 'todo', color: HEAD.sky, items: [{ card: 'Invite dialog', desc: '3 points', color: SKY }, { card: 'Guest role in API', desc: '5 points', color: SKY }] },
      { title: 'In progress', status: 'doing', wip: 3, color: HEAD.amber, items: [{ card: 'Comment-only mode', desc: '5 points', color: AMBER }, { card: 'Invite emails', desc: '2 points', color: AMBER }] },
      { title: 'In review', wip: 2, color: HEAD.violet, items: [{ card: 'Access settings page', desc: '3 points', color: VIOLET }] },
      { title: 'Done', status: 'done', color: HEAD.mint, items: [{ card: 'Guest flow design', desc: '3 points', color: MINT }] },
    ];
    const kb = kanbanSize(colW, columns);
    const W = 48 + kb.w + 48;
    const topH = 132;
    const kbY = 160 + topH + 24;
    k.frame('Sprint board', W, kbY + kb.h + 40 + 48);
    k.header('Sprint board', 'Pull work from the left, never push. When In progress is full, help finish something before starting more.', W);
    const factsW = 360;
    k.shape('roundRect', 48, 160, kb.w - factsW - 24, topH, '<b>Sprint goal</b><br>Clients can comment on a shared board', { fill: VIOLET, textColor: '#FFFFFF', fontSize: 22 });
    k.table(48 + kb.w - factsW, 160, [140, 220], [
      { h: 44, cells: ['Sprint', '18'] },
      { h: 44, cells: ['Dates', ''] },
      { h: 44, cells: ['Capacity', '26 points'] },
    ], { header: false, fills: { 0: TINT.gray } });
    k.kanban(48, kbY, 'Sprint 18', colW, columns);
    return k.done();
  },
};

export const sprintReview: TemplateDef = {
  id: 'sprint-review',
  name: 'Sprint review',
  description: 'What the sprint delivered against its goal, the demo order, numbers and stakeholder feedback.',
  categories: ['agile', 'meetings'],
  keywords: ['sprint review', 'demo', 'showcase', 'increment', 'stakeholders', 'feedback', 'scrum', 'review meeting'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [420, 180, 160, 360];
    const tw = cols.reduce((a, b) => a + b, 0);
    const done = { t: 'Done', f: HEAD.mint };
    const rows: Array<{ h: number; cells: Array<string | TableCell> }> = [
      { h: 48, cells: ['Delivered', 'Demo by', 'Status', 'Notes'] },
      { h: 52, cells: ['Invite a guest by email', '', done, ''] },
      { h: 52, cells: ['Comment-only mode', '', done, ''] },
      { h: 52, cells: ['Access settings page', '', { t: 'Partly', f: HEAD.amber }, 'Expiry setting next sprint'] },
      { h: 52, cells: ['Guest view on mobile', '', { t: 'Not done', f: HEAD.coral }, 'Moved to backlog'] },
      { h: 52, cells: ['', '', '', ''] },
    ];
    const th = rows.reduce((a, r) => a + r.h, 0);
    const sideW = 420;
    const W = 48 + tw + 24 + sideW + 48;
    const goalH = 100;
    const midY = 160 + goalH + 24;
    const fbY = midY + th + 24;
    const fbH = 240;
    k.frame('Sprint review', W, fbY + fbH + 48);
    k.header('Sprint review', 'Show working software, not slides. Collect feedback as stickies while you demo; sort it at the end.', W);
    k.shape('roundRect', 48, 160, tw, goalH, '<b>Sprint goal:</b> clients can comment on a shared board', { fill: TINT.violet, stroke: VIOLET, strokeWidth: 2, fontSize: 22 });
    k.sticky(48 + tw + 24, 160, 'Goal met? Mostly: mobile view slipped', 'green', sideW, goalH);
    k.table(48, midY, cols, rows);
    k.table(48 + tw + 24, midY, [260, 160], [
      { h: 48, cells: ['Numbers', ''] },
      { h: 52, cells: ['Planned', '26 points'] },
      { h: 52, cells: ['Done', '21 points'] },
      { h: 52, cells: ['Carried over', '5 points'] },
      { h: 52, cells: ['Bugs found', '2'] },
      { h: 52, cells: ['Next review', ''] },
    ]);
    const y = k.section(48, fbY, W - 96, fbH, 'Stakeholder feedback', TINT.rose, { accent: ROSE, hint: 'One sticky per comment; add the name of who said it.' });
    const notes: Array<[string, StickyColor]> = [
      ['Love it: clients will use this', 'green'],
      ['Can guests download the board?', 'yellow'],
      ['Invite email looks like spam', 'coral'],
      ['Add feedback…', 'yellow'],
    ];
    notes.forEach(([t, c], i) => k.sticky(72 + i * 220, y, t, c, 200, fbH - (y - fbY) - 20));
    return k.done();
  },
};
