// Diagramming: org chart, sitemap, swimlane process, Venn diagram, project timeline.
import type { StickyColor } from '@freero/shared';
import { Kit, rt, titled } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, LINE, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const orgChart: TemplateDef = {
  id: 'org-chart',
  name: 'Org chart',
  description: 'Who leads what: a three-level reporting tree with connected, editable boxes.',
  categories: ['diagramming'],
  keywords: ['org chart', 'organization', 'organisation', 'hierarchy', 'team structure', 'reporting', 'tree'],
  build(newId) {
    const k = new Kit(newId);
    const leafW = 220;
    const gap = 32;
    const W = 96 + 6 * leafW + 5 * gap;
    const levelY = [176, 352, 528];
    const boxH = 96;
    k.frame('Org chart', W, levelY[2] + boxH + 72);
    k.header('Org chart', 'Double-click a box to rename it. Duplicate a box and connect it to add a person; the lines follow when you move boxes.', W);

    const ceo = k.shape('roundRect', W / 2 - 140, levelY[0], 280, boxH, titled('Jordan Lee', 'Chief Executive'), { fill: VIOLET, textColor: '#FFFFFF', fontSize: 18 });
    const depts: Array<{ lead: [string, string]; fill: string; tint: string; accent: string; team: Array<[string, string]> }> = [
      { lead: ['Amara Okafor', 'VP Product'], fill: HEAD.violet, tint: TINT.violet, accent: VIOLET, team: [['Leo Martins', 'Design Lead'], ['Mei Chen', 'Product Manager']] },
      { lead: ['Tomás Ruiz', 'VP Engineering'], fill: HEAD.sky, tint: TINT.sky, accent: SKY, team: [['Ines Duarte', 'Web Team Lead'], ['Sven Larsen', 'Platform Lead']] },
      { lead: ['Hana Sato', 'VP Customers'], fill: HEAD.mint, tint: TINT.mint, accent: MINT, team: [['Ravi Patel', 'Support Lead'], ['Clara Novak', 'Sales Lead']] },
    ];
    depts.forEach((d, i) => {
      const center = 48 + 2 * i * (leafW + gap) + (2 * leafW + gap) / 2;
      const lead = k.shape('roundRect', center - 120, levelY[1], 240, boxH, titled(...d.lead), { fill: d.fill, fontSize: 17 });
      k.connector({ id: ceo, anchor: 'bottom' }, { id: lead, anchor: 'top' }, { endCap: 'none' });
      d.team.forEach(([name, role], j) => {
        const x = 48 + (2 * i + j) * (leafW + gap);
        const member = k.shape('roundRect', x, levelY[2], leafW, boxH, titled(name, role), { fill: d.tint, stroke: d.accent, strokeWidth: 2, fontSize: 16 });
        k.connector({ id: lead, anchor: 'bottom' }, { id: member, anchor: 'top' }, { endCap: 'none' });
      });
    });
    return k.done();
  },
};

export const sitemap: TemplateDef = {
  id: 'sitemap',
  name: 'Sitemap',
  description: 'The pages of a website or app as a tree: home, main sections and the pages inside them.',
  categories: ['diagramming', 'research'],
  keywords: ['sitemap', 'site map', 'information architecture', 'ia', 'navigation', 'pages', 'website', 'structure'],
  build(newId) {
    const k = new Kit(newId);
    const secW = 240;
    const gap = 32;
    const W = 96 + 5 * secW + 4 * gap;
    const secY = 336;
    const pageY = 448;
    const pageH = 56;
    const sections: Array<{ name: string; fill: string; tint: string; accent: string; pages: string[] }> = [
      { name: 'Product', fill: HEAD.violet, tint: TINT.violet, accent: VIOLET, pages: ['Features', 'Templates', 'Integrations'] },
      { name: 'Pricing', fill: HEAD.mint, tint: TINT.mint, accent: MINT, pages: ['Plans', 'FAQ'] },
      { name: 'Customers', fill: HEAD.sky, tint: TINT.sky, accent: SKY, pages: ['Stories', 'Education'] },
      { name: 'Resources', fill: HEAD.amber, tint: TINT.amber, accent: AMBER, pages: ['Help center', 'Blog', 'Guides'] },
      { name: 'Company', fill: HEAD.rose, tint: TINT.rose, accent: '#E2559B', pages: ['About', 'Careers', 'Contact'] },
    ];
    const maxPages = Math.max(...sections.map((s) => s.pages.length));
    k.frame('Sitemap', W, pageY + maxPages * (pageH + 20) - 20 + 64);
    k.header('Sitemap', 'One box per page. Keep the top level to five or six sections, and no page more than three clicks from home.', W);
    const home = k.shape('roundRect', W / 2 - 140, 176, 280, 80, '<b>Home</b>', { fill: VIOLET, textColor: '#FFFFFF', fontSize: 20 });
    sections.forEach((s, i) => {
      const x = 48 + i * (secW + gap);
      const sec = k.shape('roundRect', x, secY, secW, 72, `<b>${rt(s.name)}</b>`, { fill: s.fill, fontSize: 18 });
      k.connector({ id: home, anchor: 'bottom' }, { id: sec, anchor: 'top' }, { endCap: 'none' });
      s.pages.forEach((p, j) => {
        const page = k.shape('rect', x + 40, pageY + j * (pageH + 20), secW - 40, pageH, rt(p), { fill: '#FFFFFF', stroke: s.accent, strokeWidth: 2, fontSize: 16 });
        k.connector({ id: sec, anchor: 'left' }, { id: page, anchor: 'left' }, { endCap: 'none' });
      });
    });
    return k.done();
  },
};

