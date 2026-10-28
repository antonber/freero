// Strategy canvases: OKRs, lean canvas, business model sketch, competitor comparison,
// now / next / later roadmap. Layouts are Freero's own.
import type { StickyColor } from '@freero/shared';
import { Kit, rt } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, MINT, ROSE, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const okrs: TemplateDef = {
  id: 'okrs',
  name: 'OKRs',
  description: 'Three objectives, each with measurable key results and the initiatives that move them.',
  categories: ['strategy', 'planning'],
  keywords: ['okr', 'okrs', 'objectives', 'key results', 'goals', 'quarter', 'metrics', 'targets'],
  build(newId) {
    const k = new Kit(newId);
    const objW = 340;
    const krW = 520;
    const note = 150;
    const objX = 64;
    const krX = objX + objW + 24;
    const initX = krX + krW + 24;
    const W = initX + 2 * note + 16 + 16 + 48;
    const cardH = 80;
    const rowH = 16 + 3 * cardH + 2 * 10 + 16;
    const rowsY = 200;
    k.frame('OKRs', W, rowsY + 3 * (rowH + 16) - 16 + 48);
    k.header('OKRs · this quarter', 'Objectives say where we want to be; key results are numbers that prove we got there. Score each key result from 0 to 1 at the end.', W);
    const label = (x: number, w: number, t: string) => k.text(x, 160, w, `<b>${rt(t)}</b>`, { size: 16, color: INK_SOFT, h: 26 });
    label(objX, objW, 'Objective');
    label(krX, krW, 'Key results (start → target)');
    label(initX, 2 * note + 16, 'Initiatives');

    const rows: Array<{ obj: string; tint: string; head: string; accent: string; color: StickyColor; krs: Array<[string, string]>; init: string[] }> = [
      {
        obj: 'Make Freero the easiest way to run a remote workshop',
        tint: TINT.violet,
        head: HEAD.violet,
        accent: VIOLET,
        color: 'violet',
        krs: [['Workshops run per week: 400 → 1,000', 'Now 520 · confidence: medium'], ['Facilitators who return within 30 days: 35% → 55%', 'Now 41%'], ['Time to set up a workshop: 20 → 5 minutes', 'Measured in five user tests']],
        init: ['Workshop templates with timers', 'Facilitator onboarding guide'],
      },
      {
        obj: 'Win the trust of larger teams',
        tint: TINT.sky,
        head: HEAD.sky,
        accent: SKY,
        color: 'blue',
        krs: [['Teams with 50+ members: 12 → 40', 'Now 15'], ['Security review pass rate: 60% → 90%', 'Questionnaire answers ready'], ['Uptime above 99.9% every month', 'Last month: 99.95%']],
        init: ['Single sign-on', 'Public status page'],
      },
      {
        obj: 'Build a calm, sustainable team',
        tint: TINT.mint,
        head: HEAD.mint,
        accent: MINT,
        color: 'green',
        krs: [['On-call pages per week: 9 → 3', 'Now 7'], ['Team health score: 3.4 → 4.0', 'Monthly pulse survey'], ['Every engineer ships in their first week', '2 of 3 new joiners so far']],
        init: ['Fix the noisiest alerts', 'Onboarding buddy rota'],
      },
    ];
    rows.forEach((r, i) => {
      const y = rowsY + i * (rowH + 16);
      k.panel(48, y, W - 96, rowH, r.tint);
      k.shape('roundRect', objX, y + 16, objW, rowH - 32, `<b>Objective ${i + 1}</b><br>${rt(r.obj)}`, { fill: r.head, fontSize: 20, align: 'left' });
      r.krs.forEach(([t, d], j) => k.card(krX, y + 16 + j * (cardH + 10), krW, cardH, `KR ${i + 1}.${j + 1} · ${t}`, d, r.accent));
      r.init.forEach((n, j) => k.sticky(initX + j * (note + 16), y + 16, n, r.color, note));
    });
    return k.done();
  },
};

