// Facilitation: RACI matrix, decision matrix, dot voting, how might we, starbursting, reverse
// brainstorm.
import type { StickyColor } from '@freero/shared';
import { ListChecks, Vote } from 'lucide-react';
import { Kit, list, rt, titled, type TableCell } from '../kit';
import { AMBER, CORAL, HEAD, INK, INK_SOFT, LINE, MINT, ROSE, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const raci: TemplateDef = {
  id: 'raci-matrix',
  name: 'RACI matrix',
  description: 'Who is Responsible, Accountable, Consulted and Informed for each task, in one table.',
  categories: ['meetings', 'planning'],
  keywords: ['raci', 'responsibility matrix', 'roles', 'accountable consulted informed', 'ownership', 'rasci', 'roles and responsibilities', 'table'],
  build(newId) {
    const k = new Kit(newId);
    const roles = ['Product', 'Design', 'Engineering', 'Marketing', 'Support'];
    const fill: Record<string, string> = { R: HEAD.violet, A: HEAD.coral, C: HEAD.amber, I: HEAD.sky };
    const cell = (v: string): string | TableCell => (v ? { t: v, f: fill[v] } : '');
    // One letter per role, in `roles` order; exactly one A per row (the A may also do the work).
    const tasks: Array<[string, string]> = [
      ['Write the launch brief', 'ACCRI'],
      ['Final designs', 'CARII'],
      ['Build and test', 'CCAII'],
      ['Help articles', 'CICRA'],
      ['Launch announcement', 'CCIAI'],
      ['Customer feedback loop', 'ARICR'],
      ['', '     '],
    ];
    const rows = [
      { h: 48, cells: ['Task', ...roles] },
      ...tasks.map(([t, v]) => ({ h: 52, cells: [t, ...v.split('').map((c) => cell(c.trim()))] })),
    ];
    const cols = [340, ...roles.map(() => 150)];
    const tw = cols.reduce((a, b) => a + b, 0);
    const th = rows.reduce((a, r) => a + r.h, 0);
    const sideW = 420;
    const W = 48 + tw + 24 + sideW + 48;
    k.frame('RACI matrix', W, 160 + th + 48);
    k.header('RACI matrix', 'One A per row: the single person who answers for it. Too many Cs slow things down; too few Is cause surprises.', W);
    k.table(48, 160, cols, rows);
    const sx = 48 + tw + 24;
    const y = k.section(sx, 160, sideW, th, 'Key', TINT.gray);
    const key: Array<[string, string, string]> = [
      ['R', 'Responsible', 'Does the work'],
      ['A', 'Accountable', 'Owns the outcome; signs off'],
      ['C', 'Consulted', 'Asked before decisions'],
      ['I', 'Informed', 'Told after decisions'],
    ];
    key.forEach(([l, name, what], i) => {
      const ry = y + i * 72;
      k.shape('roundRect', sx + 24, ry, 52, 52, `<b>${l}</b>`, { fill: fill[l], fontSize: 22 });
      k.text(sx + 92, ry + 2, sideW - 116, titled(name, what), { size: 16, h: 50 });
    });
    return k.done();
  },
};

export const decisionMatrix: TemplateDef = {
  id: 'decision-matrix',
  name: 'Decision matrix',
  description: 'Compare options on weighted criteria: score each 1–5, multiply by the weight, add it up.',
  categories: ['meetings', 'strategy'],
  keywords: ['decision matrix', 'weighted scoring', 'pugh matrix', 'criteria', 'options', 'compare', 'trade-offs', 'evaluation', 'table'],
  build(newId) {
    const k = new Kit(newId);
    const options = ['City hotel', 'Countryside lodge', 'Our own office'];
    const criteria: Array<[string, number, number[]]> = [
      ['Cost', 3, [2, 3, 5]],
      ['Travel time for everyone', 2, [4, 2, 5]],
      ['Space for workshops', 3, [4, 5, 2]],
      ['Fun and change of scene', 1, [3, 5, 1]],
      ['Video for remote folks', 2, [5, 2, 4]],
    ];
    const totals = options.map((_, o) => criteria.reduce((a, [, w, s]) => a + w * s[o], 0));
    const best = Math.max(...totals);
    const rows: Array<{ h: number; cells: Array<string | TableCell> }> = [
      { h: 48, cells: ['Criterion', 'Weight', ...options] },
      ...criteria.map(([c, w, s]) => ({ h: 52, cells: [c, String(w), ...s.map((v) => `${v}  →  ${v * w}`)] })),
      { h: 56, cells: ['Total', '', ...totals.map((t) => ({ t: String(t), f: t === best ? HEAD.mint : TINT.gray }))] },
    ];
    const cols = [300, 110, 210, 210, 210];
    const tw = cols.reduce((a, b) => a + b, 0);
    const th = rows.reduce((a, r) => a + r.h, 0);
    const sideW = 420;
    const W = 48 + tw + 24 + sideW + 48;
    k.frame('Decision matrix', W, 160 + th + 48);
    k.header('Decision matrix: team offsite', 'Agree on criteria and weights (1–3) before scoring. Score 1–5; each cell shows score → score × weight.', W);
    k.table(48, 160, cols, rows);
    const sx = 48 + tw + 24;
    const y = k.section(sx, 160, sideW, th, 'Gut check', TINT.violet, { accent: VIOLET, icon: ListChecks });
    k.sticky(sx + 24, y, 'Does the winner feel right? If not, a criterion is missing.', 'violet', sideW - 48, (th - (y - 160) - 40) / 2);
    k.sticky(sx + 24, y + (th - (y - 160) - 40) / 2 + 16, 'Close totals? Pick the option that is easiest to undo.', 'yellow', sideW - 48, (th - (y - 160) - 40) / 2);
    return k.done();
  },
};

export const dotVoting: TemplateDef = {
  id: 'dot-voting',
  name: 'Dot voting',
  description: 'Collect ideas, vote with a fixed number of dots each, and move the winners to a shortlist.',
  categories: ['brainstorm', 'meetings'],
  keywords: ['dot voting', 'dotmocracy', 'vote', 'voting', 'prioritise', 'prioritize', 'multi-voting', 'shortlist', 'ideas'],
  build(newId) {
    const k = new Kit(newId);
    const note = 180;
    const gap = 16;
    const perRow = 5;
    const ideasW = 48 + perRow * note + (perRow - 1) * gap;
    const ideasH = 96 + 3 * note + 2 * gap + 24;
    const sideW = 440;
    const W = 48 + ideasW + 24 + sideW + 48;
    k.frame('Dot voting', W, 160 + ideasH + 48);
    k.header('Dot voting', 'Everyone gets three votes. Vote in silence, then reveal. Ties? Quick discussion, then one more round.', W);
    const y = k.section(48, 160, ideasW, ideasH, 'Ideas', TINT.amber, { accent: AMBER, hint: 'One idea per sticky, short enough to read from afar.' });
    const ideas: Array<[string, StickyColor]> = [
      ['Team lunch every Friday', 'yellow'],
      ['No-meeting Wednesdays', 'yellow'],
      ['Rotate who runs standup', 'yellow'],
      ['Shared on-call calendar', 'yellow'],
      ['Demo day each month', 'yellow'],
      ['Book club', 'yellow'],
      ['Pair on hard tickets', 'yellow'],
      ['Write decisions down', 'yellow'],
      ['Quiet room for focus', 'yellow'],
      ['Mentoring pairs', 'yellow'],
      ['Add an idea…', 'yellow'],
    ];
    ideas.forEach(([t, c], i) => k.sticky(72 + (i % perRow) * (note + gap), y + Math.floor(i / perRow) * (note + gap), t, c, note));
    const sx = 48 + ideasW + 24;
    const howH = 300;
    let sy = k.section(sx, 160, sideW, howH, 'How to vote', TINT.violet, { accent: VIOLET, icon: Vote });
    k.text(sx + 24, sy, sideW - 48, list(['Start a vote from the toolbar, 3 votes each', 'Or stamp a dot on the stickies you pick', 'Reveal together, then count'], true), { size: 18, h: howH - (sy - 160) - 16 });
    const shortY = 160 + howH + 24;
    const shortH = ideasH - howH - 24;
    sy = k.section(sx, shortY, sideW, shortH, 'Shortlist', TINT.mint, { accent: MINT, hint: 'Move the top three here.' });
    ['1', '2', '3'].forEach((n, i) => {
      const ry = sy + i * 72;
      k.shape('ellipse', sx + 24, ry, 52, 52, `<b>${n}</b>`, { fill: MINT, textColor: '#FFFFFF', fontSize: 22 });
      k.shape('roundRect', sx + 92, ry, sideW - 116, 52, '', { fill: '#FFFFFF', stroke: MINT, strokeStyle: 'dashed' });
    });
    return k.done();
  },
};

export const howMightWe: TemplateDef = {
  id: 'how-might-we',
  name: 'How might we',
  description: 'Turn research insights into “How might we…?” questions, then into first ideas.',
  categories: ['brainstorm', 'research'],
  keywords: ['how might we', 'hmw', 'problem framing', 'reframe', 'design thinking', 'opportunity', 'questions', 'ideation'],
  build(newId) {
    const k = new Kit(newId);
    const ins = 240;
    const hmw = 280;
    const idea = 170;
    const gapA = 88;
    const rowH = 200;
    const rows: Array<{ insight: string; question: string; ideas: string[] }> = [
      { insight: 'New users close the app when they see an empty board', question: 'How might we make the first minute feel full?', ideas: ['Sample board', 'Pick a goal first', 'Add idea…'] },
      { insight: 'Teams lose track of decisions made in workshops', question: 'How might we make decisions easy to find later?', ideas: ['Decision sticky type', 'Weekly summary', 'Add idea…'] },
      { insight: 'Clients feel lost on big boards', question: 'How might we guide a visitor through a board?', ideas: ['Guided tour mode', 'Start here arrow', 'Add idea…'] },
    ];
    const W = 48 + ins + gapA + hmw + gapA + 3 * idea + 2 * 16 + 48;
    const y0 = 208;
    k.frame('How might we', W, y0 + rows.length * rowH + 48);
    k.header('How might we', 'Not too broad (“…make users happy”), not too narrow (“…add a button”). Each question should invite many answers.', W);
    const xs = [48, 48 + ins + gapA, 48 + ins + gapA + hmw + gapA];
    const heads: Array<[string, string]> = [
      ['Insight', CORAL],
      ['How might we…?', VIOLET],
      ['First ideas', AMBER],
    ];
    heads.forEach(([t, c], i) => k.text(xs[i], 160, 300, `<b>${rt(t)}</b>`, { size: 20, color: c, h: 30 }));
    rows.forEach((r, i) => {
      const y = y0 + i * rowH;
      const a = k.sticky(xs[0], y, r.insight, 'pink', ins, 176);
      const b = k.sticky(xs[1], y, r.question, 'violet', hmw, 176);
      k.connector({ id: a, anchor: 'right' }, { id: b, anchor: 'left' }, { stroke: LINE });
      r.ideas.forEach((t, j) => {
        const id = k.sticky(xs[2] + j * (idea + 16), y + 3, t, 'yellow', idea);
        if (j === 0) k.connector({ id: b, anchor: 'right' }, { id, anchor: 'left' }, { stroke: LINE });
      });
    });
    return k.done();
  },
};

export const starbursting: TemplateDef = {
  id: 'starbursting',
  name: 'Starbursting',
  description: 'Question an idea from six sides: who, what, where, when, why and how, as a mind map.',
  categories: ['brainstorm', 'strategy'],
  keywords: ['starbursting', 'star', 'questions', '5w1h', 'who what when where why how', 'question storming', 'mind map', 'idea review'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1720;
    const H = 860;
    k.frame('Starbursting', W, H);
    k.header('Starbursting', 'Ask questions only, no answers yet. Aim for three per point of the star, then pick the ones that would change the plan.', W);
    const rootW = 300;
    const root = k.mindmap(W / 2 - rootW / 2, 470, rootW, 84, 'Idea: a tool library in the office', VIOLET, null, 'both');
    const branches: Array<{ text: string; color: string; side: 1 | -1; y: number; leaves: string[] }> = [
      { text: 'Who?', color: SKY, side: 1, y: 220, leaves: ['Who looks after it?', 'Who can borrow?'] },
      { text: 'What?', color: MINT, side: 1, y: 470, leaves: ['What tools first?', 'What if one breaks?'] },
      { text: 'Where?', color: AMBER, side: 1, y: 720, leaves: ['Where is it kept?', 'Where do returns go?'] },
      { text: 'When?', color: ROSE, side: -1, y: 220, leaves: ['When does it open?', 'How long is a loan?'] },
      { text: 'Why?', color: CORAL, side: -1, y: 470, leaves: ['Why would people use it?', 'Why not just buy?'] },
      { text: 'How?', color: INK_SOFT, side: -1, y: 720, leaves: ['How do we track loans?', 'How is it funded?'] },
    ];
    const childW = 150;
    const leafW = 250;
    for (const b of branches) {
      const cx = b.side === 1 ? W / 2 + rootW / 2 + 90 : W / 2 - rootW / 2 - 90 - childW;
      const child = k.mindmap(cx, b.y + 4, childW, 52, b.text, b.color, root);
      b.leaves.forEach((leaf, i) => {
        const lx = b.side === 1 ? cx + childW + 80 : cx - 80 - leafW;
        k.mindmap(lx, b.y - 36 + i * 72, leafW, 52, leaf, b.color, child);
      });
    }
    return k.done();
  },
};

export const reverseBrainstorm: TemplateDef = {
  id: 'reverse-brainstorm',
  name: 'Reverse brainstorm',
  description: 'List ways to make a problem worse, then flip each one into an idea worth trying.',
  categories: ['brainstorm', 'meetings'],
  keywords: ['reverse brainstorming', 'reverse brainstorm', 'worst idea', 'flip', 'problem reversal', 'negative brainstorming', 'creative', 'ideation'],
  build(newId) {
    const k = new Kit(newId);
    const note = 220;
    const gap = 120;
    const pairs: Array<[string, string]> = [
      ['Give them no laptop on day one', 'Laptop set up and waiting on their desk'],
      ['Nobody says hello', 'Team welcome call in the first hour'],
      ['Hand them 40 docs to read', 'One short “start here” page'],
      ['Wait a month for real work', 'Ship something small in week one'],
    ];
    const colW = 2 * note + gap;
    const W = 96 + colW + 48 + 380;
    const y0 = 300;
    const rowH = 150;
    k.frame('Reverse brainstorm', W, y0 + pairs.length * rowH + 48);
    k.header('Reverse brainstorm', 'Five minutes of making it worse (have fun with it), then flip every sticky into its opposite.', W);
    k.shape('roundRect', 48, 160, W - 96, 64, '<b>Make it worse:</b> how could we make sure new hires feel lost?', { fill: TINT.coral, stroke: CORAL, strokeWidth: 2, fontSize: 20 });
    k.text(48, 248, note, `<b>${rt('Make it worse')}</b>`, { size: 18, color: CORAL, h: 28 });
    k.text(48 + note + gap, 248, note, `<b>${rt('Flip it')}</b>`, { size: 18, color: MINT, h: 28 });
    pairs.forEach(([bad, good], i) => {
      const y = y0 + i * rowH;
      const a = k.sticky(48, y, bad, 'coral', note, 130);
      const b = k.sticky(48 + note + gap, y, good, 'green', note, 130);
      k.connector({ id: a, anchor: 'right' }, { id: b, anchor: 'left' }, { stroke: INK, label: 'flip' });
    });
    const sx = 48 + colW + 48;
    const top = 248;
    const sh = y0 - top + pairs.length * rowH - 20;
    const y = k.section(sx, top, 380, sh, 'Try first', TINT.violet, { accent: VIOLET, hint: 'Vote, then move the top two here.' });
    const nh = (sh - (y - top) - 24 - 16) / 2;
    k.sticky(sx + 24, y, 'Top pick…', 'violet', 332, nh);
    k.sticky(sx + 24, y + nh + 16, 'Runner-up…', 'violet', 332, nh);
    return k.done();
  },
};
