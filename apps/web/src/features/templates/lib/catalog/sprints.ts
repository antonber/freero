// More agile rituals: sprint planning, standup, retro variants, quarter planning, sizing.
import type { StickyColor } from '@freero/shared';
import { Kit, rt } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const sprintPlanning: TemplateDef = {
  id: 'sprint-planning',
  name: 'Sprint planning',
  description: 'Sprint goal, team capacity, the ready backlog, what you commit to, and the risks.',
  categories: ['agile', 'planning'],
  keywords: ['sprint', 'planning', 'scrum', 'capacity', 'backlog', 'commitment', 'iteration', 'goal'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1680;
    const topH = 260;
    const y1 = 160 + topH + 24;
    const colW = 512;
    const colH = 600;
    k.frame('Sprint planning', W, y1 + colH + 48);
    k.header('Sprint planning', 'Agree on the goal first, check how many days people really have, then pull work from the top of the backlog until it’s full.', W);

    let y = k.section(48, 160, 900, topH, 'Sprint goal', TINT.violet, { accent: VIOLET, hint: 'One sentence the whole team can repeat by heart.' });
    k.shape('roundRect', 72, y, 852, 100, 'Customers can export any board as a PDF they would happily send to a client.', { fill: '#FFFFFF', stroke: VIOLET, fontSize: 20 });

    y = k.section(972, 160, 660, topH, 'Team capacity', TINT.gray);
    k.table(996, y, [240, 140, 232], [
      { h: 36, cells: ['Teammate', 'Days available', 'Notes'] },
      { h: 36, cells: ['Alex', '9', 'On call in week 2'] },
      { h: 36, cells: ['Sam', '7', 'Conference Thu–Fri'] },
      { h: 36, cells: ['Priya', '10', ''] },
      { h: 36, cells: ['Total', '26', 'Plan for about 80% of it'] },
    ]);

    const cardsAt = (x: number, top: number, cards: Array<[string, string, string]>, status: 'todo' | null) =>
      cards.forEach(([t, d, c], i) => k.card(x + 24, top + i * 108, colW - 48, 96, t, d, c, status));

    y = k.section(48, y1, colW, colH, 'Ready backlog', TINT.gray, { hint: 'Ordered by priority, estimated, clear enough to start.' });
    cardsAt(48, y, [
      ['Page size picker for PDF export', 'Estimate: 3 points', SKY],
      ['Fonts embedded in the PDF', 'Estimate: 5 points', SKY],
      ['Export progress indicator', 'Estimate: 2 points', MINT],
      ['Remember last export settings', 'Estimate: 1 point', AMBER],
    ], null);

    const x2 = 48 + colW + 24;
    y = k.section(x2, y1, colW, colH, 'Committed this sprint', TINT.violet, { accent: VIOLET, hint: 'Pulled from the backlog. Stop when capacity is full.' });
    cardsAt(x2, y, [
      ['Export one frame per PDF page', 'Estimate: 5 points · Owner: Alex', VIOLET],
      ['Export dialog layout', 'Estimate: 3 points · Owner: Sam', VIOLET],
      ['PDF export usage metric', 'Estimate: 2 points · Owner: Priya', VIOLET],
    ], 'todo');

    const x3 = x2 + colW + 24;
    y = k.section(x3, y1, colW, colH, 'Risks & dependencies', TINT.coral, { accent: CORAL, hint: 'What could stop us, and who we need.' });
    k.stickies(x3 + 24, y, colW - 48, ['Large boards may time out while rendering', 'Needs the new fonts service from Platform', 'Design review only on Thursday', 'Add a risk…'], 'coral', 224);
    return k.done();
  },
};