interface CanvasBox {
  title: string;
  hint: string;
  tint: string;
  accent: string;
  color: StickyColor;
  notes: string[];
}

export const leanCanvas: TemplateDef = {
  id: 'lean-canvas',
  name: 'Lean canvas',
  description: 'A one-page business plan in three bands: the problem, your solution and the business.',
  categories: ['strategy'],
  keywords: ['lean canvas', 'business plan', 'startup', 'problem', 'solution', 'value proposition', 'unfair advantage', 'metrics'],
  build(newId) {
    const k = new Kit(newId);
    const labelW = 180;
    const x0 = 48 + labelW + 16;
    const inner = 3 * 468 + 2 * 16;
    const W = x0 + inner + 48;
    const boxH = 260;
    const note = 140;
    const bands: Array<{ title: string; sub: string; boxes: CanvasBox[] }> = [
      {
        title: 'Problem',
        sub: 'Who hurts, and how',
        boxes: [
          { title: 'Customer segments', hint: 'Who has this problem most?', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Parents of young kids', 'Early adopters: both parents work'] },
          { title: 'Problems', hint: 'Their top three problems', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['No time to plan meals', 'Food goes to waste'] },
          { title: 'Existing alternatives', hint: 'How they cope today', tint: TINT.gray, accent: INK_SOFT, color: 'gray', notes: ['Takeaway twice a week', 'Recipe apps and notes'] },
        ],
      },
      {
        title: 'Solution',
        sub: 'Why us, and what we build',
        boxes: [
          { title: 'Unique value', hint: 'Why you, in one line', tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['Dinner planned in 5 minutes a week', 'Less waste, less stress'] },
          { title: 'Solution', hint: 'Simplest thing that solves it', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Weekly plan from what’s in the fridge', 'Shopping list in one tap'] },
          { title: 'Unfair advantage', hint: 'What is hard to copy', tint: TINT.amber, accent: AMBER, color: 'orange', notes: ['Partnership with local grocers', 'Data from 10k family plans'] },
        ],
      },
      {
        title: 'Business',
        sub: 'How it grows and pays',
        boxes: [
          { title: 'Channels', hint: 'How you reach them', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['School newsletters', 'Parenting podcasts'] },
          { title: 'Revenue', hint: 'How money comes in', tint: TINT.mint, accent: MINT, color: 'green', notes: ['€6 / month per family', 'Grocer referral fees'] },
          { title: 'Costs', hint: 'Main costs to run it', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Two developers', 'Recipe licensing'] },
          { title: 'Key metrics', hint: 'Numbers to watch', tint: TINT.rose, accent: ROSE, color: 'pink', notes: ['Weekly plans made', 'Month-2 retention'] },
        ],
      },
    ];
    k.frame('Lean canvas', W, 160 + bands.length * (boxH + 16) - 16 + 48);
    k.header('Lean canvas', 'Fill it in order: problem and customers first, then your solution, then the business. Keep each sticky short; it’s a sketch, not a plan.', W);
    bands.forEach((band, bi) => {
      const y = 160 + bi * (boxH + 16);
      k.text(48, y + 16, labelW, `<b>${rt(band.title)}</b>`, { size: 22, h: 32 });
      k.text(48, y + 52, labelW, rt(band.sub), { size: 14, color: INK_SOFT, h: 44 });
      const boxW = (inner - (band.boxes.length - 1) * 16) / band.boxes.length;
      band.boxes.forEach((b, i) => {
        const x = x0 + i * (boxW + 16);
        const top = k.section(x, y, boxW, boxH, b.title, b.tint, { accent: b.accent, hint: b.hint, size: 20 });
        k.stickies(x + 24, top, boxW - 48, b.notes, b.color, note, 12);
      });
    });
    return k.done();
  },
};

export const businessModel: TemplateDef = {
  id: 'business-model',
  name: 'Business model sketch',
  description: 'Build, offer, reach, earn: how a business creates value and makes money, left to right.',
  categories: ['strategy'],
  keywords: ['business model', 'canvas', 'value proposition', 'partners', 'channels', 'revenue', 'costs', 'customers'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 380;
    const gap = 20;
    const W = 96 + 4 * colW + 3 * gap;
    const y0 = 244;
    const areaH = 3 * 200 + 2 * 16;
    k.frame('Business model sketch', W, y0 + areaH + 48);
    k.header('Business model sketch', 'Read it left to right: what you build on, what you offer, who you reach, how it pays. Change one sticky and check what else must change.', W);
    const cols: Array<{ step: string; head: string; boxes: CanvasBox[] }> = [
      {
        step: '1 · Build',
        head: HEAD.amber,
        boxes: [
          { title: 'Key partners', hint: '', tint: TINT.amber, accent: AMBER, color: 'orange', notes: ['Local bike shops', 'Parts wholesaler'] },
          { title: 'Key activities', hint: '', tint: TINT.amber, accent: AMBER, color: 'orange', notes: ['Doorstep repairs', 'Route planning'] },
          { title: 'Key resources', hint: '', tint: TINT.amber, accent: AMBER, color: 'orange', notes: ['Trained mechanics', 'Two cargo bikes'] },
        ],
      },
      {
        step: '2 · Offer',
        head: HEAD.violet,
        boxes: [
          { title: 'Value we create', hint: 'The job we do for customers', tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['Your bike fixed at home', 'No trip to the shop'] },
          { title: 'Proof it matters', hint: 'What tells us they care', tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['200 waitlist signups', '60% would pay monthly'] },
        ],
      },
      {
        step: '3 · Reach',
        head: HEAD.sky,
        boxes: [
          { title: 'Customers', hint: '', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Daily commuters', 'Families with kids’ bikes'] },
          { title: 'Channels', hint: '', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Office partnerships', 'Neighbourhood groups'] },
          { title: 'Relationship', hint: '', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Same mechanic each visit', 'Seasonal check reminders'] },
        ],
      },
      {
        step: '4 · Earn',
        head: HEAD.mint,
        boxes: [
          { title: 'Revenue', hint: '', tint: TINT.mint, accent: MINT, color: 'green', notes: ['€12 / month plan', 'Parts at cost + 20%'] },
          { title: 'Costs', hint: '', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Mechanic wages', 'Parts stock'] },
          { title: 'Pricing logic', hint: '', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Cheaper than two shop visits a year'] },
        ],
      },
    ];
    cols.forEach((c, ci) => {
      const x = 48 + ci * (colW + gap);
      k.shape('chevron', x, 160, colW, 64, `<b>${rt(c.step)}</b>`, { fill: c.head, fontSize: 20 });
      const boxH = (areaH - (c.boxes.length - 1) * 16) / c.boxes.length;
      c.boxes.forEach((b, bi) => {
        const y = y0 + bi * (boxH + 16);
        const top = k.section(x, y, colW, boxH, b.title, b.tint, { accent: b.accent, hint: b.hint || undefined, size: 18 });
        const size = c.boxes.length === 2 ? 156 : 128;
        k.stickies(x + 24, top, colW - 48, b.notes, b.color, size);
      });
    });
    return k.done();
  },
};

export const competitors: TemplateDef = {
  id: 'competitor-comparison',
  name: 'Competitor comparison',
  description: 'A table of you against alternatives on the criteria customers care about, plus takeaways.',
  categories: ['strategy', 'research'],
  keywords: ['competitive analysis', 'competitors', 'comparison', 'market', 'positioning', 'benchmark', 'table'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [220, 210, 210, 210, 210];
    const tableW = cols.reduce((a, b) => a + b, 0);
    const rows = [
      { h: 48, cells: ['', 'Us', 'Rival A', 'Rival B', 'Spreadsheets'] },
      { h: 56, cells: ['Best for', 'Small product teams', 'Large enterprises', 'Designers', 'Anyone, for free'] },
      { h: 56, cells: ['Price per person', '€8 / month', '€20 / month', '€12 / month', 'Free'] },
      { h: 56, cells: ['Time to first value', '5 minutes', '2 weeks', '1 hour', 'Instant'] },
      { h: 56, cells: ['Biggest strength', 'Real-time and fast', 'Integrations', 'Beautiful output', 'Everyone has it'] },
      { h: 56, cells: ['Biggest weakness', 'Few integrations', 'Complex setup', 'No planning tools', 'Hard to collaborate'] },
      { h: 56, cells: ['How they win deals', 'Free team trial', 'Sales team', 'Word of mouth', 'Habit'] },
      { h: 56, cells: ['Our response', '—', 'Self-serve SSO', 'Export polish', 'One-click import'] },
    ];
    const tableH = rows.reduce((a, r) => a + r.h, 0);
    const sideX = 48 + tableW + 24;
    const sideW = 360;
    const W = sideX + sideW + 48;
    k.frame('Competitor comparison', W, 160 + tableH + 48);
    k.header('Competitor comparison', 'Compare on what customers weigh when they choose, not on feature lists. Include the option of doing nothing.', W);
    k.table(48, 160, cols, rows, { fills: { 1: TINT.violet } });
    const y = k.section(sideX, 160, sideW, tableH, 'Takeaways', TINT.gray);
    k.sticky(sideX + 24, y, 'Where we win: speed and price for small teams', 'green', sideW - 48, 160);
    k.sticky(sideX + 24, y + 176, 'Where we lose: integrations and enterprise checklists', 'coral', sideW - 48, 160);
    return k.done();
  },
};

export const nowNextLater: TemplateDef = {
  id: 'now-next-later',
  name: 'Now, next, later',
  description: 'A roadmap without dates: problems you’re solving now, next and later, plus parked ideas.',
  categories: ['strategy', 'planning'],
  keywords: ['roadmap', 'now next later', 'priorities', 'product', 'outcomes', 'themes'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 440;
    const W = 96 + 3 * colW + 2 * 24;
    const colH = 560;
    const parkY = 160 + colH + 24;
    k.frame('Now, next, later', W, parkY + 280 + 48);
    k.header('Now, next, later', 'Write problems to solve, not features. The further right, the less certain: keep Later short and loose.', W);
    const cols: Array<{ title: string; hint: string; tint: string; accent: string; cards: Array<[string, string]> }> = [
      { title: 'Now', hint: 'Being worked on; well understood.', tint: TINT.mint, accent: MINT, cards: [['New teams get lost on an empty board', 'Starter templates on first open'], ['Exports fail on large boards', 'Rendering moves to the server'], ['Pricing is confusing', 'One clear comparison table']] },
      { title: 'Next', hint: 'Coming up; still being shaped.', tint: TINT.sky, accent: SKY, cards: [['Hard to follow up after workshops', 'Action items with owners'], ['Admins can’t manage seats', 'Team admin console']] },
      { title: 'Later', hint: 'Worth exploring; nothing promised.', tint: TINT.violet, accent: VIOLET, cards: [['Working offline on trains', 'Offline editing'], ['Teams want their own look', 'Custom themes']] },
    ];
    cols.forEach((c, i) => {
      const x = 48 + i * (colW + 24);
      const y = k.section(x, 160, colW, colH, c.title, c.tint, { accent: c.accent, hint: c.hint, size: 24 });
      c.cards.forEach(([t, d], j) => k.card(x + 24, y + j * 112, colW - 48, 100, t, d, c.accent));
    });
    const y = k.section(48, parkY, W - 96, 280, 'Parked ideas', TINT.gray, { hint: 'Good ideas we chose not to do yet. Revisit them every quarter.' });
    k.stickies(72, y, W - 144, ['Mobile app for tablets', 'Board version history', 'Voice notes on stickies', 'Add an idea…'], 'gray');
    return k.done();
  },
};
