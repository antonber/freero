// Brainstorm-flavoured templates: idea burst, mind map, weather check-in.
import type { StickyColor } from '@freero/shared';
import { Kit, STICKY, rt } from '../kit';
import { AMBER, CORAL, INK_SOFT, MINT, ROSE, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const brainstorm: TemplateDef = {
  id: 'brainstorm',
  name: 'Idea burst',
  description: 'A central challenge with four idea clusters to fill, sort and vote on.',
  categories: ['brainstorm'],
  keywords: ['ideas', 'ideation', 'how might we', 'clusters', 'workshop'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1640;
    const H = 1080;
    k.frame('Idea burst', W, H);
    k.header('Idea burst', 'Write one idea per sticky. Go for quantity first, then cluster similar ideas and vote on the strongest three.', W);

    const topic = k.shape('ellipse', W / 2 - 200, 500, 400, 190, '<b>Our challenge</b><br>How might we help new teammates feel at home in their first week?', {
      fill: VIOLET,
      textColor: '#FFFFFF',
      fontSize: 20,
    });

    const gap = 16;
    const clusterW = 3 * STICKY + 2 * gap;
    const clusters: Array<{ title: string; color: StickyColor; accent: string; ideas: string[]; x: number; y: number }> = [
      { title: 'Quick wins', color: 'yellow', accent: AMBER, x: 64, y: 176, ideas: ['A buddy for the first week', 'Welcome message from the whole team', 'Laptop and accounts ready on day one'] },
      { title: 'Bold bets', color: 'violet', accent: VIOLET, x: W - 64 - clusterW, y: 176, ideas: ['Ship a small real project in week one', 'Self-serve setup checklist', 'A video wall to meet the team'] },
      { title: 'Questions to explore', color: 'blue', accent: SKY, x: 64, y: 790, ideas: ['What confused our last three hires?', 'Which tools take longest to set up?', 'Who do newcomers ask for help?'] },
      { title: 'Wild ideas', color: 'pink', accent: ROSE, x: W - 64 - clusterW, y: 790, ideas: ['Week-one scavenger hunt around the product', 'Swap desks with another team for a day', 'Day-one demo to the whole company'] },
    ];
    for (const c of clusters) {
      const top = c.y < 500;
      const left = c.x < W / 2;
      // Top clusters: label above the stickies; bottom clusters: label below, so the dashed
      // line from the challenge reaches the middle sticky without crossing any text.
      const stickyY = top ? c.y + 44 : c.y;
      k.text(c.x, top ? c.y : c.y + STICKY + 12, clusterW, `<b>${rt(c.title)}</b>`, { size: 22, color: c.accent, h: 34 });
      const ids = c.ideas.map((idea, i) => k.sticky(c.x + i * (STICKY + gap), stickyY, idea, c.color));
      k.connector(
        { id: topic, anchor: left ? 'left' : 'right' },
        { id: ids[1], anchor: top ? 'bottom' : 'top' },
        { routing: 'curved', strokeStyle: 'dashed', stroke: c.accent, endCap: 'none' },
      );
    }
    return k.els;
  },
};

export const mindmap: TemplateDef = {
  id: 'mindmap',
  name: 'Mind map starter',
  description: 'A central topic with branches and sub-ideas, ready to grow in both directions.',
  categories: ['brainstorm', 'diagramming'],
  keywords: ['mind map', 'mindmap', 'tree', 'branches', 'topics'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1640;
    const H = 920;
    k.frame('Mind map', W, H);
    k.header('Mind map starter', 'Select a node and add children to grow a branch. Keep each node to a few words.', W);

    const root = k.mindmap(W / 2 - 120, 488, 240, 68, 'Product launch', VIOLET, null, 'both');
    const branches: Array<{ text: string; color: string; side: 1 | -1; y: number; leaves: string[] }> = [
      { text: 'Audience', color: SKY, side: 1, y: 240, leaves: ['Teams of 5–50 people', 'Operations managers'] },
      { text: 'Channels', color: MINT, side: 1, y: 500, leaves: ['Monthly newsletter', 'Partner webinars'] },
      { text: 'Timeline', color: AMBER, side: 1, y: 760, leaves: ['Beta opens in May', 'Launch on June 12'] },
      { text: 'Messaging', color: ROSE, side: -1, y: 330, leaves: ['One-line pitch', 'Three proof points'] },
      { text: 'Risks', color: CORAL, side: -1, y: 670, leaves: ['Integrations ship late', 'Support load spikes'] },
    ];
    const childW = 190;
    const leafW = 210;
    for (const b of branches) {
      const cx = b.side === 1 ? W / 2 + 230 : W / 2 - 230 - childW;
      const child = k.mindmap(cx, b.y, childW, 52, b.text, b.color, root);
      b.leaves.forEach((leaf, i) => {
        const lx = b.side === 1 ? cx + childW + 90 : cx - 90 - leafW;
        k.mindmap(lx, b.y - 34 + i * 68, leafW, 44, leaf, b.color, child);
      });
    }
    return k.els;
  },
};

export const icebreaker: TemplateDef = {
  id: 'icebreaker',
  name: 'Weather check-in',
  description: 'A light warm-up: everyone places a sticky under the weather that matches their week.',
  categories: ['brainstorm', 'meetings'],
  keywords: ['icebreaker', 'check-in', 'warm up', 'mood', 'team'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 240;
    const gap = 16;
    const cols = [
      { emoji: '☀️', label: 'Sunny', hint: 'All good, full of energy', tint: TINT.amber },
      { emoji: '⛅', label: 'Partly cloudy', hint: 'Mostly fine, a few worries', tint: TINT.sky },
      { emoji: '🌧️', label: 'Rainy', hint: 'A tough week so far', tint: TINT.violet },
      { emoji: '⛈️', label: 'Stormy', hint: 'Overloaded, could use help', tint: TINT.coral },
      { emoji: '🌈', label: 'Clearing up', hint: 'Rough start, getting better', tint: TINT.mint },
    ];
    const W = 96 + cols.length * colW + (cols.length - 1) * gap;
    const H = 820;
    k.frame('Weather check-in', W, H);
    const y0 = k.header('Weather check-in', 'How is your week going? Add a sticky with your name under the weather that fits, plus one sentence about why.', W);
    cols.forEach((c, i) => {
      const x = 48 + i * (colW + gap);
      k.panel(x, y0 + 16, colW, H - y0 - 64, c.tint);
      k.emoji(x + colW / 2 - 44, y0 + 40, 88, c.emoji);
      k.text(x + 16, y0 + 140, colW - 32, `<b>${rt(c.label)}</b>`, { size: 20, align: 'center', h: 30 });
      k.text(x + 16, y0 + 172, colW - 32, rt(c.hint), { size: 15, color: INK_SOFT, align: 'center', h: 24 });
    });
    k.sticky(48 + 20, y0 + 220, 'Ana: shipped my first feature!', 'yellow', colW - 40, 150);
    k.sticky(48 + (colW + gap) + 20, y0 + 220, 'Leo: busy, but on track for Friday', 'blue', colW - 40, 150);
    k.sticky(48 + 4 * (colW + gap) + 20, y0 + 220, 'Your name: one sentence about your week', 'green', colW - 40, 150);
    return k.els;
  },
};
