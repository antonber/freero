// Everyday work: weekly planner, meeting notes, flowchart.
import type { StickyColor } from '@freero/shared';
import { Kit, list, rt } from '../kit';
import { AMBER, HEAD, INK_SOFT, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const weeklyPlanner: TemplateDef = {
  id: 'weekly-planner',
  name: 'Weekly planner',
  description: 'Top three priorities plus a column per weekday for meetings, focus work and wins.',
  categories: ['planning'],
  keywords: ['week', 'planner', 'calendar', 'schedule', 'personal', 'todo'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 260;
    const gap = 16;
    const W = 96 + 5 * colW + 4 * gap;
    const focusY = 160;
    const focusH = 176;
    const daysY = focusY + focusH + 24;
    const dayH = 520;
    const H = daysY + dayH + 48;
    k.frame('Weekly planner', W, H);
    k.header('Weekly planner', 'Pick three priorities first, then plan the days around them. Yellow = focus work, blue = meetings, green = personal.', W);

    k.panel(48, focusY, W - 96, focusH, TINT.violet);
    k.text(72, focusY + 24, 220, '<b>This week’s top 3</b>', { size: 22, color: VIOLET, h: 32 });
    k.text(72, focusY + 62, 220, rt('If only these get done, the week was a success.'), { size: 14, color: INK_SOFT, h: 44 });
    const prio = ['Finalize the Q3 budget', 'Ship the onboarding checklist', 'Give feedback on two design docs'];
    const prioW = (W - 96 - 300 - 2 * 16 - 24) / 3;
    prio.forEach((p, i) => k.sticky(48 + 300 + i * (prioW + 16), focusY + 24, `${i + 1}. ${p}`, 'lemon', prioW, focusH - 48));

    const days: Array<{ day: string; items: Array<[string, StickyColor]> }> = [
      { day: 'Monday', items: [['Plan the week (30 min)', 'yellow'], ['Team sync · 10:00', 'blue']] },
      { day: 'Tuesday', items: [['Deep work: budget draft', 'yellow'], ['1:1 with manager', 'blue']] },
      { day: 'Wednesday', items: [['Customer call · 14:00', 'blue'], ['Review open pull requests', 'yellow']] },
      { day: 'Thursday', items: [['Workshop prep', 'yellow'], ['Run at lunch', 'green']] },
      { day: 'Friday', items: [['Demo and wins of the week', 'blue'], ['Plan next week', 'yellow'], ['Dinner with friends', 'green']] },
    ];
    days.forEach((d, i) => {
      const x = 48 + i * (colW + gap);
      k.panel(x, daysY, colW, dayH, TINT.gray);
      k.shape('roundRect', x + 12, daysY + 12, colW - 24, 48, `<b>${rt(d.day)}</b>`, { fill: HEAD.gray, fontSize: 18 });
      d.items.forEach(([t, c], j) => k.sticky(x + 16, daysY + 76 + j * 136, t, c, colW - 32, 120));
    });
    return k.els;
  },
};

export const meetingNotes: TemplateDef = {
  id: 'meeting-notes',
  name: 'Meeting notes',
  description: 'Agenda, running notes, decisions and action items with owners in one place.',
  categories: ['meetings'],
  keywords: ['meeting', 'notes', 'agenda', 'minutes', 'decisions', 'actions', 'sync'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1400;
    const leftW = 640;
    const rightX = 48 + leftW + 24;
    const rightW = W - 48 - rightX;
    const topY = 168;
    const topH = 300;
    const botY = topY + topH + 24;
    const botH = 420;
    const H = botY + botH + 48;
    k.frame('Meeting notes', W, H);
    k.text(48, 40, W - 96, '<b>Meeting notes</b>', { size: 32, h: 46 });
    k.text(48, 92, W - 96, rt('Date: ___   ·   Facilitator: ___   ·   Note-taker: ___   ·   Attendees: ___'), { size: 16, color: INK_SOFT, h: 26 });

    const section = (x: number, y: number, w: number, h: number, title: string, tint: string, accent: string) => {
      k.panel(x, y, w, h, tint);
      k.text(x + 24, y + 20, w - 48, `<b>${rt(title)}</b>`, { size: 22, color: accent, h: 32 });
    };
    section(48, topY, leftW, topH, 'Agenda', TINT.violet, VIOLET);
    k.text(
      72,
      topY + 64,
      leftW - 48,
      list(['Welcome and goal of the meeting (5 min)', 'Updates since last time (10 min)', 'Main topic: choose the launch date (25 min)', 'Recap decisions and owners (5 min)'], true),
      { size: 20, h: 200 },
    );

    section(48, botY, leftW, botH, 'Notes', TINT.gray, INK_SOFT);
    k.text(
      72,
      botY + 64,
      leftW - 48,
      list(['Launch depends on the billing migration finishing first', 'Support needs two weeks to update help articles', 'Marketing can move the webinar if needed', 'Type your notes here…']),
      { size: 20, h: 220 },
    );

    section(rightX, topY, rightW, topH, 'Decisions', TINT.mint, MINT);
    ['Launch on June 12', 'Beta stays open until launch', 'Check in every Tuesday'].forEach((d, i) =>
      k.sticky(rightX + 24 + i * ((rightW - 48 - 32) / 3 + 16), topY + 80, d, 'green', (rightW - 48 - 32) / 3, 176),
    );

    section(rightX, botY, rightW, botH, 'Action items', TINT.amber, AMBER);
    const actions: Array<[string, string, string]> = [
      ['Confirm billing migration date', 'Owner: Priya · Due: Wednesday', AMBER],
      ['Update help center articles', 'Owner: Jonas · Due: June 5', SKY],
      ['Send the recap to stakeholders', 'Owner: you · Due: today', MINT],
    ];
    actions.forEach(([t, d, c], i) => k.card(rightX + 24, botY + 72 + i * 108, rightW - 48, 96, t, d, c, 'todo'));
    return k.els;
  },
};

export const flowchart: TemplateDef = {
  id: 'flowchart',
  name: 'Flowchart starter',
  description: 'A support-request flow with a decision, two branches and connected steps.',
  categories: ['diagramming'],
  keywords: ['flowchart', 'flow', 'process', 'diagram', 'decision', 'workflow', 'connectors'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1760;
    const H = 860;
    k.frame('Flowchart', W, H);
    k.header('Flowchart starter', 'Rename the steps to match your process. Diamonds are decisions: label every arrow that leaves one.', W);
    const midY = 500;
    const step = { fill: TINT.violet, stroke: VIOLET, strokeWidth: 2, fontSize: 18 };
    const start = k.shape('ellipse', 56, midY - 50, 210, 100, '<b>Start</b><br>Request arrives', { fill: TINT.mint, stroke: MINT, strokeWidth: 2, fontSize: 17 });
    const triage = k.shape('roundRect', 330, midY - 55, 230, 110, 'Triage the request', step);
    const decide = k.shape('diamond', 624, midY - 90, 240, 180, '<b>Urgent?</b>', { fill: TINT.amber, stroke: AMBER, strokeWidth: 2, fontSize: 20 });
    const urgent = k.shape('roundRect', 940, midY - 245, 240, 110, 'Page the on-call engineer', step);
    const queue = k.shape('roundRect', 940, midY + 135, 240, 110, 'Add to the weekly queue', step);
    const resolve = k.shape('roundRect', 1250, midY - 55, 230, 110, 'Resolve and reply to the customer', step);
    const end = k.shape('ellipse', 1530, midY - 50, 180, 100, '<b>End</b>', { fill: TINT.mint, stroke: MINT, strokeWidth: 2, fontSize: 17 });
    k.connector({ id: start, anchor: 'right' }, { id: triage, anchor: 'left' }, { routing: 'straight' });
    k.connector({ id: triage, anchor: 'right' }, { id: decide, anchor: 'left' }, { routing: 'straight' });
    k.connector({ id: decide, anchor: 'top' }, { id: urgent, anchor: 'left' }, { label: 'Yes' });
    k.connector({ id: decide, anchor: 'bottom' }, { id: queue, anchor: 'left' }, { label: 'No' });
    k.connector({ id: urgent, anchor: 'right' }, { id: resolve, anchor: 'top' });
    k.connector({ id: queue, anchor: 'right' }, { id: resolve, anchor: 'bottom' });
    k.connector({ id: resolve, anchor: 'right' }, { id: end, anchor: 'left' }, { routing: 'straight' });
    k.sticky(56, H - 200, 'Tip: add a swimlane per team if more than one team touches the request.', 'yellow', 220, 150);
    return k.els;
  },
};
