// Education: lesson plan, KWL chart, concept map, exit ticket, Frayer model, class brainstorm,
// revision timetable.
import type { StickyColor } from '@freero/shared';
import { CircleQuestionMark, Lightbulb, Sparkles } from 'lucide-react';
import { Kit, list, rt, titled, type TableCell } from '../kit';
import { AMBER, CORAL, HEAD, INK_SOFT, LINE, MINT, ROSE, SKY, TINT, VIOLET } from '../palette';
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

export const conceptMap: TemplateDef = {
  id: 'concept-map',
  name: 'Concept map',
  description: 'Ideas linked by labelled arrows that say how they relate, around photosynthesis.',
  categories: ['education', 'diagramming'],
  keywords: ['concept map', 'concepts', 'relationships', 'linking words', 'knowledge map', 'science', 'connections', 'graphic organizer'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1680;
    const H = 980;
    k.frame('Concept map', W, H);
    k.header('Concept map: photosynthesis', 'Every arrow carries a linking word so each pair reads as a sentence: “photosynthesis needs sunlight”.', W);
    const node = (x: number, y: number, text: string, fill: string, stroke: string, w = 220, h = 72) =>
      k.shape('roundRect', x, y, w, h, `<b>${rt(text)}</b>`, { fill, stroke, strokeWidth: 2, fontSize: 19 });
    const plants = node(730, 176, 'Plants', HEAD.mint, MINT);
    const photo = k.shape('ellipse', 690, 340, 300, 104, '<b>Photosynthesis</b>', { fill: VIOLET, textColor: '#FFFFFF', fontSize: 22 });
    const row = 600;
    const xs = [96, 420, 740, 1080, 1380];
    const sun = node(xs[0], row, 'Sunlight', HEAD.amber, AMBER);
    const water = node(xs[1], row, 'Water', HEAD.sky, SKY);
    const co2 = node(xs[2], row, 'Carbon dioxide', TINT.gray, LINE);
    const glucose = node(xs[3], row, 'Glucose (sugar)', HEAD.amber, AMBER);
    const oxygen = node(xs[4], row, 'Oxygen', HEAD.sky, SKY);
    const chloro = node(xs[0], 820, 'Chlorophyll', HEAD.mint, MINT);
    const leaves = node(xs[1], 820, 'Leaves', HEAD.mint, MINT);
    const growth = node(xs[3], 820, 'Energy to grow', '#FFFFFF', LINE);
    const animals = node(xs[4], 820, 'Animals and people', '#FFFFFF', LINE);
    const link = (a: string, as: 'top' | 'right' | 'bottom' | 'left', b: string, bs: 'top' | 'right' | 'bottom' | 'left', label: string) =>
      k.connector({ id: a, anchor: as }, { id: b, anchor: bs }, { routing: 'straight', label, stroke: LINE });
    link(plants, 'bottom', photo, 'top', 'carry out');
    for (const t of [sun, water, co2]) link(photo, 'bottom', t, 'top', 'needs');
    for (const t of [glucose, oxygen]) link(photo, 'bottom', t, 'top', 'makes');
    link(sun, 'bottom', chloro, 'top', 'is caught by');
    link(chloro, 'right', leaves, 'left', 'is found in');
    link(glucose, 'bottom', growth, 'top', 'gives');
    link(oxygen, 'bottom', animals, 'top', 'is breathed by');
    k.text(1180, 176, 452, titled('Linking words to try', 'needs · makes · is part of · causes · is used for · depends on'), { size: 17, color: INK_SOFT, h: 60 });
    return k.done();
  },
};

export const exitTicket: TemplateDef = {
  id: 'exit-ticket',
  name: 'Exit ticket (3-2-1)',
  description: 'End-of-lesson check: three things learned, two found interesting, one question, and a confidence stamp.',
  categories: ['education', 'meetings'],
  keywords: ['exit ticket', '3-2-1', 'plenary', 'check for understanding', 'formative assessment', 'reflection', 'end of lesson', 'exit slip'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 440;
    const W = 96 + 3 * colW + 2 * 24;
    const colH = 460;
    const lowY = 160 + colH + 24;
    const lowH = 220;
    k.frame('Exit ticket', W, lowY + lowH + 48);
    k.header('Exit ticket · 3-2-1', 'Two minutes before the bell: everyone adds their stickies, then stamps how confident they feel.', W);
    const cols: Array<{ title: string; icon: typeof Lightbulb; tint: string; accent: string; color: StickyColor; notes: string[] }> = [
      { title: '3 things I learned', icon: Lightbulb, tint: TINT.mint, accent: MINT, color: 'green', notes: ['Learned…', 'Learned…', 'Learned…'] },
      { title: '2 things I found interesting', icon: Sparkles, tint: TINT.amber, accent: AMBER, color: 'yellow', notes: ['Interesting…', 'Interesting…'] },
      { title: '1 question I still have', icon: CircleQuestionMark, tint: TINT.violet, accent: VIOLET, color: 'violet', notes: ['My question…'] },
    ];
    cols.forEach((c, i) => {
      const x = 48 + i * (colW + 24);
      const y = k.section(x, 160, colW, colH, c.title, c.tint, { accent: c.accent, icon: c.icon });
      k.stickies(x + 24, y, colW - 48, c.notes, c.color, (colW - 48 - 16) / 2);
    });
    const y = k.section(48, lowY, W - 96, lowH, 'How confident do you feel about today?', TINT.gray, { hint: 'Stamp a reaction next to the face that fits.' });
    const faces: Array<[string, string]> = [
      ['😟', 'Lost'],
      ['😐', 'Unsure'],
      ['🙂', 'Mostly there'],
      ['😄', 'Could teach it'],
    ];
    faces.forEach(([e, label], i) => {
      const x = 72 + i * 340;
      k.emoji(x, y, 72, e);
      k.text(x + 88, y + 20, 220, `<b>${rt(label)}</b>`, { size: 18, h: 30 });
    });
    return k.done();
  },
};

