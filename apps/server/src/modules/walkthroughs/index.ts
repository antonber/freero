// Public API of modules/walkthroughs [S2]: async walkthroughs over a board (KAI-133). Routes are
// routes.ts. The uploads sweep keeps recordings that walkthroughs use; privacy exports a person's.
export { walkthroughUploadReferences, walkthroughsExportOf, createWalkthrough, getWalkthrough, addComment, recordView } from './service';
export { registerWalkthroughObjects } from './objects';
