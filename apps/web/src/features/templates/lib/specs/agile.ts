// Agile templates (specs: see ../spec/types.ts; after editing run `npm run templates:index`).
import type { TemplateSpec } from '../spec/types';

const specs: TemplateSpec[] = [
  {
    id: 'hot-air-balloon-retro',
    name: 'Hot air balloon retro',
    description: 'A picture-led retro: what lifts the team, what weighs it down, the weather ahead and where the balloon should go next.',
    categories: ['agile', 'meetings'],
    keywords: ['retro', 'retrospective', 'hot air balloon', 'sprint retro', 'team reflection', 'risks', 'improvement'],
    hint: 'Fill the first two columns about the last sprint, the last two about the next one. End by turning one sandbag into an action with an owner.',
    archetype: 'columns',
    columns: [
      { title: 'Hot air', emoji: '🔥', tone: 'mint', prompt: 'What gave us lift? Habits, people, tools that pushed us up.', notes: ['Pairing on the tricky payment bug', 'Design joined refinement early', 'Fast CI after the cache fix'] },
      { title: 'Sandbags', emoji: '🪨', tone: 'coral', prompt: 'What weighed us down and kept us lower than we could be?', notes: ['Three days waiting on API keys', 'Too many meetings on Wednesday'] },
      { title: 'Weather ahead', emoji: '⛈️', tone: 'amber', prompt: 'What storms or tailwinds do we see coming next sprint?', notes: ['Half the team off for holidays', 'Marketing wants a demo on the 20th'] },
      { title: 'Destination', emoji: '🎯', tone: 'violet', prompt: 'Where should we steer? Name one or two things to try.', notes: ['Request keys a sprint ahead (Ola)', 'Meeting-free Wednesday mornings'] },
    ],
  },
  {
    id: 'team-dependencies',
    name: 'Team dependencies board',
    description: 'Who is waiting on whom across teams, by when, and how healthy each hand-off is, so blockers surface before planning day.',
    categories: ['agile', 'planning', 'engineering'],
    keywords: ['dependencies', 'cross-team', 'blockers', 'program planning', 'hand-offs', 'coordination', 'scaled agile'],
    hint: 'One row per hand-off, written by the team that needs it. Review the red and amber rows together every week, starting with the oldest.',
    archetype: 'table',
    columns: [
      { title: 'We need', w: 300 },
      { title: 'From team', w: 160 },
      { title: 'For', w: 260 },
      { title: 'Needed by', w: 140 },
      { title: 'Status', w: 170 },
      { title: 'Next step', w: 300 },
    ],
    rows: [
      ['Refund endpoint in the payments API', 'Payments', 'Self-serve refunds', '12 Mar', { t: 'At risk', tone: 'amber' }, 'Agree a smaller first version on Thursday'],
      ['New consent screen copy', 'Legal', 'EU sign-up flow', '5 Mar', { t: 'Blocked', tone: 'coral' }, 'Escalate to Legal lead: draft is 2 weeks late'],
      ['Event tracking for checkout', 'Data', 'Conversion dashboard', '20 Mar', { t: 'On track', tone: 'mint' }, 'Review the event list together on Monday'],
      ['Load test environment', 'Platform', 'Black Friday prep', '2 Apr', { t: 'Not started', tone: 'gray' }, 'Book a slot in their next planning'],
      ['Translated help articles (DE, FR)', 'Content', 'German launch', '18 Mar', { t: 'On track', tone: 'mint' }, 'First 10 articles arrive Friday'],
      ['Single sign-on for the admin app', 'Identity', 'Enterprise pilot', '25 Mar', { t: 'At risk', tone: 'amber' }, 'Pair one engineer with Identity for a week'],
    ],
    side: { title: 'Status key', prompt: 'Agree what each status means so a red always gets attention.', notes: ['Blocked: work stopped, needs a decision', 'At risk: date slips without help'] },
  },
];

export default specs;
