// Agile rituals: retrospective, kanban board, user story map.
import type { StickyColor } from '@freero/shared';
import { Kit, rt } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, LINE, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const retrospective: TemplateDef = {
  id: 'retrospective',
  name: 'Retrospective',
  description: 'Went well, to improve and action items: a calm, classic sprint retro.',
  categories: ['agile', 'meetings'],
  keywords: ['retro', 'sprint', 'review', 'lessons learned', 'team'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 448;
    const gap = 24;
    const note = 196;
    const W = 96 + 3 * colW + 2 * gap;
    const y0 = 160;
    const colH = 96 + 3 * note + 2 * 16 + 24;
    const H = y0 + colH + 48;
    k.frame('Retrospective', W, H);
    k.header('Sprint retrospective', 'Take 5 quiet minutes per column, then group similar notes and agree on 1–3 actions, each with an owner.', W);
    const cols: Array<{ title: string; tint: string; head: string; color: StickyColor; notes: string[] }> = [
      {
        title: 'Went well',
        tint: TINT.mint,
        head: HEAD.mint,
        color: 'green',
        notes: ['Release went out on schedule', 'Pairing helped new folks ramp up fast', 'Design reviews were short and focused', 'Add what helped us…'],
      },
      {
        title: 'To improve',
        tint: TINT.coral,
        head: HEAD.coral,
        color: 'coral',
        notes: ['Too many meetings on Wednesdays', 'Flaky tests slowed down merges', 'Scope changed mid-sprint', 'Add what slowed us down…'],
      },
      {
        title: 'Action items',
        tint: TINT.violet,
        head: HEAD.violet,
        color: 'violet',
        notes: ['Cap Wednesday meetings at 2 hours\nOwner: TBD', 'Quarantine flaky tests by Friday\nOwner: TBD', 'Freeze scope after planning\nOwner: TBD', 'Add an action and an owner…'],
      },
    ];
    cols.forEach((c, i) => {
      const x = 48 + i * (colW + gap);
      k.panel(x, y0, colW, colH, c.tint);
      k.shape('roundRect', x + 16, y0 + 16, colW - 32, 56, `<b>${rt(c.title)}</b>`, { fill: c.head, fontSize: 22 });
      c.notes.forEach((n, j) => {
        const nx = x + 16 + (j % 2) * (note + 24);
        const ny = y0 + 96 + Math.floor(j / 2) * (note + 16);
        k.sticky(nx, ny, n, c.color, note);
      });
    });
    return k.els;
  },
};

export const kanban: TemplateDef = {
  id: 'kanban',
  name: 'Kanban board',
  description: 'To do, Doing and Done columns with task cards and a work-in-progress limit.',
  categories: ['agile', 'planning'],
  keywords: ['kanban', 'board', 'tasks', 'backlog', 'workflow', 'cards'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 360;
    const gap = 24;
    const cardH = 124;
    const W = 96 + 3 * colW + 2 * gap;
    const y0 = 160;
    const colH = 760;
    const H = y0 + colH + 48;
    k.frame('Kanban board', W, H);
    k.header('Kanban board', 'Move cards right as work progresses. Keep Doing to three cards or fewer so work actually finishes.', W);
    const cols: Array<{ title: string; status: 'todo' | 'doing' | 'done'; tint: string; head: string; cards: Array<[string, string, string]> }> = [
      {
        title: 'To do',
        status: 'todo',
        tint: TINT.gray,
        head: HEAD.gray,
        cards: [
          ['Draft pricing page copy', 'Compare per-seat and flat team plans.', SKY],
          ['Set up error alerts', 'Notify the on-call channel on 5xx spikes.', CORAL],
          ['Interview pilot customers', 'Book three 30-minute calls this week.', MINT],
        ],
      },
      {
        title: 'Doing · limit 3',
        status: 'doing',
        tint: TINT.sky,
        head: HEAD.sky,
        cards: [
          ['Redesign settings screen', 'Group options into Account, Team and Billing.', VIOLET],
          ['Migrate billing webhooks', 'Switch to signed events and keep retries.', AMBER],
        ],
      },
      {
        title: 'Done',
        status: 'done',
        tint: TINT.mint,
        head: HEAD.mint,
        cards: [
          ['Write launch checklist', 'Shared with the team, owners assigned.', MINT],
          ['Fix login redirect loop', 'Shipped in v2.4.1.', CORAL],
        ],
      },
    ];
    cols.forEach((c, i) => {
      const x = 48 + i * (colW + gap);
      k.panel(x, y0, colW, colH, c.tint);
      k.text(x + 20, y0 + 20, colW - 40, `<b>${rt(c.title)}</b>`, { size: 22, h: 32 });
      k.shape('roundRect', x + colW - 56, y0 + 20, 36, 30, `<b>${c.cards.length}</b>`, { fill: c.head, fontSize: 16 });
      c.cards.forEach(([title, desc, color], j) => {
        k.card(x + 16, y0 + 72 + j * (cardH + 14), colW - 32, cardH, title, desc, color, c.status);
      });
    });
    return k.els;
  },
};

