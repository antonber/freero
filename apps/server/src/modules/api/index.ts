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
  readOutline,
  exportBoard,
  listItems,
  createItems,
  updateItems,
  deleteItems,
  insertStructureFor,
  listSuggestions,
  proposeChanges,
  decideSuggestions,
  listComments,
  addComment,
  replyToComment,
  type ApiCall,
} from './service';
// Search, object addresses and backlinks (KAI-151, KAI-227).
export { searchContent, resolveForApi, backlinksForApi } from './objects';
