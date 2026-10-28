// Public API of modules/templates [S2]: saved templates (a board or selection saved for reuse).
// Only its own routes use it today; workspaces (KAI-37) will share templates per workspace by
// widening the visibility rule in repo.ts.
export { listTemplates, getTemplate } from './service';