export const storyMap: TemplateDef = {
  id: 'story-map',
  name: 'User story map',
  description: 'The user journey as a backbone of activities, with stories sliced into releases.',
  categories: ['agile', 'planning'],
  keywords: ['story map', 'user stories', 'backlog', 'mvp', 'releases', 'product'],
  build(newId) {
    const k = new Kit(newId);
    const labelW = 200;
    const colW = 200;
    const gap = 16;
    const x0 = 48 + labelW + gap;
    const W = x0 + 5 * colW + 4 * gap + 48;
    const activities = ['Discover the product', 'Sign up', 'Set up a board', 'Collaborate', 'Share results'];
    const tasks = ['Read a customer story', 'Create an account with email', 'Pick a starter template', 'Invite teammates', 'Export the board'];
    const r1 = ['Landing page with a short demo', 'Email and password signup', 'Three starter templates', 'Share link with edit access', 'Image export'];
    const r2 = ['Comparison page', 'Sign in with Google', 'Template search', 'Live cursors and presence', 'PDF export by frame'];

    const rows = { activities: 168, tasks: 272, r1: 432, r2: 612 };
    const H = rows.r2 + 130 + 64;
    k.frame('User story map', W, H);
    k.header('User story map', 'Left to right is the user journey. Top to bottom is priority: everything above a release line ships in that release.', W);

    const label = (y: number, title: string, sub: string) => {
      k.text(48, y, labelW, `<b>${rt(title)}</b>`, { size: 18, h: 28 });
      k.text(48, y + 28, labelW, rt(sub), { size: 14, color: INK_SOFT, h: 44 });
    };
    label(rows.activities, 'Activities', 'What the user is trying to do');
    label(rows.tasks, 'User tasks', 'Steps inside each activity');
    label(rows.r1 + 8, 'Release 1 · MVP', 'Smallest useful slice');
    label(rows.r2 + 8, 'Release 2', 'Makes it delightful');

    for (const y of [rows.r1 - 24, rows.r2 - 24]) {
      k.connector({ x: 48, y }, { x: W - 48, y }, { routing: 'straight', strokeStyle: 'dashed', stroke: LINE, endCap: 'none' });
    }
    activities.forEach((a, i) => {
      const x = x0 + i * (colW + gap);
      k.shape('roundRect', x, rows.activities, colW, 80, `<b>${rt(a)}</b>`, { fill: HEAD.violet, fontSize: 17 });
      k.sticky(x, rows.tasks, tasks[i], 'yellow', colW, 112);
      k.sticky(x, rows.r1, r1[i], 'green', colW, 130);
      k.sticky(x, rows.r2, r2[i], 'blue', colW, 130);
    });
    return k.els;
  },
};
