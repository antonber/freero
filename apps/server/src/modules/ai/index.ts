// Public API of modules/ai [S2]: AI on boards with a model provider the operator or a workspace
// brings (KAI-101, KAI-102; docs/ai.md). Routes are routes.ts; other modules only need the data
// exports (modules/privacy).
export { aiUsageExportOf, aiWorkspaceExportOf } from './settings';
// Walkthrough captions (KAI-133): speech to text through the board's own AI provider, never another.
export { transcribeRecording, transcriptionUnavailable } from './transcribe';