export const standup: TemplateDef = {
  id: 'daily-standup',
  name: 'Daily standup',
  description: 'One row per teammate for what moved, what’s next and blockers, plus a parking lot.',
  categories: ['agile', 'meetings'],
  keywords: ['standup', 'stand-up', 'daily', 'scrum', 'sync', 'blockers', 'team'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1640;
    const cols = [200, 360, 360, 300];
    const tableW = cols.reduce((a, b) => a + b, 0);
    const rows = [
      { h: 44, cells: ['Teammate', 'Since yesterday', 'Today', 'Blockers'] },
      { h: 96, cells: ['Alex', 'Finished the export dialog layout', 'Wire up PDF rendering', ''] },
      { h: 96, cells: ['Sam', 'Reviewed two pull requests, fixed a flaky test', 'Pair with Alex on fonts', 'Waiting on designs for empty states'] },
      { h: 96, cells: ['Priya', 'Wrote the usage metric', 'Draft the release notes', ''] },
      { h: 96, cells: ['Add a teammate…', '', '', ''] },
    ];
    const tableH = rows.reduce((a, r) => a + r.h, 0);
    k.frame('Daily standup', W, 248 + tableH + 48);
    k.header('Daily standup', 'Two minutes each: what moved, what’s next, what’s in the way. Long discussions go to the parking lot.', W);
    k.shape('roundRect', 48, 160, W - 96, 64, '<b>Sprint goal:</b> customers can export any board as a PDF', { fill: TINT.violet, fontSize: 20 });
    k.table(48, 248, cols, rows, { fontSize: 17 });
    const px = 48 + tableW + 24;
    const pw = W - 48 - px;
    const y = k.section(px, 248, pw, tableH, 'Parking lot', TINT.amber, { accent: AMBER, hint: 'Talk about these afterwards.' });
    k.sticky(px + 24, y, 'Do we need a design review for empty states?', 'yellow', pw - 48, 140);
    k.sticky(px + 24, y + 156, 'Add a topic…', 'yellow', pw - 48, 140);
    return k.done();
  },
};

interface RetroColumn {
  title: string;
  hint: string;
  tint: string;
  accent: string;
  color: StickyColor;
  notes: string[];
}

/** A titled, tinted area filled with stickies: the shape of most retro formats. */
function retroArea(k: Kit, x: number, y0: number, w: number, h: number, c: RetroColumn, size: number) {
  const y = k.section(x, y0, w, h, c.title, c.tint, { accent: c.accent, hint: c.hint, size: 24 });
  k.stickies(x + 24, y, w - 48, c.notes, c.color, size);
}

