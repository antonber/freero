// Product templates (specs: see ../spec/types.ts; after editing run `npm run templates:index`).
import type { TemplateSpec } from '../spec/types';

const specs: TemplateSpec[] = [
  {
    id: 'assumption-map',
    name: 'Assumption map',
    description: 'Sort what you believe about an idea by how much it matters and how much evidence you have, then test the risky ones first.',
    categories: ['product', 'research', 'strategy'],
    keywords: ['assumptions', 'assumption mapping', 'risk', 'hypotheses', 'validation', 'experiments', 'lean', 'discovery'],
    hint: 'Write every belief the idea depends on, one per sticky. Top-left is where ideas die quietly: test those before you build anything.',
    archetype: 'matrix',
    axes: { x: 'Evidence we have', y: 'Importance' },
    quadrants: [
      { title: 'Test first', tone: 'coral', prompt: 'Critical and barely evidenced. If wrong, the idea fails.', notes: ['Parents will pay monthly for tutoring', 'Tutors want evening slots'] },
      { title: 'Keep an eye on', tone: 'mint', prompt: 'Critical and well evidenced. Recheck when things change.', notes: ['Exams drive demand in May and June'] },
      { title: 'Explore later', tone: 'amber', prompt: 'Less important and unproven. Park them for now.', notes: ['Kids prefer video over chat'] },
      { title: 'Safe to assume', tone: 'sky', prompt: 'Less important and well known. Move on.', notes: ['Most families have a laptop at home'] },
    ],
    side: { title: 'To place', prompt: 'New assumptions from the team, not sorted yet.', notes: ['Schools will recommend us', 'Tutors can handle 3 kids at once'] },
  },
  {
    id: 'metric-tree',
    name: 'Metric tree',
    description: 'Break one top-level metric into the drivers that move it and the levers teams control, so every team sees its link to the goal.',
    categories: ['product', 'strategy', 'planning'],
    keywords: ['metric tree', 'kpi tree', 'driver tree', 'metrics', 'input metrics', 'goals', 'analytics', 'growth model'],
    hint: 'Start with one outcome metric. Each child should add up to, or clearly drive, its parent. Stop when a team can change the leaf this month.',
    archetype: 'tree',
    root: 'Weekly paid orders',
    branches: [
      { text: 'New customers', tone: 'sky', children: ['Visitors to the menu page', 'Sign-up rate', 'First-order rate'] },
      { text: 'Returning customers', tone: 'mint', children: ['Orders per customer per month', 'Share reordering a favourite'] },
      { text: 'Order completion', tone: 'amber', children: ['Checkout success rate', 'Payment failures', 'Out-of-stock cancellations'] },
      { text: 'Win-back', tone: 'rose', children: ['Lapsed customers reached', 'Return rate after an offer'] },
    ],
    side: { title: 'How to read it', prompt: 'For each leaf, write the team that owns it and today’s value.', notes: ['Checkout success: 91%, Payments team', 'Reorder share: 34%, Growth team', 'Add a leaf only if someone can act on it'] },
  },
  {
    id: 'experiment-plan',
    name: 'Experiment plan',
    description: 'Design one experiment before running it: the belief, the test, the signal you expect and what you will do with each result.',
    categories: ['product', 'research'],
    keywords: ['experiment', 'a/b test', 'hypothesis', 'test plan', 'validation', 'growth experiment', 'mvp', 'learning'],
    hint: 'Decide what result would change your mind before you see any data. If no result would change the plan, skip the experiment.',
    archetype: 'canvas',
    cols: 3,
    sections: [
      { title: 'We believe', tone: 'violet', prompt: 'The assumption under test, in one sentence.', notes: ['Showing delivery time before checkout lifts orders'] },
      { title: 'So we will', tone: 'sky', prompt: 'The smallest test that could prove us wrong.', notes: ['Show the estimate on the menu for 50% of visitors', 'Run for 14 days'] },
      { title: 'We’ll know by', tone: 'mint', prompt: 'Which number, how big a change, by when?', notes: ['Checkout starts up 5% or more', 'Need 8,000 visitors per group'] },
      { title: 'Guardrails', tone: 'coral', prompt: 'What must not get worse while we test?', notes: ['Cancellations stay under 3%', 'Support tickets about delays don’t rise'] },
      { title: 'If it works', tone: 'amber', prompt: 'What do we do next if the signal is clear?', notes: ['Roll out to everyone', 'Try showing it on the home page'] },
      { title: 'If it doesn’t', tone: 'gray', prompt: 'What do we do if it’s flat or negative?', notes: ['Check if estimates were accurate', 'Drop it and test free-delivery threshold'] },
    ],
  },
  {
    id: 'jobs-to-be-done',
    name: 'Jobs to be done',
    description: 'Understand the progress customers are trying to make: the situation, the job, what they use today and what holds them back.',
    categories: ['product', 'research', 'design'],
    keywords: ['jobs to be done', 'jtbd', 'customer needs', 'job story', 'motivation', 'switching', 'discovery'],
    hint: 'Fill it from one real interview at a time. Write in the customer’s words; the job is about progress, never about your product.',
    archetype: 'prompts',
    items: [
      { prompt: 'When does the need show up?', detail: 'The situation or trigger, as concrete as a calendar entry.', tone: 'sky', notes: ['Sunday evening, planning the week’s dinners', 'Fridge is half empty'] },
      { prompt: 'What are they trying to get done?', detail: 'The progress they want, without naming a solution.', tone: 'violet', notes: ['Feed the family healthily without thinking every night'] },
      { prompt: 'How will they know it went well?', detail: 'Their own measures of success.', tone: 'mint', notes: ['No 6pm panic', 'Less food thrown away on Friday'] },
      { prompt: 'What do they use today?', detail: 'Products, workarounds, people or doing nothing.', tone: 'gray', notes: ['A notes app list', 'Same five recipes on rotation'] },
      { prompt: 'What pushes them to change?', detail: 'Frustrations with today and the pull of something better.', tone: 'amber', notes: ['Kids complain about repeats', 'A friend’s meal plan looked easy'] },
      { prompt: 'What holds them back?', detail: 'Anxieties about the new and habits of the old.', tone: 'coral', notes: ['Worried it costs more', 'Recipes might be too long on weekdays'] },
    ],
  },
];

export default specs;
