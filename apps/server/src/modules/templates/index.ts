// Public API of modules/templates [S2]: saved templates (a board or selection saved for reuse),
// personal or shared with a team workspace (the visibility rule in repo.ts).
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import * as repo from './repo';

export { listTemplates, getTemplate, saveTemplate } from './service';
// The object registry (modules/objects): templates, visible as the template list shows them.
export { registerTemplateObjectType } from './objects';

/** Data exports: a person's own templates, or those shared with a workspace — with their content. */
export function templatesExportOf(by: { ownerId: string } | { workspaceId: string }) {
  return repo.fullTemplates(by);
}

/**
 * Upload names saved templates reference (images in their content, their thumbnails), restricted
 * to `among` when given. A template outlives the board it came from, so these files must too.
 */
export function templateUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.matchesInTemplates(UPLOAD_REF_PATTERN, among ?? null);
}
