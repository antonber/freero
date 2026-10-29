// Research & UX templates (specs: see ../spec/types.ts; after editing run `npm run templates:index`).
import type { TemplateSpec } from '../spec/types';

const specs: TemplateSpec[] = [
  {
    id: 'research-plan',
    name: 'Research plan',
    description: 'Plan a study before booking anyone: the decision it informs, the questions, method, participants, timeline and how you’ll share it.',
    categories: ['research', 'product', 'design'],
    keywords: ['research plan', 'user research', 'study plan', 'research questions', 'method', 'participants', 'recruiting'],
    hint: 'Start from the decision the research will inform. If nobody is waiting on the answer, it is the wrong study, or the wrong time.',
    archetype: 'canvas',
    cols: 3,
    sections: [
      { title: 'Decision it informs', span: 2, tone: 'violet', prompt: 'What will the team decide differently depending on what we learn?', notes: ['Whether to build shared shopping lists or a family calendar first'] },
      { title: 'Research questions', tone: 'amber', prompt: 'What do we need to learn? Three to five questions, not interview questions.', notes: ['How do families split grocery shopping?', 'Where do plans fall apart?'] },
      { title: 'Method', tone: 'sky', prompt: 'How will we learn it, and why this method?', notes: ['8 remote interviews, 45 min', 'A week of photo diaries'] },
      { title: 'Participants', tone: 'rose', prompt: 'Who, how many, and how we find them.', notes: ['Parents with 2+ kids at home', 'Mix of one- and two-parent homes', 'Recruit via our newsletter'] },
      { title: 'Timeline', tone: 'gray', prompt: 'Key dates from recruiting to readout.', notes: ['Recruit: week 1', 'Sessions: weeks 2–3', 'Readout: 28 May'] },
      { title: 'Sharing the findings', span: 3, tone: 'mint', prompt: 'Who needs the results, in what form, and how will they join along the way?', notes: ['Engineers watch 2 live sessions', '30-min readout with clips', 'Insights added to the research library'] },
    ],
  },
  {
    id: 'survey-builder',
    name: 'Survey builder',
    description: 'Draft a survey people will finish: the goal, who answers, the questions in order and how each answer will be used.',
    categories: ['research', 'sales'],
    keywords: ['survey', 'questionnaire', 'customer survey', 'feedback', 'poll', 'nps', 'survey design'],
    hint: 'Every question needs a reason in the plan. If you can’t say what you would do with an answer, cut the question.',
    archetype: 'prompts',
    items: [
      { prompt: 'What do we want to learn, and why now?', detail: 'One goal per survey.', tone: 'violet', notes: ['Why trial users don’t invite teammates'] },
      { prompt: 'Who answers, and how many do we need?', detail: 'Audience, channel and sample size.', tone: 'rose', notes: ['Trial users in week 2', 'Aim for 150 replies by email'] },
      { prompt: 'Which questions, in what order?', detail: 'Easy first, open questions last, 10 or fewer.', tone: 'sky', notes: ['How many people are on your team?', 'What stopped you from inviting them?'] },
      { prompt: 'Is each question fair?', detail: 'No leading words, one idea per question, an "other" option.', tone: 'amber', notes: ['Not "How much do you love sharing?"', 'Split "price and speed" into two'] },
      { prompt: 'How will we use each answer?', detail: 'Link every question to a decision or a follow-up.', tone: 'mint', notes: ['"Too early" answers: send a reminder in week 3'] },
      { prompt: 'How do we thank people and close the loop?', detail: 'Tell them what changed because they answered.', tone: 'gray', notes: ['Share top 3 findings in the newsletter'] },
    ],
  },
];

export default specs;