export const startStopContinue: TemplateDef = {
  id: 'retro-start-stop-continue',
  name: 'Start, stop, continue',
  description: 'A quick retro: what to begin, what to drop, what to keep, and one experiment.',
  categories: ['agile', 'meetings'],
  keywords: ['retro', 'retrospective', 'start stop continue', 'sprint', 'feedback', 'team'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 420;
    const W = 96 + 3 * colW + 2 * 24;
    const colH = 494;
    const expY = 160 + colH + 24;
    k.frame('Start, stop, continue', W, expY + 140 + 48);
    k.header('Start, stop, continue', 'Five silent minutes to write, then read out, group and dot-vote. Turn the top vote into one experiment.', W);
    const cols: RetroColumn[] = [
      { title: 'Start', hint: 'What should we begin doing?', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Demo work in progress on Fridays', 'Write decisions down in the channel', 'Rotate who runs the standup', 'Add an idea…'] },
      { title: 'Stop', hint: 'What isn’t helping us?', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Starting new work before finishing', 'Meetings without an agenda', 'Late-night deploys', 'Add an idea…'] },
      { title: 'Continue', hint: 'What works and should stay?', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Pairing on tricky bugs', 'Short design reviews', 'Celebrating small wins', 'Add an idea…'] },
    ];
    cols.forEach((c, i) => retroArea(k, 48 + i * (colW + 24), 160, colW, colH, c, (colW - 48 - 16) / 2));
    k.panel(48, expY, W - 96, 140, TINT.violet);
    k.text(72, expY + 24, 280, '<b>Our experiment</b>', { size: 22, color: VIOLET, h: 32 });
    k.text(72, expY + 60, 280, rt('Try it for one sprint, then check how it went.'), { size: 14, color: INK_SOFT, h: 44 });
    k.shape('roundRect', 376, expY + 24, W - 48 - 24 - 376, 92, 'We will … so that … We’ll know it worked when …', { fill: '#FFFFFF', stroke: VIOLET, fontSize: 18 });
    return k.done();
  },
};

export const fourLs: TemplateDef = {
  id: 'retro-4ls',
  name: 'Liked, learned, lacked, longed for',
  description: 'A reflective retro in four quadrants that looks at learning, not only problems.',
  categories: ['agile', 'meetings'],
  keywords: ['retro', 'retrospective', '4ls', 'four ls', 'liked', 'learned', 'lacked', 'longed for', 'project review'],
  build(newId) {
    const k = new Kit(newId);
    const qW = 600;
    const qH = 292;
    const W = 96 + 2 * qW + 24;
    k.frame('Liked, learned, lacked, longed for', W, 160 + 2 * qH + 24 + 48);
    k.header('Liked, learned, lacked, longed for', 'Fill each quadrant on your own first. Then read them together and pick one thing to change.', W);
    const quads: RetroColumn[] = [
      { title: 'Liked', hint: 'What did you enjoy?', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Clear goal from day one', 'Quick feedback from users', 'Add a note…'] },
      { title: 'Learned', hint: 'What do you know now that you didn’t before?', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Search indexing is the slow part', 'Users rarely open settings', 'Add a note…'] },
      { title: 'Lacked', hint: 'What was missing or got in the way?', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Time for testing', 'One owner for releases', 'Add a note…'] },
      { title: 'Longed for', hint: 'What do you wish we had?', tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['Realistic test data', 'Fewer context switches', 'Add a note…'] },
    ];
    quads.forEach((q, i) => retroArea(k, 48 + (i % 2) * (qW + 24), 160 + Math.floor(i / 2) * (qH + 24), qW, qH, q, 160));
    return k.done();
  },
};

export const quarterPlanning: TemplateDef = {
  id: 'quarter-planning',
  name: 'Quarter planning',
  description: 'Teams down, sprints across: features per sprint, milestones, dependencies and risks.',
  categories: ['agile', 'planning'],
  keywords: ['pi planning', 'program increment', 'quarter', 'big room planning', 'dependencies', 'teams', 'milestones', 'release'],
  build(newId) {
    const k = new Kit(newId);
    const labelW = 200;
    const colW = 280;
    const gap = 16;
    const x0 = 48 + labelW + gap;
    const W = x0 + 5 * colW + 4 * gap + 48;
    const colX = (i: number) => x0 + i * (colW + gap);
    const cardH = 96;
    const rowH = 16 + 2 * cardH + 12 + 16;
    const rowsY = 304;
    const riskY = rowsY + 3 * (rowH + gap);
    k.frame('Quarter planning', W, riskY + 200 + 48);
    k.header('Quarter planning', 'Each team places its features in the sprint it expects to finish them, and draws an arrow for every dependency on another team.', W);

    ['Sprint 1 · weeks 1–2', 'Sprint 2 · weeks 3–4', 'Sprint 3 · weeks 5–6', 'Sprint 4 · weeks 7–8', 'Sprint 5 · weeks 9–10'].forEach((s, i) =>
      k.shape('roundRect', colX(i), 160, colW, 56, `<b>${rt(s)}</b>`, { fill: HEAD.gray, fontSize: 18 }),
    );
    k.text(64, 246, labelW - 16, '<b>Milestones</b>', { size: 18, h: 28 });
    k.shape('roundRect', colX(2), 236, colW, 48, '◆ Beta for pilot customers', { fill: HEAD.amber, fontSize: 16 });
    k.shape('roundRect', colX(4), 236, colW, 48, '◆ Public launch', { fill: HEAD.amber, fontSize: 16 });

    const teams: Array<{ name: string; goal: string; tint: string; accent: string; cards: Array<[number, number, string, string]> }> = [
      { name: 'Web app', goal: 'Export and share flows', tint: TINT.violet, accent: VIOLET, cards: [[0, 0, 'Export dialog', 'Page size, frames, quality'], [1, 0, 'PDF export screen', 'Progress and errors'], [3, 0, 'Share by email', 'Send a link to the PDF']] },
      { name: 'Platform', goal: 'Fast, reliable rendering', tint: TINT.sky, accent: SKY, cards: [[0, 0, 'Export service API', 'Job queue and status'], [2, 0, 'Font embedding', 'Every board font'], [2, 1, 'Render cache', 'Repeat exports under 2 s']] },
      { name: 'Design', goal: 'A clear, calm experience', tint: TINT.mint, accent: MINT, cards: [[0, 0, 'Export flow research', 'Five customer calls'], [1, 0, 'Empty and error states', 'Illustrations and copy'], [4, 0, 'Launch visuals', 'Website and in-app']] },
    ];
    const ids: string[][] = [];
    teams.forEach((t, ti) => {
      const y = rowsY + ti * (rowH + gap);
      k.panel(48, y, W - 96, rowH, t.tint);
      k.text(64, y + 16, labelW - 24, `<b>${rt(t.name)}</b>`, { size: 20, color: t.accent, h: 30 });
      k.text(64, y + 48, labelW - 24, rt(t.goal), { size: 14, color: INK_SOFT, h: 44 });
      ids[ti] = t.cards.map(([col, slot, title, desc]) => k.card(colX(col) + 12, y + 16 + slot * (cardH + 12), colW - 24, cardH, title, desc, t.accent));
    });
    // Dependencies between teams: the screen needs the API; sharing needs embedded fonts.
    k.connector({ id: ids[1][0], anchor: 'top' }, { id: ids[0][1], anchor: 'bottom' }, { stroke: CORAL, strokeStyle: 'dashed', label: 'needs' });
    k.connector({ id: ids[1][1], anchor: 'top' }, { id: ids[0][2], anchor: 'bottom' }, { stroke: CORAL, strokeStyle: 'dashed', label: 'needs' });

    k.panel(48, riskY, W - 96, 200, TINT.coral);
    k.text(64, riskY + 16, labelW - 24, '<b>Risks</b>', { size: 20, color: CORAL, h: 30 });
    k.text(64, riskY + 48, labelW - 24, rt('Give each one an owner.'), { size: 14, color: INK_SOFT, h: 44 });
    ['Very large boards may need a new rendering approach', 'Pilot customers are busy until week 5', 'One designer is away in sprint 4'].forEach((r, i) =>
      k.sticky(colX(i), riskY + 16, r, 'coral', colW, 168),
    );
    return k.done();
  },
};

export const estimation: TemplateDef = {
  id: 'relative-sizing',
  name: 'Relative sizing',
  description: 'Sort stories into size columns against one reference story instead of arguing hours.',
  categories: ['agile'],
  keywords: ['estimation', 'estimate', 'story points', 'sizing', 'planning poker', 'fibonacci', 't-shirt', 'refinement', 'backlog'],
  build(newId) {
    const k = new Kit(newId);
    const pileW = 232;
    const colW = 184;
    const gap = 12;
    const x0 = 48 + pileW + 24;
    const W = x0 + 7 * colW + 6 * gap + 48;
    const y0 = 160;
    const colH = 640;
    k.frame('Relative sizing', W, y0 + colH + 48);
    k.header('Relative sizing', 'Agree on one reference story (a 3) first. Then place every other story by comparing it with what’s already on the wall.', W);

    const y = k.section(48, y0, pileW, colH, 'To size', TINT.gray, { hint: 'One story at a time.' });
    ['Reset password by email', 'Import boards from a CSV file', 'Show who is viewing a board'].forEach((s, i) => k.sticky(72, y + i * 176, s, 'yellow'));

    const sizes: Array<[string, string, string]> = [
      ['1', 'Tiny', TINT.mint],
      ['2', 'Small', TINT.mint],
      ['3', 'Medium', TINT.sky],
      ['5', 'Large', TINT.sky],
      ['8', 'Very large', TINT.amber],
      ['13', 'Huge', TINT.amber],
      ['?', 'Too big: split it', TINT.coral],
    ];
    const placed: Record<number, Array<[string, StickyColor]>> = {
      0: [['Fix a typo on the pricing page', 'green']],
      2: [['Reference story: rename a board', 'violet']],
      3: [['Add a dark theme', 'blue']],
      6: [['Offline mode for everything', 'coral']],
    };
    sizes.forEach(([n, label, tint], i) => {
      const x = x0 + i * (colW + gap);
      k.panel(x, y0, colW, colH, tint);
      k.shape('roundRect', x + 12, y0 + 12, colW - 24, 64, `<b>${rt(n)}</b>`, { fill: '#FFFFFF', fontSize: 32 });
      k.text(x + 12, y0 + 84, colW - 24, rt(label), { size: 15, color: INK_SOFT, align: 'center', h: 22 });
      (placed[i] ?? []).forEach(([t, c], j) => k.sticky(x + 12, y0 + 120 + j * 176, t, c));
    });
    return k.done();
  },
};
