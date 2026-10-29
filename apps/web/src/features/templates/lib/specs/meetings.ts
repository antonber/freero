// Meeting templates (specs: see ../spec/types.ts; after editing run `npm run templates:index`).
import type { TemplateSpec } from '../spec/types';

const specs: TemplateSpec[] = [
  {
    id: 'quarterly-business-review',
    name: 'Quarterly business review',
    description: 'Review a quarter with a customer or leadership: results against goals, what moved them, risks and the bets for next quarter.',
    categories: ['meetings', 'strategy', 'sales'],
    keywords: ['qbr', 'quarterly review', 'business review', 'results', 'customer review', 'executive review', 'quarter'],
    hint: 'Send the board a day early so the meeting is spent on decisions, not reading. Lead with the numbers, then the story behind them.',
    archetype: 'canvas',
    cols: 3,
    sections: [
      { title: 'Goals we set', tone: 'violet', prompt: 'What did we agree to achieve this quarter, in numbers?', notes: ['Cut ticket backlog from 900 to 300', 'Roll out to the Lyon and Porto sites'] },
      { title: 'What we delivered', tone: 'mint', prompt: 'Results against each goal: hit, missed or partial.', notes: ['Backlog at 280: hit', 'Lyon live, Porto slipped to May'] },
      { title: 'What moved the numbers', tone: 'sky', prompt: 'Which changes made the biggest difference, good or bad?', notes: ['Auto-routing cut handling time 22%', 'Porto data migration took 3x longer'] },
      { title: 'Risks and asks', tone: 'coral', prompt: 'What could hurt next quarter, and what do we need from the room?', notes: ['Two senior agents leave in June', 'Need a decision on weekend cover budget'] },
      { title: 'Customer voice', tone: 'rose', prompt: 'What are customers or users telling us? Quote them.', notes: ['"Replies are faster, but we repeat ourselves"', 'CSAT up from 4.1 to 4.4'] },
      { title: 'Bets for next quarter', tone: 'amber', prompt: 'Three priorities at most, each with a number and an owner.', notes: ['Porto live by 15 May (Ana)', 'One-touch resolution to 60% (Raj)'] },
    ],
  },
  {
    id: 'all-hands-agenda',
    name: 'All-hands agenda',
    description: 'A company or department meeting in timed blocks, from wins and numbers to the big topic and open questions.',
    categories: ['meetings'],
    keywords: ['all hands', 'town hall', 'company meeting', 'agenda', 'team meeting', 'update', 'q&a'],
    hint: 'Keep the updates short so the open questions get real time. Collect questions in advance and let people vote on them.',
    archetype: 'timeline',
    phases: [
      { title: 'Welcome', when: '0–5 min', tone: 'violet', prompt: 'Set the mood and say what people will leave with.', notes: ['Welcome the 6 people who joined this month', 'Today: new office plan + Q&A'] },
      { title: 'Wins', when: '5–15 min', tone: 'mint', prompt: 'Who did something worth celebrating? Name people, not teams.', notes: ['Priya’s team shipped invoicing a week early', 'Biggest school district renewed for 3 years'] },
      { title: 'Numbers', when: '15–25 min', tone: 'sky', prompt: 'Three numbers that show how we are doing, and why they moved.', notes: ['Revenue 104% of plan', 'Hiring: 9 of 14 roles filled'] },
      { title: 'Big topic', when: '25–45 min', tone: 'amber', prompt: 'The one change or decision everyone needs to understand.', notes: ['Moving to a hybrid week from September', 'Why, what changes, what stays the same'] },
      { title: 'Open questions', when: '45–60 min', tone: 'rose', prompt: 'Top-voted questions first. Say "we don’t know yet" when that is true.', notes: ['Will desks be assigned?', 'What happens to the travel budget?'] },
    ],
  },
  {
    id: 'pre-mortem',
    name: 'Pre-mortem',
    description: 'Imagine the project has already failed, list every reason why, then decide what to do now so it doesn’t.',
    categories: ['meetings', 'planning', 'engineering'],
    keywords: ['pre-mortem', 'premortem', 'risk', 'risk assessment', 'project risks', 'failure', 'prevention', 'planning'],
    hint: 'Write silently for five minutes first: it is a year from now and the project failed badly. Then share, group the causes and pick the few worth acting on.',
    archetype: 'columns',
    columns: [
      { title: 'It failed because…', tone: 'coral', prompt: 'Assume total failure. What went wrong? Be specific and blunt.', notes: ['The data migration corrupted old orders', 'Stores never got trained before launch', 'We built it for HQ, not for cashiers'] },
      { title: 'Early warning signs', tone: 'amber', prompt: 'What would we see weeks before the failure, if we were looking?', notes: ['Test migrations keep getting postponed', 'Store managers skip the pilot calls'] },
      { title: 'What we do now', tone: 'mint', prompt: 'Which causes can we prevent or soften today? Who owns each?', notes: ['Full dry-run migration in March (Tom)', 'Two cashiers on the design review (Lea)'] },
      { title: 'What we accept', tone: 'gray', prompt: 'Risks we choose to live with, and why.', notes: ['Launch during sales season: we can’t move it'] },
    ],
  },
  {
    id: 'offsite-planner',
    name: 'Team offsite planner',
    description: 'Plan an offsite people are glad they went to: purpose, outcomes, sessions, logistics and what happens after.',
    categories: ['meetings', 'icebreakers', 'planning'],
    keywords: ['offsite', 'retreat', 'team away day', 'event planning', 'agenda', 'team building', 'logistics'],
    hint: 'Start with why you are getting together in person. Every session should earn its place against that purpose.',
    archetype: 'canvas',
    cols: 3,
    sections: [
      { title: 'Why we are meeting', span: 2, tone: 'violet', prompt: 'What can we only do together in a room that we can’t do on calls?', notes: ['Agree next year’s product bets as one team', 'Meet the 5 people who joined remotely'] },
      { title: 'Outcomes', tone: 'mint', prompt: 'What will exist at the end that doesn’t now?', notes: ['Top 3 bets with owners', 'A working agreement for the new team'] },
      { title: 'Sessions', tone: 'sky', prompt: 'Which blocks get us there? Mix deep work, energy and rest.', notes: ['Day 1 am: what customers told us', 'Day 1 pm: walk and talk in pairs', 'Day 2: bets and owners'] },
      { title: 'Fun and connection', tone: 'rose', prompt: 'What will people talk about afterwards?', notes: ['Cooking dinner together', 'Morning swim for the brave'] },
      { title: 'Logistics', tone: 'amber', prompt: 'Place, travel, food, budget, access needs.', notes: ['Farmhouse 1h from the station', '€450 per person all-in', 'Ask about diets and mobility'] },
      { title: 'After the offsite', span: 3, tone: 'gray', prompt: 'How will decisions survive the trip home? Who writes up, who follows up, when?', notes: ['Write-up shared within 3 days (Mo)', 'Check progress on bets at the next all-hands'] },
    ],
  },
];

export default specs;
