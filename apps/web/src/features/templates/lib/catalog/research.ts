// Research & UX: affinity map, empathy map, persona, interview notes.
import type { StickyColor } from '@freero/shared';
import { Kit, list, rt } from '../kit';
import { AMBER, CORAL, HEAD, INK, INK_SOFT, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const affinityMap: TemplateDef = {
  id: 'affinity-map',
  name: 'Affinity map',
  description: 'Turn a pile of research notes into themes, with one insight written under each.',
  categories: ['research', 'brainstorm'],
  keywords: ['affinity', 'clustering', 'synthesis', 'research', 'themes', 'insights', 'user research', 'grouping'],
  build(newId) {
    const k = new Kit(newId);
    const pileW = 492;
    const clusterW = 368;
    const x0 = 48 + pileW + 24;
    const W = x0 + 3 * clusterW + 2 * 24 + 48;
    const y0 = 160;
    const h = 640;
    k.frame('Affinity map', W, y0 + h + 48);
    k.header('Affinity map', 'Move notes from the pile into groups that feel alike, without naming them first. Name each group last, then write what it means.', W);

    const y = k.section(48, y0, pileW, h, 'Raw notes', TINT.gray, { hint: 'One observation per sticky, from any interview.' });
    k.stickies(72, y, pileW - 48, [
      '“I copy the board into slides every Friday”',
      'Skipped the tutorial',
      '“Where did my sticky go?”',
      'Uses it on a tablet in meetings',
      '“Exports look blurry”',
      'Invited the whole team on day one',
      '“Too many buttons at first”',
      'Prints boards for workshops',
      'Add a note…',
    ], 'yellow', 140, 12);

    const clusters: Array<{ theme: string; head: string; tint: string; color: StickyColor; notes: string[]; insight: string }> = [
      { theme: 'Sharing outside the board', head: HEAD.sky, tint: TINT.sky, color: 'blue', notes: ['Copies boards into slides', 'Prints for workshops', 'Exports look blurry'], insight: 'People finish their work somewhere else. Export quality decides whether they come back.' },
      { theme: 'First steps feel busy', head: HEAD.coral, tint: TINT.coral, color: 'coral', notes: ['Skipped the tutorial', 'Too many buttons at first', 'Lost a sticky off-screen'], insight: 'A calmer first board matters more than a better tutorial.' },
      { theme: 'Teams, not individuals', head: HEAD.mint, tint: TINT.mint, color: 'green', notes: ['Invited the team on day one', 'Used on a tablet in meetings'], insight: 'Adoption starts in a meeting room, so the first session must work for a group.' },
    ];
    clusters.forEach((c, i) => {
      const x = x0 + i * (clusterW + 24);
      k.panel(x, y0, clusterW, h, c.tint);
      k.shape('roundRect', x + 16, y0 + 16, clusterW - 32, 56, `<b>${rt(c.theme)}</b>`, { fill: c.head, fontSize: 18 });
      k.stickies(x + 16, y0 + 88, clusterW - 32, c.notes, c.color, 160);
      k.shape('roundRect', x + 16, y0 + h - 16 - 168, clusterW - 32, 168, `<b>Insight</b><br>${rt(c.insight)}`, { fill: '#FFFFFF', fontSize: 18, align: 'left', vAlign: 'top' });
    });
    return k.done();
  },
};

export const empathyMap: TemplateDef = {
  id: 'empathy-map',
  name: 'Empathy map',
  description: 'What one person says, thinks, does and feels, with their pains and gains below.',
  categories: ['research'],
  keywords: ['empathy map', 'persona', 'user', 'says thinks does feels', 'pains', 'gains', 'ux', 'design thinking'],
  build(newId) {
    const k = new Kit(newId);
    const qW = 560;
    const qH = 360;
    const W = 96 + 2 * qW + 24;
    const gridH = 2 * qH + 24;
    const bottomY = 160 + gridH + 24;
    const bottomH = 260;
    k.frame('Empathy map', W, bottomY + bottomH + 48);
    k.header('Empathy map', 'Fill it from real research for one person, not an average user. Quote their words in Says; guess carefully in Thinks.', W);
    const quads: Array<{ title: string; hint: string; tint: string; accent: string; color: StickyColor; notes: string[]; right: boolean; bottom: boolean }> = [
      { title: 'Says', hint: 'Words they used', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['“I just need it to look clean for clients”', '“Setting up takes forever”'], right: false, bottom: false },
      { title: 'Thinks', hint: 'What they may not say out loud', tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['Am I using this the right way?', 'My team won’t switch tools again'], right: true, bottom: false },
      { title: 'Does', hint: 'What we saw them do', tint: TINT.amber, accent: AMBER, color: 'orange', notes: ['Rebuilds the same board weekly', 'Screenshots boards for email'], right: false, bottom: true },
      { title: 'Feels', hint: 'Their mood and worries', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Rushed before client calls', 'Proud when the board looks great'], right: true, bottom: true },
    ];
    const note = 150;
    quads.forEach((q, i) => {
      const x = 48 + (i % 2) * (qW + 24);
      const y = 160 + Math.floor(i / 2) * (qH + 24);
      k.panel(x, y, qW, qH, q.tint);
      // Titles and notes sit in the outer corner, clear of the person in the middle.
      const tx = q.right ? x + qW - 24 - 300 : x + 24;
      const ty = q.bottom ? y + qH - 24 - note - 70 : y + 20;
      k.text(tx, ty, 300, `<b>${rt(q.title)}</b>`, { size: 24, color: q.accent, h: 34, align: q.right ? 'right' : 'left' });
      k.text(tx, ty + 36, 300, rt(q.hint), { size: 14, color: INK_SOFT, h: 22, align: q.right ? 'right' : 'left' });
      const nx = q.right ? x + qW - 24 - 2 * note - 16 : x + 24;
      q.notes.forEach((n, j) => k.sticky(nx + j * (note + 16), ty + 70, n, q.color, note));
    });
    const d = 260;
    k.shape('ellipse', 48 + qW + 12 - d / 2, 160 + gridH / 2 - d / 2, d, d, '<b>Maya</b><br>Freelance designer, 34', { fill: VIOLET, textColor: '#FFFFFF', fontSize: 20, stroke: '#FFFFFF', strokeWidth: 8 });

    const sides: Array<{ title: string; hint: string; tint: string; accent: string; color: StickyColor; notes: string[] }> = [
      { title: 'Pains', hint: 'Fears, frustrations, obstacles', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Clients see messy work', 'Too much setup', 'Add a pain…'] },
      { title: 'Gains', hint: 'What success looks like for them', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Looks professional fast', 'Reuses past work', 'Add a gain…'] },
    ];
    sides.forEach((s, i) => {
      const x = 48 + i * (qW + 24);
      const y = k.section(x, bottomY, qW, bottomH, s.title, s.tint, { accent: s.accent, hint: s.hint });
      k.stickies(x + 24, y, qW - 48, s.notes, s.color, note);
    });
    return k.done();
  },
};

export const persona: TemplateDef = {
  id: 'persona',
  name: 'User persona',
  description: 'A research-based profile: who they are, goals, frustrations, habits and tools.',
  categories: ['research'],
  keywords: ['persona', 'user', 'customer profile', 'audience', 'ux', 'marketing', 'archetype'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1500;
    const leftW = 420;
    const leftH = 680;
    const H = 160 + leftH + 48;
    k.frame('User persona', W, H);
    k.header('User persona', 'Base every line on something you heard or saw in research. If you can’t point to the source, mark it as a guess.', W);

    k.panel(48, 160, leftW, leftH, TINT.violet);
    const cx = 48 + leftW / 2;
    k.shape('ellipse', cx - 80, 192, 160, 160, '', { fill: HEAD.violet });
    k.emoji(cx - 48, 224, 96, '🧑');
    k.text(72, 372, leftW - 48, '<b>Jonas Weber</b>', { size: 28, align: 'center', h: 40 });
    k.text(72, 414, leftW - 48, rt('Operations lead · 41 · Rotterdam'), { size: 16, color: INK_SOFT, align: 'center', h: 24 });
    k.shape('roundRect', 72, 462, leftW - 48, 132, '“I don’t need more tools. I need fewer tabs open.”', { fill: '#FFFFFF', fontSize: 19, textColor: VIOLET });
    k.text(72, 622, leftW - 48, '<b>About</b>', { size: 18, h: 28 });
    k.text(72, 654, leftW - 48, rt('Runs a team of twelve across two time zones. Plans the week on Sunday evening and lives in his calendar. Moved the team off email last year and won’t switch again lightly.'), { size: 16, color: INK, h: 140 });

    const x0 = 48 + leftW + 24;
    const sW = (W - 48 - x0 - 24) / 2;
    const sH = (leftH - 24) / 2;
    const sections: Array<{ title: string; tint: string; accent: string; items: string[] }> = [
      { title: 'Goals', tint: TINT.mint, accent: MINT, items: ['Everyone knows the plan without asking', 'Fewer status meetings', 'Spot problems before customers do', 'Leave work at 6 pm'] },
      { title: 'Frustrations', tint: TINT.coral, accent: CORAL, items: ['Updates scattered across five tools', 'Decisions get lost in chat', 'New hires take weeks to find things', 'Tools that need training'] },
      { title: 'Habits', tint: TINT.sky, accent: SKY, items: ['Checks the team board first thing', 'Prefers short written updates', 'Prints the weekly plan', 'Tries new tools only on recommendation'] },
      { title: 'Tools today', tint: TINT.amber, accent: AMBER, items: ['Shared calendar', 'Team chat', 'Spreadsheets for planning', 'Video calls, cameras off'] },
    ];
    sections.forEach((s, i) => {
      const x = x0 + (i % 2) * (sW + 24);
      const y = 160 + Math.floor(i / 2) * (sH + 24);
      const top = k.section(x, y, sW, sH, s.title, s.tint, { accent: s.accent });
      k.text(x + 24, top, sW - 48, list(s.items), { size: 20, h: sH - (top - y) - 24 });
    });
    return k.done();
  },
};

export const interviewNotes: TemplateDef = {
  id: 'interview-notes',
  name: 'User interview notes',
  description: 'Interview guide, color-coded notes and the key takeaways from one conversation.',
  categories: ['research', 'meetings'],
  keywords: ['interview', 'user interview', 'customer interview', 'research', 'notes', 'discovery', 'usability', 'questions'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1640;
    const cols = [240, 300, 200, 240, 300];
    const infoW = cols.reduce((a, b) => a + b, 0);
    const midY = 296;
    const midH = 480;
    const endY = midY + midH + 24;
    k.frame('User interview notes', W, endY + 230 + 48);
    k.header('User interview notes', 'Ask about the last time it happened, not what they would do. Note their exact words; sort the notes right after the call.', W);
    k.table(48, 160, cols, [
      { h: 40, cells: ['Participant', 'Role and company', 'Date', 'Interviewer', 'Recording link'] },
      { h: 48, cells: ['P4 · Lea', 'Teacher, secondary school', '', '', ''] },
    ]);
    const legX = 48 + infoW + 24;
    k.text(legX, 160, W - 48 - legX, `<b>Sticky colors</b><br>${rt('Yellow: what they said\nBlue: what they did\nCoral: a pain point\nGreen: an idea')}`, { size: 15, h: 116 });

    let y = k.section(48, midY, 480, midH, 'Interview guide', TINT.sky, { accent: SKY, hint: 'Open questions. Follow the energy.' });
    k.text(72, y, 432, list([
      'Tell me about your role and a typical week.',
      'When did you last plan a lesson together with colleagues?',
      'Walk me through how that went, step by step.',
      'What was the hardest part?',
      'What did you use? What did you try before?',
      'If you had a magic wand, what would change?',
      'Is there anything I should have asked?',
    ], true), { size: 18, h: midH - (y - midY) - 24 });

    const nx = 48 + 480 + 24;
    const nW = W - 48 - nx;
    y = k.section(nx, midY, nW, midH, 'Notes', TINT.gray, { hint: 'One idea per sticky, in their words where you can.' });
    const notes: Array<[string, StickyColor]> = [
      ['“We plan in a shared doc nobody can find later”', 'yellow'],
      ['Opened three tabs to find last year’s plan', 'blue'],
      ['Planning time is squeezed into lunch breaks', 'coral'],
      ['“I’d love to start from what my colleague did”', 'yellow'],
      ['Shares a template with the whole department?', 'green'],
      ['Prints the plan and writes on it in class', 'blue'],
      ['Can’t see who changed what', 'coral'],
      ['“Students should add their own questions”', 'yellow'],
      ['Add a note…', 'gray'],
    ];
    const per = 5;
    notes.forEach(([t, c], i) => k.sticky(nx + 24 + (i % per) * 176, y + Math.floor(i / per) * 176, t, c));

    y = k.section(48, endY, W - 96, 230, 'Key takeaways', TINT.mint, { accent: MINT, hint: 'The three things to tell the team.' });
    ['Lesson plans are hard to find and reuse', 'Planning happens in short, scattered moments', 'Teachers want students to contribute'].forEach((t, i) =>
      k.sticky(72 + i * 316, y, t, 'green', 300, 104),
    );
    return k.done();
  },
};

export const serviceBlueprint: TemplateDef = {
  id: 'service-blueprint',
  name: 'Service blueprint',
  description: 'What the customer does, what they see, what happens behind the scenes and the systems that support it.',
  categories: ['research', 'strategy'],
  keywords: ['service blueprint', 'service design', 'frontstage', 'backstage', 'customer experience', 'cx', 'touchpoints', 'swimlane', 'line of visibility'],
  build(newId) {
    const k = new Kit(newId);
    const phaseW = 300;
    const laneH = 180;
    const note = 130;
    const phases = ['Discover', 'Book', 'Drop off', 'Repair', 'Pick up'];
    const lanes: Array<{ title: string; color: string; sticky: StickyColor; cells: string[][] }> = [
      { title: 'Customer actions', color: HEAD.sky, sticky: 'blue', cells: [['Searches for a repair shop nearby'], ['Picks a time online'], ['Brings the bike in'], ['Approves the quote'], ['Pays and rides away']] },
      { title: 'Frontstage', color: HEAD.violet, sticky: 'violet', cells: [['Map listing with reviews'], ['Booking page', 'Text to confirm'], ['Mechanic checks the bike with them'], ['Quote by text, one-tap OK'], ['Shows what was fixed']] },
      { title: 'Backstage', color: HEAD.amber, sticky: 'yellow', cells: [[], ['Calendar blocks a mechanic'], ['Tag the bike, log issues'], ['Order parts', 'Repair and test ride'], ['Clean the bike']] },
      { title: 'Support systems', color: HEAD.gray, sticky: 'gray', cells: [['Maps listing'], ['Booking tool'], ['Shop app'], ['Parts supplier portal'], ['Card reader, receipts']] },
    ];
    const W = 48 + 150 + phases.length * phaseW + 48;
    const poolH = 44 + 36 + lanes.length * laneH;
    k.frame('Service blueprint', W, 160 + poolH + 48);
    k.header('Service blueprint: bike repair', 'Read it top to bottom per step. Everything below the line of visibility is invisible to customers but shapes what they feel.', W);
    const p = k.swimlane(48, 160, 'Bike repair visit', lanes.map((l) => ({ title: l.title, size: laneH, color: l.color })), phases.map((t) => ({ title: t, size: phaseW, color: HEAD.mint })));
    k.within(p.id, () =>
      lanes.forEach((l, i) =>
        l.cells.forEach((cell, j) => {
          const { x } = p.phase(j);
          const { y, h } = p.lane(i);
          cell.forEach((t, n) => k.sticky(x + 14 + n * (note + 12), y + (h - note) / 2, t, l.sticky, note));
        }),
      ),
    );
    const across = (y: number, label: string) =>
      k.connector({ x: p.phase(0).x, y }, { x: 48 + p.w, y }, { routing: 'straight', strokeStyle: 'dashed', stroke: INK_SOFT, endCap: 'none', label });
    across(p.lane(1).y, 'line of interaction');
    across(p.lane(2).y, 'line of visibility');
    return k.done();
  },
};
