// Education: lesson plan, KWL chart.
import type { StickyColor } from '@freero/shared';
import { Kit, list, rt } from '../kit';
import { AMBER, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const lessonPlan: TemplateDef = {
  id: 'lesson-plan',
  name: 'Lesson plan',
  description: 'Objectives, materials, a timed lesson flow, support and stretch, assessment and reflection.',
  categories: ['education', 'planning'],
  keywords: ['lesson plan', 'teacher', 'class', 'school', 'teaching', 'curriculum', 'learning objectives', 'classroom'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1680;
    const topH = 240;
    const flowY = 160 + topH + 24;
    const flowCols = [140, 280, 400, 400];
    const flowW = flowCols.reduce((a, b) => a + b, 0);
    const flowRows = [
      { h: 44, cells: ['Time', 'Phase', 'Teacher does', 'Students do'] },
      { h: 68, cells: ['0–5 min', 'Hook', 'Shows a photo of a puddle drying in the sun', 'Guess where the water went'] },
      { h: 68, cells: ['5–15 min', 'Explore', 'Runs the warm-jar experiment', 'Observe and note what they see'] },
      { h: 68, cells: ['15–35 min', 'Practice', 'Circulates and asks “why?”', 'Draw and label the water cycle in pairs'] },
      { h: 68, cells: ['35–45 min', 'Share', 'Picks three diagrams to compare', 'Explain their diagram to the class'] },
      { h: 68, cells: ['45–50 min', 'Exit ticket', 'Collects answers', 'Answer two questions on their own'] },
    ];
    const flowH = flowRows.reduce((a, r) => a + r.h, 0);
    const endY = flowY + flowH + 24;
    const endH = 200;
    k.frame('Lesson plan', W, endY + endH + 48);
    k.header('Lesson plan', 'Start from what students should be able to do at the end, then plan backwards. Keep timings honest: transitions take time too.', W);

    k.table(48, 160, [180, 300], [
      { h: 40, cells: ['Subject', 'Science'] },
      { h: 40, cells: ['Class', 'Year 5'] },
      { h: 40, cells: ['Topic', 'The water cycle'] },
      { h: 40, cells: ['Length', '50 minutes'] },
      { h: 40, cells: ['Date', ''] },
      { h: 40, cells: ['Teacher', ''] },
    ], { header: false, fills: { 0: TINT.violet } });

    let y = k.section(552, 160, 540, topH, 'Learning objectives', TINT.violet, { accent: VIOLET, hint: 'By the end, students will be able to…' });
    k.text(576, y, 492, list(['Name the four stages of the water cycle', 'Explain evaporation with an example', 'Draw the cycle with arrows and labels']), { size: 19, h: topH - (y - 160) - 16 });

    y = k.section(1116, 160, W - 48 - 1116, topH, 'Materials', TINT.amber, { accent: AMBER });
    k.text(1140, y, W - 48 - 1140 - 24, list(['Glass jar, hot water, ice, plate', 'Photo of a puddle', 'Paper and colored pencils', 'Exit ticket cards']), { size: 19, h: topH - (y - 160) - 16 });

    k.table(48, flowY, flowCols, flowRows);
    const sx = 48 + flowW + 24;
    const sw = W - 48 - sx;
    y = k.section(sx, flowY, sw, flowH, 'Support & stretch', TINT.sky, { accent: SKY, hint: 'Same goal, different routes.' });
    k.sticky(sx + 24, y, 'Support: a diagram with the arrows already drawn, words to place', 'blue', sw - 48, 150);
    k.sticky(sx + 24, y + 166, 'Stretch: where does the water cycle slow down, and why?', 'green', sw - 48, 150);

    const half = (W - 96 - 24) / 2;
    y = k.section(48, endY, half, endH, 'Assessment', TINT.mint, { accent: MINT, hint: 'How will you know they got it?' });
    k.text(72, y, half - 48, list(['Exit ticket: name two stages and explain one', 'Diagrams checked against the three objectives']), { size: 18, h: endH - (y - endY) - 12 });
    y = k.section(48 + half + 24, endY, half, endH, 'Reflection', TINT.gray, { hint: 'After class: what worked, what would you change?' });
    const notes: Array<[string, StickyColor]> = [['Worked: …', 'green'], ['Change next time: …', 'coral'], ['Follow up with: …', 'yellow']];
    notes.forEach(([t, c], i) => k.sticky(48 + half + 48 + i * 236, y, t, c, 220, 84));
    return k.done();
  },
};

export const kwl: TemplateDef = {
  id: 'kwl-chart',
  name: 'KWL chart',
  description: 'What students already Know, Want to know, and Learned about a topic.',
  categories: ['education', 'research'],
  keywords: ['kwl', 'know want learned', 'classroom', 'students', 'inquiry', 'learning', 'reflection', 'school'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 460;
    const W = 96 + 3 * colW + 2 * 24;
    const colY = 256;
    const colH = 560;
    k.frame('KWL chart', W, colY + colH + 48);
    k.header('KWL chart', 'Fill K and W before the topic starts, and L at the end. Check which of the W questions got answered.', W);
    k.shape('roundRect', 48, 160, W - 96, 72, '<b>Topic:</b> Volcanoes', { fill: '#FFFFFF', stroke: VIOLET, strokeWidth: 2, fontSize: 22 });
    const cols: Array<{ title: string; hint: string; tint: string; accent: string; color: StickyColor; notes: string[] }> = [
      { title: 'K · What I know', hint: 'Before we start', tint: TINT.sky, accent: SKY, color: 'blue', notes: ['Lava is very hot', 'Some are under the sea', 'Add what you know…'] },
      { title: 'W · What I want to know', hint: 'Questions to explore', tint: TINT.amber, accent: AMBER, color: 'yellow', notes: ['Why do they erupt?', 'Can we predict eruptions?', 'Add a question…'] },
      { title: 'L · What I learned', hint: 'At the end of the topic', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Magma rises because it is lighter than rock', 'Add what you learned…'] },
    ];
    cols.forEach((c, i) => {
      const x = 48 + i * (colW + 24);
      const y = k.section(x, colY, colW, colH, c.title, c.tint, { accent: c.accent, hint: c.hint, size: 24 });
      k.stickies(x + 24, y, colW - 48, c.notes, c.color, (colW - 48 - 16) / 2);
    });
    return k.done();
  },
};
