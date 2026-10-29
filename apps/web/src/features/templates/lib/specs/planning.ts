// Planning templates (specs: see ../spec/types.ts; after editing run `npm run templates:index`).
import type { TemplateSpec } from '../spec/types';

const specs: TemplateSpec[] = [
  {
    id: 'project-charter',
    name: 'Project charter',
    description: 'The agreement a sponsor signs before work starts: why the project exists, what is in and out, who decides and what done means.',
    categories: ['planning', 'operations'],
    keywords: ['project charter', 'scope', 'sponsor', 'project initiation', 'objectives', 'constraints', 'governance', 'pmo'],
    hint: 'Short enough to read in five minutes, firm enough to say no with. Get the sponsor to agree to "out of scope" as much as "in scope".',
    archetype: 'canvas',
    cols: 3,
    sections: [
      { title: 'Why this project', span: 2, tone: 'violet', prompt: 'The problem or opportunity, and what happens if we do nothing.', notes: ['Clinic phones ring 400 times a day; patients wait 9 min', 'Two receptionists leaving in spring'] },
      { title: 'Objectives', tone: 'mint', prompt: 'Measurable results the project must deliver.', notes: ['60% of bookings online by October', 'Average phone wait under 2 min'] },
      { title: 'In scope', tone: 'sky', prompt: 'What the project will deliver.', notes: ['Online booking for 3 clinics', 'SMS reminders'] },
      { title: 'Out of scope', tone: 'coral', prompt: 'What it will not do, even if asked.', notes: ['Video consultations', 'Billing system changes'] },
      { title: 'Constraints', tone: 'amber', prompt: 'Budget, dates, rules we must work within.', notes: ['€80k budget', 'Patient data stays in the EU', 'Live before flu season'] },
      { title: 'People and decisions', tone: 'rose', prompt: 'Sponsor, lead, team, and who decides what.', notes: ['Sponsor: Dr. Weber (signs off scope)', 'Lead: Kim (day-to-day calls)'] },
      { title: 'Risks', tone: 'gray', prompt: 'What could stop us, and the plan for each.', notes: ['Older patients keep phoning: keep one line staffed'] },
      { title: 'Done means', tone: 'mint', prompt: 'How will the sponsor know the project is finished?', notes: ['All 3 clinics live for 4 weeks', 'Targets met two months running'] },
    ],
  },
  {
    id: 'budget-plan',
    name: 'Budget plan',
    description: 'Planned against actual spend per line, with variance and a note for each gap, so budget talks start from the same numbers.',
    categories: ['planning', 'operations'],
    keywords: ['budget', 'budget plan', 'spending', 'forecast', 'variance', 'costs', 'finance', 'expenses'],
    hint: 'Fill planned at the start, actuals monthly. Explain every variance over 10% in a sentence; colour shows where to look first.',
    archetype: 'table',
    columns: [
      { title: 'Line', w: 260 },
      { title: 'Owner', w: 130 },
      { title: 'Planned', w: 140 },
      { title: 'Actual to date', w: 160 },
      { title: 'Variance', w: 150 },
      { title: 'Why, and what we do', w: 360 },
    ],
    rows: [
      ['Freelance designers', 'Ines', '€24,000', '€15,500', { t: '−8% on pace', tone: 'mint' }, 'On track; one project moved in-house'],
      ['Paid social ads', 'Marc', '€18,000', '€16,900', { t: '+41% on pace', tone: 'coral' }, 'Spent early for the launch; pause in May'],
      ['Software licences', 'Lena', '€9,600', '€5,100', { t: '+6% on pace', tone: 'amber' }, 'Two extra seats; review unused ones'],
      ['Events and travel', 'Marc', '€12,000', '€3,200', { t: '−36% on pace', tone: 'sky' }, 'Autumn conference still to come'],
      ['Contingency', 'Lena', '€5,000', '€0', '', 'Kept for surprises; release in Q4 if unused'],
    ],
    side: { title: 'Rules we agreed', prompt: 'How the team handles money decisions during the year.', notes: ['Over 10%: explain in the review', 'Moving money between lines needs Lena’s OK'] },
  },
];

export default specs;
