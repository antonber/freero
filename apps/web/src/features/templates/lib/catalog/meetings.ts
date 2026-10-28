// Meetings & workshops: 1:1, decision log, workshop agenda, project kickoff, lean coffee,
// eight-sketch ideation.
import type { StickyColor } from '@freero/shared';
import { Kit, list, rt } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, MINT, ROSE, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const oneOnOne: TemplateDef = {
  id: 'one-on-one',
  name: '1:1 meeting',
  description: 'A shared space for a recurring 1:1: check-in, both people’s topics, feedback, growth, actions.',
  categories: ['meetings'],
  keywords: ['1:1', 'one on one', '1-on-1', 'manager', 'check-in', 'feedback', 'career', 'coaching'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1560;
    const colW = (W - 96 - 48) / 3;
    const rowH = 340;
    const row2 = 160 + rowH + 24;
    k.frame('1:1 meeting', W, row2 + rowH + 48);
    k.header('1:1 meeting', 'Their topics come first. Keep this board for every 1:1 so commitments and growth stay visible over time.', W);
    const col = (i: number) => 48 + i * (colW + 24);
    const half = (colW - 48 - 16) / 2;

    let y = k.section(col(0), 160, colW, rowH, 'Check-in', TINT.amber, { accent: AMBER, hint: 'How are you, really? Stamp one.' });
    ['😄', '🙂', '😐', '😕', '😫'].forEach((e, i) => k.emoji(col(0) + 24 + i * 84, y, 64, e));
    k.text(col(0) + 24, y + 96, colW - 48, rt('Energy this week: __ / 10\nOne word for the week: ___'), { size: 19, h: 60 });

    y = k.section(col(1), 160, colW, rowH, 'Their topics', TINT.violet, { accent: VIOLET, hint: 'Added before the meeting.' });
    k.stickies(col(1) + 24, y, colW - 48, ['Feeling stretched across two projects', 'Add a topic…'], 'violet', half);

    y = k.section(col(2), 160, colW, rowH, 'My topics', TINT.sky, { accent: SKY, hint: 'Updates and questions from me.' });
    k.stickies(col(2) + 24, y, colW - 48, ['Team offsite in May: ideas?', 'Add a topic…'], 'blue', half);

    y = k.section(col(0), row2, colW, rowH, 'Feedback, both ways', TINT.mint, { accent: MINT, hint: 'One thing to keep, one thing to try.' });
    k.stickies(col(0) + 24, y, colW - 48, ['Keep: your release notes are clear and short', 'Try: share drafts earlier'], 'green', half);

    y = k.section(col(1), row2, colW, rowH, 'Growth', TINT.rose, { accent: ROSE, hint: 'Where do you want to be in a year?' });
    k.text(col(1) + 24, y, colW - 48, list(['Lead a project from start to finish', 'Present at the next all-hands', 'Learn the basics of data analysis']), { size: 20, h: rowH - (y - row2) - 24 });

    y = k.section(col(2), row2, colW, rowH, 'Action items', TINT.gray, { hint: 'Who does what by when.' });
    const actions: Array<[string, string, string]> = [
      ['Share the project split proposal', 'Owner: manager · Friday', VIOLET],
      ['Draft the all-hands talk outline', 'Owner: you · next 1:1', ROSE],
    ];
    actions.forEach(([t, d, c], i) => k.card(col(2) + 24, y + i * 108, colW - 48, 96, t, d, c, 'todo'));
    return k.done();
  },
};