export const frayerModel: TemplateDef = {
  id: 'frayer-model',
  name: 'Frayer model',
  description: 'A word in the middle with its definition, characteristics, examples and non-examples around it.',
  categories: ['education'],
  keywords: ['frayer model', 'vocabulary', 'word map', 'definition', 'examples', 'non-examples', 'concept', 'graphic organizer', 'key terms'],
  build(newId) {
    const k = new Kit(newId);
    const qw = 640;
    const qh = 340;
    const gap = 24;
    const W = 96 + 2 * qw + gap;
    const top = 160;
    const bottom = top + qh + gap;
    k.frame('Frayer model', W, bottom + qh + 48);
    k.header('Frayer model', 'Write the word in the middle, then fill all four corners. Non-examples are often the most useful part.', W);
    const right = 48 + qw + gap;
    k.panel(48, top, qw, qh, TINT.sky);
    k.panel(right, top, qw, qh, TINT.mint);
    k.panel(48, bottom, qw, qh, TINT.amber);
    k.panel(right, bottom, qw, qh, TINT.coral);
    const title = (x: number, y: number, t: string, color: string, align: 'left' | 'right' = 'left') =>
      k.text(x, y, 300, `<b>${rt(t)}</b>`, { size: 22, color, align, h: 32 });
    title(72, top + 18, 'Definition', SKY);
    title(right + qw - 324, top + 18, 'Characteristics', MINT, 'right');
    title(72, bottom + qh - 50, 'Examples', AMBER);
    title(right + qw - 324, bottom + qh - 50, 'Non-examples', CORAL, 'right');
    // The word sits where the four corners meet; nothing else reaches into the middle.
    const cx = 48 + qw + gap / 2;
    const cy = top + qh + gap / 2;
    k.shape('ellipse', cx - 170, cy - 64, 340, 128, '<b>Polygon</b>', { fill: '#FFFFFF', stroke: VIOLET, strokeWidth: 3, fontSize: 32 });
    k.sticky(72, top + 66, 'A flat, closed shape made only of straight sides', 'blue', 360, 200);
    k.text(right + 24, top + 66, qw - 48, list(['Flat (two-dimensional)', 'Closed: no gaps', 'Straight sides only', 'At least three sides']), { size: 19, h: 200 });
    const ex: Array<['triangle' | 'pentagon' | 'hexagon', string]> = [
      ['triangle', 'Triangle'],
      ['pentagon', 'Pentagon'],
      ['hexagon', 'Hexagon'],
    ];
    ex.forEach(([s, label], i) => {
      const x = 72 + i * 140;
      k.shape(s, x, bottom + 80, 110, 100, '', { fill: HEAD.amber, stroke: AMBER });
      k.text(x - 5, bottom + 188, 120, rt(label), { size: 16, align: 'center', h: 26 });
    });
    const non: Array<['ellipse' | 'cylinder' | 'arrowRight', string]> = [
      ['ellipse', 'Circle'],
      ['cylinder', 'Cylinder (3D)'],
    ];
    non.forEach(([s, label], i) => {
      const x = right + 220 + i * 150;
      k.shape(s, x, bottom + 80, 110, 100, '', { fill: HEAD.coral, stroke: CORAL });
      k.text(x - 15, bottom + 188, 140, rt(label), { size: 16, align: 'center', h: 26 });
    });
    k.sticky(right + 520, bottom + 70, 'An open zig-zag line', 'pink', 100, 130);
    return k.done();
  },
};

