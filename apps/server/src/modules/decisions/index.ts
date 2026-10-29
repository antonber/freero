// Public API of modules/decisions [S2]: decision snapshots (KAI-161). Routes are routes.ts; other
// modules need the data export (modules/privacy) and, in tests, the object type.
export { decisionsExportOf, createDecision, decisionState, decisionChanges } from './service';
export { registerDecisionObjects } from './objects';