export const decisionLog: TemplateDef = {
  id: 'decision-log',
  name: 'Decision log',
  description: 'A running table of decisions: what, why, who decided and when to revisit it.',
  categories: ['meetings', 'planning'],
  keywords: ['decision log', 'decisions', 'adr', 'record', 'governance', 'table', 'rationale'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [140, 330, 420, 160, 150];
    const W = 96 + cols.reduce((a, b) => a + b, 0);
    const rows = [
      { h: 44, cells: ['Date', 'Decision', 'Why (options we weighed)', 'Decided by', 'Status'] },
      { h: 84, cells: ['Mar 3', 'Launch in Europe before the US', 'Most beta teams are in Europe; US needs a new billing provider first', 'Leadership team', 'Decided'] },
      { h: 84, cells: ['Mar 10', 'One pricing plan for the beta', 'Three plans confused testers; we can split later', 'Product', 'Decided'] },
      { h: 84, cells: ['Mar 17', 'Drop the desktop app for now', 'Web covers 95% of use; one team can’t maintain both', 'Engineering', 'Revisit in Q3'] },
      { h: 84, cells: ['Mar 24', 'Weekly release train on Tuesdays', 'Fewer surprises for support; still fast', 'Engineering + Support', 'Trying'] },
      { h: 84, cells: ['', 'Add a decision…', '', '', 'Proposed'] },
    ];
    const tableH = rows.reduce((a, r) => a + r.h, 0);
    const openY = 160 + tableH + 24;
    k.frame('Decision log', W, openY + 260 + 48);
    k.header('Decision log', 'Write a decision down the day it’s made, with the reason. Future you will want to know why, not just what.', W);
    k.table(48, 160, cols, rows);
    const y = k.section(48, openY, W - 96, 260, 'Open questions', TINT.amber, { accent: AMBER, hint: 'Waiting for a decision. Who decides, and by when?' });
    k.stickies(72, y, W - 144, ['Do we offer a free plan at launch?', 'Who owns the help center?', 'Add a question…'], 'yellow');
    return k.done();
  },
};

export const workshopAgenda: TemplateDef = {
  id: 'workshop-agenda',
  name: 'Workshop agenda',
  description: 'A timed agenda with methods and owners, the goals, a parking lot and a check-out.',
  categories: ['meetings', 'brainstorm'],
  keywords: ['workshop', 'agenda', 'facilitation', 'session plan', 'offsite', 'parking lot', 'check-out', 'timebox'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [130, 300, 340, 150];
    const tableW = cols.reduce((a, b) => a + b, 0);
    const rows = [
      { h: 44, cells: ['Time', 'Session', 'How', 'Who'] },
      { h: 64, cells: ['09:30', 'Welcome and check-in', 'One word each on how you arrive', 'Facilitator'] },
      { h: 64, cells: ['09:45', 'Why we’re here', 'Goals, agenda, ground rules', 'Sponsor'] },
      { h: 64, cells: ['10:00', 'Ideas', 'Ten minutes of silent writing, then share', 'Everyone'] },
      { h: 64, cells: ['10:30', 'Break', '', ''] },
      { h: 64, cells: ['10:45', 'Choose', 'Group the ideas, then dot-vote', 'Everyone'] },
      { h: 64, cells: ['11:30', 'Next steps', 'Owner and date for each action', 'Facilitator'] },
      { h: 64, cells: ['11:55', 'Check-out', 'One thing you’ll take away', 'Everyone'] },
    ];
    const tableH = rows.reduce((a, r) => a + r.h, 0);
    const sideX = 48 + tableW + 24;
    const sideW = 420;
    const W = sideX + sideW + 48;
    const goalsH = 250;
    const parkY = 160 + goalsH + 24;
    const parkH = 300;
    const outY = Math.max(parkY + parkH, 160 + tableH) + 24;
    k.frame('Workshop agenda', W, outY + 260 + 48);
    k.header('Workshop agenda', 'Timebox every session and say the time out loud. Anything off-topic goes to the parking lot, not into the next session.', W);
    k.table(48, 160, cols, rows);

    let y = k.section(sideX, 160, sideW, goalsH, 'Goals for today', TINT.violet, { accent: VIOLET });
    k.text(sideX + 24, y, sideW - 48, list(['Agree on the top three customer problems', 'Pick one to prototype next month', 'Leave with owners and dates'], true), { size: 20, h: goalsH - (y - 160) - 20 });

    y = k.section(sideX, parkY, sideW, parkH, 'Parking lot', TINT.amber, { accent: AMBER, hint: 'Important, but not for today.' });
    k.stickies(sideX + 24, y, sideW - 48, ['Budget for the pilot', 'Add a topic…'], 'yellow', (sideW - 48 - 16) / 2);

    y = k.section(48, outY, W - 96, 260, 'Check-out', TINT.mint, { accent: MINT, hint: 'Before you leave: one word for how you feel, and one thing you’ll do next.' });
    k.stickies(72, y, W - 144, ['Energized', 'Curious', 'Add yours…'], 'green');
    return k.done();
  },
};