export const swimlane: TemplateDef = {
  id: 'swimlane',
  name: 'Swimlane process',
  description: 'A process across three teams: who does each step, and where work changes hands.',
  categories: ['diagramming', 'planning'],
  keywords: ['swimlane', 'swim lane', 'process', 'cross-functional', 'flowchart', 'handoff', 'workflow', 'bpmn'],
  build(newId) {
    const k = new Kit(newId);
    const labelW = 180;
    const W = 1800;
    const laneH = 200;
    const lanes: Array<{ name: string; sub: string; tint: string }> = [
      { name: 'Customer', sub: 'Outside the company', tint: TINT.sky },
      { name: 'Support', sub: 'First line', tint: TINT.violet },
      { name: 'Engineering', sub: 'Product team', tint: TINT.mint },
    ];
    const laneY = lanes.map((_, i) => 168 + i * (laneH + 16));
    k.frame('Swimlane process', W, laneY[2] + laneH + 48);
    k.header('Swimlane process', 'One lane per role. Every arrow that crosses a lane is a handoff: those are where delays and mistakes hide.', W);
    lanes.forEach((l, i) => {
      k.panel(48, laneY[i], W - 96, laneH, l.tint);
      k.text(64, laneY[i] + 20, labelW - 24, `<b>${rt(l.name)}</b>`, { size: 20, h: 30 });
      k.text(64, laneY[i] + 52, labelW - 24, rt(l.sub), { size: 14, color: INK_SOFT, h: 22 });
    });
    const step = { fill: '#FFFFFF', stroke: LINE, strokeWidth: 2, fontSize: 17 };
    const at = (lane: number, h: number) => laneY[lane] + (laneH - h) / 2;
    const report = k.shape('ellipse', 260, at(0, 96), 200, 96, '<b>Reports a problem</b>', { fill: TINT.mint, stroke: MINT, strokeWidth: 2, fontSize: 17 });
    const log = k.shape('roundRect', 520, at(1, 96), 200, 96, 'Log the ticket', step);
    const known = k.shape('diamond', 780, at(1, 150), 200, 150, '<b>Known issue?</b>', { fill: TINT.amber, stroke: AMBER, strokeWidth: 2, fontSize: 17 });
    const article = k.shape('roundRect', 1060, at(1, 96), 200, 96, 'Send the help article', step);
    const fix = k.shape('roundRect', 1060, at(2, 96), 200, 96, 'Investigate and fix', step);
    const release = k.shape('roundRect', 1320, at(2, 96), 200, 96, 'Release the fix', step);
    const done = k.shape('ellipse', 1520, at(0, 96), 200, 96, '<b>Problem solved</b>', { fill: TINT.mint, stroke: MINT, strokeWidth: 2, fontSize: 17 });
    k.connector({ id: report, anchor: 'bottom' }, { id: log, anchor: 'left' });
    k.connector({ id: log, anchor: 'right' }, { id: known, anchor: 'left' }, { routing: 'straight' });
    k.connector({ id: known, anchor: 'right' }, { id: article, anchor: 'left' }, { routing: 'straight', label: 'Yes' });
    k.connector({ id: known, anchor: 'bottom' }, { id: fix, anchor: 'left' }, { label: 'No' });
    k.connector({ id: fix, anchor: 'right' }, { id: release, anchor: 'left' }, { routing: 'straight' });
    k.connector({ id: article, anchor: 'top' }, { id: done, anchor: 'left' });
    k.connector({ id: release, anchor: 'top' }, { id: done, anchor: 'bottom' });
    return k.done();
  },
};

