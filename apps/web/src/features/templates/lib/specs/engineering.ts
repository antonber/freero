// Engineering templates (specs: see ../spec/types.ts; after editing run `npm run templates:index`).
import type { TemplateSpec } from '../spec/types';

const specs: TemplateSpec[] = [
  {
    id: 'tech-debt-register',
    name: 'Tech debt register',
    description: 'Known shortcuts in the codebase with what each one costs today, the risk it carries and the fix you would make.',
    categories: ['engineering', 'planning'],
    keywords: ['tech debt', 'technical debt', 'refactoring', 'code quality', 'maintenance', 'legacy', 'engineering backlog'],
    hint: 'Write the cost in hours or incidents, not adjectives. Pick the next item by cost of delay, not by how annoying the code is.',
    archetype: 'table',
    columns: [
      { title: 'Debt', w: 300 },
      { title: 'What it costs us', w: 300 },
      { title: 'Risk', w: 130 },
      { title: 'Fix', w: 300 },
      { title: 'Effort', w: 120 },
      { title: 'Owner', w: 120 },
    ],
    rows: [
      ['Orders and invoices share one database table', 'Every billing change needs a release freeze', { t: 'High', tone: 'coral' }, 'Split invoices into their own table and service', '3 weeks', 'Billing'],
      ['Hand-rolled date parsing in the mobile app', 'Two time-zone bugs a month', { t: 'Medium', tone: 'amber' }, 'Replace with the standard library helpers', '4 days', 'Mobile'],
      ['No staging copy of the search index', 'Search changes tested in production', { t: 'High', tone: 'coral' }, 'Nightly snapshot to a staging cluster', '1 week', 'Platform'],
      ['Old admin pages on a retired UI kit', 'Slower to change, but rarely touched', { t: 'Low', tone: 'mint' }, 'Rewrite page by page when we next touch them', 'Ongoing', 'Web'],
    ],
    side: { title: 'Adding a row', prompt: 'What makes a good entry, so the register stays useful.', notes: ['Link the incident or ticket it caused', 'Say what gets cheaper once fixed'] },
  },
  {
    id: 'runbook',
    name: 'Service runbook',
    description: 'What an on-call engineer needs at 3am for one service: how to tell it’s broken, first checks, safe fixes and who to wake.',
    categories: ['engineering', 'operations'],
    keywords: ['runbook', 'playbook', 'on-call', 'operations', 'sre', 'incident response', 'troubleshooting', 'alerts'],
    hint: 'Write it for someone who has never seen this service. Test it: hand it to a teammate during a drill and fix every step they had to ask about.',
    archetype: 'prompts',
    items: [
      { prompt: 'What does this service do, and who notices when it breaks?', detail: 'One paragraph and the user-facing symptom.', tone: 'sky', notes: ['Sends receipts and password emails', 'Users report missing reset emails first'] },
      { prompt: 'Which alerts point here?', detail: 'Alert names, dashboards and what normal looks like.', tone: 'amber', notes: ['Mail queue depth alert: normal is under 200', 'Dashboard: Email › Delivery'] },
      { prompt: 'First five minutes: what do I check?', detail: 'In order, with the exact command or link.', tone: 'violet', notes: ['Is the email provider status page green?', 'Queue depth and worker count', 'Errors in the last deploy?'] },
      { prompt: 'Which fixes are safe to try?', detail: 'Actions anyone on call may take without asking.', tone: 'mint', notes: ['Restart the workers', 'Roll back the last deploy', 'Switch to the backup provider'] },
      { prompt: 'What must I never do?', detail: 'Actions that make things worse or lose data.', tone: 'coral', notes: ['Don’t purge the queue: emails are lost', 'Don’t raise the send rate above 50/s'] },
      { prompt: 'Who do I call, and when?', detail: 'Escalation path with response times.', tone: 'rose', notes: ['After 20 min: messaging team lead', 'Provider support: account 4471'] },
    ],
  },
  {
    id: 'release-readiness',
    name: 'Release readiness check',
    description: 'A go/no-go review before a release: what is ready, what is still open and what must be true before you ship.',
    categories: ['engineering', 'product', 'meetings'],
    keywords: ['release readiness', 'go no go', 'launch checklist', 'release checklist', 'deployment', 'qa', 'ship'],
    hint: 'Each area’s owner fills their column before the meeting. The meeting only discusses the open column and makes the call.',
    archetype: 'columns',
    columns: [
      { title: 'Ready', tone: 'mint', prompt: 'What is done and verified? Name who checked it.', notes: ['Regression suite green (QA, Fri)', 'Migration tested on a prod copy', 'Help articles published'] },
      { title: 'Still open', tone: 'amber', prompt: 'What isn’t finished yet, and when will it be?', notes: ['Android build in store review', 'Support macros for the new plans'] },
      { title: 'Must be true to ship', tone: 'coral', prompt: 'Hard conditions. If one fails, we don’t ship.', notes: ['Rollback tested in under 10 min', 'Payments team on call on launch day'] },
      { title: 'Decision', tone: 'violet', prompt: 'Go, no-go or go with conditions? Who decided, and when do we look again?', notes: ['Go Tuesday 10:00 if Android is approved by Monday (Sam)'] },
    ],
  },
];

export default specs;
