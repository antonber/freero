// Public API of modules/ai [S2]: AI on boards with a model provider the operator or a workspace
// brings (KAI-101, KAI-102; docs/ai.md). Routes are routes.ts; other modules only need the data
// exports (modules/privacy).
export { aiUsageExportOf, aiWorkspaceExportOf } from './settings';
// The board assistant (#1): a person's own conversations, for their data export.
export { assistantExportOf as aiAssistantExportOf } from './assistant';
// Walkthrough captions (KAI-133): speech to text through the board's own AI provider, never another.
export { transcribeRecording, transcriptionUnavailable } from './transcribe';
// Walkthrough summary and chapters (#127): a draft from the captions, through the board's AI provider.
export { draftWalkthroughChapters } from './walkthrough';