export const venn: TemplateDef = {
  id: 'venn',
  name: 'Venn diagram',
  description: 'Three overlapping circles to compare ideas and find what they share.',
  categories: ['diagramming', 'education'],
  keywords: ['venn', 'compare', 'contrast', 'overlap', 'circles', 'similarities', 'differences', 'sets'],
  build(newId) {
    const k = new Kit(newId);
    const r = 260;
    const a = { x: 64 + r, y: 220 + r };
    const b = { x: a.x + 300, y: a.y };
    const c = { x: a.x + 150, y: a.y + 260 };
    const sideX = b.x + r + 48;
    const sideW = 360;
    const W = sideX + sideW + 48;
    const H = c.y + r + 72;
    k.frame('Venn diagram', W, H);
    k.header('Venn diagram', 'Rename the three circles. Put each sticky where it belongs: in one circle, in an overlap, or in the middle if all three share it.', W);
    const circles: Array<{ at: { x: number; y: number }; stroke: string; label: string }> = [
      { at: a, stroke: VIOLET, label: 'Remote work' },
      { at: b, stroke: SKY, label: 'Office work' },
      { at: c, stroke: MINT, label: 'Hybrid work' },
    ];
    for (const ci of circles) k.shape('ellipse', ci.at.x - r, ci.at.y - r, 2 * r, 2 * r, '', { fill: ci.stroke, fillOpacity: 0.12, stroke: ci.stroke, strokeWidth: 3 });
    k.text(a.x - r, 168, 260, `<b>${rt(circles[0].label)}</b>`, { size: 22, color: VIOLET, h: 32 });
    k.text(b.x + r - 260, 168, 260, `<b>${rt(circles[1].label)}</b>`, { size: 22, color: SKY, h: 32, align: 'right' });
    k.text(c.x - 130, c.y + r + 8, 260, `<b>${rt(circles[2].label)}</b>`, { size: 22, color: MINT, h: 32, align: 'center' });

    const notes: Array<[number, number, number, string, StickyColor]> = [
      [a.x - 200, a.y - 90, 110, 'No commute', 'violet'],
      [b.x + 90, b.y - 90, 110, 'Hallway chats', 'blue'],
      [c.x - 55, c.y + 100, 110, 'Pick your days', 'green'],
      [a.x + 100, a.y - 160, 100, 'Video calls', 'yellow'],
      [c.x - 45, a.y + 60, 90, 'Shared goals', 'orange'],
    ];
    for (const [x, y, size, t, color] of notes) k.sticky(x, y, t, color, size);

    const y = k.section(sideX, 220, sideW, 480, 'Notes to sort', TINT.gray, { hint: 'Drag each one into the diagram.' });
    k.stickies(sideX + 24, y, sideW - 48, ['Flexible hours', 'Desk booking', 'Team lunches', 'Async updates'], 'yellow', 148);
    return k.done();
  },
};

export const timeline: TemplateDef = {
  id: 'timeline',
  name: 'Project timeline',
  description: 'Six milestones along a time line, with what happens at each and who is involved.',
  categories: ['planning', 'diagramming'],
  keywords: ['timeline', 'milestones', 'schedule', 'project plan', 'history', 'gantt', 'phases', 'dates'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1800;
    const lineY = 440;
    const step = 268;
    const firstX = 186;
    k.frame('Project timeline', W, 740);
    k.header('Project timeline', 'Move the milestones to your dates. Cards above and below alternate only to keep them readable.', W);
    k.connector({ x: 72, y: lineY }, { x: W - 72, y: lineY }, { routing: 'straight', strokeWidth: 4, stroke: LINE });
    const events: Array<[string, string, string, string]> = [
      ['Jan', 'Kickoff', 'Goals, team and budget agreed', VIOLET],
      ['Feb', 'Research done', '12 interviews, top 3 problems', SKY],
      ['Mar', 'First prototype', 'Tested with 5 customers', MINT],
      ['Apr', 'Beta', '50 teams, weekly feedback', AMBER],
      ['May', 'Launch', 'Announcement and docs', CORAL],
      ['Jun', 'Review', 'Metrics and next steps', VIOLET],
    ];
    events.forEach(([month, title, desc, color], i) => {
      const x = firstX + i * step;
      const above = i % 2 === 0;
      const mark = k.shape('diamond', x - 16, lineY - 16, 32, 32, '', { fill: color, stroke: '#FFFFFF', strokeWidth: 3 });
      k.text(x - 60, above ? lineY + 26 : lineY - 56, 120, `<b>${rt(month)}</b>`, { size: 18, align: 'center', color: INK_SOFT, h: 28 });
      const card = k.card(x - 120, above ? 200 : 540, 240, 120, title, desc, color);
      k.connector(above ? { id: card, anchor: 'bottom' } : { id: card, anchor: 'top' }, { id: mark, anchor: above ? 'top' : 'bottom' }, { routing: 'straight', strokeStyle: 'dashed', endCap: 'none' });
    });
    return k.done();
  },
};
