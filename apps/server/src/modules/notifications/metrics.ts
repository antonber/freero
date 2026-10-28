// Metrics of modules/notifications (/metrics). Also what checks wait on instead of fixed sleeps
// (KAI-173): "this instance finished handling the comment" and "the digest job ran again".
import { counter } from '../../platform/metrics';

export const commentMessagesHandled = counter(
  'freero_notifications_comment_messages_handled_total',
  'Comment messages this instance finished turning into notifications and pending mentions (failed ones included)',
);
export const digestRuns = counter('freero_notifications_digest_runs_total', 'Completed runs of the email digest job on this instance');
export const cardChangesSettled = counter(
  'freero_notifications_card_changes_settled_total',
  'Task-card assignment / due-date changes this instance settled and turned into notifications (KAI-135; failed ones included)',
);