export const kickoff: TemplateDef = {
  id: 'project-kickoff',
  name: 'Project kickoff',
  description: 'Why, goals, how you’ll measure success, scope, roles and milestones on one board.',
  categories: ['meetings', 'planning'],
  keywords: ['kickoff', 'kick-off', 'project', 'charter', 'scope', 'roles', 'raci', 'milestones', 'launch'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1680;
    const colW = (W - 96 - 48) / 3;
    const rowH = 300;
    const row2 = 160 + rowH + 24;
    const row3 = row2 + rowH + 24;
    const msH = 180;
    k.frame('Project kickoff', W, row3 + msH + 48);
    k.header('Project kickoff', 'Fill this in together in the first meeting. If people disagree on the why or the scope, that’s the most useful hour of the project.', W);
    const col = (i: number) => 48 + i * (colW + 24);

    let y = k.section(col(0), 160, colW, rowH, 'Why we’re doing this', TINT.violet, { accent: VIOLET, hint: 'The problem, in one or two sentences.' });
    k.sticky(col(0) + 24, y, 'New customers give up before they see value: 40% never finish setting up.', 'violet', colW - 48, 160);

    y = k.section(col(1), 160, colW, rowH, 'Goals', TINT.mint, { accent: MINT, hint: 'What will be true when we’re done?' });
    k.sticky(col(1) + 24, y, 'Setup takes under 5 minutes', 'green', (colW - 48 - 16) / 2, 170);
    k.sticky(col(1) + 24 + (colW - 48 - 16) / 2 + 16, y, 'Support tickets about setup halve', 'green', (colW - 48 - 16) / 2, 170);

    y = k.section(col(2), 160, colW, rowH, 'How we’ll measure it', TINT.sky, { accent: SKY, hint: 'Numbers we check every week.' });
    k.text(col(2) + 24, y, colW - 48, list(['Setup completion: 60% → 85%', 'Median setup time: 14 → 5 min', 'Setup tickets per week: 80 → 40']), { size: 20, h: rowH - (y - 160) - 20 });

    y = k.section(col(0), row2, colW, rowH, 'In scope', TINT.mint, { accent: MINT });
    k.stickies(col(0) + 24, y, colW - 48, ['New setup checklist', 'Sample board on signup'], 'green', (colW - 48 - 16) / 2);

    y = k.section(col(1), row2, colW, rowH, 'Out of scope', TINT.coral, { accent: CORAL });
    k.stickies(col(1) + 24, y, colW - 48, ['Pricing changes', 'Mobile apps'], 'coral', (colW - 48 - 16) / 2);

    y = k.section(col(2), row2, colW, rowH, 'Team & roles', TINT.gray);
    k.table(col(2) + 24, y, [180, colW - 48 - 180], [
      { h: 36, cells: ['Role', 'Name'] },
      { h: 36, cells: ['Sponsor', 'Hana'] },
      { h: 36, cells: ['Project lead', 'Mei'] },
      { h: 36, cells: ['Design', 'Leo'] },
      { h: 36, cells: ['Engineering', 'Ines, Sven'] },
    ]);

    y = k.section(48, row3, W - 96, msH, 'Milestones', TINT.amber, { accent: AMBER });
    const ms: Array<[string, string]> = [['Kickoff', 'Week 1'], ['Research done', 'Week 3'], ['Prototype tested', 'Week 6'], ['Beta', 'Week 9'], ['Launch', 'Week 12']];
    const msW = (W - 144 - 4 * 12) / 5;
    ms.forEach(([t, d], i) => k.shape('chevron', 72 + i * (msW + 12), y, msW, 96, `<b>${rt(t)}</b><br>${rt(d)}`, { fill: i % 2 ? HEAD.amber : '#FFFFFF', fontSize: 19 }));
    return k.done();
  },
};

