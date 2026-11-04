// Public API of modules/api [S2]: what a credential can do with Freero — the operations behind
// /api/v1 (routes.ts), for the other resource server, the MCP server (modules/mcp, KAI-107), to
// call with the very same rules: roles AND scopes, the team's API switch and blocks, the
// downloads policy, confirmations, the per-agent write limit, attribution and the audit event.
//
//   const call = newApiCall(req, cred)          after apiauth.authenticate + requireScope
//   const out = await createItems(call, boardId, { items })
//   await recordApiCall(call, 'mcp add_stickies', 200, boardId)
export {
  newApiCall,
  recordApiCall,
  actingApp,
  withNotice,
  boardUrl,
  me,
  listWorkspaces,
  searchBoards,
  templatesFor,
  createBoard,
  getBoard,
  // Rename, copy, group (#170).
  updateBoard,
  copyBoard,
  groupItems,
  ungroupItems,
  // Embedding on other sites (#2).
  getBoardEmbed,
  setBoardEmbed,
  readOutline,
  exportBoard,
  listItems,
  createItems,
  updateItems,
  deleteItems,
  insertStructureFor,
  // Kanbans: fields, the saved view, cards as rows (step 2e).
  getKanban,
  defineFields,
  configureView,
  queryCards,
  // Linked views of a kanban elsewhere on the board (step 3c).
  addView,
  listSuggestions,
  proposeChanges,
  decideSuggestions,
  listComments,
  addComment,
  replyToComment,
  syncToTracker,
  importFromTracker,
  trackerConnections,
  // Live board views in AI assistants (MCP Apps, KAI-171).
  openLiveView,
  shareLink,
  type ApiCall,
} from './service';
// What may be proposed as suggestions and how it is planned (KAI-169), for the in-app board
// assistant (modules/ai, #1): the same shapes and planners as propose_changes, so a proposal from
// either path does exactly what writing it would have done.
export { readProposal, planProposal, type Proposal } from './suggestions';
// Search, object addresses and backlinks (KAI-151, KAI-227).
export { searchContent, resolveForApi, backlinksForApi } from './objects';
// A board as an agent's control room (KAI-172): post plan / status / tasks, read people's feedback.
export { postStatus, getFeedback, PLACEHOLDER_AGENT, type StatusPost, type TaskState, type FeedbackChange } from './controlRoom';
// Docs (KAI-162): list, create from Markdown, read as Markdown + blocks, append Markdown.
export { listDocs, createDocFor, readDocFor, appendToDoc } from './docs';
// Docs beyond append (#61): targeted edits by block id, comments on blocks.
export { editDocFor, listDocComments, addDocComment, replyToDocComment } from './docs';
// Board pictures drawn on the server (#33): PNG / SVG / PDF as an export, and single-use download links.
export { renderForApi, exportLink } from './exports';
