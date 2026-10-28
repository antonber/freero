import { defineFeature } from '@engine';

// The `trackers` collection holds one TrackerIssueRecord per linked issue (@freero/shared
// trackers.ts). Its only writer is the SERVER (modules/trackers, through realtime's changeBoard):
// this feature reads it for the badges and asks the server for every change through Host.trackers.
export default defineFeature({
  name: 'trackers',
  description:
    'Issue trackers (Jira, Linear, GitHub): send sticky notes, a cluster or cards to a tracker as one issue, see each linked item’s issue key, status and assignee live, and import issues as linked cards.',
  owns: ['trackers'],
});