export const leanCoffee: TemplateDef = {
  id: 'lean-coffee',
  name: 'Lean coffee',
  description: 'An agenda-less meeting: propose topics, vote, and talk through them in timeboxes.',
  categories: ['meetings', 'brainstorm'],
  keywords: ['lean coffee', 'agenda-less', 'discussion', 'topics', 'dot voting', 'timebox', 'meetup', 'unconference'],
  build(newId) {
    const k = new Kit(newId);
    const howW = 300;
    const colW = 372;
    const x0 = 48 + howW + 24;
    const W = x0 + 3 * colW + 2 * 24 + 48;
    const colH = 460;
    const endY = 160 + colH + 24;
    k.frame('Lean coffee', W, endY + 200 + 48);
    k.header('Lean coffee', 'Everyone adds topics and gets three votes. Talk about the top topic for 8 minutes, then thumbs up to continue or move on.', W);

    let y = k.section(48, 160, howW, colH, 'How it works', TINT.gray);
    k.text(72, y, howW - 48, list(['Add topics, one per sticky (5 min)', 'Everyone draws three dots on the topics they like', 'Sort To discuss by votes', 'Talk for 8 minutes, then vote: continue or next', 'Move finished topics to Done and write a takeaway'], true), { size: 18, h: colH - (y - 160) - 24 });

    const half = (colW - 48 - 12) / 2;
    const cols: Array<{ title: string; hint: string; tint: string; accent: string; color: StickyColor; notes: string[] }> = [
      { title: 'To discuss', hint: 'Most dots on top.', tint: TINT.amber, accent: AMBER, color: 'yellow', notes: ['Sharing knowledge across teams\n● ● ● ●', 'Fewer meetings, same alignment?\n● ● ●', 'Onboarding buddies\n● ●', 'Add a topic…'] },
      { title: 'Discussing', hint: 'One topic at a time.', tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['Sharing knowledge across teams'] },
      { title: 'Done', hint: 'With a one-line takeaway.', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Remote-friendly demos\nTakeaway: record them'] },
    ];
    cols.forEach((c, i) => {
      const x = x0 + i * (colW + 24);
      y = k.section(x, 160, colW, colH, c.title, c.tint, { accent: c.accent, hint: c.hint, size: 24 });
      if (i === 1) {
        k.sticky(x + 24, y, c.notes[0], c.color, colW - 48, 200);
        k.text(x + 24, y + 224, colW - 48, rt('⏱ 8 minutes, then 👍 continue or 👎 next topic'), { size: 18, color: INK_SOFT, h: 52 });
      } else {
        k.stickies(x + 24, y, colW - 48, c.notes, c.color, half, 12);
      }
    });

    y = k.section(48, endY, W - 96, 200, 'Takeaways', TINT.sky, { accent: SKY, hint: 'What we learned and who follows up.' });
    ['Record every demo and post it in the team channel', 'Mei drafts an onboarding buddy guide', 'Add a takeaway…'].forEach((t, i) => k.sticky(72 + i * 316, y, t, 'blue', 300, 84));
    return k.done();
  },
};

export const eightSketches: TemplateDef = {
  id: 'eight-sketches',
  name: 'Eight sketches',
  description: 'Fold one problem into eight fast sketches, one minute each, then pick the strongest.',
  categories: ['brainstorm', 'meetings'],
  keywords: ['sketching', 'ideation', 'design sprint', 'rapid', 'ideas', 'drawing', 'divergent', 'workshop'],
  build(newId) {
    const k = new Kit(newId);
    const boxW = 300;
    const boxH = 260;
    const leftW = 300;
    const x0 = 48 + leftW + 24;
    const W = x0 + 4 * boxW + 3 * 16 + 48;
    const gridH = 2 * boxH + 16;
    k.frame('Eight sketches', W, 160 + gridH + 48);
    k.header('Eight sketches', 'Set a timer for one minute per box. Draw with the pen tool, rough and fast: quantity first. Then star your favorite.', W);
    const y = k.section(48, 160, leftW, gridH, 'The problem', TINT.violet, { accent: VIOLET, hint: 'What are we sketching for?' });
    k.sticky(72, y, 'How might new teammates find the right document on their first day?', 'violet', leftW - 48, 200);
    k.text(72, y + 224, leftW - 48, rt('Tip: no words in the boxes except labels. Ugly is fine.'), { size: 15, color: INK_SOFT, h: 48 });
    for (let i = 0; i < 8; i++) {
      const x = x0 + (i % 4) * (boxW + 16);
      const by = 160 + Math.floor(i / 4) * (boxH + 16);
      k.shape('roundRect', x, by, boxW, boxH, `<b>${i + 1}</b>`, { fill: '#FFFFFF', stroke: i % 2 ? HEAD.violet : '#C9BEFF', strokeWidth: 2, strokeStyle: 'dashed', fontSize: 18, align: 'left', vAlign: 'top', textColor: INK_SOFT });
    }
    return k.done();
  },
};