export const classBrainstorm: TemplateDef = {
  id: 'class-brainstorm',
  name: 'Class brainstorm',
  description: 'A topic web for the whole class: a big question, themes as branches, ideas as leaves.',
  categories: ['education', 'brainstorm'],
  keywords: ['class brainstorm', 'classroom', 'students', 'mind map', 'topic web', 'spider diagram', 'group ideas', 'school'],
  build(newId) {
    const k = new Kit(newId);
    const cols = [
      { w: 280, h: 96 },
      { w: 200, h: 56 },
      { w: 300, h: 48 },
    ];
    const gap = 80;
    const rowH = 64;
    const treeW = cols.reduce((a, c) => a + c.w, 0) + 2 * gap;
    const sideW = 420;
    const W = 48 + treeW + 48 + sideW + 48;
    const leaves = 10;
    const treeY = 176;
    k.frame('Class brainstorm', W, treeY + leaves * rowH + 48);
    k.header('Class brainstorm', 'Each group grows one branch. Add a leaf per idea; questions are welcome too.', W);
    k.mindTree(48, treeY, cols, gap, rowH, {
      text: 'What will our town be like in 50 years?',
      color: VIOLET,
      children: [
        { text: 'Getting around', color: SKY, children: [{ text: 'Self-driving buses?' }, { text: 'More bike lanes' }] },
        { text: 'Homes', color: AMBER, children: [{ text: 'Solar roofs everywhere' }] },
        { text: 'Nature', color: MINT, children: [{ text: 'A forest by the river' }, { text: 'Cleaner air' }] },
        { text: 'Work', color: ROSE, children: [{ text: 'Jobs that don’t exist yet' }] },
        { text: 'School', color: CORAL, children: [{ text: 'Lessons outdoors' }, { text: 'Robot helpers?' }] },
        { text: 'Fun', color: INK_SOFT, children: [{ text: 'A skate park' }, { text: 'Add an idea…' }] },
      ],
    });
    const sx = 48 + treeW + 48;
    const y = k.section(sx, 160, sideW, leaves * rowH + 16, 'Brainstorm rules', TINT.violet, { accent: VIOLET });
    k.text(sx + 24, y, sideW - 48, list(['Every idea counts', 'Build on each other’s ideas', 'Go for lots of ideas', 'Stay on the question', 'Be kind'], true), { size: 20, h: 200 });
    k.sticky(sx + 24, y + 224, 'Word bank: transport, energy, community, future, change', 'yellow', sideW - 48, 180);
    return k.done();
  },
};

export const revisionTimetable: TemplateDef = {
  id: 'revision-timetable',
  name: 'Revision timetable',
  description: 'A week of study sessions colored by subject, with exam dates and study tips.',
  categories: ['education', 'planning'],
  keywords: ['revision timetable', 'study planner', 'study schedule', 'exam prep', 'exams', 'homework', 'timetable', 'revision', 'table'],
  build(newId) {
    const k = new Kit(newId);
    const subjects: Record<string, string> = { Maths: HEAD.violet, Biology: HEAD.mint, History: HEAD.amber, English: HEAD.sky, French: HEAD.rose, Break: HEAD.gray };
    const c = (s: string): string | TableCell => (s ? { t: s, f: subjects[s] } : '');
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const slots: Array<[string, string[]]> = [
      ['16:00', ['Maths', 'Biology', 'English', 'Maths', 'History', 'Maths', '']],
      ['16:45', ['History', 'French', 'Maths', 'Biology', 'English', 'Biology', '']],
      ['17:30', ['Break', 'Break', 'Break', 'Break', 'Break', 'Break', '']],
      ['19:00', ['English', 'Maths', 'History', 'French', '', 'History', 'Plan next week']],
      ['19:45', ['French', '', 'Biology', '', '', '', '']],
    ];
    const rows = [{ h: 48, cells: ['', ...days] }, ...slots.map(([t, v]) => ({ h: 64, cells: [t, ...v.map((s) => (s === 'Plan next week' ? s : c(s)))] }))];
    const cols = [120, ...days.map(() => 170)];
    const tw = cols.reduce((a, b) => a + b, 0);
    const th = rows.reduce((a, r) => a + r.h, 0);
    const W = 96 + tw;
    const lowY = 160 + th + 24;
    const lowH = 250;
    k.frame('Revision timetable', W, lowY + lowH + 48);
    k.header('Revision timetable', '45-minute sessions with a break after two. Mix subjects in a day, and put the hardest one first.', W);
    k.table(48, 160, cols, rows);
    k.table(48, lowY, [220, 180], [
      { h: 44, cells: ['Exam', 'Date'] },
      ...['Maths', 'Biology', 'History', 'English'].map((s, i) => ({ h: 48, cells: [c(s), `${12 + i * 3} May`] })),
    ]);
    const sx = 48 + 400 + 24;
    const y = k.section(sx, lowY, W - 48 - sx, lowH, 'Study tips', TINT.gray);
    const tips: Array<[string, StickyColor]> = [
      ['Test yourself instead of re-reading', 'green'],
      ['Phone in another room', 'yellow'],
      ['Tick off a session when it’s done', 'blue'],
    ];
    tips.forEach(([t, col], i) => k.sticky(sx + 24 + i * 244, y, t, col, 228, lowH - (y - lowY) - 20));
    return k.done();
  },
};
