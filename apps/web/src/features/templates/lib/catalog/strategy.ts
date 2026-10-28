// Strategy: SWOT, impact × effort matrix, customer journey, product roadmap.
import type { StickyColor } from '@freero/shared';
import { Kit, STICKY, rt } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, LINE, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const swot: TemplateDef = {
  id: 'swot',
  name: 'SWOT analysis',
  description: 'Strengths, weaknesses, opportunities and threats, with a guiding question in each.',
  categories: ['strategy'],
  keywords: ['swot', 'analysis', 'competition', 'strengths', 'weaknesses', 'opportunities', 'threats'],
  build(newId) {
    const k = new Kit(newId);
    const qW = 560;
    const qH = 320;
    const gap = 24;
    const y0 = 160;
    const W = 96 + 2 * qW + gap;
    const H = y0 + 2 * qH + gap + 48;
    k.frame('SWOT analysis', W, H);
    k.header('SWOT analysis', 'Inside factors on top, outside factors below. Keep each sticky specific enough to act on.', W);
    const quads: Array<{ title: string; q: string; tint: string; accent: string; color: StickyColor; notes: string[] }> = [
      { title: 'Strengths', q: 'What do we do better than anyone else?', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Loyal early customers', 'Fast release cycle', 'Strong design culture'] },
      { title: 'Weaknesses', q: 'Where do we lose deals, time or money?', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Small sales team', 'Onboarding takes too long', 'Few integrations'] },
      { title: 'Opportunities', q: 'Which trends or gaps could we use?', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Remote teams need async tools', 'Partners are asking for an API', 'Schools are underserved'] },
      { title: 'Threats', q: 'What could hurt us in the next year?', tint: TINT.amber, accent: AMBER, color: 'orange', notes: ['A bigger rival adds a free tier', 'Hosting costs keep rising', 'New privacy rules'] },
    ];
    quads.forEach((d, i) => {
      const x = 48 + (i % 2) * (qW + gap);
      const y = y0 + Math.floor(i / 2) * (qH + gap);
      k.panel(x, y, qW, qH, d.tint);
      k.text(x + 24, y + 18, qW - 48, `<b>${rt(d.title)}</b>`, { size: 24, color: d.accent, h: 36 });
      k.text(x + 24, y + 56, qW - 48, rt(d.q), { size: 15, color: INK_SOFT, h: 24 });
      d.notes.forEach((n, j) => k.sticky(x + 24 + j * (STICKY + 16), y + 108, n, d.color));
    });
    return k.done();
  },
};

export const prioritization: TemplateDef = {
  id: 'prioritization',
  name: 'Impact × effort',
  description: 'A 2×2 matrix to sort ideas into quick wins, big bets, fill-ins and time sinks.',
  categories: ['strategy', 'planning'],
  keywords: ['prioritization', 'priority', 'matrix', '2x2', 'impact', 'effort', 'quadrant'],
  build(newId) {
    const k = new Kit(newId);
    const x0 = 120;
    const y0 = 196;
    const cW = 440;
    const cH = 330;
    const gap = 12;
    const mW = 2 * cW + gap;
    const mH = 2 * cH + gap;
    const sideX = x0 + mW + 56;
    const sideW = 208;
    const W = sideX + sideW + 48;
    const H = y0 + mH + 120;
    k.frame('Impact × effort', W, H);
    k.header('Impact × effort', 'Place each idea by how much it moves the goal (up) and how much work it takes (right). Start with the top-left.', W);

    const quads: Array<{ title: string; hint: string; tint: string; accent: string; color: StickyColor; notes: string[] }> = [
      { title: 'Quick wins', hint: 'High impact, low effort: do these first.', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Save filters between visits'] },
      { title: 'Big bets', hint: 'High impact, high effort: plan them carefully.', tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['Offline mode'] },
      { title: 'Fill-ins', hint: 'Low impact, low effort: do them when there is slack.', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['New empty-state illustration'] },
      { title: 'Time sinks', hint: 'Low impact, high effort: question or drop.', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['Custom theme editor'] },
    ];
    quads.forEach((d, i) => {
      const x = x0 + (i % 2) * (cW + gap);
      const y = y0 + Math.floor(i / 2) * (cH + gap);
      k.panel(x, y, cW, cH, d.tint);
      k.text(x + 20, y + 16, cW - 40, `<b>${rt(d.title)}</b>`, { size: 22, color: d.accent, h: 32 });
      k.text(x + 20, y + 50, cW - 40, rt(d.hint), { size: 14, color: INK_SOFT, h: 22 });
      d.notes.forEach((n, j) => k.sticky(x + 20 + j * (STICKY + 16), y + cH - STICKY - 24, n, d.color));
    });

    // Axes: impact grows upwards, effort grows to the right.
    k.connector({ x: x0 - 32, y: y0 + mH }, { x: x0 - 32, y: y0 - 8 }, { routing: 'straight', stroke: LINE, strokeWidth: 3 });
    k.connector({ x: x0, y: y0 + mH + 32 }, { x: x0 + mW + 8, y: y0 + mH + 32 }, { routing: 'straight', stroke: LINE, strokeWidth: 3 });
    k.text(x0 - 64, y0 - 48, 160, '<b>Impact ↑</b>', { size: 18, h: 28 });
    k.text(x0 + mW - 120, y0 + mH + 44, 140, '<b>Effort →</b>', { size: 18, align: 'right', h: 28 });

    k.panel(sideX, y0, sideW, mH, TINT.gray);
    k.text(sideX + 20, y0 + 16, sideW - 40, '<b>Ideas to sort</b>', { size: 20, h: 30 });
    k.text(sideX + 20, y0 + 48, sideW - 40, 'Drag each one into the grid.', { size: 14, color: INK_SOFT, h: 40 });
    ['Dark mode', 'Bulk export to CSV', 'Rewrite the search engine'].forEach((n, j) =>
      k.sticky(sideX + (sideW - STICKY) / 2, y0 + 104 + j * (STICKY + 16), n, 'yellow'),
    );
    return k.done();
  },
};

export const customerJourney: TemplateDef = {
  id: 'customer-journey',
  name: 'Customer journey',
  description: 'Stages across, lanes for doing, thinking, feeling, pain points and opportunities.',
  categories: ['research', 'strategy', 'diagramming'],
  keywords: ['customer journey', 'journey map', 'experience', 'ux', 'research', 'persona'],
  build(newId) {
    const k = new Kit(newId);
    const labelW = 180;
    const colW = 260;
    const gap = 16;
    const x0 = 48 + labelW + gap;
    const W = x0 + 5 * colW + 4 * gap + 48;
    const stages = ['Discover', 'Compare', 'Buy', 'Onboard', 'Recommend'];
    const lanes: Array<{ title: string; sub: string; h: number; color?: StickyColor; items: string[]; emoji?: boolean }> = [
      { title: 'Doing', sub: 'Actions they take', h: 140, color: 'yellow', items: ['Hears about us from a colleague', 'Reads reviews and pricing', 'Starts a team trial', 'Imports a first project', 'Invites another team'] },
      { title: 'Thinking', sub: 'Questions on their mind', h: 140, color: 'blue', items: ['Could this replace our old tool?', 'Is it worth the price?', 'Will my team actually use it?', 'Where do I even start?', 'This saves us hours every week'] },
      { title: 'Feeling', sub: 'Mood at each stage', h: 100, emoji: true, items: ['🤔', '🧐', '😬', '🙂', '🤩'] },
      { title: 'Pain points', sub: 'What gets in the way', h: 140, color: 'coral', items: ['Hard to find real examples', 'Plan differences are unclear', 'Card required for the trial', 'An empty board feels daunting', 'No reward for referrals'] },
      { title: 'Opportunities', sub: 'How we could help', h: 140, color: 'green', items: ['Publish customer stories', 'Simple plan comparison table', 'Card-free trial', 'Starter templates on first open', 'Team referral credits'] },
    ];
    const headY = 168;
    let y = headY + 70 + 24;
    const laneY = lanes.map((l) => {
      const at = y;
      y += l.h + 16;
      return at;
    });
    const H = y + 32;
    k.frame('Customer journey', W, H);
    k.header('Customer journey', 'Walk through one persona stage by stage. Fill the lanes from real research quotes where you can.', W);
    stages.forEach((s, i) => {
      k.shape('chevron', x0 + i * (colW + gap), headY, colW, 70, `<b>${rt(s)}</b>`, { fill: i % 2 ? HEAD.violet : '#C9BEFF', fontSize: 19 });
    });
    lanes.forEach((l, li) => {
      const ly = laneY[li];
      k.panel(48, ly - 8, W - 96, l.h + 16, li % 2 ? '#FFFFFF' : TINT.gray);
      k.text(64, ly + 8, labelW - 24, `<b>${rt(l.title)}</b>`, { size: 18, h: 28 });
      k.text(64, ly + 36, labelW - 24, rt(l.sub), { size: 14, color: INK_SOFT, h: 44 });
      l.items.forEach((item, i) => {
        const x = x0 + i * (colW + gap);
        if (l.emoji) k.emoji(x + colW / 2 - 36, ly + (l.h - 72) / 2, 72, item);
        else k.sticky(x, ly, item, l.color!, colW, l.h);
      });
    });
    return k.done();
  },
};

export const roadmap: TemplateDef = {
  id: 'roadmap',
  name: 'Product roadmap',
  description: 'Four quarters across, product themes down, with cards for each initiative.',
  categories: ['strategy', 'planning'],
  keywords: ['roadmap', 'quarters', 'themes', 'product', 'timeline', 'okr'],
  build(newId) {
    const k = new Kit(newId);
    const labelW = 200;
    const colW = 400;
    const gap = 16;
    const x0 = 48 + labelW + gap;
    const W = x0 + 4 * colW + 3 * gap + 48;
    const quarters = ['Q1 · Jan–Mar', 'Q2 · Apr–Jun', 'Q3 · Jul–Sep', 'Q4 · Oct–Dec'];
    const cardH = 92;
    const rowH = 16 + 2 * cardH + 12 + 16;
    const themes: Array<{ title: string; goal: string; accent: string; tint: string; cells: Array<Array<[string, string]>> }> = [
      {
        title: 'Growth',
        goal: 'More teams find us and stay',
        accent: MINT,
        tint: TINT.mint,
        cells: [
          [['Referral program', 'Goal: 15% of signups from invites'], ['Self-serve team trial', 'No sales call needed']],
          [['Pricing page refresh', 'Clear plan comparison']],
          [['Education plan', 'Free for classrooms'], ['Partner directory', 'Agencies and consultants']],
          [['Annual billing discount', 'Two months free']],
        ],
      },
      {
        title: 'Core experience',
        goal: 'Fast, calm, delightful boards',
        accent: VIOLET,
        tint: TINT.violet,
        cells: [
          [['Faster board loading', 'Large boards open in under 2s']],
          [['Template gallery 2.0', 'Search and categories'], ['Mentions in comments', 'Notify by email']],
          [['Presentation mode', 'Frames as slides']],
          [['Offline editing', 'Sync when back online']],
        ],
      },
      {
        title: 'Platform',
        goal: 'Trusted by larger companies',
        accent: SKY,
        tint: TINT.sky,
        cells: [
          [['Public API (beta)', 'Boards, items, webhooks']],
          [['Single sign-on', 'For the business plan']],
          [['Audit log', 'Exportable, 1-year history']],
          [['EU data residency', 'Choose the storage region']],
        ],
      },
    ];
    const y0 = 160 + 56 + 16;
    const H = y0 + themes.length * (rowH + gap) - gap + 48;
    k.frame('Product roadmap', W, H);
    k.header('Product roadmap', 'Themes say why, cards say what. Keep later quarters lighter: the further out, the less certain.', W);
    quarters.forEach((q, i) => {
      k.shape('roundRect', x0 + i * (colW + gap), 160, colW, 56, `<b>${rt(q)}</b>`, { fill: HEAD.gray, fontSize: 19 });
    });
    themes.forEach((t, ti) => {
      const y = y0 + ti * (rowH + gap);
      k.panel(48, y, W - 96, rowH, t.tint);
      k.text(64, y + 16, labelW - 24, `<b>${rt(t.title)}</b>`, { size: 20, color: t.accent, h: 30 });
      k.text(64, y + 48, labelW - 24, rt(t.goal), { size: 14, color: INK_SOFT, h: 44 });
      t.cells.forEach((cell, qi) => {
        cell.forEach(([title, desc], j) => {
          k.card(x0 + qi * (colW + gap) + 12, y + 16 + j * (cardH + 12), colW - 24, cardH, title, desc, t.accent, null);
        });
      });
    });
    return k.done();
  },
};
