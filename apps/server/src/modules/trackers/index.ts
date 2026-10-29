// Public API of modules/trackers [S2]: issue-tracker sync (KAI-153). Board items sent to a
// tracker as one issue (or one each), issues imported as linked cards, and both sides kept in
// step. The public API / MCP (`sync_to_tracker`) call these with the person's own access; the
// activity feed listens to `onTrackerActivity`.
export { sendToTracker, previewSend, boardConnections, projectsOf, importIssues, importCandidates, syncLink, TRACKER_SYNC_TOPIC } from './service';
export { onTrackerActivity, type TrackerActivityEvent } from './events';
